import uuid
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from app.config import settings

_client = None
_public_client = None


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name="auto",
        )
    return _client


def _get_public_client():
    """Client used only for presigned URL generation — uses the browser-accessible URL."""
    global _public_client
    if _public_client is None:
        public_url = settings.s3_public_url or settings.s3_endpoint_url
        _public_client = boto3.client(
            "s3",
            endpoint_url=public_url,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            region_name="auto",
        )
    return _public_client


def upload_file(file_bytes: bytes, original_filename: str, prefix: str = "songs") -> str:
    """Upload bytes to R2/MinIO. Returns the object key."""
    ext = Path(original_filename).suffix.lower()
    key = f"{prefix}/{uuid.uuid4()}{ext}"
    _get_client().put_object(
        Bucket=settings.s3_bucket_name,
        Key=key,
        Body=file_bytes,
        ContentType=_content_type(ext),
    )
    return key


def get_presigned_url(key: str, expires_in: int = 3600) -> str:
    """Generate a presigned GET URL valid for `expires_in` seconds."""
    return _get_public_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket_name, "Key": key},
        ExpiresIn=expires_in,
    )


def download_file(key: str) -> bytes:
    """Download object bytes from R2/MinIO."""
    response = _get_client().get_object(Bucket=settings.s3_bucket_name, Key=key)
    return response["Body"].read()


def delete_file(key: str) -> None:
    try:
        _get_client().delete_object(Bucket=settings.s3_bucket_name, Key=key)
    except ClientError:
        pass


def _content_type(ext: str) -> str:
    return {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".aiff": "audio/aiff",
        ".aif": "audio/aiff",
        ".flac": "audio/flac",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".mp4": "video/mp4",
    }.get(ext, "application/octet-stream")
