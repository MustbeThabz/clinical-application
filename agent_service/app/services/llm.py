from __future__ import annotations

from langchain_google_genai import ChatGoogleGenerativeAI

from app.config import settings


def classify_patient_intent(message: str) -> str:
    normalized = message.strip().lower()
    if normalized in {"1", "confirm", "yes"}:
        return "confirm"
    if normalized in {"2", "change", "reschedule", "move", "later", "another time"}:
        return "change"
    if normalized in {"book", "appointment", "schedule"}:
        return "book"

    if not settings.gemini_api_key:
        return "unknown"

    model = ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=settings.gemini_api_key, temperature=0)
    prompt = (
        "Classify this patient WhatsApp message into one label: "
        "confirm, change, book, unknown. Return only one word. Message: "
        f"{message}"
    )

    response = model.invoke(prompt)
    value = str(response.content).strip().lower()
    if value in {"confirm", "change", "book"}:
        return value
    return "unknown"
