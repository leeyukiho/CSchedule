import { requestApi } from './client'
import { SchoolSubmissionResponse } from './types'
import {
  assertClientCanSubmit,
  getClientAbuseHeader,
  markClientSubmitted,
} from '../abuse-guard'

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
  const fingerprintValues = [
    data.schoolName,
    data.province,
    data.city,
    data.officialWebsite,
    data.eduSystemWebsite,
    data.loginUrl,
  ]
  assertClientCanSubmit('schoolSubmission', fingerprintValues)

  return requestApi<SchoolSubmissionResponse, CreateSchoolSubmissionInput>({
    method: 'POST',
    path: '/school-access-submissions',
    data,
    header: getClientAbuseHeader(),
  }).then((response) => {
    markClientSubmitted('schoolSubmission', fingerprintValues)
    return response
  })
}
