# Agent Service

Python FastAPI service for WhatsApp agentic scheduling.

## Endpoints
- `GET /health`
- `GET /webhook/whatsapp`
- `POST /webhook/whatsapp`
- `POST /events/visit-completed`
- `POST /events/appointment-scheduled`
- `POST /jobs/visit-reminders` (internal token required)

## Visit Reminder Escalation
- Initial reminder is sent about 2 days before scheduled appointment.
- Patient must acknowledge by replying `YES` (or `OK`, `CONFIRM`).
- If no acknowledgement, the workflow escalates:
1. second reminder text
2. auto-call trigger task
3. nurse/home-base alert with patient location snapshot (coordinates when available)

## Reminder Environment Variables
- `REMINDER_ACK_WAIT_HOURS_STAGE1` (default `24`)
- `REMINDER_ACK_WAIT_HOURS_STAGE2` (default `12`)
- `REMINDER_ACK_WAIT_HOURS_AFTER_CALL` (default `6`)
- `NURSE_ALERT_PHONE` (optional WhatsApp number for escalation alerts)

## Local Run

```bash
cd agent_service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```
