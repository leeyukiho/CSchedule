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

export function bindAccountOpenid(accountId: string, openid: string) {
  return requestApi<{ success: boolean }, { openid: string }>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/wechat/openid`,
    data: { openid },
  })
}

export function getReminderPreferences(accountId: string) {
  return requestApi<ReminderPreferencesResponse>({
    path: `/account/${encodeURIComponent(accountId)}/reminders`,
  })
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
  })
}
