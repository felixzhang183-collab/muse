from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env lives in the project root (one level above backend/)
_ENV_FILE = Path(__file__).parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    # App
    environment: str = "development"
    secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Database
    database_url: str = "postgresql://musicapp:musicapp@localhost:5432/musicapp"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Qdrant
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333

    # Storage (R2 / MinIO)
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_bucket_name: str = "musicapp"
    s3_public_url: str = ""  # if set, used for public URLs; otherwise presigned

    # AI APIs
    openai_api_key: str = ""
    anthropic_api_key: str = ""

    # Scraping
    apify_api_token: str = ""

    # Artist
    artist_name: str = "Artist"

    # TikTok
    tiktok_client_key: str = ""
    tiktok_client_secret: str = ""
    tiktok_redirect_uri: str = "http://localhost:8000/tiktok/callback"

    # CORS — comma-separated list of allowed origins
    cors_allowed_origins: str = "http://localhost:3000,http://localhost:3001"


settings = Settings()
