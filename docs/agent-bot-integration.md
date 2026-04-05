# WhatsApp Agent Bot Integration

This repo now includes a Python agent service at `agent_service/` using:
- FastAPI
- LangChain + Gemini (`langchain-google-genai`)
- WhatsApp Cloud API
- PostgreSQL
- Redis

## What Was Added

- Python service endpoints:
  - `GET /health`
  - `GET /webhook/whatsapp` (Meta webhook verification)
  - `POST /webhook/whatsapp` (inbound WhatsApp handling)
  - `POST /events/visit-completed` (auto-schedule trigger)
- Auto-scheduling flow:
  - Saves visit completion event
  - Resolves next-visit rule
  - Creates a hold slot (2-hour expiry)
  - Sends WhatsApp confirmation prompt
  - Confirms/changes slot from patient replies
  - Creates final appointment in `appointments`
- Next.js linkage:
  - `PATCH /api/scheduling/appointments/:id` added
  - When status becomes `completed`, Next.js emits `VISIT_COMPLETED` to the Python service
  - When the clinical workflow is completed from the `pharmacy` stage for a chronic-care patient, Next.js also emits `VISIT_COMPLETED` after medication collection unless staff already created a manual next visit
  - Manual relay endpoint added at `POST /api/agent/events/visit-completed`

## API Contracts Needed From The Clinical App

These are the APIs your hospital app should expose/stabilize for production-grade behavior.

1. `PATCH /api/scheduling/appointments/:id`
- Purpose: update visit status (`completed` triggers auto-schedule)
- Request: `{ "status": "completed" }`
- Response: updated appointment

2. `GET /api/patients/:id`
- Purpose: patient context (program code, condition, contact)
- Needed fields: `id`, `phone`, `conditionSummary`, `lastVisit`, `nextAppointment`

3. `GET /api/patients/:id/appointments`
- Purpose: history and collision checks for scheduling

4. `POST /api/agent/events/visit-completed`
- Purpose: manual/ops trigger into the agent service
- Request:
  - `patient_id`
  - `visit_id`
  - `clinic_id`
  - `program_code`
  - `service_type`
  - `completion_time`

## Environment Variables Needed

Add these to `.env`:

- `BACKEND_STORE=postgres`
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/clinical_app`
- `REDIS_URL=redis://localhost:6379/0`
- `AGENT_SERVICE_URL=http://localhost:8010`
- `AGENT_SERVICE_TOKEN=change-me`
- `INTERNAL_API_TOKEN=change-me` (for Python service; should match `AGENT_SERVICE_TOKEN`)
- `GEMINI_API_KEY=...`
- `WHATSAPP_TOKEN=...`
- `WHATSAPP_PHONE_NUMBER_ID=...`
- `WHATSAPP_VERIFY_TOKEN=...`

## Run

1. Start services:

```bash
docker compose -f docker-compose.agent.yml up --build
```

2. Start Next.js app (separate terminal):

```bash
npm run dev
```

3. Complete a visit by calling:

```bash
PATCH /api/scheduling/appointments/:id
{ "status": "completed" }
```

That automatically posts to `agent_service /events/visit-completed`, creates a proposed next slot, and sends WhatsApp confirmation.
