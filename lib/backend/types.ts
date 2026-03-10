import { z } from "zod"

export const riskBandSchema = z.enum(["Low Risk", "Medium Risk", "High Risk", "Critical"])
export type RiskBand = z.infer<typeof riskBandSchema>

export const patientSchema = z.object({
  id: z.string(),
  mrn: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.string(),
  sexAtBirth: z.enum(["female", "male", "intersex", "unknown"]),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  conditionSummary: z.string(),
  callTriggerPhone: z.string().optional(),
  homeVisitAddress: z.string().optional(),
  homeLatitude: z.string().optional(),
  homeLongitude: z.string().optional(),
  status: riskBandSchema,
  adherence: z.number().min(0).max(100),
  lastVisit: z.string().optional(),
  nextAppointment: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Patient = z.infer<typeof patientSchema>

export const appointmentSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  providerName: z.string(),
  appointmentType: z.enum(["routine", "follow_up", "urgent", "telehealth", "screening"]),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  status: z.enum(["scheduled", "checked_in", "completed", "cancelled", "no_show"]),
  reason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Appointment = z.infer<typeof appointmentSchema>

export const riskScoreSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  scoreType: z.enum(["adherence", "readmission", "chronic_deterioration", "custom"]),
  score: z.number().min(0).max(100),
  riskBand: riskBandSchema,
  modelVersion: z.string(),
  factors: z.array(z.string()),
  calculatedAt: z.string(),
})
export type RiskScore = z.infer<typeof riskScoreSchema>

export const clinicalTaskSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  taskType: z.enum(["outreach", "education", "medication_review", "lab_follow_up", "appointment_reminder"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "in_progress", "done", "cancelled"]),
  dueAt: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ClinicalTask = z.infer<typeof clinicalTaskSchema>

export const alertSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  alertType: z.enum(["critical_lab", "missed_appointment", "medication_nonadherence", "vital_anomaly", "workflow"]),
  severity: z.enum(["info", "warning", "high", "critical"]),
  title: z.string(),
  description: z.string().optional(),
  status: z.enum(["open", "acknowledged", "resolved", "dismissed"]),
  triggeredAt: z.string(),
})
export type Alert = z.infer<typeof alertSchema>

export const auditLogSchema = z.object({
  id: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  actorType: z.enum(["provider", "system", "api_client"]),
  occurredAt: z.string(),
})
export type AuditLog = z.infer<typeof auditLogSchema>

export const clinicalFlowStageSchema = z.enum(["request", "ra", "admin", "nurse", "doctor", "lab", "pharmacy"])
export type ClinicalFlowStage = z.infer<typeof clinicalFlowStageSchema>

export const clinicalFlowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  appointmentId: z.string().optional(),
  entryMethod: z.enum(["scan", "admin"]),
  currentStage: clinicalFlowStageSchema,
  status: z.enum(["active", "completed", "cancelled"]),
  needsNextVisit: z.boolean().default(false),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ClinicalFlow = z.infer<typeof clinicalFlowSchema>

export const clinicalFlowEventSchema = z.object({
  id: z.string(),
  flowId: z.string(),
  stage: clinicalFlowStageSchema,
  action: z.string(),
  actor: z.string(),
  notes: z.string().optional(),
  occurredAt: z.string(),
})
export type ClinicalFlowEvent = z.infer<typeof clinicalFlowEventSchema>

export const dbSchema = z.object({
  patients: z.array(patientSchema),
  appointments: z.array(appointmentSchema),
  riskScores: z.array(riskScoreSchema),
  tasks: z.array(clinicalTaskSchema),
  alerts: z.array(alertSchema),
  auditLogs: z.array(auditLogSchema),
  clinicFlows: z.array(clinicalFlowSchema).default([]),
  clinicFlowEvents: z.array(clinicalFlowEventSchema).default([]),
})
export type ClinicalDb = z.infer<typeof dbSchema>

export const createPatientInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1),
  sexAtBirth: z.enum(["female", "male", "intersex", "unknown"]),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  conditionSummary: z.string().min(1),
  callTriggerPhone: z.string().optional(),
  homeVisitAddress: z.string().optional(),
  homeLatitude: z.string().optional(),
  homeLongitude: z.string().optional(),
  status: riskBandSchema.default("Low Risk"),
  adherence: z.number().min(0).max(100).default(100),
})
export type CreatePatientInput = z.infer<typeof createPatientInputSchema>

export const updatePatientInputSchema = createPatientInputSchema.partial().extend({
  mrn: z.string().optional(),
})
export type UpdatePatientInput = z.infer<typeof updatePatientInputSchema>
