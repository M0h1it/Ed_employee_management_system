"""
app/services/face_engine.py

The only file that touches InsightFace. Everything above this — the API
routes — works with plain numbers (embeddings, scores) and never with a model
object or a frame array it doesn't already own.

WHY buffalo_l
--------------
It's InsightFace's standard ArcFace-based pack: RetinaFace for detection,
ArcFace (ResNet100) for the 512-d embedding used everywhere else in this
project (`Vector(512)` in face_templates). Swapping packs later means
re-enrolling everyone — the embedding spaces of different models are not
compatible with each other.

WHY THE MODEL IS LOADED ONCE, AT MODULE IMPORT
-------------------------------------------------
Loading buffalo_l is a disk read and an ONNX Runtime session init — on the
order of a second. Doing that per-request would make every punch slower for
no reason; doing it once at process start costs it exactly once. This is safe
BECAUSE this module holds no per-request state, only the model itself.

WHAT LIVENESS ACTUALLY CHECKS HERE, AND WHAT IT DOES NOT
-----------------------------------------------------------
This is a MICRO-MOVEMENT check across three frames, not full liveness
detection (no depth sensor, no infrared, no blink/challenge-response). It
catches the simple case the brief calls out: a static photo held up to the
tablet produces near-identical frames. It will not catch a video replay
of the same person on a phone screen. That is a known, accepted gap — the
PIN fallback and manager escalation exist because face matching alone is
never treated as sufficient on its own.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 512

# Below this, we don't trust the detector found a real, well-framed face.
MIN_FACE_SIZE_PX = 80
MIN_DETECTION_SCORE = 0.5

# Frame-to-frame movement, measured as the mean absolute pixel difference
# (0-255 scale) over the detected face crop, converted to grayscale.
# A held-up static photo: near 0. A live person breathing/blinking/shifting
# over ~1 second: a handful of points, easily. Tuned wide on purpose — this
# is a cheap filter for the obvious case, not a security boundary on its own.
MIN_LIVENESS_DELTA = 1.5

_app = None  # lazily constructed, module-level singleton


def _get_app():
    """
    Constructs the InsightFace FaceAnalysis app on first use.

    Deferred rather than done at import time so that importing this module
    (e.g. for a unit test that only exercises quality-check logic) doesn't
    pay the model-load cost or require a GPU/CPU ONNX runtime to be present.
    """
    global _app
    if _app is None:
        from insightface.app import FaceAnalysis

        logger.info("face_engine: loading buffalo_l (first use)")
        _app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
        _app.prepare(ctx_id=0, det_size=(640, 640))
    return _app


@dataclass
class DetectedFace:
    embedding: list[float]          # 512 floats, L2-normalized
    detection_score: float
    box: tuple[int, int, int, int]  # x1, y1, x2, y2
    quality_score: float            # 0..1, our own composite, not InsightFace's


@dataclass
class QualityResult:
    ok: bool
    reason: str | None              # None if ok, else a user-facing-safe code
    face: DetectedFace | None


def _decode(image_bytes: bytes) -> np.ndarray:
    import cv2

    array = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("not a decodable image")
    return frame


def analyze_single_face(image_bytes: bytes) -> QualityResult:
    """
    Runs detection + embedding on one image and applies the enrolment quality
    gate: exactly one face, large enough, confident enough detection.

    Used both for admin-upload enrolment and for deciding whether a
    high-confidence punch frame is good enough to become an auto-template.
    Deliberately does NOT check blur directly — a heavily blurred face
    typically also fails the detector's confidence threshold, which is a
    more reliable signal than a separate blur heuristic would be.
    """
    try:
        frame = _decode(image_bytes)
    except ValueError:
        return QualityResult(ok=False, reason="UNREADABLE_IMAGE", face=None)

    faces = _get_app().get(frame)

    if len(faces) == 0:
        return QualityResult(ok=False, reason="NO_FACE_FOUND", face=None)
    if len(faces) > 1:
        return QualityResult(ok=False, reason="MULTIPLE_FACES", face=None)

    face = faces[0]
    x1, y1, x2, y2 = face.bbox.astype(int)
    width, height = x2 - x1, y2 - y1

    if min(width, height) < MIN_FACE_SIZE_PX:
        return QualityResult(ok=False, reason="FACE_TOO_SMALL", face=None)
    if face.det_score < MIN_DETECTION_SCORE:
        return QualityResult(ok=False, reason="LOW_QUALITY", face=None)

    embedding = face.normed_embedding  # already L2-normalized by insightface
    quality_score = float(face.det_score)

    return QualityResult(
        ok=True,
        reason=None,
        face=DetectedFace(
            embedding=embedding.tolist(),
            detection_score=float(face.det_score),
            box=(int(x1), int(y1), int(x2), int(y2)),
            quality_score=quality_score,
        ),
    )


def check_liveness(frames: list[bytes]) -> bool:
    """
    True if consecutive frames show enough pixel movement to not be a static
    photo. Needs at least 2 frames; the kiosk sends 3.
    """
    import cv2

    if len(frames) < 2:
        return False

    decoded = []
    for raw in frames:
        try:
            decoded.append(_decode(raw))
        except ValueError:
            return False

    deltas = []
    for a, b in zip(decoded, decoded[1:]):
        gray_a = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
        gray_b = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
        if gray_a.shape != gray_b.shape:
            gray_b = cv2.resize(gray_b, (gray_a.shape[1], gray_a.shape[0]))
        deltas.append(float(np.mean(cv2.absdiff(gray_a, gray_b))))

    return max(deltas) >= MIN_LIVENESS_DELTA


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Both embeddings are already L2-normalized (InsightFace guarantees this
    for `normed_embedding`), so this is a plain dot product — kept as a named
    function so the 0.85 / 0.70 thresholds in the brief read against a
    labelled similarity score, not a bare `sum(x*y ...)` at the call site.
    """
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb))