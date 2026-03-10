# Clinical Application

Clinical operations platform built with Next.js 15 and React 19. The repository includes:

- A web dashboard for patient management, scheduling, risk scoring, compliance, workflows, and user administration
- Next.js route handlers for authentication and clinical backend APIs
- An optional Python FastAPI `agent_service` for WhatsApp reminders and visit-escalation workflows

## Overview

The main app uses App Router and ships with a local JSON-backed mode for quick development. It can also run against PostgreSQL by setting `BACKEND_STORE=postgres`.

Core areas exposed in the UI:

- Dashboard
- Patients
- Risk scoring
- AI agent
- Workflows
- Scheduling
- Analytics
- Compliance
- Users

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- Radix UI components
- Zod validation
- FastAPI for the agent service
- PostgreSQL or local JSON file storage

## Project Structure

```text
app/                 Next.js pages and API route handlers
components/          Dashboard shell and UI components
lib/backend/         Auth, storage, PostgreSQL, and domain logic
data/                Local JSON data files for development
docs/                Backend, schema, and integration documentation
agent_service/       FastAPI WhatsApp agent service
scripts/             Helper scripts, including PostgreSQL init
docker-compose.agent.yml
```

## Prerequisites

- Node.js 20+
- npm
- Python 3.11+ if you want to run `agent_service`
- PostgreSQL with `psql` available on `PATH` if you want PostgreSQL mode

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the Next.js app

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

### 3. Sign in

On first run, the auth store seeds a default clinic admin account:

- Email: `admin@clinic.local`
- Password: `Admin123!`

You can override the seed values with environment variables before first startup:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

## Environment Variables

### Common

```bash
AUTH_SESSION_SECRET=replace-me
ALLOW_HEADER_AUTH=false
ADMIN_EMAIL=admin@clinic.local
ADMIN_PASSWORD=Admin123!
ADMIN_NAME=Clinic Admin
```

### Storage Mode

Default local mode:

```bash
BACKEND_STORE=json
```

PostgreSQL mode:

```bash
BACKEND_STORE=postgres
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

You can also configure PostgreSQL with:

```bash
DB_HOST=localhost
DB_USER=postgres
DB_NAME=clinical_app
PGPASSWORD=your-password
```

## Local Data Mode

If `BACKEND_STORE` is not set, the app uses JSON files in [`data/`](C:/Users/Tebogo%20Dipale/clinical-application/data):

- `data/auth-db.json`
- `data/clinical-db.json`

This mode is intended for quick local development and seeds sample users and patient records automatically.

## PostgreSQL Mode

Initialize the PostgreSQL schema:

```bash
./scripts/init-postgres.sh
```

When `BACKEND_STORE=postgres`:

- Route handlers use PostgreSQL instead of local JSON files
- Minimal operational tables are created automatically when needed
- Seed patient data is inserted if the database is empty

Additional schema and backend details are documented in:

- [`docs/postgres-backend.md`](C:/Users/Tebogo%20Dipale/clinical-application/docs/postgres-backend.md)
- [`docs/clinical-schema.sql`](C:/Users/Tebogo%20Dipale/clinical-application/docs/clinical-schema.sql)

## Agent Service

The optional agent service handles WhatsApp reminder workflows and escalation logic.

Run it locally:

```bash
cd agent_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

Key endpoints:

- `GET /health`
- `GET /webhook/whatsapp`
- `POST /webhook/whatsapp`
- `POST /events/visit-completed`
- `POST /events/appointment-scheduled`
- `POST /jobs/visit-reminders`

Reminder workflow supports acknowledgement and escalation stages, including follow-up reminders, call triggers, and nurse alerts.

More detail:

- [`agent_service/README.md`](C:/Users/Tebogo%20Dipale/clinical-application/agent_service/README.md)
- [`docs/agent-bot-integration.md`](C:/Users/Tebogo%20Dipale/clinical-application/docs/agent-bot-integration.md)

## API Summary

The application exposes route handlers under `app/api/` for:

- Authentication and session management
- Patient CRUD
- Appointment scheduling and scheduling stats
- Risk scoring
- Clinical flow progression
- Compliance overview
- Agent event ingestion
- User management with role-based access control

Primary documentation:

- [`docs/backend-api.md`](C:/Users/Tebogo%20Dipale/clinical-application/docs/backend-api.md)

## Authentication and Roles

Protected APIs use the `clinical_session` cookie. Supported roles:

- `participant`
- `clinic_admin`
- `clinical_staff`
- `lab_pharmacy`

For local testing only, header-based auth can be enabled with:

```bash
ALLOW_HEADER_AUTH=true
```

Headers:

- `x-user-role`
- `x-user-id`

## Available Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
```

## Notes

- The repo currently contains both `package-lock.json` and `pnpm-lock.yaml`; the checked-in dependencies also support `npm install`.
- `.next/` and generated cache files are local build artifacts and should not be treated as source.
