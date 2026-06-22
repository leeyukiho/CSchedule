import { requestApi } from './client'
import { DataTarget } from './types'

export interface LoginSubmitRequest {
  accountId?: string
  contextId: string
  username?: string
  password?: string
  captcha?: string
  credentialSaveMode?: 'none' | 'password_vault'
  wechatOpenid?: string
  verifiedByCloud?: boolean
  cacheResults?: Array<{
    target: DataTarget
    cacheData: Record<string, unknown>
    parsedCount?: number
    termId?: string
    sourceHash?: string
    syncedAt?: string
    warnings?: string[]
  }>
  cloudWarnings?: string[]
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
  savedTargets?: DataTarget[]
}

export function submitLogin(schoolId: string, data: LoginSubmitRequest) {
  return requestApi<LoginSubmitResponse, LoginSubmitRequest>({
    method: 'POST',
    path: `/schools/${encodeURIComponent(schoolId)}/login`,
    data,
  })
}
