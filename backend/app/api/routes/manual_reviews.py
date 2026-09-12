import logging
import uuid
from pathlib import PurePosixPath
from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile
from app.core.config import settings
from app.services.object_storage import object_key
from app.repositories.manual_feedback import check_upload, add_feedback_file, remove_feedback_file, save_feedback, feedback_download
from pydantic import BaseModel, ConfigDict, Field

from app.repositories.flow_roster import RosterAccessError
from app.repositories.manual_reviews import (
    ManualReviewConflict, approve_manual_review, get_manual_review, list_manual_reviews,
)
from app.services.object_storage import ObjectStorageError, ObjectStorageNotConfigured, get_object_storage
from app.services.security import get_current_teacher, get_current_runtime_student

logger = logging.getLogger(__name__)
router = APIRouter()


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    evidenceHash: str = Field(min_length=64, max_length=64)
    remark: str = Field(default='', max_length=1000)
    feedbackRevision: int = Field(ge=0)


@router.get('/versions/{version_id}/nodes/{node_key}/manual-reviews')
def queue(version_id: str, node_key: str, teacher=Depends(get_current_teacher)):
    try:
        return list_manual_reviews(version_id, node_key, int(teacher['id']))
    except KeyError as exc:
        raise HTTPException(404, '流程节点不存在或预览已失效') from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/node-instances/{node_instance_id}/manual-review')
def detail(node_instance_id: str, teacher=Depends(get_current_teacher)):
    try:
        result = get_manual_review(node_instance_id, int(teacher['id']))
        for source in result['sources']:
            for file in source['files']:
                storage_key = file.pop('storage_key')
                file['url'] = get_object_storage().signed_download_url(storage_key, file['original_name'])
        return result
    except KeyError as exc:
        raise HTTPException(404, '审核节点不存在或预览已失效') from exc
    except RosterAccessError as exc:
        raise HTTPException(403, str(exc)) from exc
    except (ObjectStorageError, ObjectStorageNotConfigured) as exc:
        raise HTTPException(503, '材料下载链接生成失败，请稍后重试') from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class SourceApprovalRequest(ApprovalRequest):
    sourceNodeKey: str | None = None
    sourceRemark: str = Field(default='', max_length=1000)


@router.post('/node-instances/{node_instance_id}/manual-review/approve')
def approve(node_instance_id: str, payload: SourceApprovalRequest, teacher=Depends(get_current_teacher)):
    try:
        approved = approve_manual_review(node_instance_id, int(teacher['id']), payload.evidenceHash, payload.remark, payload.feedbackRevision, payload.sourceNodeKey, payload.sourceRemark)
        return {'approved': approved}
    except KeyError as exc:
        raise HTTPException(404, '审核节点不存在或预览已失效') from exc
    except RosterAccessError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ManualReviewConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def feedback_error(exc):
    if isinstance(exc, KeyError):
        return HTTPException(404, '批改文件或审核节点不存在')
    if isinstance(exc, RosterAccessError):
        return HTTPException(403, str(exc))
    if isinstance(exc, ManualReviewConflict):
        return HTTPException(409, str(exc))
    if isinstance(exc, (ObjectStorageError, ObjectStorageNotConfigured)):
        return HTTPException(503, '文件存储暂时不可用，请稍后重试')
    return HTTPException(422, str(exc))


@router.post('/node-instances/{node_instance_id}/manual-review/feedback')
def publish(node_instance_id: str, payload: ApprovalRequest, teacher=Depends(get_current_teacher)):
    try:
        save_feedback(node_instance_id, int(teacher['id']), payload.evidenceHash, payload.feedbackRevision, payload.remark)
        return {'saved': True}
    except (KeyError, ValueError, RosterAccessError) as exc:
        raise feedback_error(exc) from exc


@router.post('/node-instances/{node_instance_id}/manual-review/files')
def upload_feedback(node_instance_id: str, evidenceHash: str = Form(..., min_length=64, max_length=64), revision: int = Form(..., ge=0),
                    sourceFileId: str = Form(...), file: UploadFile = File(...), teacher=Depends(get_current_teacher)):
    teacher_id = int(teacher['id'])
    try:
        check_upload(node_instance_id, teacher_id, evidenceHash, revision, sourceFileId)
        filename = PurePosixPath((file.filename or '').replace('\\', '/')).name
        if not filename:
            raise ValueError('请选择批改文件')
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size <= 0 or size > 50 * 1024 * 1024:
            raise ValueError('批改文件须为非空文件，且不超过 50 MB')
        key = object_key(settings.oss_prefix, 'manual-feedback', node_instance_id, str(uuid.uuid4()), filename)
        storage = get_object_storage()
        storage.put_object(key, file.file, file.content_type or 'application/octet-stream')
        try:
            return add_feedback_file(node_instance_id, teacher_id, evidenceHash, revision, sourceFileId, filename, key, size)
        except Exception:
            try:
                storage.delete_object(key)
            except ObjectStorageError:
                logger.exception('Failed to clean up an unrecorded manual feedback upload')
            raise
    except (KeyError, ValueError, RosterAccessError, ObjectStorageError, ObjectStorageNotConfigured) as exc:
        raise feedback_error(exc) from exc


class RemoveRequest(BaseModel):
    evidenceHash: str
    revision: int = Field(ge=0)


@router.delete('/node-instances/{node_instance_id}/manual-review/files/{file_id}')
def remove_file(node_instance_id: str, file_id: str, payload: RemoveRequest, teacher=Depends(get_current_teacher)):
    try:
        return remove_feedback_file(node_instance_id, int(teacher['id']), payload.evidenceHash, payload.revision, file_id)
    except (KeyError, ValueError, RosterAccessError) as exc:
        raise feedback_error(exc) from exc


def download_result(file_id, **identity):
    try:
        file = feedback_download(file_id, **identity)
        return {'url': get_object_storage().signed_download_url(file['storage_key'], file['original_name'])}
    except (KeyError, ValueError, RosterAccessError, ObjectStorageError, ObjectStorageNotConfigured) as exc:
        raise feedback_error(exc) from exc


@router.get('/manual-feedback/files/{file_id}/download')
def teacher_download(file_id: str, teacher=Depends(get_current_teacher)):
    return download_result(file_id, teacher_id=int(teacher['id']))


@router.get('/manual-feedback/files/{file_id}/student-download')
def student_download(file_id: str, student=Depends(get_current_runtime_student)):
    return download_result(file_id, student_id=int(student['id']))
