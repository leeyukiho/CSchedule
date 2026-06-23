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
}

const LOCAL_REMINDER_TEMPLATE_IDS = [
  String(process.env.TARO_APP_WECHAT_DAILY_COURSE_TEMPLATE_ID || '').trim(),
  String(process.env.TARO_APP_WECHAT_EXAM_TEMPLATE_ID || '').trim(),
].filter(Boolean)

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
  }
}

function readCachedReminderPreferences(accountId: string) {
  const cached = Taro.getStorageSync(getReminderPreferencesCacheKey(accountId))
  const cache = cached && typeof cached === 'object' && !Array.isArray(cached)
    ? (cached as Partial<CachedReminderPreferences>)
    : {}
  const value = normalizeReminderPreferences(cache.value)

  return value && typeof cache.expiresAt === 'number'
    ? { value, expiresAt: cache.expiresAt }
    : null
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

  if (expiresAt <= Date.now()) return null

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

export function getLocalReminderTemplateIds() {
  return LOCAL_REMINDER_TEMPLATE_IDS
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
