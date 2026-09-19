"""Registration roster import, including incomplete rows awaiting correction."""
import hashlib
import json

from fastapi import HTTPException

from app.services.security import utc_now_iso


def prepare_entries(db, entries):
    additions, updates, errors, seen = [], {}, [], {}
    duplicates = incomplete = 0
    for index, entry in enumerate(entries, 1):
        number, name, class_name = entry.studentNo.strip(), entry.name.strip(), entry.className.strip()
        if not any((number, name, class_name)):
            continue
        if number.startswith('preview-student-'):
            errors.append(f'第 {index} 条：学号为系统保留值')
            continue
        if number and number in seen:
            if seen[number] != (name, class_name):
                errors.append(f'第 {index} 条：同一学号存在不同姓名或班级，请合并为一条')
            else:
                duplicates += 1
            continue
        if number:
            seen[number] = (name, class_name)
        existing = db.execute('SELECT * FROM registration_allowlist WHERE student_no = ?', (number,)).fetchone() if number else None
        account = db.execute('SELECT name FROM student_accounts WHERE student_no = ?', (number,)).fetchone() if number else None
        if name and ((existing and existing['name'] and existing['name'] != name) or (account and account['name'] != name)):
            errors.append(f'第 {index} 条：学号 {number} 已对应其他姓名')
            continue
        if existing:
            name = name or existing['name']
            class_name = class_name or existing['class_name']
            if (name, class_name) == (existing['name'], existing['class_name']):
                duplicates += 1
            else:
                updates[existing['id']] = (class_name, name)
        else:
            additions.append((class_name, number, name, utc_now_iso()))
        incomplete += int(not number or not name)
    return additions, updates, {'added': len(additions), 'updated': len(updates), 'duplicates': duplicates, 'incomplete': incomplete, 'errors': errors}


def save_entries(db, entries):
    additions, updates, result = prepare_entries(db, entries)
    if result['errors']:
        raise HTTPException(409, detail='；'.join(result['errors']))
    db.executemany('INSERT INTO registration_allowlist (class_name, student_no, name, created_at) VALUES (?, ?, ?, ?)', additions)
    db.executemany('UPDATE registration_allowlist SET class_name = ?, name = ? WHERE id = ?',
                   [(class_name, name, record_id) for record_id, (class_name, name) in updates.items()])
    return result


def class_removal_preview(db, class_name):
    rows = db.execute('SELECT id, student_no, name FROM registration_allowlist WHERE class_name = ? ORDER BY id', (class_name,)).fetchall()
    digest = hashlib.sha256(json.dumps([class_name, [dict(row) for row in rows]], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {'className': class_name, 'count': len(rows), 'digest': digest}
