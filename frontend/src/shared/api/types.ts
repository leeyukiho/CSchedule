export type LoginMode =
  | 'direct_password'
  | 'password_captcha'
  | 'cas_simple'
  | 'cas_webview'
  | 'oauth_webview'
  | 'qrcode'

export type DataAccessMode =
  | 'server_session'
  | 'webview_client_fetch'
  | 'session_import'
  | 'manual_import'

export type DataTarget = 'course' | 'score' | 'exam' | 'profile'

export type SchoolStatus =
  | 'catalog_only'
  | 'candidate'
  | 'researching'
  | 'beta'
  | 'enabled'
  | 'disabled'

export interface ProviderCapabilities {
  course: boolean
  score: boolean
  exam: boolean
  profile: boolean
}

export type FeatureDisplayKind =
  | 'course_grid'
  | 'profile_fields'
  | 'score_semesters'
  | 'exam_list'
  | 'raw'

export interface FeatureDisplayField {
  key: string
  label: string
  visible?: boolean
  editable?: boolean
  primary?: boolean
  fallbackKeys?: string[]
}

export interface FeatureDisplayConfig {
  title?: string
  kind?: FeatureDisplayKind
  summaryFields?: FeatureDisplayField[]
  detailFields?: FeatureDisplayField[]
  editableFields?: FeatureDisplayField[]
  itemFields?: FeatureDisplayField[]
  itemPath?: string
  groupPath?: string
  emptyText?: string
}

export interface SchoolListItem {
  id: string
  name: string
  shortName?: string
  city?: string
  province?: string
  catalogCode?: string
  level?: string
  isPrivate?: boolean
  status: SchoolStatus
  enabled: boolean
  loginMode?: LoginMode
  dataAccess?: Record<DataTarget, DataAccessMode[]>
  capabilities: ProviderCapabilities
  message?: string
}

export interface SchoolListResponse {
  items: SchoolListItem[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface BindingSessionSummary {
  sessionReusable: boolean
  sessionRefreshable: boolean
  sessionExpireAt?: string
  bindingStatus: 'active' | 'need_login' | 'cached_only' | 'disabled' | 'unbound'
}

export interface LoginField {
  name: string
  label: string
  type: 'text' | 'password' | 'captcha' | 'select' | 'hidden'
  required: boolean
  placeholder?: string
}

export interface LoginContextResponse {
  contextId: string
  mode: LoginMode
  fields: LoginField[]
  captcha?: {
    id: string
    imageBase64?: string
    refreshable: boolean
  }
  webview?: {
    url: string
    successUrlPatterns: string[]
    failureUrlPatterns?: string[]
    callbackMode: 'session_import' | 'webview_client_fetch' | 'manual_confirm'
    requiredFetchTargets?: DataTarget[]
    closeAfterCacheWritten: boolean
  }
  expireAt: string
}

export interface CourseItem {
  id?: string
  name?: string
  teacher?: string
  location?: string
  classroom?: string
  weekday?: number
  sections?: number[]
  startSection?: number
  endSection?: number
  weeks?: number[]
}

export interface TimetableCacheResponse {
  bindingId: string
  schoolId: string
  providerId: string
  termId?: string
  courses: CourseItem[]
  terms: unknown[]
  sectionTimes: unknown[]
  display?: FeatureDisplayConfig
  syncedAt?: string
  session: BindingSessionSummary
}

export interface FeatureCacheResponse<TData = unknown> {
  bindingId: string
  schoolId: string
  providerId: string
  target: Exclude<DataTarget, 'course'>
  termId?: string
  data: TData | null
  meta: unknown
  display?: FeatureDisplayConfig
  syncedAt?: string
  session: BindingSessionSummary
}

export interface ProfileData {
  name?: string
  studentId?: string
  maskedStudentId?: string
  major?: string
  grade?: string
  level?: string
  className?: string
  gender?: string
  birthDate?: string
  politicalStatus?: string
  phone?: string
  email?: string
  nativePlace?: string
  enrollmentDate?: string
  studentStatus?: string
  dormitory?: string
  counselor?: string
  avatarUrl?: string
  [key: string]: string | undefined
}

export interface BindingSummary {
  id: string
  userId: string
  schoolId: string
  providerId: string
  displayName?: string
  status: BindingSessionSummary['bindingStatus']
  sessionReusable: boolean
  sessionRefreshable: boolean
  sessionExpireAt?: string
  lastLoginAt?: string
  lastCachedAt?: string
  school?: {
    id: string
    name: string
    shortName?: string
  }
}

export interface SyncJobResponse {
  jobId: string
  bindingId: string
  target: DataTarget
  status:
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'need_login'
    | 'need_webview_fetch'
    | 'cancelled'
}

export interface SubmitFeedbackResponse {
  id: string
  status: string
  createdAt: string
}

export interface SchoolSubmissionResponse {
  id: string
  status: string
  createdAt: string
}
