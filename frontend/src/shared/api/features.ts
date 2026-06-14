import { requestApi } from './client'
import { FeatureCacheResponse, ProfileData } from './types'

function normalizeFeatureCache<TData = unknown>(response: FeatureCacheResponse<TData>): FeatureCacheResponse<TData> {
  return {
    ...response,
    meta: response.meta ?? {},
  }
}

export async function getScores(accountId: string, termId?: string) {
  const query = termId ? `?termId=${encodeURIComponent(termId)}` : ''

  const response = await requestApi<FeatureCacheResponse>({
    path: `/account/${encodeURIComponent(accountId)}/scores${query}`,
  })

  return normalizeFeatureCache(response)
}

export async function getExams(accountId: string, termId?: string) {
  const query = termId ? `?termId=${encodeURIComponent(termId)}` : ''

  const response = await requestApi<FeatureCacheResponse>({
    path: `/account/${encodeURIComponent(accountId)}/exams${query}`,
  })

  return normalizeFeatureCache(response)
}

export async function getProfile(accountId: string) {
  const response = await requestApi<FeatureCacheResponse<ProfileData>>({
    path: `/account/${encodeURIComponent(accountId)}/profile`,
  })

  return {
    ...normalizeFeatureCache(response),
    data: response.data && typeof response.data === 'object' && !Array.isArray(response.data)
      ? response.data
      : {},
  }
}

export function saveProfile(accountId: string, profile: ProfileData) {
  return requestApi<FeatureCacheResponse<ProfileData>, { profile: ProfileData }>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/profile`,
    data: { profile },
  })
}
