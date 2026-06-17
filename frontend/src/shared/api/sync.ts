import { requestApi } from './client'
import { DataTarget, SyncJobResponse } from './types'

interface SyncJobOptions {
  includeCache?: boolean
}

export function createManualSync(
  accountId: string,
  target: DataTarget,
  data?: { username?: string; password?: string; semesterId?: string },
) {
  return requestApi<SyncJobResponse, typeof data>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/sync/${target}`,
    data,
  })
}

export function getSyncJob(jobId: string, options: SyncJobOptions = {}) {
  const query = options.includeCache ? '?includeCache=1' : ''

  return requestApi<SyncJobResponse>({
    path: `/sync/${encodeURIComponent(jobId)}${query}`,
  })
}
