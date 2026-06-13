import { requestApi } from './client'
import { LoginContextResponse, SchoolListItem, SchoolListResponse } from './types'

export interface ListSchoolsOptions {
  keyword?: string
  enabledOnly?: boolean
  limit?: number
  offset?: number
}

export async function listSchools(options: ListSchoolsOptions = {}) {
  const params = new URLSearchParams()

  if (options.keyword) {
    params.set('keyword', options.keyword)
  }

  if (options.enabledOnly !== undefined) {
    params.set('enabledOnly', String(options.enabledOnly))
  }

  if (options.limit) {
    params.set('limit', String(options.limit))
  }

  if (options.offset) {
    params.set('offset', String(options.offset))
  }

  const query = params.toString() ? `?${params.toString()}` : ''
  const response = await requestApi<SchoolListResponse | SchoolListItem[]>({
    path: `/schools${query}`,
  })

  return Array.isArray(response)
    ? { items: response, total: response.length, limit: response.length, offset: 0, hasMore: false }
    : response
}

export function createLoginContext(schoolId: string) {
  return requestApi<LoginContextResponse>({
    method: 'POST',
    path: `/schools/${encodeURIComponent(schoolId)}/login-context`,
  })
}
