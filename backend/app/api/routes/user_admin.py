"""Super administrator account and registration controls."""
import secrets
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database import get_connection
from app.services.security import get_current_super_admin, hash_password, utc_now_iso

router = APIRouter(dependencies=[Depends(get_current_super_admin)])
Kind = Literal['student', 'teacher']


class Deletion(BaseModel):
    confirmation: str
    digest: str
    removeFromAllowlist: bool = False


@router.get('/users/{kind}/{account_id}/deletion-preview')
def deletion_preview(kind: Kind, account_id: int):
    from app.repositories.user_deletion import preview
    return preview(kind, account_id)


@router.post('/users/{kind}/{account_id}/deletion')
def delete_user(kind: Kind, account_id: int, payload: Deletion):
    from app.repositories.user_deletion import start
    try:
        return start(kind, account_id, payload.confirmation, payload.digest, payload.removeFromAllowlist)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, detail='存在仍被其他资源引用的数据，删除已回滚；请先解除关联') from exc


@router.get('/user-deletions')
def deletion_jobs():
    with get_connection() as db:
        return [dict(r) for r in db.execute('SELECT id, status, error, created_at FROM user_deletion_jobs ORDER BY created_at DESC LIMIT 30')]


@router.post('/user-deletions/{job_id}/retry')
def retry_deletion(job_id: str):
    with get_connection() as db:
        db.execute("UPDATE user_deletion_jobs SET status = 'pending', error = NULL WHERE id = ? AND status = 'failed'", (job_id,))
    return {'ok': True}


class Entry(BaseModel):
    studentNo: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=64)


class Entries(BaseModel):
    entries: list[Entry] = Field(min_length=1, max_length=10000)


@router.get('/users')
def users(q: str = '', kind: Literal['all', 'student', 'teacher'] = 'all', page: int = Query(1, ge=1)):
    with get_connection() as db:
        source = """SELECT id, 'student' kind, student_no account, name, 'student' role, status, created_at FROM student_accounts WHERE account_kind = 'normal'
                    UNION ALL SELECT id, 'teacher' kind, employee_no account, name, role, status, created_at FROM teacher_accounts"""
        where = " WHERE (? = 'all' OR kind = ?) AND (instr(account, ?) > 0 OR instr(name, ?) > 0)"
        args = (kind, kind, q.strip(), q.strip())
        total = db.execute('SELECT count(*) FROM (' + source + ')' + where, args).fetchone()[0]
        rows = db.execute('SELECT * FROM (' + source + ')' + where + ' ORDER BY created_at DESC, kind, id LIMIT 30 OFFSET ?', (*args, (page - 1) * 30)).fetchall()
        return {'items': [dict(row) for row in rows], 'total': total}


@router.get('/registration-allowlist')
def allowlist(q: str = '', page: int = Query(1, ge=1)):
    with get_connection() as db:
        where = ' WHERE instr(a.student_no, ?) > 0 OR instr(a.name, ?) > 0'
        args = (q.strip(), q.strip())
        total = db.execute('SELECT count(*) FROM registration_allowlist a' + where, args).fetchone()[0]
        rows = db.execute('SELECT a.student_no AS studentNo, a.name, EXISTS(SELECT 1 FROM student_accounts s WHERE s.student_no = a.student_no AND s.name = a.name) AS registered FROM registration_allowlist a' + where + ' ORDER BY a.student_no LIMIT 30 OFFSET ?', (*args, (page - 1) * 30)).fetchall()
        return {'items': [dict(row) for row in rows], 'total': total}


def prepare_entries(db, entries):
    result, errors, seen, duplicates = [], [], {}, 0
    for index, entry in enumerate(entries, 1):
        number, name = entry.studentNo.strip(), entry.name.strip()
        if not number or not name or number.startswith('preview-student-'):
            errors.append(f'第 {index} 行：学号或姓名为空或学号为系统保留值')
            continue
        existing = db.execute('SELECT name FROM registration_allowlist WHERE student_no = ?', (number,)).fetchone()
        account = db.execute('SELECT name FROM student_accounts WHERE student_no = ?', (number,)).fetchone()
        previous = seen.get(number) or (existing['name'] if existing else None) or (account['name'] if account else None)
        if previous is not None and previous != name:
            errors.append(f'第 {index} 行：学号 {number} 已对应其他姓名')
        elif number in seen or existing:
            duplicates += 1
        else:
            result.append((number, name, utc_now_iso()))
        seen[number] = name
    return result, errors, duplicates


@router.post('/registration-allowlist/preview')
def preview_entries(payload: Entries):
    with get_connection() as db:
        rows, errors, duplicates = prepare_entries(db, payload.entries)
        return {'added': len(rows), 'duplicates': duplicates, 'errors': errors}


@router.post('/registration-allowlist')
def save_entries(payload: Entries):
    with get_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        rows, errors, duplicates = prepare_entries(db, payload.entries)
        if errors:
            raise HTTPException(409, detail='；'.join(errors))
        db.executemany('INSERT INTO registration_allowlist VALUES (?, ?, ?)', rows)
        return {'added': len(rows), 'duplicates': duplicates}


@router.delete('/registration-allowlist/{number}')
def remove_entry(number: str):
    with get_connection() as db:
        db.execute('DELETE FROM registration_allowlist WHERE student_no = ?', (number,))
    return {'ok': True}


@router.post('/users/{kind}/{account_id}/reset-password')
def reset_password(kind: Kind, account_id: int):
    with get_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute(f'SELECT * FROM {kind}_accounts WHERE id = ?', (account_id,)).fetchone()
        if not row:
            raise HTTPException(404, detail='用户不存在')
        if row['status'] != 'active' or (kind == 'teacher' and row['role'] == 'super_admin') or (kind == 'student' and row['account_kind'] != 'normal'):
            raise HTTPException(409, detail='该账号不可初始化密码')
        password = secrets.token_urlsafe(15)
        db.execute(f'UPDATE {kind}_accounts SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', (hash_password(password), utc_now_iso(), account_id))
        db.execute(f'DELETE FROM {kind}_sessions WHERE {kind}_account_id = ?', (account_id,))
        return {'password': password}
