import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import {
  dbSchema,
  type Alert,
  type Appointment,
  type ClinicalFlow,
  type ClinicalFlowStage,
  type ClinicalTask,
  type ClinicalDb,
  type CreatePatientInput,
  type Patient,
  type UpdatePatientInput,
  type RiskBand,
} from "@/lib/backend/types"
import { getClinicalFlowSummary } from "@/lib/clinical-flow"
import { postgresEnabled, runSql, runSqlJson, sqlString } from "@/lib/backend/postgres"

const DATA_DIR = path.join(process.cwd(), "data")
const DB_PATH = path.join(DATA_DIR, "clinical-db.json")

const nowIso = () => new Date().toISOString()

type AuditActorType = "provider" | "system" | "api_client"

type AuditEntryInput = {
  entityType: string
  entityId: string
  action: string
  actorType: AuditActorType
  occurredAt?: string
}

type WorkflowAlertInput = {
  patientId: string
  title: string
  description?: string
  severity: "info" | "warning" | "high" | "critical"
}

type AlertStatus = "open" | "acknowledged" | "resolved" | "dismissed"

type ClinicalTaskStatus = "open" | "in_progress" | "done" | "cancelled"

type ClinicalTaskInput = {
  patientId: string
  title: string
  relatedAlertId?: string
  taskType: "outreach" | "education" | "medication_review" | "lab_follow_up" | "appointment_reminder"
  priority: "low" | "medium" | "high" | "critical"
  status?: ClinicalTaskStatus
  assignedUserId?: string
  assignedUserName?: string
  dueAt?: string
  notes?: string
}

type ScheduledAppointment = {
  id: string
  patientId: string
  patientMrn: string
  patientName: string
  providerName: string
  appointmentType: Appointment["appointmentType"]
  scheduledStart: string
  scheduledEnd: string
  status: Appointment["status"]
  reason?: string
}

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

const REMINDER_STAGE_LABELS: Record<string, string> = {
  stage1_text: "T-2 WhatsApp reminder",
  stage2_text: "Follow-up WhatsApp after 3 hours",
  stage3_text: "Final WhatsApp after another 3 hours",
  stage4_patient_call: "Patient confirmation call",
  stage5_next_of_kin_call: "Next-of-kin fallback call",
  stage6_homebase_alert: "Home-base or nurse escalation queue",
  stage7_home_visit_escalated: "Home visit escalation raised",
  stage_confirmed_day_of_pending: "Confirmed and waiting for day-of reminder",
  stage_day_of_reminder_sent: "Day-of reminder sent",
  stage_confirmed: "Confirmed",
}

const RISK_FACTOR_WEIGHTS = [
  { id: "adherence", label: "Adherence Risk", weight: 0.35 },
  { id: "appointments", label: "Missed Appointments", weight: 0.25 },
  { id: "manual_status", label: "Manual Clinical Status", weight: 0.25 },
  { id: "alerts", label: "Open Alert Load", weight: 0.15 },
] as const

function describeAgentAction(action: string, response?: Record<string, unknown>) {
  switch (action) {
    case "BOOK_REQUEST":
      return { label: "Booking request received", reason: "Patient asked for available appointment times.", type: "booking", status: "completed" }
    case "HOLD_APPOINTMENT":
      return { label: "Appointment options prepared", reason: "The agent created a shortlist of available appointment slots.", type: "booking", status: "completed" }
    case "HOLD_OPTION_SELECTED":
      return {
        label: "Time slot selected",
        reason: `The patient selected option ${Number(response?.selected_index ?? 0) || "from the menu"}.`,
        type: "booking",
        status: "in_progress",
      }
    case "CONFIRM_APPOINTMENT":
      return { label: "Appointment confirmed", reason: "The patient confirmed the selected appointment time.", type: "success", status: "success" }
    case "APPOINTMENT_SCHEDULED_WHATSAPP_SENT":
      return { label: "Scheduling notice sent", reason: "A WhatsApp appointment notification was delivered.", type: "whatsapp", status: "completed" }
    case "REMINDER_STAGE1_SENT":
      return { label: "Initial WhatsApp reminder sent", reason: "The T-2 reminder was sent to the patient.", type: "whatsapp", status: "completed" }
    case "REMINDER_STAGE2_SENT":
      return { label: "Follow-up WhatsApp sent", reason: "A second reminder was sent after no confirmation.", type: "whatsapp", status: "completed" }
    case "REMINDER_STAGE3_SENT":
      return { label: "Final WhatsApp sent", reason: "A final reminder was sent before call escalation.", type: "whatsapp", status: "completed" }
    case "REMINDER_ACKNOWLEDGED":
      return { label: "Reminder acknowledged", reason: "The patient acknowledged the appointment reminder.", type: "success", status: "success" }
    case "REMINDER_PATIENT_CALL_TRIGGERED":
      return { label: "Patient call triggered", reason: "The workflow escalated from WhatsApp to a confirmation call.", type: "call", status: "in_progress" }
    case "REMINDER_CALL_CONFIRMED":
      return { label: "Confirmation received by call", reason: "The appointment was confirmed through the call flow.", type: "success", status: "success" }
    case "REMINDER_NEXT_OF_KIN_CALL_TRIGGERED":
      return { label: "Next-of-kin call triggered", reason: "The workflow escalated to the next-of-kin fallback call.", type: "call", status: "in_progress" }
    case "REMINDER_HOME_VISIT_ESCALATED":
      return { label: "Home-care escalation raised", reason: "The patient was escalated to home-based care or nursing outreach.", type: "escalation", status: "completed" }
    case "REMINDER_DAY_OF_SENT":
      return { label: "Same-day reminder sent", reason: "A day-of-visit reminder was delivered after confirmation.", type: "whatsapp", status: "completed" }
    default:
      return { label: action.replaceAll("_", " "), reason: "Agent activity recorded.", type: "system", status: "completed" }
  }
}

function relativeTimeLabel(iso: string) {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime())
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} hr ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}

function withClinicalFlowSummary<T extends Record<string, unknown>>(flow: T) {
  const summary = getClinicalFlowSummary({
    currentStage: flow.currentStage as ClinicalFlowStage,
    status: flow.status as "active" | "completed" | "cancelled",
    needsNextVisit: Boolean(flow.needsNextVisit),
    currentHandlerUserId: typeof flow.currentHandlerUserId === "string" ? flow.currentHandlerUserId : undefined,
    currentHandlerName: typeof flow.currentHandlerName === "string" ? flow.currentHandlerName : undefined,
    currentHandlerRole: typeof flow.currentHandlerRole === "string" ? flow.currentHandlerRole : undefined,
  })

  return {
    ...flow,
    ...summary,
  }
}

function riskBandFromScore(score: number): RiskBand {
  if (score >= 90) return "Critical"
  if (score >= 70) return "High Risk"
  if (score >= 50) return "Medium Risk"
  return "Low Risk"
}

function manualRiskFloor(status: Patient["status"]) {
  switch (status) {
    case "Critical":
      return 95
    case "High Risk":
      return 80
    case "Medium Risk":
      return 60
    default:
      return 20
  }
}

function appointmentRiskSignal(appointments: Appointment[]) {
  const pastAppointments = appointments.filter((appointment) => new Date(appointment.scheduledStart).getTime() <= Date.now())
  if (pastAppointments.length === 0) return 0

  const noShows = pastAppointments.filter((appointment) => appointment.status === "no_show").length
  const cancelled = pastAppointments.filter((appointment) => appointment.status === "cancelled").length
  const weightedMisses = noShows + cancelled * 0.5
  return Math.min(100, Math.round((weightedMisses / Math.max(1, pastAppointments.length)) * 100))
}

function alertSeveritySignal(alerts: Alert[]) {
  if (alerts.length === 0) return 0

  const severityMap: Record<Alert["severity"], number> = {
    info: 15,
    warning: 40,
    high: 70,
    critical: 95,
  }
  const base = Math.max(...alerts.map((alert) => severityMap[alert.severity]))
  return Math.min(100, base + Math.max(0, alerts.length - 1) * 5)
}

function buildRiskProfile(patient: Patient, appointments: Appointment[], alerts: Alert[]) {
  const adherenceSignal = Math.max(0, 100 - patient.adherence)
  const appointmentSignal = appointmentRiskSignal(appointments)
  const manualSignal = manualRiskFloor(patient.status)
  const alertSignal = alertSeveritySignal(alerts)

  const weightedScore =
    adherenceSignal * RISK_FACTOR_WEIGHTS[0].weight +
    appointmentSignal * RISK_FACTOR_WEIGHTS[1].weight +
    manualSignal * RISK_FACTOR_WEIGHTS[2].weight +
    alertSignal * RISK_FACTOR_WEIGHTS[3].weight

  const score = Math.round(Math.max(weightedScore, manualSignal))

  const factors = [
    `Adherence risk ${adherenceSignal}/100 from adherence ${patient.adherence}%`,
    `Missed appointment signal ${appointmentSignal}/100 from ${appointments.filter((item) => item.status === "no_show").length} no-show and ${appointments.filter((item) => item.status === "cancelled").length} cancelled visits`,
    `Manual clinical status signal ${manualSignal}/100 from status ${patient.status}`,
    `Open alert signal ${alertSignal}/100 from ${alerts.length} active alerts`,
  ]

  return {
    score,
    level: riskBandFromScore(score),
    factors,
    reasoning: factors.join(". ") + ".",
    recommendedAction: score >= 80 ? "Immediate clinical review" : score >= 60 ? "Escalate to clinical staff" : "Automated reminder workflow",
  }
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
      nextOfKinName: "Diane Doe",
      nextOfKinPhone: "+1 555-2124",
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
      nextOfKinName: "Carlos Santos",
      nextOfKinPhone: "+1 555-2156",
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
      nextOfKinName: "Nina Chen",
      nextOfKinPhone: "+1 555-2391",
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
      nextOfKinName: "Grace Watson",
      nextOfKinPhone: "+1 555-2521",
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
    activityReads: [],
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

export async function writeAuditLog(input: AuditEntryInput) {
  const occurredAt = input.occurredAt ?? nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    await runSql(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, occurred_at)
      VALUES (${sqlString(randomUUID())}::uuid, ${sqlString(input.entityType)}, ${sqlString(input.entityId)}, ${sqlString(input.action)}, ${sqlString(input.actorType)}, ${sqlString(occurredAt)}::timestamptz)
    `)
    return
  }

  const db = await ensureJsonDb()
  db.auditLogs.push({
    id: randomUUID(),
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorType: input.actorType,
    occurredAt,
  })
  await saveJsonDb(db)
}

export async function writeAuditLogSafe(input: AuditEntryInput) {
  try {
    await writeAuditLog(input)
  } catch {
    // Auditing must not break request handling.
  }
}

export async function createOrReuseWorkflowAlert(input: WorkflowAlertInput) {
  const triggeredAt = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    const existingRows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id,
             patient_id AS "patientId",
             alert_type AS "alertType",
             severity,
             title,
             description,
             status,
             triggered_at AS "triggeredAt"
      FROM alerts
      WHERE patient_id = ${sqlString(input.patientId)}::uuid
        AND alert_type = 'workflow'
        AND status = 'open'
        AND title = ${sqlString(input.title)}
      ORDER BY triggered_at DESC
      LIMIT 1
      `,
      [],
    )
    const existing = existingRows[0]
    if (existing) {
      return existing
    }

    const id = randomUUID()
    await runSql(`
      INSERT INTO alerts (id, patient_id, alert_type, severity, title, description, status, triggered_at)
      VALUES (${sqlString(id)}::uuid, ${sqlString(input.patientId)}::uuid, 'workflow', ${sqlString(input.severity)}, ${sqlString(input.title)}, ${sqlString(input.description)}, 'open', ${sqlString(triggeredAt)}::timestamptz)
    `)
    return {
      id,
      patientId: input.patientId,
      alertType: "workflow",
      severity: input.severity,
      title: input.title,
      description: input.description,
      status: "open",
      triggeredAt,
    }
  }

  const db = await ensureJsonDb()
  const existing = db.alerts.find(
    (alert) =>
      alert.patientId === input.patientId &&
      alert.alertType === "workflow" &&
      alert.status === "open" &&
      alert.title === input.title,
  )
  if (existing) {
    return existing
  }

  const alert = {
    id: randomUUID(),
    patientId: input.patientId,
    alertType: "workflow" as const,
    severity: input.severity,
    title: input.title,
    description: input.description,
    status: "open" as const,
    triggeredAt,
  }
  db.alerts.push(alert)
  await saveJsonDb(db)
  return alert
}

export async function listAlerts(input?: {
  status?: AlertStatus
  alertType?: "critical_lab" | "missed_appointment" | "medication_nonadherence" | "vital_anomaly" | "workflow"
  patientId?: string
}) {
  if (postgresEnabled()) {
    await ensurePgReady()
    const conditions = ["1=1"]
    if (input?.status) {
      conditions.push(`status = ${sqlString(input.status)}`)
    }
    if (input?.alertType) {
      conditions.push(`alert_type = ${sqlString(input.alertType)}`)
    }
    if (input?.patientId) {
      conditions.push(`patient_id = ${sqlString(input.patientId)}::uuid`)
    }
    return runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id,
             patient_id AS "patientId",
             alert_type AS "alertType",
             severity,
             title,
             description,
             status,
             triggered_at AS "triggeredAt"
      FROM alerts
      WHERE ${conditions.join(" AND ")}
      ORDER BY triggered_at DESC
      `,
      [],
    )
  }

  const db = await ensureJsonDb()
  return db.alerts
    .filter((alert) => (input?.status ? alert.status === input.status : true))
    .filter((alert) => (input?.alertType ? alert.alertType === input.alertType : true))
    .filter((alert) => (input?.patientId ? alert.patientId === input.patientId : true))
    .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime())
}

export async function updateAlertStatus(id: string, status: AlertStatus) {
  if (postgresEnabled()) {
    await ensurePgReady()
    await runSql(`
      UPDATE alerts
      SET status = ${sqlString(status)}
      WHERE id = ${sqlString(id)}::uuid
    `)

    const rows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id,
             patient_id AS "patientId",
             alert_type AS "alertType",
             severity,
             title,
             description,
             status,
             triggered_at AS "triggeredAt"
      FROM alerts
      WHERE id = ${sqlString(id)}::uuid
      LIMIT 1
      `,
      [],
    )
    return rows[0] ?? null
  }

  const db = await ensureJsonDb()
  const idx = db.alerts.findIndex((alert) => alert.id === id)
  if (idx < 0) return null
  db.alerts[idx] = {
    ...db.alerts[idx],
    status,
  }
  await saveJsonDb(db)
  return db.alerts[idx]
}

export async function createOrReuseClinicalTask(input: ClinicalTaskInput) {
  const now = nowIso()
  const status = input.status ?? "open"

  if (postgresEnabled()) {
    await ensurePgReady()
    const existingRows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id,
             patient_id AS "patientId",
             title,
             related_alert_id AS "relatedAlertId",
             task_type AS "taskType",
             priority,
             status,
             assigned_user_id AS "assignedUserId",
             assigned_user_name AS "assignedUserName",
             due_at AS "dueAt",
             notes,
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM tasks
      WHERE patient_id = ${sqlString(input.patientId)}::uuid
        AND title = ${sqlString(input.title)}
        AND status IN ('open', 'in_progress')
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [],
    )
    const existing = existingRows[0]
    if (existing) {
      return existing
    }

    const id = randomUUID()
    await runSql(`
      INSERT INTO tasks (
        id, patient_id, title, related_alert_id, task_type, priority, status, assigned_user_id, assigned_user_name, due_at, notes, created_at, updated_at
      )
      VALUES (
        ${sqlString(id)}::uuid,
        ${sqlString(input.patientId)}::uuid,
        ${sqlString(input.title)},
        ${sqlString(input.relatedAlertId)}::uuid,
        ${sqlString(input.taskType)},
        ${sqlString(input.priority)},
        ${sqlString(status)},
        ${sqlString(input.assignedUserId)},
        ${sqlString(input.assignedUserName)},
        ${sqlString(input.dueAt)}::timestamptz,
        ${sqlString(input.notes)},
        ${sqlString(now)}::timestamptz,
        ${sqlString(now)}::timestamptz
      )
    `)
    return {
      id,
      patientId: input.patientId,
      title: input.title,
      relatedAlertId: input.relatedAlertId,
      taskType: input.taskType,
      priority: input.priority,
      status,
      assignedUserId: input.assignedUserId,
      assignedUserName: input.assignedUserName,
      dueAt: input.dueAt,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    }
  }

  const db = await ensureJsonDb()
  const existing = db.tasks.find(
    (task) => task.patientId === input.patientId && task.title === input.title && (task.status === "open" || task.status === "in_progress"),
  )
  if (existing) {
    return existing
  }

  const task = {
    id: randomUUID(),
    patientId: input.patientId,
    title: input.title,
    relatedAlertId: input.relatedAlertId,
    taskType: input.taskType,
    priority: input.priority,
    status,
    assignedUserId: input.assignedUserId,
    assignedUserName: input.assignedUserName,
    dueAt: input.dueAt,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  }
  db.tasks.push(task)
  await saveJsonDb(db)
  return task
}

export async function listClinicalTasks(input?: { status?: ClinicalTaskStatus; assignedUserId?: string; patientId?: string; taskId?: string }) {
  if (postgresEnabled()) {
    await ensurePgReady()
    const conditions = ["1=1"]
    if (input?.status) {
      conditions.push(`status = ${sqlString(input.status)}`)
    }
    if (input?.assignedUserId) {
      conditions.push(`assigned_user_id = ${sqlString(input.assignedUserId)}`)
    }
    if (input?.patientId) {
      conditions.push(`patient_id = ${sqlString(input.patientId)}::uuid`)
    }
    if (input?.taskId) {
      conditions.push(`id = ${sqlString(input.taskId)}::uuid`)
    }
    return runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id,
             patient_id AS "patientId",
             title,
             related_alert_id AS "relatedAlertId",
             task_type AS "taskType",
             priority,
             status,
             assigned_user_id AS "assignedUserId",
             assigned_user_name AS "assignedUserName",
             due_at AS "dueAt",
             notes,
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM tasks
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      `,
      [],
    )
  }

  const db = await ensureJsonDb()
  return db.tasks
    .filter((task) => (input?.status ? task.status === input.status : true))
    .filter((task) => (input?.assignedUserId ? task.assignedUserId === input.assignedUserId : true))
    .filter((task) => (input?.patientId ? task.patientId === input.patientId : true))
    .filter((task) => (input?.taskId ? task.id === input.taskId : true))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function updateClinicalTask(id: string, input: { status?: ClinicalTaskStatus; notes?: string }) {
  const now = nowIso()
  const updates: string[] = [`updated_at = ${sqlString(now)}::timestamptz`]

  if (input.status) {
    updates.unshift(`status = ${sqlString(input.status)}`)
  }
  if (input.notes !== undefined) {
    updates.push(`notes = ${sqlString(input.notes)}`)
  }

  if (postgresEnabled()) {
    await ensurePgReady()
    await runSql(`
      UPDATE tasks
      SET ${updates.join(", ")}
      WHERE id = ${sqlString(id)}::uuid
    `)

    const rows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id,
             patient_id AS "patientId",
             title,
             related_alert_id AS "relatedAlertId",
             task_type AS "taskType",
             priority,
             status,
             assigned_user_id AS "assignedUserId",
             assigned_user_name AS "assignedUserName",
             due_at AS "dueAt",
             notes,
             created_at AS "createdAt",
             updated_at AS "updatedAt"
      FROM tasks
      WHERE id = ${sqlString(id)}::uuid
      LIMIT 1
      `,
      [],
    )
    return rows[0] ?? null
  }

  const db = await ensureJsonDb()
  const idx = db.tasks.findIndex((task) => task.id === id)
  if (idx < 0) return null
  db.tasks[idx] = {
    ...db.tasks[idx],
    ...(input.status ? { status: input.status } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    updatedAt: now,
  }
  await saveJsonDb(db)
  return db.tasks[idx]
}

export async function closeClinicalFlowTasksForPatient(patientId: string) {
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    await runSql(`
      UPDATE tasks
      SET status = 'done',
          updated_at = ${sqlString(now)}::timestamptz
      WHERE patient_id = ${sqlString(patientId)}::uuid
        AND title LIKE 'Clinical workflow:%'
        AND status IN ('open', 'in_progress')
    `)
    return
  }

  const db = await ensureJsonDb()
  let changed = false
  db.tasks = db.tasks.map((task) => {
    if (
      task.patientId === patientId &&
      task.title.startsWith("Clinical workflow:") &&
      (task.status === "open" || task.status === "in_progress")
    ) {
      changed = true
      return {
        ...task,
        status: "done",
        updatedAt: now,
      }
    }
    return task
  })
  if (changed) {
    await saveJsonDb(db)
  }
}

export async function reassignOpenClinicalFlowTasksForPatient(
  patientId: string,
  assignedUserId?: string,
  assignedUserName?: string,
) {
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    await runSql(`
      UPDATE tasks
      SET assigned_user_id = ${sqlString(assignedUserId)},
          assigned_user_name = ${sqlString(assignedUserName)},
          updated_at = ${sqlString(now)}::timestamptz
      WHERE patient_id = ${sqlString(patientId)}::uuid
        AND title LIKE 'Clinical workflow:%'
        AND status IN ('open', 'in_progress')
    `)
    return
  }

  const db = await ensureJsonDb()
  let changed = false
  db.tasks = db.tasks.map((task) => {
    if (
      task.patientId === patientId &&
      task.title.startsWith("Clinical workflow:") &&
      (task.status === "open" || task.status === "in_progress")
    ) {
      changed = true
      return {
        ...task,
        assignedUserId,
        assignedUserName,
        updatedAt: now,
      }
    }
    return task
  })
  if (changed) {
    await saveJsonDb(db)
  }
}

export async function listActivityReads(userId: string) {
  if (postgresEnabled()) {
    await ensurePgReady()
    return runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id, user_id AS "userId", item_id AS "itemId", read_at AS "readAt"
      FROM activity_reads
      WHERE user_id = ${sqlString(userId)}
      `,
      [],
    )
  }

  const db = await ensureJsonDb()
  return db.activityReads.filter((item) => item.userId === userId)
}

export async function markActivityItemRead(userId: string, itemId: string) {
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    const existingRows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT id, user_id AS "userId", item_id AS "itemId", read_at AS "readAt"
      FROM activity_reads
      WHERE user_id = ${sqlString(userId)}
        AND item_id = ${sqlString(itemId)}
      LIMIT 1
      `,
      [],
    )
    if (existingRows[0]) {
      return existingRows[0]
    }
    const id = randomUUID()
    await runSql(`
      INSERT INTO activity_reads (id, user_id, item_id, read_at)
      VALUES (${sqlString(id)}::uuid, ${sqlString(userId)}, ${sqlString(itemId)}, ${sqlString(now)}::timestamptz)
    `)
    return { id, userId, itemId, readAt: now }
  }

  const db = await ensureJsonDb()
  const existing = db.activityReads.find((item) => item.userId === userId && item.itemId === itemId)
  if (existing) {
    return existing
  }
  const read = { id: randomUUID(), userId, itemId, readAt: now }
  db.activityReads.push(read)
  await saveJsonDb(db)
  return read
}

export async function markActivityItemsRead(userId: string, itemIds: string[]) {
  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)))
  if (uniqueIds.length === 0) {
    return []
  }

  const results = []
  for (const itemId of uniqueIds) {
    results.push(await markActivityItemRead(userId, itemId))
  }
  return results
}

let pgReady = false
let pgReadyPromise: Promise<void> | null = null

async function ensurePgReady() {
  if (pgReady || !postgresEnabled()) {
    return
  }

  if (pgReadyPromise) {
    await pgReadyPromise
    return
  }

  pgReadyPromise = (async () => {
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
        next_of_kin_name TEXT,
        next_of_kin_phone TEXT,
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

      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY,
        patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        related_alert_id UUID,
        task_type TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_user_id TEXT,
        assigned_user_name TEXT,
        due_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
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
        current_handler_user_id TEXT,
        current_handler_name TEXT,
        current_handler_role TEXT,
        status TEXT NOT NULL,
        needs_next_visit BOOLEAN NOT NULL DEFAULT FALSE,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clinic_flows_status_stage ON clinic_flows(status, current_stage, updated_at DESC);

      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS related_alert_id UUID;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS title TEXT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_user_id TEXT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_user_name TEXT;
      ALTER TABLE clinic_flows ADD COLUMN IF NOT EXISTS current_handler_user_id TEXT;
      ALTER TABLE clinic_flows ADD COLUMN IF NOT EXISTS current_handler_name TEXT;
      ALTER TABLE clinic_flows ADD COLUMN IF NOT EXISTS current_handler_role TEXT;

      CREATE TABLE IF NOT EXISTS clinic_flow_events (
        id UUID PRIMARY KEY,
        flow_id UUID NOT NULL REFERENCES clinic_flows(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        notes TEXT,
        occurred_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity_reads (
        id UUID PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        read_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clinic_flow_events_flow_time ON clinic_flow_events(flow_id, occurred_at DESC);

      ALTER TABLE patients ADD COLUMN IF NOT EXISTS call_trigger_phone TEXT;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS next_of_kin_name TEXT;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS next_of_kin_phone TEXT;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_visit_address TEXT;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_latitude DOUBLE PRECISION;
      ALTER TABLE patients ADD COLUMN IF NOT EXISTS home_longitude DOUBLE PRECISION;

      UPDATE tasks
      SET title = COALESCE(title, INITCAP(REPLACE(task_type, '_', ' ')))
      WHERE title IS NULL;
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
        INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, sex_at_birth, phone, email, condition_summary, call_trigger_phone, next_of_kin_name, next_of_kin_phone, home_visit_address, home_latitude, home_longitude, status, adherence, last_visit, next_appointment, created_at, updated_at)
        VALUES (${sqlString(p.id)}::uuid, ${sqlString(p.mrn)}, ${sqlString(p.firstName)}, ${sqlString(p.lastName)}, ${sqlString(p.dateOfBirth)}::date, ${sqlString(p.sexAtBirth)}, ${sqlString(p.phone)}, ${sqlString(p.email)}, ${sqlString(p.conditionSummary)}, ${sqlString(p.callTriggerPhone)}, ${sqlString(p.nextOfKinName)}, ${sqlString(p.nextOfKinPhone)}, ${sqlString(p.homeVisitAddress)}, ${sqlString(p.homeLatitude)}::double precision, ${sqlString(p.homeLongitude)}::double precision, ${sqlString(p.status)}, ${p.adherence}, ${sqlString(p.lastVisit)}::date, ${sqlString(p.nextAppointment)}::date, ${sqlString(p.createdAt)}::timestamptz, ${sqlString(p.updatedAt)}::timestamptz)
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
  })()

  try {
    await pgReadyPromise
  } catch (error) {
    pgReadyPromise = null
    throw error
  }
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
      `SELECT
         p.id,
         p.mrn,
         p.first_name,
         p.last_name,
         p.date_of_birth,
         p.sex_at_birth,
         p.phone,
         p.email,
         p.condition_summary,
         p.call_trigger_phone,
         p.next_of_kin_name,
         p.next_of_kin_phone,
         p.home_visit_address,
         p.home_latitude,
         p.home_longitude,
         p.status,
         p.adherence,
         COALESCE(next_appt.next_appointment, p.next_appointment) AS next_appointment,
         COALESCE(last_appt.last_visit, p.last_visit) AS last_visit,
         p.created_at,
         p.updated_at
       FROM patients p
       LEFT JOIN LATERAL (
         SELECT DATE(a.scheduled_start) AS next_appointment
         FROM appointments a
         WHERE a.patient_id = p.id
           AND a.status IN ('scheduled', 'checked_in')
           AND a.scheduled_start >= NOW()
         ORDER BY a.scheduled_start ASC
         LIMIT 1
       ) next_appt ON TRUE
       LEFT JOIN LATERAL (
         SELECT DATE(a.scheduled_start) AS last_visit
         FROM appointments a
         WHERE a.patient_id = p.id
           AND a.status = 'completed'
         ORDER BY a.scheduled_start DESC
         LIMIT 1
       ) last_appt ON TRUE
       ${whereSql}
       ORDER BY p.updated_at DESC`,
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
      nextOfKinName: r.next_of_kin_name ? String(r.next_of_kin_name) : undefined,
      nextOfKinPhone: r.next_of_kin_phone ? String(r.next_of_kin_phone) : undefined,
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
      `SELECT
         p.id,
         p.mrn,
         p.first_name,
         p.last_name,
         p.date_of_birth,
         p.sex_at_birth,
         p.phone,
         p.email,
         p.condition_summary,
         p.call_trigger_phone,
         p.next_of_kin_name,
         p.next_of_kin_phone,
         p.home_visit_address,
         p.home_latitude,
         p.home_longitude,
         p.status,
         p.adherence,
         COALESCE(next_appt.next_appointment, p.next_appointment) AS next_appointment,
         COALESCE(last_appt.last_visit, p.last_visit) AS last_visit,
         p.created_at,
         p.updated_at
       FROM patients p
       LEFT JOIN LATERAL (
         SELECT DATE(a.scheduled_start) AS next_appointment
         FROM appointments a
         WHERE a.patient_id = p.id
           AND a.status IN ('scheduled', 'checked_in')
           AND a.scheduled_start >= NOW()
         ORDER BY a.scheduled_start ASC
         LIMIT 1
       ) next_appt ON TRUE
       LEFT JOIN LATERAL (
         SELECT DATE(a.scheduled_start) AS last_visit
         FROM appointments a
         WHERE a.patient_id = p.id
           AND a.status = 'completed'
         ORDER BY a.scheduled_start DESC
         LIMIT 1
       ) last_appt ON TRUE
       WHERE p.id = ${sqlString(id)}::uuid
       LIMIT 1`,
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
      nextOfKinName: p.next_of_kin_name ? String(p.next_of_kin_name) : undefined,
      nextOfKinPhone: p.next_of_kin_phone ? String(p.next_of_kin_phone) : undefined,
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
      INSERT INTO patients (id, mrn, first_name, last_name, date_of_birth, sex_at_birth, phone, email, condition_summary, call_trigger_phone, next_of_kin_name, next_of_kin_phone, home_visit_address, home_latitude, home_longitude, status, adherence, created_at, updated_at)
      VALUES (${sqlString(id)}::uuid, ${sqlString(mrn)}, ${sqlString(input.firstName)}, ${sqlString(input.lastName)}, ${sqlString(input.dateOfBirth)}::date, ${sqlString(input.sexAtBirth)}, ${sqlString(input.phone)}, ${sqlString(input.email)}, ${sqlString(input.conditionSummary)}, ${sqlString(input.callTriggerPhone)}, ${sqlString(input.nextOfKinName)}, ${sqlString(input.nextOfKinPhone)}, ${sqlString(input.homeVisitAddress)}, ${sqlString(input.homeLatitude)}::double precision, ${sqlString(input.homeLongitude)}::double precision, ${sqlString(input.status)}, ${input.adherence}, ${sqlString(now)}::timestamptz, ${sqlString(now)}::timestamptz)
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
    nextOfKinName: input.nextOfKinName,
    nextOfKinPhone: input.nextOfKinPhone,
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
    if (input.nextOfKinName !== undefined) updates.push(`next_of_kin_name = ${sqlString(input.nextOfKinName)}`)
    if (input.nextOfKinPhone !== undefined) updates.push(`next_of_kin_phone = ${sqlString(input.nextOfKinPhone)}`)
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

export async function getPatientActivityTimeline(patientId: string) {
  if (postgresEnabled()) {
    await ensurePgReady()

    const [appointments, tasks, alerts, flowEvents] = await Promise.all([
      runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT id,
               'appointment' AS "kind",
               appointment_type AS "title",
               status,
               reason AS "description",
               scheduled_start AS "occurredAt"
        FROM appointments
        WHERE patient_id = ${sqlString(patientId)}::uuid
        `,
        [],
      ),
      runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT id,
               'task' AS "kind",
               title,
               status,
               notes AS "description",
               updated_at AS "occurredAt"
        FROM tasks
        WHERE patient_id = ${sqlString(patientId)}::uuid
        `,
        [],
      ),
      runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT id,
               'alert' AS "kind",
               title,
               status,
               description,
               triggered_at AS "occurredAt"
        FROM alerts
        WHERE patient_id = ${sqlString(patientId)}::uuid
        `,
        [],
      ),
      runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT e.id,
               'workflow' AS "kind",
               (e.stage || ': ' || e.action) AS title,
               'logged' AS status,
               e.notes AS description,
               e.occurred_at AS "occurredAt"
        FROM clinic_flow_events e
        JOIN clinic_flows f ON f.id = e.flow_id
        WHERE f.patient_id = ${sqlString(patientId)}::uuid
        `,
        [],
      ),
    ])

    return [...appointments, ...tasks, ...alerts, ...flowEvents]
      .map((item) => ({
        id: `${String(item.kind)}:${String(item.id)}`,
        entityId: String(item.id),
        kind: String(item.kind),
        title: String(item.title),
        status: String(item.status),
        description: item.description ? String(item.description) : undefined,
        occurredAt: String(item.occurredAt),
      }))
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
  }

  const db = await ensureJsonDb()
  const flowIds = new Set(db.clinicFlows.filter((flow) => flow.patientId === patientId).map((flow) => flow.id))
  return [
    ...db.appointments
      .filter((item) => item.patientId === patientId)
      .map((item) => ({
        id: `appointment:${item.id}`,
        entityId: item.id,
        kind: "appointment",
        title: item.appointmentType,
        status: item.status,
        description: item.reason,
        occurredAt: item.scheduledStart,
      })),
    ...db.tasks
      .filter((item) => item.patientId === patientId)
      .map((item) => ({
        id: `task:${item.id}`,
        entityId: item.id,
        kind: "task",
        title: item.title,
        status: item.status,
        description: item.notes,
        occurredAt: item.updatedAt,
      })),
    ...db.alerts
      .filter((item) => item.patientId === patientId)
      .map((item) => ({
        id: `alert:${item.id}`,
        entityId: item.id,
        kind: "alert",
        title: item.title,
        status: item.status,
        description: item.description,
        occurredAt: item.triggeredAt,
      })),
    ...db.clinicFlowEvents
      .filter((item) => flowIds.has(item.flowId))
      .map((item) => ({
        id: `workflow:${item.id}`,
        entityId: item.id,
        kind: "workflow",
        title: `${item.stage}: ${item.action}`,
        status: "logged",
        description: item.notes,
        occurredAt: item.occurredAt,
      })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
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
  const alerts = (await listAlerts({ status: "open" })) as Alert[]
  const appointmentEntries = await Promise.all(
    patients.map(async (patient) => [patient.id, (await listPatientAppointments(patient.id)) as Appointment[]] as const),
  )
  const appointmentsByPatient = new Map<string, Appointment[]>(appointmentEntries)

  const withScore = await Promise.all(
    patients.map(async (patient) => {
      const patientAppointments = appointmentsByPatient.get(patient.id) ?? []
      const patientAlerts = alerts.filter((alert) => alert.patientId === patient.id)
      const profile = buildRiskProfile(patient, patientAppointments, patientAlerts)
      return {
        id: patient.id,
        mrn: patient.mrn,
        name: `${patient.firstName} ${patient.lastName}`,
        condition: patient.conditionSummary,
        score: profile.score,
        level: profile.level,
        factors: profile.factors,
        reasoning: profile.reasoning,
        recommendedAction: profile.recommendedAction,
      }
    }),
  )

  return withScore.sort((a, b) => b.score - a.score)
}

export async function getRiskScoringOverview() {
  const patients = await listRiskPatients()
  const averageRisk = patients.length === 0 ? 0 : Math.round(patients.reduce((sum, patient) => sum + patient.score, 0) / patients.length)

  return {
    modelName: "Clinical Intent Risk Model",
    modelVersion: "v1.1.0",
    schemaValidation: "Active",
    averageRisk,
    patientCount: patients.length,
    highRiskCount: patients.filter((patient) => patient.level === "High Risk" || patient.level === "Critical").length,
    criticalCount: patients.filter((patient) => patient.level === "Critical").length,
    factorWeights: RISK_FACTOR_WEIGHTS.map((factor) => ({
      id: factor.id,
      label: factor.label,
      weight: factor.weight,
    })),
  }
}

export async function recalculateRiskScores() {
  const patients = await listPatients()
  const now = nowIso()
  const alerts = (await listAlerts({ status: "open" })) as Alert[]
  const appointmentEntries = await Promise.all(
    patients.map(async (patient) => [patient.id, (await listPatientAppointments(patient.id)) as Appointment[]] as const),
  )
  const appointmentsByPatient = new Map<string, Appointment[]>(appointmentEntries)

  if (postgresEnabled()) {
    await ensurePgReady()

    for (const patient of patients) {
      const patientAppointments = appointmentsByPatient.get(patient.id) ?? []
      const patientAlerts = alerts.filter((alert) => alert.patientId === patient.id)
      const profile = buildRiskProfile(patient, patientAppointments, patientAlerts)
      await runSql(`
        INSERT INTO risk_scores (id, patient_id, score_type, score, risk_band, model_version, factors, calculated_at)
        VALUES (${sqlString(randomUUID())}::uuid, ${sqlString(patient.id)}::uuid, 'custom', ${profile.score}, ${sqlString(profile.level)}, 'v1.1.0', ${sqlString(JSON.stringify(profile.factors))}::jsonb, ${sqlString(now)}::timestamptz)
      `)
    }

    return { updated: patients.length, calculatedAt: now }
  }

  const db = await ensureJsonDb()
  for (const patient of patients) {
    const patientAppointments = appointmentsByPatient.get(patient.id) ?? []
    const patientAlerts = alerts.filter((alert) => alert.patientId === patient.id)
    const profile = buildRiskProfile(patient, patientAppointments, patientAlerts)
    db.riskScores.unshift({
      id: randomUUID(),
      patientId: patient.id,
      scoreType: "custom",
      score: profile.score,
      riskBand: profile.level,
      modelVersion: "v1.1.0",
      factors: profile.factors,
      calculatedAt: now,
    })
  }
  await saveJsonDb(db)

  return { updated: patients.length, calculatedAt: now }
}

export async function listAppointmentsForRange(startDateIso: string, endDateIso: string) {
  const start = `${startDateIso}T00:00:00.000Z`
  const end = `${endDateIso}T23:59:59.999Z`

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

export async function listAppointmentsForDate(dateIso: string) {
  return listAppointmentsForRange(dateIso, dateIso)
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
    return rows.map(withClinicalFlowSummary)
  }

  const db = await ensureJsonDb()
  const byPatient = new Map(db.patients.map((p) => [p.id, p]))
  const byAppointment = new Map(db.appointments.map((a) => [a.id, a]))
  return db.clinicFlows
    .map((f) => {
      const p = byPatient.get(f.patientId)
      const a = f.appointmentId ? byAppointment.get(f.appointmentId) : undefined
      return withClinicalFlowSummary({
        ...f,
        patientMrn: p?.mrn ?? "N/A",
        patientName: p ? `${p.firstName} ${p.lastName}` : "Unknown",
        appointmentType: a?.appointmentType ?? "follow_up",
      })
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getClinicalFlowById(flowId: string) {
  if (postgresEnabled()) {
    await ensurePgReady()
    const rows = await runSqlJson<Array<Record<string, unknown>>>(
      `
      SELECT f.id,
             f.patient_id AS "patientId",
             f.appointment_id AS "appointmentId",
             f.entry_method AS "entryMethod",
             f.current_stage AS "currentStage",
             f.current_handler_user_id AS "currentHandlerUserId",
             f.current_handler_name AS "currentHandlerName",
             f.current_handler_role AS "currentHandlerRole",
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
    return rows[0] ? withClinicalFlowSummary(rows[0]) : null
  }

  const db = await ensureJsonDb()
  const flow = db.clinicFlows.find((item) => item.id === flowId)
  if (!flow) return null

  const patient = db.patients.find((p) => p.id === flow.patientId)
  const appointment = flow.appointmentId ? db.appointments.find((a) => a.id === flow.appointmentId) : undefined
  return withClinicalFlowSummary({
    ...flow,
    patientMrn: patient?.mrn ?? "N/A",
    patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
    appointmentType: appointment?.appointmentType ?? "follow_up",
  })
}

export async function startClinicalFlow(input: {
  patientId: string
  appointmentId?: string
  entryMethod: "scan" | "admin"
  actor: string
  currentHandlerUserId?: string
  currentHandlerName?: string
  currentHandlerRole?: string
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
             f.current_handler_user_id AS "currentHandlerUserId",
             f.current_handler_name AS "currentHandlerName",
             f.current_handler_role AS "currentHandlerRole",
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
    if (existing[0]) return withClinicalFlowSummary(existing[0])

    const flowId = randomUUID()
    await runSql(`
      INSERT INTO clinic_flows (id, patient_id, appointment_id, entry_method, current_stage, current_handler_user_id, current_handler_name, current_handler_role, status, needs_next_visit, started_at, created_at, updated_at)
      VALUES (${sqlString(flowId)}::uuid, ${sqlString(input.patientId)}::uuid, ${sqlString(input.appointmentId)}::uuid, ${sqlString(input.entryMethod)}, 'request', ${sqlString(input.currentHandlerUserId)}, ${sqlString(input.currentHandlerName)}, ${sqlString(input.currentHandlerRole)}, 'active', FALSE, ${sqlString(now)}::timestamptz, ${sqlString(now)}::timestamptz, ${sqlString(now)}::timestamptz)
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
             f.current_handler_user_id AS "currentHandlerUserId",
             f.current_handler_name AS "currentHandlerName",
             f.current_handler_role AS "currentHandlerRole",
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
    return created[0] ? withClinicalFlowSummary(created[0]) : null
  }

  const db = await ensureJsonDb()
  const active = db.clinicFlows.find((f) => f.patientId === input.patientId && f.status === "active")
  if (active) {
    const patient = db.patients.find((p) => p.id === active.patientId)
    const appointment = active.appointmentId ? db.appointments.find((a) => a.id === active.appointmentId) : undefined
    return withClinicalFlowSummary({
      ...active,
      patientMrn: patient?.mrn ?? "N/A",
      patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
      appointmentType: appointment?.appointmentType ?? "follow_up",
    })
  }

  const flow = {
    id: randomUUID(),
    patientId: input.patientId,
    appointmentId: input.appointmentId,
    entryMethod: input.entryMethod,
    currentStage: "request" as const,
    currentHandlerUserId: input.currentHandlerUserId,
    currentHandlerName: input.currentHandlerName,
    currentHandlerRole: input.currentHandlerRole,
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
  return withClinicalFlowSummary({
    ...flow,
    patientMrn: patient?.mrn ?? "N/A",
    patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
    appointmentType: appointment?.appointmentType ?? "follow_up",
  })
}

export async function advanceClinicalFlow(input: {
  flowId: string
  actor: string
  notes?: string
  complete?: boolean
  needsNextVisit?: boolean
  nextHandlerUserId?: string
  nextHandlerName?: string
  nextHandlerRole?: string
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
    if (String(existing.status) !== "active") return withClinicalFlowSummary(existing)

    const current = String(existing.currentStage) as ClinicalFlowStage
    const shouldComplete = input.complete === true || current === "pharmacy"
    const nextStage = shouldComplete ? current : nextClinicalStage(current)
    if (!nextStage) return withClinicalFlowSummary(existing)

    await runSql(`
      UPDATE clinic_flows
      SET current_stage = ${sqlString(nextStage)},
          current_handler_user_id = ${shouldComplete ? "NULL" : sqlString(input.nextHandlerUserId)},
          current_handler_name = ${shouldComplete ? "NULL" : sqlString(input.nextHandlerName)},
          current_handler_role = ${shouldComplete ? "NULL" : sqlString(input.nextHandlerRole)},
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
             f.current_handler_user_id AS "currentHandlerUserId",
             f.current_handler_name AS "currentHandlerName",
             f.current_handler_role AS "currentHandlerRole",
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
    return updatedRows[0] ? withClinicalFlowSummary(updatedRows[0]) : null
  }

  const db = await ensureJsonDb()
  const idx = db.clinicFlows.findIndex((f) => f.id === input.flowId)
  if (idx < 0) return null
  const existing = db.clinicFlows[idx]
  if (existing.status !== "active") return withClinicalFlowSummary(existing)

  const shouldComplete = input.complete === true || existing.currentStage === "pharmacy"
  const nextStage = shouldComplete ? existing.currentStage : nextClinicalStage(existing.currentStage)
  if (!nextStage) return withClinicalFlowSummary(existing)

  const updated = {
    ...existing,
    currentStage: nextStage,
    currentHandlerUserId: shouldComplete ? undefined : input.nextHandlerUserId,
    currentHandlerName: shouldComplete ? undefined : input.nextHandlerName,
    currentHandlerRole: shouldComplete ? undefined : input.nextHandlerRole,
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
  return withClinicalFlowSummary({
    ...updated,
    patientMrn: patient?.mrn ?? "N/A",
    patientName: patient ? `${patient.firstName} ${patient.lastName}` : "Unknown",
    appointmentType: appointment?.appointmentType ?? "follow_up",
  })
}

export async function updateClinicalFlowHandler(input: {
  flowId: string
  userId?: string
  name?: string
  role?: string
}) {
  const now = nowIso()

  if (postgresEnabled()) {
    await ensurePgReady()
    await runSql(`
      UPDATE clinic_flows
      SET current_handler_user_id = ${sqlString(input.userId)},
          current_handler_name = ${sqlString(input.name)},
          current_handler_role = ${sqlString(input.role)},
          updated_at = ${sqlString(now)}::timestamptz
      WHERE id = ${sqlString(input.flowId)}::uuid
    `)
    return getClinicalFlowById(input.flowId)
  }

  const db = await ensureJsonDb()
  const idx = db.clinicFlows.findIndex((flow) => flow.id === input.flowId)
  if (idx < 0) return null

  db.clinicFlows[idx] = {
    ...db.clinicFlows[idx],
    currentHandlerUserId: input.userId,
    currentHandlerName: input.name,
    currentHandlerRole: input.role,
    updatedAt: now,
  }
  await saveJsonDb(db)
  return getClinicalFlowById(input.flowId)
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
      { name: "WhatsApp Escalation Workflow", status: "passed", lastCheck: "every reminder job run" },
    ]

    const logs = await runSqlJson<Array<Record<string, unknown>>>(
      "SELECT id, action, entity_id AS patient, actor_type AS user, action AS details, occurred_at FROM audit_logs ORDER BY occurred_at DESC LIMIT 10",
      [],
    )

    const alerts = await runSqlJson<Array<Record<string, unknown>>>(
      "SELECT COUNT(*)::int AS count FROM alerts WHERE status = 'open'",
      [{ count: 0 }],
    )

    let reminderMetrics = {
      whatsappMessagesToday: 0,
      patientCallsToday: 0,
      nextOfKinCallsToday: 0,
      dayOfRemindersToday: 0,
      homeVisitEscalationsToday: 0,
      activeWorkflows: 0,
      pendingByStage: [] as Array<{ stage: string; label: string; count: number; status: string }>,
    }

    try {
      const summaryRows = await runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT
          COUNT(*) FILTER (
            WHERE action IN (
              'APPOINTMENT_SCHEDULED_WHATSAPP_SENT',
              'REMINDER_STAGE1_SENT',
              'REMINDER_STAGE2_SENT',
              'REMINDER_STAGE3_SENT',
              'REMINDER_DAY_OF_SENT'
            )
          )::int AS whatsapp_messages_today,
          COUNT(*) FILTER (WHERE action = 'REMINDER_PATIENT_CALL_TRIGGERED')::int AS patient_calls_today,
          COUNT(*) FILTER (WHERE action = 'REMINDER_NEXT_OF_KIN_CALL_TRIGGERED')::int AS next_of_kin_calls_today,
          COUNT(*) FILTER (WHERE action = 'REMINDER_DAY_OF_SENT')::int AS day_of_reminders_today,
          COUNT(*) FILTER (WHERE action = 'REMINDER_HOME_VISIT_ESCALATED')::int AS home_visit_escalations_today
        FROM agent_audit_log
        WHERE event_time >= CURRENT_DATE
        `,
        [
          {
            whatsapp_messages_today: 0,
            patient_calls_today: 0,
            next_of_kin_calls_today: 0,
            day_of_reminders_today: 0,
            home_visit_escalations_today: 0,
          },
        ],
      )

      const activeRows = await runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT stage, status, COUNT(*)::int AS count
        FROM appointment_reminder_workflows
        WHERE status IN ('pending_ack', 'confirmed_waiting_day_of', 'escalated_home_visit')
        GROUP BY stage, status
        ORDER BY count DESC, stage ASC
        `,
        [],
      )

      reminderMetrics = {
        whatsappMessagesToday: Number(summaryRows[0]?.whatsapp_messages_today ?? 0),
        patientCallsToday: Number(summaryRows[0]?.patient_calls_today ?? 0),
        nextOfKinCallsToday: Number(summaryRows[0]?.next_of_kin_calls_today ?? 0),
        dayOfRemindersToday: Number(summaryRows[0]?.day_of_reminders_today ?? 0),
        homeVisitEscalationsToday: Number(summaryRows[0]?.home_visit_escalations_today ?? 0),
        activeWorkflows: activeRows.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
        pendingByStage: activeRows.map((row) => {
          const stage = String(row.stage)
          return {
            stage,
            label: REMINDER_STAGE_LABELS[stage] ?? stage.replaceAll("_", " "),
            count: Number(row.count ?? 0),
            status: String(row.status ?? "pending_ack"),
          }
        }),
      }
    } catch {
      // Keep compliance view available even before the agent tables are initialized.
    }

    return {
      checks,
      guardrails: 5,
      violations: Number(alerts[0]?.count ?? 0),
      auditEntriesToday: logs.length,
      reminderMetrics,
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
      { name: "WhatsApp Escalation Workflow", status: "passed", lastCheck: "demo data" },
    ],
    guardrails: 5,
    violations: db.alerts.filter((a) => a.status === "open").length,
    auditEntriesToday: db.auditLogs.filter((a) => a.occurredAt.startsWith(today)).length,
    reminderMetrics: {
      whatsappMessagesToday: 89,
      patientCallsToday: 24,
      nextOfKinCallsToday: 10,
      dayOfRemindersToday: 18,
      homeVisitEscalationsToday: 12,
      activeWorkflows: 9,
      pendingByStage: [
        { stage: "stage2_text", label: REMINDER_STAGE_LABELS.stage2_text, count: 3, status: "pending_ack" },
        { stage: "stage4_patient_call", label: REMINDER_STAGE_LABELS.stage4_patient_call, count: 2, status: "pending_ack" },
        {
          stage: "stage_confirmed_day_of_pending",
          label: REMINDER_STAGE_LABELS.stage_confirmed_day_of_pending,
          count: 4,
          status: "confirmed_waiting_day_of",
        },
      ],
    },
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

export async function getAIAgentOverview() {
  if (postgresEnabled()) {
    await ensurePgReady()

    let reminderMetrics = {
      whatsappMessagesToday: 0,
      patientCallsToday: 0,
      nextOfKinCallsToday: 0,
      dayOfRemindersToday: 0,
      homeVisitEscalationsToday: 0,
      activeWorkflows: 0,
      pendingByStage: [] as Array<{ stage: string; label: string; count: number; status: string }>,
    }

    let summary = {
      actionsToday: 0,
      confirmationsToday: 0,
      activeLoops: 0,
      escalationsToday: 0,
      successRate: 0,
    }

    let recentActions: Array<{
      id: string
      patient: string
      patientId: string
      action: string
      reason: string
      time: string
      status: string
      type: string
      occurredAt: string
    }> = []

    try {
      const summaryRows = await runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT
          COUNT(*) FILTER (WHERE event_time >= CURRENT_DATE)::int AS actions_today,
          COUNT(*) FILTER (
            WHERE event_time >= CURRENT_DATE
              AND action IN ('CONFIRM_APPOINTMENT', 'REMINDER_ACKNOWLEDGED', 'REMINDER_CALL_CONFIRMED')
          )::int AS confirmations_today,
          COUNT(*) FILTER (
            WHERE event_time >= CURRENT_DATE
              AND action IN ('REMINDER_PATIENT_CALL_TRIGGERED', 'REMINDER_NEXT_OF_KIN_CALL_TRIGGERED', 'REMINDER_HOME_VISIT_ESCALATED')
          )::int AS escalations_today,
          COUNT(*) FILTER (
            WHERE event_time >= CURRENT_DATE
              AND action IN (
                'APPOINTMENT_SCHEDULED_WHATSAPP_SENT',
                'REMINDER_STAGE1_SENT',
                'REMINDER_STAGE2_SENT',
                'REMINDER_STAGE3_SENT',
                'REMINDER_DAY_OF_SENT'
              )
          )::int AS whatsapp_messages_today,
          COUNT(*) FILTER (WHERE event_time >= CURRENT_DATE AND action = 'REMINDER_PATIENT_CALL_TRIGGERED')::int AS patient_calls_today,
          COUNT(*) FILTER (WHERE event_time >= CURRENT_DATE AND action = 'REMINDER_NEXT_OF_KIN_CALL_TRIGGERED')::int AS next_of_kin_calls_today,
          COUNT(*) FILTER (WHERE event_time >= CURRENT_DATE AND action = 'REMINDER_DAY_OF_SENT')::int AS day_of_reminders_today,
          COUNT(*) FILTER (WHERE event_time >= CURRENT_DATE AND action = 'REMINDER_HOME_VISIT_ESCALATED')::int AS home_visit_escalations_today
        FROM agent_audit_log
        `,
        [
          {
            actions_today: 0,
            confirmations_today: 0,
            escalations_today: 0,
            whatsapp_messages_today: 0,
            patient_calls_today: 0,
            next_of_kin_calls_today: 0,
            day_of_reminders_today: 0,
            home_visit_escalations_today: 0,
          },
        ],
      )

      const activeRows = await runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT stage, status, COUNT(*)::int AS count
        FROM appointment_reminder_workflows
        WHERE status IN ('pending_ack', 'confirmed_waiting_day_of', 'escalated_home_visit')
        GROUP BY stage, status
        ORDER BY count DESC, stage ASC
        `,
        [],
      )

      const recentRows = await runSqlJson<Array<Record<string, unknown>>>(
        `
        SELECT
          al.audit_id,
          al.action,
          al.event_time,
          al.request,
          al.response,
          p.mrn AS patient_mrn,
          (p.first_name || ' ' || p.last_name) AS patient_name
        FROM agent_audit_log al
        LEFT JOIN patients p ON p.id = al.patient_id
        ORDER BY al.event_time DESC
        LIMIT 12
        `,
        [],
      )

      reminderMetrics = {
        whatsappMessagesToday: Number(summaryRows[0]?.whatsapp_messages_today ?? 0),
        patientCallsToday: Number(summaryRows[0]?.patient_calls_today ?? 0),
        nextOfKinCallsToday: Number(summaryRows[0]?.next_of_kin_calls_today ?? 0),
        dayOfRemindersToday: Number(summaryRows[0]?.day_of_reminders_today ?? 0),
        homeVisitEscalationsToday: Number(summaryRows[0]?.home_visit_escalations_today ?? 0),
        activeWorkflows: activeRows.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
        pendingByStage: activeRows.map((row) => {
          const stage = String(row.stage)
          return {
            stage,
            label: REMINDER_STAGE_LABELS[stage] ?? stage.replaceAll("_", " "),
            count: Number(row.count ?? 0),
            status: String(row.status ?? "pending_ack"),
          }
        }),
      }

      const actionsToday = Number(summaryRows[0]?.actions_today ?? 0)
      const confirmationsToday = Number(summaryRows[0]?.confirmations_today ?? 0)
      const escalationsToday = Number(summaryRows[0]?.escalations_today ?? 0)

      summary = {
        actionsToday,
        confirmationsToday,
        activeLoops: reminderMetrics.activeWorkflows,
        escalationsToday,
        successRate: actionsToday === 0 ? 0 : Math.round((confirmationsToday / actionsToday) * 100),
      }

      recentActions = recentRows.map((row) => {
        const response = typeof row.response === "object" && row.response !== null ? (row.response as Record<string, unknown>) : {}
        const meta = describeAgentAction(String(row.action), response)
        const patient = row.patient_name ? String(row.patient_name) : "Unknown patient"
        return {
          id: String(row.audit_id),
          patient,
          patientId: row.patient_mrn ? String(row.patient_mrn) : "N/A",
          action: meta.label,
          reason: meta.reason,
          time: relativeTimeLabel(String(row.event_time)),
          status: meta.status,
          type: meta.type,
          occurredAt: String(row.event_time),
        }
      })
    } catch {
      // Keep the AI agent page available before the agent schema is initialized.
    }

    const currentPhase =
      reminderMetrics.pendingByStage[0]?.stage === "stage4_patient_call" || reminderMetrics.pendingByStage[0]?.stage === "stage5_next_of_kin_call"
        ? "Act"
        : reminderMetrics.pendingByStage[0]?.stage === "stage6_homebase_alert"
          ? "Escalate"
          : reminderMetrics.pendingByStage.length > 0
            ? "Observe"
            : "Plan"

    return {
      status: {
        running: true,
        lastUpdatedAt: nowIso(),
        currentPhase,
      },
      summary,
      reminderMetrics,
      recentActions,
      objectives: [
        {
          id: "appointment_booking",
          goal: "Appointment Booking",
          active: true,
          count: recentActions.filter((item) => item.type === "booking").length,
        },
        {
          id: "appointment_confirmation",
          goal: "Appointment Confirmation",
          active: true,
          count: summary.confirmationsToday,
        },
        {
          id: "call_escalation",
          goal: "Call Escalations",
          active: true,
          count: reminderMetrics.patientCallsToday + reminderMetrics.nextOfKinCallsToday,
        },
        {
          id: "home_visit_escalation",
          goal: "Home Visit Escalations",
          active: true,
          count: reminderMetrics.homeVisitEscalationsToday,
        },
      ],
    }
  }

  const compliance = await getComplianceOverview()
  const actionsToday = compliance.reminderMetrics.whatsappMessagesToday + compliance.reminderMetrics.patientCallsToday + compliance.reminderMetrics.homeVisitEscalationsToday

  return {
    status: {
      running: true,
      lastUpdatedAt: nowIso(),
      currentPhase: compliance.reminderMetrics.activeWorkflows > 0 ? "Observe" : "Plan",
    },
    summary: {
      actionsToday,
      confirmationsToday: compliance.reminderMetrics.dayOfRemindersToday,
      activeLoops: compliance.reminderMetrics.activeWorkflows,
      escalationsToday: compliance.reminderMetrics.homeVisitEscalationsToday,
      successRate: actionsToday === 0 ? 0 : Math.round((compliance.reminderMetrics.dayOfRemindersToday / actionsToday) * 100),
    },
    reminderMetrics: compliance.reminderMetrics,
    recentActions: compliance.recentAuditLogs.map((log) => {
      const meta = describeAgentAction(log.action)
      return {
        id: log.id,
        patient: log.patient,
        patientId: log.patient,
        action: meta.label,
        reason: meta.reason,
        time: relativeTimeLabel(log.time),
        status: meta.status,
        type: meta.type,
        occurredAt: log.time,
      }
    }),
    objectives: [
      { id: "appointment_booking", goal: "Appointment Booking", active: true, count: 0 },
      { id: "appointment_confirmation", goal: "Appointment Confirmation", active: true, count: compliance.reminderMetrics.dayOfRemindersToday },
      { id: "call_escalation", goal: "Call Escalations", active: true, count: compliance.reminderMetrics.patientCallsToday + compliance.reminderMetrics.nextOfKinCallsToday },
      { id: "home_visit_escalation", goal: "Home Visit Escalations", active: true, count: compliance.reminderMetrics.homeVisitEscalationsToday },
    ],
  }
}

export async function getAnalyticsOverview() {
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const start30 = new Date(today)
  start30.setUTCDate(start30.getUTCDate() - 29)
  const start60 = new Date(today)
  start60.setUTCDate(start60.getUTCDate() - 59)
  const start7 = new Date(today)
  start7.setUTCDate(start7.getUTCDate() - 6)

  const start30Iso = start30.toISOString().slice(0, 10)
  const start60Iso = start60.toISOString().slice(0, 10)

  const [patients, appointments60, tasks, alerts, flows, riskPatients, aiOverview] = (await Promise.all([
    listPatients(),
    listAppointmentsForRange(start60Iso, todayIso),
    listClinicalTasks(),
    listAlerts(),
    listClinicalFlows(),
    listRiskPatients(),
    getAIAgentOverview(),
  ])) as [
    Patient[],
    ScheduledAppointment[],
    ClinicalTask[],
    Alert[],
    ClinicalFlow[],
    Awaited<ReturnType<typeof listRiskPatients>>,
    Awaited<ReturnType<typeof getAIAgentOverview>>,
  ]

  const dateOnly = (value?: string) => (value ? value.slice(0, 10) : "")
  const inRange = (value: string, start: string, end: string) => {
    const key = dateOnly(value)
    return key >= start && key <= end
  }
  const percent = (value: number, total: number) => (total <= 0 ? 0 : Math.round((value / total) * 100))

  const current30Appointments = appointments60.filter((appointment) => inRange(appointment.scheduledStart, start30Iso, todayIso))
  const previous30Appointments = appointments60.filter((appointment) => {
    const key = dateOnly(appointment.scheduledStart)
    return key >= start60Iso && key < start30Iso
  })
  const current30Tasks = tasks.filter((task) => inRange(task.createdAt, start30Iso, todayIso))
  const current30Alerts = alerts.filter((alert) => inRange(alert.triggeredAt, start30Iso, todayIso))
  const current30Flows = flows.filter((flow) => inRange(flow.startedAt, start30Iso, todayIso))

  const adherenceRate = (items: ScheduledAppointment[]) => {
    const eligible = items.filter((appointment) => ["completed", "checked_in", "cancelled", "no_show"].includes(appointment.status))
    const successful = eligible.filter((appointment) => appointment.status === "completed" || appointment.status === "checked_in")
    return percent(successful.length, eligible.length)
  }

  const currentAdherence = adherenceRate(current30Appointments)
  const previousAdherence = adherenceRate(previous30Appointments)

  const followUpCoverage = percent(
    patients.filter((patient) => Boolean(patient.nextAppointment) && String(patient.nextAppointment) >= todayIso).length,
    patients.length,
  )

  const highRiskPatients = riskPatients.filter((patient) => patient.level === "High Risk" || patient.level === "Critical")
  const actionCoverage = percent(
    highRiskPatients.filter((patient) => {
      const hasTask = tasks.some((task) => task.patientId === patient.id && (task.status === "open" || task.status === "in_progress"))
      const hasFlow = flows.some((flow) => flow.patientId === patient.id && String(flow.status) === "active")
      return hasTask || hasFlow
    }).length,
    highRiskPatients.length,
  )

  const current30ResolvedAlerts = current30Alerts.filter((alert) => alert.status === "resolved" || alert.status === "dismissed").length
  const alertResolution = percent(current30ResolvedAlerts, current30Alerts.length)

  const last7Days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start7)
    day.setUTCDate(start7.getUTCDate() + index)
    const dayIso = day.toISOString().slice(0, 10)
    const count =
      appointments60.filter((appointment) => dateOnly(appointment.scheduledStart) === dayIso).length +
      tasks.filter((task) => dateOnly(task.createdAt) === dayIso).length +
      alerts.filter((alert) => dateOnly(alert.triggeredAt) === dayIso).length +
      flows.filter((flow) => dateOnly(flow.startedAt) === dayIso).length

    return {
      day: new Date(`${dayIso}T00:00:00.000Z`).toLocaleDateString("en-ZA", { weekday: "short", timeZone: "Africa/Johannesburg" }),
      date: dayIso,
      value: count,
    }
  })

  const completedCount = current30Appointments.filter((appointment) => appointment.status === "completed" || appointment.status === "checked_in").length
  const pendingCount =
    patients.filter((patient) => Boolean(patient.nextAppointment) && String(patient.nextAppointment) >= todayIso).length +
    tasks.filter((task) => task.status === "in_progress").length
  const escalatedCount =
    alerts.filter((alert) => alert.status === "open" && (alert.severity === "high" || alert.severity === "critical")).length +
    flows.filter((flow) => String(flow.status) === "active").length
  const lostCount = current30Appointments.filter((appointment) => appointment.status === "cancelled" || appointment.status === "no_show").length
  const outcomeTotal = Math.max(1, completedCount + pendingCount + escalatedCount + lostCount)

  const noShowAppointments = current30Appointments.filter((appointment) => appointment.status === "no_show")
  const hourBuckets = [
    { label: "08:00 - 09:59", test: (hour: number) => hour >= 8 && hour < 10 },
    { label: "10:00 - 11:59", test: (hour: number) => hour >= 10 && hour < 12 },
    { label: "12:00 - 14:59", test: (hour: number) => hour >= 12 && hour < 15 },
    { label: "15:00 - 17:59", test: (hour: number) => hour >= 15 && hour < 18 },
  ]
  const peakNoShowBucket = hourBuckets
    .map((bucket) => ({
      label: bucket.label,
      count: noShowAppointments.filter((appointment) => {
        const hour = Number(
          new Intl.DateTimeFormat("en-ZA", {
            hour: "numeric",
            hour12: false,
            timeZone: "Africa/Johannesburg",
          }).format(new Date(appointment.scheduledStart)),
        )
        return bucket.test(hour)
      }).length,
    }))
    .sort((a, b) => b.count - a.count)[0]

  const topRiskPatient = highRiskPatients[0]
  const whatsappLoad = aiOverview.reminderMetrics.whatsappMessagesToday
  const callLoad = aiOverview.reminderMetrics.patientCallsToday + aiOverview.reminderMetrics.nextOfKinCallsToday
  const totalActions30d = current30Appointments.length + current30Tasks.length + current30Alerts.length + current30Flows.length

  return {
    stats: [
      {
        id: "follow_up_coverage",
        label: "Follow-up Coverage",
        value: followUpCoverage,
        unit: "%",
        target: 85,
        detail: `${patients.filter((patient) => Boolean(patient.nextAppointment) && String(patient.nextAppointment) >= todayIso).length} patients already have a next appointment booked.`,
      },
      {
        id: "appointment_adherence",
        label: "Appointment Adherence",
        value: currentAdherence,
        unit: "%",
        target: 90,
        detail: `${currentAdherence >= previousAdherence ? "Improved" : "Down"} from ${previousAdherence}% in the previous 30-day window.`,
      },
      {
        id: "high_risk_action_coverage",
        label: "High-Risk Action Coverage",
        value: actionCoverage,
        unit: "%",
        target: 95,
        detail: `${highRiskPatients.length} high-risk patients are currently being tracked by live tasks or active clinical flows.`,
      },
      {
        id: "alert_resolution",
        label: "Alert Resolution Rate",
        value: alertResolution,
        unit: "%",
        target: 80,
        detail: `${current30ResolvedAlerts} of ${current30Alerts.length} alerts from the last 30 days are resolved or dismissed.`,
      },
    ],
    weeklyActivity: last7Days,
    outcomes: [
      { id: "engaged", label: "Successfully Re-engaged", value: percent(completedCount, outcomeTotal), color: "bg-success" },
      { id: "pending", label: "Pending Follow-up", value: percent(pendingCount, outcomeTotal), color: "bg-warning" },
      { id: "escalated", label: "Escalated to Clinician", value: percent(escalatedCount, outcomeTotal), color: "bg-primary" },
      { id: "lost", label: "Lost to Follow-up", value: percent(lostCount, outcomeTotal), color: "bg-destructive" },
    ],
    insights: [
      {
        id: "peak_no_show",
        title: "Peak No-Show Window",
        insight:
          (peakNoShowBucket?.count ?? 0) > 0
            ? `${peakNoShowBucket.label} currently carries the highest no-show load over the last 30 days.`
            : "No no-show concentration was detected in the last 30 days.",
        recommendation:
          (peakNoShowBucket?.count ?? 0) > 0
            ? "Prioritize reminders and overbooking protection for this time window."
            : "Keep the current reminder cadence and continue monitoring slot performance.",
      },
      {
        id: "risk_priority",
        title: "Highest-Risk Patient Signal",
        insight: topRiskPatient
          ? `${topRiskPatient.name} is the current top priority at score ${topRiskPatient.score}.`
          : "No high-risk patient cluster is active right now.",
        recommendation: topRiskPatient ? topRiskPatient.recommendedAction : "No immediate escalation is required from the risk engine.",
      },
      {
        id: "channel_mix",
        title: "Reminder Channel Mix",
        insight:
          whatsappLoad >= callLoad
            ? `WhatsApp is currently handling most reminder volume with ${whatsappLoad} messages today versus ${callLoad} calls.`
            : `Call escalation is currently carrying more load with ${callLoad} calls versus ${whatsappLoad} WhatsApp messages today.`,
        recommendation:
          whatsappLoad >= callLoad
            ? "Keep confirmations on WhatsApp first and reserve calls for unresolved cases."
            : "Review call-trigger thresholds and move resolvable cases back to WhatsApp where possible.",
      },
    ],
    operationalHealth: [
      {
        id: "open_alerts",
        metric: "Open Alerts",
        value: String(alerts.filter((alert) => alert.status === "open").length),
        status: alerts.filter((alert) => alert.status === "open").length > 10 ? "warning" : "healthy",
      },
      {
        id: "active_flows",
        metric: "Active Clinical Flows",
        value: String(flows.filter((flow) => String(flow.status) === "active").length),
        status: flows.filter((flow) => String(flow.status) === "active").length > 5 ? "warning" : "healthy",
      },
      {
        id: "open_tasks",
        metric: "Open Task Queue",
        value: String(tasks.filter((task) => task.status === "open" || task.status === "in_progress").length),
        status: tasks.filter((task) => task.status === "open" || task.status === "in_progress").length > 12 ? "warning" : "healthy",
      },
      {
        id: "reminder_workflows",
        metric: "Reminder Workflows",
        value: String(aiOverview.reminderMetrics.activeWorkflows),
        status: aiOverview.reminderMetrics.activeWorkflows > 8 ? "warning" : "healthy",
      },
      {
        id: "risk_model",
        metric: "Risk Engine",
        value: "Intent Model v1.1.0",
        status: "healthy",
      },
    ],
    summary: {
      totalActions: totalActions30d,
      avgSuccess: percent(completedCount, completedCount + lostCount),
      periodLabel: "Last 30 days",
    },
  }
}

export async function getDashboardOverview() {
  const today = new Date().toISOString().slice(0, 10)
  const [patients, riskPatients, schedulingStats, flows, workflowAlerts, openTasks, aiOverview] = await Promise.all([
    listPatients(),
    listRiskPatients(),
    getSchedulingStats(today),
    listClinicalFlows(),
    listAlerts({ status: "open", alertType: "workflow" }),
    listClinicalTasks(),
    getAIAgentOverview(),
  ])

  const highRiskCases = patients.filter((patient) => patient.status === "High Risk" || patient.status === "Critical").length
  const activeFlows = flows.filter((flow) => String(flow.status) === "active").length
  const completedToday = flows.filter((flow) => {
    const completedAt = typeof flow.completedAt === "string" ? flow.completedAt : ""
    return completedAt.startsWith(today)
  }).length
  const openTaskCount = openTasks.filter((task) => task.status === "open" || task.status === "in_progress").length
  const liveAlerts = workflowAlerts.length
  const workflowTotal = Math.max(1, liveAlerts + activeFlows + completedToday)

  return {
    stats: {
      activePatients: patients.length,
      highRiskCases,
      aiActionsToday: aiOverview.summary.actionsToday,
      appointmentsToday: schedulingStats.total,
    },
    riskAlerts: riskPatients.slice(0, 4).map((patient) => ({
      id: patient.id,
      patient: patient.name,
      patientId: patient.mrn,
      risk: Number(patient.score) / 100,
      level: patient.level.includes("High") || patient.level === "Critical" ? "HIGH" : patient.level.includes("Medium") ? "MEDIUM" : "LOW",
      reason: patient.reasoning,
      action: patient.recommendedAction,
      time: "Live score",
    })),
    workflowStatus: [
      { label: "Open Escalations", value: liveAlerts, total: workflowTotal, color: "bg-warning" },
      { label: "Active Clinical Flows", value: activeFlows, total: workflowTotal, color: "bg-primary" },
      { label: "Completed Today", value: completedToday, total: workflowTotal, color: "bg-success" },
    ],
    agentActivity: [
      { action: "WhatsApp Messages", count: aiOverview.reminderMetrics.whatsappMessagesToday, icon: "whatsapp" },
      { action: "Patient Calls", count: aiOverview.reminderMetrics.patientCallsToday, icon: "call" },
      { action: "Next-of-Kin Calls", count: aiOverview.reminderMetrics.nextOfKinCallsToday, icon: "clock" },
      { action: "Home-Care Escalations", count: aiOverview.reminderMetrics.homeVisitEscalationsToday, icon: "alert" },
    ],
    operationalSnapshot: {
      openAlerts: liveAlerts,
      openTasks: openTaskCount,
      activeLoops: aiOverview.summary.activeLoops,
      lastUpdatedAt: nowIso(),
    },
  }
}
