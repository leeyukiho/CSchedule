import { requestApi } from './client'
import { LoginContextResponse, SchoolListResponse } from './types'

export interface ListSchoolsOptions {
  keyword?: string
  enabledOnly?: boolean
  limit?: number
  offset?: number
  fields?: 'full' | 'summary'
}

const SCHOOL_LIST_CACHE_TTL_MS = 5 * 60 * 1000
const schoolListCache = new Map<string, {
  expiresAt: number
  value: SchoolListResponse
}>()
const schoolListRequests = new Map<string, Promise<SchoolListResponse>>()

function createSchoolListCacheKey(options: ListSchoolsOptions) {
  return JSON.stringify({
    keyword: options.keyword?.trim() || '',
    enabledOnly: options.enabledOnly ?? true,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    fields: options.fields || 'full',
  })
}

export async function listSchools(options: ListSchoolsOptions = {}) {
  const cacheKey = createSchoolListCacheKey(options)
  const cached = schoolListCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const pending = schoolListRequests.get(cacheKey)

  if (pending) {
    return pending
  }

  const params = new URLSearchParams()

  if (options.keyword) {
    params.set('keyword', options.keyword.trim())
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

  if (options.fields) {
    params.set('fields', options.fields)
  }

  const query = params.toString() ? `?${params.toString()}` : ''
  const request = requestApi<SchoolListResponse>({
    path: `/schools${query}`,
  })
    .then((response) => {
      schoolListCache.set(cacheKey, {
        expiresAt: Date.now() + SCHOOL_LIST_CACHE_TTL_MS,
        value: response,
      })
      return response
    })
    .finally(() => {
      schoolListRequests.delete(cacheKey)
    })

  schoolListRequests.set(cacheKey, request)
  return request
}

export function createLoginContext(schoolId: string) {
  return requestApi<LoginContextResponse>({
    method: 'POST',
    path: `/schools/${encodeURIComponent(schoolId)}/login-context`,
  })
}
