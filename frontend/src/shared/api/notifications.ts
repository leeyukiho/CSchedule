import { requestApi } from './client'

export interface PendingNotification {
  id: string
  title: string
  content: string
  targetType?: 'global' | 'school' | 'user'
  createdAt: string
  readAt?: string | null
}

export interface PendingNotificationsResponse {
  items: PendingNotification[]
  total: number
  limit?: number
  offset?: number
  hasMore?: boolean
}

export type UserNotificationsResponse = PendingNotificationsResponse

interface NotificationListOptions {
  limit?: number
  offset?: number
  forceRefresh?: boolean
}

const PENDING_NOTIFICATION_TTL_MS = 60 * 1000
const pendingNotificationCache = new Map<string, {
  expiresAt: number
  value: PendingNotificationsResponse
}>()
const pendingNotificationRequests = new Map<string, Promise<PendingNotificationsResponse>>()
const notificationListRequests = new Map<string, Promise<UserNotificationsResponse>>()

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value))
    }
  }

  const text = query.toString()
  return text ? `?${text}` : ''
}

export function getPendingNotifications(
  accountId: string,
  options: NotificationListOptions = {},
) {
  const limit = options.limit ?? 5
  const cacheKey = `${accountId}:${limit}`
  const cached = pendingNotificationCache.get(cacheKey)

  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value)
  }

  const pending = pendingNotificationRequests.get(cacheKey)

  if (pending) {
    return pending
  }

  const request = requestApi<PendingNotificationsResponse>({
    path: `/account/${encodeURIComponent(accountId)}/notifications/pending${buildQuery({ limit })}`,
  })
    .then((response) => {
      pendingNotificationCache.set(cacheKey, {
        expiresAt: Date.now() + PENDING_NOTIFICATION_TTL_MS,
        value: response,
      })
      return response
    })
    .finally(() => {
      pendingNotificationRequests.delete(cacheKey)
    })

  pendingNotificationRequests.set(cacheKey, request)
  return request
}

export function getNotifications(
  accountId: string,
  options: NotificationListOptions = {},
) {
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  const requestKey = `${accountId}:${limit}:${offset}`
  const pending = notificationListRequests.get(requestKey)

  if (pending) {
    return pending
  }

  const request = requestApi<UserNotificationsResponse>({
    path: `/account/${encodeURIComponent(accountId)}/notifications${buildQuery({ limit, offset })}`,
  }).finally(() => {
    notificationListRequests.delete(requestKey)
  })

  notificationListRequests.set(requestKey, request)
  return request
}

export function markNotificationRead(accountId: string, notificationId: string) {
  for (const key of pendingNotificationCache.keys()) {
    if (key.startsWith(`${accountId}:`)) {
      pendingNotificationCache.delete(key)
    }
  }

  return requestApi<void>({
    method: 'POST',
    path: `/account/${encodeURIComponent(accountId)}/notifications/${encodeURIComponent(notificationId)}/read`,
  })
}
