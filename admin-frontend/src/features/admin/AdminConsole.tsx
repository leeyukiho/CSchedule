import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bell,
  CloudSun,
  Eye,
  ExternalLink,
  FileJson,
  Inbox,
  LayoutDashboard,
  LogIn,
  LogOut,
  MessageSquareWarning,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  BellRing,
  Save,
  School,
  Settings2,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { AppLayout } from '../../components/layout/AppLayout'
import { PageHeader } from '../../components/layout/PageHeader'
import { ThemeToggle } from '../../components/layout/ThemeToggle'
import { Card } from '../../components/primitives/Card'
import { StatCard } from '../../components/primitives/StatCard'
import { LoginView } from '../auth/LoginView'
import { DashboardOverview } from '../dashboard/DashboardOverview'
import type { DashboardAnalytics, DashboardBarPoint, DashboardPiePoint, DashboardTaskItem, DashboardTrendPoint, DashboardTrendRangeValue } from '../../types/admin'

const CONFIG_KEY = 'cschedule.adminWebsite.config'
const DEFAULT_BASE_URL = 'http://localhost:3000/api/v1'
const PAGE_SIZE = 10
const SCHOOL_PAGE_SIZE = 10
const SUBMISSION_PAGE_SIZE = 100
const FILTER_DEBOUNCE_MS = 250

const SCHOOL_STATUS_OPTIONS = [
  ['catalog_only', '目录'],
  ['candidate', '候选'],
  ['researching', '调研中'],
  ['beta', '灰度'],
  ['enabled', '已启用'],
  ['disabled', '已停用'],
] as const

const SUBMISSION_EXTRA_VERIFICATION_OPTIONS = ['不需要', '需要验证码或短信', '需要扫码或校内验证', '不确定'] as const
const SUBMISSION_ADAPTATION_HELP_OPTIONS = ['愿意沟通', '先了解，愿意等', '暂不方便'] as const

type ViewKey = 'overview' | 'schools' | 'users' | 'submissions' | 'feedback' | 'notifications' | 'reminders' | 'appSettings'
type StatusType = 'success' | 'error'

interface AdminStats {
  schools: { total: number; enabled: number }
  accounts: number
  pendingSubmissions: number
  pendingFeedback: number
  pendingSchoolAlerts?: number
  activeNotifications?: number
}

interface PageResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

interface SchoolItem {
  id: string
  name: string
  shortName: string | null
  province: string | null
  city: string | null
  enabled: boolean
  status: string
  loginMode: string | null
  providerId: string | null
  eduSystemType: string | null
  dataAccess?: Record<string, unknown>
  capabilities?: Record<string, boolean>
  termStarts?: Record<string, string>
  terms?: TermOption[]
  sectionTimes?: SectionTimeItem[]
  sectionTimeProfiles?: SectionTimeProfile[]
  courseBuildings?: CourseBuildingItem[]
  userCount?: number
  weatherLocation?: WeatherLocationDraft
}

interface SubmissionItem {
  id: string
  schoolName: string
  aliases?: string[]
  province: string | null
  city: string | null
  officialWebsite?: string | null
  eduSystemWebsite?: string | null
  loginUrl?: string | null
  loginModeHint?: string | null
  requestedTargets?: string[]
  note?: string | null
  status: string
  createdAt: string
}

interface FeedbackItem {
  id: string
  accountId: string | null
  schoolId: string | null
  type: string
  content: string
  contact: string | null
  status: string
  createdAt: string
  account?: {
    id: string
    schoolId: string
    providerId: string
    displayName: string | null
    status: string
    school?: {
      id: string
      name: string
      shortName: string | null
    }
  } | null
  school?: {
    id: string
    name: string
    shortName: string | null
  } | null
  student?: {
    name?: string | null
    studentNo?: string | null
    grade?: string | null
    major?: string | null
    className?: string | null
    level?: string | null
  } | null
}

interface UserItem {
  id: string
  schoolId: string
  providerId: string
  displayName: string | null
  status: string
  createdAt: string
  updatedAt: string
  lastLoginAt?: string | null
  school?: {
    id: string
    name: string
    shortName: string | null
  } | null
  student?: {
    name?: string | null
    studentNo?: string | null
    grade?: string | null
    major?: string | null
    className?: string | null
    level?: string | null
  } | null
  contact?: {
    phone?: string | null
    email?: string | null
    value?: string | null
  } | null
}

interface NotificationItem {
  id: string
  title: string
  content: string
  targetType: 'global' | 'school' | 'user'
  targetSchoolId: string | null
  targetAccountId: string | null
  active: boolean
  expiresAt?: string | null
  createdAt: string
  updatedAt?: string
  readCount?: number
  targetSchool?: {
    id: string
    name: string
    shortName: string | null
  } | null
  targetAccount?: UserItem | null
}

interface NotificationDraft {
  title: string
  content: string
  targetType: 'global' | 'school' | 'user'
  targetSchoolId: string
  targetAccountId: string
}

interface ReminderConfig {
  enabled: boolean
  dryRun: boolean
  sendWindowStart: string
  sendWindowEnd: string
  scanIntervalMs: number
  batchSize: number
  concurrency: number
  ratePerSecond: number
  maxRuntimeMs: number
  testOpenid: string
  dailyCourseTemplateId: string
  examTemplateId: string
  miniProgramState: 'developer' | 'trial' | 'formal'
  lang: 'zh_CN' | 'en_US' | 'zh_HK' | 'zh_TW'
  hasWechatCredentials: boolean
  readyToSend: boolean
  missingConfig: string[]
}

interface ReminderRunResult {
  total?: number
  sent?: number
  skipped?: number
  failed?: number
  dryRun?: boolean
  skippedReason?: string
  reason?: string
}

interface ReminderDeliveryItem {
  id: string
  subscriptionId: string | null
  accountId: string
  openid: string
  type: 'daily_course' | 'exam'
  dateKey: string
  status: 'pending' | 'sent' | 'skipped' | 'failed'
  title?: string | null
  summary?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  sentAt?: string | null
  createdAt: string
  account?: {
    id: string
    displayName: string | null
    status: string
    school?: {
      id: string
      name: string
      shortName: string | null
    } | null
  } | null
}

interface ReminderDeliveriesResponse {
  items: ReminderDeliveryItem[]
}

interface ReminderSubscriptionItem {
  id: string
  accountId: string
  openid: string
  type: 'daily_course' | 'exam'
  status: 'enabled' | 'disabled' | 'blocked'
  preferredTime: string
  lastSentDate?: string | null
  lastSentAt?: string | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  updatedAt: string
  account?: {
    id: string
    displayName: string | null
    status: string
    wechatOpenid?: string | null
    school?: {
      id: string
      name: string
      shortName: string | null
    } | null
  } | null
}

interface ReminderWxUserItem {
  openid: string
  enabledCount: number
  totalCount: number
  activeAccountId?: string
  activeAccount?: ReminderSubscriptionItem['account']
  subscriptions: ReminderSubscriptionItem[]
}

interface ReminderSubscriptionsResponse {
  items: ReminderWxUserItem[]
}

interface ReminderClearResult {
  disabled: number
}

interface ReminderTestResult {
  result: 'sent' | 'skipped' | 'failed'
  subscriptionId: string
  accountId: string
  openid: string
  type: 'daily_course' | 'exam'
  dateKey: string
}

type HomeShortcutKey =
  | 'query'
  | 'schedule'
  | 'grades'
  | 'buddySpace'
  | 'messages'
  | 'feedback'
  | 'submission'
  | 'settings'
  | 'about'

interface HomeShortcutConfigItem {
  key: HomeShortcutKey
  label: string
  enabled: boolean
  order: number
}

interface HomeShortcutConfig {
  items: HomeShortcutConfigItem[]
  updatedAt?: string
}

interface SavedConfig {
  baseUrl?: string
  adminKey?: string
  activeView?: ViewKey
}

interface StatusMessage {
  type: StatusType
  text: string
}

interface ModalState {
  title: string
  description?: string
  mode: 'json' | 'submission' | 'term' | 'provider' | 'weather'
  value: unknown
  school?: SchoolItem
}

interface TermStartRow {
  id: string
  termId: string
  startDate: string
  label?: string
  locked?: boolean
}

interface TermOption {
  id: string
  label?: string
}

interface SectionTimeItem {
  section: number
  start: string
  end: string
}

interface SectionTimeRow {
  id: string
  section: string
  start: string
  end: string
}

interface SectionTimeProfile {
  id: string
  name: string
  buildingKeywords: string[]
  sectionTimes: SectionTimeItem[]
}

interface SectionTimeProfileRow {
  id: string
  profileId: string
  name: string
  buildingKeywords: string
  sectionRows: SectionTimeRow[]
}

interface CourseBuildingItem {
  name: string
  count: number
}

interface ProviderDraft {
  providerId: string
  loginMode: string
  weatherLocation?: WeatherLocationDraft
  providerConfig?: Record<string, unknown>
  sectionTimes?: SectionTimeItem[]
  sectionTimeProfiles?: SectionTimeProfile[]
}

interface WeatherDraft {
  providerId: string
  loginMode: string
  weatherLocation?: WeatherLocationDraft
  providerConfig?: Record<string, unknown>
}

interface WeatherLocationDraft {
  displayName?: string
  latitude: number
  longitude: number
}

type ProviderConfigTab = 'sectionTimes' | 'buildingTimes'

interface ConfirmState {
  school: SchoolItem
  nextEnabled: boolean
}

interface SubmissionConfirmState {
  schoolName: string
  items: SubmissionItem[]
  nextStatus: string
}

type SchoolFilters = { keyword: string; status: string; enabled: string; sortBy: string; sortOrder: string; offset: number }
type UserFilters = { keyword: string; schoolId: string; schoolKeyword: string; status: string; offset: number }
type SubmissionFilters = { keyword: string; status: string; extraVerification: string; adaptationHelp: string; sortBy: string; sortOrder: string; offset: number }
type FeedbackFilters = { status: string; type: string; schoolKeyword: string; offset: number }
type NotificationFilters = { keyword: string; targetType: string; active: string; offset: number }
type SubmissionStatus = 'submitted' | 'candidate' | 'disabled'

const FEEDBACK_STATUS_OPTIONS = [
  ['', '全部'],
  ['pending', '待处理'],
  ['processed', '已处理'],
  ['ignored', '已忽略'],
  ['archived', '已归档'],
] as const

const SUBMISSION_STATUS_OPTIONS = [
  ['', '全部'],
  ['submitted', '待审核'],
  ['disabled', '已驳回'],
  ['candidate', '已通过'],
] as const

const HOME_SHORTCUT_OPTIONS: Array<{ key: HomeShortcutKey; name: string; description: string }> = [
  { key: 'query', name: '证书查询', description: '四六级、计算机等级考试、普通话等查询入口页。' },
  { key: 'schedule', name: '课表', description: '跳转到小程序课表 Tab。' },
  { key: 'grades', name: '成绩', description: '跳转到小程序成绩 Tab。' },
  { key: 'buddySpace', name: '搭子空间', description: '邀请好友绑定课表并查看公共空闲时间。' },
  { key: 'messages', name: '消息', description: '打开消息历史页面。' },
  { key: 'feedback', name: '反馈', description: '打开用户反馈页面。' },
  { key: 'submission', name: '接入申请', description: '打开学校接入申请页面。' },
  { key: 'settings', name: '设置', description: '打开小程序设置页面。' },
  { key: 'about', name: '关于', description: '打开关于页面。' },
]

const DEFAULT_HOME_SHORTCUT_CONFIG: HomeShortcutConfig = {
  items: [
    { key: 'query', label: '证书查询', enabled: false, order: 10 },
    { key: 'schedule', label: '课表', enabled: false, order: 20 },
    { key: 'grades', label: '成绩', enabled: false, order: 30 },
    { key: 'buddySpace', label: '搭子空间', enabled: false, order: 40 },
    { key: 'messages', label: '消息', enabled: false, order: 50 },
    { key: 'feedback', label: '反馈', enabled: false, order: 60 },
    { key: 'submission', label: '接入申请', enabled: false, order: 70 },
    { key: 'settings', label: '设置', enabled: false, order: 80 },
    { key: 'about', label: '关于', enabled: false, order: 90 },
  ],
}

const viewMeta: Record<ViewKey, { title: string; description: string }> = {
  overview: {
    title: '运营总览',
    description: '先看今天有哪些事要处理，再进入对应页面处理申请、反馈和学校异常。',
  },
  schools: {
    title: '学校管理',
    description: '管理学校是否开放给学生使用，并维护首周、上课时间和天气位置。',
  },
  users: {
    title: '用户管理',
    description: '查找学生账号，查看学校、专业、联系方式和账号是否还能正常使用。',
  },
  submissions: {
    title: '接入申请',
    description: '处理用户提交的新学校申请，确认资料后通过或驳回。',
  },
  feedback: {
    title: '用户反馈',
    description: '查看用户遇到的问题，按学校和状态筛选，并记录处理结果。',
  },
  notifications: {
    title: '通知管理',
    description: '给全平台、某个学校或某个用户发送弹窗通知，并查看发送记录。',
  },
  reminders: {
    title: '提醒设置',
    description: '设置课程和考试提醒什么时候发送、发多少、是否只试运行。',
  },
  appSettings: {
    title: '首页菜单',
    description: '控制小程序首页快捷入口显示哪些、叫什么、排在什么位置。',
  },
}

function getSavedConfig(): Required<SavedConfig> {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') as SavedConfig

    return {
      baseUrl: saved.baseUrl || DEFAULT_BASE_URL,
      adminKey: saved.adminKey || '',
      activeView: saved.activeView || 'overview',
    }
  } catch {
    return { baseUrl: DEFAULT_BASE_URL, adminKey: '', activeView: 'overview' }
  }
}

function saveConfig(config: Required<SavedConfig>) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

function normalizeBaseUrl(value: string) {
  return (value.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      query.set(key, String(value))
    }
  })

  return query.toString()
}

function joinFilled(values: Array<string | number | null | undefined>) {
  return values.filter((value) => value !== null && value !== undefined && String(value).trim()).join(' / ')
}

function getSchoolWeatherDisplayName(school: SchoolItem) {
  if (!school.weatherLocation) return '未配置坐标'

  const displayName = String(school.weatherLocation.displayName || '').trim()
  return displayName || school.city || '未配置坐标'
}

function display(value: unknown, fallback = '--') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function displayUserContact(contact?: UserItem['contact']) {
  const values = [contact?.value, contact?.phone, contact?.email]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const uniqueValues = [...new Set(values)]

  return uniqueValues.length ? uniqueValues.join(' / ') : '--'
}

function displayCount(value: number | undefined) {
  return String(Math.min(Math.max(0, Math.floor(value ?? 0)), 99999))
}

function normalizeHomeShortcutConfig(value: unknown): HomeShortcutConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<HomeShortcutConfig>)
    : {}
  const byKey = new Map<HomeShortcutKey, HomeShortcutConfigItem>()

  if (Array.isArray(record.items)) {
    record.items.forEach((item) => {
      const source = item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Partial<HomeShortcutConfigItem>)
        : {}
      const key = source.key

      if (!key || !HOME_SHORTCUT_OPTIONS.some((option) => option.key === key)) {
        return
      }

      const defaults = DEFAULT_HOME_SHORTCUT_CONFIG.items.find((entry) => entry.key === key)
      const catalog = HOME_SHORTCUT_OPTIONS.find((option) => option.key === key)
      const order = Number(source.order)

      byKey.set(key, {
        key,
        label: source.label?.trim().slice(0, 8) || defaults?.label || catalog?.name || key,
        enabled: source.enabled !== false,
        order: Number.isFinite(order) ? order : defaults?.order || 0,
      })
    })
  }

  DEFAULT_HOME_SHORTCUT_CONFIG.items.forEach((item) => {
    if (!byKey.has(item.key)) {
      byKey.set(item.key, item)
    }
  })

  return {
    items: [...byKey.values()].sort((left, right) => left.order - right.order),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  }
}

function getSortValue(sortBy: string, sortOrder: string) {
  return sortBy ? `${sortBy}:${sortOrder || 'desc'}` : ''
}

function parseSortValue(value: string) {
  const [sortBy = '', sortOrder = 'desc'] = value.split(':')
  return { sortBy, sortOrder }
}

function compareByOrder(left: number, right: number, sortOrder: string) {
  return (left - right) * (sortOrder === 'asc' ? 1 : -1)
}

function getSubmissionGroupTime(group: { items: SubmissionItem[] }, mode: 'min' | 'max') {
  const times = group.items
    .map((item) => new Date(item.createdAt).getTime())
    .filter((time) => Number.isFinite(time))

  if (!times.length) return 0
  return mode === 'min' ? Math.min(...times) : Math.max(...times)
}

function getFeedbackTypeLabel(type: string) {
  if (type === 'school_import_alert') return '学校异常告警'

  const labels: Record<string, string> = {
    experience: '体验反馈',
    bug: '问题反馈',
    suggestion: '功能建议',
  }

  return labels[type] || display(type, '反馈')
}

function getFeedbackStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: '待处理',
    processed: '已处理',
    ignored: '已忽略',
    archived: '已归档',
  }

  return labels[status] || display(status, '未知')
}

function getSchoolStatusLabel(status: string) {
  const labels: Record<string, string> = {
    catalog_only: '仅在目录中',
    candidate: '候选学校',
    researching: '调研中',
    beta: '小范围试用',
    enabled: '正式开放',
    disabled: '已停用',
  }

  return labels[status] || display(status, '未知状态')
}

function getAccountStatusLabel(status: string) {
  const labels: Record<string, string> = {
    active: '正常可用',
    need_login: '需要重新登录',
    cached_only: '仅有缓存',
    disabled: '已停用',
    unbound: '已解绑',
  }

  return labels[status] || display(status, '未知状态')
}

function formatDate(value: string | null | undefined) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function getAdminNotificationTargetLabel(targetType: NotificationItem['targetType']) {
  if (targetType === 'school') return '指定学校'
  if (targetType === 'user') return '指定用户'
  return '全平台'
}

function getAdminNotificationTargetTone(targetType: NotificationItem['targetType']) {
  if (targetType === 'school') return 'amber'
  if (targetType === 'user') return 'green'
  return ''
}

function getReminderDeliveryStatusLabel(status: ReminderDeliveryItem['status']) {
  if (status === 'sent') return '已发送'
  if (status === 'failed') return '失败'
  if (status === 'skipped') return '跳过'
  return '待处理'
}

function getReminderDeliveryStatusTone(status: ReminderDeliveryItem['status']) {
  if (status === 'sent') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'skipped') return 'amber'
  return ''
}

function getAdminNotificationTargetDetail(item: NotificationItem) {
  if (item.targetType === 'school') {
    return item.targetSchool
      ? joinFilled([item.targetSchool.name, item.targetSchool.shortName, item.targetSchool.id])
      : item.targetSchoolId || '--'
  }

  if (item.targetType === 'user') {
    return item.targetAccount
      ? joinFilled([
        item.targetAccount.student?.name || item.targetAccount.displayName,
        item.targetAccount.school?.shortName || item.targetAccount.schoolId,
        item.targetAccount.id,
      ])
      : item.targetAccountId || '--'
  }

  return '--'
}

function describeFetchError(error: unknown, apiBaseUrl: string) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    const target = normalizeBaseUrl(apiBaseUrl)
    const pageProtocol = window.location.protocol
    const apiProtocol = target.startsWith('https://') ? 'https:' : target.startsWith('http://') ? 'http:' : ''

    if (pageProtocol === 'https:' && apiProtocol === 'http:') {
      return '浏览器阻止了 HTTPS 页面访问 HTTP 接口。请用 http:// 打开管理后台，或给后端配置 HTTPS。'
    }

    return `无法连接到 ${target}。请检查服务器是否可访问、Nginx 是否转发 OPTIONS 请求，以及后端 CORS_ORIGIN/ADMIN_CORS_ORIGIN 是否包含当前管理后台地址。`
  }

  return error instanceof Error ? error.message : '请求失败。'
}

function statusTone(status: string) {
  if (['enabled', 'processed', 'success', 'active'].includes(status)) return 'green'
  if (['submitted', 'pending', 'catalog_only', 'candidate', 'researching', 'beta', 'need_login', 'cached_only'].includes(status)) return 'amber'
  if (['disabled', 'failed', 'ignored', 'archived', 'unbound'].includes(status)) return 'red'
  return ''
}

function getPendingTaskCards(stats: AdminStats | null) {
  return [
    {
      title: '学校异常告警',
      count: stats?.pendingSchoolAlerts ?? 0,
      detail: '先查看用户反馈里的学校异常，必要时停用学校。',
      tone: 'red',
    },
    {
      title: '待审核接入申请',
      count: stats?.pendingSubmissions ?? 0,
      detail: '确认学校资料和教务链接后，通过或驳回。',
      tone: 'amber',
    },
    {
      title: '待处理用户反馈',
      count: stats?.pendingFeedback ?? 0,
      detail: '查看反馈内容、学校和学生信息后更新状态。',
      tone: 'blue',
    },
    {
      title: '通知记录检查',
      count: stats?.activeNotifications ?? 0,
      detail: '确认仍在生效的通知是否需要停用。',
      tone: 'green',
    },
  ]
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase()
}

function getSubmissionSchoolKey(item: SubmissionItem) {
  return normalizeSearchText(item.schoolName) || item.id
}

function matchesSubmissionKeyword(item: SubmissionItem, keyword: string) {
  if (!keyword) return true

  return [
    item.schoolName,
    ...(item.aliases || []),
    item.province,
    item.city,
    item.officialWebsite,
    item.eduSystemWebsite,
    item.loginUrl,
  ].some((value) => normalizeSearchText(String(value || '')).includes(keyword))
}

function parseSubmissionNote(note?: string | null) {
  const fields: Record<string, string> = {}

  String(note || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separator = line.indexOf('：')
      if (separator > 0) {
        fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
      }
    })

  return {
    extraVerification: fields['除账号密码外的验证'],
    adaptationHelp: stripParenthetical(fields['是否愿意协助首个接入适配']),
    note: fields['备注'],
    contact: fields['联系方式'],
  }
}

function stripParenthetical(value?: string) {
  return String(value || '').replace(/（.*?）|\(.*?\)/g, '').trim()
}

function targetLabel(target: string) {
  const labels: Record<string, string> = {
    course: '课表',
    score: '成绩',
    exam: '考试',
    profile: '学籍',
  }

  return labels[target] || target
}

function getTrendRangeDays(range: DashboardTrendRangeValue) {
  if (range === 'today' || range === 'yesterday') return 1
  return Number.parseInt(range, 10)
}

function getTrendRangeStart(range: DashboardTrendRangeValue) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (range === 'yesterday') {
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    return yesterday
  }

  const start = new Date(today)
  start.setDate(today.getDate() - getTrendRangeDays(range) + 1)
  return start
}

function getLocalDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildTrendData(users: UserItem[], submissions: SubmissionItem[], feedback: FeedbackItem[], range: DashboardTrendRangeValue) {
  const start = getTrendRangeStart(range)
  const buckets = new Map<string, DashboardTrendPoint>()
  const rangeDays = getTrendRangeDays(range)

  for (let index = 0; index < rangeDays; index += 1) {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    const key = getLocalDayKey(day)
    buckets.set(key, {
      day: `${day.getMonth() + 1}/${day.getDate()}`,
      users: 0,
      submissions: 0,
      feedback: 0,
    })
  }

  const push = <T,>(items: T[], key: 'users' | 'submissions' | 'feedback', getDate: (item: T) => string | undefined) => {
    items.forEach((item) => {
      const value = getDate(item)
      if (!value) return
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return
      const bucketKey = getLocalDayKey(date)
      const bucket = buckets.get(bucketKey)
      if (!bucket) return
      bucket[key] += 1
    })
  }

  push(users, 'users', (item) => item.createdAt)
  push(submissions, 'submissions', (item) => item.createdAt)
  push(feedback, 'feedback', (item) => item.createdAt)

  return [...buckets.values()]
}

function buildSchoolMemberSeries(users: UserItem[], range: DashboardTrendRangeValue): DashboardBarPoint[] {
  const start = getTrendRangeStart(range)
  const end = new Date(start)
  end.setDate(start.getDate() + getTrendRangeDays(range))
  const groups = new Map<string, number>()

  users.forEach((user) => {
    const date = new Date(user.createdAt)
    if (Number.isNaN(date.getTime()) || date < start || date >= end) return
    const label = user.school?.shortName || user.school?.name || user.schoolId || '未知学校'
    groups.set(label, (groups.get(label) ?? 0) + 1)
  })

  return [...groups.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'zh-CN'))
    .slice(0, 8)
}

function buildTaskSeries(stats: AdminStats | null): DashboardBarPoint[] {
  return [
    { label: '学校告警', value: stats?.pendingSchoolAlerts ?? 0 },
    { label: '接入申请', value: stats?.pendingSubmissions ?? 0 },
    { label: '用户反馈', value: stats?.pendingFeedback ?? 0 },
    { label: '站内通知', value: stats?.activeNotifications ?? 0 },
  ]
}

function buildSchoolDistribution(schools: SchoolItem[]): DashboardPiePoint[] {
  const groups = new Map<string, number>()

  schools.forEach((school) => {
    const label = school.enabled ? '已开放' : getSchoolStatusLabel(school.status)
    groups.set(label, (groups.get(label) ?? 0) + 1)
  })

  return [...groups.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 6)
}

export function AdminConsole() {
  const saved = useMemo(getSavedConfig, [])
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl)
  const [adminKey, setAdminKey] = useState(saved.adminKey)
  const [loginBaseUrl, setLoginBaseUrl] = useState(saved.baseUrl)
  const [loginKey, setLoginKey] = useState(saved.adminKey)
  const [activeView, setActiveView] = useState<ViewKey>(saved.activeView)
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [loginStatus, setLoginStatus] = useState<StatusMessage | null>(null)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [schools, setSchools] = useState<PageResult<SchoolItem>>({ items: [], total: 0, limit: SCHOOL_PAGE_SIZE, offset: 0, hasMore: false })
  const [users, setUsers] = useState<PageResult<UserItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [submissions, setSubmissions] = useState<PageResult<SubmissionItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [feedback, setFeedback] = useState<PageResult<FeedbackItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [notifications, setNotifications] = useState<PageResult<NotificationItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [reminderConfig, setReminderConfig] = useState<ReminderConfig | null>(null)
  const [reminderDeliveries, setReminderDeliveries] = useState<ReminderDeliveryItem[]>([])
  const [reminderSubscriptions, setReminderSubscriptions] = useState<ReminderWxUserItem[]>([])
  const [reminderRun, setReminderRun] = useState<ReminderRunResult | null>(null)
  const [homeShortcutConfig, setHomeShortcutConfig] = useState<HomeShortcutConfig | null>(null)
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null)
  const [schoolFilters, setSchoolFilters] = useState<SchoolFilters>({ keyword: '', status: '', enabled: '', sortBy: '', sortOrder: 'desc', offset: 0 })
  const [userFilters, setUserFilters] = useState<UserFilters>({ keyword: '', schoolId: '', schoolKeyword: '', status: '', offset: 0 })
  const [submissionFilters, setSubmissionFilters] = useState<SubmissionFilters>({
    keyword: '',
    status: '',
    extraVerification: '',
    adaptationHelp: '',
    sortBy: '',
    sortOrder: 'desc',
    offset: 0,
  })
  const [feedbackFilters, setFeedbackFilters] = useState<FeedbackFilters>({ status: '', type: '', schoolKeyword: '', offset: 0 })
  const [notificationFilters, setNotificationFilters] = useState<NotificationFilters>({ keyword: '', targetType: '', active: '', offset: 0 })
  const [notificationDraft, setNotificationDraft] = useState<NotificationDraft>({
    title: '',
    content: '',
    targetType: 'global',
    targetSchoolId: '',
    targetAccountId: '',
  })
  const [modal, setModal] = useState<ModalState | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmState | null>(null)
  const [submissionConfirmAction, setSubmissionConfirmAction] = useState<SubmissionConfirmState | null>(null)
  const [dashboardAnalytics, setDashboardAnalytics] = useState<DashboardAnalytics | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardTrendRange, setDashboardTrendRange] = useState<DashboardTrendRangeValue>('14d')
  const pendingTasks = getPendingTaskCards(stats) as DashboardTaskItem[]
  const activeTask = pendingTasks.find((task) => task.count > 0)

  const requestApi = async <T,>(path: string, options: RequestInit & { bodyData?: unknown } = {}) => {
    const headers = new Headers(options.headers)
    headers.set('x-admin-api-key', adminKey)

    const requestOptions: RequestInit = {
      ...options,
      headers,
    }

    if (options.bodyData !== undefined) {
      headers.set('content-type', 'application/json')
      requestOptions.body = JSON.stringify(options.bodyData)
    }

    const response = await fetch(normalizeBaseUrl(baseUrl) + path, requestOptions)
    const contentType = response.headers.get('content-type') || ''
    const payload = contentType.includes('application/json') ? await response.json() : await response.text()

    if (!response.ok) {
      const message = payload && typeof payload === 'object'
        ? payload.message || payload.error || JSON.stringify(payload)
        : payload || `HTTP ${response.status}`
      throw new Error(String(message))
    }

    return payload as T
  }

  const showStatus = (text: string, type: StatusType = 'success') => {
    setStatus({ type, text })
  }

  useEffect(() => {
    if (!status) return undefined
    const timer = window.setTimeout(() => setStatus(null), 3600)
    return () => window.clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (!loginStatus) return undefined
    const timer = window.setTimeout(() => setLoginStatus(null), 3600)
    return () => window.clearTimeout(timer)
  }, [loginStatus])

  useEffect(() => {
    saveConfig({ baseUrl, adminKey, activeView })
  }, [baseUrl, adminKey, activeView])

  useEffect(() => {
    if (!authed || activeView !== 'schools') return undefined
    const timer = window.setTimeout(() => {
      void refreshSchoolsWithFilters(schoolFilters)
    }, FILTER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, schoolFilters.keyword, schoolFilters.status, schoolFilters.enabled])

  useEffect(() => {
    if (!authed || activeView !== 'users') return undefined
    const timer = window.setTimeout(() => {
      void refreshUsersWithFilters(userFilters)
    }, FILTER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, userFilters.keyword, userFilters.schoolId, userFilters.schoolKeyword, userFilters.status])

  useEffect(() => {
    if (!authed || activeView !== 'submissions') return undefined
    const timer = window.setTimeout(() => {
      void refreshSubmissionsWithFilters(submissionFilters, null)
    }, FILTER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, submissionFilters.keyword, submissionFilters.status, submissionFilters.extraVerification, submissionFilters.adaptationHelp])

  useEffect(() => {
    if (!authed || activeView !== 'feedback') return undefined
    const timer = window.setTimeout(() => {
      void refreshFeedbackWithFilters(feedbackFilters)
    }, FILTER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, feedbackFilters.status, feedbackFilters.type, feedbackFilters.schoolKeyword])

  useEffect(() => {
    if (!authed || activeView !== 'notifications') return undefined
    const timer = window.setTimeout(() => {
      void refreshNotificationsWithFilters(notificationFilters)
    }, FILTER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, notificationFilters.keyword, notificationFilters.targetType, notificationFilters.active])

  useEffect(() => {
    if (!saved.adminKey) return
    void login(saved.baseUrl, saved.adminKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function login(nextBaseUrl = loginBaseUrl, nextAdminKey = loginKey) {
    const cleanBaseUrl = normalizeBaseUrl(nextBaseUrl)
    const cleanKey = nextAdminKey.trim()

    if (!cleanKey) {
      setLoginStatus({ type: 'error', text: '请填写管理员接口密钥。' })
      return
    }

    setBaseUrl(cleanBaseUrl)
    setAdminKey(cleanKey)
    setLoginBaseUrl(cleanBaseUrl)
    setLoginKey(cleanKey)

    try {
      setLoading(true)
      const nextStats = await fetchWithKey<AdminStats>(cleanBaseUrl, cleanKey, '/admin/stats')
      setStats(nextStats)
      setAuthed(true)
      setLoginStatus(null)
      await hydrateView(activeView, cleanBaseUrl, cleanKey)
      void refreshDashboardAnalytics(cleanBaseUrl, cleanKey)
      showStatus('已连接管理接口。')
    } catch (error) {
      setAuthed(false)
      setLoginStatus({ type: 'error', text: describeFetchError(error, cleanBaseUrl) })
    } finally {
      setLoading(false)
    }
  }

  async function fetchWithKey<T>(apiBaseUrl: string, key: string, path: string, options: RequestInit & { bodyData?: unknown } = {}) {
    const headers = new Headers(options.headers)
    headers.set('x-admin-api-key', key)

    const requestOptions: RequestInit = { ...options, headers }
    if (options.bodyData !== undefined) {
      headers.set('content-type', 'application/json')
      requestOptions.body = JSON.stringify(options.bodyData)
    }

    const response = await fetch(normalizeBaseUrl(apiBaseUrl) + path, requestOptions)
    const contentType = response.headers.get('content-type') || ''
    const payload = contentType.includes('application/json') ? await response.json() : await response.text()

    if (!response.ok) {
      const message = payload && typeof payload === 'object'
        ? payload.message || payload.error || JSON.stringify(payload)
        : payload || `HTTP ${response.status}`
      throw new Error(String(message))
    }

    return payload as T
  }

  async function fetchPageWindow<T>(apiBaseUrl: string, key: string, path: string, max = 1000) {
    const pageSize = 200
    const items: T[] = []
    let offset = 0
    let hasMore = true

    while (hasMore && items.length < max) {
      const limit = Math.min(pageSize, max - items.length)
      const separator = path.includes('?') ? '&' : '?'
      const response = await fetchWithKey<PageResult<T>>(apiBaseUrl, key, `${path}${separator}limit=${limit}&offset=${offset}`)
      items.push(...response.items)
      hasMore = response.hasMore
      offset += limit
    }

    return {
      items,
      partial: hasMore,
    }
  }

  async function refreshDashboardAnalytics(apiBaseUrl = baseUrl, key = adminKey, surfaceError = false, trendRange = dashboardTrendRange) {
    try {
      setDashboardLoading(true)
      const [usersWindow, submissionsWindow, feedbackWindow, schoolsWindow] = await Promise.all([
        fetchPageWindow<UserItem>(apiBaseUrl, key, '/admin/users'),
        fetchPageWindow<SubmissionItem>(apiBaseUrl, key, '/admin/submissions'),
        fetchPageWindow<FeedbackItem>(apiBaseUrl, key, '/admin/feedback'),
        fetchPageWindow<SchoolItem>(apiBaseUrl, key, '/admin/schools?sortBy=default'),
      ])

      setDashboardAnalytics({
        trend: buildTrendData(usersWindow.items, submissionsWindow.items, feedbackWindow.items, trendRange),
        tasks: buildTaskSeries(stats),
        schoolDistribution: buildSchoolDistribution(schoolsWindow.items),
        schoolMembers: buildSchoolMemberSeries(usersWindow.items, trendRange),
        updatedAt: new Date().toISOString(),
        partial: usersWindow.partial || submissionsWindow.partial || feedbackWindow.partial || schoolsWindow.partial,
      })
    } catch (error) {
      if (surfaceError) {
        showStatus(describeFetchError(error, apiBaseUrl), 'error')
      }
    } finally {
      setDashboardLoading(false)
    }
  }

  async function hydrateView(view: ViewKey, apiBaseUrl = baseUrl, key = adminKey) {
    const load = <T,>(path: string) => fetchWithKey<T>(apiBaseUrl, key, path)
    const nextStats = await load<AdminStats>('/admin/stats')
    setStats(nextStats)

    if (view === 'schools') {
      const query = buildQuery({
        keyword: schoolFilters.keyword,
        status: schoolFilters.status,
        enabled: schoolFilters.enabled,
        limit: SCHOOL_PAGE_SIZE,
        offset: schoolFilters.offset,
      })
      setSchools(await load<PageResult<SchoolItem>>('/admin/schools?' + query))
    }

    if (view === 'users') {
      const query = buildQuery({
        keyword: userFilters.keyword,
        schoolId: userFilters.schoolId,
        schoolKeyword: userFilters.schoolKeyword,
        status: userFilters.status,
        limit: SCHOOL_PAGE_SIZE,
        offset: userFilters.offset,
      })
      setUsers(await load<PageResult<UserItem>>('/admin/users?' + query))
    }

    if (view === 'submissions') {
      const query = buildQuery({
        keyword: submissionFilters.keyword,
        status: submissionFilters.status,
        extraVerification: submissionFilters.extraVerification,
        adaptationHelp: submissionFilters.adaptationHelp,
        limit: SUBMISSION_PAGE_SIZE,
        offset: submissionFilters.offset,
      })
      setSubmissions(await load<PageResult<SubmissionItem>>('/admin/submissions?' + query))
    }

    if (view === 'feedback') {
      const query = buildQuery({
        status: feedbackFilters.status,
        type: feedbackFilters.type,
        schoolKeyword: feedbackFilters.schoolKeyword,
        limit: PAGE_SIZE,
        offset: feedbackFilters.offset,
      })
      const nextFeedback = await load<PageResult<FeedbackItem>>('/admin/feedback?' + query)
      setFeedback(nextFeedback)
      setSelectedFeedback(nextFeedback.items[0] || null)
    }

    if (view === 'notifications') {
      const query = buildQuery({
        keyword: notificationFilters.keyword,
        targetType: notificationFilters.targetType,
        active: notificationFilters.active,
        limit: PAGE_SIZE,
        offset: notificationFilters.offset,
      })
      setNotifications(await load<PageResult<NotificationItem>>('/admin/notifications?' + query))
    }

    if (view === 'reminders') {
      const [nextReminderConfig, nextReminderDeliveries, nextReminderSubscriptions] = await Promise.all([
        load<ReminderConfig>('/admin/reminders/config'),
        load<ReminderDeliveriesResponse>('/admin/reminders/deliveries?limit=50'),
        load<ReminderSubscriptionsResponse>('/admin/reminders/subscriptions?status=enabled&limit=200'),
      ])

      setReminderConfig(nextReminderConfig)
      setReminderDeliveries(nextReminderDeliveries.items)
      setReminderSubscriptions(nextReminderSubscriptions.items)
    }

    if (view === 'appSettings') {
      setHomeShortcutConfig(normalizeHomeShortcutConfig(await load<HomeShortcutConfig>('/admin/settings/home-shortcuts')))
    }
  }

  async function refreshCurrentView(successMessage = '数据已刷新。') {
    try {
      setLoading(true)
      await hydrateView(activeView)
      if (activeView === 'overview') {
        await refreshDashboardAnalytics(baseUrl, adminKey)
      }
      showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function refreshSchoolsWithFilters(nextFilters: SchoolFilters, successMessage: string | null = null) {
    const showSpinner = successMessage !== null
    setSchoolFilters(nextFilters)
    try {
      if (showSpinner) setLoading(true)
      const query = buildQuery({
        keyword: nextFilters.keyword,
        status: nextFilters.status,
        enabled: nextFilters.enabled,
        limit: PAGE_SIZE,
        offset: nextFilters.offset,
      })
      const [nextStats, nextSchools] = await Promise.all([
        requestApi<AdminStats>('/admin/stats'),
        requestApi<PageResult<SchoolItem>>('/admin/schools?' + query),
      ])
      setStats(nextStats)
      setSchools(nextSchools)
      if (successMessage) showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  async function refreshUsersWithFilters(nextFilters: UserFilters, successMessage: string | null = null) {
    const showSpinner = successMessage !== null
    setUserFilters(nextFilters)
    try {
      if (showSpinner) setLoading(true)
      const query = buildQuery({
        keyword: nextFilters.keyword,
        schoolId: nextFilters.schoolId,
        schoolKeyword: nextFilters.schoolKeyword,
        status: nextFilters.status,
        limit: PAGE_SIZE,
        offset: nextFilters.offset,
      })
      const [nextStats, nextUsers] = await Promise.all([
        requestApi<AdminStats>('/admin/stats'),
        requestApi<PageResult<UserItem>>('/admin/users?' + query),
      ])
      setStats(nextStats)
      setUsers(nextUsers)
      if (successMessage) showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  async function refreshSubmissionsWithFilters(nextFilters: SubmissionFilters, successMessage: string | null = '数据已刷新。') {
    const showSpinner = successMessage !== null
    setSubmissionFilters(nextFilters)
    try {
      if (showSpinner) setLoading(true)
      const query = buildQuery({
        keyword: nextFilters.keyword,
        status: nextFilters.status,
        extraVerification: nextFilters.extraVerification,
        adaptationHelp: nextFilters.adaptationHelp,
        limit: SUBMISSION_PAGE_SIZE,
        offset: nextFilters.offset,
      })
      const [nextStats, nextSubmissions] = await Promise.all([
        requestApi<AdminStats>('/admin/stats'),
        requestApi<PageResult<SubmissionItem>>('/admin/submissions?' + query),
      ])
      setStats(nextStats)
      setSubmissions(nextSubmissions)
      if (successMessage) showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  async function refreshFeedbackWithFilters(nextFilters: FeedbackFilters, successMessage: string | null = null) {
    const showSpinner = successMessage !== null
    setFeedbackFilters(nextFilters)
    try {
      if (showSpinner) setLoading(true)
      const query = buildQuery({
        status: nextFilters.status,
        type: nextFilters.type,
        schoolKeyword: nextFilters.schoolKeyword,
        limit: PAGE_SIZE,
        offset: nextFilters.offset,
      })
      const [nextStats, nextFeedback] = await Promise.all([
        requestApi<AdminStats>('/admin/stats'),
        requestApi<PageResult<FeedbackItem>>('/admin/feedback?' + query),
      ])
      setStats(nextStats)
      setFeedback(nextFeedback)
      setSelectedFeedback(nextFeedback.items[0] || null)
      if (successMessage) showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  async function refreshNotificationsWithFilters(nextFilters: NotificationFilters, successMessage: string | null = null) {
    const showSpinner = successMessage !== null
    setNotificationFilters(nextFilters)
    try {
      if (showSpinner) setLoading(true)
      const query = buildQuery({
        keyword: nextFilters.keyword,
        targetType: nextFilters.targetType,
        active: nextFilters.active,
        limit: PAGE_SIZE,
        offset: nextFilters.offset,
      })
      const [nextStats, nextNotifications] = await Promise.all([
        requestApi<AdminStats>('/admin/stats'),
        requestApi<PageResult<NotificationItem>>('/admin/notifications?' + query),
      ])
      setStats(nextStats)
      setNotifications(nextNotifications)
      if (successMessage) showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  async function switchView(view: ViewKey) {
    setActiveView(view)
    try {
      setLoading(true)
      await Promise.all([
        hydrateView(view),
        view === 'overview' ? refreshDashboardAnalytics(baseUrl, adminKey) : Promise.resolve(),
      ])
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  function openSchoolFeedback(school: SchoolItem) {
    setActiveView('feedback')
    setFeedbackFilters({ status: '', type: '', schoolKeyword: school.name, offset: 0 })
  }

  function openSchoolUsers(school: SchoolItem) {
    setActiveView('users')
    setUserFilters({ keyword: '', schoolId: school.id, schoolKeyword: school.name, status: '', offset: 0 })
  }

  function requestToggleSchool(school: SchoolItem) {
    setConfirmAction({ school, nextEnabled: !school.enabled })
  }

  function logout() {
    setAuthed(false)
    setAdminKey('')
    setLoginKey('')
    setDashboardAnalytics(null)
    setStats(null)
    setSchools({ items: [], total: 0, limit: SCHOOL_PAGE_SIZE, offset: 0, hasMore: false })
    setUsers({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setSubmissions({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setFeedback({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setNotifications({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setReminderSubscriptions([])
    setReminderDeliveries([])
    setHomeShortcutConfig(null)
    setSelectedFeedback(null)
  }

  async function toggleSchool(school: SchoolItem, nextEnabled = !school.enabled) {
    try {
      await requestApi(`/admin/schools/${encodeURIComponent(school.id)}`, {
        method: 'PATCH',
        bodyData: { enabled: nextEnabled },
      })
      setConfirmAction(null)
      await refreshCurrentView(nextEnabled ? '学校已启用。' : '学校已停用。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function updateSubmissions(items: SubmissionItem[], nextStatus: string) {
    if (!items.length) return

    try {
      const reviewedAt = new Date().toISOString()
      await Promise.all(items.map((item) => (
        requestApi(`/admin/submissions/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          bodyData: {
            status: nextStatus,
            review: {
              reviewedAt,
              source: 'admin-frontend',
            },
          },
        })
      )))
      setSubmissionConfirmAction(null)
      await refreshCurrentView(`${items.length} 条申请已更新为${getSubmissionStatusLabel(nextStatus)}。`)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function deleteSubmission(item: SubmissionItem) {
    if (item.status !== 'disabled') return

    try {
      await requestApi(`/admin/submissions/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      await refreshCurrentView('申请已删除。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function deleteSubmissionGroup(items: SubmissionItem[]) {
    const rejectedItems = items.filter((item) => item.status === 'disabled')
    if (!rejectedItems.length || rejectedItems.length !== items.length) return

    try {
      await Promise.all(rejectedItems.map((item) => (
        requestApi(`/admin/submissions/${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
        })
      )))
      await refreshCurrentView(`${rejectedItems.length} 条申请已删除。`)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function updateFeedbackStatus(item: FeedbackItem, nextStatus: string) {
    const status = nextStatus.trim()
    if (!status) return

    try {
      await requestApi(`/admin/feedback/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        bodyData: { status },
      })
      await refreshFeedbackWithFilters(feedbackFilters, `反馈已设为${getFeedbackStatusLabel(status)}。`)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function deleteFeedback(item: FeedbackItem) {
    try {
      await requestApi(`/admin/feedback/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      await refreshFeedbackWithFilters(feedbackFilters, '反馈已删除。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  function requestUpdateSubmissions(schoolName: string, items: SubmissionItem[], nextStatus: string) {
    if (!items.length) return
    setSubmissionConfirmAction({ schoolName, items, nextStatus })
  }

  function openUserNotification(user: UserItem) {
    setNotificationDraft({
      title: '',
      content: '',
      targetType: 'user',
      targetSchoolId: '',
      targetAccountId: user.id,
    })
    setActiveView('notifications')
  }

  function openSchoolNotification(school: SchoolItem) {
    setNotificationDraft({
      title: '',
      content: '',
      targetType: 'school',
      targetSchoolId: school.id,
      targetAccountId: '',
    })
    setActiveView('notifications')
  }

  async function createNotification(draft: NotificationDraft) {
    try {
      setLoading(true)
      await requestApi('/admin/notifications', {
        method: 'POST',
        bodyData: {
          title: draft.title,
          content: draft.content,
          targetType: draft.targetType,
          targetSchoolId: draft.targetType === 'school' ? draft.targetSchoolId : null,
          targetAccountId: draft.targetType === 'user' ? draft.targetAccountId : null,
        },
      })
      setNotificationDraft({
        title: '',
        content: '',
        targetType: 'global',
        targetSchoolId: '',
        targetAccountId: '',
      })
      await refreshNotificationsWithFilters({ ...notificationFilters, offset: 0 }, '通知已发送。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function deactivateNotification(notification: NotificationItem) {
    try {
      setLoading(true)
      await requestApi(`/admin/notifications/${encodeURIComponent(notification.id)}`, {
        method: 'PATCH',
        bodyData: { active: false },
      })
      await refreshNotificationsWithFilters(notificationFilters, '通知已停用。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function submitModal(value: unknown) {
    if (!modal?.school) return

    try {
      const path = modal.mode === 'term'
        ? `/admin/schools/${encodeURIComponent(modal.school.id)}`
        : `/admin/schools/${encodeURIComponent(modal.school.id)}/provider-config`
      const bodyData = modal.mode === 'term' ? { termStarts: value } : value

      await requestApi(path, {
        method: modal.mode === 'term' ? 'PATCH' : 'PUT',
        bodyData,
      })
      setModal(null)
      await refreshCurrentView(modal.mode === 'term'
        ? '默认首周已保存。'
        : modal.mode === 'weather'
          ? '天气配置已保存。'
          : '上课时间配置已保存。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function saveReminderConfig(config: ReminderConfig) {
    try {
      setLoading(true)
      const nextConfig = await requestApi<ReminderConfig>('/admin/reminders/config', {
        method: 'POST',
        bodyData: config,
      })
      setReminderConfig(nextConfig)
      showStatus('提醒设置已保存。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function saveHomeShortcutConfig(config: HomeShortcutConfig) {
    try {
      setLoading(true)
      const nextConfig = await requestApi<HomeShortcutConfig>('/admin/settings/home-shortcuts', {
        method: 'PUT',
        bodyData: normalizeHomeShortcutConfig(config),
      })
      setHomeShortcutConfig(normalizeHomeShortcutConfig(nextConfig))
      showStatus('首页菜单已保存，用户下次打开小程序后生效。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function runReminderDryRun() {
    try {
      setLoading(true)
      const result = await requestApi<ReminderRunResult>('/admin/reminders/run?force=true&dryRun=true&limit=20', {
        method: 'POST',
      })
      setReminderRun(result)
      await refreshReminderAdminData()
      showStatus('提醒试跑已完成。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function refreshReminderAdminData() {
    const [nextDeliveries, nextSubscriptions] = await Promise.all([
      requestApi<ReminderDeliveriesResponse>('/admin/reminders/deliveries?limit=50'),
      requestApi<ReminderSubscriptionsResponse>('/admin/reminders/subscriptions?status=enabled&limit=200'),
    ])

    setReminderDeliveries(nextDeliveries.items)
    setReminderSubscriptions(nextSubscriptions.items)
  }

  async function clearReminderSubscriptions(input: { openid?: string; accountId?: string }) {
    const scope = input.openid
      ? `openid ${input.openid}`
      : input.accountId
        ? `账号 ${input.accountId}`
        : '所有用户'

    if (!input.openid && !input.accountId && !window.confirm('确认清空所有人的订阅提醒？')) {
      return
    }

    try {
      setLoading(true)
      const result = await requestApi<ReminderClearResult>('/admin/reminders/subscriptions/clear', {
        method: 'POST',
        bodyData: input,
      })
      await refreshReminderAdminData()
      showStatus(`${scope} 已清空 ${result.disabled} 条订阅提醒。`)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function sendReminderTest(input: { openid?: string; accountId?: string; type?: 'daily_course' | 'exam' }) {
    try {
      setLoading(true)
      const result = await requestApi<ReminderTestResult>('/admin/reminders/subscriptions/test', {
        method: 'POST',
        bodyData: input,
      })
      await refreshReminderAdminData()
      showStatus(`测试提醒已发送给 ${result.openid}，使用账号 ${result.accountId}。`)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!authed) {
    return (
      <LoginView
        loading={loading}
        status={loginStatus}
        baseUrl={loginBaseUrl}
        adminKey={loginKey}
        onBaseUrlChange={setLoginBaseUrl}
        onAdminKeyChange={setLoginKey}
        onSubmit={() => void login()}
      />
    )
  }

  return (
    <AppLayout
      sidebar={(
        <>
          <div className="brand">
            <div className="brand-mark">CS</div>
            <div>
              <div className="brand-title">CSchedule</div>
              <div className="brand-subtitle">运营后台 · Enterprise Console</div>
            </div>
          </div>
          <nav className="nav" aria-label="主导航">
            <NavButton active={activeView === 'overview'} icon={<LayoutDashboard size={18} />} label="总览" onClick={() => void switchView('overview')} />
            <NavButton active={activeView === 'schools'} icon={<School size={18} />} label="学校管理" onClick={() => void switchView('schools')} />
            <NavButton active={activeView === 'users'} icon={<Users size={18} />} label="用户管理" onClick={() => void switchView('users')} />
            <NavButton active={activeView === 'appSettings'} icon={<Settings2 size={18} />} label="首页菜单" onClick={() => void switchView('appSettings')} />
            <NavButton active={activeView === 'submissions'} icon={<Inbox size={18} />} label="接入申请" onClick={() => void switchView('submissions')} />
            <NavButton active={activeView === 'feedback'} icon={<MessageSquareWarning size={18} />} label="用户反馈" onClick={() => void switchView('feedback')} />
            <NavButton active={activeView === 'reminders'} icon={<BellRing size={18} />} label="提醒设置" onClick={() => void switchView('reminders')} />
            <NavButton active={activeView === 'notifications'} icon={<Bell size={18} />} label="通知管理" onClick={() => void switchView('notifications')} />
          </nav>
          <div className="sidebar-footer">管理端仅面向可信浏览器环境。请在离开设备前退出登录，并避免将管理员密钥暴露给普通用户。</div>
        </>
      )}
      topbar={(
        <PageHeader
          title={viewMeta[activeView].title}
          actions={(
            <>
              <ThemeToggle />
              <button className="button secondary" type="button" onClick={() => void refreshCurrentView()} disabled={loading}>
                <RefreshCw size={16} />
                刷新当前页
              </button>
              <button className="button ghost" type="button" onClick={logout}>
                <LogOut size={16} />
                退出
              </button>
            </>
          )}
        />
      )}
    >
      {status && <StatusLine status={status} />}

      {activeView === 'overview' && (
      <section className="config-row" aria-label="接口配置">
        <label className="field">
          <span>后端接口地址</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoComplete="url" />
        </label>
        <label className="field">
          <span>管理员密钥</span>
          <input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} autoComplete="current-password" />
        </label>
        <button className="button secondary" type="button" onClick={() => showStatus('配置已保存。')}>
          <Save size={16} />
          保存配置
        </button>
      </section>
      )}

      {activeView === 'overview' && <MetricGrid stats={stats} />}

      <section className="workspace">
        {loading && <Panel><div className="empty">正在加载数据…</div></Panel>}
        {!loading && activeView === 'overview' && (
          <DashboardOverview
            stats={stats}
            analytics={dashboardAnalytics}
            trendRange={dashboardTrendRange}
            tasks={pendingTasks}
            loading={dashboardLoading}
            onRefresh={() => void refreshCurrentView()}
            onTrendRangeChange={(range) => {
              setDashboardTrendRange(range)
              void refreshDashboardAnalytics(baseUrl, adminKey, true, range)
            }}
            onOpenSchoolAlerts={() => {
              const nextFilters = { status: 'pending', type: 'school_import_alert', schoolKeyword: '', offset: 0 }
              setActiveView('feedback')
              setFeedbackFilters(nextFilters)
              void refreshFeedbackWithFilters(nextFilters)
            }}
          />
        )}
        {!loading && activeView === 'schools' && (
          <SchoolsView
            schools={schools}
            filters={schoolFilters}
            onFiltersChange={setSchoolFilters}
            onPage={(offset) => {
              const nextFilters = { ...schoolFilters, offset }
              setSchoolFilters(nextFilters)
              void refreshSchoolsWithFilters(nextFilters, '数据已刷新。')
            }}
            onToggle={requestToggleSchool}
            onOpenTerm={(school) => setModal({
              title: '配置默认首周',
              description: `${school.name} / ${school.id}`,
              mode: 'term',
              value: school.termStarts || {},
              school,
            })}
            onOpenProvider={(school) => setModal({
              title: '配置上课时间',
              description: `${school.name} / ${school.id}`,
              mode: 'provider',
              value: getProviderDraft(school),
              school,
            })}
            onOpenWeather={(school) => setModal({
              title: '配置天气',
              description: `${school.name} / ${school.id}`,
              mode: 'weather',
              value: getWeatherDraft(school),
              school,
            })}
            onOpenFeedback={openSchoolFeedback}
            onOpenUsers={openSchoolUsers}
            onNotify={openSchoolNotification}
          />
        )}
        {!loading && activeView === 'users' && (
          <UsersView
            data={users}
            filters={userFilters}
            onFiltersChange={setUserFilters}
            onPage={(offset) => {
              const nextFilters = { ...userFilters, offset }
              setUserFilters(nextFilters)
              void refreshUsersWithFilters(nextFilters, '数据已刷新。')
            }}
            onNotify={openUserNotification}
          />
        )}
        {!loading && activeView === 'submissions' && (
          <SubmissionsView
            data={submissions}
            filters={submissionFilters}
            onFiltersChange={setSubmissionFilters}
            onPage={(offset) => {
              const nextFilters = { ...submissionFilters, offset }
              setSubmissionFilters(nextFilters)
              void refreshSubmissionsWithFilters(nextFilters, '数据已刷新。')
            }}
            onUpdate={requestUpdateSubmissions}
            onOpen={(item) => setModal({ title: '申请详情', description: item.schoolName, mode: 'submission', value: item })}
            onDelete={(item) => void deleteSubmission(item)}
            onDeleteGroup={(items) => void deleteSubmissionGroup(items)}
          />
        )}
        {!loading && activeView === 'feedback' && (
          <FeedbackView
            data={feedback}
            filters={feedbackFilters}
            selected={selectedFeedback}
            onFiltersChange={setFeedbackFilters}
            onPage={(offset) => {
              const nextFilters = { ...feedbackFilters, offset }
              setFeedbackFilters(nextFilters)
              void refreshFeedbackWithFilters(nextFilters, '数据已刷新。')
            }}
            onSelect={setSelectedFeedback}
            onUpdateStatus={(item, nextStatus) => void updateFeedbackStatus(item, nextStatus)}
            onDelete={(item) => void deleteFeedback(item)}
            onShowJson={(item) => setModal({ title: '反馈原始数据', description: item.id, mode: 'json', value: item })}
          />
        )}
        {!loading && activeView === 'notifications' && (
          <NotificationsView
            data={notifications}
            filters={notificationFilters}
            draft={notificationDraft}
            onFiltersChange={setNotificationFilters}
            onDraftChange={setNotificationDraft}
            onSubmit={(draft) => void createNotification(draft)}
            onDeactivate={(item) => void deactivateNotification(item)}
            onPage={(offset) => {
              const nextFilters = { ...notificationFilters, offset }
              setNotificationFilters(nextFilters)
              void refreshNotificationsWithFilters(nextFilters, '数据已刷新。')
            }}
          />
        )}
        {!loading && activeView === 'reminders' && (
          <RemindersView
            config={reminderConfig}
            deliveries={reminderDeliveries}
            subscriptions={reminderSubscriptions}
            runResult={reminderRun}
            onSave={(config) => void saveReminderConfig(config)}
            onDryRun={() => void runReminderDryRun()}
            onClearSubscriptions={(input) => void clearReminderSubscriptions(input)}
            onSendTest={(input) => void sendReminderTest(input)}
          />
        )}
        {!loading && activeView === 'appSettings' && (
          <HomeShortcutSettingsView
            config={homeShortcutConfig}
            onSave={(config) => void saveHomeShortcutConfig(config)}
          />
        )}
      </section>

      {modal && (
        <ConfigModal
          modal={modal}
          onClose={() => setModal(null)}
          onSubmit={submitModal}
        />
      )}
      {confirmAction && (
        <ConfirmModal
          action={confirmAction}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void toggleSchool(confirmAction.school, confirmAction.nextEnabled)}
        />
      )}
      {submissionConfirmAction && (
        <SubmissionConfirmModal
          action={submissionConfirmAction}
          onCancel={() => setSubmissionConfirmAction(null)}
          onConfirm={() => void updateSubmissions(submissionConfirmAction.items, submissionConfirmAction.nextStatus)}
        />
      )}
    </AppLayout>
  )
}

function getProviderDraft(school: SchoolItem) {
  return {
    providerId: school.providerId || school.id,
    loginMode: school.loginMode || 'direct_password',
    weatherLocation: school.weatherLocation,
    sectionTimes: school.sectionTimes || [],
    sectionTimeProfiles: school.sectionTimeProfiles || [],
  }
}

function getWeatherDraft(school: SchoolItem): WeatherDraft {
  return {
    providerId: school.providerId || school.id,
    loginMode: school.loginMode || 'direct_password',
    weatherLocation: school.weatherLocation,
  }
}

function createTermStartRows(termStarts: unknown, terms: TermOption[] = [], school?: SchoolItem): TermStartRow[] {
  const record = termStarts && typeof termStarts === 'object' && !Array.isArray(termStarts)
    ? termStarts as Record<string, unknown>
    : {}
  const groupedTerms = groupTermOptionsForDisplay(terms, school)
  const usedTermStartKeys = new Set<string>()
  const rows: TermStartRow[] = []

  for (const group of groupedTerms) {
    const recordKey = group.ids.find((termId) => Object.prototype.hasOwnProperty.call(record, termId))
    const termId = recordKey || group.preferredId

    if (!termId) continue
    if (recordKey) usedTermStartKeys.add(recordKey)

    rows.push({
      id: `term-${termId}`,
      termId,
      label: group.label,
      startDate: String(recordKey ? record[recordKey] : ''),
      locked: true,
    })
  }

  for (const [termId, startDate] of Object.entries(record)) {
    if (usedTermStartKeys.has(termId)) continue
    rows.push({
      id: `manual-${termId}`,
      termId,
      label: getTermDisplayLabel(termId, terms, school),
      startDate: String(startDate || ''),
      locked: Boolean(termId),
    })
  }

  return rows.length ? rows : [{ id: String(Date.now()), termId: '', startDate: '' }]
}

function groupTermOptionsForDisplay(terms: TermOption[], school?: SchoolItem) {
  const providerCode = getSchoolProviderCode(school)
  const groups = new Map<string, { ids: string[]; preferredId: string; label: string }>()

  for (const term of terms) {
    const termId = String(term.id || '').trim()
    if (!termId) continue

    const key = getTermDisplayKey(termId, providerCode)
    const label = normalizeTermDisplayLabel(term.label, termId, providerCode)
    const ids = getTermDisplayAliases(termId, providerCode)
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, {
        ids,
        preferredId: termId,
        label,
      })
      continue
    }

    for (const id of ids) {
      if (!existing.ids.includes(id)) existing.ids.push(id)
    }
    if (isProviderScopedTermId(termId, providerCode)) existing.preferredId = termId
    if (isBetterTermDisplayLabel(label, existing.label, termId, existing.preferredId)) {
      existing.label = label
    }
  }

  return [...groups.values()].sort((left, right) => (
    getTermDisplaySortKey(right.label, right.preferredId, providerCode) -
    getTermDisplaySortKey(left.label, left.preferredId, providerCode)
  ))
}

function getTermDisplayLabel(termId: string, terms: TermOption[] = [], school?: SchoolItem) {
  const providerCode = getSchoolProviderCode(school)
  const key = getTermDisplayKey(termId, providerCode)
  const group = groupTermOptionsForDisplay(terms, school).find((item) => (
    item.ids.includes(termId) || item.ids.some((id) => getTermDisplayKey(id, providerCode) === key)
  ))

  return group?.label || normalizeTermDisplayLabel('', termId, providerCode)
}

function getTermStartDisplayEntries(school: SchoolItem) {
  return Object.entries(school.termStarts || {})
    .map(([termId, date]) => ({
      termId,
      date,
      label: getTermDisplayLabel(termId, school.terms || [], school),
    }))
    .sort((left, right) => (
      getTermDisplaySortKey(right.label, right.termId, getSchoolProviderCode(school)) -
      getTermDisplaySortKey(left.label, left.termId, getSchoolProviderCode(school))
    ))
}

function getTermStartDisplayOptions(school: SchoolItem) {
  const entries = getTermStartDisplayEntries(school)
  const entriesByTermId = new Map(entries.map((entry) => [entry.termId, entry]))
  const knownOptions = groupTermOptionsForDisplay(school.terms || [], school).map((term) => {
    const matchedEntry = term.ids.map((termId) => entriesByTermId.get(termId)).find(Boolean)

    return {
      termId: term.preferredId,
      label: term.label,
      date: matchedEntry?.date || '',
      configuredTermId: matchedEntry?.termId,
    }
  })
  const knownTermIds = new Set(knownOptions.flatMap((term) => [term.termId, term.configuredTermId].filter(Boolean)))
  const extraOptions = entries
    .filter((entry) => !knownTermIds.has(entry.termId))
    .map((entry) => ({ ...entry, configuredTermId: entry.termId }))

  return [...knownOptions, ...extraOptions]
}

function getPrimaryTermStartDisplay(school: SchoolItem) {
  const knownTerm = groupTermOptionsForDisplay(school.terms || [], school)[0]
  const entries = getTermStartDisplayEntries(school)

  if (!knownTerm) {
    return entries[0] ? `${entries[0].label}: ${entries[0].date}` : '未配置'
  }

  const matchedEntry = entries.find((entry) => knownTerm.ids.includes(entry.termId))
  return `${knownTerm.label}: ${matchedEntry?.date || '未配置'}`
}

function getTermDisplayKey(termId: string, providerCode = '') {
  const cleanTermId = termId.trim()
  const scopedMatch = cleanTermId.match(/^([^:]+):(.+)$/)

  if (!scopedMatch) return cleanTermId

  const prefix = scopedMatch[1].trim()
  const scopedId = scopedMatch[2].trim()

  if (!providerCode || prefix.toLowerCase() === providerCode.toLowerCase()) {
    return scopedId || cleanTermId
  }

  return cleanTermId
}

function getTermDisplayAliases(termId: string, providerCode = '') {
  const cleanTermId = termId.trim()
  const aliases = new Set([cleanTermId])
  const key = getTermDisplayKey(cleanTermId, providerCode)

  if (key) aliases.add(key)
  if (providerCode && key && key === cleanTermId) aliases.add(`${providerCode}:${key}`)

  return [...aliases]
}

function isProviderScopedTermId(termId: string, providerCode = '') {
  if (!providerCode) return false

  const scopedMatch = termId.trim().match(/^([^:]+):(.+)$/)
  return Boolean(scopedMatch && scopedMatch[1].toLowerCase() === providerCode.toLowerCase())
}

function normalizeTermDisplayLabel(label: string | undefined, termId: string, providerCode = '') {
  const cleanTermId = termId.trim()
  const cleanLabel = String(label || '').trim()

  if (isAcademicTermDisplayLabel(cleanLabel)) {
    return cleanLabel
  }

  const scopedMatch = cleanTermId.match(/^([^:]+):(.+)$/)

  if (scopedMatch) {
    const prefix = scopedMatch[1].trim()
    const scopedId = scopedMatch[2].trim()
    const providerLabel = providerCode || prefix
    const formattedTerm = formatProviderTermId(providerLabel, scopedId)

    if (
      formattedTerm &&
      (!cleanLabel || cleanLabel === cleanTermId || cleanLabel === scopedId || isGenericTermDisplayLabel(cleanLabel, scopedId, providerLabel))
    ) {
      return formattedTerm
    }

    if (cleanLabel && cleanLabel !== cleanTermId) {
      return cleanLabel
    }

    return `${providerLabel.toUpperCase()} 学期 ${scopedId || cleanTermId}`
  }

  const formattedTerm = formatProviderTermId(providerCode, cleanTermId)

  if (formattedTerm && (!cleanLabel || cleanLabel === cleanTermId || isGenericTermDisplayLabel(cleanLabel, cleanTermId, providerCode))) {
    return formattedTerm
  }

  if (cleanLabel && cleanLabel !== cleanTermId) {
    return cleanLabel
  }

  if (providerCode && /^\d+$/.test(cleanTermId)) {
    return `${providerCode.toUpperCase()} 学期 ${cleanTermId}`
  }

  return cleanLabel || cleanTermId
}

function isAcademicTermDisplayLabel(value: string) {
  return /20\d{2}.*20\d{2}.*学期/.test(value)
}

function isGenericTermDisplayLabel(label: string, termId: string, providerCode = '') {
  const normalizedLabel = label.trim().toLowerCase().replace(/\s+/g, '')
  const normalizedTermId = termId.trim().toLowerCase()
  const normalizedProvider = providerCode.trim().toLowerCase()
  const genericLabels = new Set([
    `学期${normalizedTermId}`,
    `term${normalizedTermId}`,
    `semester${normalizedTermId}`,
  ])

  if (normalizedProvider) {
    genericLabels.add(`${normalizedProvider}学期${normalizedTermId}`)
    genericLabels.add(`${normalizedProvider}:学期${normalizedTermId}`)
  }

  return genericLabels.has(normalizedLabel)
}

function formatProviderTermId(providerCode: string, termId: string) {
  const normalizedProvider = providerCode.trim().toLowerCase()
  const cleanTermId = termId.trim()
  const wtbuMatch = cleanTermId.match(/^(\d{2})([123])$/)

  if (normalizedProvider === 'wtbu' && wtbuMatch) {
    const yearStart = 2000 + Number(wtbuMatch[1])
    return `${yearStart}-${yearStart + 1}学年第${wtbuMatch[2]}学期`
  }

  const bwuMatch = cleanTermId.match(/^\d{3}$/)

  if (normalizedProvider === 'bwu' && bwuMatch) {
    const numericTermId = Number(cleanTermId)
    const yearStart = 2000 + Math.floor((numericTermId - 571) / 2)
    const semester = numericTermId % 2 === 0 ? 2 : 1

    if (yearStart >= 2000 && yearStart <= 2099) {
      return `${yearStart}-${yearStart + 1}学年第${semester}学期`
    }
  }

  return ''
}

function getTermDisplaySortKey(label: string, termId: string, providerCode = '') {
  const text = `${label || ''} ${termId || ''}`
  const academicMatch = text.match(/(20\d{2})\s*[-~—至]\s*(20\d{2}).*第?\s*([123一二三])\s*学期/)
  const semesterMap: Record<string, number> = { 一: 1, 二: 2, 三: 3 }

  if (academicMatch) {
    return Number(academicMatch[1]) * 10 + (semesterMap[academicMatch[3]] || Number(academicMatch[3]) || 0)
  }

  const key = getTermDisplayKey(termId, providerCode)
  const providerMatch = key.match(/^(\d{2})([123])$/)

  if (providerMatch) {
    return (2000 + Number(providerMatch[1])) * 10 + Number(providerMatch[2])
  }

  return Number.NEGATIVE_INFINITY
}

function isBetterTermDisplayLabel(nextLabel: string, currentLabel: string, nextId: string, currentId: string) {
  const nextLooksAcademic = /20\d{2}.*20\d{2}.*学期/.test(nextLabel)
  const currentLooksAcademic = /20\d{2}.*20\d{2}.*学期/.test(currentLabel)

  if (nextLooksAcademic !== currentLooksAcademic) return nextLooksAcademic
  if (nextLabel !== nextId && currentLabel === currentId) return true
  return nextLabel.length > currentLabel.length
}

function termRowsToRecord(rows: TermStartRow[]) {
  return rows.reduce<Record<string, string>>((record, row) => {
    const termId = row.termId.trim()
    const startDate = row.startDate.trim()
    if (termId && startDate) record[termId] = startDate
    return record
  }, {})
}

function createEmptyProviderDraft(): ProviderDraft {
  return {
    providerId: '',
    loginMode: 'direct_password',
    sectionTimes: [],
    sectionTimeProfiles: [],
  }
}

function createSectionTimeRows(sectionTimes: unknown): SectionTimeRow[] {
  const source = Array.isArray(sectionTimes) ? sectionTimes as Array<Partial<SectionTimeItem>> : []
  const rows = source
    .map((item) => ({
      id: `section-${String(item.section || '')}-${String(item.start || '')}-${String(item.end || '')}`,
      section: item.section ? String(item.section) : '',
      start: String(item.start || ''),
      end: String(item.end || ''),
    }))
    .filter((row) => row.section || row.start || row.end)

  return rows.length
    ? rows
    : Array.from({ length: 12 }, (_, index) => ({
      id: `section-empty-${index + 1}`,
      section: String(index + 1),
      start: '',
      end: '',
    }))
}

function sectionRowsToItems(rows: SectionTimeRow[]) {
  return rows
    .map((row) => ({
      section: Number(row.section),
      start: row.start.trim(),
      end: row.end.trim(),
    }))
    .filter((item) => Number.isInteger(item.section) && item.section > 0 && item.start && item.end)
    .sort((left, right) => left.section - right.section)
}

function normalizeSectionTimeValue(value: string) {
  const match = value.trim().match(/^(\d{1,2})\s*:\s*(\d{2})$/)

  if (!match) return ''

  const hour = Number(match[1])
  const minute = Number(match[2])

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return ''
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseSectionTimeImportRows(value: string): SectionTimeRow[] {
  const matches = [...value.matchAll(/(\d{1,2}\s*:\s*\d{2})\s*[-~—至到]\s*(\d{1,2}\s*:\s*\d{2})/g)]

  return matches
    .map((match, index) => ({
      id: `section-import-${Date.now()}-${index}`,
      section: String(index + 1),
      start: normalizeSectionTimeValue(match[1]),
      end: normalizeSectionTimeValue(match[2]),
    }))
    .filter((row) => row.start && row.end)
}

function createSectionTimeProfileRows(profiles: unknown): SectionTimeProfileRow[] {
  const source = Array.isArray(profiles) ? profiles as Array<Partial<SectionTimeProfile>> : []

  return source
    .map((profile, index) => {
      const profileId = String(profile.id || `profile-${index + 1}`).trim()

      return {
        id: `time-profile-${profileId}-${index}`,
        profileId,
        name: String(profile.name || profileId).trim(),
        buildingKeywords: Array.isArray(profile.buildingKeywords)
          ? profile.buildingKeywords.join(', ')
          : '',
        sectionRows: createSectionTimeRows(profile.sectionTimes || []),
      }
    })
    .filter((profile) => profile.profileId || profile.name || profile.buildingKeywords || sectionRowsToItems(profile.sectionRows).length > 0)
}

function createSingleBuildingProfileRows(profiles: unknown, buildings: CourseBuildingItem[] = []): SectionTimeProfileRow[] {
  const sourceRows = createSectionTimeProfileRows(profiles)
  const rows: SectionTimeProfileRow[] = []
  const usedBuildingKeys = new Set<string>()

  const addProfile = (source: SectionTimeProfileRow, sourceIndex: number, buildingName: string) => {
    const name = buildingName.trim()
    const key = normalizeBuildingKeyword(name)

    if (!name || usedBuildingKeys.has(key)) return

    rows.push({
      ...source,
      id: `${source.id}-building-${key || rows.length}`,
      profileId: source.profileId.trim()
        ? getUniqueProfileId(source.profileId.trim(), rows)
        : getUniqueProfileId(createSectionTimeProfileId(name, rows.length), rows),
      name,
      sectionRows: source.sectionRows.map((row, rowIndex) => ({
        ...row,
        id: `${row.id}-${key || sourceIndex}-${rowIndex}`,
      })),
    })
    usedBuildingKeys.add(key)
  }

  buildings.forEach((building) => {
    const name = building.name.trim()
    const key = normalizeBuildingKeyword(name)
    const sourceIndex = sourceRows.findIndex((profile) =>
      [profile.name, ...splitBuildingKeywords(profile.buildingKeywords)]
        .some((keyword) => normalizeBuildingKeyword(keyword) === key),
    )

    if (sourceIndex >= 0) {
      addProfile(sourceRows[sourceIndex], sourceIndex, name)
    }
  })

  sourceRows.forEach((profile, profileIndex) => {
    if (profile.name.trim()) {
      addProfile(profile, profileIndex, profile.name)
      return
    }

    if (sectionRowsToItems(profile.sectionRows).length > 0) {
      addProfile(profile, profileIndex, getProfileDisplayName(profile, profileIndex))
    }
  })

  return rows
}

function createSectionTimeProfileRow(
  index: number,
  sectionTimes: SectionTimeItem[],
  buildingName = '',
): SectionTimeProfileRow {
  const name = buildingName.trim()

  return {
    id: `time-profile-new-${Date.now()}-${index}`,
    profileId: name ? createSectionTimeProfileId(name, index) : '',
    name,
    buildingKeywords: name,
    sectionRows: createSectionTimeRows(sectionTimes),
  }
}

function createSectionTimeProfileId(value: string, index: number) {
  const asciiSlug = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  if (asciiSlug) {
    return `building-${asciiSlug}`
  }

  const codeSlug = Array.from(value.trim())
    .map((char) => char.codePointAt(0)?.toString(36))
    .filter(Boolean)
    .slice(0, 8)
    .join('-')

  return `building-${codeSlug || index + 1}`
}

function normalizeBuildingKeyword(value: string) {
  return value.replace(/\s+/g, '').toLocaleLowerCase()
}

function splitBuildingKeywords(value: string) {
  return [...new Set(
    value
      .split(/[,;，、\n]/)
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  )]
}

function profileRowsToItems(rows: SectionTimeProfileRow[]) {
  return rows
    .map((row, index) => {
      const rowName = row.name.trim()
      const buildingKeywords = splitBuildingKeywords(row.buildingKeywords || rowName)
      const name = rowName || buildingKeywords[0] || `楼栋时间 ${index + 1}`
      const id = row.profileId.trim() || createSectionTimeProfileId(name, index)

      return {
        id,
        name,
        buildingKeywords,
        sectionTimes: sectionRowsToItems(row.sectionRows),
      }
    })
    .filter((profile) => profile.id && profile.name && profile.buildingKeywords.length > 0 && profile.sectionTimes.length > 0)
}

function getProfileDisplayName(row: SectionTimeProfileRow, index: number) {
  return row.name.trim() || splitBuildingKeywords(row.buildingKeywords)[0] || `楼栋时间 ${index + 1}`
}

function getUniqueProfileId(profileId: string, rows: SectionTimeProfileRow[]) {
  const usedIds = new Set(rows.map((row) => row.profileId.trim()).filter(Boolean))

  if (!usedIds.has(profileId)) {
    return profileId
  }

  let suffix = 2
  let nextId = `${profileId}-${suffix}`

  while (usedIds.has(nextId)) {
    suffix += 1
    nextId = `${profileId}-${suffix}`
  }

  return nextId
}

function getSchoolProviderCode(school?: SchoolItem) {
  return school?.providerId || school?.id || ''
}

function getSubmissionStatusCounts(items: SubmissionItem[]) {
  return items.reduce<Record<SubmissionStatus, number>>(
    (counts, item) => {
      const status = item.status === 'submitted' || item.status === 'disabled' ? item.status : 'candidate'
      counts[status] += 1
      return counts
    },
    {
      submitted: 0,
      candidate: 0,
      disabled: 0,
    },
  )
}

function getSubmissionGroupSummary(items: SubmissionItem[]) {
  const counts = getSubmissionStatusCounts(items)
  const parts = [
    counts.submitted ? `${counts.submitted} 待审核` : '',
    counts.disabled ? `${counts.disabled} 已驳回` : '',
    counts.candidate ? `${counts.candidate} 已通过` : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '暂无状态'
}

function getPendingSubmissions(items: SubmissionItem[]) {
  return items.filter((item) => item.status === 'submitted')
}

function getSubmissionStatusLabel(status: string) {
  if (status === 'submitted') return '待审核'
  if (status === 'disabled') return '已驳回'
  if (status === 'candidate') return '已通过'
  return status
}

async function copyText(value: string) {
  if (!value) return

  try {
    await navigator.clipboard.writeText(value)
    return
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
}

function NavButton(props: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={'nav-button' + (props.active ? ' active' : '')} type="button" onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  )
}

function StatusLine({ status }: { status: StatusMessage }) {
  return <div className={'status-line visible ' + (status.type === 'error' ? 'error' : '')}>{status.text}</div>
}

function MetricGrid({ stats }: { stats: AdminStats | null }) {
  const pendingSubmissions = stats?.pendingSubmissions ?? 0
  const pendingFeedback = stats?.pendingFeedback ?? 0

  return (
    <section className="metric-grid" aria-label="关键指标">
      <Metric label="开放学校" value={stats?.schools.enabled} foot={`共 ${stats?.schools.total ?? '--'} 所学校，已开放学生可直接使用`} tone="green" />
      <Metric label="学生账号" value={stats?.accounts} foot="当前数据库中可用的学生账号总量" tone="blue" />
      <Metric label="待审接入" value={pendingSubmissions} foot="等待人工确认的新学校接入申请" tone={pendingSubmissions ? 'amber' : 'green'} />
      <Metric label="待处理反馈" value={pendingFeedback} foot="包含用户问题、建议与学校异常告警" tone={pendingFeedback ? 'red' : 'green'} />
    </section>
  )
}

function Metric({ label, value, foot, tone = 'blue' }: { label: string; value?: number; foot: string; tone?: string }) {
  return <StatCard label={label} value={value ?? '--'} foot={foot} tone={tone as 'blue' | 'green' | 'amber' | 'red'} />
}

function Panel({ children }: { children: React.ReactNode }) {
  return <Card className="panel">{children}</Card>
}

function PanelHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <header className={'panel-header' + (actions ? ' has-actions' : '')}>
      <div>
        <h2>{title}</h2>
        <div className="panel-description">{description}</div>
      </div>
      {actions && <div className="row-actions">{actions}</div>}
    </header>
  )
}

function Overview({
  stats,
  onRefresh,
  onOpenSchoolAlerts,
}: {
  stats: AdminStats | null
  onRefresh: () => void
  onOpenSchoolAlerts: () => void
}) {
  const pendingSchoolAlerts = stats?.pendingSchoolAlerts ?? 0
  const tasks = getPendingTaskCards(stats)
  const enabledSchools = stats?.schools.enabled ?? 0
  const totalSchools = stats?.schools.total ?? 0

  return (
    <Panel>
      <PanelHeader
        title="今天先处理什么"
        description="按影响用户的程度排序。先处理异常和申请，再检查反馈和通知。"
        actions={<button className="button secondary" type="button" onClick={onRefresh}><RefreshCw size={16} />刷新统计</button>}
      />
      {pendingSchoolAlerts > 0 && (
        <div className="priority-alert">
          <div>
            <strong>学校异常告警</strong>
            <span>{pendingSchoolAlerts} 条导入或同步异常待处理，可先停用对应学校并排查学校网站/云函数。</span>
          </div>
          <button className="button primary" type="button" onClick={onOpenSchoolAlerts}>
            <TriangleAlert size={16} />
            查看告警
          </button>
        </div>
      )}
      <div className="overview-grid">
        <div className="task-board" aria-label="运营待办">
          {tasks.map((task) => (
            <article className={'task-card ' + task.tone} key={task.title}>
              <div className="task-card-main">
                <div className="task-title">{task.title}</div>
                <div className="task-detail">{task.detail}</div>
              </div>
              <div className="task-count">{task.count}</div>
              {task.title === '学校异常告警' && task.count > 0 && (
                <button className="button primary task-action" type="button" onClick={onOpenSchoolAlerts}>
                  <TriangleAlert size={16} />
                  处理告警
                </button>
              )}
            </article>
          ))}
        </div>
        <aside className="operator-guide">
          <h3>日常处理顺序</h3>
          <ol>
            <li>先看学校异常，影响学生导入或同步时及时停用学校。</li>
            <li>再审核接入申请，确认学校名称、地区和教务系统链接。</li>
            <li>最后处理普通反馈，能解决的设为已处理，暂不处理的设为已忽略或归档。</li>
          </ol>
          <div className="detail-list compact">
            <DetailItem label="学校开放情况" value={`${enabledSchools} / ${totalSchools} 所学校已开放`} />
            <DetailItem label="通知检查" value={`${stats?.activeNotifications ?? 0} 条通知仍在生效`} />
          </div>
        </aside>
      </div>
    </Panel>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  )
}

function SchoolsView(props: {
  schools: PageResult<SchoolItem>
  filters: SchoolFilters
  onFiltersChange: React.Dispatch<React.SetStateAction<SchoolFilters>>
  onPage: (offset: number) => void
  onToggle: (school: SchoolItem) => void
  onOpenTerm: (school: SchoolItem) => void
  onOpenProvider: (school: SchoolItem) => void
  onOpenWeather: (school: SchoolItem) => void
  onOpenFeedback: (school: SchoolItem) => void
  onOpenUsers: (school: SchoolItem) => void
  onNotify: (school: SchoolItem) => void
}) {
  const [expandedSchoolId, setExpandedSchoolId] = useState<string | null>(null)
  const updateFilters = (patch: Partial<SchoolFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }
  const sortedSchools = useMemo(() => {
    const items = [...props.schools.items]

    if (props.filters.sortBy !== 'userCount') {
      return items
    }

    return items.sort((left, right) => {
      const enabledDiff = Number(right.enabled) - Number(left.enabled)
      if (enabledDiff) return enabledDiff
      if (!left.enabled && !right.enabled) {
        return left.status.localeCompare(right.status) || left.name.localeCompare(right.name, 'zh-CN')
      }

      return compareByOrder(left.userCount ?? 0, right.userCount ?? 0, props.filters.sortOrder) ||
        left.name.localeCompare(right.name, 'zh-CN')
    })
  }, [props.schools.items, props.filters.sortBy, props.filters.sortOrder])
  const enabledCount = props.schools.items.filter((school) => school.enabled).length

  return (
    <Panel>
      <PanelHeader
        title="学校列表"
        description={viewMeta.schools.description}
        actions={<div className="panel-count">本页 {props.schools.items.length} 所，已开放 {enabledCount} 所</div>}
      />
      <div className="panel-tools">
        <label className="field grow">
          <span>学校关键词</span>
          <input
            value={props.filters.keyword}
            placeholder="学校名称、省份、城市或 ID"
            onChange={(event) => updateFilters({ keyword: event.target.value })}
          />
        </label>
        <SelectField
          label="学校状态"
          value={props.filters.status}
          options={[['', '全部'], ...SCHOOL_STATUS_OPTIONS]}
          onChange={(status) => updateFilters({ status })}
        />
        <SelectField
          label="启用情况"
          value={props.filters.enabled}
          options={[
            ['', '全部'],
            ['true', '已启用'],
            ['false', '未启用'],
          ]}
          onChange={(enabled) => updateFilters({ enabled })}
        />
        <SelectField
          label="排序"
          value={getSortValue(props.filters.sortBy, props.filters.sortOrder)}
          options={[
            ['', '默认'],
            ['userCount:desc', '使用人数倒序'],
            ['userCount:asc', '使用人数顺序'],
          ]}
          onChange={(value) => updateFilters(parseSortValue(value))}
        />
      </div>

      {props.schools.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>学校信息</th>
                <th>开放状态</th>
                <th>学生数</th>
                <th>时间配置</th>
                <th>天气位置</th>
                <th>默认首周</th>              </tr>
            </thead>
            <tbody>
              {sortedSchools.map((school) => {
                const sectionCount = school.sectionTimes?.length || 0
                const profileCount = school.sectionTimeProfiles?.length || 0
                const hasSectionTimeConfig = sectionCount > 0 || profileCount > 0
                const weatherDisplayName = getSchoolWeatherDisplayName(school)
                const isExpanded = expandedSchoolId === school.id

                return (
                  <Fragment key={school.id}>
                    <tr
                      className="school-row"
                      onClick={(event) => {
                      const target = event.target as HTMLElement
                      if (target.closest('button, a, input, select, textarea, [role="button"]')) return
                      setExpandedSchoolId(isExpanded ? null : school.id)
                    }}
                  >
                    <td className="school-name-cell">
                      <button
                        className="school-expand-button"
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={(event) => {
                          event.stopPropagation()
                          setExpandedSchoolId(isExpanded ? null : school.id)
                        }}
                      >
                        <span className="cell-title">{school.name}</span>
                        <ChevronDown size={16} />
                      </button>
                      <div className="cell-meta">{joinFilled([school.id, school.shortName, school.province, school.city])}</div>
                    </td>
                    <td>
                      <Badge tone={school.enabled ? 'green' : 'red'}>{school.enabled ? '已启用' : '未启用'}</Badge>
                      <div className="cell-meta">{getSchoolStatusLabel(school.status)}</div>
                    </td>
                    <td>
                      <div className="count-cell">
                        <button className="count-link" type="button" title={`${school.userCount ?? 0}`} onClick={(event) => {
                          event.stopPropagation()
                          props.onOpenUsers(school)
                        }}>
                          {displayCount(school.userCount)}
                        </button>
                        <span>查看学生</span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={hasSectionTimeConfig ? 'green' : 'amber'}>{hasSectionTimeConfig ? '已配置' : '未配置'}</Badge>
                      <div className="cell-meta">{sectionCount ? `通用 ${sectionCount} 节` : '通用时间未配置'}{profileCount ? ` / 楼栋 ${profileCount} 组` : ''}</div>
                    </td>
                    <td>
                      <Badge tone={school.weatherLocation ? 'green' : 'amber'}>{school.weatherLocation ? '已启用' : '未启用'}</Badge>
                      <div className="cell-meta">{weatherDisplayName}</div>
                    </td>
                    <td>
                      <SchoolTermStartCell school={school} />
                    </td>
                    </tr>
                    {isExpanded && (
                      <tr className="school-action-row" key={`${school.id}-actions`}>
                        <td colSpan={6}>
                          <div className="row-actions school-actions" onClick={(event) => event.stopPropagation()}>
                            <button className={'button ' + (school.enabled ? 'danger' : 'secondary')} type="button" onClick={() => props.onToggle(school)}>
                              {school.enabled ? <PowerOff size={16} /> : <Power size={16} />}
                              {school.enabled ? '停用' : '启用'}
                            </button>
                            <button className="button secondary" type="button" onClick={() => props.onOpenTerm(school)}><CalendarDays size={16} />首周</button>
                            <button className="button secondary" type="button" onClick={() => props.onOpenProvider(school)}><Settings2 size={16} />上课时间</button>
                            <button className="button secondary" type="button" onClick={() => props.onOpenWeather(school)}><CloudSun size={16} />天气</button>
                            <button className="button secondary" type="button" onClick={() => props.onOpenFeedback(school)}><MessageSquareWarning size={16} />反馈</button>
                            <button className="button secondary" type="button" onClick={() => props.onNotify(school)}><Bell size={16} />通知</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">没有匹配的学校。</div>}
      <Pagination page={props.schools} offset={props.filters.offset} pageSize={SCHOOL_PAGE_SIZE} onPage={props.onPage} />
    </Panel>
  )
}

function SchoolTermStartCell({ school }: { school: SchoolItem }) {
  const entries = getTermStartDisplayOptions(school)
  const primaryLabel = getPrimaryTermStartDisplay(school)
  const [selectedTermId, setSelectedTermId] = useState(() => entries[0]?.termId || '')
  const selectedEntry = entries.find((entry) => entry.termId === selectedTermId) || entries[0]
  const displayValue = selectedEntry
    ? `${selectedEntry.label}: ${selectedEntry.date || '未配置'}`
    : primaryLabel

  return (
    <div className="term-start-cell">
      <div className="term-start-main">
        <div className="cell-title">{displayValue}</div>
        <div className="cell-meta">{school.sectionTimes?.length ? `上课时间：${school.sectionTimes.length} 节` : '上课时间未配置'}</div>
      </div>
      {entries.length > 1 && (
        <label className="term-start-picker">
          <span>学期</span>
          <select value={selectedEntry?.termId || ''} onChange={(event) => setSelectedTermId(event.target.value)}>
            {entries.map((entry) => (
              <option value={entry.termId} key={entry.termId}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

function UsersView(props: {
  data: PageResult<UserItem>
  filters: UserFilters
  onFiltersChange: React.Dispatch<React.SetStateAction<UserFilters>>
  onPage: (offset: number) => void
  onNotify: (user: UserItem) => void
}) {
  const updateFilters = (patch: Partial<UserFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }
  const normalCount = props.data.items.filter((item) => item.status === 'active').length

  return (
    <Panel>
      <PanelHeader
        title="学生账号"
        description={viewMeta.users.description}
        actions={<div className="panel-count">本页 {props.data.items.length} 个账号，正常 {normalCount} 个</div>}
      />
      <div className="panel-tools">
        <label className="field grow">
          <span>学校筛选</span>
          <input
            value={props.filters.schoolKeyword}
            placeholder="输入学校名称或简称"
            onChange={(event) => updateFilters({ schoolId: '', schoolKeyword: event.target.value })}
          />
        </label>
        <label className="field grow">
          <span>用户关键词</span>
          <input
            value={props.filters.keyword}
            placeholder="姓名、学号、专业、联系方式"
            onChange={(event) => updateFilters({ keyword: event.target.value })}
          />
        </label>
        <SelectField
          label="账号状态"
          value={props.filters.status}
          options={[
            ['', '全部'],
            ['active', '正常可用'],
            ['need_login', '需要重新登录'],
            ['cached_only', '仅有缓存'],
            ['disabled', '已停用'],
            ['unbound', '已解绑'],
          ]}
          onChange={(status) => updateFilters({ status })}
        />
        {(props.filters.schoolKeyword || props.filters.keyword || props.filters.status) && (
          <button className="button secondary" type="button" onClick={() => props.onFiltersChange({ keyword: '', schoolId: '', schoolKeyword: '', status: '', offset: 0 })}>
            <X size={16} />
            清除筛选
          </button>
        )}
      </div>
      {props.data.items.length ? (
        <div className="table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>学生</th>
                <th>联系方式</th>
                <th>学校</th>
                <th>班级专业</th>
                <th>账号状态</th>
                <th>账号来源</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="cell-title">{display(item.student?.name || item.displayName || item.id)}</div>
                    <div className="cell-meta">{joinFilled([item.student?.studentNo, item.student?.grade, item.student?.className])}</div>
                  </td>
                  <td>
                    {displayUserContact(item.contact)}
                  </td>
                  <td>
                    <div className="cell-title">{display(item.school?.name || item.schoolId)}</div>
                    <div className="cell-meta">{joinFilled([item.school?.shortName, item.schoolId])}</div>
                  </td>
                  <td>
                    <div className="cell-title">{display(item.student?.major)}</div>
                    <div className="cell-meta">{joinFilled([item.student?.level, item.student?.className])}</div>
                  </td>
                  <td>
                    <Badge tone={statusTone(item.status)}>{getAccountStatusLabel(item.status)}</Badge>
                    <div className="cell-meta">{item.lastLoginAt ? `最近登录 ${formatDate(item.lastLoginAt)}` : `创建 ${formatDate(item.createdAt)}`}</div>
                  </td>
                  <td>
                    <div className="cell-title">{display(item.providerId)}</div>
                    <div className="cell-meta">{item.id}</div>
                  </td>
                  <td>
                    <button className="button secondary" type="button" onClick={() => props.onNotify(item)}>
                      <Bell size={16} />
                      发送通知
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">没有匹配的用户。</div>}
      <Pagination page={props.data} offset={props.filters.offset} onPage={props.onPage} />
    </Panel>
  )
}

function SubmissionsView(props: {
  data: PageResult<SubmissionItem>
  filters: SubmissionFilters
  onFiltersChange: React.Dispatch<React.SetStateAction<SubmissionFilters>>
  onPage: (offset: number) => void
  onUpdate: (schoolName: string, items: SubmissionItem[], status: string) => void
  onOpen: (item: SubmissionItem) => void
  onDelete: (item: SubmissionItem) => void
  onDeleteGroup: (items: SubmissionItem[]) => void
}) {
  const updateFilters = (patch: Partial<SubmissionFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }

  const groups = useMemo(() => {
    const keyword = normalizeSearchText(props.filters.keyword)
    const groupMap = new Map<string, { key: string; schoolName: string; items: SubmissionItem[] }>()

    props.data.items.forEach((item) => {
      const key = getSubmissionSchoolKey(item)
      const group = groupMap.get(key) || { key, schoolName: item.schoolName, items: [] }
      group.items.push(item)
      groupMap.set(key, group)
    })

    return Array.from(groupMap.values())
      .filter((group) => group.items.some((item) => matchesSubmissionKeyword(item, keyword)))
      .sort((a, b) => {
        const pendingDiff = Number(getPendingSubmissions(b.items).length > 0) - Number(getPendingSubmissions(a.items).length > 0)
        if (pendingDiff) return pendingDiff

        if (props.filters.sortBy === 'requestCount') {
          return compareByOrder(a.items.length, b.items.length, props.filters.sortOrder) ||
            a.schoolName.localeCompare(b.schoolName, 'zh-CN')
        }

        const mode = props.filters.sortOrder === 'asc' ? 'min' : 'max'
        return compareByOrder(getSubmissionGroupTime(a, mode), getSubmissionGroupTime(b, mode), props.filters.sortOrder) ||
          a.schoolName.localeCompare(b.schoolName, 'zh-CN')
      })
  }, [props.data.items, props.filters.keyword, props.filters.sortBy, props.filters.sortOrder])
  const pendingGroupCount = groups.filter((group) => getPendingSubmissions(group.items).length > 0).length

  return (
    <Panel>
      <PanelHeader
        title="学校接入申请"
        description={viewMeta.submissions.description}
        actions={<div className="panel-count">本页 {groups.length} 所学校，{pendingGroupCount} 所待审核</div>}
      />
      <div className="panel-tools">
        <label className="field grow">
          <span>学校搜索</span>
          <input
            value={props.filters.keyword}
            placeholder="输入学校名称、省份、城市或教务系统网址"
            onChange={(event) => updateFilters({ keyword: event.target.value })}
          />
        </label>
        <SelectField
          label="接入状态"
          value={props.filters.status}
          options={SUBMISSION_STATUS_OPTIONS}
          onChange={(status) => updateFilters({ status })}
        />
        <SelectField
          label="验证方式"
          value={props.filters.extraVerification}
          options={[['', '全部'], ...SUBMISSION_EXTRA_VERIFICATION_OPTIONS.map((value) => [value, value] as const)]}
          onChange={(extraVerification) => updateFilters({ extraVerification })}
        />
        <SelectField
          label="协助意愿"
          value={props.filters.adaptationHelp}
          options={[['', '全部'], ...SUBMISSION_ADAPTATION_HELP_OPTIONS.map((value) => [value, value] as const)]}
          onChange={(adaptationHelp) => updateFilters({ adaptationHelp })}
        />
        <SelectField
          label="排序"
          value={getSortValue(props.filters.sortBy, props.filters.sortOrder)}
          options={[
            ['', '最新申请'],
            ['createdAt:asc', '最早申请'],
            ['requestCount:desc', '申请人数倒序'],
            ['requestCount:asc', '申请人数顺序'],
          ]}
          onChange={(value) => updateFilters(parseSortValue(value))}
        />
      </div>
      {groups.length ? (
        <div className="submission-groups">
          {groups.map((group) => (
            <SubmissionSchoolGroup
              key={group.key}
              group={group}
              onUpdate={props.onUpdate}
              onOpen={props.onOpen}
              onDelete={props.onDelete}
              onDeleteGroup={props.onDeleteGroup}
            />
          ))}
        </div>
      ) : <div className="empty">没有匹配的接入申请。</div>}
      <Pagination page={props.data} offset={props.filters.offset} pageSize={SUBMISSION_PAGE_SIZE} onPage={props.onPage} />
    </Panel>
  )
}

function SubmissionSchoolGroup(props: {
  group: { key: string; schoolName: string; items: SubmissionItem[] }
  onUpdate: (schoolName: string, items: SubmissionItem[], status: string) => void
  onOpen: (item: SubmissionItem) => void
  onDelete: (item: SubmissionItem) => void
  onDeleteGroup: (items: SubmissionItem[]) => void
}) {
  const pendingItems = getPendingSubmissions(props.group.items)
  const canDeleteGroup = props.group.items.length > 0 && props.group.items.every((item) => item.status === 'disabled')
  const statusSummary = getSubmissionGroupSummary(props.group.items)
  const updatePending = (status: string) => {
    props.onUpdate(props.group.schoolName, pendingItems, status)
  }

  return (
    <section className="submission-school-group">
      <header className="submission-school-header">
        <div>
          <div className="submission-school-title-row">
            <h3>{props.group.schoolName}</h3>
            <Badge tone="amber">{props.group.items.length} 人申请</Badge>
          </div>
          <div className="submission-school-meta">
            <span>同一学校的申请会合并在一起处理</span>
            <span>{statusSummary}</span>
          </div>
        </div>
        <div className="submission-school-actions">
          <Badge tone={pendingItems.length ? 'amber' : ''}>
            {pendingItems.length ? `${pendingItems.length} 条待审核` : '已处理'}
          </Badge>
          <div className="row-actions">
            <button className="button secondary" type="button" disabled={!pendingItems.length} onClick={() => updatePending('candidate')}><Check size={16} />通过</button>
            <button className="button danger" type="button" disabled={!pendingItems.length} onClick={() => updatePending('disabled')}><X size={16} />驳回</button>
            {canDeleteGroup && (
              <button className="button danger" type="button" onClick={() => props.onDeleteGroup(props.group.items)}><Trash2 size={16} />删除分组</button>
            )}
          </div>
        </div>
      </header>
      <div className="submission-list">
        {props.group.items.map((item) => (
          <SubmissionCard
            key={item.id}
            item={item}
            onOpen={props.onOpen}
            onDelete={props.onDelete}
          />
        ))}
      </div>
    </section>
  )
}

function SubmissionCard(props: {
  item: SubmissionItem
  onOpen: (item: SubmissionItem) => void
  onDelete: (item: SubmissionItem) => void
}) {
  const website = props.item.eduSystemWebsite || props.item.loginUrl || props.item.officialWebsite || ''
  const jump = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!website) return
    window.open(website, '_blank', 'noopener,noreferrer')
  }
  const remove = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    props.onDelete(props.item)
  }

  return (
    <article className={'submission-card ' + statusTone(props.item.status)} role="button" tabIndex={0} onClick={() => props.onOpen(props.item)} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        props.onOpen(props.item)
      }
    }}>
      <div className="submission-card-body">
        <div className="submission-card-head">
          <Badge tone={statusTone(props.item.status)}>{getSubmissionStatusLabel(props.item.status)}</Badge>
          <span>{formatDate(props.item.createdAt)}</span>
        </div>
        <div className="submission-link">{website || '未填写教务链接'}</div>
        <div className="submission-card-meta">
          {display(joinFilled([props.item.province, props.item.city]), '省市未填写')}
        </div>
      </div>
      <div className="submission-card-actions">
        <button className="button ghost icon-button" type="button" title="打开链接" aria-label="打开链接" disabled={!website} onClick={jump}><ExternalLink size={16} /></button>
        {props.item.status === 'disabled' && (
          <button className="button danger icon-button" type="button" title="删除申请" aria-label="删除申请" onClick={remove}><Trash2 size={16} /></button>
        )}
      </div>
    </article>
  )
}

function SubmissionDetail({ item }: { item: SubmissionItem }) {
  const formInfo = parseSubmissionNote(item.note)
  const website = item.eduSystemWebsite || item.loginUrl || item.officialWebsite || ''
  return (
    <div className="submission-detail">
      <div className="detail-list detail-list-grid">
        <DetailItem label="学校名称" value={item.schoolName} />
        <DetailItem label="接入状态" value={getSubmissionStatusLabel(item.status)} />
        <DetailItem label="省市" value={display(joinFilled([item.province, item.city]))} />
        <DetailItem label="教务系统网址" value={display(website)} />
        <DetailItem label="官网" value={display(item.officialWebsite)} />
        <DetailItem label="登录地址" value={display(item.loginUrl)} />
        <DetailItem label="验证方式" value={display(formInfo.extraVerification)} />
        <DetailItem label="协助意愿" value={display(formInfo.adaptationHelp)} />
        <DetailItem label="联系方式" value={display(formInfo.contact)} />
        <DetailItem label="申请时间" value={formatDate(item.createdAt)} />
        <DetailItem label="备注" value={display(formInfo.note)} />
        <DetailItem label="申请能力" value={(item.requestedTargets || []).map(targetLabel).join(' / ') || '--'} />
      </div>
      <pre className="json-output">{JSON.stringify(item, null, 2)}</pre>
    </div>
  )
}

function FeedbackView(props: {
  data: PageResult<FeedbackItem>
  filters: FeedbackFilters
  selected: FeedbackItem | null
  onFiltersChange: React.Dispatch<React.SetStateAction<FeedbackFilters>>
  onPage: (offset: number) => void
  onSelect: (item: FeedbackItem) => void
  onUpdateStatus: (item: FeedbackItem, status: string) => void
  onDelete: (item: FeedbackItem) => void
  onShowJson: (item: FeedbackItem) => void
}) {
  const [customStatus, setCustomStatus] = useState('')
  const updateFilters = (patch: Partial<FeedbackFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }
  const selected = props.selected
  const selectedSchool = selected
    ? display(selected.account?.school?.name || selected.school?.name || selected.schoolId)
    : '--'
  const selectedStudent = selected
    ? joinFilled([
      selected.student?.name,
      selected.student?.studentNo,
      selected.student?.grade,
      selected.student?.major,
      selected.student?.className,
      selected.student?.level,
    ]) || '--'
    : '--'
  const selectedAccount = selected
    ? joinFilled([selected.account?.displayName, selected.accountId]) || '--'
    : '--'
  const pendingCount = props.data.items.filter((item) => item.status === 'pending').length

  return (
    <div className="split-grid feedback-workspace">
      <Panel>
        <PanelHeader
          title="反馈列表"
          description={viewMeta.feedback.description}
          actions={<div className="panel-count">本页 {props.data.items.length} 条，待处理 {pendingCount} 条</div>}
        />
        <div className="panel-tools">
          <label className="field grow">
            <span>学校名称</span>
            <input
              value={props.filters.schoolKeyword}
              placeholder="输入学校名称，例如 武汉工商学院"
              onChange={(event) => updateFilters({ schoolKeyword: event.target.value })}
            />
          </label>
          <SelectField
            label="状态"
            value={props.filters.status}
            options={FEEDBACK_STATUS_OPTIONS}
            onChange={(status) => updateFilters({ status })}
          />
          <SelectField
            label="类型"
            value={props.filters.type}
            options={[['', '全部'], ['school_import_alert', '学校异常告警'], ['experience', '体验反馈'], ['bug', '问题反馈'], ['suggestion', '功能建议']]}
            onChange={(type) => updateFilters({ type })}
          />
          {props.filters.schoolKeyword && (
            <button className="button secondary" type="button" onClick={() => updateFilters({ schoolKeyword: '' })}>
              <X size={16} />
              清除学校
            </button>
          )}
        </div>
        {props.data.items.length ? (
          <div className="feedback-list">
            {props.data.items.map((item) => {
              const active = props.selected?.id === item.id
              return (
                <button
                  className={'feedback-row' + (active ? ' active' : '') + (item.type === 'school_import_alert' ? ' alert-row' : '')}
                  type="button"
                  key={item.id}
                  onClick={() => props.onSelect(item)}
                >
                  <span className="feedback-row-main">
                    <span className="feedback-row-title">
                      {getFeedbackTypeLabel(item.type)}
                      <Badge tone={statusTone(item.status)}>{getFeedbackStatusLabel(item.status)}</Badge>
                    </span>
                    <span className="feedback-row-content" title={display(item.content)}>
                      {display(item.content).slice(0, 120)}
                    </span>
                  </span>
                  <span className="feedback-row-side">
                    <span>{display(item.account?.school?.name || item.school?.name || item.schoolId)}</span>
                    <span>{display(item.student?.name || item.account?.displayName || item.accountId)}</span>
                    <span>{formatDate(item.createdAt)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : <div className="empty">没有匹配的用户反馈。</div>}
        <Pagination page={props.data} offset={props.filters.offset} onPage={props.onPage} />
      </Panel>
      <aside className="panel detail-panel feedback-detail-panel">
        <div className="detail-heading">
          <h2>反馈详情</h2>
          {selected && <Badge tone={statusTone(selected.status)}>{getFeedbackStatusLabel(selected.status)}</Badge>}
        </div>
        {selected ? (
          <div className="feedback-detail">
            <section className="feedback-detail-section primary">
              <div className="feedback-detail-section-head">
                <span>完整反馈内容</span>
                <Badge tone={selected.type === 'school_import_alert' ? 'red' : ''}>{getFeedbackTypeLabel(selected.type)}</Badge>
              </div>
              <div className="feedback-detail-content">{display(selected.content)}</div>
            </section>
            <div className="feedback-detail-grid">
              <DetailItem label="联系方式" value={display(selected.contact)} />
              <DetailItem label="提交时间" value={formatDate(selected.createdAt)} />
              <DetailItem label="学校" value={selectedSchool} />
              <DetailItem label="学生" value={selectedStudent} />
              <DetailItem label="账号" value={selectedAccount} />
              <DetailItem label="反馈 ID" value={selected.id} />
              <DetailItem label="学校 ID" value={display(selected.schoolId)} />
              <DetailItem label="账号状态" value={selected.account?.status ? getAccountStatusLabel(selected.account.status) : '--'} />
            </div>
            <div className="feedback-action-note">处理后请更新状态，列表里的待处理数量会同步减少。</div>
            <div className="feedback-detail-actions">
              <button className="button secondary detail-button" type="button" onClick={() => props.onUpdateStatus(selected, 'pending')}>
                <RefreshCw size={16} />
                设为待处理
              </button>
              <button className="button secondary detail-button" type="button" onClick={() => props.onUpdateStatus(selected, 'processed')}>
                <Check size={16} />
                设为已处理
              </button>
              <button className="button secondary detail-button" type="button" onClick={() => props.onUpdateStatus(selected, 'ignored')}>
                <X size={16} />
                设为已忽略
              </button>
              <button className="button secondary detail-button" type="button" onClick={() => props.onUpdateStatus(selected, 'archived')}>
                <Inbox size={16} />
                设为已归档
              </button>
              <label className="field detail-button">
                <span>其他状态</span>
                <input
                  value={customStatus}
                  placeholder="例如 follow_up"
                  onChange={(event) => setCustomStatus(event.target.value)}
                />
              </label>
              <button
                className="button secondary detail-button"
                type="button"
                disabled={!customStatus.trim()}
                onClick={() => {
                  props.onUpdateStatus(selected, customStatus)
                  setCustomStatus('')
                }}
              >
                <Save size={16} />
                保存状态
              </button>
              <button className="button secondary detail-button" type="button" onClick={() => props.onShowJson(selected)}>
                <FileJson size={16} />
                查看原始 JSON
              </button>
              <button className="button danger detail-button" type="button" onClick={() => props.onDelete(selected)}>
                <Trash2 size={16} />
                删除反馈
              </button>
            </div>
          </div>
        ) : <div className="empty">选择一条反馈查看详情。</div>}
      </aside>
    </div>
  )
}

function NotificationsView(props: {
  data: PageResult<NotificationItem>
  filters: NotificationFilters
  draft: NotificationDraft
  onFiltersChange: React.Dispatch<React.SetStateAction<NotificationFilters>>
  onDraftChange: React.Dispatch<React.SetStateAction<NotificationDraft>>
  onSubmit: (draft: NotificationDraft) => void
  onDeactivate: (item: NotificationItem) => void
  onPage: (offset: number) => void
}) {
  const updateFilters = (patch: Partial<NotificationFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }
  const setDraftValue = <K extends keyof NotificationDraft>(key: K, value: NotificationDraft[K]) => {
    props.onDraftChange((current) => ({ ...current, [key]: value }))
  }
  const updateTargetType = (targetType: NotificationDraft['targetType']) => {
    props.onDraftChange((current) => ({
      ...current,
      targetType,
      targetSchoolId: targetType === 'school' ? current.targetSchoolId : '',
      targetAccountId: targetType === 'user' ? current.targetAccountId : '',
    }))
  }
  const canSubmit = Boolean(
    props.draft.title.trim() &&
    props.draft.content.trim() &&
    (
      props.draft.targetType === 'global' ||
      (props.draft.targetType === 'school' && props.draft.targetSchoolId.trim()) ||
      (props.draft.targetType === 'user' && props.draft.targetAccountId.trim())
    ),
  )
  const activeCount = props.data.items.filter((item) => item.active).length
  const globalCount = props.data.items.filter((item) => item.targetType === 'global').length
  const schoolCount = props.data.items.filter((item) => item.targetType === 'school').length
  const userCount = props.data.items.filter((item) => item.targetType === 'user').length
  const titleLength = props.draft.title.trim().length
  const contentLength = props.draft.content.trim().length
  const targetBadgeTone = props.draft.targetType === 'global'
    ? ''
    : props.draft.targetType === 'school'
      ? 'amber'
      : 'green'
  const targetBadgeLabel = props.draft.targetType === 'global'
    ? '全平台'
    : props.draft.targetType === 'school'
      ? '指定学校'
      : '指定用户'
  const recipientHint = props.draft.targetType === 'global'
    ? '所有用户打开小程序时都会看到这条通知。'
    : props.draft.targetType === 'school'
      ? '只有指定学校下的用户会收到通知。'
      : '只有指定用户会收到通知。'

  return (
    <div className="workspace notification-workspace">
      <Panel>
        <PanelHeader title="发送通知" description={viewMeta.notifications.description} />
        <form className="notification-form" onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) props.onSubmit(props.draft)
        }}>
          <div className="notification-composer">
            <div className="notification-target-card">
              <div className="notification-target-head">
                <span className="notification-kicker">接收对象</span>
                <Badge tone={targetBadgeTone}>{targetBadgeLabel}</Badge>
              </div>
              <div className="notification-target-summary">
                <strong>{targetBadgeLabel}</strong>
                <span>{recipientHint}</span>
              </div>
              <SelectField
                label="接收范围"
                value={props.draft.targetType}
                options={[
                  ['global', '全平台'],
                  ['school', '指定学校'],
                  ['user', '指定用户'],
                ]}
                onChange={(targetType) => updateTargetType(targetType as NotificationDraft['targetType'])}
              />
              {props.draft.targetType === 'school' && (
                <label className="field">
                  <span>学校 ID</span>
                  <input
                    value={props.draft.targetSchoolId}
                    placeholder="请输入目标学校 ID"
                    onChange={(event) => setDraftValue('targetSchoolId', event.target.value.trim())}
                  />
                </label>
              )}
              {props.draft.targetType === 'user' && (
                <label className="field">
                  <span>用户 ID</span>
                  <input
                    value={props.draft.targetAccountId}
                    placeholder="请输入目标用户 ID"
                    onChange={(event) => setDraftValue('targetAccountId', event.target.value.trim())}
                  />
                </label>
              )}
              <div className="notification-note">
                学校或用户通知需要填写对应 ID；从学校管理或用户管理进入时会自动带入。
              </div>
            </div>
            <div className="notification-message-card">
              <div className="notification-editor-head">
                <div>
                  <div className="notification-kicker">通知内容</div>
                  <div className="notification-editor-title">标题建议简短明确，正文说明影响范围和处理方式。</div>
                </div>
                <div className="notification-editor-meta">
                  <span>标题字数 {titleLength}</span>
                  <span>内容字数 {contentLength}</span>
                </div>
              </div>
              <div className="settings-grid notification-grid">
                <label className="field">
                  <span>通知标题</span>
                  <input
                    value={props.draft.title}
                    placeholder="例如：今晚 22:00 课表服务维护"
                    onChange={(event) => setDraftValue('title', event.target.value)}
                  />
                </label>
                <label className="field notification-content-field">
                  <span>通知内容</span>
                  <textarea
                    value={props.draft.content}
                    placeholder="请说明通知原因、影响范围和用户需要做什么。"
                    onChange={(event) => setDraftValue('content', event.target.value)}
                  />
                </label>
              </div>
              <div className="notification-actions">
                <div className="notification-submit-copy">
                  <div className="notification-submit-title">确认发送</div>
                  <div className="notification-submit-hint">
                    {canSubmit ? '内容完整，可以发送。' : '请补齐通知标题、内容，以及必要的学校 ID 或用户 ID。'}
                  </div>
                </div>
                <button className="button primary" type="submit" disabled={!canSubmit}>
                  <Bell size={16} />
                  发送
                </button>
              </div>
            </div>
          </div>
        </form>
      </Panel>

      <Panel>
        <PanelHeader
          title="发送记录"
          description="查看已创建的通知、接收范围、阅读数和当前状态。"
          actions={
            <div className="notification-summary">
              <span>当前 {props.data.items.length}</span>
              <span>生效 {activeCount}</span>
              <span>全平台 {globalCount}</span>
              <span>学校 {schoolCount}</span>
              <span>用户 {userCount}</span>
            </div>
          }
        />
        <div className="panel-tools">
          <label className="field grow">
            <span>搜索</span>
            <input
              value={props.filters.keyword}
              placeholder="搜索标题、学校 ID 或用户 ID"
              onChange={(event) => updateFilters({ keyword: event.target.value })}
            />
          </label>
          <SelectField
            label="接收范围"
            value={props.filters.targetType}
            options={[
              ['', '全部'],
              ['global', '全平台'],
              ['school', '指定学校'],
              ['user', '指定用户'],
            ]}
            onChange={(targetType) => updateFilters({ targetType })}
          />
          <SelectField
            label="状态"
            value={props.filters.active}
            options={[
              ['', '全部'],
              ['true', '生效中'],
              ['false', '已停用'],
            ]}
            onChange={(active) => updateFilters({ active })}
          />
        </div>
        {props.data.items.length ? (
          <div className="table-wrap">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>标题</th>
                  <th>对象</th>
                  <th>状态</th>
                  <th>阅读</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {props.data.items.map((item) => (
                  <tr className={!item.active ? 'notification-row inactive' : 'notification-row'} key={item.id}>
                    <td>
                      <div className="notification-title-line">
                        <BellRing size={15} />
                        <span>{item.title}</span>
                      </div>
                      <div className="cell-meta notification-content-preview">{item.content}</div>
                    </td>
                    <td>
                      <Badge tone={getAdminNotificationTargetTone(item.targetType)}>
                        {getAdminNotificationTargetLabel(item.targetType)}
                      </Badge>
                      <div className="cell-meta notification-id">{getAdminNotificationTargetDetail(item)}</div>
                    </td>
                    <td>
                      <Badge tone={item.active ? 'green' : 'red'}>{item.active ? '生效中' : '已停用'}</Badge>
                      <div className="cell-meta">{item.active ? '用户可见' : '不再展示'}</div>
                    </td>
                    <td><span className="notification-read-count">{item.readCount ?? 0}</span></td>
                    <td>
                      <div className="cell-title">{formatDate(item.createdAt)}</div>
                      <div className="cell-meta notification-id">{item.id}</div>
                    </td>
                    <td>
                      <button className="button danger" type="button" disabled={!item.active} onClick={() => props.onDeactivate(item)}>
                        <PowerOff size={16} />
                        停用
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">暂无通知记录。</div>}
        <Pagination page={props.data} offset={props.filters.offset} onPage={props.onPage} />
      </Panel>
    </div>
  )
}

function RemindersView(props: {
  config: ReminderConfig | null
  deliveries: ReminderDeliveryItem[]
  subscriptions: ReminderWxUserItem[]
  runResult: ReminderRunResult | null
  onSave: (config: ReminderConfig) => void
  onDryRun: () => void
  onClearSubscriptions: (input: { openid?: string; accountId?: string }) => void
  onSendTest: (input: { openid?: string; accountId?: string; type?: 'daily_course' | 'exam' }) => void
}) {
  const [draft, setDraft] = useState<ReminderConfig | null>(props.config)
  const [targetOpenid, setTargetOpenid] = useState('')
  const [targetAccountId, setTargetAccountId] = useState('')
  const [testType, setTestType] = useState<'daily_course' | 'exam'>('daily_course')

  useEffect(() => {
    setDraft(props.config)
  }, [props.config])

  if (!draft) {
    return <Panel><div className="empty">提醒配置未加载。</div></Panel>
  }

  const setValue = <K extends keyof ReminderConfig>(key: K, value: ReminderConfig[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }
  const setNumber = (key: keyof ReminderConfig, value: string) => {
    setDraft((current) => current ? { ...current, [key]: Math.max(1, Number(value) || 1) } : current)
  }
  const cleanTargetOpenid = targetOpenid.trim()
  const cleanTargetAccountId = targetAccountId.trim()
  const hasTestTarget = Boolean(cleanTargetOpenid || cleanTargetAccountId)
  const missingConfig = (draft.missingConfig || []).filter(Boolean)
  const deliveryMode = !draft.enabled
    ? '自动提醒未启用'
    : draft.dryRun
      ? '试跑模式：不会请求微信发送，也不会消耗订阅'
      : draft.readyToSend
        ? '真实发送：会调用微信订阅消息接口'
        : '配置未完成，无法真实发送'
  const dryRunSummary = props.runResult
    ? `扫描 ${props.runResult.total ?? 0} 条，发送 ${props.runResult.sent ?? 0} 条，跳过 ${props.runResult.skipped ?? 0} 条，失败 ${props.runResult.failed ?? 0} 条`
    : '还没有运行过试跑'

  return (
    <Panel>
      <PanelHeader
        title="提醒设置"
        description={viewMeta.reminders.description}
        actions={
          <>
            <button className="button secondary" type="button" onClick={props.onDryRun}><RefreshCw size={16} />试跑一次</button>
            <button className="button primary" type="button" onClick={() => props.onSave(draft)}><Save size={16} />保存</button>
          </>
        }
      />
      <div className="settings-sections">
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>开关</h3>
            <p>dry-run 就是试跑：只生成发送记录，不请求微信接口，不推送给用户，也不会消耗一次性订阅次数。</p>
          </div>
          <div className="settings-grid compact">
            <label className="check-field">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => setValue('enabled', event.target.checked)} />
              <span>启用自动提醒</span>
            </label>
            <label className="check-field">
              <input type="checkbox" checked={draft.dryRun} onChange={(event) => setValue('dryRun', event.target.checked)} />
              <span>只试跑，不发送</span>
            </label>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>发送时间</h3>
            <p>控制一天里什么时候可以发提醒，避免太早或太晚打扰学生。</p>
          </div>
          <div className="settings-grid compact">
            <label className="field">
              <span>开始发送</span>
              <input value={draft.sendWindowStart} onChange={(event) => setValue('sendWindowStart', event.target.value)} placeholder="07:30" />
            </label>
            <label className="field">
              <span>停止发送</span>
              <input value={draft.sendWindowEnd} onChange={(event) => setValue('sendWindowEnd', event.target.value)} placeholder="留空表示不设结束时间" />
            </label>
            <label className="field">
              <span>多久检查一次（毫秒）</span>
              <input type="number" min={1} value={draft.scanIntervalMs} onChange={(event) => setNumber('scanIntervalMs', event.target.value)} />
            </label>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>发送能力</h3>
            <p>数量越大，发送越快；如果平台限流或失败增多，就调小这些值。</p>
          </div>
          <div className="settings-grid compact">
            <label className="field">
              <span>每批最多处理</span>
              <input type="number" min={1} value={draft.batchSize} onChange={(event) => setNumber('batchSize', event.target.value)} />
            </label>
            <label className="field">
              <span>同时处理数量</span>
              <input type="number" min={1} value={draft.concurrency} onChange={(event) => setNumber('concurrency', event.target.value)} />
            </label>
            <label className="field">
              <span>每秒最多发送</span>
              <input type="number" min={1} value={draft.ratePerSecond} onChange={(event) => setNumber('ratePerSecond', event.target.value)} />
            </label>
            <label className="field">
              <span>单轮最长运行（毫秒）</span>
              <input type="number" min={1} value={draft.maxRuntimeMs} onChange={(event) => setNumber('maxRuntimeMs', event.target.value)} />
            </label>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>模板和测试</h3>
            <p>模板 ID 来自微信公众平台的订阅消息。小程序端会实时读取这里的 ID，不需要把模板 ID 写进小程序包。</p>
          </div>
          <div className="settings-grid compact">
            <label className="field">
              <span>worker 强制接收 openid</span>
              <input value={draft.testOpenid} onChange={(event) => setValue('testOpenid', event.target.value)} placeholder="生产环境必须留空" />
            </label>
            <label className="field">
              <span>课程提醒模板 ID</span>
              <input value={draft.dailyCourseTemplateId} onChange={(event) => setValue('dailyCourseTemplateId', event.target.value)} />
            </label>
            <label className="field">
              <span>考试提醒模板 ID</span>
              <input value={draft.examTemplateId} onChange={(event) => setValue('examTemplateId', event.target.value)} />
            </label>
            <SelectField
              label="跳转小程序版本"
              value={draft.miniProgramState}
              options={[
                ['formal', '正式版'],
                ['trial', '体验版'],
                ['developer', '开发版'],
              ]}
              onChange={(value) => setValue('miniProgramState', value === 'developer' || value === 'trial' ? value : 'formal')}
            />
            <SelectField
              label="消息语言"
              value={draft.lang}
              options={[
                ['zh_CN', '简体中文'],
                ['en_US', '英文'],
                ['zh_HK', '繁体中文（香港）'],
                ['zh_TW', '繁体中文（台湾）'],
              ]}
              onChange={(value) => setValue('lang', value === 'en_US' || value === 'zh_HK' || value === 'zh_TW' ? value : 'zh_CN')}
            />
          </div>
        </section>
      </div>
      <div className="detail-panel">
        <div className="detail-list detail-list-grid">
          <DetailItem label="当前模式" value={deliveryMode} />
          <DetailItem label="微信凭据" value={draft.hasWechatCredentials ? '已配置 AppID 和 AppSecret' : '缺少 AppID 或 AppSecret'} />
          <DetailItem label="配置缺口" value={missingConfig.length ? missingConfig.join(' / ') : '无'} />
          <DetailItem label="发送窗口" value={draft.sendWindowEnd ? `${draft.sendWindowStart} - ${draft.sendWindowEnd}` : `${draft.sendWindowStart} 开始，不设结束时间`} />
          <DetailItem label="发送速度估算" value={`约 ${draft.ratePerSecond * 60} 条/分钟，单轮最多处理 ${draft.batchSize} 条`} />
          <DetailItem label="最近试跑结果" value={dryRunSummary} />
        </div>
      </div>
      <section className="settings-section">
        <div className="settings-section-head">
          <h3>模板字段</h3>
          <p>微信发送时字段名必须和模板完全一致；字段类型也要满足微信限制，thing 最多 20 个字符，time 使用 24 小时时间或日期时间。</p>
        </div>
        <div className="detail-list detail-list-grid">
          <DetailItem label="课程模板" value="课程名称 thing8；地点 thing4；开始时间 time15；教师 thing14" />
          <DetailItem label="考试模板" value="考试科目 thing10；地点 thing7；时间 time6；温馨提示 thing3" />
          <DetailItem label="跳转页面" value="pages/index/index，必须存在于小程序 app.config.ts" />
          <DetailItem label="授权说明" value="一次性订阅只够发送一次；发送成功或微信返回 43101 后，需要用户重新订阅。" />
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-head">
          <h3>订阅 wx 用户</h3>
          <p>只展示开启订阅的 wx 用户。发送测试提醒时会使用该 openid 当前绑定的账号，避免同一个账号被多个微信导入或同一微信切换学校后串发。</p>
        </div>
        <div className="settings-grid compact">
          <label className="field">
            <span>wx openid</span>
            <input value={targetOpenid} placeholder="指定 wx 用户" onChange={(event) => setTargetOpenid(event.target.value)} />
          </label>
          <label className="field">
            <span>账号 ID</span>
            <input value={targetAccountId} placeholder="指定账号清空" onChange={(event) => setTargetAccountId(event.target.value)} />
          </label>
          <SelectField
            label="测试类型"
            value={testType}
            options={[
              ['daily_course', '课程提醒'],
              ['exam', '考试提醒'],
            ]}
            onChange={(value) => setTestType(value === 'exam' ? 'exam' : 'daily_course')}
          />
        </div>
        <div className="row-actions">
          <button className="button secondary" type="button" disabled={!hasTestTarget} onClick={() => props.onSendTest({ openid: cleanTargetOpenid || undefined, accountId: cleanTargetAccountId || undefined, type: testType })}>
            <BellRing size={16} />
            发送测试
          </button>
          <button className="button secondary" type="button" disabled={!cleanTargetOpenid} onClick={() => props.onClearSubscriptions({ openid: cleanTargetOpenid })}>
            <PowerOff size={16} />
            清空 wx
          </button>
          <button className="button secondary" type="button" disabled={!cleanTargetAccountId} onClick={() => props.onClearSubscriptions({ accountId: cleanTargetAccountId })}>
            <PowerOff size={16} />
            清空账号
          </button>
          <button className="button danger" type="button" onClick={() => props.onClearSubscriptions({})}>
            <Trash2 size={16} />
            清空所有
          </button>
        </div>
        {props.subscriptions.length ? (
          <div className="table-wrap">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>wx 用户</th>
                  <th>当前账号</th>
                  <th>开启订阅</th>
                  <th>最近错误</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {props.subscriptions.map((item) => {
                  const activeAccount = item.activeAccount
                  const latestError = item.subscriptions.find((subscription) => subscription.lastErrorCode)

                  return (
                    <tr key={item.openid}>
                      <td>
                        <div className="cell-title">{item.openid}</div>
                        <div className="cell-meta">{item.totalCount} 条订阅记录</div>
                      </td>
                      <td>
                        <div className="cell-title">{activeAccount?.displayName || item.activeAccountId || '--'}</div>
                        <div className="cell-meta">{activeAccount?.school?.shortName || activeAccount?.school?.name || activeAccount?.status || '--'}</div>
                      </td>
                      <td>
                        <Badge tone={item.activeAccountId ? 'green' : 'amber'}>{item.enabledCount} 项</Badge>
                        <div className="cell-meta">
                          {item.subscriptions
                            .filter((subscription) => subscription.status === 'enabled')
                            .map((subscription) => subscription.type === 'daily_course' ? '课程' : '考试')
                            .join(' / ') || '--'}
                        </div>
                      </td>
                      <td>
                        <div className="cell-title">{latestError?.lastErrorCode || '-'}</div>
                        <div className="cell-meta">{latestError?.lastErrorMessage || '-'}</div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="button secondary" type="button" disabled={!item.activeAccountId} onClick={() => props.onSendTest({ openid: item.openid, accountId: item.activeAccountId })}>
                            <Bell size={16} />
                            测试
                          </button>
                          <button className="button secondary" type="button" onClick={() => {
                            setTargetOpenid(item.openid)
                            setTargetAccountId(item.activeAccountId || '')
                          }}>
                            <Eye size={16} />
                            填入
                          </button>
                          <button className="button danger" type="button" onClick={() => props.onClearSubscriptions({ openid: item.openid })}>
                            <PowerOff size={16} />
                            清空
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">暂无开启订阅的 wx 用户。</div>}
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <h3>最近发送记录</h3>
          <p>展示最近 50 条提醒发送、跳过和失败记录。微信拒收会显示 43101，便于直接判断用户未授权或授权已消耗。</p>
        </div>
        {props.deliveries.length ? (
          <div className="table-wrap">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>内容</th>
                  <th>错误</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {props.deliveries.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="cell-title">{item.account?.displayName || item.accountId}</div>
                      <div className="cell-meta">{item.account?.school?.shortName || item.account?.school?.name || item.account?.status || item.accountId}</div>
                    </td>
                    <td>{item.type === 'daily_course' ? '课程' : '考试'}</td>
                    <td><Badge tone={getReminderDeliveryStatusTone(item.status)}>{getReminderDeliveryStatusLabel(item.status)}</Badge></td>
                    <td>
                      <div className="cell-title">{item.title || '无标题'}</div>
                      <div className="cell-meta">{item.summary || item.dateKey}</div>
                    </td>
                    <td>
                      <div className="cell-title">{item.errorCode || '-'}</div>
                      <div className="cell-meta">{item.errorMessage || '-'}</div>
                    </td>
                    <td>
                      <div className="cell-title">{formatDate(item.createdAt)}</div>
                      <div className="cell-meta">发送日 {item.dateKey}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">暂无提醒发送记录。</div>}
      </section>
    </Panel>
  )
}

function HomeShortcutSettingsView(props: {
  config: HomeShortcutConfig | null
  onSave: (config: HomeShortcutConfig) => void
}) {
  const [draft, setDraft] = useState<HomeShortcutConfig>(() => normalizeHomeShortcutConfig(props.config))

  useEffect(() => {
    setDraft(normalizeHomeShortcutConfig(props.config))
  }, [props.config])

  const enabledCount = draft.items.filter((item) => item.enabled).length
  const layoutText = enabledCount <= 1
    ? '1 个入口左对齐'
    : enabledCount <= 5
      ? `${enabledCount} 个入口均匀分布`
      : `${enabledCount} 个入口横向滚动，首屏显示 4 个`

  const updateItem = (key: HomeShortcutKey, patch: Partial<HomeShortcutConfigItem>) => {
    setDraft((current) => normalizeHomeShortcutConfig({
      ...current,
      items: current.items.map((item) => item.key === key ? { ...item, ...patch } : item),
    }))
  }

  const resetDefault = () => {
    setDraft(normalizeHomeShortcutConfig(DEFAULT_HOME_SHORTCUT_CONFIG))
  }

  return (
    <Panel>
      <PanelHeader
        title="首页菜单"
        description={viewMeta.appSettings.description}
        actions={
          <>
            <button className="button secondary" type="button" onClick={resetDefault}><RefreshCw size={16} />恢复默认</button>
            <button className="button primary" type="button" onClick={() => props.onSave(draft)}><Save size={16} />保存</button>
          </>
        }
      />
      <div className="shortcut-settings-summary">
        <div>
          <div className="cell-title">当前显示 {enabledCount} 个入口</div>
          <div className="cell-meta">{layoutText}。用户打开小程序时轻量拉取一次，随后使用本地缓存。</div>
        </div>
        <Badge tone={enabledCount ? 'green' : 'amber'}>{enabledCount ? '已配置' : '全部隐藏'}</Badge>
      </div>
      <div className="shortcut-settings-list">
        {HOME_SHORTCUT_OPTIONS.map((option) => {
          const item = draft.items.find((entry) => entry.key === option.key) ||
            DEFAULT_HOME_SHORTCUT_CONFIG.items.find((entry) => entry.key === option.key)

          if (!item) return null

          return (
            <section className={'shortcut-settings-row' + (item.enabled ? ' is-enabled' : '')} key={option.key}>
              <label className="check-field shortcut-toggle">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(event) => updateItem(item.key, { enabled: event.target.checked })}
                />
                <span>显示</span>
              </label>
              <div className="shortcut-settings-info">
                <div className="cell-title">{option.name}</div>
                <div className="cell-meta">{option.description}</div>
                <div className="shortcut-user-effect">{item.enabled ? `用户会看到“${item.label}”入口` : '用户暂时看不到这个入口'}</div>
              </div>
              <label className="field shortcut-label-field">
                <span>显示名称</span>
                <input
                  maxLength={8}
                  value={item.label}
                  onChange={(event) => updateItem(item.key, { label: event.target.value })}
                />
              </label>
              <label className="field shortcut-order-field">
                <span>排序</span>
                <input
                  type="number"
                  value={item.order}
                  onChange={(event) => updateItem(item.key, { order: Number(event.target.value) || 0 })}
                />
              </label>
            </section>
          )
        })}
      </div>
    </Panel>
  )
}

function SelectField(props: { label: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  )
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={'badge ' + tone}>{children}</span>
}

function Pagination({ page, offset, pageSize = PAGE_SIZE, onPage }: { page: PageResult<unknown>; offset: number; pageSize?: number; onPage: (offset: number) => void }) {
  const start = page.items.length ? offset + 1 : 0
  const end = offset + page.items.length

  return (
    <div className="panel-tools pagination">
      <div className="cell-meta">{start} - {end} / {page.total || 0}</div>
      <button className="button secondary" type="button" disabled={offset <= 0} onClick={() => onPage(Math.max(0, offset - pageSize))}>
        <ChevronLeft size={16} />
        上一页
      </button>
      <button className="button secondary" type="button" disabled={!page.hasMore} onClick={() => onPage(offset + pageSize)}>
        下一页
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

function ConfigModal({ modal, onClose, onSubmit }: { modal: ModalState; onClose: () => void; onSubmit: (value: unknown) => void }) {
  return (
    <div className="modal-backdrop visible" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className={'modal ' + (modal.mode === 'provider' ? 'provider-modal' : modal.mode === 'term' || modal.mode === 'weather' ? 'term-modal' : '')}>
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{modal.title}</h2>
            {modal.description && <div className="panel-description">{modal.description}</div>}
          </div>
          <button className="button ghost" type="button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className={`modal-body ${modal.mode === 'provider' ? 'provider-modal-body' : ''}`}>
          {modal.mode === 'json' && <pre className="json-output">{JSON.stringify(modal.value, null, 2)}</pre>}
          {modal.mode === 'submission' && <SubmissionDetail item={modal.value as SubmissionItem} />}
          {modal.mode === 'term' && (
            <TermStartForm
              value={modal.value}
              school={modal.school}
              onCancel={onClose}
              onSubmit={onSubmit}
            />
          )}
          {modal.mode === 'weather' && (
            <WeatherForm
              value={modal.value}
              school={modal.school}
              onCancel={onClose}
              onSubmit={onSubmit}
            />
          )}
          {modal.mode === 'provider' && (
            <ProviderForm
              value={modal.value}
              school={modal.school}
              onCancel={onClose}
              onSubmit={onSubmit}
            />
          )}
        </div>
        {(modal.mode === 'json' || modal.mode === 'submission') && (
          <footer className="modal-footer">
            <button className="button secondary" type="button" onClick={onClose}><X size={16} />关闭</button>
          </footer>
        )}
      </section>
    </div>
  )
}

function ConfirmModal(props: { action: ConfirmState; onCancel: () => void; onConfirm: () => void }) {
  const actionLabel = props.action.nextEnabled ? '启用' : '停用'
  const buttonClass = props.action.nextEnabled ? 'button primary' : 'button danger'

  return (
    <div className="modal-backdrop visible" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onCancel()
    }}>
      <section className="modal confirm-modal">
        <header className="modal-header">
          <div className="confirm-title-row">
            <span className={'confirm-icon ' + (props.action.nextEnabled ? 'green' : 'red')}>
              <TriangleAlert size={18} />
            </span>
            <div>
              <h2 id="confirm-title">确认{actionLabel}学校</h2>
              <div className="panel-description">{props.action.school.name} / {props.action.school.id}</div>
            </div>
          </div>
          <button className="button ghost" type="button" aria-label="关闭" onClick={props.onCancel}><X size={16} /></button>
        </header>
        <div className="modal-body">
          <div className="confirm-copy">
            {props.action.nextEnabled
              ? '启用后用户可以在前台选择并使用该学校。'
              : '停用后用户将无法继续选择该学校，已有账号相关流程也可能受到影响。'}
          </div>
        </div>
        <footer className="modal-footer">
          <button className="button secondary" type="button" onClick={props.onCancel}><X size={16} />取消</button>
          <button className={buttonClass} type="button" onClick={props.onConfirm}>
            {props.action.nextEnabled ? <Power size={16} /> : <PowerOff size={16} />}
            确认{actionLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}

function SubmissionConfirmModal(props: { action: SubmissionConfirmState; onCancel: () => void; onConfirm: () => void }) {
  const nextLabel = getSubmissionStatusLabel(props.action.nextStatus)
  const danger = props.action.nextStatus === 'disabled'

  return (
    <div className="modal-backdrop visible" role="dialog" aria-modal="true" aria-labelledby="submission-confirm-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onCancel()
    }}>
      <section className="modal confirm-modal">
        <header className="modal-header">
          <div className="confirm-title-row">
            <span className={'confirm-icon ' + (danger ? 'red' : 'green')}>
              <TriangleAlert size={18} />
            </span>
            <div>
              <h2 id="submission-confirm-title">确认调整接入状态</h2>
              <div className="panel-description">{props.action.schoolName}</div>
            </div>
          </div>
          <button className="button ghost" type="button" aria-label="关闭" onClick={props.onCancel}><X size={16} /></button>
        </header>
        <div className="modal-body">
          <div className="confirm-copy">
            将 {props.action.items.length} 条待审核申请调整为「{nextLabel}」。这只会更新申请状态，不会新增持久拦截名单。
          </div>
        </div>
        <footer className="modal-footer">
          <button className="button secondary" type="button" onClick={props.onCancel}><X size={16} />取消</button>
          <button className={danger ? 'button danger' : 'button primary'} type="button" onClick={props.onConfirm}>
            <Check size={16} />
            确认调整
          </button>
        </footer>
      </section>
    </div>
  )
}

function TermStartForm(props: { value: unknown; school?: SchoolItem; onCancel: () => void; onSubmit: (value: Record<string, string>) => void }) {
  const knownTerms = props.school?.terms || []
  const hasKnownTerms = knownTerms.length > 0
  const [rows, setRows] = useState<TermStartRow[]>(() => createTermStartRows(props.value, knownTerms, props.school))

  const updateRow = (id: string, patch: Partial<TermStartRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  const removeRow = (id: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== id)
      return nextRows.length ? nextRows : [{ id: String(Date.now()), termId: '', startDate: '' }]
    })
  }
  const addManualRow = () => {
    setRows((current) => [
      ...current,
      { id: `${Date.now()}-${current.length}`, termId: '', startDate: '' },
    ])
  }

  return (
    <form className="config-form" onSubmit={(event) => {
      event.preventDefault()
      props.onSubmit(termRowsToRecord(rows))
    }}>
      <section className="form-section">
        <header className="form-section-header">
          <div>
            <h3>默认首周</h3>
            <p>{hasKnownTerms ? '已同步到的学期会直接显示，只需要填写第一周的周一日期。' : '还没有同步到学期列表，可先手动填写学期 ID 和首周日期。'}</p>
          </div>
          <button className="button secondary" type="button" onClick={addManualRow}>
            <Plus size={16} />
            {hasKnownTerms ? '手动补充' : '添加学期'}
          </button>
        </header>
        <div className="term-row-list">
          {rows.map((row) => (
            <div className="term-row" key={row.id}>
              {row.locked ? (
                <div className="term-display">
                  <span className="term-label">{row.label || row.termId}</span>
                </div>
              ) : (
                <label className="field">
                  <span>学期 ID</span>
                  <input
                    value={row.termId}
                    placeholder="2025-2026-2"
                    onChange={(event) => updateRow(row.id, { termId: event.target.value })}
                  />
                </label>
              )}
              <label className="field">
                <span>首周周一</span>
                <input
                  type="date"
                  value={row.startDate}
                  onChange={(event) => updateRow(row.id, { startDate: event.target.value })}
                />
              </label>
              <div className="term-row-action">
                {row.locked ? (
                  <span className="cell-meta">清空日期可移除配置</span>
                ) : (
                  <button className="button ghost icon-button" type="button" aria-label="删除首周" onClick={() => removeRow(row.id)}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="modal-footer inline-footer">
        <div className="cell-meta">空行不会保存。</div>
        <div className="row-actions">
          <button className="button secondary" type="button" onClick={props.onCancel}><X size={16} />关闭</button>
          <button className="button primary" type="submit"><Save size={16} />保存</button>
        </div>
      </div>
    </form>
  )
}

function WeatherForm(props: { value: unknown; school?: SchoolItem; onCancel: () => void; onSubmit: (value: WeatherDraft) => void }) {
  const initial = props.value && typeof props.value === 'object' && !Array.isArray(props.value)
    ? props.value as WeatherDraft
    : {
      providerId: props.school?.providerId || props.school?.id || '',
      loginMode: props.school?.loginMode || 'direct_password',
      weatherLocation: props.school?.weatherLocation,
    }
  const [enabled, setEnabled] = useState(() => Boolean(initial.weatherLocation))
  const [draft, setDraft] = useState(() => ({
    displayName: initial.weatherLocation?.displayName || '',
    latitude: initial.weatherLocation ? String(initial.weatherLocation.latitude) : '',
    longitude: initial.weatherLocation ? String(initial.weatherLocation.longitude) : '',
  }))

  const setWeatherValue = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return (
    <form className="config-form" onSubmit={(event) => {
      event.preventDefault()
      const latitude = Number(draft.latitude)
      const longitude = Number(draft.longitude)
      const weatherLocation = enabled && Number.isFinite(latitude) && Number.isFinite(longitude)
        ? {
          displayName: draft.displayName.trim() || undefined,
          latitude,
          longitude,
        }
        : null

      props.onSubmit({
        providerId: initial.providerId,
        loginMode: initial.loginMode,
        providerConfig: {
          weatherLocation,
        },
      } as WeatherDraft)
    }}>
      <section className="form-section weather-section">
        <header className="form-section-header">
          <div>
            <h3>天气位置</h3>
            <p>启用后前台会按这里的经纬度请求学校天气。</p>
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>启用</span>
          </label>
        </header>
        {enabled ? (
          <div className="form-grid provider-simple-grid weather-location-grid">
            <label className="field">
              <span>显示名称</span>
              <input value={draft.displayName} placeholder={props.school?.shortName || props.school?.name || '学校简称'} onChange={(event) => setWeatherValue('displayName', event.target.value)} />
            </label>
            <label className="field">
              <span>纬度</span>
              <input type="number" step="any" required value={draft.latitude} placeholder="30.4611" onChange={(event) => setWeatherValue('latitude', event.target.value.trim())} />
            </label>
            <label className="field">
              <span>经度</span>
              <input type="number" step="any" required value={draft.longitude} placeholder="114.279297" onChange={(event) => setWeatherValue('longitude', event.target.value.trim())} />
            </label>
          </div>
        ) : (
          <div className="provider-muted-note weather-muted-note">天气未启用，保存后会清除天气位置。</div>
        )}
      </section>
      <div className="modal-footer inline-footer">
        <button className="button secondary" type="button" onClick={props.onCancel}><X size={16} />关闭</button>
        <button className="button primary" type="submit"><Save size={16} />保存</button>
      </div>
    </form>
  )
}

function ProviderForm(props: { value: unknown; school?: SchoolItem; onCancel: () => void; onSubmit: (value: ProviderDraft) => void }) {
  const initial = props.value && typeof props.value === 'object' && !Array.isArray(props.value)
    ? props.value as ProviderDraft
    : createEmptyProviderDraft()
  const schoolProviderCode = getSchoolProviderCode(props.school)
  const courseBuildings = props.school?.courseBuildings || []
  const [draft, setDraft] = useState<ProviderDraft>(initial)
  const [sectionRows, setSectionRows] = useState<SectionTimeRow[]>(() => createSectionTimeRows(initial.sectionTimes))
  const [profileRows, setProfileRows] = useState<SectionTimeProfileRow[]>(() => createSingleBuildingProfileRows(initial.sectionTimeProfiles, courseBuildings))
  const [activeTab, setActiveTab] = useState<ProviderConfigTab>('sectionTimes')
  const [activeProfileId, setActiveProfileId] = useState('')
  const [sectionImportText, setSectionImportText] = useState('')
  const [sectionImportError, setSectionImportError] = useState('')
  const [profileImportText, setProfileImportText] = useState('')
  const [profileImportError, setProfileImportError] = useState('')
  const buildingOptions = useMemo(() => {
    const options = new Map<string, CourseBuildingItem>()

    courseBuildings.forEach((building) => {
      const name = building.name.trim()
      const key = normalizeBuildingKeyword(name)
      if (name && !options.has(key)) options.set(key, building)
    })

    profileRows.forEach((profile, profileIndex) => {
      const name = getProfileDisplayName(profile, profileIndex)
      const key = normalizeBuildingKeyword(name)
      if (name && !options.has(key)) options.set(key, { name, count: 0 })
    })

    return [...options.values()]
  }, [courseBuildings, profileRows])
  const activeProfileMatchIndex = profileRows.findIndex((profile) => profile.id === activeProfileId)
  const activeProfileIndex = activeProfileMatchIndex >= 0 ? activeProfileMatchIndex : 0
  const activeProfile = profileRows[activeProfileIndex]
  const providerTabs: Array<{ id: ProviderConfigTab; label: string; detail: string }> = [
    { id: 'sectionTimes', label: '默认上课时间', detail: `${sectionRowsToItems(sectionRows).length || 0} 节` },
    { id: 'buildingTimes', label: '楼栋上课时间', detail: buildingOptions.length ? `${profileRows.length}/${buildingOptions.length} 栋` : `${profileRows.length} 栋` },
  ]

  useEffect(() => {
    setActiveProfileId((current) => {
      if (current && profileRows.some((profile) => profile.id === current)) return current
      return profileRows[0]?.id || ''
    })
  }, [profileRows])

  const updateSectionRow = (id: string, patch: Partial<SectionTimeRow>) => {
    setSectionRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }
  const removeSectionRow = (id: string) => {
    setSectionRows((current) => {
      const nextRows = current.filter((row) => row.id !== id)
      return nextRows.length ? nextRows : [{ id: String(Date.now()), section: '', start: '', end: '' }]
    })
  }
  const addSectionRow = () => {
    setSectionRows((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        section: String(Math.max(0, ...current.map((row) => Number(row.section) || 0)) + 1),
        start: '',
        end: '',
      },
    ])
  }
  const importDefaultSectionRows = () => {
    const rows = parseSectionTimeImportRows(sectionImportText)

    if (!rows.length) {
      setSectionImportError('未识别到时间段')
      return
    }

    setSectionRows(rows)
    setSectionImportText('')
    setSectionImportError('')
  }
  const removeProfileRow = (id: string) => {
    const nextRows = profileRows.filter((row) => row.id !== id)
    setProfileRows(nextRows)

    if (activeProfileId === id) {
      const nextActiveIndex = Math.min(Math.max(activeProfileIndex, 0), nextRows.length - 1)
      setActiveProfileId(nextRows[nextActiveIndex]?.id || '')
    }
  }
  const createProfileRowForBuilding = (buildingName: string, rows: SectionTimeProfileRow[]) => {
    const row = createSectionTimeProfileRow(rows.length, sectionRowsToItems(sectionRows), buildingName)

    return {
      ...row,
      profileId: getUniqueProfileId(row.profileId || createSectionTimeProfileId(buildingName, rows.length), rows),
      name: buildingName,
      buildingKeywords: buildingName,
    }
  }
  const findProfileForBuilding = (rows: SectionTimeProfileRow[], buildingName: string) => {
    const buildingKey = normalizeBuildingKeyword(buildingName)

    return rows.find((profile) =>
      splitBuildingKeywords(profile.buildingKeywords || profile.name)
        .some((keyword) => normalizeBuildingKeyword(keyword) === buildingKey),
    )
  }
  const openBuildingProfile = (buildingName: string) => {
    const name = buildingName.trim()

    if (!name) return

    if (normalizeBuildingKeyword(name) === normalizeBuildingKeyword('教学楼1')) {
      setActiveTab('sectionTimes')
      return
    }

    const existing = findProfileForBuilding(profileRows, name)

    if (existing) {
      setActiveProfileId(existing.id)
      setActiveTab('buildingTimes')
      return
    }

    const row = createProfileRowForBuilding(name, profileRows)
    setProfileRows((current) => [...current, row])
    setActiveProfileId(row.id)
    setActiveTab('buildingTimes')
  }
  const updateProfileSectionRow = (profileId: string, rowId: string, patch: Partial<SectionTimeRow>) => {
    setProfileRows((current) => current.map((profile) => profile.id === profileId
      ? {
        ...profile,
        sectionRows: profile.sectionRows.map((row) => row.id === rowId ? { ...row, ...patch } : row),
      }
      : profile,
    ))
  }
  const removeProfileSectionRow = (profileId: string, rowId: string) => {
    setProfileRows((current) => current.map((profile) => {
      if (profile.id !== profileId) return profile
      const nextRows = profile.sectionRows.filter((row) => row.id !== rowId)
      return {
        ...profile,
        sectionRows: nextRows.length ? nextRows : [{ id: `${Date.now()}`, section: '', start: '', end: '' }],
      }
    }))
  }
  const addProfileSectionRow = (profileId: string) => {
    setProfileRows((current) => current.map((profile) => {
      if (profile.id !== profileId) return profile
      return {
        ...profile,
        sectionRows: [
          ...profile.sectionRows,
          {
            id: `${Date.now()}-${profile.sectionRows.length}`,
            section: String(Math.max(0, ...profile.sectionRows.map((row) => Number(row.section) || 0)) + 1),
            start: '',
            end: '',
          },
        ],
      }
    }))
  }
  const importProfileSectionRows = () => {
    if (!activeProfile) {
      setProfileImportError('请先选择楼栋')
      return
    }

    const rows = parseSectionTimeImportRows(profileImportText)

    if (!rows.length) {
      setProfileImportError('未识别到时间段')
      return
    }

    setProfileRows((current) => current.map((profile) => profile.id === activeProfile.id
      ? { ...profile, sectionRows: rows }
      : profile,
    ))
    setProfileImportText('')
    setProfileImportError('')
  }

  return (
    <form className="config-form" onSubmit={(event) => {
      event.preventDefault()
      const sectionTimes = sectionRowsToItems(sectionRows)
      const sectionTimeProfiles = profileRowsToItems(profileRows)
      const shouldSubmitSectionTimes = Boolean(initial.sectionTimes?.length) || sectionTimes.length > 0
      const shouldSubmitSectionTimeProfiles = Boolean(initial.sectionTimeProfiles?.length) || sectionTimeProfiles.length > 0
      props.onSubmit({
        ...draft,
        ...(shouldSubmitSectionTimes ? { sectionTimes } : {}),
        ...(shouldSubmitSectionTimeProfiles ? { sectionTimeProfiles } : {}),
      })
    }}>
      <div className="provider-tabs" role="tablist" aria-label="上课时间配置">
        {providerTabs.map((tab) => (
          <button
            className={`provider-tab-button ${activeTab === tab.id ? 'is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.detail}</small>
          </button>
        ))}
      </div>
      <div className="provider-tab-panel">
        {activeTab === 'sectionTimes' && (
          <section className="form-section provider-tab-section">
            <header className="form-section-header">
              <div>
                <h3>上课时间</h3>
                <p>用于前端课表按节次显示时间，未填完整的行不会保存。</p>
              </div>
              <div className="row-actions">
                <button className="button secondary" type="button" onClick={importDefaultSectionRows}>
                  <Upload size={16} />
                  导入
                </button>
                <button className="button secondary" type="button" onClick={addSectionRow}>
                  <Plus size={16} />
                  添加节次
                </button>
              </div>
            </header>
            <div className="section-time-layout">
              <div className="section-time-import">
                <label className="field">
                  <span>批量导入</span>
                  <textarea
                    className="section-time-import-input"
                    value={sectionImportText}
                    placeholder={'08:00-08:45\n08:55-09:40\n10:00-10:45'}
                    onChange={(event) => {
                      setSectionImportText(event.target.value)
                      setSectionImportError('')
                    }}
                  />
                </label>
                {sectionImportError && <div className="field-error">{sectionImportError}</div>}
              </div>
              <div className="section-time-table">
                <div className="section-time-head">
                  <span>节次</span>
                  <span>开始</span>
                  <span>结束</span>
                  <span />
                </div>
                {sectionRows.map((row) => (
                  <div className="section-time-row" key={row.id}>
                    <label className="field compact-field">
                      <span>节次</span>
                      <input
                        type="number"
                        min={1}
                        value={row.section}
                        onChange={(event) => updateSectionRow(row.id, { section: event.target.value })}
                      />
                    </label>
                    <label className="field compact-field">
                      <span>开始</span>
                      <input
                        type="time"
                        value={row.start}
                        onChange={(event) => updateSectionRow(row.id, { start: event.target.value })}
                      />
                    </label>
                    <label className="field compact-field">
                      <span>结束</span>
                      <input
                        type="time"
                        value={row.end}
                        onChange={(event) => updateSectionRow(row.id, { end: event.target.value })}
                      />
                    </label>
                    <button className="button ghost icon-button" type="button" aria-label="删除节次" onClick={() => removeSectionRow(row.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        {activeTab === 'buildingTimes' && (
          <section className="form-section provider-tab-section">
            <header className="form-section-header">
              <div>
                <h3>楼栋上课时间</h3>
                <p>点击楼栋，单独设置这栋楼的节次时间。</p>
              </div>
            </header>
            <div className="building-times-layout">
              <div className="building-list-panel">
                {buildingOptions.length ? (
                  <div className="building-setting-list">
                    {buildingOptions.map((building) => {
                      const profile = findProfileForBuilding(profileRows, building.name)
                      const isActive = Boolean(profile && activeProfile?.id === profile.id)
                      const configuredSections = profile ? sectionRowsToItems(profile.sectionRows).length : 0

                      return (
                        <button
                          className={'building-setting-button' + (isActive ? ' is-active' : '') + (profile ? ' is-configured' : '')}
                          type="button"
                          key={normalizeBuildingKeyword(building.name)}
                          onClick={() => openBuildingProfile(building.name)}
                        >
                          <span>{building.name}</span>
                          <small>{configuredSections ? `${configuredSections} 节` : '点击设置'}</small>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="empty compact-empty">暂无识别楼栋。</div>
                )}
              </div>
              <div className="time-profile-editor">
                {activeProfile ? (
                  <div className="time-profile-card active-time-profile-card" key={activeProfile.id}>
                    <div className="time-profile-head">
                      <div className="time-profile-summary">
                        <strong>{getProfileDisplayName(activeProfile, activeProfileIndex)}</strong>
                        <span>{sectionRowsToItems(activeProfile.sectionRows).length || 0} 节已配置</span>
                      </div>
                      <button className="button ghost icon-button" type="button" aria-label="删除楼栋时间" onClick={() => removeProfileRow(activeProfile.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="time-profile-section-header">
                      <span>节次时间</span>
                      <div className="row-actions">
                        <button className="button secondary" type="button" onClick={importProfileSectionRows}>
                          <Upload size={16} />
                          导入
                        </button>
                        <button className="button secondary" type="button" onClick={() => addProfileSectionRow(activeProfile.id)}>
                          <Plus size={16} />
                          添加节次
                        </button>
                      </div>
                    </div>
                    <div className="section-time-import compact-section-time-import">
                      <label className="field">
                        <span>批量导入</span>
                        <textarea
                          className="section-time-import-input"
                          value={profileImportText}
                          placeholder={'08:00-08:45\n08:55-09:40\n10:20-11:05'}
                          onChange={(event) => {
                            setProfileImportText(event.target.value)
                            setProfileImportError('')
                          }}
                        />
                      </label>
                      {profileImportError && <div className="field-error">{profileImportError}</div>}
                    </div>
                    <div className="section-time-table nested-section-time-table">
                      <div className="section-time-head">
                        <span>节次</span>
                        <span>开始</span>
                        <span>结束</span>
                        <span />
                      </div>
                      {activeProfile.sectionRows.map((row) => (
                        <div className="section-time-row" key={row.id}>
                          <label className="field compact-field">
                            <span>节次</span>
                            <input
                              type="number"
                              min={1}
                              value={row.section}
                              onChange={(event) => updateProfileSectionRow(activeProfile.id, row.id, { section: event.target.value })}
                            />
                          </label>
                          <label className="field compact-field">
                            <span>开始</span>
                            <input
                              type="time"
                              value={row.start}
                              onChange={(event) => updateProfileSectionRow(activeProfile.id, row.id, { start: event.target.value })}
                            />
                          </label>
                          <label className="field compact-field">
                            <span>结束</span>
                            <input
                              type="time"
                              value={row.end}
                              onChange={(event) => updateProfileSectionRow(activeProfile.id, row.id, { end: event.target.value })}
                            />
                          </label>
                          <button className="button ghost icon-button" type="button" aria-label="删除节次" onClick={() => removeProfileSectionRow(activeProfile.id, row.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="empty compact-empty">点击左侧楼栋开始设置。</div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      <div className="modal-footer inline-footer">
        <button className="button secondary" type="button" onClick={props.onCancel}><X size={16} />关闭</button>
        <button className="button primary" type="submit"><Save size={16} />保存</button>
      </div>
    </form>
  )
}
