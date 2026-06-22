import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Eye,
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
  Users,
  X,
} from 'lucide-react'

const CONFIG_KEY = 'cschedule.adminWebsite.config'
const DEFAULT_BASE_URL = 'http://localhost:3000/api/v1'
const PAGE_SIZE = 50
const SUBMISSION_PAGE_SIZE = 100
const FILTER_DEBOUNCE_MS = 250

const LOGIN_MODE_OPTIONS = [
  ['direct_password', '账号密码'],
  ['password_captcha', '账号密码 + 验证码'],
  ['cas_simple', 'CAS'],
  ['cas_webview', 'CAS WebView'],
  ['oauth_webview', 'OAuth WebView'],
  ['qrcode', '扫码登录'],
] as const

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

type ViewKey = 'overview' | 'schools' | 'users' | 'submissions' | 'feedback' | 'reminders'
type StatusType = 'success' | 'error'

interface AdminStats {
  schools: { total: number; enabled: number }
  accounts: number
  pendingSubmissions: number
  pendingFeedback: number
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
  userCount?: number
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
  mode: 'json' | 'term' | 'provider'
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

interface ProviderDraft {
  providerId: string
  loginMode: string
  sectionTimes?: SectionTimeItem[]
}

interface ConfirmState {
  school: SchoolItem
  nextEnabled: boolean
}

interface SubmissionConfirmState {
  schoolName: string
  items: SubmissionItem[]
  nextStatus: string
}

type SchoolFilters = { keyword: string; status: string; enabled: string; offset: number }
type UserFilters = { keyword: string; schoolId: string; schoolKeyword: string; status: string; offset: number }
type SubmissionFilters = { keyword: string; status: string; extraVerification: string; adaptationHelp: string; offset: number }
type FeedbackFilters = { status: string; schoolKeyword: string; offset: number }
type SubmissionStatus = 'submitted' | 'catalog_only' | 'candidate' | 'researching' | 'beta' | 'enabled' | 'disabled'

const viewMeta: Record<ViewKey, { title: string; description: string }> = {
  overview: {
    title: '总览',
    description: '查看接入规模、待办数量和最近需要处理的事项。',
  },
  schools: {
    title: '学校管理',
    description: '筛选学校、启停学校、配置学期首周和 Provider 参数。',
  },
  users: {
    title: '用户管理',
    description: '查看用户联系方式、学校、专业和账号状态，并按学校实时筛选。',
  },
  submissions: {
    title: '接入申请',
    description: '审核用户提交的学校接入申请。',
  },
  feedback: {
    title: '用户反馈',
    description: '查看用户反馈和关联学生信息。',
  },
  reminders: {
    title: '提醒设置',
    description: '调整每日课程和考试提醒的发送窗口、批量、并发与 dry-run 状态。',
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

function display(value: unknown, fallback = '--') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
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
  if (['enabled', 'processed', 'success'].includes(status)) return 'green'
  if (['submitted', 'pending', 'catalog_only', 'candidate', 'researching', 'beta'].includes(status)) return 'amber'
  if (['disabled', 'failed'].includes(status)) return 'red'
  return ''
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

export function App() {
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
  const [schools, setSchools] = useState<PageResult<SchoolItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [users, setUsers] = useState<PageResult<UserItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [submissions, setSubmissions] = useState<PageResult<SubmissionItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [feedback, setFeedback] = useState<PageResult<FeedbackItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [reminderConfig, setReminderConfig] = useState<ReminderConfig | null>(null)
  const [reminderRun, setReminderRun] = useState<ReminderRunResult | null>(null)
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null)
  const [schoolFilters, setSchoolFilters] = useState({ keyword: '', status: '', enabled: '', offset: 0 })
  const [userFilters, setUserFilters] = useState<UserFilters>({ keyword: '', schoolId: '', schoolKeyword: '', status: '', offset: 0 })
  const [submissionFilters, setSubmissionFilters] = useState<SubmissionFilters>({
    keyword: '',
    status: '',
    extraVerification: '',
    adaptationHelp: '',
    offset: 0,
  })
  const [feedbackFilters, setFeedbackFilters] = useState<FeedbackFilters>({ status: '', schoolKeyword: '', offset: 0 })
  const [modal, setModal] = useState<ModalState | null>(null)
  const [confirmAction, setConfirmAction] = useState<ConfirmState | null>(null)
  const [submissionConfirmAction, setSubmissionConfirmAction] = useState<SubmissionConfirmState | null>(null)

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
  }, [activeView, feedbackFilters.status, feedbackFilters.schoolKeyword])

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

  async function hydrateView(view: ViewKey, apiBaseUrl = baseUrl, key = adminKey) {
    const load = <T,>(path: string) => fetchWithKey<T>(apiBaseUrl, key, path)
    const nextStats = await load<AdminStats>('/admin/stats')
    setStats(nextStats)

    if (view === 'schools') {
      const query = buildQuery({
        keyword: schoolFilters.keyword,
        status: schoolFilters.status,
        enabled: schoolFilters.enabled,
        limit: PAGE_SIZE,
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
        limit: PAGE_SIZE,
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
        schoolKeyword: feedbackFilters.schoolKeyword,
        limit: PAGE_SIZE,
        offset: feedbackFilters.offset,
      })
      const nextFeedback = await load<PageResult<FeedbackItem>>('/admin/feedback?' + query)
      setFeedback(nextFeedback)
      setSelectedFeedback(nextFeedback.items[0] || null)
    }

    if (view === 'reminders') {
      setReminderConfig(await load<ReminderConfig>('/admin/reminders/config'))
    }
  }

  async function refreshCurrentView(successMessage = '数据已刷新。') {
    try {
      setLoading(true)
      await hydrateView(activeView)
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

  async function switchView(view: ViewKey) {
    setActiveView(view)
    try {
      setLoading(true)
      await hydrateView(view)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  function openSchoolFeedback(school: SchoolItem) {
    setActiveView('feedback')
    setFeedbackFilters({ status: '', schoolKeyword: school.name, offset: 0 })
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
    setStats(null)
    setSchools({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setUsers({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setSubmissions({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setFeedback({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
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

  function requestUpdateSubmissions(schoolName: string, items: SubmissionItem[], nextStatus: string) {
    if (!items.length) return
    setSubmissionConfirmAction({ schoolName, items, nextStatus })
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
      await refreshCurrentView(modal.mode === 'term' ? '默认首周已保存。' : 'Provider 配置已保存。')
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

  async function runReminderDryRun() {
    try {
      setLoading(true)
      const result = await requestApi<ReminderRunResult>('/admin/reminders/run?force=true&dryRun=true&limit=20', {
        method: 'POST',
      })
      setReminderRun(result)
      showStatus('提醒 dry-run 已完成。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!authed) {
    return (
      <main className="login-screen">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-brand">
            <div className="brand-mark">CS</div>
            <div>
              <div className="brand-title">CSchedule 管理后台</div>
              <div className="brand-subtitle">网站版运维控制台</div>
            </div>
          </div>
          <h1 id="login-title">管理员登录</h1>
          <p>输入后端配置的 ADMIN_API_KEY。登录后会先读取统计接口，用于确认密钥和接口地址可用。</p>
          <label className="field">
            <span>后端接口地址</span>
            <input value={loginBaseUrl} onChange={(event) => setLoginBaseUrl(event.target.value)} autoComplete="url" />
          </label>
          <label className="field">
            <span>Admin API Key</span>
            <input
              type="password"
              value={loginKey}
              onChange={(event) => setLoginKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void login()
              }}
              autoComplete="current-password"
              placeholder="输入管理员接口密钥"
            />
          </label>
          <button className="button primary full" type="button" onClick={() => void login()} disabled={loading}>
            <LogIn size={16} />
            登录后台
          </button>
          {loginStatus && <StatusLine status={loginStatus} />}
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CS</div>
          <div>
            <div className="brand-title">CSchedule</div>
            <div className="brand-subtitle">Admin Console</div>
          </div>
        </div>
        <nav className="nav" aria-label="主导航">
          <NavButton active={activeView === 'overview'} icon={<LayoutDashboard size={18} />} label="总览" onClick={() => void switchView('overview')} />
          <NavButton active={activeView === 'schools'} icon={<School size={18} />} label="学校管理" onClick={() => void switchView('schools')} />
          <NavButton active={activeView === 'users'} icon={<Users size={18} />} label="用户管理" onClick={() => void switchView('users')} />
          <NavButton active={activeView === 'submissions'} icon={<Inbox size={18} />} label="接入申请" onClick={() => void switchView('submissions')} />
          <NavButton active={activeView === 'feedback'} icon={<MessageSquareWarning size={18} />} label="用户反馈" onClick={() => void switchView('feedback')} />
          <NavButton active={activeView === 'reminders'} icon={<BellRing size={18} />} label="提醒设置" onClick={() => void switchView('reminders')} />
        </nav>
        <div className="sidebar-footer">管理端仅面向网站浏览器使用。请在可信设备保存密钥，离开时退出登录。</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="page-kicker">Admin</div>
            <h1>{viewMeta[activeView].title}</h1>
          </div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void refreshCurrentView()} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button>
            <button className="button ghost" type="button" onClick={logout}>
              <LogOut size={16} />
              退出
            </button>
          </div>
        </header>

        <section className="config-row" aria-label="接口配置">
          <label className="field">
            <span>后端接口地址</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoComplete="url" />
          </label>
          <label className="field">
            <span>Admin API Key</span>
            <input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} autoComplete="current-password" />
          </label>
          <button className="button secondary" type="button" onClick={() => showStatus('配置已保存。')}>
            <Save size={16} />
            保存配置
          </button>
        </section>

        {status && <StatusLine status={status} />}
        <MetricGrid stats={stats} />

        <section className="workspace">
          {loading && <Panel><div className="empty">正在加载数据...</div></Panel>}
          {!loading && activeView === 'overview' && <Overview stats={stats} onRefresh={() => void refreshCurrentView()} />}
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
                title: '配置 Provider',
                description: `${school.name} / ${school.id}`,
                mode: 'provider',
                value: getProviderDraft(school),
                school,
              })}
              onOpenFeedback={openSchoolFeedback}
              onOpenUsers={openSchoolUsers}
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
              onShowJson={(item) => setModal({ title: '申请详情', description: item.schoolName, mode: 'json', value: item })}
              onCopied={() => showStatus('网址已复制。')}
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
              onShowJson={(item) => setModal({ title: '反馈原始数据', description: item.id, mode: 'json', value: item })}
            />
          )}
          {!loading && activeView === 'reminders' && (
            <RemindersView
              config={reminderConfig}
              runResult={reminderRun}
              onSave={(config) => void saveReminderConfig(config)}
              onDryRun={() => void runReminderDryRun()}
            />
          )}
        </section>
      </main>

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
    </div>
  )
}

function getProviderDraft(school: SchoolItem) {
  return {
    providerId: school.providerId || school.id,
    loginMode: school.loginMode || 'direct_password',
    sectionTimes: school.sectionTimes || [],
  }
}

function createTermStartRows(termStarts: unknown, terms: TermOption[] = []): TermStartRow[] {
  const record = termStarts && typeof termStarts === 'object' && !Array.isArray(termStarts)
    ? termStarts as Record<string, unknown>
    : {}
  const termMap = new Map<string, TermStartRow>()

  for (const term of terms) {
    const termId = String(term.id || '').trim()
    if (!termId || termMap.has(termId)) continue

    termMap.set(termId, {
      id: `term-${termId}`,
      termId,
      label: term.label || termId,
      startDate: String(record[termId] || ''),
      locked: true,
    })
  }

  for (const [termId, startDate] of Object.entries(record)) {
    if (termMap.has(termId)) continue
    termMap.set(termId, {
      id: `manual-${termId}`,
      termId,
      label: termId,
      startDate: String(startDate || ''),
      locked: Boolean(termId),
    })
  }

  const rows = [...termMap.values()]

  return rows.length ? rows : [{ id: String(Date.now()), termId: '', startDate: '' }]
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

function getSchoolProviderCode(school?: SchoolItem) {
  return school?.providerId || school?.id || ''
}

function getSubmissionStatusCounts(items: SubmissionItem[]) {
  return items.reduce<Record<SubmissionStatus, number>>(
    (counts, item) => {
      const status = item.status as SubmissionStatus
      if (status in counts) counts[status] += 1
      return counts
    },
    {
      submitted: 0,
      catalog_only: 0,
      candidate: 0,
      researching: 0,
      beta: 0,
      enabled: 0,
      disabled: 0,
    },
  )
}

function getSubmissionGroupSummary(items: SubmissionItem[]) {
  const counts = getSubmissionStatusCounts(items)
  const parts = [
    counts.submitted ? `${counts.submitted} 待审核` : '',
    counts.catalog_only ? `${counts.catalog_only} 目录` : '',
    counts.candidate ? `${counts.candidate} 候选` : '',
    counts.researching ? `${counts.researching} 调研中` : '',
    counts.beta ? `${counts.beta} 灰度` : '',
    counts.enabled ? `${counts.enabled} 已启用` : '',
    counts.disabled ? `${counts.disabled} 已停用` : '',
  ].filter(Boolean)

  return parts.length ? parts.join(' / ') : '暂无状态'
}

function getPendingSubmissions(items: SubmissionItem[]) {
  return items.filter((item) => item.status === 'submitted')
}

function getSubmissionStatusLabel(status: string) {
  if (status === 'submitted') return '待审核'
  return SCHOOL_STATUS_OPTIONS.find(([value]) => value === status)?.[1] || status
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
  return (
    <section className="metric-grid" aria-label="关键指标">
      <Metric label="学校总数" value={stats?.schools.total} foot={`已启用 ${stats?.schools.enabled ?? '--'} 所`} />
      <Metric label="学生账号" value={stats?.accounts} foot="当前数据库账号数量" />
      <Metric label="待审核申请" value={stats?.pendingSubmissions} foot="状态为 submitted" />
      <Metric label="待处理反馈" value={stats?.pendingFeedback} foot="状态为 pending" />
    </section>
  )
}

function Metric({ label, value, foot }: { label: string; value?: number; foot: string }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value ?? '--'}</div>
      <div className="metric-foot">{foot}</div>
    </article>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="panel">{children}</section>
}

function PanelHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <header className="panel-header">
      <div>
        <h2>{title}</h2>
        <div className="panel-description">{description}</div>
      </div>
      <div className="row-actions">{actions}</div>
    </header>
  )
}

function Overview({ stats, onRefresh }: { stats: AdminStats | null; onRefresh: () => void }) {
  return (
    <Panel>
      <PanelHeader
        title="待办概览"
        description={viewMeta.overview.description}
        actions={<button className="button secondary" type="button" onClick={onRefresh}><RefreshCw size={16} />刷新统计</button>}
      />
      <div className="detail-panel">
        <div className="detail-list">
          <DetailItem label="学校接入" value={`${stats?.schools.enabled ?? 0} / ${stats?.schools.total ?? 0} 所学校已启用`} />
          <DetailItem label="申请审核" value={`${stats?.pendingSubmissions ?? 0} 条学校接入申请待处理`} />
          <DetailItem label="用户反馈" value={`${stats?.pendingFeedback ?? 0} 条用户反馈待处理`} />
          <DetailItem label="运维建议" value="优先处理 submitted 申请，再检查 pending 反馈中是否有学校适配问题。" />
        </div>
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
  onOpenFeedback: (school: SchoolItem) => void
  onOpenUsers: (school: SchoolItem) => void
}) {
  const updateFilters = (patch: Partial<SchoolFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }

  return (
    <Panel>
      <PanelHeader title="学校管理" description={viewMeta.schools.description} />
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
      </div>

      {props.schools.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>学校</th>
                <th>状态</th>
                <th>用户</th>
                <th>Provider</th>
                <th>默认首周</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {props.schools.items.map((school) => (
                <tr key={school.id}>
                  <td>
                    <div className="cell-title">{school.name}</div>
                    <div className="cell-meta">{joinFilled([school.id, school.shortName, school.province, school.city])}</div>
                  </td>
                  <td>
                    <Badge tone={school.enabled ? 'green' : 'red'}>{school.enabled ? '已启用' : '未启用'}</Badge>
                    <div className="cell-meta">{school.status}</div>
                  </td>
                  <td>
                    <button className="count-link" type="button" onClick={() => props.onOpenUsers(school)}>
                      {school.userCount ?? 0}
                    </button>
                    <div className="cell-meta">点击查看用户</div>
                  </td>
                  <td>
                    <div className="cell-title">{display(school.providerId || school.id)}</div>
                    <div className="cell-meta">{display(school.loginMode, '未设置登录方式')}</div>
                  </td>
                  <td>
                    <div className="cell-title">{Object.keys(school.termStarts || {}).length ? `${Object.keys(school.termStarts || {}).length} 个学期` : '未配置'}</div>
                    {Object.entries(school.termStarts || {}).length > 0 && (
                      <div className="cell-meta">{Object.entries(school.termStarts || {}).map(([termId, date]) => `${termId}: ${date}`).join('；')}</div>
                    )}
                    <div className="cell-meta">{school.sectionTimes?.length ? `上课时间：${school.sectionTimes.length} 节` : '上课时间未配置'}</div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className={'button ' + (school.enabled ? 'danger' : 'secondary')} type="button" onClick={() => props.onToggle(school)}>
                        {school.enabled ? <PowerOff size={16} /> : <Power size={16} />}
                        {school.enabled ? '停用' : '启用'}
                      </button>
                      <button className="button secondary" type="button" onClick={() => props.onOpenTerm(school)}><CalendarDays size={16} />首周</button>
                      <button className="button secondary" type="button" onClick={() => props.onOpenProvider(school)}><Settings2 size={16} />Provider</button>
                      <button className="button secondary" type="button" onClick={() => props.onOpenFeedback(school)}><MessageSquareWarning size={16} />反馈</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">没有匹配的学校。</div>}
      <Pagination page={props.schools} offset={props.filters.offset} onPage={props.onPage} />
    </Panel>
  )
}

function UsersView(props: {
  data: PageResult<UserItem>
  filters: UserFilters
  onFiltersChange: React.Dispatch<React.SetStateAction<UserFilters>>
  onPage: (offset: number) => void
}) {
  const updateFilters = (patch: Partial<UserFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }

  return (
    <Panel>
      <PanelHeader title="用户管理" description={viewMeta.users.description} />
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
            ['active', 'active'],
            ['need_login', 'need_login'],
            ['cached_only', 'cached_only'],
            ['disabled', 'disabled'],
            ['unbound', 'unbound'],
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
                <th>用户</th>
                <th>联系方式</th>
                <th>学校</th>
                <th>专业</th>
                <th>状态</th>
                <th>Provider</th>
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
                    <div className="cell-title">{display(item.contact?.value)}</div>
                    <div className="cell-meta">{joinFilled([item.contact?.phone, item.contact?.email])}</div>
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
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                    <div className="cell-meta">{item.lastLoginAt ? `最近登录 ${formatDate(item.lastLoginAt)}` : `创建 ${formatDate(item.createdAt)}`}</div>
                  </td>
                  <td>
                    <div className="cell-title">{display(item.providerId)}</div>
                    <div className="cell-meta">{item.id}</div>
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
  onShowJson: (item: SubmissionItem) => void
  onCopied: () => void
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
      .sort((a, b) => b.items.length - a.items.length || a.schoolName.localeCompare(b.schoolName, 'zh-CN'))
  }, [props.data.items, props.filters.keyword])

  return (
    <Panel>
      <PanelHeader title="接入申请" description={viewMeta.submissions.description} />
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
          options={[['', '全部'], ['submitted', '待审核'], ...SCHOOL_STATUS_OPTIONS]}
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
      </div>
      {groups.length ? (
        <div className="submission-groups">
          {groups.map((group) => (
            <SubmissionSchoolGroup
              key={group.key}
              group={group}
              onUpdate={props.onUpdate}
              onShowJson={props.onShowJson}
              onCopied={props.onCopied}
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
  onShowJson: (item: SubmissionItem) => void
  onCopied: () => void
}) {
  const pendingItems = getPendingSubmissions(props.group.items)
  const statusSummary = getSubmissionGroupSummary(props.group.items)
  const first = props.group.items[0]
  const website = first?.eduSystemWebsite || first?.loginUrl || first?.officialWebsite
  const [selectedStatus, setSelectedStatus] = useState('')
  const updatePending = (status: string) => {
    props.onUpdate(props.group.schoolName, pendingItems, status)
  }

  return (
    <section className="submission-school-group">
      <header className="submission-school-header">
        <div>
          <div className="submission-school-kicker">学校分组</div>
          <h3>{props.group.schoolName}</h3>
          <div className="submission-school-meta">
            <span>{props.group.items.length} 条申请</span>
            {website && <span>{website}</span>}
          </div>
        </div>
        <div className="submission-school-actions">
          <Badge tone={pendingItems.length ? 'amber' : ''}>
            {pendingItems.length ? `${pendingItems.length} 条待审核` : '已处理'}
          </Badge>
          <div className="cell-meta">{statusSummary}</div>
          <div className="row-actions">
            <button className="button secondary" type="button" disabled={!pendingItems.length} onClick={() => updatePending('candidate')}><Check size={16} />通过</button>
            <button className="button danger" type="button" disabled={!pendingItems.length} onClick={() => updatePending('disabled')}><X size={16} />驳回</button>
            <select className="compact-select" value={selectedStatus} disabled={!pendingItems.length} onChange={(event) => {
              const nextStatus = event.target.value
              setSelectedStatus('')
              if (nextStatus) updatePending(nextStatus)
            }}>
              <option value="">更多状态</option>
              {SCHOOL_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
      </header>
      <div className="submission-list">
        {props.group.items.map((item) => (
          <SubmissionCard
            key={item.id}
            item={item}
            onShowJson={props.onShowJson}
            onCopied={props.onCopied}
          />
        ))}
      </div>
    </section>
  )
}

function SubmissionCard(props: {
  item: SubmissionItem
  onShowJson: (item: SubmissionItem) => void
  onCopied: () => void
}) {
  const formInfo = parseSubmissionNote(props.item.note)
  const website = props.item.eduSystemWebsite || props.item.loginUrl || props.item.officialWebsite || ''

  return (
    <article className="submission-card">
      <div className="submission-fields">
        <SubmissionField label="学校名称" value={props.item.schoolName} />
        <SubmissionField label="教务系统网址" value={display(website)} copyValue={website} onCopied={props.onCopied} />
        <SubmissionField label="验证方式" value={display(formInfo.extraVerification)} />
        <SubmissionField label="协助意愿" value={display(formInfo.adaptationHelp)} />
        <SubmissionField label="联系方式" value={display(formInfo.contact)} />
        <SubmissionField label="备注" value={display(formInfo.note)} />
      </div>
      <div className="submission-card-actions">
        <button className="button ghost icon-button" type="button" aria-label="查看原始数据" onClick={() => props.onShowJson(props.item)}><FileJson size={16} /></button>
      </div>
    </article>
  )
}

function SubmissionField({ label, value, copyValue, onCopied }: { label: string; value: string; copyValue?: string; onCopied?: () => void }) {
  const copy = async () => {
    if (!copyValue) return
    await copyText(copyValue)
    onCopied?.()
  }

  return (
    <div className="submission-field">
      <div className="submission-field-label">{label}</div>
      <div className="submission-field-value">
        {copyValue ? (
          <button className="copy-value" type="button" onClick={() => void copy()}>
            {value}
          </button>
        ) : (
          <span>{value}</span>
        )}
        {copyValue && (
          <button className="copy-button" type="button" title="复制" onClick={() => void copy()}>
            <Clipboard size={14} />
          </button>
        )}
      </div>
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
  onShowJson: (item: FeedbackItem) => void
}) {
  const updateFilters = (patch: Partial<FeedbackFilters>) => {
    props.onFiltersChange((current) => ({ ...current, ...patch, offset: 0 }))
  }

  return (
    <div className="split-grid">
      <Panel>
        <PanelHeader title="用户反馈" description={viewMeta.feedback.description} />
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
            options={[['', '全部'], ['pending', '待处理'], ['processed', '已处理']]}
            onChange={(status) => updateFilters({ status })}
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
                  className={'feedback-row' + (active ? ' active' : '')}
                  type="button"
                  key={item.id}
                  onClick={() => props.onSelect(item)}
                >
                  <span className="feedback-row-main">
                    <span className="feedback-row-title">
                      {display(item.type, '反馈')}
                      <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                    </span>
                    <span className="feedback-row-content">{display(item.content).slice(0, 120)}</span>
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
      <aside className="panel detail-panel">
        <div className="detail-heading">
          <h2>反馈详情</h2>
          {props.selected && <Badge tone={statusTone(props.selected.status)}>{props.selected.status}</Badge>}
        </div>
        {props.selected ? (
          <>
            <div className="detail-list">
              <DetailItem label="内容" value={display(props.selected.content)} />
              <DetailItem label="联系方式" value={display(props.selected.contact)} />
              <DetailItem label="学校" value={display(props.selected.account?.school?.name || props.selected.school?.name || props.selected.schoolId)} />
              <DetailItem label="学生" value={joinFilled([props.selected.student?.name, props.selected.student?.studentNo, props.selected.student?.grade, props.selected.student?.major, props.selected.student?.className]) || '--'} />
              <DetailItem label="账号" value={display(props.selected.accountId)} />
              <DetailItem label="时间" value={formatDate(props.selected.createdAt)} />
            </div>
            <button className="button secondary detail-button" type="button" onClick={() => props.selected && props.onShowJson(props.selected)}>
              <FileJson size={16} />
              查看原始 JSON
            </button>
          </>
        ) : <div className="empty">选择一条反馈查看详情。</div>}
      </aside>
    </div>
  )
}

function RemindersView(props: {
  config: ReminderConfig | null
  runResult: ReminderRunResult | null
  onSave: (config: ReminderConfig) => void
  onDryRun: () => void
}) {
  const [draft, setDraft] = useState<ReminderConfig | null>(props.config)

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

  return (
    <Panel>
      <PanelHeader
        title="提醒设置"
        description={viewMeta.reminders.description}
        actions={
          <>
            <button className="button secondary" type="button" onClick={props.onDryRun}><RefreshCw size={16} />Dry-run</button>
            <button className="button primary" type="button" onClick={() => props.onSave(draft)}><Save size={16} />保存</button>
          </>
        }
      />
      <div className="settings-grid">
        <label className="check-field">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => setValue('enabled', event.target.checked)} />
          <span>启用自动提醒 worker</span>
        </label>
        <label className="check-field">
          <input type="checkbox" checked={draft.dryRun} onChange={(event) => setValue('dryRun', event.target.checked)} />
          <span>Dry-run 模式</span>
        </label>
        <label className="field">
          <span>发送开始时间</span>
          <input value={draft.sendWindowStart} onChange={(event) => setValue('sendWindowStart', event.target.value)} placeholder="07:30" />
        </label>
        <label className="field">
          <span>发送结束时间</span>
          <input value={draft.sendWindowEnd} onChange={(event) => setValue('sendWindowEnd', event.target.value)} placeholder="留空表示不设结束时间" />
        </label>
        <label className="field">
          <span>每批数量</span>
          <input type="number" min={1} value={draft.batchSize} onChange={(event) => setNumber('batchSize', event.target.value)} />
        </label>
        <label className="field">
          <span>并发 worker 数</span>
          <input type="number" min={1} value={draft.concurrency} onChange={(event) => setNumber('concurrency', event.target.value)} />
        </label>
        <label className="field">
          <span>全局发送速率/秒</span>
          <input type="number" min={1} value={draft.ratePerSecond} onChange={(event) => setNumber('ratePerSecond', event.target.value)} />
        </label>
        <label className="field">
          <span>扫描间隔 ms</span>
          <input type="number" min={1} value={draft.scanIntervalMs} onChange={(event) => setNumber('scanIntervalMs', event.target.value)} />
        </label>
        <label className="field">
          <span>单轮最大运行 ms</span>
          <input type="number" min={1} value={draft.maxRuntimeMs} onChange={(event) => setNumber('maxRuntimeMs', event.target.value)} />
        </label>
        <label className="field">
          <span>测试 openid</span>
          <input value={draft.testOpenid} onChange={(event) => setValue('testOpenid', event.target.value)} placeholder="生产留空" />
        </label>
        <label className="field">
          <span>课程模板 ID</span>
          <input value={draft.dailyCourseTemplateId} onChange={(event) => setValue('dailyCourseTemplateId', event.target.value)} />
        </label>
        <label className="field">
          <span>考试模板 ID</span>
          <input value={draft.examTemplateId} onChange={(event) => setValue('examTemplateId', event.target.value)} />
        </label>
      </div>
      <div className="detail-panel">
        <div className="detail-list">
          <DetailItem label="窗口策略" value={draft.sendWindowEnd ? `${draft.sendWindowStart} - ${draft.sendWindowEnd}` : `${draft.sendWindowStart} 开始，不设结束时间`} />
          <DetailItem label="吞吐估算" value={`约 ${draft.ratePerSecond * 60} 条/分钟，单轮最多处理 ${draft.batchSize} 条`} />
          <DetailItem label="最近 dry-run" value={props.runResult ? JSON.stringify(props.runResult) : '尚未运行'} />
        </div>
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
      <section className={'modal ' + (modal.mode === 'provider' ? 'provider-modal' : modal.mode === 'term' ? 'term-modal' : '')}>
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{modal.title}</h2>
            {modal.description && <div className="panel-description">{modal.description}</div>}
          </div>
          <button className="button ghost" type="button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="modal-body">
          {modal.mode === 'json' && <pre className="json-output">{JSON.stringify(modal.value, null, 2)}</pre>}
          {modal.mode === 'term' && (
            <TermStartForm
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
        {modal.mode === 'json' && (
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
            将 {props.action.items.length} 条待审核申请调整为「{nextLabel}」。后续后端可以基于该状态拦截重复提交。
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
  const [rows, setRows] = useState<TermStartRow[]>(() => createTermStartRows(props.value, knownTerms))

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
                <span className="term-id-code">{row.termId}</span>
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

function ProviderForm(props: { value: unknown; school?: SchoolItem; onCancel: () => void; onSubmit: (value: ProviderDraft) => void }) {
  const initial = props.value && typeof props.value === 'object' && !Array.isArray(props.value)
    ? props.value as ProviderDraft
    : createEmptyProviderDraft()
  const schoolProviderCode = getSchoolProviderCode(props.school)
  const [draft, setDraft] = useState<ProviderDraft>(initial)
  const [sectionRows, setSectionRows] = useState<SectionTimeRow[]>(() => createSectionTimeRows(initial.sectionTimes))

  const setValue = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
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

  return (
    <form className="config-form" onSubmit={(event) => {
      event.preventDefault()
      const sectionTimes = sectionRowsToItems(sectionRows)
      const shouldSubmitSectionTimes = Boolean(initial.sectionTimes?.length) || sectionTimes.length > 0
      props.onSubmit({
        ...draft,
        ...(shouldSubmitSectionTimes ? { sectionTimes } : {}),
      })
    }}>
      <section className="form-section">
        <header className="form-section-header">
          <div>
            <h3>Provider</h3>
            <p>只维护 Provider、学校简写和登录方式。</p>
          </div>
        </header>
        <div className="form-grid provider-simple-grid">
          <label className="field">
            <span>Provider</span>
            <input value={draft.providerId} placeholder={schoolProviderCode || 'wtbu'} onChange={(event) => setValue('providerId', event.target.value.trim())} />
          </label>
          <label className="field">
            <span>学校简写</span>
            <input value={schoolProviderCode} disabled />
          </label>
          <SelectField
            label="登录方式"
            value={draft.loginMode}
            options={LOGIN_MODE_OPTIONS}
            onChange={(loginMode) => setValue('loginMode', loginMode)}
          />
        </div>
      </section>
      <section className="form-section">
        <header className="form-section-header">
          <div>
            <h3>上课时间</h3>
            <p>用于前端课表按节次显示时间，未填完整的行不会保存。</p>
          </div>
          <button className="button secondary" type="button" onClick={addSectionRow}>
            <Plus size={16} />
            添加节次
          </button>
        </header>
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
      </section>
      <div className="modal-footer inline-footer">
        <button className="button secondary" type="button" onClick={props.onCancel}><X size={16} />关闭</button>
        <button className="button primary" type="submit"><Save size={16} />保存</button>
      </div>
    </form>
  )
}
