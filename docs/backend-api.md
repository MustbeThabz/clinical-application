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
- `clinical_staff`
- `lab_pharmacy`

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
- `x-user-id`

## Patient APIs

### `GET /api/patients`
Roles: `clinic_admin`, `clinical_staff`, `lab_pharmacy`

Query params:
- `search`
- `status`

### `POST /api/patients`
Roles: `clinic_admin`, `clinical_staff`

### `GET /api/patients/:id`
Roles: `clinic_admin`, `clinical_staff`, `lab_pharmacy`

### `PATCH /api/patients/:id`
Roles: `clinic_admin`, `clinical_staff`

### `GET /api/patients/:id/appointments`
Roles: `clinic_admin`, `clinical_staff`, `lab_pharmacy`

### `GET /api/patients/:id/risk-scores`
Roles: `clinic_admin`, `clinical_staff`

## Risk APIs

### `GET /api/risk-scoring`
Roles: `clinic_admin`, `clinical_staff`

### `POST /api/risk-scoring/recalculate`
Roles: `clinic_admin`, `clinical_staff`

## Scheduling APIs

### `GET /api/scheduling/appointments?date=YYYY-MM-DD`
Roles: `clinic_admin`, `clinical_staff`, `lab_pharmacy`

### `POST /api/scheduling/appointments`
Roles: `clinic_admin`, `clinical_staff`

### `PATCH /api/scheduling/appointments/:id`
Roles: `clinic_admin`, `clinical_staff`

### `GET /api/scheduling/stats?date=YYYY-MM-DD`
Roles: `clinic_admin`, `clinical_staff`, `lab_pharmacy`

## Agent Integration APIs

### `POST /api/agent/events/visit-completed`
Roles: `clinic_admin`, `clinical_staff`

## Compliance APIs

### `GET /api/compliance/overview`
Roles: `clinic_admin`, `clinical_staff`
