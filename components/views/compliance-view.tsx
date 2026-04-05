"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, FileText, Key, Lock, RefreshCw, Shield, ShieldCheck, User } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type ComplianceCheck = {
  name: string
  status: string
  lastCheck: string
}

type AuditItem = {
  id: string
  action: string
  patient: string
  user: string
  details: string
  time: string
}

type ReminderStageMetric = {
  stage: string
  label: string
  count: number
  status: string
}

type ReminderMetrics = {
  whatsappMessagesToday: number
  patientCallsToday: number
  nextOfKinCallsToday: number
  dayOfRemindersToday: number
  homeVisitEscalationsToday: number
  activeWorkflows: number
  pendingByStage: ReminderStageMetric[]
}

type ComplianceOverview = {
  checks: ComplianceCheck[]
  guardrails: number
  violations: number
  auditEntriesToday: number
  reminderMetrics: ReminderMetrics
  recentAuditLogs: AuditItem[]
}

type WorkflowAlert = {
  id: string
  flowId?: string
  patientId: string
  severity: "info" | "warning" | "high" | "critical"
  title: string
  description?: string
  status: "open" | "acknowledged" | "resolved" | "dismissed"
  triggeredAt: string
  currentStage: string
  currentStageLabel: string
  patientName?: string
  patientMrn?: string
  currentOwner: {
    userId?: string
    name: string
    role: string
  } | null
  routeTarget: {
    userId: string
    name: string
    role: string
    reason: string
  } | null
}

type ClinicalTask = {
  id: string
  patientId: string
  title: string
  relatedAlertId?: string
  taskType: string
  priority: "low" | "medium" | "high" | "critical"
  status: "open" | "in_progress" | "done" | "cancelled"
  assignedUserId?: string
  assignedUserName?: string
  dueAt?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

const guardrails = [
  {
    name: "Schema Validation",
    description: "Strict API payload validation before processing.",
  },
  {
    name: "Constrained Actions",
    description: "APIs expose explicit actions, no arbitrary command execution.",
  },
  {
    name: "Risk Thresholds",
    description: "High-risk outputs require human clinical review.",
  },
  {
    name: "Audit Logging",
    description: "All mutations are tracked with timestamps.",
  },
]

const accessRoles = [
  { role: "Participant", access: ["Notifications", "Confirmations"] },
  { role: "Clinic Admin", access: ["Dashboard", "Scheduling", "Compliance"] },
  { role: "Clinical Staff", access: ["Risk Scoring", "Patient Records", "Care Tasks"] },
  { role: "Lab/Pharmacy", access: ["Task View", "Orders"] },
]

const reminderTriggerStages = [
  {
    stage: "stage1_text",
    title: "1. T-2 WhatsApp reminder",
    timing: "2 days before the visit",
    description: "Initial WhatsApp message asking the patient to confirm the appointment.",
  },
  {
    stage: "stage2_text",
    title: "2. Follow-up WhatsApp",
    timing: "3 hours after no confirmation",
    description: "Second WhatsApp follow-up if the patient has not replied YES yet.",
  },
  {
    stage: "stage3_text",
    title: "3. Final WhatsApp",
    timing: "Another 3 hours later",
    description: "Final WhatsApp warning before the workflow moves into the call tree.",
  },
  {
    stage: "stage4_patient_call",
    title: "4. Patient confirmation call",
    timing: "3 hours after the final WhatsApp",
    description: "Trigger a patient call asking them to press 1 to confirm the next appointment.",
  },
  {
    stage: "stage5_next_of_kin_call",
    title: "5. Next-of-kin fallback",
    timing: "3 hours after the patient call",
    description: "If the patient does not answer or confirm, call the next of kin for follow-up.",
  },
  {
    stage: "stage6_homebase_alert",
    title: "6. Home-base or nurse escalation",
    timing: "3 hours after next-of-kin outreach",
    description: "Escalate to home-based care or nursing with the patient home address and coordinates.",
  },
  {
    stage: "stage_confirmed_day_of_pending",
    title: "7. Same-day reminder",
    timing: "On the day of the visit after confirmation",
    description: "Once the visit is confirmed, the workflow schedules one more WhatsApp reminder for the appointment day.",
  },
]

export function ComplianceView({ focusAlertId }: { focusAlertId?: string | null }) {
  const [overview, setOverview] = useState<ComplianceOverview>({
    checks: [],
    guardrails: 0,
    violations: 0,
    auditEntriesToday: 0,
    reminderMetrics: {
      whatsappMessagesToday: 0,
      patientCallsToday: 0,
      nextOfKinCallsToday: 0,
      dayOfRemindersToday: 0,
      homeVisitEscalationsToday: 0,
      activeWorkflows: 0,
      pendingByStage: [],
    },
    recentAuditLogs: [],
  })
  const [workflowAlerts, setWorkflowAlerts] = useState<WorkflowAlert[]>([])
  const [escalationTasks, setEscalationTasks] = useState<ClinicalTask[]>([])
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})

  const loadOverview = async () => {
    const response = await fetch("/api/compliance/overview", { cache: "no-store" })
    const result = (await response.json()) as { data?: ComplianceOverview }
    setOverview(result.data ?? overview)
  }

  const loadWorkflowAlerts = async () => {
    const response = await fetch("/api/compliance/workflow-escalations", { cache: "no-store" })
    const result = (await response.json()) as { data?: WorkflowAlert[] }
    setWorkflowAlerts((result.data ?? []) as WorkflowAlert[])
  }

  const loadEscalationTasks = async () => {
    const response = await fetch("/api/tasks", { cache: "no-store" })
    const result = (await response.json()) as { data?: ClinicalTask[] }
    const nextTasks = ((result.data ?? []) as ClinicalTask[]).filter(
      (task) => task.title.startsWith("Workflow escalation:") && (task.status === "open" || task.status === "in_progress"),
    )
    setEscalationTasks(nextTasks)
    setNoteDrafts((current) => {
      const nextDrafts = { ...current }
      for (const task of nextTasks) {
        if (nextDrafts[task.id] === undefined) {
          nextDrafts[task.id] = task.notes ?? ""
        }
      }
      return nextDrafts
    })
  }

  const updateTask = async (id: string, status?: "in_progress" | "done") => {
    const note = noteDrafts[id] ?? ""
    if (status === "done" && !note.trim()) {
      setTaskErrors((current) => ({
        ...current,
        [id]: "Add a patient note before marking this task as done.",
      }))
      return
    }

    setBusyAlertId(id)
    setTaskErrors((current) => ({ ...current, [id]: "" }))
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes: note }),
      })
      if (!response.ok) {
        const result = (await response.json()) as { error?: string }
        setTaskErrors((current) => ({
          ...current,
          [id]: result.error ?? "Unable to update task.",
        }))
        return
      }
      await Promise.all([loadWorkflowAlerts(), loadOverview(), loadEscalationTasks()])
    } finally {
      setBusyAlertId(null)
    }
  }

  const updateWorkflowAlert = async (id: string, status: "acknowledged" | "resolved") => {
    setBusyAlertId(id)
    try {
      const response = await fetch(`/api/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) {
        return
      }
      await Promise.all([loadWorkflowAlerts(), loadOverview(), loadEscalationTasks()])
    } finally {
      setBusyAlertId(null)
    }
  }

  const assignRecommendedLead = async (alert: WorkflowAlert) => {
    if (!alert.flowId || !alert.routeTarget?.userId) {
      return
    }

    setBusyAlertId(alert.id)
    try {
      const response = await fetch(`/api/compliance/workflow-escalations/${alert.id}/assign`, {
        method: "POST",
      })
      if (!response.ok) {
        return
      }
      await Promise.all([loadWorkflowAlerts(), loadOverview(), loadEscalationTasks()])
    } finally {
      setBusyAlertId(null)
    }
  }

  useEffect(() => {
    void loadOverview()
    void loadWorkflowAlerts()
    void loadEscalationTasks()
  }, [])

  useEffect(() => {
    if (!focusAlertId) return
    const target = document.getElementById(`workflow-alert-${focusAlertId}`)
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [focusAlertId, workflowAlerts])

  const stageCount = (stage: string) => overview.reminderMetrics.pendingByStage.find((item) => item.stage === stage)?.count ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Compliance & Safety</h1>
          <p className="text-muted-foreground">Production guardrails, safety protocols, and regulatory compliance</p>
        </div>
        <Badge
          variant="outline"
          className="font-normal cursor-pointer"
          onClick={() => {
            void loadOverview()
            void loadWorkflowAlerts()
            void loadEscalationTasks()
          }}
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Badge>
      </div>

      <Card className="border-0 shadow-sm bg-success/10 border-l-4 border-l-success">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <ShieldCheck className="w-8 h-8 text-success" />
            <div>
              <p className="font-semibold text-success">Compliance Controls Active</p>
              <p className="text-sm text-muted-foreground">RBAC, validation, and audit mechanisms are operational.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Shield className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.checks.length}</p>
                <p className="text-xs text-muted-foreground">Checks Loaded</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Lock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.guardrails}</p>
                <p className="text-xs text-muted-foreground">Active Guardrails</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <FileText className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.auditEntriesToday}</p>
                <p className="text-xs text-muted-foreground">Audit Entries Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.violations}</p>
                <p className="text-xs text-muted-foreground">Open Violations</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Production Guardrails</CardTitle>
              <CardDescription>Safety controls enforced in backend APIs</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {guardrails.map((guardrail) => (
                <div key={guardrail.name} className="p-4 rounded-lg border border-border bg-secondary/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <span className="font-medium">{guardrail.name}</span>
                    <Badge className="bg-success/20 text-success text-[10px] ml-auto">Active</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{guardrail.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">WhatsApp Reminder Trigger Stages</CardTitle>
              <CardDescription>Live view of the escalation chain from WhatsApp confirmation through home-based care.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">WhatsApp sent</p>
                  <p className="mt-2 text-2xl font-semibold">{overview.reminderMetrics.whatsappMessagesToday}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Patient calls</p>
                  <p className="mt-2 text-2xl font-semibold">{overview.reminderMetrics.patientCallsToday}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Next-of-kin calls</p>
                  <p className="mt-2 text-2xl font-semibold">{overview.reminderMetrics.nextOfKinCallsToday}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Day-of reminders</p>
                  <p className="mt-2 text-2xl font-semibold">{overview.reminderMetrics.dayOfRemindersToday}</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/20 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Home-care escalations</p>
                  <p className="mt-2 text-2xl font-semibold">{overview.reminderMetrics.homeVisitEscalationsToday}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-primary/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Active reminder workflows</p>
                    <p className="text-xs text-muted-foreground">Patients currently somewhere in the WhatsApp, call, or same-day reminder chain.</p>
                  </div>
                  <Badge variant="outline" className="text-sm">
                    {overview.reminderMetrics.activeWorkflows}
                  </Badge>
                </div>
              </div>

              <div className="space-y-3">
                {reminderTriggerStages.map((stage) => (
                  <div key={stage.stage} className="rounded-lg border border-border bg-secondary/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{stage.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{stage.timing}</p>
                      </div>
                      <Badge variant={stageCount(stage.stage) > 0 ? "default" : "outline"}>{stageCount(stage.stage)} active</Badge>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{stage.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Recent Audit Logs</CardTitle>
              <CardDescription>Live from backend audit stream</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.recentAuditLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{log.action}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {log.patient}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {log.user} - {log.details}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(log.time).toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Workflow Escalation Inbox</CardTitle>
              <CardDescription>Open SLA breach and at-risk workflow alerts needing leadership action.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {workflowAlerts.length === 0 ? <p className="text-sm text-muted-foreground">No open workflow escalations.</p> : null}
              {workflowAlerts.map((alert) => (
                <div
                  key={alert.id}
                  id={`workflow-alert-${alert.id}`}
                  className={`rounded-lg border bg-secondary/30 p-4 ${focusAlertId === alert.id ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{alert.title}</span>
                        <Badge variant={alert.severity === "critical" || alert.severity === "high" ? "destructive" : "default"} className="text-[10px] uppercase">
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{alert.description ?? "Workflow escalation raised."}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {alert.patientName ?? `Patient ${alert.patientId}`}
                        {alert.patientMrn ? ` (${alert.patientMrn})` : ""} - Triggered {new Date(alert.triggeredAt).toLocaleString()}
                      </p>
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div className="rounded-md border border-border bg-background p-2">
                          <p className="text-[10px] uppercase tracking-wide">Current Stage</p>
                          <p className="mt-1 font-medium text-foreground">{alert.currentStageLabel}</p>
                        </div>
                        <div className="rounded-md border border-border bg-background p-2">
                          <p className="text-[10px] uppercase tracking-wide">Current Owner</p>
                          <p className="mt-1 font-medium text-foreground">
                            {alert.currentOwner ? `${alert.currentOwner.name} (${alert.currentOwner.role})` : "Awaiting assignment"}
                          </p>
                        </div>
                        <div className="rounded-md border border-border bg-background p-2 md:col-span-2">
                          <p className="text-[10px] uppercase tracking-wide">Escalation Route</p>
                          <p className="mt-1 font-medium text-foreground">
                            {alert.routeTarget ? `${alert.routeTarget.name} (${alert.routeTarget.role})` : "No on-duty escalation lead available"}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {alert.routeTarget?.reason ?? "Assign a lead or clinic admin to handle this escalation."}
                          </p>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {alert.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyAlertId === alert.id || !alert.flowId || !alert.routeTarget}
                      onClick={() => void assignRecommendedLead(alert)}
                    >
                      {busyAlertId === alert.id ? "Assigning..." : "Assign Recommended Lead"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyAlertId === alert.id}
                      onClick={() => void updateWorkflowAlert(alert.id, "acknowledged")}
                    >
                      {busyAlertId === alert.id ? "Updating..." : "Acknowledge"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyAlertId === alert.id}
                      onClick={() => void updateWorkflowAlert(alert.id, "resolved")}
                    >
                      {busyAlertId === alert.id ? "Updating..." : "Resolve"}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Escalation Task Queue</CardTitle>
              <CardDescription>Follow-up tasks created from escalation assignments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {escalationTasks.length === 0 ? <p className="text-sm text-muted-foreground">No escalation tasks awaiting action.</p> : null}
              {escalationTasks.map((task) => (
                <div key={task.id} className="rounded-lg border border-border bg-secondary/30 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{task.title}</span>
                        <Badge variant={task.priority === "critical" || task.priority === "high" ? "destructive" : "default"} className="text-[10px] uppercase">
                          {task.priority}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{task.notes ?? "Escalation follow-up task created."}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Assigned to {task.assignedUserName ?? "Unassigned"} - Patient {task.patientId}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {task.status}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div className="rounded-md border border-border bg-background p-2">
                      <p className="text-[10px] uppercase tracking-wide">Due</p>
                      <p className="mt-1 font-medium text-foreground">{task.dueAt ? new Date(task.dueAt).toLocaleString() : "No due time"}</p>
                    </div>
                    <div className="rounded-md border border-border bg-background p-2">
                      <p className="text-[10px] uppercase tracking-wide">Created</p>
                      <p className="mt-1 font-medium text-foreground">{new Date(task.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <div className="w-full">
                      <Textarea
                        value={noteDrafts[task.id] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value
                          setNoteDrafts((current) => ({ ...current, [task.id]: value }))
                          setTaskErrors((current) => ({ ...current, [task.id]: "" }))
                        }}
                        placeholder="Add clinician notes for this patient escalation."
                        className="min-h-24 rounded-xl border-border bg-background text-foreground"
                      />
                      {taskErrors[task.id] ? <p className="mt-2 text-xs text-destructive">{taskErrors[task.id]}</p> : null}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyAlertId === task.id}
                      onClick={() => void updateTask(task.id)}
                    >
                      {busyAlertId === task.id ? "Updating..." : "Save Notes"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyAlertId === task.id || task.status !== "open"}
                      onClick={() => void updateTask(task.id, "in_progress")}
                    >
                      {busyAlertId === task.id ? "Updating..." : "Start Work"}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyAlertId === task.id || (task.status !== "open" && task.status !== "in_progress")}
                      onClick={() => void updateTask(task.id, "done")}
                    >
                      {busyAlertId === task.id ? "Updating..." : "Mark Done"}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Compliance Checks</CardTitle>
              <CardDescription>Regulatory and security status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.checks.map((check) => (
                <div key={check.name} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-sm">{check.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{check.lastCheck}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Access Control (RBAC)</CardTitle>
              <CardDescription>Role-based data access policies</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {accessRoles.map((role) => (
                <div key={role.role} className="p-3 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">{role.role}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {role.access.map((item) => (
                      <Badge key={item} variant="outline" className="text-[10px]">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Key className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium mb-1">Encryption Policy</p>
                  <p className="text-xs text-muted-foreground">Data is encrypted in transit and at rest per deployment configuration.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
