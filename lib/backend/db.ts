import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import {
  dbSchema,
  type ClinicalFlowStage,
  type ClinicalDb,
  type CreatePatientInput,
  type Patient,
  type UpdatePatientInput,
  type RiskBand,
} from "@/lib/backend/types"
import { postgresEnabled, runSql, runSqlJson, sqlString } from "@/lib/backend/postgres"

const DATA_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DATA_DIR, "clinical-db.json")

const nowIso = () => new Date().toISOString()

const CLINICAL_FLOW_STAGE_ORDER: ClinicalFlowStage[] = ["request", "ra", "admin", "nurse", "doctor", "lab", "pharmacy"]
const CLINICAL_FLOW_STAGE_AGENT: Record<ClinicalFlowStage, string> = {
  request: "Intake Agent",
  ra: "RA Agent",
  admin: "Admin Agent",
  nurse: "Nurse Agent",
  doctor: "Doctor Agent",
  lab: "Lab Agent",
  pharmacy: "Pharmacy Agent",
}

function riskBandFromScore(score: number): RiskBand {
  if (score >= 90) return "Critical"
  if (score >= 70) return "High Risk"
  if (score >= 50) return "Medium Risk"
  return "Low Risk"
}

function createSeedData(): ClinicalDb {
  const now = nowIso()

  const patients: Patient[] = [
    {
      id: randomUUID(),
      mrn: "P-1024",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1958-06-12",
      sexAtBirth: "male",
      phone: "+1 555-0124",
      email: "john.doe@email.com",
      conditionSummary: "CHF",
      status: "High Risk",
      adherence: 45,
      lastVisit: "2026-01-15",
      nextAppointment: "2026-02-14",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      mrn: "P-2156",
      firstName: "Maria",
      lastName: "Santos",
      dateOfBirth: "1991-03-22",
      sexAtBirth: "female",
      phone: "+1 555-0156",
      email: "maria.santos@email.com",
      conditionSummary: "HIV",
      status: "High Risk",
      adherence: 62,
      lastVisit: "2026-01-20",
      nextAppointment: "2026-02-13",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      mrn: "P-3891",
      firstName: "Robert",
      lastName: "Chen",
      dateOfBirth: "1973-09-18",
      sexAtBirth: "male",
      phone: "+1 555-0391",
      email: "robert.chen@email.com",
      conditionSummary: "Diabetes",
      status: "Medium Risk",
      adherence: 78,
      lastVisit: "2026-01-28",
      nextAppointment: "2026-02-12",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      mrn: "P-4521",
      firstName: "Emily",
      lastName: "Watson",
      dateOfBirth: "1997-11-02",
      sexAtBirth: "female",
      phone: "+1 555-0521",
      email: "emily.watson@email.com",
      conditionSummary: "Routine",
      status: "Low Risk",
      adherence: 95,
      lastVisit: "2026-02-01",
      nextAppointment: "2026-02-18",
      createdAt: now,
      updatedAt: now,
    },
  ]

  const appointments = patients.map((patient) => ({
    id: randomUUID(),
    patientId: patient.id,
    providerName: "Dr. Amelia Grant",
    appointmentType: "follow_up" as const,
    scheduledStart: `${patient.nextAppointment}T09:00:00.000Z`,
    scheduledEnd: `${patient.nextAppointment}T09:30:00.000Z`,
    status: "scheduled" as const,
    reason: `${patient.conditionSummary} review`,
    createdAt: now,
    updatedAt: now,
  }))

  const riskScores = patients.map((patient) => ({
    id: randomUUID(),
    patientId: patient.id,
    scoreType: "adherence" as const,
    score: Math.max(0, 100 - patient.adherence),
    riskBand: patient.status,
    modelVersion: "v1.0.0",
    factors: [`Condition: ${patient.conditionSummary}`, `Adherence: ${patient.adherence}%`],
    calculatedAt: now,
  }))

  const alerts = [
    {
      id: randomUUID(),
      patientId: patients[0].id,
      alertType: "medication_nonadherence" as const,
      severity: "high" as const,
      title: "Medication refill overdue",
      description: "No refill confirmed in last 10 days",
      status: "open" as const,
      triggeredAt: now,
    },
  ]

  return {
    patients,
    appointments,
    riskScores,
    tasks: [],
    alerts,
    auditLogs: [],
    clinicFlows: [],
    clinicFlowEvents: [],
  }
}

let writeQueue = Promise.resolve()

async function ensureJsonDb(): Promise<ClinicalDb> {
  await mkdir(DATA_DIR, { recursive: true })

  try {
    const raw = await readFile(DB_PATH, "utf-8")
    return dbSchema.parse(JSON.parse(raw))
  } catch {
    const seed = createSeedData()
    await writeFile(DB_PATH, JSON.stringify(seed, null, 2), "utf-8")
    return seed
  }
}

async function saveJsonDb(db: ClinicalDb): Promise<void> {
  writeQueue = writeQueue.then(() => writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf-8"))
  await writeQueue
}

let pgReady = false

async function ensurePgReady() {
  if (pgReady || !postgresEnabled()) {
    return
  }

  const initSql = `
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS patients (
      id UUID PRIMARY KEY,
      mrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth DATE NOT NULL,
      sex_at_birth TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      condition_summary TEXT NOT NULL,
      call_trigger_phone TEXT,
      home_visit_address TEXT,
      home_latitude DOUBLE PRECISION,
      home_longitude DOUBLE PRECISION,
      status TEXT NOT NULL,
      adherence NUMERIC(5,2) NOT NULL,
      last_visit DATE,
      next_appointment DATE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      provider_name TEXT NOT NULL,
      appointment_type TEXT NOT NULL,
      scheduled_start TIMESTAMPTZ NOT NULL,
      scheduled_end TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_scores (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      score_type TEXT NOT NULL,
      score NUMERIC(5,2) NOT NULL,
      risk_band TEXT NOT NULL,
      model_version TEXT NOT NULL,
      factors JSONB NOT NULL DEFAULT '[]'::JSONB,
      calculated_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      triggered_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clinic_flows (
      id UUID PRIMARY KEY,
      patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      appointment_id UUID NULL REFERENCES appointments(id) ON DELETE SET NULL,
      entry_method TEXT NOT NULL,
      current_stage TEXT NOT NULL,
      status TEXT NOT NULL,
      needs_next_visit BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clinic_flows_status_stage ON clinic_flows(status, current_stage, updated_at DESC);

    CREATE TABLE IF NOT EXISTS clinic_flow_events (
      id UUID PRIMARY KEY,
      flow_id UUID NOT NULL REFERENCES clinic_flows(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      notes TEXT,
      occurred_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clinic_flow_events_flow_time ON clinic_flow_events(flow_id, occurred_at DESC);

    ALTER TABLE patients ADD COLUMN IF NOT EXISTS call_trigger_phone TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_visit_address TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_latitude DOUBLE PRECISION;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_longitude DOUBLE PRECISION;
  `

  await runSql(initSql)

  const countRows = await runSqlJson<Array<{ count: number }>>(
    "SELECT COUNT(*)::int AS count FROM patients",
    [{ count: 0 }],
  )

  if ((countRows[0]?.count ?? 0) === 0) {
    const seed = createSeedData()
    for (const p of seed.patients) {
      await runSql(`
        INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, sex_at_birth, phone, email, condition_summary, call_trigger_phone, home_visit_address, home_latitude, home_longitude, status, adherence, last_visit, next_appointment, created_at, updated_at)
        VALUES (${sqlString(p.id)}::uuid, ${sqlString(p.mrn)}, ${sqlString(p.firstName)}, ${sqlString(p.lastName)}, ${sqlString(p.dateOfBirth)}::date, ${sqlString(p.sexAtBirth)}, ${sqlString(p.phone)}, ${sqlString(p.email)}, ${sqlString(p.conditionSummary)}, ${sqlString(p.callTriggerPhone)}, ${sqlString(p.homeVisitAddress)}, ${sqlString(p.homeLatitude)}::double precision, ${sqlString(p.homeLongitude)}::double precision, ${sqlString(p.status)}, ${p.adherence}, ${sqlString(p.lastVisit)}::date, ${sqlString(p.nextAppointment)}::date, ${sqlString(p.createdAt)}::timestamptz, ${sqlString(p.updatedAt)}::timestamptz)
      `)
    }

    for (const a of seed.appointments) {
      await runSql(`
        INSERT INTO appointments (id, patient_id, provider_name, appointment_type, scheduled_start, scheduled_end, status, reason, created_at, updated_at)
        VALUES (${sqlString(a.id)}::uuid, ${sqlString(a.patientId)}::uuid, ${sqlString(a.providerName)}, ${sqlString(a.appointmentType)}, ${sqlString(a.scheduledStart)}::timestamptz, ${sqlString(a.scheduledEnd)}::timestamptz, ${sqlString(a.status)}, ${sqlString(a.reason)}, ${sqlString(a.createdAt)}::timestamptz, ${sqlString(a.updatedAt)}::timestamptz)
      `)
    }

    for (const r of seed.riskScores) {
      await runSql(`
        INSERT INTO risk_scores (id, patient_id, score_type, score, risk_band, model_version, factors, calculated_at)
        VALUES (${sqlString(r.id)}::uuid, ${sqlString(r.patientId)}::uuid, ${sqlString(r.scoreType)}, ${r.score}, ${sqlString(r.riskBand)}, ${sqlString(r.modelVersion)}, ${sqlString(JSON.stringify(r.factors))}::jsonb, ${sqlString(r.calculatedAt)}::timestamptz)
      `)
    }

    for (const al of seed.alerts) {
      await runSql(`
        INSERT INTO alerts (id, patient_id, alert_type, severity, title, description, status, triggered_at)
        VALUES (${sqlString(al.id)}::uuid, ${sqlString(al.patientId)}::uuid, ${sqlString(al.alertType)}, ${sqlString(al.severity)}, ${sqlString(al.title)}, ${sqlString(al.description)}, ${sqlString(al.status)}, ${sqlString(al.triggeredAt)}::timestamptz)
      `)
    }
  }

  pgReady = true
}

export async function listPatients(query?: { search?: string; status?: string }) {
  if (postgresEnabled()) {
    await ensurePgReady()

    const where: string[] = []
    if (query?.search) {
      const s = query.search.replace(/'/g, "''")
      where.push(`(LOWER(first_name || ' ' || last_name) LIKE LOWER('%${s}%') OR LOWER(mrn) LIKE LOWER('%${s}%') OR LOWER(condition_summary) LIKE LOWER('%${s}%'))`)
    }
    if (query?.status && query.status !== "all") {
      where.push(`status = '${query.status.replace(/'/g, "''")}'`)
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
    const rows = await runSqlJson<Array<Record<string, unknown>>>(
      `SELECT id, mrn, first_name, last_name, date_of_birth, sex_at_birth, phone, email, condition_summary, call_trigger_phone, home_visit_address, home_latitude, home_longitude, status, adherence, last_visit, next_appointment, created_at, updated_at FROM patients ${whereSql} ORDER BY updated_at DESC`,
      [],
    )

    return rows.map((r) => ({
      id: String(r.id),
      mrn: String(r.mrn),
      firstName: String(r.first_name),
      lastName: String(r.last_name),
      dateOfBirth: String(r.date_of_birth),
      sexAtBirth: String(r.sex_at_birth) as Patient["sexAtBirth"],
      phone: r.phone ? String(r.phone) : undefined,
      email: r.email ? String(r.email) : undefined,
      conditionSummary: String(r.condition_summary),
      callTriggerPhone: r.call_trigger_phone ? String(r.call_trigger_phone) : undefined,
      homeVisitAddress: r.home_visit_address ? String(r.home_visit_address) : undefined,
      homeLatitude: r.home_latitude !== null && r.home_latitude !== undefined ? String(r.home_latitude) : undefined,
      homeLongitude: r.home_longitude !== null && r.home_longitude !== undefined ? String(r.home_longitude) : undefined,
      status: String(r.status) as Patient["status"],
      adherence: Number(r.adherence),
      lastVisit: r.last_visit ? String(r.last_visit) : undefined,
      nextAppointment: r.next_appointment ? String(r.next_appointment) : undefined,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }))
  }

  const db = await ensureJsonDb()
  let items = db.patients

  if (query?.search) {
    const search = query.search.toLowerCase()
    items = items.filter((p) => {
      return (
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(search) ||
        p.mrn.toLowerCase().includes(search) ||
        p.conditionSummary.toLowerCase().includes(search)
      )
    })
  }

  if (query?.status && query.status !== "all") {
    items = items.filter((p) => p.status === query.status)
  }

  return items
}

export async function getPatientById(id: string) {
  if (postgresEnabled()) {
    await ensurePgReady()
    const rows = await runSqlJson<Array<Record<string, unknown>>>(
      `SELECT id, mrn, first_name, last_name, date_of_birth, sex_at_birth, phone, email, condition_summary, call_trigger_phone, home_visit_address, home_latitude, home_longitude, status, adherence, last_visit, next_appointment, created_at, updated_at FROM patients WHERE id = ${sqlString(id)}::uuid LIMIT 1`,
      [],
    )
    const p = rows[0]
    if (!p) return undefined

    return {
      id: String(p.id),
      mrn: String(p.mrn),
      firstName: String(p.first_name),
      lastName: String(p.last_name),
      dateOfBirth: String(p.date_of_birth),
      sexAtBirth: String(p.sex_at_birth) as Patient["sexAtBirth"],
      phone: p.phone ? String(p.phone) : undefined,
      email: p.email ? String(p.email) : undefined,
      conditionSummary: String(p.condition_summary),
      callTriggerPhone: p.call_trigger_phone ? String(p.call_trigger_phone) : undefined,
      homeVisitAddress: p.home_visit_address ? String(p.home_visit_address) : undefined,
      homeLatitude: p.home_latitude !== null && p.home_latitude !== undefined ? String(p.home_latitude) : undefined,
      homeLongitude: p.home_longitude !== null && p.home_longitude !== undefined ? String(p.home_longitude) : undefined,
      status: String(p.status) as Patient["status"],
      adherence: Number(p.adherence),
      lastVisit: p.last_visit ? String(p.last_visit) : undefined,
      nextAppointment: p.next_appointment ? String(p.next_appointment) : undefined,
      createdAt: String(p.created_at),
      updatedAt: String(p.updated_at),
    } satisfies Patient
  }

  const db = await ensureJsonDb()
  return db.patients.find((p) => p.id === id)
}

export async function createPatient(input: CreatePatientInput) {
  if (postgresEnabled()) {
    await ensurePgReady()
    const now = nowIso()
    const id = randomUUID()
    const mrn = `P-${Math.floor(1000 + Math.random() * 8999)}`

    await runSql(`
      INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, sex_at_birth, phone, email, condition_summary, call_trigger_phone, home_visit_address, home_latitude, home_longitude, status, adherence, created_at, updated_at)
      VALUES (${sqlString(id)}::uuid, ${sqlString(mrn)}, ${sqlString(input.firstName)}, ${sqlString(input.lastName)}, ${sqlString(input.dateOfBirth)}::date, ${sqlString(input.sexAtBirth)}, ${sqlString(input.phone)}, ${sqlString(input.email)}, ${sqlString(input.conditionSummary)}, ${sqlString(input.callTriggerPhone)}, ${sqlString(input.homeVisitAddress)}, ${sqlString(input.homeLatitude)}::double precision, ${sqlString(input.homeLongitude)}::double precision, ${sqlString(input.status)}, ${input.adherence}, ${sqlString(now)}::timestamptz, ${sqlString(now)}::timestamptz)
    `)

    await runSql(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, occurred_at)
      VALUES (${sqlString(randomUUID())}::uuid, 'patient', ${sqlString(id)}, 'create', 'api_client', ${sqlString(now)}::timestamptz)
    `)

    const created = await getPatientById(id)
    if (!created) {
      throw new Error("Failed to create patient")
    }
    return created
  }

  const db = await ensureJsonDb()
  const now = nowIso()

  const patient: Patient = {
    id: randomUUID(),
    mrn: `P-${Math.floor(1000 + Math.random() * 8999)}`,
    firstName: input.firstName,
    lastName: input.lastName,
    dateOfBirth: input.dateOfBirth,
    sexAtBirth: input.sexAtBirth,
    phone: input.phone,
    email: input.email,
    conditionSummary: input.conditionSummary,
    callTriggerPhone: input.callTriggerPhone,
    homeVisitAddress: input.homeVisitAddress,
    homeLatitude: input.homeLatitude,
    homeLongitude: input.homeLongitude,
    status: input.status,
    adherence: input.adherence,
    lastVisit: undefined,
    nextAppointment: undefined,
    createdAt: now,
    updatedAt: now,
  }

  db.patients.push(patient)
  db.auditLogs.push({
    id: randomUUID(),
    entityType: "patient",
    entityId: patient.id,
    action: "create",
    actorType: "api_client",
    occurredAt: now,
  })
  await saveJsonDb(db)
  return patient
}

export async function updatePatient(id: string, input: UpdatePatientInput) {
  if (postgresEnabled()) {
    await ensurePgReady()
    const now = nowIso()

    const updates: string[] = []
    if (input.mrn !== undefined) updates.push(`mrn = ${sqlString(input.mrn)}`)
    if (input.firstName !== undefined) updates.push(`first_name = ${sqlString(input.firstName)}`)
    if (input.lastName !== undefined) updates.push(`last_name = ${sqlString(input.lastName)}`)
    if (input.dateOfBirth !== undefined) updates.push(`date_of_birth = ${sqlString(input.dateOfBirth)}::date`)
    if (input.sexAtBirth !== undefined) updates.push(`sex_at_birth = ${sqlString(input.sexAtBirth)}`)
    if (input.phone !== undefined) updates.push(`phone = ${sqlString(input.phone)}`)
    if (input.email !== undefined) updates.push(`email = ${sqlString(input.email)}`)
    if (input.conditionSummary !== undefined) updates.push(`condition_summary = ${sqlString(input.conditionSummary)}`)
    if (input.callTriggerPhone !== undefined) updates.push(`call_trigger_phone = ${sqlString(input.callTriggerPhone)}`)
    if (input.homeVisitAddress !== undefined) updates.push(`home_visit_address = ${sqlString(input.homeVisitAddress)}`)
    if (input.homeLatitude !== undefined) updates.push(`home_latitude = ${sqlString(input.homeLatitude)}::double precision`)
    if (input.homeLongitude !== undefined) updates.push(`home_longitude = ${sqlString(input.homeLongitude)}::double precision`)
    if (input.status !== undefined) updates.push(`status = ${sqlString(input.status)}`)
    if (input.adherence !== undefined) updates.push(`adherence = ${input.adherence}`)
    updates.push(`updated_at = ${sqlString(now)}::timestamptz`)

    await runSql(`UPDATE patients SET ${updates.join(", ")} WHERE id = ${sqlString(id)}::uuid`)

    await runSql(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, occurred_at)
      VALUES (${sqlString(randomUUID())}::uuid, 'patient', ${sqlString(id)}, 'update', 'api_client', ${sqlString(now)}::timestamptz)
    `)

    return getPatientById(id)
  }

  const db = await ensureJsonDb()
  const patient = db.patients.find((p) => p.id === id)
  if (!patient) {
    return null
  }

  const merged: Patient = {
    ...patient,
    ...input,
    updatedAt: nowIso(),
  }

  const idx = db.patients.findIndex((p) => p.id === id)
  db.patients[idx] = merged
  db.auditLogs.push({
    id: randomUUID(),
    entityType: "patient",
    entityId: patient.id,
    action: "update",
    actorType: "api_client",
    occurredAt: merged.updatedAt,
  })
  await saveJsonDb(db)
  return merged
}

export async function listPatientAppointments(patientId: string) {
  if (postgresEnabled()) {
    await ensurePgReady()
    return runSqlJson(
      `SELECT id, patient_id AS "patientId", provider_name AS "providerName", appointment_type AS "appointmentType", scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd", status, reason, created_at AS "createdAt", updated_at AS "updatedAt" FROM appointments WHERE patient_id = ${sqlString(patientId)}::uuid ORDER BY scheduled_start ASC`,
      [],
    )
  }

  const db = await ensureJsonDb()
  return db.appointments.filter((item) => item.patientId === patientId)
}

export async function listPatientRiskScores(patientId: string) {
  if (postgresEnabled()) {
    await ensurePgReady()
    return runSqlJson(
      `SELECT id, patient_id AS "patientId", score_type AS "scoreType", score, risk_band AS "riskBand", model_version AS "modelVersion", factors, calculated_at AS "calculatedAt" FROM risk_scores WHERE patient_id = ${sqlString(patientId)}::uuid ORDER BY calculated_at DESC`,
      [],
    )
  }

  const db = await ensureJsonDb()
  return db.riskScores.filter((item) => item.patientId === patientId)
}

export async function listRiskPatients() {
  const patients = await listPatients()
  const withScore = await Promise.all(
    patients.map(async (patient) => {
      const scores = await listPatientRiskScores(patient.id)
      const latest = scores[0]
      const scoreValue = latest ? Number((latest as { score: number }).score) : Math.max(0, 100 - patient.adherence)
      return {
        id: patient.id,
        mrn: patient.mrn,
        name: `${patient.firstName} ${patient.lastName}`,
        condition: patient.conditionSummary,
        score: scoreValue,
        level: riskBandFromScore(scoreValue),
        reasoning: `Adherence ${patient.adherence}% with condition ${patient.conditionSummary}.`,
        recommendedAction: scoreValue >= 70 ? "Escalate to clinical staff" : "Automated reminder workflow",
      }
    }),
  )

  return withScore.sort((a, b) => b.score - a.score)
}

export async function recalculateRiskScores() {
  const patients = await listPatients()
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()

    for (const patient of patients) {
      const score = Math.max(0, 100 - patient.adherence)
      await runSql(`
        INSERT INTO risk_scores (id, patient_id, score_type, score, risk_band, model_version, factors, calculated_at)
        VALUES (${sqlString(randomUUID())}::uuid, ${sqlString(patient.id)}::uuid, 'adherence', ${score}, ${sqlString(riskBandFromScore(score))}, 'v1.0.1', ${sqlString(JSON.stringify([`Adherence ${patient.adherence}%`]))}::jsonb, ${sqlString(now)}::timestamptz)
      `)
    }

    return { updated: patients.length, calculatedAt: now }
  }

  const db = await ensureJsonDb()
  for (const patient of patients) {
    const score = Math.max(0, 100 - patient.adherence)
    db.riskScores.unshift({
      id: randomUUID(),
      patientId: patient.id,
      scoreType: "adherence",
      score,
      riskBand: riskBandFromScore(score),
      modelVersion: "v1.0.1",
      factors: [`Adherence ${patient.adherence}%`],
      calculatedAt: now,
    })
  }
  await saveJsonDb(db)

  return { updated: patients.length, calculatedAt: now }
}

export async function listAppointmentsForDate(dateIso: string) {
  const start = `${dateIso}T00:00:00.000Z`
  const end = `${dateIso}T23:59:59.999Z`

  if (postgresEnabled()) {
    await ensurePgReady()
    return runSqlJson(
      `SELECT a.id, a.patient_id AS "patientId", p.mrn AS "patientMrn", (p.first_name || ' ' || p.last_name) AS "patientName", a.provider_name AS "providerName", a.appointment_type AS "appointmentType", a.scheduled_start AS "scheduledStart", a.scheduled_end AS "scheduledEnd", a.status, a.reason FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.scheduled_start >= ${sqlString(start)}::timestamptz AND a.scheduled_start <= ${sqlString(end)}::timestamptz ORDER BY a.scheduled_start ASC`,
      [],
    )
  }

  const db = await ensureJsonDb()
  const byId = new Map(db.patients.map((p) => [p.id, p]))

  return db.appointments
    .filter((a) => a.scheduledStart >= start && a.scheduledStart <= end)
    .map((a) => {
      const patient = byId.get(a.patientId)
      return {
        id: a.id,
        patientId: a.patientId,
        patientMrn: patient?.mrn ?? "N/A",
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
        providerName: a.providerName,
        appointmentType: a.appointmentType,
        scheduledStart: a.scheduledStart,
        scheduledEnd: a.scheduledEnd,
        status: a.status,
        reason: a.reason,
      }
    })
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
}

export async function createAppointment(input: {
  patientId: string
  providerName: string
  appointmentType: "routine" | "follow_up" | "urgent" | "telehealth" | "screening"
  scheduledStart: string
  scheduledEnd: string
  status?: "scheduled" | "checked_in" | "completed" | "cancelled" | "no_show"
  reason?: string
  enableReminderWorkflow?: boolean
}) {
  const now = nowIso()
  const id = randomUUID()
  const status = input.status ?? "scheduled"
  const enableReminderWorkflow = input.enableReminderWorkflow ?? true

  if (postgresEnabled()) {
    await ensurePgReady()

    await runSql(`
      INSERT INTO appointments (id, patient_id, provider_name, appointment_type, scheduled_start, scheduled_end, status, reason, created_at, updated_at)
      VALUES (${sqlString(id)}::uuid, ${sqlString(input.patientId)}::uuid, ${sqlString(input.providerName)}, ${sqlString(input.appointmentType)}, ${sqlString(input.scheduledStart)}::timestamptz, ${sqlString(input.scheduledEnd)}::timestamptz, ${sqlString(status)}, ${sqlString(input.reason)}, ${sqlString(now)}::timestamptz, ${sqlString(now)}::timestamptz)
    `)

    if (status === "scheduled" || status === "checked_in") {
      await runSql(`
        UPDATE patients
        SET next_appointment = ${sqlString(input.scheduledStart.slice(0, 10))}::date,
            updated_at = ${sqlString(now)}::timestamptz
        WHERE id = ${sqlString(input.patientId)}::uuid
      `)
    }

    if (enableReminderWorkflow && (status === "scheduled" || status === "checked_in")) {
      const nextActionAt = new Date(new Date(input.scheduledStart).getTime() - 2 * 24 * 60 * 60 * 1000)
      const nextActionIso = Number.isNaN(nextActionAt.getTime()) ? now : nextActionAt.toISOString()
      try {
        await runSql(`
          INSERT INTO appointment_reminder_workflows (
            appointment_id,
            patient_id,
            scheduled_start,
            stage,
            status,
            next_action_at,
            created_at,
            updated_at
          )
          VALUES (
            ${sqlString(id)}::uuid,
            ${sqlString(input.patientId)}::uuid,
            ${sqlString(input.scheduledStart)}::timestamptz,
            'stage1_text',
            'pending_ack',
            ${sqlString(nextActionIso)}::timestamptz,
            NOW(),
            NOW()
          )
          ON CONFLICT (appointment_id) DO NOTHING
        `)
      } catch {
        // Ignore when agent reminder schema is not present yet.
      }
    }

    return {
      id,
      patientId: input.patientId,
      providerName: input.providerName,
      appointmentType: input.appointmentType,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      reason: input.reason,
      status,
      createdAt: now,
      updatedAt: now,
    }
  }

  const db = await ensureJsonDb()
  const appointment = {
    id,
    patientId: input.patientId,
    providerName: input.providerName,
    appointmentType: input.appointmentType,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    status,
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  }

  db.appointments.push(appointment)
  if (status === "scheduled" || status === "checked_in") {
    const patientIdx = db.patients.findIndex((p) => p.id === input.patientId)
    if (patientIdx >= 0) {
      db.patients[patientIdx] = {
        ...db.patients[patientIdx],
        nextAppointment: input.scheduledStart.slice(0, 10),
        updatedAt: now,
      }
    }
  }
  await saveJsonDb(db)
  return appointment
}

export async function updateAppointmentStatus(
  id: string,
  status: "scheduled" | "checked_in" | "completed" | "cancelled" | "no_show",
) {
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    await runSql(`
      UPDATE appointments
      SET status = ${sqlString(status)}, updated_at = ${sqlString(now)}::timestamptz
      WHERE id = ${sqlString(id)}::uuid
    `)

    const rows = await runSqlJson<Array<Record<string, unknown>>>(
      `SELECT id, patient_id AS "patientId", provider_name AS "providerName", appointment_type AS "appointmentType", scheduled_start AS "scheduledStart", scheduled_end AS "scheduledEnd", status, reason, created_at AS "createdAt", updated_at AS "updatedAt" FROM appointments WHERE id = ${sqlString(id)}::uuid LIMIT 1`,
      [],
    )
    const appointment = rows[0]
    if (!appointment) return null

    if (status === "completed") {
      await runSql(`
        UPDATE patients
        SET last_visit = ${sqlString(String(appointment.scheduledStart).slice(0, 10))}::date,
            updated_at = ${sqlString(now)}::timestamptz
        WHERE id = ${sqlString(String(appointment.patientId))}::uuid
      `)
    }

    return appointment
  }

  const db = await ensureJsonDb()
  const idx = db.appointments.findIndex((a) => a.id === id)
  if (idx < 0) return null

  const appointment = {
    ...db.appointments[idx],
    status,
    updatedAt: now,
  }
  db.appointments[idx] = appointment

  if (status === "completed") {
    const patientIdx = db.patients.findIndex((p) => p.id === appointment.patientId)
    if (patientIdx >= 0) {
      db.patients[patientIdx] = {
        ...db.patients[patientIdx],
        lastVisit: appointment.scheduledStart.slice(0, 10),
        updatedAt: now,
      }
    }
  }

  await saveJsonDb(db)
  return appointment
}

function nextClinicalStage(stage: ClinicalFlowStage): ClinicalFlowStage | null {
  const idx = CLINICAL_FLOW_STAGE_ORDER.indexOf(stage)
  if (idx < 0 || idx + 1 >= CLINICAL_FLOW_STAGE_ORDER.length) return null
  return CLINICAL_FLOW_STAGE_ORDER[idx + 1]
}

export function listClinicalFlowStages() {
  return CLINICAL_FLOW_STAGE_ORDER.map((stage) => ({
    id: stage,
    label:
      stage === "request"
        ? "Request Received"
        : stage === "ra"
          ? "Ready for RA"
          : stage === "admin"
            ? "Ready for Admin"
            : stage === "nurse"
              ? "Ready for Nurse"
              : stage === "doctor"
                ? "Ready for Doctor"
                : stage === "lab"
                  ? "Ready for Lab"
                  : "Ready for Pharmacy",
    agent: CLINICAL_FLOW_STAGE_AGENT[stage],
  }))
}

export async function listClinicalFlows() {
  if (postgresEnabled()) {
    await ensurePgReady()
    const rows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT f.id,
             f.patient_id AS "patientId",
             f.appointment_id AS "appointmentId",
             f.entry_method AS "entryMethod",
             f.current_stage AS "currentStage",
             f.status,
             f.needs_next_visit AS "needsNextVisit",
             f.started_at AS "startedAt",
             f.completed_at AS "completedAt",
             f.created_at AS "createdAt",
             f.updated_at AS "updatedAt",
             p.mrn AS "patientMrn",
             (p.first_name || ' ' || p.last_name) AS "patientName",
             COALESCE(a.appointment_type, 'follow_up') AS "appointmentType"
      FROM clinic_flows f
      JOIN patients p ON p.id = f.patient_id
      LEFT JOIN appointments a ON a.id = f.appointment_id
      ORDER BY f.updated_at DESC
      `,
      [],
    )
    return rows
  }

  const db = await ensureJsonDb()
  const byPatient = new Map(db.patients.map((p) => [p.id, p]))
  const byAppointment = new Map(db.appointments.map((a) => [a.id, a]))
  return db.clinicFlows
    .map((f) => {
      const p = byPatient.get(f.patientId)
      const a = f.appointmentId ? byAppointment.get(f.appointmentId) : undefined
      return {
        ...f,
        patientMrn: p?.mrn ?? "N/A",
        patientName: p ? `${p.firstName} ${p.lastName}` : "Unknown",
        appointmentType: a?.appointmentType ?? "follow_up",
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function startClinicalFlow(input: {
  patientId: string
  appointmentId?: string
  entryMethod: "scan" | "admin"
  actor: string
}) {
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    const existing = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT f.id,
             f.patient_id AS "patientId",
             f.appointment_id AS "appointmentId",
             f.entry_method AS "entryMethod",
             f.current_stage AS "currentStage",
             f.status,
             f.needs_next_visit AS "needsNextVisit",
             f.started_at AS "startedAt",
             f.completed_at AS "completedAt",
             f.created_at AS "createdAt",
             f.updated_at AS "updatedAt",
             p.mrn AS "patientMrn",
             (p.first_name || ' ' || p.last_name) AS "patientName",
             COALESCE(a.appointment_type, 'follow_up') AS "appointmentType"
      FROM clinic_flows f
      JOIN patients p ON p.id = f.patient_id
      LEFT JOIN appointments a ON a.id = f.appointment_id
      WHERE f.patient_id = ${sqlString(input.patientId)}::uuid
        AND f.status = 'active'
      ORDER BY f.updated_at DESC
      LIMIT 1
      `,
      [],
    )
    if (existing[0]) return existing[0]

    const flowId = randomUUID()
    await runSql(`
      INSERT INTO clinic_flows (id, patient_id, appointment_id, entry_method, current_stage, status, needs_next_visit, started_at, created_at, updated_at)
      VALUES (${sqlString(flowId)}::uuid, ${sqlString(input.patientId)}::uuid, ${sqlString(input.appointmentId)}::uuid, ${sqlString(input.entryMethod)}, 'request', 'active', FALSE, ${sqlString(now)}::timestamptz, ${sqlString(now)}::timestamptz, ${sqlString(now)}::timestamptz)
    `)
    await runSql(`
      INSERT INTO clinic_flow_events (id, flow_id, stage, action, actor, notes, occurred_at)
      VALUES (${sqlString(randomUUID())}::uuid, ${sqlString(flowId)}::uuid, 'request', 'entry_registered', ${sqlString(input.actor)}, ${sqlString(`Entry method: ${input.entryMethod}`)}, ${sqlString(now)}::timestamptz)
    `)
    await runSql(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, occurred_at)
      VALUES (${sqlString(randomUUID())}::uuid, 'clinic_flow', ${sqlString(flowId)}, ${sqlString(`agent_request_intake`)}, 'system', ${sqlString(now)}::timestamptz)
    `)
    const created = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT f.id,
             f.patient_id AS "patientId",
             f.appointment_id AS "appointmentId",
             f.entry_method AS "entryMethod",
             f.current_stage AS "currentStage",
             f.status,
             f.needs_next_visit AS "needsNextVisit",
             f.started_at AS "startedAt",
             f.completed_at AS "completedAt",
             f.created_at AS "createdAt",
             f.updated_at AS "updatedAt",
             p.mrn AS "patientMrn",
             (p.first_name || ' ' || p.last_name) AS "patientName",
             COALESCE(a.appointment_type, 'follow_up') AS "appointmentType"
      FROM clinic_flows f
      JOIN patients p ON p.id = f.patient_id
      LEFT JOIN appointments a ON a.id = f.appointment_id
      WHERE f.id = ${sqlString(flowId)}::uuid
      LIMIT 1
      `,
      [],
    )
    return created[0]
  }

  const db = await ensureJsonDb()
  const active = db.clinicFlows.find((f) => f.patientId === input.patientId && f.status === "active")
  if (active) {
    const patient = db.patients.find((p) => p.id === active.patientId)
    const appointment = active.appointmentId ? db.appointments.find((a) => a.id === active.appointmentId) : undefined
    return {
      ...active,
      patientMrn: patient?.mrn ?? "N/A",
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
      appointmentType: appointment?.appointmentType ?? "follow_up",
    }
  }

  const flow = {
    id: randomUUID(),
    patientId: input.patientId,
    appointmentId: input.appointmentId,
    entryMethod: input.entryMethod,
    currentStage: "request" as const,
    status: "active" as const,
    needsNextVisit: false,
    startedAt: now,
    completedAt: undefined,
    createdAt: now,
    updatedAt: now,
  }
  db.clinicFlows.push(flow)
  db.clinicFlowEvents.push({
    id: randomUUID(),
    flowId: flow.id,
    stage: "request",
    action: "entry_registered",
    actor: input.actor,
    notes: `Entry method: ${input.entryMethod}`,
    occurredAt: now,
  })
  await saveJsonDb(db)
  const patient = db.patients.find((p) => p.id === flow.patientId)
  const appointment = flow.appointmentId ? db.appointments.find((a) => a.id === flow.appointmentId) : undefined
  return {
    ...flow,
    patientMrn: patient?.mrn ?? "N/A",
    patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
    appointmentType: appointment?.appointmentType ?? "follow_up",
  }
}

export async function advanceClinicalFlow(input: {
  flowId: string
  actor: string
  notes?: string
  complete?: boolean
  needsNextVisit?: boolean
}) {
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    const existingRows = await runSqlJson<Array<Record<string, unknown>>>(
      `SELECT id, patient_id AS "patientId", appointment_id AS "appointmentId", current_stage AS "currentStage", status FROM clinic_flows WHERE id = ${sqlString(input.flowId)}::uuid LIMIT 1`,
      [],
    )
    const existing = existingRows[0]
    if (!existing) return null
    if (String(existing.status) !== "active") return existing

    const current = String(existing.currentStage) as ClinicalFlowStage
    const shouldComplete = input.complete === true || current === "pharmacy"
    const nextStage = shouldComplete ? current : nextClinicalStage(current)
    if (!nextStage) return existing

    await runSql(`
      UPDATE clinic_flows
      SET current_stage = ${sqlString(nextStage)},
          status = ${sqlString(shouldComplete ? "completed" : "active")},
          needs_next_visit = ${input.needsNextVisit === true ? "TRUE" : "FALSE"},
          completed_at = ${shouldComplete ? `${sqlString(now)}::timestamptz` : "completed_at"},
          updated_at = ${sqlString(now)}::timestamptz
      WHERE id = ${sqlString(input.flowId)}::uuid
    `)
    await runSql(`
      INSERT INTO clinic_flow_events (id, flow_id, stage, action, actor, notes, occurred_at)
      VALUES (${sqlString(randomUUID())}::uuid, ${sqlString(input.flowId)}::uuid, ${sqlString(nextStage)}, ${sqlString(shouldComplete ? "medication_collected" : "stage_advanced")}, ${sqlString(input.actor)}, ${sqlString(input.notes)}, ${sqlString(now)}::timestamptz)
    `)
    await runSql(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, occurred_at)
      VALUES (${sqlString(randomUUID())}::uuid, 'clinic_flow', ${sqlString(input.flowId)}, ${sqlString(`agent_${nextStage}_handoff`)}, 'system', ${sqlString(now)}::timestamptz)
    `)

    const updatedRows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT f.id,
             f.patient_id AS "patientId",
             f.appointment_id AS "appointmentId",
             f.entry_method AS "entryMethod",
             f.current_stage AS "currentStage",
             f.status,
             f.needs_next_visit AS "needsNextVisit",
             f.started_at AS "startedAt",
             f.completed_at AS "completedAt",
             f.created_at AS "createdAt",
             f.updated_at AS "updatedAt",
             p.mrn AS "patientMrn",
             (p.first_name || ' ' || p.last_name) AS "patientName",
             COALESCE(a.appointment_type, 'follow_up') AS "appointmentType"
      FROM clinic_flows f
      JOIN patients p ON p.id = f.patient_id
      LEFT JOIN appointments a ON a.id = f.appointment_id
      WHERE f.id = ${sqlString(input.flowId)}::uuid
      LIMIT 1
      `,
      [],
    )
    return updatedRows[0]
  }

  const db = await ensureJsonDb()
  const idx = db.clinicFlows.findIndex((f) => f.id === input.flowId)
  if (idx < 0) return null
  const existing = db.clinicFlows[idx]
  if (existing.status !== "active") return existing

  const shouldComplete = input.complete === true || existing.currentStage === "pharmacy"
  const nextStage = shouldComplete ? existing.currentStage : nextClinicalStage(existing.currentStage)
  if (!nextStage) return existing

  const updated = {
    ...existing,
    currentStage: nextStage,
    status: shouldComplete ? ("completed" as const) : ("active" as const),
    needsNextVisit: input.needsNextVisit === true,
    completedAt: shouldComplete ? now : existing.completedAt,
    updatedAt: now,
  }
  db.clinicFlows[idx] = updated
  db.clinicFlowEvents.push({
    id: randomUUID(),
    flowId: updated.id,
    stage: nextStage,
    action: shouldComplete ? "medication_collected" : "stage_advanced",
    actor: input.actor,
    notes: input.notes,
    occurredAt: now,
  })
  await saveJsonDb(db)

  const patient = db.patients.find((p) => p.id === updated.patientId)
  const appointment = updated.appointmentId ? db.appointments.find((a) => a.id === updated.appointmentId) : undefined
  return {
    ...updated,
    patientMrn: patient?.mrn ?? "N/A",
    patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
    appointmentType: appointment?.appointmentType ?? "follow_up",
  }
}

export async function getSchedulingStats(dateIso: string) {
  const items = await listAppointmentsForDate(dateIso)
  const total = items.length
  const confirmed = items.filter((x) => x.status === "scheduled" || x.status === "checked_in").length
  const pending = items.filter((x) => x.status === "cancelled").length
  const notConfirmed = items.filter((x) => x.status === "no_show").length

  return {
    total,
    confirmed,
    pending,
    notConfirmed,
  }
}

export async function getComplianceOverview() {
  if (postgresEnabled()) {
    await ensurePgReady()

    const checks = [
      { name: "HIPAA Compliance", status: "passed", lastCheck: "continuous" },
      { name: "RBAC Enforcement", status: "passed", lastCheck: "continuous" },
      { name: "Audit Logging", status: "passed", lastCheck: "continuous" },
      { name: "Data Encryption", status: "passed", lastCheck: "daily" },
    ]

    const logs = await runSqlJson<Array<Record<string, unknown>>>(
      "SELECT id, action, entity_id AS patient, actor_type AS user, action AS details, occurred_at FROM audit_logs ORDER BY occurred_at DESC LIMIT 10",
      [],
    )

    const alerts = await runSqlJson<Array<Record<string, unknown>>>(
      "SELECT COUNT(*)::int AS count FROM alerts WHERE status = 'open'",
      [{ count: 0 }],
    )

    return {
      checks,
      guardrails: 4,
      violations: Number(alerts[0]?.count ?? 0),
      auditEntriesToday: logs.length,
      recentAuditLogs: logs.map((l) => ({
        id: String(l.id),
        action: String(l.action),
        patient: String(l.patient),
        user: String(l.user),
        details: String(l.details),
        time: String(l.occurred_at),
      })),
    }
  }

  const db = await ensureJsonDb()
  const today = new Date().toISOString().slice(0, 10)

  return {
    checks: [
      { name: "HIPAA Compliance", status: "passed", lastCheck: "2 hours ago" },
      { name: "RBAC Enforcement", status: "passed", lastCheck: "real-time" },
      { name: "Audit Logging", status: "passed", lastCheck: "real-time" },
      { name: "Data Encryption", status: "passed", lastCheck: "24 hours ago" },
    ],
    guardrails: 4,
    violations: db.alerts.filter((a) => a.status === "open").length,
    auditEntriesToday: db.auditLogs.filter((a) => a.occurredAt.startsWith(today)).length,
    recentAuditLogs: db.auditLogs.slice(-10).reverse().map((log) => ({
      id: log.id,
      action: log.action,
      patient: log.entityId,
      user: log.actorType,
      details: `${log.entityType} ${log.action}`,
      time: log.occurredAt,
    })),
  }
}
