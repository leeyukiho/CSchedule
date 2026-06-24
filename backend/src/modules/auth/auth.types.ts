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

export interface LoginCloudProof {
  version: 1
  source: 'frontend_cloud_import'
  schoolId: string
  providerId: string
  contextId: string
  targets: DataTarget[]
  resultHash: string
  issuedAt: string
  expiresAt: string
  signature: string
}

export interface LoginSubmitRequest {
  accountId?: string
  contextId: string
  username?: string
  password?: string
  captcha?: string
  credentialSaveMode?: 'none' | 'password_vault'
  verifiedByCloud?: boolean
  cacheResults?: LoginCacheResult[]
  cloudProof?: LoginCloudProof
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
  accountAccessToken?: string
  accountAccessTokenExpiresAt?: string
}
