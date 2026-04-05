import type { ClinicalFlowStage } from "@/lib/backend/types"
import { canUserHandleClinicalStage, getRoleLabel, type UserRole } from "@/lib/roles"

export type SlaStatus = "on_track" | "at_risk" | "breached"

const NON_CHRONIC_PROGRAM_CODES = new Set(["", "GENERAL", "ROUTINE", "SCREENING"])

export const STAGE_SLA_MINUTES: Record<ClinicalFlowStage, number> = {
  request: 15,
  ra: 30,
  admin: 20,
  nurse: 30,
  doctor: 45,
  lab: 60,
  pharmacy: 30,
}

export function getClinicalFlowSlaStatus(stage: ClinicalFlowStage, waitMinutes: number): SlaStatus {
  const targetMinutes = STAGE_SLA_MINUTES[stage]
  if (waitMinutes >= targetMinutes) {
    return "breached"
  }
  if (waitMinutes >= Math.floor(targetMinutes * 0.75)) {
    return "at_risk"
  }
  return "on_track"
}

export function getPatientProgramCode(conditionSummary?: string | null) {
  const normalized = (conditionSummary ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized || "GENERAL"
}

export function isChronicCareCondition(conditionSummary?: string | null) {
  return !NON_CHRONIC_PROGRAM_CODES.has(getPatientProgramCode(conditionSummary))
}

export type EscalationUser = {
  id: string
  name: string
  role: UserRole
  isOnDuty?: boolean
  isActive?: boolean
  availabilityStatus?: "available" | "busy_with_patient" | "away"
  assignedStages?: ClinicalFlowStage[]
}

export function getWorkflowEscalationTarget(
  stage: ClinicalFlowStage,
  users: EscalationUser[],
  currentOwnerUserId?: string,
) {
  const onDutyUsers = users.filter((user) => user.isActive !== false && user.isOnDuty && user.availabilityStatus !== "away")
  const adminLead = onDutyUsers.find((user) => user.role === "clinic_admin" && user.id !== currentOwnerUserId)
  if (adminLead) {
    return {
      user: adminLead,
      reason: "Clinic admin on duty",
    }
  }

  const stageLead = onDutyUsers.find(
    (user) => user.id !== currentOwnerUserId && canUserHandleClinicalStage(user.role, stage, user.assignedStages),
  )
  if (stageLead) {
    return {
      user: stageLead,
      reason: "On-duty clinician assigned to this stage",
    }
  }

  return null
}

export function getClinicalFlowTaskTemplate(stage: ClinicalFlowStage) {
  switch (stage) {
    case "request":
      return {
        title: "Clinical workflow: Request Received",
        taskType: "outreach" as const,
        notes: "Confirm patient arrival and prepare initial intake handoff.",
      }
    case "ra":
      return {
        title: "Clinical workflow: Ready for RA",
        taskType: "education" as const,
        notes: "Research assistant review and intake preparation required.",
      }
    case "admin":
      return {
        title: "Clinical workflow: Ready for Admin",
        taskType: "outreach" as const,
        notes: "Administrative workflow step pending for this patient.",
      }
    case "nurse":
      return {
        title: "Clinical workflow: Ready for Nurse",
        taskType: "medication_review" as const,
        notes: "Nursing assessment and clinical review required.",
      }
    case "doctor":
      return {
        title: "Clinical workflow: Ready for Doctor",
        taskType: "medication_review" as const,
        notes: "Doctor consultation and treatment decision required.",
      }
    case "lab":
      return {
        title: "Clinical workflow: Ready for Lab",
        taskType: "lab_follow_up" as const,
        notes: "Laboratory processing or specimen follow-up required.",
      }
    case "pharmacy":
      return {
        title: "Clinical workflow: Ready for Pharmacy",
        taskType: "medication_review" as const,
        notes: "Medication dispensing and collection handoff required.",
      }
  }
}

const PRIMARY_STAGE_ROLE: Record<ClinicalFlowStage, UserRole> = {
  request: "receptionist_admin",
  ra: "research_assistant",
  admin: "receptionist_admin",
  nurse: "nurse",
  doctor: "doctor",
  lab: "lab_personnel",
  pharmacy: "pharmacist",
}

type FlowSummaryInput = {
  currentStage: ClinicalFlowStage
  status: "active" | "completed" | "cancelled"
  needsNextVisit?: boolean
  currentHandlerUserId?: string
  currentHandlerName?: string
  currentHandlerRole?: string
}

export function getClinicalFlowSummary(flow: FlowSummaryInput) {
  if (flow.status === "completed") {
    const responsibleRole = flow.needsNextVisit ? "receptionist_admin" : "clinic_admin"
    return {
      workflowStatus: flow.needsNextVisit ? "completed_pending_follow_up" : "completed",
      workflowStatusLabel: flow.needsNextVisit ? "Visit Completed, Follow-up Pending" : "Visit Completed",
      nextAction: flow.needsNextVisit ? "schedule_follow_up" : "archive_visit",
      nextActionLabel: flow.needsNextVisit ? "Schedule follow-up appointment" : "Archive visit and monitor record",
      responsibleRole,
      responsibleRoleLabel: getRoleLabel(responsibleRole),
      responsibleUserId: undefined,
      responsibleUserName: undefined,
    }
  }

  if (flow.status === "cancelled") {
    return {
      workflowStatus: "cancelled",
      workflowStatusLabel: "Visit Cancelled",
      nextAction: "review_cancellation",
      nextActionLabel: "Review cancellation and decide on rebooking",
      responsibleRole: "receptionist_admin" as const,
      responsibleRoleLabel: getRoleLabel("receptionist_admin"),
      responsibleUserId: undefined,
      responsibleUserName: undefined,
    }
  }

  const stageSummary: Record<
    ClinicalFlowStage,
    {
      workflowStatus: string
      workflowStatusLabel: string
      nextAction: string
      nextActionLabel: string
    }
  > = {
    request: {
      workflowStatus: "waiting_for_reception",
      workflowStatusLabel: "Waiting for Reception",
      nextAction: "confirm_arrival",
      nextActionLabel: "Confirm arrival and prepare intake",
    },
    ra: {
      workflowStatus: "waiting_for_ra",
      workflowStatusLabel: "Waiting for RA",
      nextAction: "complete_ra_review",
      nextActionLabel: "Complete RA review",
    },
    admin: {
      workflowStatus: "waiting_for_admin",
      workflowStatusLabel: "Waiting for Admin",
      nextAction: "complete_admin_review",
      nextActionLabel: "Complete administrative review",
    },
    nurse: {
      workflowStatus: "waiting_for_nurse",
      workflowStatusLabel: "Waiting for Nurse",
      nextAction: "complete_nursing_assessment",
      nextActionLabel: "Complete nursing assessment",
    },
    doctor: {
      workflowStatus: "waiting_for_doctor",
      workflowStatusLabel: "Waiting for Doctor",
      nextAction: "complete_doctor_consult",
      nextActionLabel: "Complete doctor consultation",
    },
    lab: {
      workflowStatus: "waiting_for_lab",
      workflowStatusLabel: "Waiting for Lab",
      nextAction: "process_labs",
      nextActionLabel: "Process labs and record results",
    },
    pharmacy: {
      workflowStatus: "waiting_for_pharmacy",
      workflowStatusLabel: "Waiting for Pharmacy",
      nextAction: "dispense_medication",
      nextActionLabel: "Dispense medication and close visit",
    },
  }

  const summary = stageSummary[flow.currentStage]
  const responsibleRole =
    (flow.currentHandlerRole as UserRole | undefined) && flow.currentHandlerRole !== ""
      ? (flow.currentHandlerRole as UserRole)
      : PRIMARY_STAGE_ROLE[flow.currentStage]

  return {
    ...summary,
    responsibleRole,
    responsibleRoleLabel: getRoleLabel(responsibleRole),
    responsibleUserId: flow.currentHandlerUserId,
    responsibleUserName: flow.currentHandlerName,
  }
}
