export type StatusType = 'success' | 'error'

export interface StatusMessage {
  type: StatusType
  text: string
}

export interface AdminStats {
  schools: { total: number; enabled: number }
  accounts: number
  pendingSubmissions: number
  pendingFeedback: number
  pendingSchoolAlerts?: number
  activeNotifications?: number
}

export interface SchoolItem {
  id: string
  name: string
  shortName: string | null
  province: string | null
  city: string | null
  enabled: boolean
  status: string
}

export interface SubmissionItem {
  id: string
  schoolName: string
  status: string
  createdAt: string
}

export interface FeedbackItem {
  id: string
  type: string
  status: string
  createdAt: string
}

export interface DashboardTaskItem {
  title: string
  count: number
  detail: string
  tone: 'blue' | 'green' | 'amber' | 'red'
}

export interface DashboardTrendPoint {
  day: string
  users: number
  submissions: number
  feedback: number
}

export type DashboardTrendRangeValue = 'today' | 'yesterday' | '3d' | '7d' | '14d' | '30d'

export interface DashboardBarPoint {
  label: string
  value: number
}

export interface DashboardPiePoint {
  name: string
  value: number
}

export interface DashboardAnalytics {
  trend: DashboardTrendPoint[]
  tasks: DashboardBarPoint[]
  schoolDistribution: DashboardPiePoint[]
  schoolMembers: DashboardBarPoint[]
  updatedAt: string
  partial: boolean
}
