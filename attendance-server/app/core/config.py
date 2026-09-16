"""
app/core/config.py

Every setting the application reads, in one place, loaded from the environment.

WHY NOT HARD-CODE THE DATABASE URL
-----------------------------------
The URL differs on every machine — this one runs Postgres on 5433 because a
native install already holds 5432 — and in production it points somewhere else
entirely with a password that must never appear in git. Reading it from the
environment means the same code runs everywhere and no secret is ever committed.

pydantic-settings validates on startup, so a missing or malformed value fails
immediately with a clear message rather than surfacing as a confusing error on
the first request that happens to need it.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Application -------------------------------------------------------
    APP_NAME: str = "Attendance API"
    ENV: Literal["dev", "staging", "prod"] = "dev"
    DEBUG: bool = True

    # --- Locale ------------------------------------------------------------
    # The company's wall-clock timezone.
    #
    # WHY THIS SETTING EXISTS — a bug it fixes
    # -----------------------------------------
    # Postgres stores every timestamp in UTC, correctly. But a shift that runs
    # "09:00 to 18:00" means 09:00 LOCAL, and comparing a UTC timestamp against
    # a local clock time is off by the offset. In IST that is 5.5 hours, which
    # made every single employee look like they left early, every day.
    #
    # Punch instants stay in UTC. Only the comparison against shift rules is
    # done in local time, here.
    TIMEZONE: str = "Asia/Kolkata"

    # --- Database ----------------------------------------------------------
    # asyncpg, not psycopg2: the whole stack is async, and mixing a blocking
    # driver into an async app quietly serialises every request behind one
    # connection.
    DATABASE_URL: str

    # --- Auth --------------------------------------------------------------
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 15
    REFRESH_TOKEN_DAYS: int = 7

    # --- CORS --------------------------------------------------------------
    # The Vite dev server runs on a different origin from this API, so the
    # browser blocks the requests unless the server says otherwise. In
    # production the two are served from the same origin and this list shrinks.
    CORS_ORIGINS: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """
    Cached, so the .env file is parsed once rather than on every import.
    Call this instead of instantiating Settings directly.
    """
    return Settings()


settings = get_settings()
