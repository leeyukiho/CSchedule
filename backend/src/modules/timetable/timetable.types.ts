import { AccountStatus, FeatureDisplayConfig, SectionTimeProfileConfig } from '../providers/provider.types'

export interface AccountSessionSummary {
  sessionReusable: boolean
  sessionRefreshable: boolean
  sessionExpireAt?: string
  accountStatus: AccountStatus
}

export interface TimetableCacheDataResponse {
  accountId: string
  schoolId: string
  providerId: string
  termId?: string
  courses: unknown[]
  terms: unknown[]
  termStarts?: Record<string, string>
  sectionTimes: unknown[]
  sectionTimeProfiles?: SectionTimeProfileConfig[]
  display?: FeatureDisplayConfig
  sourceHash?: string
  notModified?: boolean
  syncedAt?: string
  session: AccountSessionSummary
}

export interface TimetableNotModifiedResponse {
  termId?: string
  termStarts?: Record<string, string>
  sourceHash?: string
  notModified: true
  syncedAt?: string
}

export type TimetableCacheResponse =
  | TimetableCacheDataResponse
  | TimetableNotModifiedResponse
