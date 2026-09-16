"""
scripts/diagnose_face_match.py

Runs _best_match (app/api/v1/face.py) directly against the real database,
using the ALREADY-STORED embedding of the one enrolled employee as the
query vector. If this cannot find its own stored embedding as a near-perfect
match against itself, the bug is in the query/cast, not in camera capture,
lighting, or anything upstream of the database.

Run from attendance-server/:
    python scripts/diagnose_face_match.py
"""

import asyncio
import sys

sys.path.insert(0, ".")

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import FaceTemplate, Employee


async def main() -> None:
    async with SessionLocal() as session:
        # Step 1: read back a real, currently-stored template exactly as
        # the database has it — no re-encoding, no new photo, the actual
        # row psql already showed us exists.
        row = (await session.execute(
            select(FaceTemplate).where(FaceTemplate.is_active.is_(True)).limit(1)
        )).scalar_one_or_none()

        if row is None:
            print("No active face_templates row found via SQLAlchemy either — "
                  "this would mean SQLAlchemy is looking at a different "
                  "database/schema than psql was. Check DATABASE_URL.")
            return

        print(f"Found template id={row.id} employee_id={row.employee_id}")
        print(f"Embedding length: {len(row.embedding)} (expected 512)")
        print(f"Embedding type: {type(row.embedding)}")
        print(f"First 5 values: {row.embedding[:5]}")

        # Step 2: query using THIS SAME embedding as the search vector.
        # Querying a stored vector against itself must return similarity
        # very close to 1.0 (cosine similarity of identical vectors) — if
        # this comes back as 0.0 or empty, the bug is confirmed to be in
        # the query itself, not in matching a genuinely different face.
        from pgvector.sqlalchemy import Vector
        from sqlalchemy import cast

        query_embedding = list(row.embedding)
        vec = cast(query_embedding, Vector(512))

        stmt = (
            select(FaceTemplate, (1 - FaceTemplate.embedding.cosine_distance(vec)).label("similarity"))
            .where(FaceTemplate.is_active.is_(True))
            .order_by(FaceTemplate.embedding.cosine_distance(vec))
            .limit(1)
        )

        print("\nCompiled SQL:")
        print(str(stmt))

        result_row = (await session.execute(stmt)).first()

        if result_row is None:
            print("\n*** BUG CONFIRMED: query returned NO ROWS, even though "
                  "the table has an active row and we are using its own "
                  "embedding as the search vector. ***")
        else:
            template, similarity = result_row
            print(f"\nResult: template_id={template.id}, similarity={similarity}")
            if similarity > 0.99:
                print("This is correct — a vector matched against itself should be ~1.0.")
            elif similarity == 0.0 or similarity is None:
                print("*** BUG CONFIRMED: similarity came back as 0/None against itself. ***")
            else:
                print(f"Unexpected: similarity={similarity}, expected ~1.0 for self-match.")


if __name__ == "__main__":
    asyncio.run(main())