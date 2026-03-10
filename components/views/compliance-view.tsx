"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, FileText, Key, Lock, RefreshCw, Shield, ShieldCheck, User } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

type ComplianceCheck = {
  name: string
  status: string
  lastCheck: string
}

type AuditItem = {
  id: string
  action: string
  patient: string
  user: string
  details: string
  time: string
}

type ComplianceOverview = {
  checks: ComplianceCheck[]
  guardrails: number
  violations: number
  auditEntriesToday: number
  recentAuditLogs: AuditItem[]
}

const guardrails = [
  {
    name: "Schema Validation",
    description: "Strict API payload validation before processing.",
  },
  {
    name: "Constrained Actions",
    description: "APIs expose explicit actions, no arbitrary command execution.",
  },
  {
    name: "Risk Thresholds",
    description: "High-risk outputs require human clinical review.",
  },
  {
    name: "Audit Logging",
    description: "All mutations are tracked with timestamps.",
  },
]

const accessRoles = [
  { role: "Participant", access: ["Notifications", "Confirmations"] },
  { role: "Clinic Admin", access: ["Dashboard", "Scheduling", "Compliance"] },
  { role: "Clinical Staff", access: ["Risk Scoring", "Patient Records", "Care Tasks"] },
  { role: "Lab/Pharmacy", access: ["Task View", "Orders"] },
]

export function ComplianceView() {
  const [overview, setOverview] = useState<ComplianceOverview>({
    checks: [],
    guardrails: 0,
    violations: 0,
    auditEntriesToday: 0,
    recentAuditLogs: [],
  })

  const loadOverview = async () => {
    const response = await fetch("/api/compliance/overview", { cache: "no-store" })
    const result = (await response.json()) as { data?: ComplianceOverview }
    setOverview(result.data ?? overview)
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Compliance & Safety</h1>
          <p className="text-muted-foreground">Production guardrails, safety protocols, and regulatory compliance</p>
        </div>
        <Badge variant="outline" className="font-normal cursor-pointer" onClick={() => void loadOverview()}>
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Badge>
      </div>

      <Card className="border-0 shadow-sm bg-success/10 border-l-4 border-l-success">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <ShieldCheck className="w-8 h-8 text-success" />
            <div>
              <p className="font-semibold text-success">Compliance Controls Active</p>
              <p className="text-sm text-muted-foreground">RBAC, validation, and audit mechanisms are operational.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Shield className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.checks.length}</p>
                <p className="text-xs text-muted-foreground">Checks Loaded</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Lock className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.guardrails}</p>
                <p className="text-xs text-muted-foreground">Active Guardrails</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <FileText className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.auditEntriesToday}</p>
                <p className="text-xs text-muted-foreground">Audit Entries Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.violations}</p>
                <p className="text-xs text-muted-foreground">Open Violations</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Production Guardrails</CardTitle>
              <CardDescription>Safety controls enforced in backend APIs</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {guardrails.map((guardrail) => (
                <div key={guardrail.name} className="p-4 rounded-lg border border-border bg-secondary/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                    <span className="font-medium">{guardrail.name}</span>
                    <Badge className="bg-success/20 text-success text-[10px] ml-auto">Active</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{guardrail.description}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Recent Audit Logs</CardTitle>
              <CardDescription>Live from backend audit stream</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.recentAuditLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{log.action}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {log.patient}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {log.user} - {log.details}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(log.time).toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Compliance Checks</CardTitle>
              <CardDescription>Regulatory and security status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.checks.map((check) => (
                <div key={check.name} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-sm">{check.name}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{check.lastCheck}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Access Control (RBAC)</CardTitle>
              <CardDescription>Role-based data access policies</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {accessRoles.map((role) => (
                <div key={role.role} className="p-3 rounded-lg bg-secondary/30">
                  <div className="flex items-center gap-2 mb-2">
                    <User className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">{role.role}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {role.access.map((item) => (
                      <Badge key={item} variant="outline" className="text-[10px]">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm border-l-4 border-l-primary">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Key className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium mb-1">Encryption Policy</p>
                  <p className="text-xs text-muted-foreground">Data is encrypted in transit and at rest per deployment configuration.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
