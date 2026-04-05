"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Brain, CheckCircle2, Filter, RefreshCw, Shield, Zap } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"

type RiskPatient = {
  id: string
  mrn: string
  name: string
  condition: string
  score: number
  level: "Low Risk" | "Medium Risk" | "High Risk" | "Critical"
  factors: string[]
  reasoning: string
  recommendedAction: string
}

type RiskScoringOverview = {
  modelName: string
  modelVersion: string
  schemaValidation: string
  averageRisk: number
  patientCount: number
  highRiskCount: number
  criticalCount: number
  factorWeights: Array<{
    id: string
    label: string
    weight: number
  }>
}

function getRiskColor(score: number) {
  if (score >= 70) return "text-destructive"
  if (score >= 50) return "text-warning"
  return "text-success"
}

function getRiskBg(score: number) {
  if (score >= 70) return "bg-destructive/10"
  if (score >= 50) return "bg-warning/10"
  return "bg-success/10"
}

export function RiskScoringView() {
  const [selectedFilter, setSelectedFilter] = useState("all")
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [patients, setPatients] = useState<RiskPatient[]>([])
  const [overview, setOverview] = useState<RiskScoringOverview | null>(null)

  const loadRisk = async () => {
    const response = await fetch("/api/risk-scoring", { cache: "no-store" })
    const result = (await response.json()) as { data?: RiskPatient[]; overview?: RiskScoringOverview }
    setPatients(result.data ?? [])
    setOverview(result.overview ?? null)
    setIsLoading(false)
  }

  useEffect(() => {
    void loadRisk()

    const interval = window.setInterval(() => {
      void loadRisk()
    }, 15000)

    return () => window.clearInterval(interval)
  }, [])

  const summaryCards = [
    {
      id: "model",
      label: "Intent Model",
      value: overview?.modelName ?? (isLoading ? "Loading..." : "Unavailable"),
      detail: overview?.modelVersion ?? "Awaiting backend",
      icon: Brain,
      tone: "bg-primary/10 text-primary",
    },
    {
      id: "validation",
      label: "Validation",
      value: overview?.schemaValidation ?? (isLoading ? "Loading..." : "Unavailable"),
      detail: "Live API and schema guardrails",
      icon: Shield,
      tone: "bg-success/10 text-success",
    },
    {
      id: "patients",
      label: "Patients Monitored",
      value: String(overview?.patientCount ?? 0),
      detail: `${overview?.highRiskCount ?? 0} high risk, ${overview?.criticalCount ?? 0} critical`,
      icon: CheckCircle2,
      tone: "bg-accent/10 text-accent",
    },
    {
      id: "average-risk",
      label: "Average Risk",
      value: String(overview?.averageRisk ?? 0),
      detail: "Blended intent score across live signals",
      icon: Zap,
      tone: "bg-warning/10 text-warning",
    },
  ]

  const selectedFilterLabel =
    selectedFilter === "all" ? "all live patients" : `${selectedFilter} risk patients`

  const liveFactorWeights = overview?.factorWeights ?? []

  const intentNarrative =
    liveFactorWeights.length > 0
      ? `The engine is currently blending ${liveFactorWeights
          .map((factor) => `${factor.label.toLowerCase()} (${Math.round(factor.weight * 100)}%)`)
          .join(", ")}.`
      : "Intent signals will appear here once the scoring engine responds."

  const topPriorityPatient = patients[0]

  const handleRefresh = async () => {
    setIsProcessing(true)
    await fetch("/api/risk-scoring/recalculate", { method: "POST" })
    await loadRisk()
    setIsProcessing(false)
  }

  const filtered = useMemo(() => {
    if (selectedFilter === "all") return patients
    return patients.filter((p) => p.level.toLowerCase().includes(selectedFilter))
  }, [patients, selectedFilter])

  const hasPatients = filtered.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Intent Risk Scoring</h1>
          <p className="text-muted-foreground">Live clinical risk signals from adherence, appointments, alerts, and manual status</p>
        </div>
        <Button onClick={handleRefresh} disabled={isProcessing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isProcessing ? "animate-spin" : ""}`} />
          Refresh Scores
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const Icon = card.icon
          return (
            <Card key={card.id} className="border-0 shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${card.tone}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                    <p className="text-lg font-semibold">{card.value}</p>
                    <p className="text-xs text-muted-foreground">{card.detail}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Patient Intent Analysis</CardTitle>
                  <CardDescription>Showing {selectedFilterLabel} ranked by the live scoring engine</CardDescription>
                </div>
                <Select value={selectedFilter} onValueChange={setSelectedFilter}>
                  <SelectTrigger className="w-36">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Risks</SelectItem>
                    <SelectItem value="high">High Only</SelectItem>
                    <SelectItem value="medium">Medium Only</SelectItem>
                    <SelectItem value="low">Low Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {!hasPatients ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                  <p className="font-medium text-foreground">{isLoading ? "Loading live risk signals..." : "No patients match this filter"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isLoading ? "The scoring engine is fetching the latest intent profile." : "Try another filter or refresh scores."}
                  </p>
                </div>
              ) : (
                <Accordion type="single" collapsible className="space-y-3">
                  {filtered.map((patient) => (
                    <AccordionItem key={patient.id} value={patient.id} className={`border rounded-lg px-4 ${getRiskBg(patient.score)}`}>
                      <AccordionTrigger className="hover:no-underline py-4">
                        <div className="flex items-center gap-4 w-full">
                          <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold ${getRiskBg(patient.score)} ${getRiskColor(patient.score)}`}>
                            {Math.round(patient.score)}
                          </div>
                          <div className="flex-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{patient.name}</span>
                              <span className="text-xs text-muted-foreground">{patient.mrn}</span>
                              <Badge variant={patient.level === "Critical" || patient.level === "High Risk" ? "destructive" : patient.level === "Medium Risk" ? "default" : "secondary"} className="text-[10px]">
                                {patient.level}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{patient.condition}</p>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <div className="p-4 rounded-lg bg-background border border-border">
                          <div className="flex items-start gap-3">
                            <Brain className="w-5 h-5 text-primary mt-0.5" />
                            <div>
                              <p className="text-sm font-medium mb-1">Intent Reasoning</p>
                              <p className="text-sm text-muted-foreground">{patient.reasoning}</p>
                              <div className="mt-3 space-y-1">
                                {patient.factors.map((factor) => (
                                  <p key={factor} className="text-xs text-muted-foreground">
                                    {factor}
                                  </p>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                          <div className="flex items-center gap-2">
                            <ArrowRight className="w-4 h-4 text-primary" />
                            <span className="text-sm font-medium">{patient.recommendedAction}</span>
                          </div>
                          <Button size="sm">Execute Action</Button>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Intent Signal Weights</CardTitle>
              <CardDescription>{intentNarrative}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {liveFactorWeights.length === 0 ? (
                <p className="text-sm text-muted-foreground">No live weights available yet.</p>
              ) : (
                liveFactorWeights.map((factor) => (
                  <div key={factor.id}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm">{factor.label}</span>
                      <span className="text-sm font-medium">{(factor.weight * 100).toFixed(0)}%</span>
                    </div>
                    <Progress value={factor.weight * 100} className="h-2" />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Highest Priority Right Now</CardTitle>
              <CardDescription>Top patient from the current live ranking</CardDescription>
            </CardHeader>
            <CardContent>
              {topPriorityPatient ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{topPriorityPatient.name}</p>
                      <p className="text-sm text-muted-foreground">{topPriorityPatient.mrn}</p>
                    </div>
                    <Badge variant={topPriorityPatient.level === "Critical" || topPriorityPatient.level === "High Risk" ? "destructive" : "secondary"}>
                      {topPriorityPatient.level}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{topPriorityPatient.reasoning}</p>
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Recommended next step</p>
                    <p className="mt-1 text-sm font-medium text-foreground">{topPriorityPatient.recommendedAction}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No patient priority signal available yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm border-l-4 border-l-warning">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium mb-1">Safety First</p>
                  <p className="text-xs text-muted-foreground">
                    High-risk scores require human review before clinical action.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-success mt-0.5" />
              <div>
                <p className="text-sm font-medium">Guardrails Active</p>
                <p className="text-xs text-muted-foreground">RBAC, schema validation, and audit logs enforced by backend API.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
