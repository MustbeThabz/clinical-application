"use client"

import { useEffect, useMemo, useState } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/components/ui/use-mobile"
import { DashboardView } from "@/components/views/dashboard-view"
import { PatientsView } from "@/components/views/patients-view"
import { RiskScoringView } from "@/components/views/risk-scoring-view"
import { AIAgentView } from "@/components/views/ai-agent-view"
import { WorkflowsView } from "@/components/views/workflows-view"
import { SchedulingView } from "@/components/views/scheduling-view"
import { AnalyticsView } from "@/components/views/analytics-view"
import { ComplianceView } from "@/components/views/compliance-view"
import { UsersView } from "@/components/views/users-view"
import { TasksView } from "@/components/views/tasks-view"
import type { PublicUser } from "@/lib/backend/users"
import { canAccessAppTab, getVisibleAppTabs, type AppTab } from "@/lib/roles"

export function ClinicalAppShell({ user }: { user: PublicUser }) {
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard")
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [workflowFocusPatientId, setWorkflowFocusPatientId] = useState<string | null>(null)
  const [patientFocusPatientId, setPatientFocusPatientId] = useState<string | null>(null)
  const [taskFocusPatientId, setTaskFocusPatientId] = useState<string | null>(null)
  const [taskFocusTaskId, setTaskFocusTaskId] = useState<string | null>(null)
  const [schedulingFocusAppointmentId, setSchedulingFocusAppointmentId] = useState<string | null>(null)
  const [schedulingFocusDate, setSchedulingFocusDate] = useState<string | null>(null)
  const [complianceFocusAlertId, setComplianceFocusAlertId] = useState<string | null>(null)
  const allowedTabs = useMemo(() => getVisibleAppTabs(user.role), [user.role])

  useEffect(() => {
    if (!canAccessAppTab(user.role, activeTab)) {
      setActiveTab(allowedTabs[0] ?? "dashboard")
    }
  }, [activeTab, allowedTabs, user.role])

  useEffect(() => {
    if (!isMobile) {
      setMobileNavOpen(false)
    }
  }, [isMobile])

  const setActiveTabSafe = (tab: AppTab) => {
    if (!canAccessAppTab(user.role, tab)) {
      setActiveTab(allowedTabs[0] ?? "dashboard")
      return
    }
    setActiveTab(tab)
    setMobileNavOpen(false)
  }

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard":
        return <DashboardView />
      case "patients":
        return (
          <PatientsView
            currentUserRole={user.role}
            focusPatientId={patientFocusPatientId}
            onOpenTasks={(patientId) => {
              setTaskFocusPatientId(patientId)
              setTaskFocusTaskId(null)
              setWorkflowFocusPatientId(null)
              setActiveTabSafe("tasks")
            }}
            onOpenWorkflow={(patientId) => {
              setWorkflowFocusPatientId(patientId)
              setTaskFocusPatientId(null)
              setTaskFocusTaskId(null)
              setActiveTabSafe("workflows")
            }}
            onOpenTask={(patientId, taskId) => {
              setTaskFocusPatientId(patientId)
              setTaskFocusTaskId(taskId)
              setActiveTabSafe("tasks")
            }}
            onOpenAppointment={(appointmentId, date) => {
              setSchedulingFocusAppointmentId(appointmentId)
              setSchedulingFocusDate(date)
              setActiveTabSafe("scheduling")
            }}
            onOpenAlert={(alertId) => {
              setComplianceFocusAlertId(alertId)
              setActiveTabSafe("compliance")
            }}
          />
        )
      case "risk-scoring":
        return <RiskScoringView />
      case "ai-agent":
        return <AIAgentView />
      case "workflows":
        return (
          <WorkflowsView
            currentUser={user}
            focusPatientId={workflowFocusPatientId}
            onOpenTasks={(patientId) => {
              setTaskFocusPatientId(patientId)
              setTaskFocusTaskId(null)
              setPatientFocusPatientId(null)
              setActiveTabSafe("tasks")
            }}
          />
        )
      case "scheduling":
        return <SchedulingView focusAppointmentId={schedulingFocusAppointmentId} focusDate={schedulingFocusDate} />
      case "analytics":
        return <AnalyticsView />
      case "compliance":
        return <ComplianceView focusAlertId={complianceFocusAlertId} />
      case "tasks":
        return (
          <TasksView
            currentUser={user}
            onOpenWorkflow={(patientId) => {
              setWorkflowFocusPatientId(patientId)
              setPatientFocusPatientId(null)
              setTaskFocusPatientId(null)
              setTaskFocusTaskId(null)
              setActiveTabSafe("workflows")
            }}
            onOpenPatient={(patientId) => {
              setPatientFocusPatientId(patientId)
              setWorkflowFocusPatientId(null)
              setTaskFocusPatientId(null)
              setTaskFocusTaskId(null)
              setActiveTabSafe("patients")
            }}
            focusPatientId={taskFocusPatientId}
            focusTaskId={taskFocusTaskId}
          />
        )
      case "users":
        return <UsersView currentUser={user} />
      default:
        return <DashboardView />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <div className="hidden md:flex">
        <AppSidebar
          activeTab={activeTab}
          setActiveTab={(tab) => {
            if (tab !== "workflows") {
              setWorkflowFocusPatientId(null)
            }
            if (tab !== "patients") {
              setPatientFocusPatientId(null)
            }
            if (tab !== "tasks") {
              setTaskFocusPatientId(null)
              setTaskFocusTaskId(null)
            }
            if (tab !== "scheduling") {
              setSchedulingFocusAppointmentId(null)
              setSchedulingFocusDate(null)
            }
            if (tab !== "compliance") {
              setComplianceFocusAlertId(null)
            }
            setActiveTabSafe(tab as AppTab)
          }}
          role={user.role}
        />
      </div>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-xs border-r bg-transparent p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Open the clinical application navigation.</SheetDescription>
          <AppSidebar
            activeTab={activeTab}
            setActiveTab={(tab) => {
              if (tab !== "workflows") {
                setWorkflowFocusPatientId(null)
              }
              if (tab !== "patients") {
                setPatientFocusPatientId(null)
              }
              if (tab !== "tasks") {
                setTaskFocusPatientId(null)
                setTaskFocusTaskId(null)
              }
              if (tab !== "scheduling") {
                setSchedulingFocusAppointmentId(null)
                setSchedulingFocusDate(null)
              }
              if (tab !== "compliance") {
                setComplianceFocusAlertId(null)
              }
              setActiveTabSafe(tab as AppTab)
            }}
            role={user.role}
            mobile
            onNavigate={() => setMobileNavOpen(false)}
            className="w-full border-r-0"
          />
        </SheetContent>
      </Sheet>
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppHeader
          user={user}
          onOpenNavigation={() => setMobileNavOpen(true)}
          onOpenWorkflow={(patientId) => {
            setWorkflowFocusPatientId(patientId)
            setPatientFocusPatientId(null)
            setTaskFocusPatientId(null)
            setTaskFocusTaskId(null)
            setActiveTabSafe("workflows")
          }}
          onOpenTask={(patientId, taskId) => {
            setTaskFocusPatientId(patientId)
            setTaskFocusTaskId(taskId)
            setWorkflowFocusPatientId(null)
            setPatientFocusPatientId(null)
            setActiveTabSafe("tasks")
          }}
          onOpenAlert={(alertId) => {
            setComplianceFocusAlertId(alertId)
            setWorkflowFocusPatientId(null)
            setPatientFocusPatientId(null)
            setTaskFocusPatientId(null)
            setTaskFocusTaskId(null)
            setActiveTabSafe("compliance")
          }}
        />
        <main className="flex-1 overflow-y-auto p-3 sm:p-6">{renderContent()}</main>
      </div>
    </div>
  )
}
