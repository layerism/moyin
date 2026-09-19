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
    className: str = Field(default='', max_length=128)
    studentNo: str = Field(default='', max_length=32)
    name: str = Field(default='', max_length=64)


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
def allowlist(q: str = '', className: str | None = None, page: int = Query(1, ge=1)):
    with get_connection() as db:
        where = ' WHERE (instr(a.student_no, ?) > 0 OR instr(a.name, ?) > 0) AND (? IS NULL OR a.class_name = ?)'
        args = (q.strip(), q.strip(), className, className)
        total = db.execute('SELECT count(*) FROM registration_allowlist a' + where, args).fetchone()[0]
        rows = db.execute("""SELECT a.id, a.class_name AS className, a.student_no AS studentNo, a.name,
            EXISTS(SELECT 1 FROM student_accounts s WHERE s.student_no = a.student_no AND s.name = a.name) AS registered
            FROM registration_allowlist a""" + where + ' ORDER BY a.class_name, a.student_no, a.id LIMIT 30 OFFSET ?', (*args, (page - 1) * 30)).fetchall()
        classes = db.execute('SELECT class_name AS className, count(*) AS count FROM registration_allowlist GROUP BY class_name ORDER BY class_name').fetchall()
        return {'items': [dict(row) for row in rows], 'total': total, 'classes': [dict(row) for row in classes]}


@router.post('/registration-allowlist/preview')
def preview_entries(payload: Entries):
    from app.repositories.registration_allowlist import prepare_entries
    with get_connection() as db:
        return prepare_entries(db, payload.entries)[2]


@router.post('/registration-allowlist')
def save_entries(payload: Entries):
    from app.repositories.registration_allowlist import save_entries as save
    with get_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        return save(db, payload.entries)


class ClassSelection(BaseModel):
    className: str = Field(max_length=128)


class ClassRemoval(ClassSelection):
    digest: str


@router.post('/registration-allowlist/class-removal-preview')
def preview_class_removal(payload: ClassSelection):
    from app.repositories.registration_allowlist import class_removal_preview
    with get_connection() as db:
        return class_removal_preview(db, payload.className)


@router.post('/registration-allowlist/class-removal')
def remove_class(payload: ClassRemoval):
    from app.repositories.registration_allowlist import class_removal_preview
    with get_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        preview = class_removal_preview(db, payload.className)
        if preview['digest'] != payload.digest:
            raise HTTPException(409, detail='该班级名单已变化，请关闭弹窗后重新确认')
        db.execute('DELETE FROM registration_allowlist WHERE class_name = ?', (payload.className,))
        return {'removed': preview['count']}


@router.put('/registration-allowlist/entries/{entry_id}')
def update_entry(entry_id: int, payload: Entry):
    number, name, class_name = payload.studentNo.strip(), payload.name.strip(), payload.className.strip()
    if not any((number, name, class_name)) or number.startswith('preview-student-'):
        raise HTTPException(422, detail='请至少填写一项有效信息')
    with get_connection() as db:
        db.execute('BEGIN IMMEDIATE')
        if not db.execute('SELECT 1 FROM registration_allowlist WHERE id = ?', (entry_id,)).fetchone():
            raise HTTPException(404, detail='该记录已移除')
        if number:
            if db.execute('SELECT 1 FROM registration_allowlist WHERE student_no = ? AND id <> ?', (number, entry_id)).fetchone():
                raise HTTPException(409, detail='该学号已在名单中')
            account = db.execute('SELECT name FROM student_accounts WHERE student_no = ?', (number,)).fetchone()
            if name and account and account['name'] != name:
                raise HTTPException(409, detail='该学号已注册为其他姓名')
        db.execute('UPDATE registration_allowlist SET class_name = ?, student_no = ?, name = ? WHERE id = ?', (class_name, number, name, entry_id))
    return {'ok': True}


@router.delete('/registration-allowlist/entries/{entry_id}')
def remove_entry(entry_id: int):
    with get_connection() as db:
        db.execute('DELETE FROM registration_allowlist WHERE id = ?', (entry_id,))
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
