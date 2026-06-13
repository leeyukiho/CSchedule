import { requestApi } from './client'
import { DataTarget, SyncJobResponse } from './types'

export function createManualSync(
  bindingId: string,
  target: DataTarget,
  data?: { username?: string; password?: string; semesterId?: string },
) {
  return requestApi<SyncJobResponse, typeof data>({
    method: 'POST',
    path: `/bindings/${encodeURIComponent(bindingId)}/sync/${target}`,
    data,
  })
}

export function getSyncJob(jobId: string) {
  return requestApi<SyncJobResponse>({
    path: `/sync/${encodeURIComponent(jobId)}`,
  })
}
