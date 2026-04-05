"use client"

import { FormEvent, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ClinicalFlowStage } from "@/lib/backend/types"
import { getRoleLabel } from "@/lib/roles"
import type { PublicUser } from "@/lib/backend/users"

type Role = PublicUser["role"]
type AvailabilityStatus = NonNullable<PublicUser["availabilityStatus"]>

const ROLE_OPTIONS: Array<{ value: Role; label: string; department: string; title: string; stages: ClinicalFlowStage[] }> = [
  { value: "receptionist_admin", label: "Receptionist / Admin", department: "Front Office", title: "Receptionist", stages: ["request", "admin"] },
  { value: "research_assistant", label: "Research Assistant", department: "Research", title: "Research Assistant", stages: ["ra"] },
  { value: "nurse", label: "Nurse", department: "Nursing", title: "Professional Nurse", stages: ["nurse"] },
  { value: "doctor", label: "Doctor", department: "Clinical", title: "Medical Doctor", stages: ["doctor"] },
  { value: "lab_personnel", label: "Lab Personnel", department: "Laboratory", title: "Lab Technologist", stages: ["lab"] },
  { value: "pharmacist", label: "Pharmacist", department: "Pharmacy", title: "Pharmacist", stages: ["pharmacy"] },
  { value: "clinic_admin", label: "Clinic Admin", department: "Administration", title: "Clinic Administrator", stages: ["request", "admin", "ra", "nurse", "doctor", "lab", "pharmacy"] },
]

const STAGE_OPTIONS: Array<{ value: ClinicalFlowStage; label: string }> = [
  { value: "request", label: "Request" },
  { value: "ra", label: "RA" },
  { value: "admin", label: "Admin" },
  { value: "nurse", label: "Nurse" },
  { value: "doctor", label: "Doctor" },
  { value: "lab", label: "Lab" },
  { value: "pharmacy", label: "Pharmacy" },
]

const defaultRole = ROLE_OPTIONS[0]
const AVAILABILITY_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "busy_with_patient", label: "Busy With Patient" },
  { value: "away", label: "Away / Break" },
] as const

function getRoleProfile(role: Role) {
  return ROLE_OPTIONS.find((item) => item.value === role) ?? defaultRole
}

function createInitialForm(role: Role = defaultRole.value) {
  const profile = getRoleProfile(role)
  return {
    name: "",
    email: "",
    phone: "",
    employeeId: "",
    department: profile.department,
    title: profile.title,
    registrationNumber: "",
    password: "",
    role,
    isActive: true,
    isOnDuty: true,
    availabilityStatus: "available" as AvailabilityStatus,
    assignedStages: profile.stages,
  }
}

function getAvailabilityLabel(status: PublicUser["availabilityStatus"]) {
  switch (status) {
    case "busy_with_patient":
      return "Busy With Patient"
    case "away":
      return "Away / Break"
    default:
      return "Available"
  }
}

export function UsersView({ currentUser }: { currentUser: PublicUser }) {
  const [users, setUsers] = useState<PublicUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all")
  const [dutyFilter, setDutyFilter] = useState<"all" | "on_duty" | "off_duty">("all")
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | PublicUser["availabilityStatus"]>("all")
  const [formState, setFormState] = useState(createInitialForm())
  const [editOpen, setEditOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editState, setEditState] = useState(createInitialForm())

  const loadUsers = async () => {
    setLoading(true)
    setError(null)
    const response = await fetch("/api/users", { cache: "no-store" })
    const payload = (await response.json()) as { data?: PublicUser[]; error?: string }

    if (!response.ok) {
      setError(payload.error ?? "Failed to load users")
      setUsers([])
      setLoading(false)
      return
    }

    setUsers(payload.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const updateRole = (role: Role) => {
    const profile = getRoleProfile(role)
    setFormState((prev) => ({
      ...prev,
      role,
      department: prev.department === getRoleProfile(prev.role).department ? profile.department : prev.department,
      title: prev.title === getRoleProfile(prev.role).title ? profile.title : prev.title,
      assignedStages: profile.stages,
    }))
  }

  const toggleStage = (stage: ClinicalFlowStage, checked: boolean) => {
    setFormState((prev) => ({
      ...prev,
      assignedStages: checked
        ? Array.from(new Set([...prev.assignedStages, stage]))
        : prev.assignedStages.filter((item) => item !== stage),
    }))
  }

  const toggleEditStage = (stage: ClinicalFlowStage, checked: boolean) => {
    setEditState((prev) => ({
      ...prev,
      assignedStages: checked
        ? Array.from(new Set([...prev.assignedStages, stage]))
        : prev.assignedStages.filter((item) => item !== stage),
    }))
  }

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formState.name,
        email: formState.email,
        isOnDuty: formState.isOnDuty,
        availabilityStatus: formState.availabilityStatus,
        phone: formState.phone || undefined,
        employeeId: formState.employeeId || undefined,
        department: formState.department || undefined,
        title: formState.title || undefined,
        registrationNumber: formState.registrationNumber || undefined,
        password: formState.password,
        role: formState.role,
        assignedStages: formState.assignedStages,
      }),
    })

    const payload = (await response.json()) as { error?: string }
    if (!response.ok) {
      setError(payload.error ?? "Failed to create clinician")
      return
    }

    setFormState(createInitialForm())
    await loadUsers()
  }

  const openEditDialog = (user: PublicUser) => {
    setEditingUserId(user.id)
    setEditState({
      name: user.name,
      email: user.email,
      phone: user.phone ?? "",
      employeeId: user.employeeId ?? "",
      department: user.department ?? getRoleProfile(user.role).department,
      title: user.title ?? getRoleProfile(user.role).title,
      registrationNumber: user.registrationNumber ?? "",
      password: "",
      role: user.role,
      isActive: user.isActive,
      isOnDuty: user.isOnDuty ?? false,
      availabilityStatus: user.availabilityStatus ?? "available",
      assignedStages: user.assignedStages ?? getRoleProfile(user.role).stages,
    })
    setEditOpen(true)
  }

  const handleEditUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!editingUserId) return

    const response = await fetch(`/api/users/${editingUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editState.name,
        email: editState.email,
        isOnDuty: editState.isOnDuty,
        availabilityStatus: editState.availabilityStatus,
        phone: editState.phone || undefined,
        employeeId: editState.employeeId || undefined,
        department: editState.department || undefined,
        title: editState.title || undefined,
        registrationNumber: editState.registrationNumber || undefined,
        password: editState.password || undefined,
        role: editState.role,
        isActive: editState.isActive,
        assignedStages: editState.assignedStages,
      }),
    })

    const payload = (await response.json()) as { error?: string }
    if (!response.ok) {
      setError(payload.error ?? "Failed to update clinician")
      return
    }

    setEditOpen(false)
    setEditingUserId(null)
    setEditState(createInitialForm())
    await loadUsers()
  }

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      `${user.name} ${user.email} ${user.department ?? ""} ${user.title ?? ""}`.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRole = roleFilter === "all" || user.role === roleFilter
    const matchesDuty =
      dutyFilter === "all" ||
      (dutyFilter === "on_duty" ? user.isOnDuty === true : user.isOnDuty !== true)
    const matchesAvailability =
      availabilityFilter === "all" || (user.availabilityStatus ?? "available") === availabilityFilter
    return matchesSearch && matchesRole && matchesDuty && matchesAvailability
  })

  const onDutyToday = users.filter((user) => user.isOnDuty).length
  const busyNow = users.filter((user) => user.isOnDuty && user.availabilityStatus === "busy_with_patient").length
  const availableNow = users.filter((user) => user.isOnDuty && (user.availabilityStatus ?? "available") === "available").length

  if (currentUser.role !== "clinic_admin") {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>Only clinic admins can add and manage clinicians.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Clinician Management</h1>
        <p className="text-muted-foreground">Clinic admins onboard clinicians, assign roles, and align each account to the clinic workflow.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">On Duty Today</p>
            <p className="text-2xl font-bold">{onDutyToday}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Busy With Patients</p>
            <p className="text-2xl font-bold">{busyNow}</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Available Now</p>
            <p className="text-2xl font-bold">{availableNow}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Clinician Onboarding Form</CardTitle>
          <CardDescription>Register staff with identity, contact, role, credentials, and workflow-stage ownership.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-6" onSubmit={handleCreateUser}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" value={formState.name} onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Work Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formState.email}
                  onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Mobile Number</Label>
                <Input id="phone" value={formState.phone} onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employeeId">Employee ID</Label>
                <Input
                  id="employeeId"
                  value={formState.employeeId}
                  onChange={(e) => setFormState((prev) => ({ ...prev, employeeId: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={formState.role} onValueChange={(value) => updateRole(value as Role)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  value={formState.department}
                  onChange={(e) => setFormState((prev) => ({ ...prev, department: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Job Title</Label>
                <Input id="title" value={formState.title} onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="registrationNumber">Registration / License Number</Label>
                <Input
                  id="registrationNumber"
                  value={formState.registrationNumber}
                  onChange={(e) => setFormState((prev) => ({ ...prev, registrationNumber: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Workflow Stage Assignment</Label>
                <p className="text-sm text-muted-foreground">Choose the stages this clinician is responsible for moving forward in the clinic flow.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {STAGE_OPTIONS.map((stage) => (
                  <label key={stage.value} className="flex items-center gap-3 rounded-md border p-3">
                    <Checkbox
                      checked={formState.assignedStages.includes(stage.value)}
                      onCheckedChange={(checked) => toggleStage(stage.value, checked === true)}
                    />
                    <span className="text-sm">{stage.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>On Duty Today</Label>
                <div className="flex items-center gap-3 rounded-md border p-3">
                  <Checkbox
                    checked={formState.isOnDuty}
                    onCheckedChange={(checked) => setFormState((prev) => ({ ...prev, isOnDuty: checked === true }))}
                  />
                  <span className="text-sm">This clinician is scheduled in clinic today</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Current Availability</Label>
                <Select
                  value={formState.availabilityStatus}
                  onValueChange={(value) =>
                    setFormState((prev) => ({ ...prev, availabilityStatus: value as AvailabilityStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABILITY_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="password">Temporary Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formState.password}
                  onChange={(e) => setFormState((prev) => ({ ...prev, password: e.target.value }))}
                  minLength={8}
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit">Create Clinician Account</Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>Clinician Directory</CardTitle>
          <CardDescription>{loading ? "Loading staff..." : `${filteredUsers.length} shown of ${users.length} accounts`}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4 mb-6">
            <Input placeholder="Search staff..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as "all" | Role)}>
              <SelectTrigger><SelectValue placeholder="Role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {ROLE_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dutyFilter} onValueChange={(value) => setDutyFilter(value as typeof dutyFilter)}>
              <SelectTrigger><SelectValue placeholder="Duty" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Duty Status</SelectItem>
                <SelectItem value="on_duty">On Duty Today</SelectItem>
                <SelectItem value="off_duty">Off Duty</SelectItem>
              </SelectContent>
            </Select>
            <Select value={availabilityFilter} onValueChange={(value) => setAvailabilityFilter(value as typeof availabilityFilter)}>
              <SelectTrigger><SelectValue placeholder="Availability" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Availability</SelectItem>
                {AVAILABILITY_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredUsers.map((user) => (
              <div key={user.id} className="rounded-lg border p-4 space-y-3">
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge>{getRoleLabel(user.role)}</Badge>
                  <Badge variant={user.isActive ? "secondary" : "destructive"}>{user.isActive ? "Active" : "Inactive"}</Badge>
                  <Badge variant={user.isOnDuty ? "secondary" : "outline"}>{user.isOnDuty ? "On Duty" : "Off Duty"}</Badge>
                  <Badge variant={user.availabilityStatus === "busy_with_patient" ? "destructive" : "outline"}>
                    {getAvailabilityLabel(user.availabilityStatus)}
                  </Badge>
                  {user.department ? <Badge variant="outline">{user.department}</Badge> : null}
                  {user.title ? <Badge variant="outline">{user.title}</Badge> : null}
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {user.phone ? <p>Phone: {user.phone}</p> : null}
                  {user.employeeId ? <p>Employee ID: {user.employeeId}</p> : null}
                  {user.registrationNumber ? <p>Registration: {user.registrationNumber}</p> : null}
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workflow stages</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(user.assignedStages ?? []).length > 0 ? (
                      user.assignedStages?.map((stage) => (
                        <Badge key={stage} variant="secondary">
                          {stage}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No stages assigned</span>
                    )}
                  </div>
                </div>
                <div className="pt-2">
                  <Button variant="outline" size="sm" onClick={() => openEditDialog(user)}>
                    Edit Clinician
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Clinician</DialogTitle>
            <DialogDescription>Update clinician role, profile details, and workflow-stage assignment.</DialogDescription>
          </DialogHeader>
          <form className="space-y-6" onSubmit={handleEditUser}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Full Name</Label>
                <Input id="edit-name" value={editState.name} onChange={(e) => setEditState((prev) => ({ ...prev, name: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Work Email</Label>
                <Input id="edit-email" type="email" value={editState.email} onChange={(e) => setEditState((prev) => ({ ...prev, email: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Mobile Number</Label>
                <Input id="edit-phone" value={editState.phone} onChange={(e) => setEditState((prev) => ({ ...prev, phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-employeeId">Employee ID</Label>
                <Input id="edit-employeeId" value={editState.employeeId} onChange={(e) => setEditState((prev) => ({ ...prev, employeeId: e.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={editState.role}
                  onValueChange={(value) => {
                    const role = value as Role
                    const profile = getRoleProfile(role)
                    setEditState((prev) => ({
                      ...prev,
                      role,
                      department: profile.department,
                      title: profile.title,
                      assignedStages: profile.stages,
                    }))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-department">Department</Label>
                <Input id="edit-department" value={editState.department} onChange={(e) => setEditState((prev) => ({ ...prev, department: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-title">Job Title</Label>
                <Input id="edit-title" value={editState.title} onChange={(e) => setEditState((prev) => ({ ...prev, title: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-registrationNumber">Registration / License Number</Label>
                <Input id="edit-registrationNumber" value={editState.registrationNumber} onChange={(e) => setEditState((prev) => ({ ...prev, registrationNumber: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label>Workflow Stage Assignment</Label>
                <p className="text-sm text-muted-foreground">Adjust the stages this clinician can own in the clinic flow.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                {STAGE_OPTIONS.map((stage) => (
                  <label key={stage.value} className="flex items-center gap-3 rounded-md border p-3">
                    <Checkbox
                      checked={editState.assignedStages.includes(stage.value)}
                      onCheckedChange={(checked) => toggleEditStage(stage.value, checked === true)}
                    />
                    <span className="text-sm">{stage.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-password">Reset Password</Label>
              <Input
                id="edit-password"
                type="password"
                value={editState.password}
                onChange={(e) => setEditState((prev) => ({ ...prev, password: e.target.value }))}
                placeholder="Leave blank to keep current password"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center gap-3 rounded-md border p-3">
                <Checkbox
                  checked={editState.isOnDuty}
                  onCheckedChange={(checked) => setEditState((prev) => ({ ...prev, isOnDuty: checked === true }))}
                />
                <div>
                  <p className="text-sm font-medium">On duty today</p>
                  <p className="text-xs text-muted-foreground">Include this clinician in today’s clinic roster.</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Current Availability</Label>
                <Select
                  value={editState.availabilityStatus}
                  onValueChange={(value) =>
                    setEditState((prev) => ({ ...prev, availabilityStatus: value as AvailabilityStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABILITY_OPTIONS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-md border p-3">
              <Checkbox
                checked={editState.isActive}
                onCheckedChange={(checked) => setEditState((prev) => ({ ...prev, isActive: checked === true }))}
              />
              <div>
                <p className="text-sm font-medium">Clinician account is active</p>
                <p className="text-xs text-muted-foreground">Inactive clinicians cannot sign in or move patients through the workflow.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit">Save Changes</Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
