"""
app/core/db.py

The database engine, the session factory, and the dependency that hands a
session to a route.

ONE SESSION PER REQUEST, ALWAYS
--------------------------------
`get_session` opens a session, yields it to the route, and closes it when the
response is done. Sharing a session across requests would leak one request's
uncommitted state into another; opening several inside one request would mean
its own writes are invisible to itself.

`expire_on_commit=False` matters in async code: with the default, touching any
attribute after a commit triggers a lazy reload, which in an async session
raises rather than silently querying. Turning it off keeps objects usable after
the commit that saved them.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    """Every model inherits from this. Alembic reads Base.metadata to
    autogenerate migrations, so a model that does not inherit from it is
    invisible to migrations — and the table silently never gets created."""


engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,  # logs every statement in dev; noisy but worth it
    pool_pre_ping=True,   # checks a pooled connection is alive before reuse,
                          # which avoids the stale-connection errors you get
                          # after the database restarts or a container sleeps
    pool_size=5,
    max_overflow=10,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency. Used as: `session: AsyncSession = Depends(get_session)`"""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            # An unhandled error must not leave a half-finished transaction
            # holding locks for the rest of the connection's life.
            await session.rollback()
            raise
