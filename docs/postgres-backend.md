# PostgreSQL Backend Mode

This project now supports two storage modes:

- `BACKEND_STORE=json` (default local mode)
- `BACKEND_STORE=postgres` (production-style mode using `psql`)

## Environment

Set one of the following:

1. `DATABASE_URL=postgresql://user:password@host:5432/dbname`
2. or `DB_HOST`, `DB_USER`, `DB_NAME`, and optional `PGPASSWORD`

Also set:

- `BACKEND_STORE=postgres`
- `AUTH_SESSION_SECRET=...`
- optional `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`

## Initialize schema

```bash
./scripts/init-postgres.sh
```

## Runtime behavior

- API routes auto-create minimal operational tables used by the app if they do not exist.
- If `BACKEND_STORE=postgres`, all patient/scheduling/risk/compliance APIs use PostgreSQL.
- If not set, APIs use `data/clinical-db.json`.

## Authentication

Protected routes require a valid login session cookie created by `POST /api/auth/login`.

Optional header-based auth can be enabled only for local testing:

- `ALLOW_HEADER_AUTH=true`
- `x-user-role`: `participant|clinic_admin|clinical_staff|lab_pharmacy`
- `x-user-id`: any user identifier
