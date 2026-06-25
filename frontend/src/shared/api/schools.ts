import { requestApi } from './client'
import { LoginContextResponse, SchoolListResponse, SchoolTermStartsResponse, SchoolWeatherResponse } from './types'
import { setStoredSchoolTermStarts } from '../storage'

export interface ListSchoolsOptions {
  keyword?: string
  enabledOnly?: boolean
  limit?: number
  offset?: number
  fields?: 'full' | 'summary'
}

const SCHOOL_LIST_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_SCHOOL_LIST_FIELDS: NonNullable<ListSchoolsOptions['fields']> = 'summary'
const schoolListCache = new Map<string, {
  expiresAt: number
  value: SchoolListResponse
}>()
const schoolListRequests = new Map<string, Promise<SchoolListResponse>>()
const schoolTermStartsRequests = new Map<string, Promise<SchoolTermStartsResponse>>()

function createSchoolListCacheKey(options: ListSchoolsOptions) {
  return JSON.stringify({
    keyword: options.keyword?.trim() || '',
    enabledOnly: options.enabledOnly ?? true,
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    fields: options.fields || DEFAULT_SCHOOL_LIST_FIELDS,
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

  params.set('fields', options.fields || DEFAULT_SCHOOL_LIST_FIELDS)

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

export function saveSchoolTermStartsFromResponse(
  schoolId: string,
  termStarts?: Record<string, string>,
  updatedAt?: string,
) {
  if (!schoolId || !termStarts) {
    return
  }

  setStoredSchoolTermStarts(schoolId, termStarts, { updatedAt })
}

export async function refreshSchoolTermStarts(schoolId: string) {
  const cleanSchoolId = schoolId.trim()

  if (!cleanSchoolId) {
    return null
  }

  const pending = schoolTermStartsRequests.get(cleanSchoolId)

  if (pending) {
    return pending
  }

  const request = requestApi<SchoolTermStartsResponse>({
    path: `/schools/${encodeURIComponent(cleanSchoolId)}/term-starts`,
  })
    .then((response) => {
      saveSchoolTermStartsFromResponse(response.schoolId, response.termStarts, response.updatedAt)
      return response
    })
    .finally(() => {
      schoolTermStartsRequests.delete(cleanSchoolId)
    })

  schoolTermStartsRequests.set(cleanSchoolId, request)
  return request
}

export function getSchoolWeather(schoolId: string) {
  return requestApi<SchoolWeatherResponse>({
    path: `/schools/${encodeURIComponent(schoolId)}/weather`,
  })
}
