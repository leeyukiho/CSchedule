import { requestApi } from './client'
import { FeatureCacheResponse, ProfileData } from './types'

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
  return requestApi<FeatureCacheResponse<ProfileData>>({
    path: `/bindings/${encodeURIComponent(bindingId)}/profile`,
  })
}

export function saveProfile(bindingId: string, profile: ProfileData) {
  return requestApi<FeatureCacheResponse<ProfileData>, { profile: ProfileData }>({
    method: 'POST',
    path: `/bindings/${encodeURIComponent(bindingId)}/profile`,
    data: { profile },
  })
}
