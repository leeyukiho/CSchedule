import Taro from '@tarojs/taro'

import { requestApi } from './client'

export interface ReminderPreferencesResponse {
  enabled: boolean
  preferredTime: string
  hasOpenid: boolean
  openid?: string
  dailyCourseEnabled: boolean
  examEnabled: boolean
  templateIds: string[]
  templateIdMap?: ReminderTemplateIds
  canSubscribe?: boolean
  canSend?: boolean
  dryRun?: boolean
  hasWechatCredentials?: boolean
  missingConfig?: string[]
}

export interface ReminderTemplateIds {
  dailyCourse?: string
  exam?: string
}

interface CachedReminderPreferences {
  value: ReminderPreferencesResponse
  expiresAt: number
}

interface ReminderPreferencesOptions {
  forceRefresh?: boolean
  cacheOnly?: boolean
}

const REMINDER_PREFERENCES_CACHE_PREFIX = 'cschedule.reminderPreferences.'
const REMINDER_PREFERENCES_CACHE_TTL_MS = 5 * 60 * 1000
const reminderPreferenceRequests = new Map<string, Promise<ReminderPreferencesResponse>>()

function getReminderPreferencesCacheKey(accountId: string) {
  return `${REMINDER_PREFERENCES_CACHE_PREFIX}${accountId}`
}

function normalizeReminderPreferences(value: unknown): ReminderPreferencesResponse | null {
  const preferences = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<ReminderPreferencesResponse>)
    : {}

  if (typeof preferences.enabled !== 'boolean') {
    return null
  }

  return {
    enabled: preferences.enabled,
    preferredTime: typeof preferences.preferredTime === 'string' ? preferences.preferredTime : '07:30',
    hasOpenid: Boolean(preferences.hasOpenid),
    openid: typeof preferences.openid === 'string' ? preferences.openid : undefined,
    dailyCourseEnabled: Boolean(preferences.dailyCourseEnabled),
    examEnabled: Boolean(preferences.examEnabled),
    templateIds: Array.isArray(preferences.templateIds)
      ? preferences.templateIds.filter((templateId): templateId is string => typeof templateId === 'string')
      : [],
    templateIdMap: normalizeReminderTemplateIds(preferences.templateIdMap),
    canSubscribe: typeof preferences.canSubscribe === 'boolean' ? preferences.canSubscribe : undefined,
    canSend: typeof preferences.canSend === 'boolean' ? preferences.canSend : undefined,
    dryRun: typeof preferences.dryRun === 'boolean' ? preferences.dryRun : undefined,
    hasWechatCredentials: typeof preferences.hasWechatCredentials === 'boolean'
      ? preferences.hasWechatCredentials
      : undefined,
    missingConfig: Array.isArray(preferences.missingConfig)
      ? preferences.missingConfig.filter((item): item is string => typeof item === 'string')
      : undefined,
  }
}

function normalizeReminderTemplateIds(value: unknown): ReminderTemplateIds | undefined {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<ReminderTemplateIds>)
    : {}
  const dailyCourse = typeof record.dailyCourse === 'string' && record.dailyCourse.trim()
    ? record.dailyCourse.trim()
    : undefined
  const exam = typeof record.exam === 'string' && record.exam.trim()
    ? record.exam.trim()
    : undefined

  return dailyCourse || exam ? { dailyCourse, exam } : undefined
}

function readCachedReminderPreferences(accountId: string) {
  const key = getReminderPreferencesCacheKey(accountId)
  const cached = Taro.getStorageSync(key)
  const cache = cached && typeof cached === 'object' && !Array.isArray(cached)
    ? (cached as Partial<CachedReminderPreferences>)
    : {}
  const value = normalizeReminderPreferences(cache.value)

  if (!value || typeof cache.expiresAt !== 'number') {
    if (cached) {
      Taro.removeStorageSync(key)
    }

    return null
  }

  if (cache.expiresAt <= Date.now()) {
    Taro.removeStorageSync(key)
    return null
  }

  return { value, expiresAt: cache.expiresAt }
}

function getCachedReminderPreferences(accountId: string) {
  const cache = readCachedReminderPreferences(accountId)

  if (!cache) {
    return null
  }

  const { value, expiresAt } = cache

  if (!value || typeof expiresAt !== 'number') {
    return null
  }

  return value
}

function setCachedReminderPreferences(
  accountId: string,
  value: ReminderPreferencesResponse,
) {
  const preferences = normalizeReminderPreferences(value)

  if (!accountId || !preferences) {
    return
  }

  Taro.setStorageSync(getReminderPreferencesCacheKey(accountId), {
    value: preferences,
    expiresAt: Date.now() + REMINDER_PREFERENCES_CACHE_TTL_MS,
  } satisfies CachedReminderPreferences)
}

export function getCachedReminderPreferenceState(accountId: string) {
  return readCachedReminderPreferences(accountId)?.value || null
}

export function setLocalReminderPreferenceState(
  accountId: string,
  value: ReminderPreferencesResponse,
) {
  setCachedReminderPreferences(accountId, value)
}

export function getLocalReminderTemplateIds(): string[] {
  return []
}

export function getLocalReminderTemplateIdMap(): ReminderTemplateIds {
  return {}
}

export async function getReminderPreferences(
  accountId: string,
  options: ReminderPreferencesOptions = {},
) {
  const cached = getCachedReminderPreferences(accountId)

  if (!options.forceRefresh && cached) {
    return cached
  }

  if (options.cacheOnly) {
    return cached
  }

  const pendingRequest = reminderPreferenceRequests.get(accountId)

  if (pendingRequest) {
    return pendingRequest
  }

  const request = requestApi<ReminderPreferencesResponse>({
    path: `/account/${encodeURIComponent(accountId)}/reminders`,
  })
    .then((response) => {
      const preferences = normalizeReminderPreferences(response) || response
      setCachedReminderPreferences(accountId, preferences)
      return preferences
    })
    .finally(() => {
      reminderPreferenceRequests.delete(accountId)
    })

  reminderPreferenceRequests.set(accountId, request)
  return request
}

export function resolveReminderOpenid(accountId: string, code: string) {
  return requestApi<{ openid: string }, { code: string }>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/reminders/openid`,
    data: { code },
  })
}

export function updateReminderPreference(
  accountId: string,
  data: {
    enabled: boolean
    preferredTime?: string
    openid?: string
    dailyCourseEnabled?: boolean
    examEnabled?: boolean
    templateIdMap?: ReminderTemplateIds
  },
) {
  return requestApi<ReminderPreferencesResponse, typeof data>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/reminders`,
    data,
  }).then((response) => {
    const preferences = normalizeReminderPreferences(response) || response
    setCachedReminderPreferences(accountId, preferences)
    return preferences
  })
}
