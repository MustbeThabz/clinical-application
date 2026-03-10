"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Calendar, Filter, Mail, MoreHorizontal, Phone, Pill, Plus, Search, User } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import type { UserRole } from "@/lib/backend/auth"

type ApiPatient = {
  id: string
  mrn: string
  firstName: string
  lastName: string
  dateOfBirth: string
  conditionSummary: string
  callTriggerPhone?: string
  homeVisitAddress?: string
  homeLatitude?: string
  homeLongitude?: string
  status: "Low Risk" | "Medium Risk" | "High Risk" | "Critical"
  adherence: number
  lastVisit?: string
  nextAppointment?: string
  phone?: string
  email?: string
}

function getStatusBadge(status: string) {
  switch (status) {
    case "High Risk":
      return <Badge variant="destructive">{status}</Badge>
    case "Critical":
      return <Badge variant="destructive">{status}</Badge>
    case "Medium Risk":
      return <Badge className="bg-warning text-warning-foreground">{status}</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

function getAdherenceColor(adherence: number) {
  if (adherence >= 80) return "text-success"
  if (adherence >= 60) return "text-warning"
  return "text-destructive"
}

function getAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth)
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDiff = now.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1
  }
  return Math.max(age, 0)
}

export function PatientsView({ currentUserRole }: { currentUserRole: UserRole }) {
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [patients, setPatients] = useState<ApiPatient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [selectedPatient, setSelectedPatient] = useState<ApiPatient | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formState, setFormState] = useState({
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    sexAtBirth: "unknown",
    phone: "",
    callTriggerPhone: "",
    email: "",
    homeVisitAddress: "",
    homeLatitude: "",
    homeLongitude: "",
    conditionSummary: "",
    status: "Low Risk",
    adherence: "100",
  })
  const [scheduleState, setScheduleState] = useState({
    providerName: "Clinic Provider",
    appointmentType: "follow_up",
    date: "",
    time: "09:00",
    durationMin: "30",
    reason: "",
    enableReminderWorkflow: true,
  })

  const canCreatePatient = currentUserRole === "clinic_admin" || currentUserRole === "clinical_staff"

  const readJson = async <T,>(response: Response): Promise<T | null> => {
    const raw = await response.text()
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  const loadPatients = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/patients", { cache: "no-store" })
      const result = await readJson<{ data?: ApiPatient[]; error?: string }>(response)
      if (!response.ok) {
        setPatients([])
        setError(result?.error ?? "Failed to load patients.")
        return
      }
      setPatients(result?.data ?? [])
    } catch {
      setPatients([])
      setError("Failed to load patients.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPatients()
  }, [])

  const filteredPatients = useMemo(() => {
    return patients.filter((patient) => {
      const fullName = `${patient.firstName} ${patient.lastName}`
      const matchesSearch =
        fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        patient.mrn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        patient.conditionSummary.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesStatus = statusFilter === "all" || patient.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [patients, searchQuery, statusFilter])

  const totalPatients = patients.length
  const highRiskCount = patients.filter((patient) => patient.status === "High Risk" || patient.status === "Critical").length
  const dueToday = patients.filter((patient) => patient.nextAppointment === new Date().toISOString().slice(0, 10)).length
  const avgAdherence =
    patients.length === 0 ? 0 : Math.round(patients.reduce((sum, patient) => sum + patient.adherence, 0) / patients.length)

  const handleCreatePatient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!canCreatePatient) {
      setError("Only clinic admin and clinical staff can create patients.")
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: formState.firstName.trim(),
          lastName: formState.lastName.trim(),
          dateOfBirth: formState.dateOfBirth,
          sexAtBirth: formState.sexAtBirth,
          phone: formState.phone.trim() || undefined,
          callTriggerPhone: formState.callTriggerPhone.trim() || undefined,
          email: formState.email.trim() || undefined,
          homeVisitAddress: formState.homeVisitAddress.trim() || undefined,
          homeLatitude: formState.homeLatitude.trim() || undefined,
          homeLongitude: formState.homeLongitude.trim() || undefined,
          conditionSummary: formState.conditionSummary.trim(),
          status: formState.status,
          adherence: Number(formState.adherence),
        }),
      })

      const result = await readJson<{ error?: string }>(response)
      if (!response.ok) {
        setError(result?.error ?? "Failed to create patient.")
        return
      }

      setCreateOpen(false)
      setFormState({
        firstName: "",
        lastName: "",
        dateOfBirth: "",
        sexAtBirth: "unknown",
        phone: "",
        callTriggerPhone: "",
        email: "",
        homeVisitAddress: "",
        homeLatitude: "",
        homeLongitude: "",
        conditionSummary: "",
        status: "Low Risk",
        adherence: "100",
      })
      await loadPatients()
    } catch {
      setError("Failed to create patient.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const openScheduleDialog = (patient: ApiPatient) => {
    const fallbackDate = new Date()
    fallbackDate.setDate(fallbackDate.getDate() + 1)
    const dateValue = patient.nextAppointment ?? fallbackDate.toISOString().slice(0, 10)
    setSelectedPatient(patient)
    setScheduleState({
      providerName: "Clinic Provider",
      appointmentType: "follow_up",
      date: dateValue,
      time: "09:00",
      durationMin: "30",
      reason: `${patient.conditionSummary} follow-up`,
      enableReminderWorkflow: true,
    })
    setScheduleOpen(true)
  }

  const handleSchedulePatient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!selectedPatient) {
      setError("Select a patient first.")
      return
    }
    if (!scheduleState.date || !scheduleState.time) {
      setError("Date and time are required.")
      return
    }

    const duration = Math.max(15, Number(scheduleState.durationMin) || 30)
    const localStart = new Date(`${scheduleState.date}T${scheduleState.time}:00`)
    if (Number.isNaN(localStart.getTime())) {
      setError("Invalid appointment start date/time.")
      return
    }
    const localEnd = new Date(localStart.getTime() + duration * 60 * 1000)

    setIsSubmitting(true)
    try {
      const response = await fetch("/api/scheduling/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: selectedPatient.id,
          providerName: scheduleState.providerName.trim() || "Clinic Provider",
          appointmentType: scheduleState.appointmentType,
          scheduledStart: localStart.toISOString(),
          scheduledEnd: localEnd.toISOString(),
          status: "scheduled",
          reason: scheduleState.reason.trim() || undefined,
          enableReminderWorkflow: scheduleState.enableReminderWorkflow,
        }),
      })

      const result = await readJson<{ error?: string }>(response)
      if (!response.ok) {
        setError(result?.error ?? "Failed to schedule appointment.")
        return
      }

      setScheduleOpen(false)
      setSelectedPatient(null)
      await loadPatients()
    } catch {
      setError("Failed to schedule appointment.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Patient Management</h1>
          <p className="text-muted-foreground">Comprehensive view of patient cohort with AI-driven insights</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canCreatePatient}>
              <Plus className="w-4 h-4 mr-2" />
              Add Patient
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Patient</DialogTitle>
              <DialogDescription>Create a patient record manually.</DialogDescription>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleCreatePatient}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    required
                    value={formState.firstName}
                    onChange={(e) => setFormState((prev) => ({ ...prev, firstName: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    required
                    value={formState.lastName}
                    onChange={(e) => setFormState((prev) => ({ ...prev, lastName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date Of Birth</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    required
                    value={formState.dateOfBirth}
                    onChange={(e) => setFormState((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sexAtBirth">Sex At Birth</Label>
                  <Select
                    value={formState.sexAtBirth}
                    onValueChange={(value) => setFormState((prev) => ({ ...prev, sexAtBirth: value }))}
                  >
                    <SelectTrigger id="sexAtBirth">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="intersex">Intersex</SelectItem>
                      <SelectItem value="unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    placeholder="+27 685513921"
                    value={formState.phone}
                    onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="callTriggerPhone">Call Trigger Phone</Label>
                  <Input
                    id="callTriggerPhone"
                    placeholder="+27 798220117"
                    value={formState.callTriggerPhone}
                    onChange={(e) => setFormState((prev) => ({ ...prev, callTriggerPhone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formState.email}
                    onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="homeVisitAddress">Home Visit Address</Label>
                  <Input
                    id="homeVisitAddress"
                    placeholder="Street, Suburb, City, Postal Code"
                    value={formState.homeVisitAddress}
                    onChange={(e) => setFormState((prev) => ({ ...prev, homeVisitAddress: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="homeLatitude">Home Latitude</Label>
                  <Input
                    id="homeLatitude"
                    placeholder="-26.1615129"
                    value={formState.homeLatitude}
                    onChange={(e) => setFormState((prev) => ({ ...prev, homeLatitude: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="homeLongitude">Home Longitude</Label>
                  <Input
                    id="homeLongitude"
                    placeholder="27.8820791"
                    value={formState.homeLongitude}
                    onChange={(e) => setFormState((prev) => ({ ...prev, homeLongitude: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="conditionSummary">Condition Summary</Label>
                <Input
                  id="conditionSummary"
                  required
                  value={formState.conditionSummary}
                  onChange={(e) => setFormState((prev) => ({ ...prev, conditionSummary: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="status">Risk Status</Label>
                  <Select value={formState.status} onValueChange={(value) => setFormState((prev) => ({ ...prev, status: value }))}>
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low Risk">Low Risk</SelectItem>
                      <SelectItem value="Medium Risk">Medium Risk</SelectItem>
                      <SelectItem value="High Risk">High Risk</SelectItem>
                      <SelectItem value="Critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adherence">Adherence (%)</Label>
                  <Input
                    id="adherence"
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={formState.adherence}
                    onChange={(e) => setFormState((prev) => ({ ...prev, adherence: e.target.value }))}
                  />
                </div>
              </div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Patient"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalPatients}</p>
                <p className="text-xs text-muted-foreground">Total Patients</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <User className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{highRiskCount}</p>
                <p className="text-xs text-muted-foreground">High Risk</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Calendar className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dueToday}</p>
                <p className="text-xs text-muted-foreground">Due Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <Pill className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{avgAdherence}%</p>
                <p className="text-xs text-muted-foreground">Avg Adherence</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Patient Directory</CardTitle>
              <CardDescription>Click on a patient to view detailed profile</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search patients..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="High Risk">High Risk</SelectItem>
                  <SelectItem value="Medium Risk">Medium Risk</SelectItem>
                  <SelectItem value="Low Risk">Low Risk</SelectItem>
                  <SelectItem value="Critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading patients...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Adherence</TableHead>
                  <TableHead>Last Visit</TableHead>
                  <TableHead>Next Appointment</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPatients.map((patient) => {
                  const fullName = `${patient.firstName} ${patient.lastName}`
                  return (
                    <TableRow key={patient.id} className="cursor-pointer hover:bg-secondary/50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-9 h-9">
                            <AvatarFallback className="bg-primary/10 text-primary text-sm">
                              {`${patient.firstName[0] ?? ""}${patient.lastName[0] ?? ""}`}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{fullName}</p>
                            <p className="text-xs text-muted-foreground">
                              {patient.mrn} | {getAge(patient.dateOfBirth)} yrs
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{patient.conditionSummary}</Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(patient.status)}</TableCell>
                      <TableCell>
                        <span className={`font-medium ${getAdherenceColor(patient.adherence)}`}>{patient.adherence}%</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{patient.lastVisit ?? "N/A"}</TableCell>
                      <TableCell className="text-muted-foreground">{patient.nextAppointment ?? "N/A"}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <User className="w-4 h-4 mr-2" />
                              View Profile
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Phone className="w-4 h-4 mr-2" />
                              Call Patient
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Mail className="w-4 h-4 mr-2" />
                              Send Message
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openScheduleDialog(patient)}>
                              <Calendar className="w-4 h-4 mr-2" />
                              Schedule Appointment
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Next Visit</DialogTitle>
            <DialogDescription>
              {selectedPatient ? `Create next appointment for ${selectedPatient.firstName} ${selectedPatient.lastName}` : "Create appointment"}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSchedulePatient}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="schedule-provider">Provider</Label>
                <Input
                  id="schedule-provider"
                  required
                  value={scheduleState.providerName}
                  onChange={(e) => setScheduleState((prev) => ({ ...prev, providerName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-type">Visit Type</Label>
                <Select
                  value={scheduleState.appointmentType}
                  onValueChange={(value) => setScheduleState((prev) => ({ ...prev, appointmentType: value }))}
                >
                  <SelectTrigger id="schedule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">Routine</SelectItem>
                    <SelectItem value="follow_up">Follow Up</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="telehealth">Telehealth</SelectItem>
                    <SelectItem value="screening">Screening</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="schedule-date">Date</Label>
                <Input
                  id="schedule-date"
                  type="date"
                  required
                  value={scheduleState.date}
                  onChange={(e) => setScheduleState((prev) => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-time">Time</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  required
                  value={scheduleState.time}
                  onChange={(e) => setScheduleState((prev) => ({ ...prev, time: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-duration">Duration (min)</Label>
                <Input
                  id="schedule-duration"
                  type="number"
                  min={15}
                  step={15}
                  required
                  value={scheduleState.durationMin}
                  onChange={(e) => setScheduleState((prev) => ({ ...prev, durationMin: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="schedule-reason">Reason</Label>
              <Input
                id="schedule-reason"
                value={scheduleState.reason}
                onChange={(e) => setScheduleState((prev) => ({ ...prev, reason: e.target.value }))}
              />
            </div>

            <div className="flex items-center space-x-2 rounded-md border border-border p-3">
              <Checkbox
                id="enable-reminder-workflow"
                checked={scheduleState.enableReminderWorkflow}
                onCheckedChange={(checked) =>
                  setScheduleState((prev) => ({ ...prev, enableReminderWorkflow: checked === true }))
                }
              />
              <Label htmlFor="enable-reminder-workflow" className="text-sm leading-none">
                Enable staged visit reminders (text, follow-up text, auto-call, nurse escalation)
              </Label>
            </div>

            <Button type="submit" disabled={isSubmitting || !selectedPatient}>
              {isSubmitting ? "Scheduling..." : "Schedule Appointment"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
