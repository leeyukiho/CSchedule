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
  bindingId: string
  target: DataTarget
  cacheId: string
  status: 'cached'
  parsedCount: number
  warnings?: string[]
}

export interface WebviewSyncCompleteResponse {
  bindingId: string
  status: 'ready' | 'partial'
  canCloseWebview: boolean
  sessionReusable?: boolean
  sessionExpireAt?: string
  missingRequiredTargets: DataTarget[]
}

export function uploadRawData(bindingId: string, data: RawDataUploadRequest) {
  return requestApi<RawDataUploadResponse, RawDataUploadRequest>({
    method: 'POST',
    path: `/bindings/${encodeURIComponent(bindingId)}/raw-data`,
    data,
  })
}

export function completeWebviewSync(
  bindingId: string,
  data: { contextId?: string; completedTargets: DataTarget[] },
) {
  return requestApi<WebviewSyncCompleteResponse, typeof data>({
    method: 'POST',
    path: `/bindings/${encodeURIComponent(bindingId)}/webview-sync/complete`,
    data,
  })
}
