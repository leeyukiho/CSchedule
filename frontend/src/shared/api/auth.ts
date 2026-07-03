import { requestApi } from './client'
import {
  CloudImportProof,
  DataTarget,
  FeatureCacheResponse,
  TimetableCacheResponse,
} from './types'

export interface LoginSubmitRequest {
  accountId?: string
  contextId: string
  username?: string
  password?: string
  captcha?: string
  credentialSaveMode?: 'none' | 'password_vault'
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
  cloudProof?: CloudImportProof
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
  accountAccessToken?: string
  accountAccessTokenExpiresAt?: string
  cacheResults?: Array<{
    target: DataTarget
    cacheData: TimetableCacheResponse | FeatureCacheResponse
  }>
}

export type QrcodeLoginStatus =
  | 'pending'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  | 'failed'
  | 'cancelled'

export interface QrcodeLoginCreateResponse {
  sessionId: string
  status: QrcodeLoginStatus
  qrcodeImage?: string
  qrcodeUrl?: string
  expiresAt: string
  pollIntervalMs: number
  title?: string
  notice?: string
}

export interface QrcodeLoginStatusResponse {
  sessionId: string
  status: QrcodeLoginStatus
  expiresAt: string
  message?: string
  confirmedAt?: string
}

export function submitLogin(schoolId: string, data: LoginSubmitRequest) {
  return requestApi<LoginSubmitResponse, LoginSubmitRequest>({
    method: 'POST',
    path: `/schools/${encodeURIComponent(schoolId)}/login`,
    data,
  })
}

export function createQrcodeLoginSession(schoolId: string) {
  return requestApi<QrcodeLoginCreateResponse>({
    method: 'POST',
    path: `/schools/${encodeURIComponent(schoolId)}/qrcode-login`,
  })
}

export function getQrcodeLoginStatus(schoolId: string, sessionId: string) {
  return requestApi<QrcodeLoginStatusResponse>({
    method: 'POST',
    path:
      `/schools/${encodeURIComponent(schoolId)}/qrcode-login/` +
      `${encodeURIComponent(sessionId)}/status`,
  })
}

export function cancelQrcodeLoginSession(schoolId: string, sessionId: string) {
  return requestApi<QrcodeLoginStatusResponse>({
    method: 'POST',
    path:
      `/schools/${encodeURIComponent(schoolId)}/qrcode-login/` +
      `${encodeURIComponent(sessionId)}/cancel`,
  })
}
