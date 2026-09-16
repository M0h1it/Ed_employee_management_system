"""
app/main.py

The application object.

THE URL PREFIX IS NOT COSMETIC
-------------------------------
Everything mounts under /api/v1 because that is exactly what the Phase 1
frontend already calls. contracts/endpoints.ts has been pointing at these paths
for weeks; matching them here is what makes the cutover a single deleted line in
main.tsx rather than a rewrite.
"""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import api_router

# Application-level logging (app.* loggers — face-match diagnostics among
# them) has no explicit level anywhere, so it inherits the root logger's
# default WARNING and every logger.info() call in the codebase is silently
# dropped, no crash, nothing in the terminal. uvicorn's own request lines
# and SQLAlchemy's echo output use their own handlers/levels and were never
# affected by this, which is exactly why they kept appearing while
# diagnostic INFO logs from face.py did not — this one call is what makes
# app.* loggers actually reach the console at INFO and above.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
from app.core.config import settings
from app.core.db import engine
from app.core.errors import register_error_handlers


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown. Disposing the engine on shutdown returns pooled
    connections rather than leaving Postgres to time them out."""
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    # Swagger UI at /docs is the reason Postman is not needed yet — every
    # endpoint is callable from the browser with its real schema attached.
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/openapi.json",
)

# Every error leaves in one shape: { error: { code, message, fields } }.
# Registered before the routers so nothing can slip past.
register_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # Required for the refresh token, which will live in an httpOnly cookie.
    # Note that allow_credentials with a wildcard origin is rejected by browsers,
    # which is why CORS_ORIGINS lists exact origins rather than "*".
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")

# Uploaded photos, served straight from disk.
#
# Deliberately NOT under /api/v1: these are static files, not API resources, and
# they carry no Authorization header — an <img src> cannot send one. The URLs
# are unguessable (a UUID plus sixteen random hex characters) rather than
# access-controlled, which is the same trade every photo CDN makes.
#
# In production this directory is served by the web server or object storage,
# and this mount goes away.
from pathlib import Path as _Path

_UPLOADS = _Path("uploads")
_UPLOADS.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_UPLOADS)), name="uploads")


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"app": settings.APP_NAME, "docs": "/docs", "health": "/api/v1/health"}