import { requestApi } from './client'
import { CourseItem, TimetableCacheResponse } from './types'
import { clearStoredDataCacheTerms, getStoredDataCache, setStoredDataCache } from '../storage'
import { buildTermOptions, findTermOptionByValue } from '../term'
import { saveSchoolTermStartsFromResponse } from './schools'

const timetableRequests = new Map<string, Promise<TimetableCacheResponse>>()

interface CacheOptions {
  forceRefresh?: boolean
}

function normalizeTimetable(response: TimetableCacheResponse): TimetableCacheResponse {
  const normalized: TimetableCacheResponse = {
    ...response,
    courses: Array.isArray(response.courses) ? response.courses.filter(Boolean) as CourseItem[] : [],
    terms: Array.isArray(response.terms) ? response.terms : [],
    sectionTimes: Array.isArray(response.sectionTimes) ? response.sectionTimes : [],
    sectionTimeProfiles: Array.isArray(response.sectionTimeProfiles) ? response.sectionTimeProfiles : [],
  }
  // 统一 termId 口径：后端历史版本或本地旧缓存里 termId 可能是展示标签
  // （如「2026-2027学年第1学期」），这里一律归一为学期编码 id，避免与 terms[].id 对不上。
  const canonicalTermId = findTermOptionByValue(
    buildTermOptions(normalized),
    normalized.termId || '',
  )?.id

  return canonicalTermId && canonicalTermId !== normalized.termId
    ? { ...normalized, termId: canonicalTermId }
    : normalized
}

function getTimetableRequestKey(accountId: string, termId?: string) {
  return `${accountId}:${termId || 'latest'}`
}

export async function getTimetable(
  accountId: string,
  termId?: string,
  options: CacheOptions = {},
) {
  const isLatestRequest = !termId
  const cached = getStoredDataCache<TimetableCacheResponse>(
    accountId,
    'timetable',
    termId,
  )

  if (!options.forceRefresh && cached) {
    const cachedTimetable = normalizeTimetable(cached.data)
    saveSchoolTermStartsFromResponse(cachedTimetable.schoolId, cachedTimetable.termStarts)
    return cachedTimetable
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
        const timetable = {
          ...cached.data,
          termStarts: response.termStarts || cached.data.termStarts,
        }
        saveSchoolTermStartsFromResponse(timetable.schoolId, timetable.termStarts)
        setStoredDataCache(accountId, 'timetable', timetable, {
          termId,
          sourceHash: cached.sourceHash,
          syncedAt: cached.syncedAt,
        })

        if (isLatestRequest && options.forceRefresh) {
          clearStoredDataCacheTerms(accountId, 'timetable')
        }

        return timetable
      }

      const timetable = normalizeTimetable(response)
      saveSchoolTermStartsFromResponse(timetable.schoolId, timetable.termStarts)
      setStoredDataCache(accountId, 'timetable', timetable, {
        termId,
        sourceHash: timetable.sourceHash,
        syncedAt: timetable.syncedAt,
      })

      if (isLatestRequest && options.forceRefresh) {
        clearStoredDataCacheTerms(accountId, 'timetable')
      }

      return timetable
    } catch (error) {
      if (cached) {
        const cachedTimetable = normalizeTimetable(cached.data)
        saveSchoolTermStartsFromResponse(cachedTimetable.schoolId, cachedTimetable.termStarts)
        return cachedTimetable
      }

      throw error
    } finally {
      timetableRequests.delete(requestKey)
    }
  })()

  timetableRequests.set(requestKey, request)

  return request
}
