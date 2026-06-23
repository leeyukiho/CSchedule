import { DataTarget } from '../providers/provider.types'

export type LoginCacheData = Record<string, unknown>

export interface LoginCacheResult {
  target: DataTarget
  cacheData: LoginCacheData
  parsedCount?: number
  termId?: string
  sourceHash?: string
  syncedAt?: string
  warnings?: string[]
}

export interface LoginSubmitRequest {
  accountId?: string
  contextId: string
  username?: string
  password?: string
  captcha?: string
  credentialSaveMode?: 'none' | 'password_vault'
  wechatOpenid?: string
  verifiedByCloud?: boolean
  cacheResults?: LoginCacheResult[]
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
  cacheResults?: Array<{
    target: DataTarget
    cacheData: Record<string, unknown>
  }>
}
