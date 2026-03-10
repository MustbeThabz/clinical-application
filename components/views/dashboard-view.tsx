"use client"

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  TrendingUp,
  Users,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

const statsCards = [
  {
    title: "Active Patients",
    value: "2,847",
    change: "+12%",
    trend: "up",
    icon: Users,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    title: "High Risk Cases",
    value: "23",
    change: "-8%",
    trend: "down",
    icon: AlertTriangle,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
  },
  {
    title: "AI Actions Today",
    value: "156",
    change: "+24%",
    trend: "up",
    icon: Bot,
    color: "text-accent",
    bgColor: "bg-accent/10",
  },
  {
    title: "Appointments Today",
    value: "48",
    change: "+5%",
    trend: "up",
    icon: Calendar,
    color: "text-success",
    bgColor: "bg-success/10",
  },
]

const recentAlerts = [
  {
    id: 1,
    patient: "John Doe",
    patientId: "P-1024",
    risk: 0.92,
    level: "HIGH",
    reason: "Missed CHF follow-up + Confusion symptoms + Meds interruption",
    action: "Escalate to nurse within 24 hours",
    time: "2 min ago",
  },
  {
    id: 2,
    patient: "Maria Santos",
    patientId: "P-2156",
    risk: 0.78,
    level: "HIGH",
    reason: "7 days missed medication + Detectable viral load",
    action: "Immediate clinical review",
    time: "15 min ago",
  },
  {
    id: 3,
    patient: "Robert Chen",
    patientId: "P-3891",
    risk: 0.65,
    level: "MEDIUM",
    reason: "Missed 2 consecutive appointments",
    action: "Automated call scheduled",
    time: "32 min ago",
  },
  {
    id: 4,
    patient: "Emily Watson",
    patientId: "P-4521",
    risk: 0.45,
    level: "LOW",
    reason: "Missed flu shot appointment",
    action: "SMS reminder sent",
    time: "1 hr ago",
  },
]

const workflowStats = [
  { label: "Pending Review", value: 12, total: 50, color: "bg-warning" },
  { label: "In Progress", value: 28, total: 50, color: "bg-primary" },
  { label: "Completed", value: 47, total: 50, color: "bg-success" },
]

const agentActivity = [
  { action: "SMS Reminder Sent", count: 89, icon: CheckCircle2 },
  { action: "Voice Calls Triggered", count: 24, icon: Activity },
  { action: "Nurse Escalations", count: 12, icon: AlertTriangle },
  { action: "Files Flagged", count: 31, icon: Clock },
]

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

export function DashboardView() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Clinical Dashboard</h1>
        <p className="text-muted-foreground">AI-powered overview of patient care and system operations</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat) => (
          <Card key={stat.title} className="border-0 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-3xl font-bold mt-1">{stat.value}</p>
                  <div className="flex items-center gap-1 mt-2">
                    {stat.trend === "up" ? (
                      <ArrowUp className="w-3 h-3 text-success" />
                    ) : (
                      <ArrowDown className="w-3 h-3 text-success" />
                    )}
                    <span className="text-xs text-success font-medium">{stat.change}</span>
                    <span className="text-xs text-muted-foreground">vs last week</span>
                  </div>
                </div>
                <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                  <stat.icon className={`w-6 h-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Alerts */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">AI Risk Alerts</CardTitle>
                <CardDescription>Patients requiring attention based on AI analysis</CardDescription>
              </div>
              <Badge variant="outline" className="font-normal">
                <Activity className="w-3 h-3 mr-1" />
                Live
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-4 p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold ${
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
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{alert.patient}</span>
                      <span className="text-xs text-muted-foreground">{alert.patientId}</span>
                      <Badge variant={getRiskBadgeVariant(alert.level)} className="text-[10px]">
                        {alert.level}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{alert.reason}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-primary font-medium">{alert.action}</span>
                      <span className="text-xs text-muted-foreground">{alert.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Side Panel */}
        <div className="space-y-6">
          {/* Workflow Status */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Workflow Status</CardTitle>
              <CardDescription>Current clinical workflow progress</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {workflowStats.map((stat) => (
                <div key={stat.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm">{stat.label}</span>
                    <span className="text-sm font-medium">
                      {stat.value}/{stat.total}
                    </span>
                  </div>
                  <Progress value={(stat.value / stat.total) * 100} className={`h-2 ${stat.color}`} />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Agent Activity */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">AI Agent Activity</CardTitle>
              <CardDescription>Actions completed today</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {agentActivity.map((item) => (
                  <div key={item.action} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                    <div className="flex items-center gap-3">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{item.action}</span>
                    </div>
                    <span className="text-lg font-bold text-primary">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* System Health */}
          <Card className="border-0 shadow-sm bg-primary text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <TrendingUp className="w-5 h-5" />
                <span className="font-semibold">System Performance</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">99.8%</p>
                  <p className="text-xs text-primary-foreground/70">Uptime</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{"<"}1s</p>
                  <p className="text-xs text-primary-foreground/70">Avg Response</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
