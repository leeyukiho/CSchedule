import { requestApi } from './client'

export interface PendingNotification {
  id: string
  title: string
  content: string
  targetType?: 'global' | 'user'
  createdAt: string
  readAt?: string | null
}

export interface PendingNotificationsResponse {
  items: PendingNotification[]
  total: number
}

export type UserNotificationsResponse = PendingNotificationsResponse

export function getPendingNotifications(accountId: string) {
  return requestApi<PendingNotificationsResponse>({
    path: `/account/${encodeURIComponent(accountId)}/notifications/pending`,
  })
}

export function getNotifications(accountId: string) {
  return requestApi<UserNotificationsResponse>({
    path: `/account/${encodeURIComponent(accountId)}/notifications`,
  })
}

export function markNotificationRead(accountId: string, notificationId: string) {
  return requestApi<{ ok: boolean }>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/notifications/${encodeURIComponent(notificationId)}/read`,
  })
}
