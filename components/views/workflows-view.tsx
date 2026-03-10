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
  status: "active" | "completed" | "cancelled"
  needsNextVisit: boolean
  startedAt: string
  updatedAt: string
  completedAt?: string
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

function toLocalDateTimeLabel(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
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

export function WorkflowsView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stages, setStages] = useState<StageItem[]>([])
  const [patients, setPatients] = useState<PatientLite[]>([])
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
      const body = (await res.json()) as { data?: FlowItem[]; patients?: PatientLite[]; stages?: StageItem[]; error?: string }
      if (!res.ok) {
        setError(body.error ?? "Failed to load clinical flows.")
        return
      }
      setFlows(body.data ?? [])
      setPatients(body.patients ?? [])
      setStages(body.stages ?? [])
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

  const handleStartFlow = async () => {
    if (!startForm.patientId) return
    setIsStarting(true)
    setError(null)
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Clinical Workflows</h1>
        <p className="text-muted-foreground">Trigger and track the patient clinical flow from check-in to pharmacy completion.</p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Patient Check-In Trigger</CardTitle>
          <CardDescription>Patient can scan on arrival or admin can trigger manually.</CardDescription>
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
            <Button className="w-full" disabled={!startForm.patientId || isStarting} onClick={() => void handleStartFlow()}>
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
            return (
              <div key={flow.id} className="p-4 rounded-lg border border-border bg-secondary/20">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{flow.patientName}</span>
                      <span className="text-xs text-muted-foreground">{flow.patientMrn}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{flow.entryMethod}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{flow.appointmentType ?? "follow_up"} workflow</p>
                    <p className="text-xs text-muted-foreground mt-1">Started {toLocalDateTimeLabel(flow.startedAt)}</p>
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
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    Last updated {toLocalDateTimeLabel(flow.updatedAt)}
                  </div>
                  <Button size="sm" disabled={isBusyFlowId === flow.id} onClick={() => void advanceFlow(flow)}>
                    {isBusyFlowId === flow.id
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
