import { requestApi } from './client'
import { FeatureCacheResponse } from './types'

export function getScores(bindingId: string, termId?: string) {
  const query = termId ? `?termId=${encodeURIComponent(termId)}` : ''

  return requestApi<FeatureCacheResponse>({
    path: `/bindings/${encodeURIComponent(bindingId)}/scores${query}`,
  })
}

export function getExams(bindingId: string, termId?: string) {
  const query = termId ? `?termId=${encodeURIComponent(termId)}` : ''

  return requestApi<FeatureCacheResponse>({
    path: `/bindings/${encodeURIComponent(bindingId)}/exams${query}`,
  })
}

export function getProfile(bindingId: string) {
  return requestApi<FeatureCacheResponse>({
    path: `/bindings/${encodeURIComponent(bindingId)}/profile`,
  })
}

