import { requestApi } from './client'
import { TimetableCacheResponse } from './types'

export function getTimetable(bindingId: string, termId?: string) {
  const query = termId ? `?termId=${encodeURIComponent(termId)}` : ''

  return requestApi<TimetableCacheResponse>({
    path: `/bindings/${encodeURIComponent(bindingId)}/timetable${query}`,
  })
}
