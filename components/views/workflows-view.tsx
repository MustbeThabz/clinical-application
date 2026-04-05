"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Calendar, Clock, FileText, FlaskConical, Pill, Stethoscope, User, Users } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { canUserHandleClinicalStage, getClinicalStageAllowedRoles, getRoleLabel } from "@/lib/roles"
import type { PublicUser } from "@/lib/backend/users"
import { getClinicalFlowSlaStatus, STAGE_SLA_MINUTES, type SlaStatus } from "@/lib/clinical-flow"

type StageId = "request" | "ra" | "admin" | "nurse" | "doctor" | "lab" | "pharmacy"

type StageItem = {
  id: StageId
  label: string
  agent: string
}

type PatientLite = {
  id: string
  mrn: string
  fullName: string
  status?: "Low Risk" | "Medium Risk" | "High Risk" | "Critical"
  nextAppointment?: string
}

type ClinicianLite = {
  id: string
  name: string
  role: PublicUser["role"]
  roleLabel: string
  availabilityStatus: "available" | "busy_with_patient" | "away"
  assignedStages: StageId[]
}

type FlowItem = {
  id: string
  patientId: string
  patientMrn: string
  patientName: string
  appointmentId?: string
  appointmentType?: string
  entryMethod: "scan" | "admin"
  currentStage: StageId
  currentHandlerUserId?: string
  currentHandlerName?: string
  currentHandlerRole?: string
  status: "active" | "completed" | "cancelled"
  workflowStatus: string
  workflowStatusLabel: string
  nextAction: string
  nextActionLabel: string
  responsibleRole: PublicUser["role"]
  responsibleRoleLabel: string
  responsibleUserId?: string
  responsibleUserName?: string
  needsNextVisit: boolean
  startedAt: string
  updatedAt: string
  completedAt?: string
}

type StageQueueFlow = FlowItem & {
  patientStatus: NonNullable<PatientLite["status"]>
  priorityScore: number
  waitMinutes: number
  slaStatus: SlaStatus
}

type NextVisitDraft = {
  enabled: boolean
  providerName: string
  appointmentType: "routine" | "follow_up" | "urgent" | "telehealth" | "screening"
  date: string
  time: string
  durationMin: string
  reason: string
}

const STAGE_ICONS: Record<StageId, typeof FileText> = {
  request: FileText,
  ra: User,
  admin: Users,
  nurse: Stethoscope,
  doctor: Stethoscope,
  lab: FlaskConical,
  pharmacy: Pill,
}

const STAGE_COLORS: Record<StageId, string> = {
  request: "bg-primary",
  ra: "bg-accent",
  admin: "bg-muted",
  nurse: "bg-primary",
  doctor: "bg-accent",
  lab: "bg-muted",
  pharmacy: "bg-success",
}

const APPOINTMENT_PRIORITY: Record<string, number> = {
  urgent: 4,
  follow_up: 3,
  screening: 2,
  routine: 1,
  telehealth: 1,
}

const RISK_PRIORITY: Record<NonNullable<PatientLite["status"]>, number> = {
  Critical: 4,
  "High Risk": 3,
  "Medium Risk": 2,
  "Low Risk": 1,
}

function toLocalDateTimeLabel(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function toElapsedLabel(iso: string) {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime())
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) {
    return `${minutes}m`
  }

  if (minutes === 0) {
    return `${hours}h`
  }

  return `${hours}h ${minutes}m`
}

function getPriorityTone(score: number) {
  if (score >= 7) return "destructive" as const
  if (score >= 5) return "default" as const
  return "secondary" as const
}

function getPriorityLabel(score: number) {
  if (score >= 7) return "Escalate Now"
  if (score >= 5) return "High Priority"
  if (score >= 3) return "Priority"
  return "Routine Queue"
}

function getSlaVariant(status: SlaStatus) {
  if (status === "breached") return "destructive" as const
  if (status === "at_risk") return "default" as const
  return "secondary" as const
}

function getSlaLabel(status: SlaStatus) {
  if (status === "breached") return "SLA Breached"
  if (status === "at_risk") return "Approaching SLA"
  return "On Track"
}

function formatMinutes(minutes: number) {
  if (minutes < 60) {
    return `${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (remainder === 0) {
    return `${hours} hr`
  }

  return `${hours} hr ${remainder} min`
}

function makeDefaultNextVisitDraft(): NextVisitDraft {
  const when = new Date()
  when.setDate(when.getDate() + 28)
  return {
    enabled: false,
    providerName: "Clinic Provider",
    appointmentType: "follow_up",
    date: when.toISOString().slice(0, 10),
    time: "09:00",
    durationMin: "30",
    reason: "Follow-up after medication collection",
  }
}

export function WorkflowsView({
  currentUser,
  focusPatientId,
  onOpenTasks,
}: {
  currentUser: PublicUser
  focusPatientId?: string | null
  onOpenTasks: (patientId: string) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stages, setStages] = useState<StageItem[]>([])
  const [patients, setPatients] = useState<PatientLite[]>([])
  const [clinicians, setClinicians] = useState<ClinicianLite[]>([])
  const [flows, setFlows] = useState<FlowItem[]>([])
  const [isBusyFlowId, setIsBusyFlowId] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [startForm, setStartForm] = useState({
    patientId: "",
    entryMethod: "admin" as "scan" | "admin",
  })
  const [nextVisitByFlow, setNextVisitByFlow] = useState<Record<string, NextVisitDraft>>({})

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/clinical-flow", { cache: "no-store" })
      const body = (await res.json()) as {
        data?: FlowItem[]
        patients?: PatientLite[]
        stages?: StageItem[]
        clinicians?: ClinicianLite[]
        error?: string
      }
      if (!res.ok) {
        setError(body.error ?? "Failed to load clinical flows.")
        return
      }
      setFlows(body.data ?? [])
      setPatients(body.patients ?? [])
      setStages(body.stages ?? [])
      setClinicians(body.clinicians ?? [])
      if (!startForm.patientId && (body.patients?.length ?? 0) > 0) {
        setStartForm((prev) => ({ ...prev, patientId: String(body.patients?.[0].id ?? "") }))
      }
    } catch {
      setError("Failed to load clinical flows.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!focusPatientId || loading) return
    const target = document.getElementById(`workflow-patient-${focusPatientId}`)
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [focusPatientId, loading, flows])

  const stageIndex = (stage: StageId) => stages.findIndex((s) => s.id === stage)
  const nextStageLabel = (stage: StageId) => {
    const idx = stageIndex(stage)
    if (idx < 0 || idx + 1 >= stages.length) return "Complete"
    return stages[idx + 1].label
  }

  const activeFlows = useMemo(() => flows.filter((f) => f.status === "active"), [flows])
  const completedToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return flows.filter((f) => f.status === "completed" && (f.completedAt || "").slice(0, 10) === today).length
  }, [flows])
  const bottlenecks = useMemo(() => {
    const slow = activeFlows.filter((f) => Date.now() - new Date(f.updatedAt).getTime() > 2 * 60 * 60 * 1000)
    return slow.length
  }, [activeFlows])
  const avgDurationHours = useMemo(() => {
    const completed = flows.filter((f) => f.status === "completed" && f.completedAt)
    if (completed.length === 0) return "0.0 hrs"
    const totalMs = completed.reduce((sum, item) => sum + (new Date(item.completedAt as string).getTime() - new Date(item.startedAt).getTime()), 0)
    return `${(totalMs / completed.length / 3600000).toFixed(1)} hrs`
  }, [flows])

  const stageCounts = useMemo(() => {
    const map = new Map<StageId, number>()
    for (const s of stages) map.set(s.id, 0)
    for (const f of activeFlows) {
      map.set(f.currentStage, (map.get(f.currentStage) ?? 0) + 1)
    }
    return map
  }, [stages, activeFlows])

  const patientById = useMemo(() => new Map(patients.map((patient) => [patient.id, patient])), [patients])

  const stageQueues = useMemo(
    () =>
      stages.map((stage) => {
        const stageSlaMinutes = STAGE_SLA_MINUTES[stage.id]
        const queuedFlows: StageQueueFlow[] = activeFlows
          .filter((flow) => flow.currentStage === stage.id)
          .map((flow) => {
            const patient = patientById.get(flow.patientId)
            const appointmentPriority = APPOINTMENT_PRIORITY[flow.appointmentType ?? "follow_up"] ?? 1
            const riskPriority = patient?.status ? RISK_PRIORITY[patient.status] : 1
            const waitMinutes = Math.floor((Date.now() - new Date(flow.updatedAt).getTime()) / 60000)
            const priorityScore = appointmentPriority + riskPriority + (waitMinutes >= 120 ? 2 : waitMinutes >= 60 ? 1 : 0)
            const slaStatus = getClinicalFlowSlaStatus(stage.id, waitMinutes)

            return {
              ...flow,
              patientStatus: patient?.status ?? "Low Risk",
              priorityScore,
              waitMinutes,
              slaStatus,
            }
          })
          .sort((a, b) => {
            if (b.priorityScore !== a.priorityScore) {
              return b.priorityScore - a.priorityScore
            }
            return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          })
        const availableStaff = clinicians.filter(
          (clinician) =>
            clinician.availabilityStatus === "available" &&
            canUserHandleClinicalStage(clinician.role, stage.id, clinician.assignedStages),
        )
        const busyStaff = clinicians.filter(
          (clinician) =>
            clinician.availabilityStatus === "busy_with_patient" &&
            canUserHandleClinicalStage(clinician.role, stage.id, clinician.assignedStages),
        )

        return {
          stage,
          stageSlaMinutes,
          queuedFlows,
          availableStaff,
          busyStaff,
          unassignedCount: queuedFlows.filter((flow) => !flow.currentHandlerUserId).length,
          breachedCount: queuedFlows.filter((flow) => flow.slaStatus === "breached").length,
          atRiskCount: queuedFlows.filter((flow) => flow.slaStatus === "at_risk").length,
        }
      }),
    [stages, activeFlows, clinicians, patientById],
  )

  const slaOverview = useMemo(() => {
    const breachedFlows = stageQueues.flatMap((queue) =>
      queue.queuedFlows
        .filter((flow) => flow.slaStatus === "breached")
        .map((flow) => ({ ...flow, stageLabel: queue.stage.label })),
    )
    const atRiskFlows = stageQueues.flatMap((queue) =>
      queue.queuedFlows
        .filter((flow) => flow.slaStatus === "at_risk")
        .map((flow) => ({ ...flow, stageLabel: queue.stage.label })),
    )

    return {
      breachedFlows,
      atRiskFlows,
    }
  }, [stageQueues])

  const canStartFlow = canUserHandleClinicalStage(currentUser.role, "request", currentUser.assignedStages)

  const handleStartFlow = async () => {
    if (!startForm.patientId || !canStartFlow) return
    setIsStarting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/clinical-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: startForm.patientId,
          entryMethod: startForm.entryMethod,
        }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? "Failed to start flow.")
        return
      }
      await load()
    } catch {
      setError("Failed to start flow.")
    } finally {
      setIsStarting(false)
    }
  }

  const setDraft = (flowId: string, patch: Partial<NextVisitDraft>) => {
    const defaultDraft = makeDefaultNextVisitDraft()
    setNextVisitByFlow((prev) => ({
      ...prev,
      [flowId]: {
        ...(prev[flowId] ?? defaultDraft),
        ...patch,
      },
    }))
  }

  const advanceFlow = async (flow: FlowItem) => {
    setIsBusyFlowId(flow.id)
    setError(null)
    setNotice(null)
    try {
      const draft = nextVisitByFlow[flow.id] ?? makeDefaultNextVisitDraft()
      const payload: {
        complete?: boolean
        needsNextVisit?: boolean
        nextVisit?: {
          enabled?: boolean
          providerName?: string
          appointmentType?: "routine" | "follow_up" | "urgent" | "telehealth" | "screening"
          scheduledStart?: string
          scheduledEnd?: string
          reason?: string
        }
      } = {}

      if (flow.currentStage === "pharmacy") {
        payload.complete = true
        payload.needsNextVisit = draft.enabled
        if (draft.enabled) {
          const start = new Date(`${draft.date}T${draft.time}:00`)
          const end = new Date(start.getTime() + Math.max(15, Number(draft.durationMin) || 30) * 60000)
          payload.nextVisit = {
            enabled: true,
            providerName: draft.providerName,
            appointmentType: draft.appointmentType,
            scheduledStart: start.toISOString(),
            scheduledEnd: end.toISOString(),
            reason: draft.reason,
          }
        }
      }

      const res = await fetch(`/api/clinical-flow/${flow.id}/advance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? "Failed to advance flow.")
        return
      }
      await load()
    } catch {
      setError("Failed to advance flow.")
    } finally {
      setIsBusyFlowId(null)
    }
  }

  const reassignOwner = async (flowId: string, userId?: string, claimSelf?: boolean) => {
    setIsBusyFlowId(flowId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/clinical-flow/${flowId}/owner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, claimSelf }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? "Failed to reassign owner.")
        return
      }
      await load()
    } catch {
      setError("Failed to reassign owner.")
    } finally {
      setIsBusyFlowId(null)
    }
  }

  const escalateFlow = async (flowId: string) => {
    setIsBusyFlowId(flowId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/clinical-flow/${flowId}/escalate`, {
        method: "POST",
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(body.error ?? "Failed to escalate workflow.")
        return
      }
      setNotice("Workflow escalation recorded and logged.")
      await load()
    } catch {
      setError("Failed to escalate workflow.")
    } finally {
      setIsBusyFlowId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Clinical Workflows</h1>
        <p className="text-muted-foreground">Trigger and track the patient clinical flow from check-in to pharmacy completion.</p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-foreground">{notice}</p> : null}

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Patient Check-In Trigger</CardTitle>
          <CardDescription>
            Patient can scan on arrival or receptionist/admin can trigger manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-2 md:col-span-2">
            <Label>Patient</Label>
            <Select value={startForm.patientId} onValueChange={(value) => setStartForm((prev) => ({ ...prev, patientId: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((patient) => (
                  <SelectItem key={patient.id} value={patient.id}>
                    {patient.fullName} ({patient.mrn})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Entry Method</Label>
            <Select
              value={startForm.entryMethod}
              onValueChange={(value) => setStartForm((prev) => ({ ...prev, entryMethod: value as "scan" | "admin" }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scan">Scan</SelectItem>
                <SelectItem value="admin">Admin Trigger</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button className="w-full" disabled={!startForm.patientId || isStarting || !canStartFlow} onClick={() => void handleStartFlow()}>
              {isStarting ? "Starting..." : "Start Clinical Flow"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total Active</p><p className="text-2xl font-bold">{activeFlows.length}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-sm text-muted-foreground">Completed Today</p><p className="text-2xl font-bold">{completedToday}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-sm text-muted-foreground">Avg Duration</p><p className="text-2xl font-bold">{avgDurationHours}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-sm text-muted-foreground">Bottlenecks</p><p className="text-2xl font-bold">{bottlenecks}</p></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">SLA Breaches</p>
            <p className="text-2xl font-bold text-destructive">{slaOverview.breachedFlows.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Patients already beyond stage wait targets.</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Approaching SLA</p>
            <p className="text-2xl font-bold">{slaOverview.atRiskFlows.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">Patients nearing their stage wait limit.</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Worst Delay</p>
            <p className="text-2xl font-bold">
              {slaOverview.breachedFlows[0] ? toElapsedLabel(slaOverview.breachedFlows[0].updatedAt) : "0m"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {slaOverview.breachedFlows[0]
                ? `${slaOverview.breachedFlows[0].patientName} at ${slaOverview.breachedFlows[0].stageLabel}`
                : "No breached stages right now."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Workflow Pipeline</CardTitle>
          <CardDescription>Stage agents hand off automatically as the flow advances.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between overflow-x-auto pb-2">
            {stages.map((stage, idx) => {
              const Icon = STAGE_ICONS[stage.id]
              return (
                <div key={stage.id} className="flex items-center">
                  <div className="flex flex-col items-center min-w-[110px]">
                    <div className={`w-12 h-12 rounded-full ${STAGE_COLORS[stage.id]} flex items-center justify-center mb-2`}>
                      <Icon className="w-5 h-5 text-primary-foreground" />
                    </div>
                    <span className="text-xs text-center font-medium">{stage.label}</span>
                    <span className="text-xs text-muted-foreground">{stageCounts.get(stage.id) ?? 0} active</span>
                  </div>
                  {idx < stages.length - 1 && <ArrowRight className="w-5 h-5 text-muted-foreground mx-2" />}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Today's Stage Queue</CardTitle>
          <CardDescription>See which patients are waiting at each stage, who owns them, and which staff are free to pick up work.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {stageQueues.map(({ stage, stageSlaMinutes, queuedFlows, availableStaff, busyStaff, unassignedCount, breachedCount, atRiskCount }) => {
            const Icon = STAGE_ICONS[stage.id]
            const highestPriorityScore = queuedFlows[0]?.priorityScore ?? 0
            const stageSlaStatus: "on_track" | "at_risk" | "breached" =
              breachedCount > 0 ? "breached" : atRiskCount > 0 ? "at_risk" : "on_track"
            return (
              <div key={stage.id} className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${STAGE_COLORS[stage.id]}`}>
                      <Icon className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <div>
                      <p className="font-semibold">{stage.label}</p>
                      <p className="text-xs text-muted-foreground">{stage.agent}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getSlaVariant(stageSlaStatus)}>{getSlaLabel(stageSlaStatus)}</Badge>
                    {queuedFlows.length > 0 ? <Badge variant={getPriorityTone(highestPriorityScore)}>{getPriorityLabel(highestPriorityScore)}</Badge> : null}
                    <Badge variant={queuedFlows.length > 0 ? "default" : "secondary"}>{queuedFlows.length} waiting</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  <div className="rounded-md border border-border bg-background p-2">
                    <p className="text-muted-foreground">Stage SLA</p>
                    <p className="mt-1 text-base font-semibold">{formatMinutes(stageSlaMinutes)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-2">
                    <p className="text-muted-foreground">Unassigned</p>
                    <p className="mt-1 text-base font-semibold">{unassignedCount}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-2">
                    <p className="text-muted-foreground">Available Staff</p>
                    <p className="mt-1 text-base font-semibold">{availableStaff.length}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-2">
                    <p className="text-muted-foreground">Busy Staff</p>
                    <p className="mt-1 text-base font-semibold">{busyStaff.length}</p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-2">
                    <p className="text-muted-foreground">Breached</p>
                    <p className="mt-1 text-base font-semibold text-destructive">{breachedCount}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {queuedFlows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No patients waiting at this stage.</p>
                  ) : (
                    queuedFlows.map((flow) => (
                      <div key={flow.id} className="rounded-md border border-border bg-background p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{flow.patientName}</p>
                            <p className="text-xs text-muted-foreground">{flow.patientMrn}</p>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <Badge variant={getSlaVariant(flow.slaStatus)}>{getSlaLabel(flow.slaStatus)}</Badge>
                            <Badge variant={getPriorityTone(flow.priorityScore)}>{getPriorityLabel(flow.priorityScore)}</Badge>
                            <Badge variant="outline">{toElapsedLabel(flow.updatedAt)} waiting</Badge>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>Risk: {flow.patientStatus}</span>
                          <span>Visit: {(flow.appointmentType ?? "follow_up").replace("_", " ")}</span>
                          <span>SLA target: {formatMinutes(stageSlaMinutes)}</span>
                          <span>Status: {flow.workflowStatusLabel}</span>
                          <span>Next: {flow.nextActionLabel}</span>
                          <span>
                            Owner:{" "}
                            {flow.responsibleUserName
                              ? `${flow.responsibleUserName} (${flow.responsibleRoleLabel})`
                              : `${flow.responsibleRoleLabel} queue`}
                          </span>
                          <span>Last moved {toLocalDateTimeLabel(flow.updatedAt)}</span>
                        </div>
                        {flow.slaStatus !== "on_track" ? (
                          <div className="mt-3 flex justify-end">
                            <Button
                              size="sm"
                              variant={flow.slaStatus === "breached" ? "destructive" : "outline"}
                              disabled={isBusyFlowId === flow.id}
                              onClick={() => void escalateFlow(flow.id)}
                            >
                              {isBusyFlowId === flow.id ? "Escalating..." : flow.slaStatus === "breached" ? "Escalate Breach" : "Flag At Risk"}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Active Workflows</CardTitle>
          <CardDescription>Advance each patient through the clinic flow until medication is collected.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <p className="text-sm text-muted-foreground">Loading workflows...</p> : null}
          {!loading && activeFlows.length === 0 ? <p className="text-sm text-muted-foreground">No active workflows.</p> : null}
          {activeFlows.map((flow) => {
            const draft = nextVisitByFlow[flow.id] ?? makeDefaultNextVisitDraft()
            const idx = Math.max(0, stageIndex(flow.currentStage))
            const progress = stages.length === 0 ? 0 : ((idx + 1) / stages.length) * 100
            const stageMeta = stages[idx]
            const allowedRoles = getClinicalStageAllowedRoles(flow.currentStage)
            const canAdvance = canUserHandleClinicalStage(currentUser.role, flow.currentStage, currentUser.assignedStages)
            const eligibleClinicians = clinicians.filter((clinician) =>
              canUserHandleClinicalStage(clinician.role, flow.currentStage, clinician.assignedStages),
            )
            const canClaim =
              canAdvance &&
              flow.currentHandlerUserId !== currentUser.id &&
              (currentUser.availabilityStatus ?? "available") === "available"
            const isFocused = focusPatientId === flow.patientId
            return (
              <div
                key={flow.id}
                id={`workflow-patient-${flow.patientId}`}
                className={`p-4 rounded-lg border bg-secondary/20 ${isFocused ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{flow.patientName}</span>
                      <span className="text-xs text-muted-foreground">{flow.patientMrn}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{flow.entryMethod}</Badge>
                      {isFocused ? <Badge className="text-[10px] uppercase">From Task Queue</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">{flow.appointmentType ?? "follow_up"} workflow</p>
                    <p className="text-xs text-muted-foreground mt-1">Started {toLocalDateTimeLabel(flow.startedAt)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Current status: {flow.workflowStatusLabel}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Next action: {flow.nextActionLabel}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Responsible role: {flow.responsibleRoleLabel}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Current owner: {flow.responsibleUserName ? `${flow.responsibleUserName} (${flow.responsibleRoleLabel})` : "Awaiting assignment"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your stage access: {(currentUser.assignedStages ?? []).length > 0 ? currentUser.assignedStages?.join(", ") : "role default"}
                    </p>
                  </div>
                  <Badge>{stageMeta?.agent ?? "Stage Agent"}</Badge>
                </div>

                <div className="space-y-2 mb-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Current Stage</span>
                    <span className="font-medium">{stageMeta?.label ?? flow.currentStage}</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>

                {flow.currentStage === "pharmacy" ? (
                  <div className="space-y-3 border rounded-md p-3 bg-background">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={`needs-next-visit-${flow.id}`}
                        checked={draft.enabled}
                        onCheckedChange={(checked) => setDraft(flow.id, { enabled: checked === true })}
                      />
                      <Label htmlFor={`needs-next-visit-${flow.id}`}>Schedule next visit after medication collection</Label>
                    </div>
                    {draft.enabled ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label>Date</Label>
                          <Input type="date" value={draft.date} onChange={(e) => setDraft(flow.id, { date: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label>Time</Label>
                          <Input type="time" value={draft.time} onChange={(e) => setDraft(flow.id, { time: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label>Duration (min)</Label>
                          <Input
                            type="number"
                            min={15}
                            step={15}
                            value={draft.durationMin}
                            onChange={(e) => setDraft(flow.id, { durationMin: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Provider</Label>
                          <Input value={draft.providerName} onChange={(e) => setDraft(flow.id, { providerName: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label>Type</Label>
                          <Select
                            value={draft.appointmentType}
                            onValueChange={(value) =>
                              setDraft(flow.id, { appointmentType: value as NextVisitDraft["appointmentType"] })
                            }
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="routine">Routine</SelectItem>
                              <SelectItem value="follow_up">Follow Up</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                              <SelectItem value="telehealth">Telehealth</SelectItem>
                              <SelectItem value="screening">Screening</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Reason</Label>
                          <Input value={draft.reason} onChange={(e) => setDraft(flow.id, { reason: e.target.value })} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      Last updated {toLocalDateTimeLabel(flow.updatedAt)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => onOpenTasks(flow.patientId)}>
                        Open Tasks
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusyFlowId === flow.id || !canClaim}
                        onClick={() => void reassignOwner(flow.id, undefined, true)}
                      >
                        Claim Patient
                      </Button>
                      <Select onValueChange={(value) => void reassignOwner(flow.id, value, false)}>
                        <SelectTrigger className="w-[220px]">
                          <SelectValue placeholder="Reassign owner" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleClinicians.map((clinician) => (
                            <SelectItem key={clinician.id} value={clinician.id}>
                              {clinician.name} ({clinician.roleLabel})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button size="sm" disabled={isBusyFlowId === flow.id || !canAdvance} onClick={() => void advanceFlow(flow)}>
                    {!canAdvance
                      ? `Waiting for ${allowedRoles.map((role) => getRoleLabel(role)).join(" / ")}`
                      : isBusyFlowId === flow.id
                        ? "Processing..."
                        : flow.currentStage === "pharmacy"
                          ? "Medication Collected"
                          : `Advance to ${nextStageLabel(flow.currentStage)}`}
                    <Calendar className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
