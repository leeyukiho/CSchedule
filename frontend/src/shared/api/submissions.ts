import { requestApi } from './client'
import { SchoolSubmissionResponse } from './types'

export interface CreateSchoolSubmissionInput {
  schoolName: string
  province?: string
  city?: string
  officialWebsite?: string
  eduSystemWebsite?: string
  loginUrl?: string
  loginModeHint?: string
  requestedTargets?: string[]
  note?: string
}

export function submitSchoolAccess(data: CreateSchoolSubmissionInput) {
  return requestApi<SchoolSubmissionResponse, CreateSchoolSubmissionInput>({
    method: 'POST',
    path: '/school-access-submissions',
    data,
  })
}
