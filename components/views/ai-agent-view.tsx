"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Lightbulb,
  MessageSquare,
  Phone,
  RefreshCw,
  Shield,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

type ReminderStageMetric = {
  stage: string
  label: string
  count: number
  status: string
}

type AgentAction = {
  id: string
  patient: string
  patientId: string
  action: string
  reason: string
  time: string
  status: string
  type: string
  occurredAt: string
}

type AgentObjective = {
  id: string
  goal: string
  active: boolean
  count: number
}

type AIAgentOverview = {
  status: {
    running: boolean
    lastUpdatedAt: string
    currentPhase: string
  }
  summary: {
    actionsToday: number
    confirmationsToday: number
    activeLoops: number
    escalationsToday: number
    successRate: number
  }
  reminderMetrics: {
    whatsappMessagesToday: number
    patientCallsToday: number
    nextOfKinCallsToday: number
    dayOfRemindersToday: number
    homeVisitEscalationsToday: number
    activeWorkflows: number
    pendingByStage: ReminderStageMetric[]
  }
  recentActions: AgentAction[]
  objectives: AgentObjective[]
}

function formatClinicTime(value?: string) {
  if (!value) return "--:--"
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value))
}

const governanceTiers = [
  {
    tier: 1,
    name: "Autonomous AI",
    description: "WhatsApp reminders, booking proposals, and low-risk scheduling support.",
    color: "bg-success/20 text-success",
  },
  {
    tier: 2,
    name: "AI + Human Oversight",
    description: "Call escalations and workflow queues handed to clinic teams for action.",
    color: "bg-warning/20 text-warning",
  },
  {
    tier: 3,
    name: "Human Escalation",
    description: "Home-care and nurse follow-up when digital outreach is unsuccessful.",
    color: "bg-destructive/20 text-destructive",
  },
]

const loopPhases = ["Goal", "Plan", "Act", "Observe", "Escalate"]

function getActionIcon(type: string) {
  switch (type) {
    case "whatsapp":
      return <MessageSquare className="w-4 h-4 text-primary" />
    case "call":
      return <Phone className="w-4 h-4 text-warning" />
    case "escalation":
      return <AlertTriangle className="w-4 h-4 text-destructive" />
    case "success":
      return <CheckCircle2 className="w-4 h-4 text-success" />
    case "booking":
      return <Target className="w-4 h-4 text-accent" />
    default:
      return <Bot className="w-4 h-4 text-muted-foreground" />
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "success":
      return <Badge className="bg-success/20 text-success">Success</Badge>
    case "in_progress":
      return <Badge className="bg-primary/20 text-primary">In Progress</Badge>
    case "completed":
      return <Badge variant="secondary">Completed</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function AIAgentView() {
  const [overview, setOverview] = useState<AIAgentOverview>({
    status: {
      running: true,
      lastUpdatedAt: "",
      currentPhase: "Plan",
    },
    summary: {
      actionsToday: 0,
      confirmationsToday: 0,
      activeLoops: 0,
      escalationsToday: 0,
      successRate: 0,
    },
    reminderMetrics: {
      whatsappMessagesToday: 0,
      patientCallsToday: 0,
      nextOfKinCallsToday: 0,
      dayOfRemindersToday: 0,
      homeVisitEscalationsToday: 0,
      activeWorkflows: 0,
      pendingByStage: [],
    },
    recentActions: [],
    objectives: [],
  })
  const [loading, setLoading] = useState(true)

  const loadOverview = async () => {
    try {
      const response = await fetch("/api/ai-agent/overview", { cache: "no-store" })
      if (!response.ok) return
      const result = (await response.json()) as { data?: AIAgentOverview }
      if (result.data) {
        setOverview(result.data)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOverview()
    const interval = window.setInterval(() => {
      void loadOverview()
    }, 15000)
    return () => window.clearInterval(interval)
  }, [])

  const statCards = [
    {
      title: "Actions Today",
      value: overview.summary.actionsToday,
      description: "Live agent actions recorded today",
      icon: Bot,
      tone: "text-primary bg-primary/10",
    },
    {
      title: "Confirmed Today",
      value: overview.summary.confirmationsToday,
      description: `${overview.summary.successRate}% success rate`,
      icon: CheckCircle2,
      tone: "text-success bg-success/10",
    },
    {
      title: "Active Loops",
      value: overview.summary.activeLoops,
      description: "Reminder workflows currently in motion",
      icon: RefreshCw,
      tone: "text-warning bg-warning/10",
    },
    {
      title: "Escalations Today",
      value: overview.summary.escalationsToday,
      description: "Calls and home-care escalations",
      icon: AlertTriangle,
      tone: "text-destructive bg-destructive/10",
    },
  ]

  const channelActivity = [
    { label: "WhatsApp Messages", value: overview.reminderMetrics.whatsappMessagesToday, icon: MessageSquare },
    { label: "Patient Calls", value: overview.reminderMetrics.patientCallsToday, icon: Phone },
    { label: "Next-of-Kin Calls", value: overview.reminderMetrics.nextOfKinCallsToday, icon: Clock },
    { label: "Day-of Reminders", value: overview.reminderMetrics.dayOfRemindersToday, icon: CheckCircle2 },
    { label: "Home-Care Escalations", value: overview.reminderMetrics.homeVisitEscalationsToday, icon: AlertTriangle },
  ]

  const currentPhase = useMemo(() => overview.status.currentPhase.toLowerCase(), [overview.status.currentPhase])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Clinical Agent</h1>
          <p className="text-muted-foreground">Live operational view of WhatsApp outreach, confirmations, calls, and escalations.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={overview.status.running ? "bg-success text-success-foreground" : "bg-muted"}>
            {overview.status.running ? "Live" : "Offline"}
          </Badge>
          <Button variant="outline" onClick={() => void loadOverview()}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {statCards.map((item) => (
          <Card key={item.title} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-2 ${item.tone.split(" ")[1]}`}>
                  <item.icon className={`w-5 h-5 ${item.tone.split(" ")[0]}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{item.value}</p>
                  <p className="text-xs font-medium text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Live Workflow Pipeline</CardTitle>
              <CardDescription>Current reminder and escalation stages being handled by the agent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.reminderMetrics.pendingByStage.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No active reminder workflows at the moment.
                </div>
              ) : (
                overview.reminderMetrics.pendingByStage.map((stage) => (
                  <div key={stage.stage} className="rounded-lg border bg-secondary/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{stage.label}</p>
                        <p className="text-xs text-muted-foreground">{stage.status.replaceAll("_", " ")}</p>
                      </div>
                      <Badge variant="secondary">{stage.count} active</Badge>
                    </div>
                    <Progress value={Math.min(100, stage.count * 10)} className="mt-3 h-2" />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Recent Agent Actions</CardTitle>
                  <CardDescription>Live activity from WhatsApp, call, confirmation, and escalation workflows.</CardDescription>
                </div>
                <Badge variant="outline" className="font-normal">
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  Polling
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.recentActions.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No recent agent actions have been recorded yet.
                </div>
              ) : (
                overview.recentActions.map((action) => (
                  <div key={action.id} className="flex items-start gap-4 rounded-lg bg-secondary/30 p-4">
                    <div className="rounded-lg bg-background p-2">{getActionIcon(action.type)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-medium">{action.patient}</span>
                        <span className="text-xs text-muted-foreground">{action.patientId}</span>
                        {getStatusBadge(action.status)}
                      </div>
                      <p className="text-sm font-medium text-primary">{action.action}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{action.reason}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{action.time}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Perception-Action Loop</CardTitle>
              <CardDescription>Current operating phase based on active workflows.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {loopPhases.map((phase) => (
                  <div
                    key={phase}
                    className={`rounded-lg p-3 text-center text-sm font-medium ${
                      currentPhase === phase.toLowerCase() ? "bg-primary text-primary-foreground" : "bg-secondary/50"
                    }`}
                  >
                    {phase}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Last synced {formatClinicTime(overview.status.lastUpdatedAt)}.
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Channel Activity</CardTitle>
              <CardDescription>Today&apos;s live activity across messaging and call channels.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {channelActivity.map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-lg bg-secondary/30 p-3">
                  <div className="flex items-center gap-3">
                    <item.icon className="w-4 h-4 text-primary" />
                    <span className="text-sm">{item.label}</span>
                  </div>
                  <span className="text-lg font-semibold">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Automation Objectives</CardTitle>
              <CardDescription>What the clinical agent is actively handling right now.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.objectives.map((goal) => (
                <div key={goal.id} className="flex items-center justify-between rounded-lg bg-secondary/30 p-3">
                  <div>
                    <p className="text-sm font-medium">{goal.goal}</p>
                    <p className="text-xs text-muted-foreground">{goal.active ? "Active" : "Paused"}</p>
                  </div>
                  <Badge variant="secondary">{goal.count}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Governance Model</CardTitle>
              <CardDescription>Human oversight boundaries for the clinical agent.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {governanceTiers.map((tier) => (
                <div key={tier.tier} className={`rounded-lg p-3 ${tier.color}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    <span className="text-sm font-medium">{tier.name}</span>
                  </div>
                  <p className="text-xs opacity-90">{tier.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 border-l-4 border-l-primary shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Lightbulb className="mt-0.5 w-5 h-5 shrink-0 text-primary" />
                <div>
                  <p className="mb-1 text-sm font-medium">What This Page Is For</p>
                  <p className="text-xs text-muted-foreground">
                    This is the live operations console for the clinic agent. It shows what the automation is doing now,
                    where patients are in the reminder flow, and when a human team needs to step in.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
