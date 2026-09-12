from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.repositories.flow_roster import RosterAccessError
from app.repositories.manual_reviews import (
    ManualReviewConflict, approve_manual_review, get_manual_review, list_manual_reviews,
)
from app.services.object_storage import ObjectStorageError, ObjectStorageNotConfigured, get_object_storage
from app.services.security import get_current_teacher

router = APIRouter()


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    evidenceHash: str = Field(min_length=64, max_length=64)
    remark: str = Field(default='', max_length=1000)


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


@router.post('/node-instances/{node_instance_id}/manual-review/approve')
def approve(node_instance_id: str, payload: ApprovalRequest, teacher=Depends(get_current_teacher)):
    try:
        approve_manual_review(node_instance_id, int(teacher['id']), payload.evidenceHash, payload.remark)
        return {'approved': True}
    except KeyError as exc:
        raise HTTPException(404, '审核节点不存在或预览已失效') from exc
    except RosterAccessError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ManualReviewConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
