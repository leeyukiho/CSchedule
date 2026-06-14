import { requestApi } from './client'
import { CourseItem, TimetableCacheResponse } from './types'

function normalizeTimetable(response: TimetableCacheResponse): TimetableCacheResponse {
  return {
    ...response,
    courses: Array.isArray(response.courses) ? response.courses.filter(Boolean) as CourseItem[] : [],
    terms: Array.isArray(response.terms) ? response.terms : [],
    sectionTimes: Array.isArray(response.sectionTimes) ? response.sectionTimes : [],
  }
}

export async function getTimetable(accountId: string, termId?: string) {
  const query = termId ? `?termId=${encodeURIComponent(termId)}` : ''

  const response = await requestApi<TimetableCacheResponse>({
    path: `/account/${encodeURIComponent(accountId)}/timetable${query}`,
  })

  return normalizeTimetable(response)
}
