"use client"

import { useState } from "react"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Bot,
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileText,
  Heart,
  Home,
  Settings,
  Shield,
  Users,
  Workflow,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface AppSidebarProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  role: "participant" | "clinic_admin" | "clinical_staff" | "lab_pharmacy"
}

const menuItems = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "patients", label: "Patient Management", icon: Users },
  { id: "risk-scoring", label: "Risk Scoring", icon: AlertTriangle },
  { id: "ai-agent", label: "AI Agent", icon: Bot },
  { id: "workflows", label: "Clinical Workflows", icon: Workflow },
  { id: "scheduling", label: "Scheduling", icon: Calendar },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "compliance", label: "Compliance & Safety", icon: Shield },
]

export function AppSidebar({ activeTab, setActiveTab, role }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const visibleItems = role === "clinic_admin" ? [...menuItems, { id: "users", label: "User Management", icon: FileText }] : menuItems

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary">
          <Heart className="w-5 h-5 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="font-semibold text-sm">Clinical AI</span>
            <span className="text-xs text-sidebar-foreground/60">Healthcare Platform</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {visibleItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              activeTab === item.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* System Status */}
      {!collapsed && (
        <div className="p-4 mx-3 mb-3 rounded-lg bg-sidebar-accent/30">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-success" />
            <span className="text-xs font-medium">System Status</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-sidebar-foreground/60">AI Engine</span>
              <span className="text-success">Active</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-sidebar-foreground/60">Monitoring</span>
              <span className="text-success">Running</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center justify-between">
          <button className={cn("flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 transition-all", collapsed && "justify-center w-full")}>
            <Settings className="w-5 h-5" />
            {!collapsed && <span>Settings</span>}
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="w-8 h-8 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </aside>
  )
}
