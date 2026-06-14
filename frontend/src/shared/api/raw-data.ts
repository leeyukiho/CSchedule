import { requestApi } from './client'
import { DataAccessMode, DataTarget } from './types'

export interface RawDataUploadRequest {
  contextId?: string
  target: DataTarget
  accessMode: Extract<DataAccessMode, 'webview_client_fetch' | 'manual_import'>
  termId?: string
  contentType: 'json' | 'html' | 'text' | 'csv' | 'xlsx' | 'ics' | 'pdf'
  sourceUrl?: string
  payload: unknown
  meta?: Record<string, unknown>
}

export interface RawDataUploadResponse {
  accountId: string
  target: DataTarget
  cacheId: string
  status: 'cached'
  parsedCount: number
  warnings?: string[]
}

export interface WebviewSyncCompleteResponse {
  accountId: string
  status: 'ready' | 'partial'
  canCloseWebview: boolean
  sessionReusable?: boolean
  sessionExpireAt?: string
  missingRequiredTargets: DataTarget[]
}

export function uploadRawData(accountId: string, data: RawDataUploadRequest) {
  return requestApi<RawDataUploadResponse, RawDataUploadRequest>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/raw-data`,
    data,
  })
}

export function completeWebviewSync(
  accountId: string,
  data: { contextId?: string; completedTargets: DataTarget[] },
) {
  return requestApi<WebviewSyncCompleteResponse, typeof data>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/webview-sync/complete`,
    data,
  })
}
