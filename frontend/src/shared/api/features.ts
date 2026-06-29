import { requestApi } from './client'
import { DataTarget, FeatureCacheResponse, ProfileData } from './types'
import {
  clearStoredDataCacheTerms,
  getStoredAccountSummary,
  getStoredDataCache,
  setStoredDataCache,
} from '../storage'

type FeatureTarget = Exclude<DataTarget, 'course'>
const featureRequests = new Map<string, Promise<FeatureCacheResponse<unknown>>>()

interface CacheOptions {
  forceRefresh?: boolean
}

function normalizeFeatureCache<TData = unknown>(response: FeatureCacheResponse<TData>): FeatureCacheResponse<TData> {
  return {
    ...response,
    meta: response.meta ?? {},
  }
}

function getFeatureRequestKey(accountId: string, target: FeatureTarget, termId?: string) {
  return `${accountId}:${target}:${termId || 'latest'}`
}

function getEmptyFeatureCache<TData = unknown>(
  accountId: string,
  target: FeatureTarget,
  termId?: string,
): FeatureCacheResponse<TData> {
  const account = getStoredAccountSummary(accountId)

  return {
    accountId,
    schoolId: account?.schoolId || '',
    providerId: account?.providerId || '',
    target,
    termId,
    data: null,
    meta: {},
    session: {
      sessionReusable: Boolean(account?.sessionReusable),
      sessionRefreshable: Boolean(account?.sessionRefreshable),
      sessionExpireAt: account?.sessionExpireAt,
      accountStatus: account?.status || 'cached_only',
    },
  }
}

async function getFeatureWithCache<TData = unknown>(
  accountId: string,
  target: FeatureTarget,
  basePath: string,
  termId?: string,
  options: CacheOptions = {},
) {
  const cached = getStoredDataCache<FeatureCacheResponse<TData>>(
    accountId,
    target,
    termId,
  )

  if (!options.forceRefresh && cached) {
    return cached.data
  }

  if (!options.forceRefresh) {
    return getEmptyFeatureCache<TData>(accountId, target, termId)
  }

  const requestKey = getFeatureRequestKey(accountId, target, termId)
  const pendingRequest = featureRequests.get(requestKey) as
    | Promise<FeatureCacheResponse<TData>>
    | undefined

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
      const response = await requestApi<FeatureCacheResponse<TData>>({
        path: `${basePath}${query}`,
      })

      if (response.notModified && cached) {
        setStoredDataCache(accountId, target, cached.data, {
          termId,
          sourceHash: cached.sourceHash,
          syncedAt: cached.syncedAt,
        })

        if (!termId) {
          clearStoredDataCacheTerms(accountId, target)
        }

        return cached.data
      }

      const feature = normalizeFeatureCache(response)
      setStoredDataCache(accountId, target, feature, {
        termId,
        sourceHash: feature.sourceHash,
        syncedAt: feature.syncedAt,
      })

      if (!termId && feature.termId) {
        clearStoredDataCacheTerms(accountId, target)
        setStoredDataCache(accountId, target, feature, {
          termId: feature.termId,
          sourceHash: feature.sourceHash,
          syncedAt: feature.syncedAt,
        })
      }

      return feature
    } catch (error) {
      if (cached) {
        return cached.data
      }

      throw error
    } finally {
      featureRequests.delete(requestKey)
    }
  })()

  featureRequests.set(requestKey, request as Promise<FeatureCacheResponse<unknown>>)

  return request
}

export async function getScores(
  accountId: string,
  termId?: string,
  options: CacheOptions = {},
) {
  return getFeatureWithCache(
    accountId,
    'score',
    `/account/${encodeURIComponent(accountId)}/scores`,
    termId,
    options,
  )
}

export async function getExams(
  accountId: string,
  termId?: string,
  options: CacheOptions = {},
) {
  return getFeatureWithCache(
    accountId,
    'exam',
    `/account/${encodeURIComponent(accountId)}/exams`,
    termId,
    options,
  )
}

export async function getProfile(accountId: string) {
  const response = await getFeatureWithCache<ProfileData>(
    accountId,
    'profile',
    `/account/${encodeURIComponent(accountId)}/profile`,
  )

  const profile = {
    ...response,
    data: response.data && typeof response.data === 'object' && !Array.isArray(response.data)
      ? response.data
      : {},
  }

  setStoredDataCache(accountId, 'profile', profile, {
    sourceHash: profile.sourceHash,
    syncedAt: profile.syncedAt,
  })

  return profile
}

export async function saveProfile(accountId: string, profile: ProfileData) {
  const response = await requestApi<FeatureCacheResponse<ProfileData>, { profile: ProfileData }>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/profile`,
    data: { profile },
  })
  const feature = normalizeFeatureCache(response)

  setStoredDataCache(accountId, 'profile', feature, {
    sourceHash: feature.sourceHash,
    syncedAt: feature.syncedAt,
  })

  return feature
}
