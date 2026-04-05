"use client"

import { useEffect, useMemo, useState } from "react"
import { BarChart3, Brain, CheckCircle2, RefreshCw, TrendingUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

type AnalyticsMetric = {
  id: string
  label: string
  value: number
  unit: string
  target: number
  detail: string
}

type WeeklyActivityPoint = {
  day: string
  date: string
  value: number
}

type OutcomePoint = {
  id: string
  label: string
  value: number
  color: string
}

type Insight = {
  id: string
  title: string
  insight: string
  recommendation: string
}

type OperationalHealthItem = {
  id: string
  metric: string
  value: string
  status: "healthy" | "warning"
}

type AnalyticsOverview = {
  stats: AnalyticsMetric[]
  weeklyActivity: WeeklyActivityPoint[]
  outcomes: OutcomePoint[]
  insights: Insight[]
  operationalHealth: OperationalHealthItem[]
  summary: {
    totalActions: number
    avgSuccess: number
    periodLabel: string
  }
}

function metricStatus(metric: AnalyticsMetric) {
  return metric.value >= metric.target ? "On Track" : "Below Target"
}

export function AnalyticsView() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadAnalytics = async () => {
    const response = await fetch("/api/analytics/overview", { cache: "no-store" })
    const result = (await response.json()) as AnalyticsOverview
    setOverview(result)
    setIsLoading(false)
  }

  useEffect(() => {
    void loadAnalytics()

    const interval = window.setInterval(() => {
      void loadAnalytics()
    }, 15000)

    return () => window.clearInterval(interval)
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await loadAnalytics()
    setIsRefreshing(false)
  }

  const maxValue = useMemo(() => Math.max(1, ...(overview?.weeklyActivity ?? []).map((item) => item.value)), [overview?.weeklyActivity])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics & Insights</h1>
          <p className="text-muted-foreground">Live clinic analytics from appointments, workflows, alerts, and AI agent activity</p>
        </div>
        <Button onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh Analytics
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(overview?.stats ?? []).map((metric) => (
          <Card key={metric.id} className="border-0 shadow-sm">
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground mb-2">{metric.label}</p>
              <div className="flex items-end gap-2 mb-3">
                <p className="text-3xl font-bold">
                  {metric.value}
                  {metric.unit}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Target: {metric.target}{metric.unit}</span>
                  <Badge className={metric.value >= metric.target ? "bg-success/20 text-success text-[10px]" : "bg-warning/20 text-warning text-[10px]"}>
                    {metricStatus(metric)}
                  </Badge>
                </div>
                <Progress value={Math.min((metric.value / Math.max(metric.target, 1)) * 100, 100)} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{metric.detail}</p>
              </div>
            </CardContent>
          </Card>
        ))}

        {isLoading && !overview ? (
          Array.from({ length: 4 }, (_, index) => (
            <Card key={`loading-${index}`} className="border-0 shadow-sm">
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">Loading metric...</p>
              </CardContent>
            </Card>
          ))
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Weekly Activity</CardTitle>
              <CardDescription>Live workload from appointments, tasks, alerts, and clinical flows over the last 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              {overview?.weeklyActivity?.length ? (
                <div className="flex items-end justify-between gap-2 h-48">
                  {overview.weeklyActivity.map((day) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-2">
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
              ) : (
                <p className="text-sm text-muted-foreground">No weekly activity is available yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Outcome Breakdown</CardTitle>
              <CardDescription>Current distribution across re-engaged, pending, escalated, and lost follow-up states</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {(overview?.outcomes ?? []).map((outcome) => (
                  <div key={outcome.id}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm">{outcome.label}</span>
                      <span className="text-sm font-medium">{outcome.value}%</span>
                    </div>
                    <div className="h-3 bg-secondary rounded-full overflow-hidden">
                      <div className={`h-full ${outcome.color} rounded-full transition-all`} style={{ width: `${outcome.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">AI Insights</CardTitle>
              </div>
              <CardDescription>Live patterns and recommended next actions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(overview?.insights ?? []).map((insight) => (
                <div key={insight.id} className="p-3 rounded-lg bg-secondary/30">
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

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Operational Health</CardTitle>
              <CardDescription>Live operational pressure indicators</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(overview?.operationalHealth ?? []).map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <span className="text-sm">{item.metric}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.value}</span>
                    <div className={`w-2 h-2 rounded-full ${item.status === "healthy" ? "bg-success" : "bg-warning"}`} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-primary text-primary-foreground">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <BarChart3 className="w-5 h-5" />
                <span className="font-semibold">Monthly Summary</span>
              </div>
              <div className="mb-3 text-sm text-primary-foreground/80">{overview?.summary.periodLabel ?? "Live window"}</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">{overview?.summary.totalActions ?? 0}</p>
                  <p className="text-xs text-primary-foreground/70">Total Actions</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{overview?.summary.avgSuccess ?? 0}%</p>
                  <p className="text-xs text-primary-foreground/70">Avg Success</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-success mt-0.5" />
              <div>
                <p className="text-sm font-medium">Live Analytics Active</p>
                <p className="text-xs text-muted-foreground">This page refreshes from the backend every 15 seconds and no longer uses static mock data.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
