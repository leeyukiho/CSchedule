import { requestApi } from './client'
import { CourseItem, TimetableCacheResponse } from './types'
import { getStoredDataCache, setStoredDataCache } from '../storage'

const timetableRequests = new Map<string, Promise<TimetableCacheResponse>>()

interface CacheOptions {
  forceRefresh?: boolean
}

function normalizeTimetable(response: TimetableCacheResponse): TimetableCacheResponse {
  return {
    ...response,
    courses: Array.isArray(response.courses) ? response.courses.filter(Boolean) as CourseItem[] : [],
    terms: Array.isArray(response.terms) ? response.terms : [],
    sectionTimes: Array.isArray(response.sectionTimes) ? response.sectionTimes : [],
  }
}

function getTimetableRequestKey(accountId: string, termId?: string) {
  return `${accountId}:${termId || 'latest'}`
}

export async function getTimetable(
  accountId: string,
  termId?: string,
  options: CacheOptions = {},
) {
  const cached = getStoredDataCache<TimetableCacheResponse>(
    accountId,
    'timetable',
    termId,
  )

  if (!options.forceRefresh && cached) {
    return cached.data
  }

  const requestKey = getTimetableRequestKey(accountId, termId)
  const pendingRequest = timetableRequests.get(requestKey)

  if (pendingRequest) {
    return pendingRequest
  }

  const queryParts = [
    termId ? `termId=${encodeURIComponent(termId)}` : '',
    cached?.sourceHash ? `knownHash=${encodeURIComponent(cached.sourceHash)}` : '',
  ].filter(Boolean)
  const query = queryParts.length ? `?${queryParts.join('&')}` : ''

  const request = (async () => {
    try {
      const response = await requestApi<TimetableCacheResponse>({
        path: `/account/${encodeURIComponent(accountId)}/timetable${query}`,
      })

      if (response.notModified && cached) {
        setStoredDataCache(accountId, 'timetable', cached.data, {
          termId,
          sourceHash: cached.sourceHash,
          syncedAt: cached.syncedAt,
        })
        return cached.data
      }

      const timetable = normalizeTimetable(response)
      setStoredDataCache(accountId, 'timetable', timetable, {
        termId,
        sourceHash: timetable.sourceHash,
        syncedAt: timetable.syncedAt,
      })

      if (!termId && timetable.termId) {
        setStoredDataCache(accountId, 'timetable', timetable, {
          termId: timetable.termId,
          sourceHash: timetable.sourceHash,
          syncedAt: timetable.syncedAt,
        })
      }

      return timetable
    } catch (error) {
      if (cached) {
        return cached.data
      }

      throw error
    } finally {
      timetableRequests.delete(requestKey)
    }
  })()

  timetableRequests.set(requestKey, request)

  return request
}
