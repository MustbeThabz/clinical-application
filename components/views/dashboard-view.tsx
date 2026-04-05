"use client"

import { useEffect, useState } from "react"
import {
  Activity,
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  MessageSquare,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

type DashboardOverview = {
  stats: {
    activePatients: number
    highRiskCases: number
    aiActionsToday: number
    appointmentsToday: number
  }
  riskAlerts: Array<{
    id: string
    patient: string
    patientId: string
    risk: number
    level: string
    reason: string
    action: string
    time: string
  }>
  workflowStatus: Array<{
    label: string
    value: number
    total: number
    color: string
  }>
  agentActivity: Array<{
    action: string
    count: number
    icon: string
  }>
  operationalSnapshot: {
    openAlerts: number
    openTasks: number
    activeLoops: number
    lastUpdatedAt: string
  }
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

function getRiskBadgeVariant(level: string) {
  switch (level) {
    case "HIGH":
      return "destructive"
    case "MEDIUM":
      return "default"
    default:
      return "secondary"
  }
}

function getActivityIcon(icon: string) {
  switch (icon) {
    case "whatsapp":
      return MessageSquare
    case "call":
      return Activity
    case "clock":
      return Clock
    default:
      return AlertTriangle
  }
}

export function DashboardView() {
  const [overview, setOverview] = useState<DashboardOverview>({
    stats: {
      activePatients: 0,
      highRiskCases: 0,
      aiActionsToday: 0,
      appointmentsToday: 0,
    },
    riskAlerts: [],
    workflowStatus: [],
    agentActivity: [],
    operationalSnapshot: {
      openAlerts: 0,
      openTasks: 0,
      activeLoops: 0,
      lastUpdatedAt: "",
    },
  })
  const [loading, setLoading] = useState(true)

  const loadOverview = async () => {
    try {
      const response = await fetch("/api/dashboard/overview", { cache: "no-store" })
      if (!response.ok) return
      const result = (await response.json()) as { data?: DashboardOverview }
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

  const statsCards = [
    {
      title: "Active Patients",
      value: overview.stats.activePatients,
      caption: "Current patient cohort",
      icon: Users,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "High Risk Cases",
      value: overview.stats.highRiskCases,
      caption: "Patients needing closer attention",
      icon: AlertTriangle,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
    },
    {
      title: "AI Actions Today",
      value: overview.stats.aiActionsToday,
      caption: "Live agent actions recorded today",
      icon: Bot,
      color: "text-accent",
      bgColor: "bg-accent/10",
    },
    {
      title: "Appointments Today",
      value: overview.stats.appointmentsToday,
      caption: "Appointments scheduled for today",
      icon: Calendar,
      color: "text-success",
      bgColor: "bg-success/10",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clinical Dashboard</h1>
          <p className="text-muted-foreground">Live overview of patients, risk, workflows, scheduling, and AI agent activity.</p>
        </div>
        <Button variant="outline" onClick={() => void loadOverview()}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat) => (
          <Card key={stat.title} className="border-0 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="mt-1 text-3xl font-bold">{stat.value}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{stat.caption}</p>
                </div>
                <div className={`rounded-xl p-3 ${stat.bgColor}`}>
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">AI Risk Alerts</CardTitle>
                <CardDescription>Live patients requiring attention based on the current risk model.</CardDescription>
              </div>
              <Badge variant="outline" className="font-normal">
                <Activity className="w-3 h-3 mr-1" />
                Live
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {overview.riskAlerts.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No live risk alerts are available yet.
                </div>
              ) : (
                overview.riskAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-start gap-4 rounded-lg bg-secondary/30 p-4 transition-colors hover:bg-secondary/50">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold ${
                          alert.level === "HIGH"
                            ? "bg-destructive/20 text-destructive"
                            : alert.level === "MEDIUM"
                              ? "bg-warning/20 text-warning"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {Math.round(alert.risk * 100)}
                      </div>
                      <span className="text-[10px] text-muted-foreground">Score</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-semibold">{alert.patient}</span>
                        <span className="text-xs text-muted-foreground">{alert.patientId}</span>
                        <Badge variant={getRiskBadgeVariant(alert.level)} className="text-[10px]">
                          {alert.level}
                        </Badge>
                      </div>
                      <p className="mb-2 text-sm text-muted-foreground">{alert.reason}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-primary">{alert.action}</span>
                        <span className="text-xs text-muted-foreground">{alert.time}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Workflow Status</CardTitle>
              <CardDescription>Live operational load across escalations and clinical flows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {overview.workflowStatus.map((stat) => (
                <div key={stat.label}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm">{stat.label}</span>
                    <span className="text-sm font-medium">
                      {stat.value}/{stat.total}
                    </span>
                  </div>
                  <Progress value={(stat.value / Math.max(1, stat.total)) * 100} className="h-2" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">AI Agent Activity</CardTitle>
              <CardDescription>Live channel activity recorded today.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {overview.agentActivity.map((item) => {
                  const Icon = getActivityIcon(item.icon)
                  return (
                    <div key={item.action} className="flex items-center justify-between rounded-lg bg-secondary/30 p-3">
                      <div className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{item.action}</span>
                      </div>
                      <span className="text-lg font-bold text-primary">{item.count}</span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-primary text-primary-foreground">
            <CardContent className="p-6">
              <div className="mb-4 flex items-center gap-3">
                <TrendingUp className="w-5 h-5" />
                <span className="font-semibold">Operational Snapshot</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">{overview.operationalSnapshot.openAlerts}</p>
                  <p className="text-xs text-primary-foreground/70">Open alerts</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{overview.operationalSnapshot.openTasks}</p>
                  <p className="text-xs text-primary-foreground/70">Open tasks</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{overview.operationalSnapshot.activeLoops}</p>
                  <p className="text-xs text-primary-foreground/70">Active AI loops</p>
                </div>
                <div>
                  <p className="text-sm font-semibold">{formatClinicTime(overview.operationalSnapshot.lastUpdatedAt)}</p>
                  <p className="text-xs text-primary-foreground/70">Last updated</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
