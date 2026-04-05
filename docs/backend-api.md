# Clinical Backend API

Backend is implemented with Next.js Route Handlers.

Storage mode:
- JSON: `data/clinical-db.json`
- PostgreSQL: set `BACKEND_STORE=postgres`

## Authentication + RBAC

All protected APIs require a valid login session cookie (`clinical_session`) and are protected by role-based access control.

Roles:
- `participant`
- `clinic_admin`
- `receptionist_admin`
- `research_assistant`
- `nurse`
- `doctor`
- `lab_personnel`
- `pharmacist`

Auth APIs:
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

User management APIs:
- `GET /api/users` (admin only)
- `POST /api/users` (admin only)

Optional dev-only header auth can be enabled with `ALLOW_HEADER_AUTH=true` using:
- `x-user-role`
- `x-user-id` or `x-user-email`

Header auth is accepted only outside production and only when the referenced active user exists and matches the supplied role.

Clinical flow stage ownership:
- `request` -> `clinic_admin`, `receptionist_admin`
- `ra` -> `clinic_admin`, `research_assistant`
- `admin` -> `clinic_admin`, `receptionist_admin`
- `nurse` -> `clinic_admin`, `nurse`
- `doctor` -> `clinic_admin`, `doctor`
- `lab` -> `clinic_admin`, `lab_personnel`
- `pharmacy` -> `clinic_admin`, `pharmacist`

## Patient APIs

### `GET /api/patients`
Roles: `clinic_admin`, `receptionist_admin`, `research_assistant`, `nurse`, `doctor`, `lab_personnel`, `pharmacist`

Query params:
- `search`
- `status`

### `POST /api/patients`
Roles: `clinic_admin`, `receptionist_admin`

### `GET /api/patients/:id`
Roles: `clinic_admin`, `receptionist_admin`, `research_assistant`, `nurse`, `doctor`, `lab_personnel`, `pharmacist`

### `PATCH /api/patients/:id`
Roles: `clinic_admin`, `receptionist_admin`, `nurse`, `doctor`

### `GET /api/patients/:id/appointments`
Roles: `clinic_admin`, `receptionist_admin`, `research_assistant`, `nurse`, `doctor`, `lab_personnel`, `pharmacist`

### `GET /api/patients/:id/risk-scores`
Roles: `clinic_admin`, `research_assistant`, `nurse`, `doctor`

## Risk APIs

### `GET /api/risk-scoring`
Roles: `clinic_admin`, `research_assistant`, `nurse`, `doctor`

### `POST /api/risk-scoring/recalculate`
Roles: `clinic_admin`, `research_assistant`, `nurse`, `doctor`

## Scheduling APIs

### `GET /api/scheduling/appointments?date=YYYY-MM-DD`
Roles: `clinic_admin`, `receptionist_admin`, `research_assistant`, `nurse`, `doctor`, `lab_personnel`, `pharmacist`

### `POST /api/scheduling/appointments`
Roles: `clinic_admin`, `receptionist_admin`, `nurse`, `doctor`

### `PATCH /api/scheduling/appointments/:id`
Roles: `clinic_admin`, `receptionist_admin`, `nurse`, `doctor`

### `GET /api/scheduling/stats?date=YYYY-MM-DD`
Roles: `clinic_admin`, `receptionist_admin`, `research_assistant`, `nurse`, `doctor`, `lab_personnel`, `pharmacist`

## Agent Integration APIs

### `POST /api/agent/events/visit-completed`
Roles: `clinic_admin`, `nurse`, `doctor`

## Compliance APIs

### `GET /api/compliance/overview`
Roles: `clinic_admin`, `receptionist_admin`, `nurse`, `doctor`
