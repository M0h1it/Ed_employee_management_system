"""
app/api/v1/router.py

Collects every v1 router into one, so main.py includes a single object and new
feature routers are added in exactly one place.
"""

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    audit,
    attendance,
    auth,
    corrections,
    dashboard,
    devices,
    employees,
    export,
    face,
    health,
    leave,
    org,
    photos,
    settings,
    tasks,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(org.router)
api_router.include_router(employees.router)
api_router.include_router(attendance.router)
api_router.include_router(tasks.router)
api_router.include_router(admin.router)
api_router.include_router(audit.router)
api_router.include_router(dashboard.router)
api_router.include_router(settings.router)
api_router.include_router(leave.router)
api_router.include_router(corrections.router)
api_router.include_router(photos.router)
api_router.include_router(export.router)
api_router.include_router(devices.router)
api_router.include_router(face.router)