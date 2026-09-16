"""
app/schemas/org.py

Request shapes for organisation-level reference data (departments, and
eventually shifts, if shift creation is ever added the same way). Kept
separate from app/schemas/employee.py's DepartmentOut/ShiftOut, which are
response shapes reused across multiple endpoints — this file is only for
the request body of the one write endpoint org.py has.
"""

from pydantic import BaseModel, Field


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)