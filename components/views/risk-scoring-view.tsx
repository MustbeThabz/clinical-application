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
  reasoning: string
  recommendedAction: string
}

const riskFactors = [
  { id: "adherence", label: "Adherence", weight: 0.4 },
  { id: "appointments", label: "Missed Appointments", weight: 0.3 },
  { id: "condition", label: "Condition Severity", weight: 0.2 },
  { id: "alerts", label: "Active Alerts", weight: 0.1 },
]

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
  const [patients, setPatients] = useState<RiskPatient[]>([])

  const loadRisk = async () => {
    const response = await fetch("/api/risk-scoring", { cache: "no-store" })
    const result = (await response.json()) as { data?: RiskPatient[] }
    setPatients(result.data ?? [])
  }

  useEffect(() => {
    void loadRisk()
  }, [])

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

  const avgScore = patients.length === 0 ? 0 : Math.round(patients.reduce((sum, p) => sum + p.score, 0) / patients.length)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">AI Risk Scoring Engine</h1>
          <p className="text-muted-foreground">Risk analysis from live backend scoring data</p>
        </div>
        <Button onClick={handleRefresh} disabled={isProcessing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isProcessing ? "animate-spin" : ""}`} />
          Refresh Scores
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <Brain className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Model</p>
                <p className="text-lg font-semibold">Adherence Risk v1.0.1</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-success/10">
                <Shield className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Schema Validation</p>
                <p className="text-lg font-semibold">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-accent/10">
                <Zap className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Average Risk</p>
                <p className="text-lg font-semibold">{avgScore}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Patient Risk Analysis</CardTitle>
                  <CardDescription>Live risk scores with recommended action</CardDescription>
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
                            <p className="text-sm font-medium mb-1">AI Reasoning</p>
                            <p className="text-sm text-muted-foreground">{patient.reasoning}</p>
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
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Risk Factor Weights</CardTitle>
              <CardDescription>Input signals for scoring</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {riskFactors.map((factor) => (
                <div key={factor.id}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm">{factor.label}</span>
                    <span className="text-sm font-medium">{(factor.weight * 100).toFixed(0)}%</span>
                  </div>
                  <Progress value={factor.weight * 100} className="h-2" />
                </div>
              ))}
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
