import { requestApi } from './client'
import { HomeShortcutConfig, normalizeHomeShortcutConfig } from '../home-shortcuts'

export interface AppSettingsResponse {
  homeShortcuts: HomeShortcutConfig
  updatedAt?: string
}

const APP_SETTINGS_CACHE_TTL_MS = 30 * 1000

let appSettingsCache: {
  expiresAt: number
  value: AppSettingsResponse
} | null = null
let appSettingsRequest: Promise<AppSettingsResponse> | null = null

export async function getAppSettings() {
  const now = Date.now()

  if (appSettingsCache && appSettingsCache.expiresAt > now) {
    return appSettingsCache.value
  }

  if (appSettingsRequest) {
    return appSettingsRequest
  }

  appSettingsRequest = requestApi<AppSettingsResponse>({
    path: '/settings',
  })
    .then((response) => {
      const value = {
        ...response,
        homeShortcuts: normalizeHomeShortcutConfig(response.homeShortcuts, {
          includeMissingDefaults: false,
        }),
      }

      appSettingsCache = {
        expiresAt: Date.now() + APP_SETTINGS_CACHE_TTL_MS,
        value,
      }

      return value
    })
    .finally(() => {
      appSettingsRequest = null
    })

  return appSettingsRequest
}
