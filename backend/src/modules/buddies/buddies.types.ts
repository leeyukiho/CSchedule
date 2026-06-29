import { TimetableCacheDataResponse } from '../timetable/timetable.types'

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
  timetable?: TimetableCacheDataResponse
}

export interface BuddySpaceResponse {
  links: BuddyLinkResponse[]
}
