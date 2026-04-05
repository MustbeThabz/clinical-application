# Clinical Application

Clinical Application is a clinic operations platform for research and chronic-care teams. It combines a Next.js dashboard, server-side API routes, role-aware workflows, and an optional Python agent service for WhatsApp messaging, reminder escalation, and next-visit automation.

The app is designed around the day-to-day reality of clinical sites: long queues, handoffs between multiple staff roles, missed follow-ups, and the need to keep patient flow visible from intake through medication collection.

## What the app does

The web application supports:

- patient registration and profile management
- appointment scheduling and day-level schedule views
- clinical workflow progression across reception, research, nursing, doctor, lab, and pharmacy stages
- risk scoring based on adherence, missed visits, alerts, and manual status
- care tasks and operational alerts
- compliance and safety oversight
- analytics and dashboard summaries
- user administration and role-based access control

The optional `agent_service` adds:

- WhatsApp appointment notifications
- patient confirmation flows
- reminder escalation stages
- call and home-visit escalation hooks
- automated next-visit scheduling after a completed visit

## Architecture at a glance

### Frontend and API

- `app/`: Next.js App Router pages and route handlers
- `components/`: dashboard shell, feature views, shared UI
- `lib/backend/`: auth, storage adapters, user management, domain logic
- `lib/clinical-flow.ts`: workflow summaries, stage behavior, chronic-care logic

### Storage

The main app supports two runtime storage modes:

- `json` mode for quick local development
- `postgres` mode for production-style persistence

JSON mode reads and writes local files under `data/`.

PostgreSQL mode uses `psql` or Docker-backed `psql` execution through [`lib/backend/postgres.ts`](/home/tebogo_dipale/clinical-application/lib/backend/postgres.ts).

### Optional agent service

- `agent_service/`: FastAPI service for WhatsApp and reminder workflows
- `docker-compose.agent.yml`: local PostgreSQL, Redis, and agent service stack
- `scripts/start-whatsapp-stack.sh`: convenience launcher for the agent stack

## Core workflow model

Clinical flow records move through these stages:

1. `request`
2. `ra`
3. `admin`
4. `nurse`
5. `doctor`
6. `lab`
7. `pharmacy`

The allowed handling roles are enforced in code, and the UI only exposes tabs a user can access. Completing a flow can also:

- complete the linked appointment
- create or close related care tasks
- assign the next stage owner
- create a follow-up appointment when requested
- emit events to the Python agent service when the integration is enabled

## Tech stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- Radix UI
- Zod
- FastAPI
- PostgreSQL
- Redis
- WhatsApp Cloud API

## Repository structure

```text
app/                    Next.js pages and API route handlers
components/             Dashboard shell, views, and UI primitives
lib/                    Shared utilities, backend logic, workflow rules
docs/                   Backend/API/schema/integration notes
data/                   Local JSON data stores created in dev mode
agent_service/          Optional FastAPI WhatsApp/reminder service
scripts/                Local setup and helper scripts
docker-compose.agent.yml
README.md
```

## Roles

The application currently recognizes these roles:

- `participant`
- `clinic_admin`
- `receptionist_admin`
- `research_assistant`
- `nurse`
- `doctor`
- `lab_personnel`
- `pharmacist`

`clinic_admin` has the widest access, including user management. Other roles see a reduced tab set and can only act on allowed workflow stages.

## Prerequisites

For the main Next.js app:

- Node.js 20 or later
- npm

For PostgreSQL mode:

- PostgreSQL and `psql`, or Docker if you want to run the provided containers

For the optional agent service:

- Python 3.11+
- Docker if you want to use the bundled local stack

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Create a local environment file

Create `.env.local` for the Next.js app, or export the variables in your shell:

```bash
AUTH_SESSION_SECRET=replace-me
BACKEND_STORE=json
ALLOW_HEADER_AUTH=false
ADMIN_EMAIL=admin@clinic.local
ADMIN_PASSWORD=Admin123!
ADMIN_NAME=Clinic Admin
```

### 3. Start the app

```bash
npm run dev
```

The app listens on `http://localhost:3000`.

### 4. Sign in

On first run, the auth store seeds a default admin user:

- email: `admin@clinic.local`
- password: `Admin123!`

You can override the seeded admin credentials with:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

## Storage modes

### JSON mode

Use this for fast local development:

```bash
BACKEND_STORE=json
```

Behavior:

- data is stored in local JSON files under `data/`
- sample data is seeded automatically when no data exists
- no database setup is required

This is the easiest way to explore the UI and route handlers locally.

### PostgreSQL mode

Use this when you want a more production-like backend:

```bash
BACKEND_STORE=postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/clinical_app
AUTH_SESSION_SECRET=replace-me
```

You can also configure PostgreSQL with split variables instead of `DATABASE_URL`:

```bash
DB_HOST=localhost
DB_USER=postgres
DB_NAME=clinical_app
PGPASSWORD=postgres
```

Initialize the schema:

```bash
./scripts/init-postgres.sh
```

Notes:

- the script requires `DATABASE_URL`
- some runtime tables are also created lazily by the app when needed
- if `psql` is not available on your host, the backend can fall back to Docker-backed `psql`

Relevant settings for Docker-backed SQL execution:

- `POSTGRES_PSQL_MODE=docker`
- `POSTGRES_DOCKER_COMPOSE_FILE=docker-compose.agent.yml`
- `POSTGRES_DOCKER_SERVICE=postgres`
- `POSTGRES_DOCKER_DB=clinical_app`
- `POSTGRES_DOCKER_USER=postgres`

## Environment variables

### Main app

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_SESSION_SECRET` | Recommended | Signs the `clinical_session` cookie. Falls back to a local dev secret if omitted. |
| `BACKEND_STORE` | No | `json` or `postgres`. Defaults to JSON-backed development behavior when unset. |
| `DATABASE_URL` | PostgreSQL mode | Connection string used by setup scripts and SQL execution. |
| `DB_HOST` | Optional | PostgreSQL host when not using `DATABASE_URL`. |
| `DB_USER` | Optional | PostgreSQL user when not using `DATABASE_URL`. |
| `DB_NAME` | Optional | PostgreSQL database name when not using `DATABASE_URL`. |
| `PGPASSWORD` | Optional | Password used by `psql`. |
| `ALLOW_HEADER_AUTH` | Optional | Enables dev-only header auth for local API testing. Ignored in production. |
| `ADMIN_EMAIL` | Optional | Seed admin email for first startup. |
| `ADMIN_PASSWORD` | Optional | Seed admin password for first startup. |
| `ADMIN_NAME` | Optional | Seed admin display name for first startup. |
| `AGENT_SERVICE_URL` | Optional | Base URL for the Python agent service. Enables event forwarding and webhook proxying when set. |
| `AGENT_SERVICE_TOKEN` | Optional | Shared internal token used when the Next.js app posts to the agent service. |
| `POSTGRES_PSQL_MODE` | Optional | Set to `docker` to run SQL commands through Docker Compose instead of local `psql`. |
| `POSTGRES_DOCKER_COMPOSE_FILE` | Optional | Compose file used for Docker-backed `psql`. |
| `POSTGRES_DOCKER_SERVICE` | Optional | Compose service name for PostgreSQL. |
| `POSTGRES_DOCKER_DB` | Optional | Database name for Docker-backed `psql`. |
| `POSTGRES_DOCKER_USER` | Optional | Database user for Docker-backed `psql`. |

### Agent service

The FastAPI service loads settings from `.env`:

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_ENV` | No | Agent runtime environment label. |
| `APP_PORT` | No | Agent service port. Defaults to `8010`. |
| `DATABASE_URL` | Yes | PostgreSQL database for agent persistence. |
| `REDIS_URL` | Yes | Redis store for message/session coordination. |
| `INTERNAL_API_TOKEN` | Yes | Token expected on internal event and job endpoints. Should match the app-side token. |
| `GEMINI_API_KEY` | Optional | Used by the LLM intent classifier. |
| `WHATSAPP_TOKEN` | Optional | Meta WhatsApp Cloud API token. |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional | WhatsApp sender phone number ID. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Optional | WhatsApp business account ID. |
| `WHATSAPP_VERIFY_TOKEN` | Optional | Used for webhook verification. |
| `CLINIC_TIMEZONE` | No | Clinic timezone. Defaults to `Africa/Johannesburg`. |
| `WHATSAPP_CLINIC_NAME` | No | Signoff label in outbound WhatsApp messages. |
| `REMINDER_ACK_WAIT_HOURS_STAGE1` | No | Delay before the second reminder step. |
| `REMINDER_ACK_WAIT_HOURS_STAGE2` | No | Delay before the third reminder step. |
| `REMINDER_ACK_WAIT_HOURS_AFTER_CALL` | No | Delay after patient call escalation. |
| `REMINDER_ACK_WAIT_HOURS_AFTER_NEXT_OF_KIN` | No | Delay after next-of-kin escalation. |
| `REMINDER_DAY_OF_HOURS_BEFORE` | No | Hours before the visit to send the day-of reminder. |
| `NURSE_ALERT_PHONE` | Optional | Staff escalation contact. |
| `HOMEBASE_ALERT_PHONE` | Optional | Home-based care escalation contact. |

## Authentication

The main app uses an HTTP-only cookie named `clinical_session`.

Primary auth endpoints:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

In non-production development, `POST /api/auth/forgot-password` returns the generated reset token in the JSON response when a matching user exists. That makes local password-reset testing simpler without wiring email delivery first.

### Header-based auth for local API testing

For local development only, you can enable header auth:

```bash
ALLOW_HEADER_AUTH=true
```

Accepted headers:

- `x-user-role`
- `x-user-id`
- `x-user-email`

This path is intentionally disabled in production.

## Main API areas

The app exposes route handlers under `app/api/` for:

- authentication and session management
- dashboard and analytics summaries
- patients, appointments, alerts, tasks, and users
- risk scoring and recalculation
- clinical workflow progression, escalation, and ownership
- compliance overviews and workflow escalations
- AI agent activity and inbox endpoints
- WhatsApp webhook proxying to the optional agent service

Detailed endpoint notes live in [`docs/backend-api.md`](/home/tebogo_dipale/clinical-application/docs/backend-api.md).

## Agent integration flow

When `AGENT_SERVICE_URL` and matching internal tokens are configured:

- completing an appointment through [`app/api/scheduling/appointments/[id]/route.ts`](/home/tebogo_dipale/clinical-application/app/api/scheduling/appointments/[id]/route.ts) emits `visit-completed`
- completing a chronic-care workflow without a manual next visit can also emit `visit-completed`
- creating a follow-up appointment from a workflow completion emits `appointment-scheduled`
- [`app/api/webhooks/whatsapp/route.ts`](/home/tebogo_dipale/clinical-application/app/api/webhooks/whatsapp/route.ts) forwards inbound and verification traffic to the Python service

This lets the web app remain the operational system of record while the FastAPI service handles messaging and reminder logic.

## Running the agent stack locally

### Option 1: Docker Compose

```bash
docker compose -f docker-compose.agent.yml up --build
```

This starts:

- PostgreSQL on `localhost:5433`
- Redis
- the FastAPI agent service on `localhost:8010`

### Option 2: Helper script

```bash
./scripts/start-whatsapp-stack.sh
```

This script:

- builds the agent image
- starts PostgreSQL and Redis containers if needed
- starts the agent service container
- waits for database and health checks to pass

### Option 3: Run the agent service directly

```bash
cd agent_service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

Useful agent endpoints:

- `GET /health`
- `GET /webhook/whatsapp`
- `POST /webhook/whatsapp`
- `POST /events/visit-completed`
- `POST /events/appointment-scheduled`
- `POST /events/reminder-call-confirmed`
- `POST /jobs/visit-reminders`

## Available scripts

Top-level package scripts:

```bash
npm run dev
npm run dev:localhost
npm run build
npm run start
npm run lint
```

Helper scripts:

```bash
./scripts/init-postgres.sh
./scripts/start-whatsapp-stack.sh
./scripts/start-ngrok.sh
```

## Documentation map

- [`docs/backend-api.md`](/home/tebogo_dipale/clinical-application/docs/backend-api.md): route handler and RBAC notes
- [`docs/postgres-backend.md`](/home/tebogo_dipale/clinical-application/docs/postgres-backend.md): PostgreSQL mode setup
- [`docs/clinical-schema.sql`](/home/tebogo_dipale/clinical-application/docs/clinical-schema.sql): SQL schema
- [`docs/agent-bot-integration.md`](/home/tebogo_dipale/clinical-application/docs/agent-bot-integration.md): WhatsApp and event integration details
- [`agent_service/README.md`](/home/tebogo_dipale/clinical-application/agent_service/README.md): agent-service-specific notes

## Development notes

- The repo currently contains both `package-lock.json` and `pnpm-lock.yaml`. The checked-in setup works with `npm install`, and that is the simplest path for most contributors.
- The working tree may generate local runtime artifacts such as cached Python files or JSON-backed seed data during development.
- The current package manifest exposes a `lint` script, but there is no formal test suite configured at the top level yet.

## Suggested first local path

If you are new to the project, the smoothest way to get oriented is:

1. run the app in `BACKEND_STORE=json` mode
2. sign in with the seeded clinic admin account
3. walk through Patients, Workflows, Tasks, Scheduling, and Compliance
4. switch to PostgreSQL mode once you need persistent shared data
5. add the agent stack only when you are ready to test WhatsApp or reminder automation
