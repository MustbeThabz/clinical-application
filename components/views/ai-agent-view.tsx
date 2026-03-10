"use client"

import { useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Eye,
  Lightbulb,
  MessageSquare,
  Pause,
  Phone,
  Play,
  RefreshCw,
  Settings,
  Target,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

const agentGoals = [
  { id: 1, goal: "Safely Re-engage Patient", active: true, successRate: 87 },
  { id: 2, goal: "Medication Adherence Monitoring", active: true, successRate: 92 },
  { id: 3, goal: "Appointment Confirmation", active: true, successRate: 95 },
  { id: 4, goal: "Risk Assessment Updates", active: false, successRate: 78 },
]

const agentSteps = [
  { step: "Identify", description: "Detect missed appointments or lab delays", icon: Eye },
  { step: "Assess", description: "Evaluate clinical risk based on history", icon: TrendingUp },
  { step: "Prioritize", description: "Rank patients based on urgency", icon: Target },
  { step: "Trigger", description: "Execute follow-up actions (SMS, calls)", icon: Zap },
  { step: "Escalate", description: "Hand off high-risk cases to clinicians", icon: AlertTriangle },
]

const recentActions = [
  {
    id: 1,
    patient: "John Doe",
    patientId: "P-1024",
    action: "Escalated to Nurse",
    reason: "High risk score (0.92) + No response to 2 SMS",
    time: "2 min ago",
    status: "completed",
    type: "escalation",
  },
  {
    id: 2,
    patient: "Maria Santos",
    patientId: "P-2156",
    action: "Voice Call Triggered",
    reason: "No response to SMS after 24hrs",
    time: "15 min ago",
    status: "in-progress",
    type: "call",
  },
  {
    id: 3,
    patient: "Robert Chen",
    patientId: "P-3891",
    action: "SMS Reminder Sent",
    reason: "Missed appointment - First offense",
    time: "32 min ago",
    status: "completed",
    type: "sms",
  },
  {
    id: 4,
    patient: "Emily Watson",
    patientId: "P-4521",
    action: "Goal Achieved",
    reason: "Patient responded and rescheduled",
    time: "1 hr ago",
    status: "success",
    type: "success",
  },
]

const perceptionLoop = [
  { phase: "Goal", description: "Re-engage Patient", active: false },
  { phase: "Interpret", description: "Parse health record signals", active: false },
  { phase: "Plan", description: "Select intervention strategy", active: true },
  { phase: "Act", description: "Execute follow-up action", active: false },
  { phase: "Observe", description: "Monitor for response", active: false },
  { phase: "Re-plan", description: "Adapt if needed", active: false },
]

const governanceTiers = [
  {
    tier: 1,
    name: "Autonomous AI",
    description: "Routine reminders, scheduling, low-risk admin",
    color: "bg-success/20 text-success",
  },
  {
    tier: 2,
    name: "AI + Human Oversight",
    description: "Ambiguous cases. AI proposes -> Human approves",
    color: "bg-warning/20 text-warning",
  },
  {
    tier: 3,
    name: "Human Only",
    description: "High-risk, complex clinical judgment",
    color: "bg-destructive/20 text-destructive",
  },
]

function getActionIcon(type: string) {
  switch (type) {
    case "escalation":
      return <AlertTriangle className="w-4 h-4 text-destructive" />
    case "call":
      return <Phone className="w-4 h-4 text-primary" />
    case "sms":
      return <MessageSquare className="w-4 h-4 text-accent" />
    case "success":
      return <CheckCircle2 className="w-4 h-4 text-success" />
    default:
      return <Bot className="w-4 h-4 text-muted-foreground" />
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="secondary">Completed</Badge>
    case "in-progress":
      return <Badge className="bg-primary/20 text-primary">In Progress</Badge>
    case "success":
      return <Badge className="bg-success/20 text-success">Success</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function AIAgentView() {
  const [isAgentRunning, setIsAgentRunning] = useState(true)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Clinical Agent</h1>
          <p className="text-muted-foreground">
            Goal-driven agentic AI for patient re-engagement and clinical support
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="agent-toggle" className="text-sm">
              Agent Status
            </Label>
            <Switch
              id="agent-toggle"
              checked={isAgentRunning}
              onCheckedChange={setIsAgentRunning}
            />
          </div>
          <Badge className={isAgentRunning ? "bg-success text-success-foreground" : "bg-muted"}>
            {isAgentRunning ? "Running" : "Paused"}
          </Badge>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">156</p>
                <p className="text-xs text-muted-foreground">Actions Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">89%</p>
                <p className="text-xs text-muted-foreground">Success Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <RefreshCw className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">23</p>
                <p className="text-xs text-muted-foreground">Active Loops</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">7</p>
                <p className="text-xs text-muted-foreground">Escalations</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Goal Decomposition */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Agent Goal Decomposition</CardTitle>
              <CardDescription>
                Automated decomposition ensures no step in the re-engagement process is skipped
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between overflow-x-auto pb-2">
                {agentSteps.map((step, index) => (
                  <div key={step.step} className="flex items-center">
                    <div className="flex flex-col items-center min-w-[100px]">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                        <step.icon className="w-5 h-5 text-primary" />
                      </div>
                      <span className="text-sm font-medium">{step.step}</span>
                      <span className="text-[10px] text-muted-foreground text-center mt-1 max-w-[90px]">
                        {step.description}
                      </span>
                    </div>
                    {index < agentSteps.length - 1 && (
                      <ArrowRight className="w-4 h-4 text-muted-foreground mx-1" />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Agent Actions */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Recent Agent Actions</CardTitle>
                  <CardDescription>Real-time log of AI agent activities</CardDescription>
                </div>
                <Badge variant="outline" className="font-normal">
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  Live
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentActions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-start gap-4 p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                >
                  <div className="p-2 rounded-lg bg-background">
                    {getActionIcon(action.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{action.patient}</span>
                      <span className="text-xs text-muted-foreground">{action.patientId}</span>
                      {getStatusBadge(action.status)}
                    </div>
                    <p className="text-sm font-medium text-primary">{action.action}</p>
                    <p className="text-xs text-muted-foreground mt-1">{action.reason}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{action.time}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Perception-Action Loop */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Perception-Action Loop</CardTitle>
              <CardDescription>Iterative cycle until goal is achieved</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <div className="grid grid-cols-3 gap-2">
                  {perceptionLoop.map((phase, index) => (
                    <div
                      key={phase.phase}
                      className={`p-3 rounded-lg text-center ${
                        phase.active
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/50"
                      }`}
                    >
                      <p className="text-xs font-medium">{phase.phase}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-center mt-3">
                  <RefreshCw className="w-5 h-5 text-primary animate-spin" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Goals */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Active Goals</CardTitle>
              <CardDescription>Configure agent objectives</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {agentGoals.map((goal) => (
                <div
                  key={goal.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <div className="flex items-center gap-3">
                    <Switch checked={goal.active} />
                    <div>
                      <p className="text-sm font-medium">{goal.goal}</p>
                      <p className="text-xs text-muted-foreground">
                        {goal.successRate}% success rate
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Governance Tiers */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Governance Model</CardTitle>
              <CardDescription>Human-in-the-loop tiered escalation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {governanceTiers.map((tier) => (
                <div key={tier.tier} className={`p-3 rounded-lg ${tier.color}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold">Tier {tier.tier}</span>
                    <span className="text-sm font-medium">{tier.name}</span>
                  </div>
                  <p className="text-xs opacity-80">{tier.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Key Insight */}
          <Card className="border-0 shadow-sm border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium mb-1">Key Distinction</p>
                  <p className="text-xs text-muted-foreground">
                    This is an AI worker, not a chatbot. It continuously supports clinical teams
                    while respecting safety and accountability.
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
