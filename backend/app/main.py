from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import aesthetics, analytics, auth, distributions, drafts, jobs, renders, section_templates, songs, tiktok, videos

app = FastAPI(
    title="AI Music Marketing Platform",
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(aesthetics.router, prefix="/aesthetics", tags=["aesthetics"])
app.include_router(songs.router, prefix="/songs", tags=["songs"])
app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(videos.router, prefix="/videos", tags=["videos"])
app.include_router(renders.router, prefix="/renders", tags=["renders"])
app.include_router(section_templates.router, prefix="/section-templates", tags=["section-templates"])
app.include_router(drafts.router, prefix="", tags=["drafts"])
app.include_router(tiktok.router, prefix="/tiktok", tags=["tiktok"])
app.include_router(distributions.router, prefix="", tags=["distributions"])
app.include_router(analytics.router, prefix="", tags=["analytics"])


@app.get("/health")
def health():
    return {"status": "ok"}
