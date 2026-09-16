"""
app/schemas/common.py

The response envelopes — the exact shapes the Phase 1 frontend already expects.

contracts/types.ts has had `Paginated<T>`, `Single<T>` and `ApiError` in it for
weeks. Matching them here is what makes the cutover a deleted line in main.tsx
rather than a rewrite of every table and every error handler.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class PageMeta(BaseModel):
    page: int
    pageSize: int
    total: int
    totalPages: int


class Paginated(BaseModel, Generic[T]):
    """
    Every list endpoint returns this, including ones with twelve rows today.
    A UI built against a bare array has to be rewritten the day pagination
    arrives — every table, every filter, every query hook.
    """
    data: list[T]
    meta: PageMeta


class Single(BaseModel, Generic[T]):
    data: T


class ErrorBody(BaseModel):
    code: str
    message: str
    # Per-field messages, so a form can put the error next to the input that
    # caused it rather than showing one banner for everything.
    fields: dict[str, str] | None = None


class ApiError(BaseModel):
    error: ErrorBody


def page_meta(*, page: int, page_size: int, total: int) -> PageMeta:
    return PageMeta(
        page=page,
        pageSize=page_size,
        total=total,
        totalPages=max(1, (total + page_size - 1) // page_size),
    )
