"""
app/core/errors.py

Every error response leaves this application in exactly one shape:

    { "error": { "code": "...", "message": "...", "fields": { ... } } }

WHY HANDLERS AND NOT JUST CAREFUL ROUTES
-----------------------------------------
FastAPI wraps an HTTPException's detail in `{"detail": ...}`, and Pydantic's
validation errors come out in a third shape entirely — a list of objects with
`loc`, `msg` and `type`. So without these handlers the frontend would face
three different error formats and would need three code paths to read them.

The frontend's contract has said `{ error: { code, message, fields } }` since
Phase 1. The backend matches the contract; the contract does not bend to
whatever the framework happens to emit.
"""

from fastapi import FastAPI, Request, status
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse

from app.core.config import settings


def _body(code: str, message: str, fields: dict[str, str] | None = None) -> dict:
    error: dict = {"code": code, "message": message}
    if fields:
        error["fields"] = fields
    return {"error": error}


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """
    Routes raise HTTPException with detail already in the right shape:

        raise HTTPException(404, detail={"error": {...}})

    This unwraps that so it is not double-nested under "detail", and gives a
    plain string detail a sensible envelope too.
    """
    detail = exc.detail

    if isinstance(detail, dict) and "error" in detail:
        content = detail
    else:
        content = _body(f"HTTP_{exc.status_code}", str(detail))

    return JSONResponse(status_code=exc.status_code, content=content,
                        headers=getattr(exc, "headers", None))


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    Turns Pydantic's list of errors into per-field messages the form can show
    next to the input that caused them.

    Pydantic reports the location as a tuple like ("body", "phone"). The first
    element says where it came from — body, query, path — and the rest is the
    path to the field. Taking the last element gives the field name the
    frontend knows it by.
    """
    fields: dict[str, str] = {}
    for error in exc.errors():
        location = error.get("loc", ())
        name = str(location[-1]) if location else "body"
        # First error per field wins. Three messages about one input is noise.
        fields.setdefault(name, error.get("msg", "Invalid value"))

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=_body("VALIDATION_FAILED", "Please fix the highlighted fields.", fields),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    The last resort.

    In production the message is deliberately generic. A stack trace or a raw
    database error in an HTTP response tells an attacker the framework, the
    schema and often a table name — and tells the user nothing they can act on.
    In development it shows the real error, because there it is the fastest way
    to a fix.
    """
    if settings.DEBUG:
        message = f"{type(exc).__name__}: {exc}"
    else:
        message = "Something went wrong. Please try again."

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=_body("INTERNAL_ERROR", message),
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
