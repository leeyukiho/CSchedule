import Taro from '@tarojs/taro'

import type { StudentAccountSummary } from './api/types'

const AUTH_STATE_KEY = 'cschedule.authState'
const TERM_STARTS_KEY = 'cschedule.termStarts'
const SCHOOL_TERM_STARTS_PREFIX = 'cschedule.schoolTermStarts.'
const ACCOUNT_TERM_STARTS_PREFIX = 'cschedule.accountTermStarts.'
const DATA_CACHE_PREFIX = 'cschedule.dataCache.'
const ACCOUNT_SUMMARY_PREFIX = 'cschedule.accountSummary.'

export type DataCacheTarget = 'timetable' | 'score' | 'exam' | 'profile'

export interface StoredDataCache<TData = unknown> {
  data: TData
  sourceHash?: string
  syncedAt?: string
  cachedAt: string
}

export interface StoredAuthState {
  accountId: string
  schoolId: string
  accountAccessToken?: string
  accountAccessTokenExpiresAt?: string
  updatedAt: string
}

function normalizeAuthState(value: unknown): StoredAuthState {
  const state = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<StoredAuthState>)
    : {}

  const accountId = typeof state.accountId === 'string' ? state.accountId : ''

  if (accountId && typeof state.schoolId === 'string') {
    return {
      accountId,
      schoolId: state.schoolId,
      accountAccessToken:
        typeof state.accountAccessToken === 'string'
          ? state.accountAccessToken
          : undefined,
      accountAccessTokenExpiresAt:
        typeof state.accountAccessTokenExpiresAt === 'string'
          ? state.accountAccessTokenExpiresAt
          : undefined,
      updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : '',
    }
  }

  return { accountId: '', schoolId: '', updatedAt: '' }
}

export function getStoredAuthState(): StoredAuthState {
  return normalizeAuthState(Taro.getStorageSync(AUTH_STATE_KEY))
}

export function getStoredAccountId() {
  return getStoredAuthState().accountId
}

export function getStoredAccountAccessToken(accountId = getStoredAccountId()) {
  const state = getStoredAuthState()

  if (!state.accountAccessToken || (accountId && state.accountId !== accountId)) {
    return ''
  }

  if (
    state.accountAccessTokenExpiresAt &&
    Date.parse(state.accountAccessTokenExpiresAt) <= Date.now()
  ) {
    return ''
  }

  return state.accountAccessToken
}

export function setStoredAccountId(
  accountId: string,
  schoolId = '',
  accountAccessToken?: string,
  accountAccessTokenExpiresAt?: string,
) {
  const current = getStoredAuthState()
  const canReuseCurrentToken = current.accountId === accountId
  const token = accountAccessToken || (canReuseCurrentToken ? current.accountAccessToken : undefined)
  const expiresAt =
    accountAccessToken
      ? accountAccessTokenExpiresAt
      : canReuseCurrentToken
        ? current.accountAccessTokenExpiresAt
        : undefined

  Taro.setStorageSync(AUTH_STATE_KEY, {
    accountId,
    schoolId,
    ...(token ? { accountAccessToken: token } : {}),
    ...(expiresAt ? { accountAccessTokenExpiresAt: expiresAt } : {}),
    updatedAt: new Date().toISOString(),
  })
}

export function clearStoredAccountId() {
  Taro.removeStorageSync(AUTH_STATE_KEY)
}

function getAccountSummaryKey(accountId: string) {
  return `${ACCOUNT_SUMMARY_PREFIX}${accountId}`
}

function normalizeAccountSummary(value: unknown): StudentAccountSummary | null {
  const account = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<StudentAccountSummary>)
    : {}

  if (typeof account.id !== 'string' || !account.id) {
    return null
  }

  if (typeof account.schoolId !== 'string' || typeof account.providerId !== 'string') {
    return null
  }

  const school = account.school && typeof account.school === 'object' && !Array.isArray(account.school)
    ? (account.school as Record<string, unknown>)
    : null
  const weatherLocation = school && school.weatherLocation && typeof school.weatherLocation === 'object' && !Array.isArray(school.weatherLocation)
    ? (school.weatherLocation as Record<string, unknown>)
    : null
  const latitude = getFiniteNumber(weatherLocation?.latitude)
  const longitude = getFiniteNumber(weatherLocation?.longitude)

  return {
    id: account.id,
    schoolId: account.schoolId,
    providerId: account.providerId,
    displayName: typeof account.displayName === 'string' ? account.displayName : undefined,
    status: account.status || 'active',
    credentialSaveMode: account.credentialSaveMode,
    sessionReusable: Boolean(account.sessionReusable),
    sessionRefreshable: Boolean(account.sessionRefreshable),
    sessionExpireAt: typeof account.sessionExpireAt === 'string' ? account.sessionExpireAt : undefined,
    lastLoginAt: typeof account.lastLoginAt === 'string' ? account.lastLoginAt : undefined,
    lastCachedAt: typeof account.lastCachedAt === 'string' ? account.lastCachedAt : undefined,
    syncStrategy: account.syncStrategy && typeof account.syncStrategy === 'object' && !Array.isArray(account.syncStrategy)
      ? account.syncStrategy
      : undefined,
    school: school
      ? {
          id: String(school.id || account.schoolId),
          name: String(school.name || ''),
          shortName: typeof school.shortName === 'string' ? school.shortName : undefined,
          ...(latitude !== undefined && longitude !== undefined
            ? {
                weatherLocation: {
                  displayName: typeof weatherLocation?.displayName === 'string' && weatherLocation.displayName.trim()
                    ? weatherLocation.displayName.trim()
                    : undefined,
                  latitude,
                  longitude,
                },
              }
            : {}),
        }
      : undefined,
  }
}

function getFiniteNumber(value: unknown) {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN

  return Number.isFinite(numberValue) ? numberValue : undefined
}

export function getStoredAccountSummary(accountId: string) {
  if (!accountId) {
    return null
  }

  return normalizeAccountSummary(Taro.getStorageSync(getAccountSummaryKey(accountId)))
}

export function setStoredAccountSummary(account: StudentAccountSummary) {
  if (!account.id) {
    return
  }

  Taro.setStorageSync(getAccountSummaryKey(account.id), account)
}

export function clearStoredAccountSummary(accountId?: string) {
  if (accountId) {
    Taro.removeStorageSync(getAccountSummaryKey(accountId))
    return
  }

  const info = Taro.getStorageInfoSync()

  for (const key of info.keys || []) {
    if (key.startsWith(ACCOUNT_SUMMARY_PREFIX)) {
      Taro.removeStorageSync(key)
    }
  }
}

function normalizeTermStarts(value: unknown): Record<string, string> {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
  const wrappedTermStarts = record.termStarts
  const source = wrappedTermStarts && typeof wrappedTermStarts === 'object' && !Array.isArray(wrappedTermStarts)
    ? (wrappedTermStarts as Record<string, unknown>)
    : record
  const result: Record<string, string> = {}

  for (const [key, date] of Object.entries(source)) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result[key] = date
    }
  }

  return result
}

function getSchoolTermStartsKey(schoolId: string) {
  return `${SCHOOL_TERM_STARTS_PREFIX}${schoolId}`
}

function getAccountTermStartsKey(accountId: string) {
  return `${ACCOUNT_TERM_STARTS_PREFIX}${accountId}`
}

function migrateLegacyTermStarts(accountId: string) {
  if (!accountId) {
    return
  }

  const legacyStarts = normalizeTermStarts(Taro.getStorageSync(TERM_STARTS_KEY))

  if (Object.keys(legacyStarts).length === 0) {
    return
  }

  const existingStarts = normalizeTermStarts(Taro.getStorageSync(getAccountTermStartsKey(accountId)))

  Taro.setStorageSync(getAccountTermStartsKey(accountId), {
    ...legacyStarts,
    ...existingStarts,
  })
  Taro.removeStorageSync(TERM_STARTS_KEY)
}

export function getStoredSchoolTermStarts(schoolId = getStoredAuthState().schoolId) {
  if (!schoolId) {
    return {}
  }

  return normalizeTermStarts(Taro.getStorageSync(getSchoolTermStartsKey(schoolId)))
}

export function setStoredSchoolTermStarts(
  schoolId: string,
  termStarts: Record<string, string> = {},
  options: { updatedAt?: string } = {},
) {
  if (!schoolId) {
    return
  }

  Taro.setStorageSync(getSchoolTermStartsKey(schoolId), {
    termStarts: normalizeTermStarts(termStarts),
    updatedAt: options.updatedAt,
    cachedAt: new Date().toISOString(),
  })
}

export function getStoredUserTermStarts(accountId = getStoredAccountId()) {
  if (!accountId) {
    return {}
  }

  migrateLegacyTermStarts(accountId)

  return normalizeTermStarts(Taro.getStorageSync(getAccountTermStartsKey(accountId)))
}

export function getStoredTermStarts(
  accountId = getStoredAuthState().accountId,
  schoolId = getStoredAuthState().schoolId,
) {
  return {
    ...getStoredSchoolTermStarts(schoolId),
    ...getStoredUserTermStarts(accountId),
  }
}

export function setStoredTermStart(
  termId: string,
  startDate: string,
  accountId = getStoredAccountId(),
) {
  if (!accountId) {
    return
  }

  const starts = getStoredUserTermStarts(accountId)

  if (!termId) {
    return
  }

  if (startDate) {
    starts[termId] = startDate
  } else {
    delete starts[termId]
  }

  Taro.setStorageSync(getAccountTermStartsKey(accountId), starts)
}

export function clearStoredTermStarts(accountId = getStoredAccountId()) {
  if (accountId) {
    Taro.removeStorageSync(getAccountTermStartsKey(accountId))
    return
  }

  Taro.removeStorageSync(TERM_STARTS_KEY)
}

function getDataCacheKey(accountId: string, target: DataCacheTarget, termId = '') {
  return `${DATA_CACHE_PREFIX}${accountId}.${target}.${termId || 'latest'}`
}

function getCacheTermId(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return ''
  }

  const termId = (data as { termId?: unknown }).termId

  return typeof termId === 'string' ? termId : ''
}

function hasMatchingCacheVersion(
  left: Pick<StoredDataCache, 'sourceHash' | 'syncedAt'>,
  right: Pick<StoredDataCache, 'sourceHash' | 'syncedAt'>,
) {
  if (left.sourceHash && right.sourceHash) {
    return left.sourceHash === right.sourceHash
  }

  if (left.syncedAt && right.syncedAt) {
    return left.syncedAt === right.syncedAt
  }

  return false
}

function isSameTermCache<TData>(
  cache: StoredDataCache<TData> | null,
  termId: string,
  comparison: StoredDataCache<TData> | null,
) {
  return (
    Boolean(cache && comparison) &&
    getCacheTermId(cache?.data) === termId &&
    getCacheTermId(comparison?.data) === termId &&
    hasMatchingCacheVersion(cache as StoredDataCache<TData>, comparison as StoredDataCache<TData>)
  )
}

function normalizeDataCache<TData>(value: unknown): StoredDataCache<TData> | null {
  const cache = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<StoredDataCache<TData>>)
    : {}

  if (!('data' in cache)) {
    return null
  }

  return {
    data: cache.data as TData,
    sourceHash: typeof cache.sourceHash === 'string' ? cache.sourceHash : undefined,
    syncedAt: typeof cache.syncedAt === 'string' ? cache.syncedAt : undefined,
    cachedAt: typeof cache.cachedAt === 'string' ? cache.cachedAt : '',
  }
}

export function getStoredDataCache<TData>(
  accountId: string,
  target: DataCacheTarget,
  termId = '',
) {
  if (!accountId) {
    return null
  }

  const cached = normalizeDataCache<TData>(
    Taro.getStorageSync(getDataCacheKey(accountId, target, termId)),
  )

  if (!termId) {
    return cached
  }

  const latest = normalizeDataCache<TData>(
    Taro.getStorageSync(getDataCacheKey(accountId, target)),
  )

  if (isSameTermCache(cached, termId, latest)) {
    Taro.removeStorageSync(getDataCacheKey(accountId, target, termId))
    return latest
  }

  if (cached) {
    return cached
  }

  return latest && getCacheTermId(latest.data) === termId ? latest : null
}

export function setStoredDataCache<TData>(
  accountId: string,
  target: DataCacheTarget,
  data: TData,
  options: { termId?: string; sourceHash?: string; syncedAt?: string } = {},
) {
  if (!accountId) {
    return
  }

  const termId = options.termId || ''
  const cache: StoredDataCache<TData> = {
    data,
    sourceHash: options.sourceHash,
    syncedAt: options.syncedAt,
    cachedAt: new Date().toISOString(),
  }

  if (termId) {
    const latest = normalizeDataCache<TData>(
      Taro.getStorageSync(getDataCacheKey(accountId, target)),
    )

    if (isSameTermCache(latest, termId, cache)) {
      Taro.removeStorageSync(getDataCacheKey(accountId, target, termId))
      return
    }

    Taro.setStorageSync(getDataCacheKey(accountId, target, termId), cache)
    return
  }

  Taro.setStorageSync(getDataCacheKey(accountId, target), cache)

  const dataTermId = getCacheTermId(data)

  if (!dataTermId) {
    return
  }

  const termCache = normalizeDataCache<TData>(
    Taro.getStorageSync(getDataCacheKey(accountId, target, dataTermId)),
  )

  if (isSameTermCache(termCache, dataTermId, cache)) {
    Taro.removeStorageSync(getDataCacheKey(accountId, target, dataTermId))
  }
}

export function clearStoredDataCacheTerms(accountId: string, target: DataCacheTarget) {
  if (!accountId) {
    return
  }

  const prefix = `${DATA_CACHE_PREFIX}${accountId}.${target}.`
  const latestKey = getDataCacheKey(accountId, target)
  const info = Taro.getStorageInfoSync()

  for (const key of info.keys || []) {
    if (key.startsWith(prefix) && key !== latestKey) {
      Taro.removeStorageSync(key)
    }
  }
}

export function clearStoredDataCaches(accountId?: string) {
  const prefix = accountId ? `${DATA_CACHE_PREFIX}${accountId}.` : DATA_CACHE_PREFIX
  const info = Taro.getStorageInfoSync()

  for (const key of info.keys || []) {
    if (key.startsWith(prefix)) {
      Taro.removeStorageSync(key)
    }
  }
}
