from fastapi import APIRouter, HTTPException

from app.schemas.song import JobStatus
from app.services.redis_client import get_job_status

router = APIRouter()


@router.get("/{job_id}", response_model=JobStatus)
def get_job(job_id: str):
    data = get_job_status(job_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatus(**data)
