import { requestApi } from './client'
import { TimetableCacheResponse } from './types'
import { getStoredAccountAccessToken, getStoredAccountId } from '../storage'

export interface BuddyAccountSummary {
  accountId: string
  displayName?: string
  schoolName?: string
  schoolShortName?: string
  lastCachedAt?: string
}

export interface BuddyInviteResponse {
  code: string
  path: string
  expiresAt: string
}

export interface BuddyInvitePreviewResponse {
  code: string
  inviter: BuddyAccountSummary
  status: 'pending' | 'accepted' | 'expired' | 'cancelled'
  expiresAt: string
}

export interface BuddyLinkResponse {
  id: string
  partner: BuddyAccountSummary
  createdAt: string
  updatedAt: string
  timetable?: TimetableCacheResponse
}

export interface BuddySpaceResponse {
  links: BuddyLinkResponse[]
}

function getBuddyAuthHeader(): Record<string, string> {
  const accountId = getStoredAccountId()
  const token = accountId ? getStoredAccountAccessToken(accountId) : ''

  return accountId && token
    ? {
        authorization: `Bearer ${token}`,
        'x-cschedule-account-id': accountId,
      }
    : {}
}

export function createBuddyInvite() {
  return requestApi<BuddyInviteResponse>({
    method: 'POST',
    path: '/buddies/invite',
    header: getBuddyAuthHeader(),
  })
}

export function previewBuddyInvite(code: string) {
  return requestApi<BuddyInvitePreviewResponse>({
    path: `/buddies/invite/${encodeURIComponent(code)}`,
  })
}

export function acceptBuddyInvite(code: string) {
  return requestApi<BuddySpaceResponse>({
    method: 'POST',
    path: `/buddies/invite/${encodeURIComponent(code)}/accept`,
    header: getBuddyAuthHeader(),
  })
}

export function getBuddySpace() {
  return requestApi<BuddySpaceResponse>({
    path: '/buddies/space',
    header: getBuddyAuthHeader(),
  })
}

export function unbindBuddy(partnerAccountId: string) {
  return requestApi<{ success: boolean }>({
    method: 'DELETE',
    path: `/buddies/link?partnerAccountId=${encodeURIComponent(partnerAccountId)}`,
    header: getBuddyAuthHeader(),
  })
}
