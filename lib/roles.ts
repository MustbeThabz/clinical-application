import type { ClinicalFlowStage } from "@/lib/backend/types"

export type AppTab =
  | "dashboard"
  | "patients"
  | "risk-scoring"
  | "ai-agent"
  | "workflows"
  | "tasks"
  | "scheduling"
  | "analytics"
  | "compliance"
  | "users"

export type UserRole =
  | "participant"
  | "clinic_admin"
  | "receptionist_admin"
  | "research_assistant"
  | "nurse"
  | "doctor"
  | "lab_personnel"
  | "pharmacist"

export const ROLE_VALUES: UserRole[] = [
  "participant",
  "clinic_admin",
  "receptionist_admin",
  "research_assistant",
  "nurse",
  "doctor",
  "lab_personnel",
  "pharmacist",
]

export const STAFF_ROLE_VALUES: UserRole[] = ROLE_VALUES.filter((role) => role !== "participant")

const DEFAULT_APP_TABS: AppTab[] = [
  "dashboard",
  "patients",
  "risk-scoring",
  "ai-agent",
  "workflows",
  "tasks",
  "scheduling",
  "analytics",
  "compliance",
]

const ROLE_APP_TABS: Partial<Record<UserRole, AppTab[]>> = {
  participant: ["dashboard"],
  clinic_admin: [...DEFAULT_APP_TABS, "users"],
  receptionist_admin: ["dashboard", "patients", "workflows", "tasks", "scheduling", "compliance"],
  research_assistant: ["dashboard", "patients", "risk-scoring", "workflows", "tasks", "scheduling", "analytics"],
  nurse: ["dashboard", "patients", "workflows", "tasks", "scheduling"],
  doctor: ["dashboard", "patients", "risk-scoring", "workflows", "tasks", "scheduling", "analytics", "compliance"],
  lab_personnel: ["dashboard", "patients", "workflows", "tasks"],
  pharmacist: ["dashboard", "patients", "workflows", "tasks"],
}

const CLINICAL_FLOW_STAGE_ALLOWED_ROLES: Record<ClinicalFlowStage, UserRole[]> = {
  request: ["clinic_admin", "receptionist_admin"],
  ra: ["clinic_admin", "research_assistant"],
  admin: ["clinic_admin", "receptionist_admin"],
  nurse: ["clinic_admin", "nurse"],
  doctor: ["clinic_admin", "doctor"],
  lab: ["clinic_admin", "lab_personnel"],
  pharmacy: ["clinic_admin", "pharmacist"],
}

export function getRoleLabel(role: UserRole) {
  switch (role) {
    case "clinic_admin":
      return "Clinic Admin"
    case "receptionist_admin":
      return "Receptionist / Admin"
    case "research_assistant":
      return "Research Assistant"
    case "nurse":
      return "Nurse"
    case "doctor":
      return "Doctor"
    case "lab_personnel":
      return "Lab Personnel"
    case "pharmacist":
      return "Pharmacist"
    default:
      return "Participant"
  }
}

export function canAdvanceClinicalStage(role: UserRole, stage: ClinicalFlowStage) {
  return CLINICAL_FLOW_STAGE_ALLOWED_ROLES[stage].includes(role)
}

export function getClinicalStageAllowedRoles(stage: ClinicalFlowStage) {
  return CLINICAL_FLOW_STAGE_ALLOWED_ROLES[stage]
}

export function canUserHandleClinicalStage(
  role: UserRole,
  stage: ClinicalFlowStage,
  assignedStages?: ClinicalFlowStage[],
) {
  if (role === "clinic_admin") {
    return true
  }

  if (!canAdvanceClinicalStage(role, stage)) {
    return false
  }

  if (!assignedStages || assignedStages.length === 0) {
    return true
  }

  return assignedStages.includes(stage)
}

export function getVisibleAppTabs(role: UserRole) {
  return ROLE_APP_TABS[role] ?? DEFAULT_APP_TABS
}

export function canAccessAppTab(role: UserRole, tab: AppTab) {
  return getVisibleAppTabs(role).includes(tab)
}
