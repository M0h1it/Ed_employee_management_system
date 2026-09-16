"""
app/api/v1/health.py

Liveness and readiness.

TWO ENDPOINTS, NOT ONE
-----------------------
/health says the process is running. /health/db says it can actually reach the
database. They fail for different reasons and lead to different actions: a dead
process needs restarting, a reachable process with an unreachable database does
not — restarting it will not help, and an orchestrator that conflates the two
will restart-loop a perfectly healthy API because Postgres is briefly down.
"""

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Is the process alive. Touches nothing external."""
    return {"status": "ok", "app": settings.APP_NAME, "env": settings.ENV}


@router.get("/health/db")
async def health_db(session: AsyncSession = Depends(get_session)):
    """Can the process reach the database, and is pgvector installed."""
    try:
        version = (await session.execute(text("SELECT version()"))).scalar_one()
        has_vector = (
            await session.execute(
                text("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')")
            )
        ).scalar_one()

        return {
            "status": "ok",
            "postgres": version.split(",")[0],
            "pgvector": bool(has_vector),
        }
    except Exception as exc:
        # 503, not 500: the API is fine, its dependency is not. A load balancer
        # should stop sending traffic here, not conclude the code is broken.
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "error", "detail": str(exc)},
        )
