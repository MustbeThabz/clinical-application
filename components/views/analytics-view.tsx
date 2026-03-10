"use client"

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Brain,
  CheckCircle2,
  Clock,
  TrendingUp,
  Users,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

const performanceMetrics = [
  {
    label: "Patient Re-engagement Rate",
    value: 87,
    target: 85,
    change: "+5%",
    trend: "up",
  },
  {
    label: "Appointment Adherence",
    value: 92,
    target: 90,
    change: "+3%",
    trend: "up",
  },
  {
    label: "Avg Response Time",
    value: 2.4,
    target: 3,
    unit: "hrs",
    change: "-18%",
    trend: "down",
  },
  {
    label: "Escalation Accuracy",
    value: 94,
    target: 90,
    change: "+2%",
    trend: "up",
  },
]

const weeklyData = [
  { day: "Mon", value: 45 },
  { day: "Tue", value: 52 },
  { day: "Wed", value: 49 },
  { day: "Thu", value: 63 },
  { day: "Fri", value: 58 },
  { day: "Sat", value: 24 },
  { day: "Sun", value: 18 },
]

const outcomeBreakdown = [
  { label: "Successfully Re-engaged", value: 67, color: "bg-success" },
  { label: "Pending Response", value: 18, color: "bg-warning" },
  { label: "Escalated to Clinician", value: 12, color: "bg-primary" },
  { label: "Lost to Follow-up", value: 3, color: "bg-destructive" },
]

const aiInsights = [
  {
    title: "Peak No-Show Hours",
    insight: "10:00 AM - 12:00 PM appointments have 23% higher no-show rate",
    recommendation: "Consider overbooking or additional reminders for this slot",
  },
  {
    title: "High-Risk Pattern",
    insight: "Patients with 2+ missed appointments in 30 days have 78% dropout risk",
    recommendation: "Trigger immediate nurse outreach after second miss",
  },
  {
    title: "Channel Effectiveness",
    insight: "SMS has 45% response rate vs 28% for email",
    recommendation: "Prioritize SMS for time-sensitive communications",
  },
]

const systemHealth = [
  { metric: "API Uptime", value: "99.97%", status: "healthy" },
  { metric: "Avg Latency", value: "847ms", status: "healthy" },
  { metric: "Error Rate", value: "0.03%", status: "healthy" },
  { metric: "Token Usage", value: "2.4M/day", status: "normal" },
]

export function AnalyticsView() {
  const maxValue = Math.max(...weeklyData.map((d) => d.value))

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics & Insights</h1>
        <p className="text-muted-foreground">
          AI-powered analytics for clinical operations and patient outcomes
        </p>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {performanceMetrics.map((metric) => (
          <Card key={metric.label} className="border-0 shadow-sm">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground mb-2">{metric.label}</p>
              <div className="flex items-end gap-2 mb-3">
                <p className="text-3xl font-bold">
                  {metric.value}
                  {metric.unit || "%"}
                </p>
                <div
                  className={`flex items-center gap-0.5 text-xs font-medium ${
                    metric.trend === "up" ? "text-success" : "text-success"
                  }`}
                >
                  {metric.trend === "up" ? (
                    <ArrowUp className="w-3 h-3" />
                  ) : (
                    <ArrowDown className="w-3 h-3" />
                  )}
                  {metric.change}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Target: {metric.target}{metric.unit || "%"}</span>
                  {metric.value >= metric.target ? (
                    <Badge className="bg-success/20 text-success text-[10px]">On Track</Badge>
                  ) : (
                    <Badge className="bg-warning/20 text-warning text-[10px]">Below Target</Badge>
                  )}
                </div>
                <Progress
                  value={Math.min((metric.value / metric.target) * 100, 100)}
                  className="h-1.5"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Charts */}
        <div className="lg:col-span-2 space-y-6">
          {/* Weekly Activity */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Weekly Activity</CardTitle>
              <CardDescription>AI agent actions over the past week</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between gap-2 h-48">
                {weeklyData.map((day) => (
                  <div key={day.day} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full flex flex-col items-center justify-end h-40">
                      <div
                        className="w-full max-w-[40px] bg-primary rounded-t-md transition-all hover:bg-primary/80"
                        style={{ height: `${(day.value / maxValue) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{day.day}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Outcome Breakdown */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Outcome Breakdown</CardTitle>
              <CardDescription>Distribution of patient re-engagement outcomes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {outcomeBreakdown.map((outcome) => (
                  <div key={outcome.label}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm">{outcome.label}</span>
                      <span className="text-sm font-medium">{outcome.value}%</span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full ${outcome.color} rounded-full transition-all`}
                        style={{ width: `${outcome.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* AI Insights */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">AI Insights</CardTitle>
              </div>
              <CardDescription>Pattern detection and recommendations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {aiInsights.map((insight, index) => (
                <div key={index} className="p-3 rounded-lg bg-secondary/30">
                  <p className="text-sm font-medium mb-1">{insight.title}</p>
                  <p className="text-xs text-muted-foreground mb-2">{insight.insight}</p>
                  <div className="flex items-start gap-2 p-2 rounded bg-primary/5 border border-primary/20">
                    <TrendingUp className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                    <p className="text-[11px] text-primary">{insight.recommendation}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* System Health */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">System Health</CardTitle>
              <CardDescription>AI infrastructure metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {systemHealth.map((item) => (
                <div
                  key={item.metric}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <span className="text-sm">{item.metric}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.value}</span>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        item.status === "healthy" ? "bg-success" : "bg-warning"
                      }`}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Summary Card */}
          <Card className="border-0 shadow-sm bg-primary text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <BarChart3 className="w-5 h-5" />
                <span className="font-semibold">Monthly Summary</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">4,521</p>
                  <p className="text-xs text-primary-foreground/70">Total Actions</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">89%</p>
                  <p className="text-xs text-primary-foreground/70">Avg Success</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
