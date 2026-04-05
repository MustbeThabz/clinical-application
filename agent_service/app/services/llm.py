from __future__ import annotations


def classify_patient_intent(message: str) -> str:
    normalized = message.strip().lower()
    if normalized in {"1", "confirm", "yes"}:
        return "confirm"
    if normalized in {"2", "change", "reschedule", "move", "later", "another time"}:
        return "change"
    if normalized in {"book", "appointment", "schedule"}:
        return "book"
    if "reschedule" in normalized or "different appointment time" in normalized:
        return "change"
    if "book appointment" in normalized or "request an available appointment slot" in normalized:
        return "book"
    if "view appointment" in normalized or "next appointment" in normalized:
        return "confirm"
    return "unknown"
