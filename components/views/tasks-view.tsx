"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Clock, Filter, ListTodo } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { PublicUser } from "@/lib/backend/users"

type ClinicalTask = {
  id: string
  patientId: string
  title: string
  relatedAlertId?: string
  taskType: string
  priority: "low" | "medium" | "high" | "critical"
  status: "open" | "in_progress" | "done" | "cancelled"
  assignedUserId?: string
  assignedUserName?: string
  dueAt?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

function priorityVariant(priority: ClinicalTask["priority"]) {
  return priority === "critical" || priority === "high" ? "destructive" : "default"
}

export function TasksView({
  currentUser,
  onOpenWorkflow,
  onOpenPatient,
  focusPatientId,
  focusTaskId,
}: {
  currentUser: PublicUser
  onOpenWorkflow: (patientId: string) => void
  onOpenPatient: (patientId: string) => void
  focusPatientId?: string | null
  focusTaskId?: string | null
}) {
  const [tasks, setTasks] = useState<ClinicalTask[]>([])
  const [statusFilter, setStatusFilter] = useState<"open" | "in_progress" | "done">("open")
  const [scope, setScope] = useState<"mine" | "all_open">("mine")
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({})

  const loadTasks = async (next?: { statusFilter?: "open" | "in_progress" | "done"; scope?: "mine" | "all_open" }) => {
    const activeStatus = next?.statusFilter ?? statusFilter
    const activeScope = next?.scope ?? scope
    const params = new URLSearchParams()
    if (!focusTaskId) {
      params.set("status", activeStatus)
    }
    if (focusPatientId) {
      params.set("patientId", focusPatientId)
    }
    if (focusTaskId) {
      params.set("taskId", focusTaskId)
    } else if (activeScope === "mine") {
      params.set("assignedUserId", currentUser.id)
    }

    const response = await fetch(`/api/tasks?${params.toString()}`, { cache: "no-store" })
    const result = (await response.json()) as { data?: ClinicalTask[] }
    const nextTasks = (result.data ?? []) as ClinicalTask[]
    setTasks(nextTasks)
    setNoteDrafts((current) => {
      const nextDrafts = { ...current }
      for (const task of nextTasks) {
        if (nextDrafts[task.id] === undefined) {
          nextDrafts[task.id] = task.notes ?? ""
        }
      }
      return nextDrafts
    })
  }

  const updateTask = async (taskId: string, status?: "in_progress" | "done") => {
    const note = noteDrafts[taskId] ?? ""
    if (status === "done" && !note.trim()) {
      setTaskErrors((current) => ({
        ...current,
        [taskId]: "Add a patient note before marking this task as done.",
      }))
      return
    }

    setBusyTaskId(taskId)
    setTaskErrors((current) => ({ ...current, [taskId]: "" }))
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes: note }),
      })
      if (!response.ok) {
        const result = (await response.json()) as { error?: string }
        setTaskErrors((current) => ({
          ...current,
          [taskId]: result.error ?? "Unable to update task.",
        }))
        return
      }
      if (status === "in_progress") {
        setStatusFilter("in_progress")
        await loadTasks({ statusFilter: "in_progress" })
        return
      }
      if (status === "done") {
        setStatusFilter("done")
        await loadTasks({ statusFilter: "done" })
        return
      }
      await loadTasks()
    } finally {
      setBusyTaskId(null)
    }
  }

  useEffect(() => {
    void loadTasks()
  }, [scope, statusFilter, focusPatientId, focusTaskId])

  useEffect(() => {
    if (focusPatientId) {
      setScope("all_open")
      setStatusFilter("open")
    }
  }, [focusPatientId])

  useEffect(() => {
    if (focusTaskId) {
      setScope("all_open")
    }
  }, [focusTaskId])

  const actionableTasks = tasks.filter((task) => scope === "all_open" || task.assignedUserId === currentUser.id || currentUser.role === "clinic_admin")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Care Tasks</h1>
        <p className="text-muted-foreground">Assigned escalation and workflow follow-up tasks for the current clinician.</p>
        {focusPatientId ? <p className="text-xs text-primary mt-1">Focused on tasks for patient {focusPatientId}</p> : null}
        {focusTaskId ? <p className="text-xs text-primary mt-1">Focused on task {focusTaskId}</p> : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <ListTodo className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{tasks.length}</p>
                <p className="text-xs text-muted-foreground">{scope === "mine" ? "Visible to me" : "Open across clinic"}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-warning/10 p-2">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{tasks.filter((task) => task.status === "in_progress").length}</p>
                <p className="text-xs text-muted-foreground">In progress</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-success/10 p-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{tasks.filter((task) => task.status === "done").length}</p>
                <p className="text-xs text-muted-foreground">Completed in current view</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Task Queue</CardTitle>
          <CardDescription>Use filters to switch between your assigned queue and the broader clinic queue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="w-full md:w-[180px]">
                <Select value={scope} onValueChange={(value) => setScope(value as "mine" | "all_open")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mine">My Tasks</SelectItem>
                    <SelectItem value="all_open">All Clinic Tasks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full md:w-[180px]">
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "open" | "in_progress" | "done")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="h-4 w-4" />
              {scope === "mine" ? "Showing assigned tasks only" : "Showing clinic-wide tasks for the selected status"}
            </div>
          </div>

          {tasks.length === 0 ? <p className="text-sm text-muted-foreground">No tasks in this view.</p> : null}
          {tasks.map((task) => {
            const canAct = task.assignedUserId === currentUser.id || currentUser.role === "clinic_admin"
            const isFocused = focusTaskId === task.id || (!focusTaskId && focusPatientId === task.patientId)
            return (
              <div key={task.id} className={`rounded-lg border bg-secondary/30 p-4 ${isFocused ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{task.title}</span>
                      {isFocused ? <Badge className="text-[10px] uppercase">From Patient Context</Badge> : null}
                      <Badge variant={priorityVariant(task.priority)} className="text-[10px] uppercase">
                        {task.priority}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{task.notes ?? "No task notes provided."}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Patient {task.patientId}</span>
                      <span>Assigned to {task.assignedUserName ?? "Unassigned"}</span>
                      <span>Due {task.dueAt ? new Date(task.dueAt).toLocaleString() : "not set"}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {task.status}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <div className="w-full">
                    <Textarea
                      value={noteDrafts[task.id] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value
                        setNoteDrafts((current) => ({ ...current, [task.id]: value }))
                        setTaskErrors((current) => ({ ...current, [task.id]: "" }))
                      }}
                      placeholder="Add clinician notes about the patient, work completed, or next action."
                      className="min-h-24 rounded-xl border-border bg-background text-foreground"
                    />
                    {taskErrors[task.id] ? <p className="mt-2 text-xs text-destructive">{taskErrors[task.id]}</p> : null}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onOpenPatient(task.patientId)}>
                    Open Patient
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onOpenWorkflow(task.patientId)}>
                    Open Workflow
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyTaskId === task.id || !canAct}
                    onClick={() => void updateTask(task.id)}
                  >
                    {busyTaskId === task.id ? "Updating..." : "Save Notes"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyTaskId === task.id || !canAct || task.status !== "open"}
                    onClick={() => void updateTask(task.id, "in_progress")}
                  >
                    {busyTaskId === task.id ? "Updating..." : "Start Work"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busyTaskId === task.id || !canAct || (task.status !== "open" && task.status !== "in_progress")}
                    onClick={() => void updateTask(task.id, "done")}
                  >
                    {busyTaskId === task.id ? "Updating..." : "Mark Done"}
                  </Button>
                </div>
              </div>
            )
          })}
          {scope === "all_open" && actionableTasks.length === 0 && tasks.length > 0 ? (
            <p className="text-sm text-muted-foreground">Open tasks are visible, but none are actionable for your account.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
