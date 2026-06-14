import { requestApi } from './client'
import { DataTarget } from './types'

export interface LoginSubmitRequest {
  contextId: string
  username?: string
  password?: string
  captcha?: string
  extra?: Record<string, unknown>
}

export interface LoginSubmitResponse {
  accountId: string
  sessionId?: string
  status: 'success' | 'cached' | 'need_webview_fetch'
  sessionReusable?: boolean
  sessionExpireAt?: string
  requiredFetchTargets?: DataTarget[]
  cacheId?: string
  parsedCount?: number
}

export interface SessionImportFallbackResponse {
  status: 'need_webview_client_fetch'
  accountId: string
  requiredFetchTargets: DataTarget[]
  message: string
}

export function submitLogin(schoolId: string, data: LoginSubmitRequest) {
  return requestApi<LoginSubmitResponse, LoginSubmitRequest>({
    method: 'POST',
    path: `/schools/${encodeURIComponent(schoolId)}/login`,
    data,
  })
}

export function importSession(
  schoolId: string,
  data: { contextId?: string; accountId?: string; session?: unknown },
) {
  return requestApi<SessionImportFallbackResponse, typeof data>({
    method: 'POST',
    path: `/schools/${encodeURIComponent(schoolId)}/session-import`,
    data,
  })
}
