import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileJson,
  Inbox,
  LayoutDashboard,
  LogIn,
  LogOut,
  MessageSquareWarning,
  Power,
  PowerOff,
  RefreshCw,
  BellRing,
  Save,
  School,
  Search,
  Settings2,
  X,
} from 'lucide-react'

const CONFIG_KEY = 'cschedule.adminWebsite.config'
const DEFAULT_BASE_URL = 'http://localhost:3000/api/v1'
const PAGE_SIZE = 50

type ViewKey = 'overview' | 'schools' | 'submissions' | 'feedback' | 'reminders'
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
  student?: {
    name?: string | null
    studentNo?: string | null
    grade?: string | null
    major?: string | null
    className?: string | null
    level?: string | null
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

const viewMeta: Record<ViewKey, { title: string; description: string }> = {
  overview: {
    title: '总览',
    description: '查看接入规模、待办数量和最近需要处理的事项。',
  },
  schools: {
    title: '学校管理',
    description: '筛选学校、启停学校、配置学期首周和 Provider 参数。',
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
  if (['enabled', 'accepted', 'processed', 'success'].includes(status)) return 'green'
  if (['submitted', 'pending', 'candidate', 'researching', 'beta'].includes(status)) return 'amber'
  if (['disabled', 'rejected', 'failed'].includes(status)) return 'red'
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
    adaptationHelp: fields['是否愿意协助首个接入适配'],
    note: fields['备注'],
    contact: fields['联系方式'],
  }
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
  const [submissions, setSubmissions] = useState<PageResult<SubmissionItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [feedback, setFeedback] = useState<PageResult<FeedbackItem>>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
  const [reminderConfig, setReminderConfig] = useState<ReminderConfig | null>(null)
  const [reminderRun, setReminderRun] = useState<ReminderRunResult | null>(null)
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null)
  const [schoolFilters, setSchoolFilters] = useState({ keyword: '', status: '', enabled: '', offset: 0 })
  const [submissionFilters, setSubmissionFilters] = useState({ keyword: '', status: '', offset: 0 })
  const [feedbackFilters, setFeedbackFilters] = useState({ status: '', offset: 0 })
  const [modal, setModal] = useState<ModalState | null>(null)

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

    if (view === 'submissions') {
      const query = buildQuery({
        keyword: submissionFilters.keyword,
        status: submissionFilters.status,
        limit: PAGE_SIZE,
        offset: submissionFilters.offset,
      })
      setSubmissions(await load<PageResult<SubmissionItem>>('/admin/submissions?' + query))
    }

    if (view === 'feedback') {
      const query = buildQuery({
        status: feedbackFilters.status,
        limit: PAGE_SIZE,
        offset: feedbackFilters.offset,
      })
      const nextFeedback = await load<PageResult<FeedbackItem>>('/admin/feedback?' + query)
      setFeedback(nextFeedback)
      setSelectedFeedback((current) => current || nextFeedback.items[0] || null)
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

  async function refreshSchoolsWithFilters(nextFilters: typeof schoolFilters, successMessage = '数据已刷新。') {
    setSchoolFilters(nextFilters)
    try {
      setLoading(true)
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
      showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function refreshSubmissionsWithFilters(nextFilters: typeof submissionFilters, successMessage = '数据已刷新。') {
    setSubmissionFilters(nextFilters)
    try {
      setLoading(true)
      const query = buildQuery({
        keyword: nextFilters.keyword,
        status: nextFilters.status,
        limit: PAGE_SIZE,
        offset: nextFilters.offset,
      })
      const [nextStats, nextSubmissions] = await Promise.all([
        requestApi<AdminStats>('/admin/stats'),
        requestApi<PageResult<SubmissionItem>>('/admin/submissions?' + query),
      ])
      setStats(nextStats)
      setSubmissions(nextSubmissions)
      showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
    }
  }

  async function refreshFeedbackWithFilters(nextFilters: typeof feedbackFilters, successMessage = '数据已刷新。') {
    setFeedbackFilters(nextFilters)
    try {
      setLoading(true)
      const query = buildQuery({
        status: nextFilters.status,
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
      showStatus(successMessage)
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    } finally {
      setLoading(false)
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

  function logout() {
    setAuthed(false)
    setAdminKey('')
    setLoginKey('')
    setStats(null)
    setSchools({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setSubmissions({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setFeedback({ items: [], total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false })
    setSelectedFeedback(null)
  }

  async function toggleSchool(school: SchoolItem) {
    try {
      await requestApi(`/admin/schools/${encodeURIComponent(school.id)}`, {
        method: 'PATCH',
        bodyData: { enabled: !school.enabled },
      })
      await refreshCurrentView(school.enabled ? '学校已停用。' : '学校已启用。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function updateSubmission(item: SubmissionItem, nextStatus: 'accepted' | 'rejected') {
    try {
      await requestApi(`/admin/submissions/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        bodyData: {
          status: nextStatus,
          review: {
            reviewedAt: new Date().toISOString(),
            source: 'admin-frontend',
          },
        },
      })
      await refreshCurrentView(nextStatus === 'accepted' ? '申请已通过。' : '申请已驳回。')
    } catch (error) {
      showStatus(describeFetchError(error, baseUrl), 'error')
    }
  }

  async function submitModalJson(value: string) {
    if (!modal?.school) return

    try {
      const body = JSON.parse(value)
      const path = modal.mode === 'term'
        ? `/admin/schools/${encodeURIComponent(modal.school.id)}`
        : `/admin/schools/${encodeURIComponent(modal.school.id)}/provider-config`
      const bodyData = modal.mode === 'term' ? { termStarts: body } : body

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
              onSearch={() => {
                void refreshSchoolsWithFilters({ ...schoolFilters, offset: 0 })
              }}
              onPage={(offset) => {
                void refreshSchoolsWithFilters({ ...schoolFilters, offset })
              }}
              onToggle={toggleSchool}
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
            />
          )}
          {!loading && activeView === 'submissions' && (
            <SubmissionsView
              data={submissions}
              filters={submissionFilters}
              onFiltersChange={setSubmissionFilters}
              onSearch={() => {
                void refreshSubmissionsWithFilters({ ...submissionFilters, offset: 0 })
              }}
              onPage={(offset) => {
                void refreshSubmissionsWithFilters({ ...submissionFilters, offset })
              }}
              onUpdate={updateSubmission}
              onShowJson={(item) => setModal({ title: '申请详情', description: item.schoolName, mode: 'json', value: item })}
            />
          )}
          {!loading && activeView === 'feedback' && (
            <FeedbackView
              data={feedback}
              filters={feedbackFilters}
              selected={selectedFeedback}
              onFiltersChange={setFeedbackFilters}
              onSearch={() => {
                void refreshFeedbackWithFilters({ ...feedbackFilters, offset: 0 })
              }}
              onPage={(offset) => {
                void refreshFeedbackWithFilters({ ...feedbackFilters, offset })
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
        <JsonModal
          modal={modal}
          onClose={() => setModal(null)}
          onSubmit={submitModalJson}
        />
      )}
    </div>
  )
}

function getProviderDraft(school: SchoolItem) {
  return {
    providerId: school.providerId || '',
    loginMode: school.loginMode || 'direct_password',
    dataAccess: school.dataAccess || {
      course: ['manual_import'],
      score: [],
      exam: [],
      profile: [],
    },
    capabilities: school.capabilities || {
      course: true,
      score: false,
      exam: false,
      profile: false,
    },
    eduSystemType: school.eduSystemType || 'unknown',
    providerConfig: {},
    authConfig: {},
    status: school.status || 'candidate',
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
  filters: { keyword: string; status: string; enabled: string; offset: number }
  onFiltersChange: React.Dispatch<React.SetStateAction<{ keyword: string; status: string; enabled: string; offset: number }>>
  onSearch: () => void
  onPage: (offset: number) => void
  onToggle: (school: SchoolItem) => void
  onOpenTerm: (school: SchoolItem) => void
  onOpenProvider: (school: SchoolItem) => void
}) {
  return (
    <Panel>
      <PanelHeader title="学校管理" description={viewMeta.schools.description} />
      <div className="panel-tools">
        <label className="field grow">
          <span>学校关键词</span>
          <input
            value={props.filters.keyword}
            placeholder="学校名称、省份、城市或 ID"
            onChange={(event) => props.onFiltersChange((current) => ({ ...current, keyword: event.target.value }))}
          />
        </label>
        <SelectField
          label="学校状态"
          value={props.filters.status}
          options={[
            ['', '全部'],
            ['catalog_only', '目录'],
            ['candidate', '候选'],
            ['researching', '调研中'],
            ['beta', '灰度'],
            ['enabled', '已启用'],
            ['disabled', '已停用'],
          ]}
          onChange={(status) => props.onFiltersChange((current) => ({ ...current, status }))}
        />
        <SelectField
          label="启用情况"
          value={props.filters.enabled}
          options={[
            ['', '全部'],
            ['true', '已启用'],
            ['false', '未启用'],
          ]}
          onChange={(enabled) => props.onFiltersChange((current) => ({ ...current, enabled }))}
        />
        <button className="button primary" type="button" onClick={props.onSearch}><Search size={16} />查询</button>
      </div>

      {props.schools.items.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>学校</th>
                <th>状态</th>
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
                    <div className="cell-title">{display(school.providerId)}</div>
                    <div className="cell-meta">{joinFilled([school.loginMode, school.eduSystemType]) || '--'}</div>
                  </td>
                  <td>
                    <div className="cell-title">{Object.keys(school.termStarts || {}).length ? `${Object.keys(school.termStarts || {}).length} 个学期` : '未配置'}</div>
                    <div className="cell-meta">{Object.entries(school.termStarts || {}).map(([termId, date]) => `${termId}: ${date}`).join('；') || '可在右侧操作中添加'}</div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className={'button ' + (school.enabled ? 'danger' : 'secondary')} type="button" onClick={() => props.onToggle(school)}>
                        {school.enabled ? <PowerOff size={16} /> : <Power size={16} />}
                        {school.enabled ? '停用' : '启用'}
                      </button>
                      <button className="button secondary" type="button" onClick={() => props.onOpenTerm(school)}><CalendarDays size={16} />首周</button>
                      <button className="button secondary" type="button" onClick={() => props.onOpenProvider(school)}><Settings2 size={16} />Provider</button>
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

function SubmissionsView(props: {
  data: PageResult<SubmissionItem>
  filters: { keyword: string; status: string; offset: number }
  onFiltersChange: React.Dispatch<React.SetStateAction<{ keyword: string; status: string; offset: number }>>
  onSearch: () => void
  onPage: (offset: number) => void
  onUpdate: (item: SubmissionItem, status: 'accepted' | 'rejected') => void
  onShowJson: (item: SubmissionItem) => void
}) {
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
            onChange={(event) => props.onFiltersChange((current) => ({ ...current, keyword: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') props.onSearch()
            }}
          />
        </label>
        <SelectField
          label="状态"
          value={props.filters.status}
          options={[['', '全部'], ['submitted', '待审核'], ['accepted', '已通过'], ['rejected', '已驳回']]}
          onChange={(status) => props.onFiltersChange((current) => ({ ...current, status }))}
        />
        <button className="button primary" type="button" onClick={props.onSearch}><Search size={16} />查询</button>
      </div>
      {groups.length ? (
        <div className="submission-groups">
          {groups.map((group) => (
            <section className="submission-school-group" key={group.key}>
              <header className="submission-school-header">
                <div>
                  <h3>{group.schoolName}</h3>
                  <div className="cell-meta">{group.items.length} 条申请</div>
                </div>
                <Badge tone={group.items.some((item) => item.status === 'submitted') ? 'amber' : ''}>
                  {group.items.some((item) => item.status === 'submitted') ? '有待审核' : '已处理'}
                </Badge>
              </header>
              <div className="submission-list">
                {group.items.map((item) => (
                  <SubmissionCard
                    key={item.id}
                    item={item}
                    onUpdate={props.onUpdate}
                    onShowJson={props.onShowJson}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : <div className="empty">没有匹配的接入申请。</div>}
      <Pagination page={props.data} offset={props.filters.offset} onPage={props.onPage} />
    </Panel>
  )
}

function SubmissionCard(props: {
  item: SubmissionItem
  onUpdate: (item: SubmissionItem, status: 'accepted' | 'rejected') => void
  onShowJson: (item: SubmissionItem) => void
}) {
  const formInfo = parseSubmissionNote(props.item.note)
  const location = joinFilled([props.item.province, props.item.city])
  const targets = props.item.requestedTargets?.map(targetLabel).join(' / ') || '--'

  return (
    <article className="submission-card">
      <div className="submission-card-head">
        <div>
          <Badge tone={statusTone(props.item.status)}>{props.item.status}</Badge>
          <div className="cell-meta">提交时间：{formatDate(props.item.createdAt)}</div>
        </div>
        <div className="row-actions">
          <button className="button secondary" type="button" onClick={() => props.onUpdate(props.item, 'accepted')}><Check size={16} />通过</button>
          <button className="button danger" type="button" onClick={() => props.onUpdate(props.item, 'rejected')}><X size={16} />驳回</button>
          <button className="button secondary" type="button" onClick={() => props.onShowJson(props.item)}><FileJson size={16} />原始数据</button>
        </div>
      </div>
      <div className="submission-fields">
        <SubmissionField label="学校名称" value={props.item.schoolName} />
        <SubmissionField label="教务系统网址" value={display(props.item.eduSystemWebsite || props.item.loginUrl || props.item.officialWebsite)} />
        <SubmissionField label="除账号密码外是否需要验证" value={display(formInfo.extraVerification)} />
        <SubmissionField label="是否愿意协助首个适配" value={display(formInfo.adaptationHelp)} />
        <SubmissionField label="备注说明" value={display(formInfo.note)} />
        <SubmissionField label="联系方式" value={display(formInfo.contact)} />
        <SubmissionField label="申请内容" value={targets} />
        <SubmissionField label="地区 / 官网" value={joinFilled([location, props.item.officialWebsite]) || '--'} />
      </div>
    </article>
  )
}

function SubmissionField({ label, value }: { label: string; value: string }) {
  return (
    <div className="submission-field">
      <div className="submission-field-label">{label}</div>
      <div className="submission-field-value">{value}</div>
    </div>
  )
}

function FeedbackView(props: {
  data: PageResult<FeedbackItem>
  filters: { status: string; offset: number }
  selected: FeedbackItem | null
  onFiltersChange: React.Dispatch<React.SetStateAction<{ status: string; offset: number }>>
  onSearch: () => void
  onPage: (offset: number) => void
  onSelect: (item: FeedbackItem) => void
  onShowJson: (item: FeedbackItem) => void
}) {
  return (
    <div className="split-grid">
      <Panel>
        <PanelHeader title="用户反馈" description={viewMeta.feedback.description} />
        <SimpleStatusTools
          value={props.filters.status}
          options={[['', '全部'], ['pending', '待处理'], ['processed', '已处理']]}
          onChange={(status) => props.onFiltersChange((current) => ({ ...current, status }))}
          onSearch={props.onSearch}
        />
        {props.data.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>反馈</th>
                  <th>学生</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {props.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="cell-title">{display(item.type, '反馈')}</div>
                      <div className="cell-meta">{display(item.content).slice(0, 96)}</div>
                    </td>
                    <td>
                      <div className="cell-title">{display(item.student?.name || item.account?.displayName || item.accountId)}</div>
                      <div className="cell-meta">{joinFilled([item.account?.school?.name, item.student?.studentNo]) || '--'}</div>
                    </td>
                    <td>
                      <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                      <div className="cell-meta">{formatDate(item.createdAt)}</div>
                    </td>
                    <td>
                      <button className="button secondary" type="button" onClick={() => props.onSelect(item)}><Eye size={16} />查看</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">没有匹配的用户反馈。</div>}
        <Pagination page={props.data} offset={props.filters.offset} onPage={props.onPage} />
      </Panel>
      <aside className="panel detail-panel">
        <h2>反馈详情</h2>
        {props.selected ? (
          <>
            <div className="detail-list">
              <DetailItem label="内容" value={display(props.selected.content)} />
              <DetailItem label="联系方式" value={display(props.selected.contact)} />
              <DetailItem label="学校" value={display(props.selected.account?.school?.name || props.selected.schoolId)} />
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

function SelectField(props: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  )
}

function SimpleStatusTools(props: { value: string; options: Array<[string, string]>; onChange: (value: string) => void; onSearch: () => void }) {
  return (
    <div className="panel-tools">
      <SelectField label="状态" value={props.value} options={props.options} onChange={props.onChange} />
      <button className="button primary" type="button" onClick={props.onSearch}><Search size={16} />查询</button>
    </div>
  )
}

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={'badge ' + tone}>{children}</span>
}

function Pagination({ page, offset, onPage }: { page: PageResult<unknown>; offset: number; onPage: (offset: number) => void }) {
  const start = page.items.length ? offset + 1 : 0
  const end = offset + page.items.length

  return (
    <div className="panel-tools pagination">
      <div className="cell-meta">{start} - {end} / {page.total || 0}</div>
      <button className="button secondary" type="button" disabled={offset <= 0} onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>
        <ChevronLeft size={16} />
        上一页
      </button>
      <button className="button secondary" type="button" disabled={!page.hasMore} onClick={() => onPage(offset + PAGE_SIZE)}>
        下一页
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

function JsonModal({ modal, onClose, onSubmit }: { modal: ModalState; onClose: () => void; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState(JSON.stringify(modal.value, null, 2))
  const editable = modal.mode !== 'json'

  return (
    <div className="modal-backdrop visible" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="modal">
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{modal.title}</h2>
            {modal.description && <div className="panel-description">{modal.description}</div>}
          </div>
          <button className="button ghost" type="button" aria-label="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="modal-body">
          {editable ? (
            <label className="field">
              <span>{modal.mode === 'term' ? 'termStarts JSON' : 'Provider 配置 JSON'}</span>
              <textarea value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
          ) : (
            <pre className="json-output">{value}</pre>
          )}
        </div>
        <footer className="modal-footer">
          <button className="button secondary" type="button" onClick={onClose}><X size={16} />关闭</button>
          {editable && <button className="button primary" type="button" onClick={() => onSubmit(value)}><Save size={16} />保存</button>}
        </footer>
      </section>
    </div>
  )
}
