import Taro from '@tarojs/taro'

import { getSchoolWeather } from './api/schools'
import { getStoredAccountSummary, getStoredAuthState } from './storage'

const WEATHER_CACHE_TTL_MS = 3 * 60 * 60 * 1000
const WEATHER_STORAGE_CACHE_PREFIX = 'cschedule.weather.v3.'
const DEFAULT_WEATHER_LABEL = '\u5929\u6c14'

export type WeatherIconKind =
  | 'sunny'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'hail'
  | 'default'

export interface SharedWeatherDisplay {
  location: string
  temperature: string
  condition: string
  icon: WeatherIconKind
  weatherCode?: number
}

type WeatherCacheEntry = SharedWeatherDisplay & {
  cachedAt: number
  unavailable?: boolean
}

type SchoolWeatherLocation = {
  id: string
  displayName: string
}

const schoolWeatherCache = new Map<string, WeatherCacheEntry>()

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function getWeatherStorageCacheKey(locationId: string) {
  return `${WEATHER_STORAGE_CACHE_PREFIX}${locationId}`
}

function normalizeWeatherCacheEntry(value: unknown): WeatherCacheEntry | null {
  const record = asRecord(value)
  const cachedAt = typeof record.cachedAt === 'number'
    ? record.cachedAt
    : typeof record.cachedAt === 'string'
      ? Number(record.cachedAt)
      : 0

  if (cachedAt <= 0) {
    return null
  }

  const location = typeof record.location === 'string' ? record.location : ''
  const temperature = typeof record.temperature === 'string' ? record.temperature : ''
  const condition = typeof record.condition === 'string' ? record.condition : ''
  const icon = normalizeWeatherIcon(record.icon)
  const unavailable = record.unavailable === true

  return (location || temperature || condition || unavailable)
    ? { location, temperature, condition, icon, cachedAt, unavailable }
    : null
}

function normalizeWeatherIcon(value: unknown): WeatherIconKind {
  return (
    value === 'sunny' ||
    value === 'partly-cloudy' ||
    value === 'cloudy' ||
    value === 'fog' ||
    value === 'drizzle' ||
    value === 'rain' ||
    value === 'snow' ||
    value === 'storm' ||
    value === 'hail' ||
    value === 'default'
  ) ? value : 'default'
}

function normalizeWeatherCode(value: unknown) {
  const code = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN

  return Number.isFinite(code) ? code : undefined
}

function getStoredWeatherCache(locationId: string) {
  const key = getWeatherStorageCacheKey(locationId)
  const entry = normalizeWeatherCacheEntry(Taro.getStorageSync(key))

  if (entry && Date.now() - entry.cachedAt >= WEATHER_CACHE_TTL_MS) {
    Taro.removeStorageSync(key)
    schoolWeatherCache.delete(locationId)
    return null
  }

  return entry
}

function setStoredWeatherCache(locationId: string, entry: WeatherCacheEntry) {
  Taro.setStorageSync(getWeatherStorageCacheKey(locationId), entry)
}

export function resolveStoredWeatherLocation(): SchoolWeatherLocation | null {
  const authState = getStoredAuthState()
  const accountSummary = getStoredAccountSummary(authState.accountId)
  const schoolId = authState.schoolId || accountSummary?.schoolId || accountSummary?.school?.id || ''

  if (!schoolId) {
    return null
  }

  return {
    id: schoolId,
    displayName: accountSummary?.school?.weatherLocation?.displayName ||
      accountSummary?.school?.city ||
      accountSummary?.school?.name ||
      DEFAULT_WEATHER_LABEL,
  }
}

function splitWeatherText(text: string) {
  return text
    .split(/[\u00b7\u8def]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function getTemperatureText(parts: string[], temperature?: number) {
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    return `${Math.round(temperature)}\u00b0`
  }

  const weatherParts = parts.filter((part) => (
    !part.includes('\u7a7a\u6c14\u8d28\u91cf') &&
    !part.includes('\u7ecc\u70d8\u7691') &&
    !/AQI|air quality/i.test(part)
  ))

  for (const part of parts) {
    const match = part.match(/-?\d+(?:\.\d+)?\s*(?:\u00b0|\u2103|\u63b3)/)

    if (match) {
      return `${Math.round(Number.parseFloat(match[0]))}\u00b0`
    }
  }

  for (const part of weatherParts) {
    const match = part.match(/-?\d+(?:\.\d+)?/)

    if (match) {
      return `${Math.round(Number.parseFloat(match[0]))}\u00b0`
    }
  }

  return ''
}

function getConditionText(parts: string[], displayName: string) {
  const weatherPart = parts.find((part) => {
    return part !== displayName &&
      !part.includes('\u7a7a\u6c14\u8d28\u91cf') &&
      !part.includes('\u7ecc\u70d8\u7691') &&
      /[\u6674\u4e91\u9634\u96e8\u96ea\u96fe\u973e\u96f7\u98ce]|Weather|\u5929\u6c14|\u93c5|\u95c3|\u6fb6\u6c2b\u7c2f|\u95c6|\u6d60|\u59e3|\u6d44/.test(part)
  })

  if (!weatherPart) {
    return ''
  }

  return weatherPart
    .replace(/-?\d+(?:\.\d+)?\s*(?:\u00b0|\u2103|\u63b3)/g, '')
    .trim()
}

function getWeatherIcon(condition: string): WeatherIconKind {
  if (/[\u96f7\u6d44]|storm|thunder/i.test(condition)) return 'storm'
  if (/\u96ea|snow/i.test(condition)) return 'snow'
  if (/[\u96e8\u95c6\u59e3]|rain|shower|drizzle/i.test(condition)) return 'rain'
  if (/[\u96fe\u973e]|fog|mist/i.test(condition)) return 'fog'
  if (/[\u9634\u95c3]|overcast/i.test(condition)) return 'cloudy'
  if (/\u4e91|\u6fb6\u6c2b\u7c2f|cloud/i.test(condition)) return 'cloudy'
  if (/\u6674|\u93c5|sun|clear/i.test(condition)) return 'sunny'
  return 'default'
}

function getWeatherIconByCode(code: number | undefined): WeatherIconKind {
  if (typeof code !== 'number') return 'default'
  if (code === 0) return 'sunny'
  if (code === 1 || code === 2) return 'partly-cloudy'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code === 95) return 'storm'
  if (code === 96 || code === 99) return 'hail'
  return 'default'
}

export function parseWeatherDisplay(input: {
  displayName: string
  text: string
  temperature?: number
  weatherCode?: number
  condition?: string
}): SharedWeatherDisplay {
  const parts = splitWeatherText(input.text)
  const location = input.displayName || parts[0] || DEFAULT_WEATHER_LABEL
  const weatherCode = normalizeWeatherCode(input.weatherCode)
  const temperature = getTemperatureText(parts, input.temperature)
  const condition = input.condition || getConditionText(parts, location) || DEFAULT_WEATHER_LABEL
  const codeIcon = getWeatherIconByCode(weatherCode)

  return {
    location,
    temperature,
    condition,
    icon: codeIcon === 'default' ? getWeatherIcon(condition) : codeIcon,
    weatherCode,
  }
}

export async function fetchSharedWeather(location: SchoolWeatherLocation) {
  const cached = schoolWeatherCache.get(location.id)

  if (cached && !cached.unavailable && Date.now() - cached.cachedAt < WEATHER_CACHE_TTL_MS) {
    return cached
  }

  const stored = getStoredWeatherCache(location.id)

  if (stored && !stored.unavailable && Date.now() - stored.cachedAt < WEATHER_CACHE_TTL_MS) {
    schoolWeatherCache.set(location.id, stored)
    return stored
  }

  const response = await getSchoolWeather(location.id)

  if (!response.text) {
    throw new Error('Weather unavailable')
  }

  const display = parseWeatherDisplay({
    displayName: response.displayName || location.displayName,
    text: response.text,
    temperature: response.temperature,
    weatherCode: response.weatherCode,
    condition: response.condition,
  })
  const entry: WeatherCacheEntry = {
    ...display,
    cachedAt: Date.now(),
  }

  schoolWeatherCache.set(location.id, entry)
  setStoredWeatherCache(location.id, entry)

  return entry
}
