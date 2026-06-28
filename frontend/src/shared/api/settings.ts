import { requestApi } from './client'
import { HomeShortcutConfig, normalizeHomeShortcutConfig } from '../home-shortcuts'

export interface AppSettingsResponse {
  homeShortcuts: HomeShortcutConfig
  updatedAt?: string
}

export async function getAppSettings() {
  const response = await requestApi<AppSettingsResponse>({
    path: '/settings',
  })

  return {
    ...response,
    homeShortcuts: normalizeHomeShortcutConfig(response.homeShortcuts),
  }
}
