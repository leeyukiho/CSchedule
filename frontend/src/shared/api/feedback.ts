import { requestApi } from './client'
import { SubmitFeedbackResponse } from './types'
import {
  assertClientCanSubmit,
  getClientAbuseHeader,
  markClientSubmitted,
} from '../abuse-guard'

export interface SubmitFeedbackInput {
  accountId?: string
  type?: string
  content: string
  contact?: string
}

export interface SchoolImportAlertInput {
  schoolId?: string
  accountId?: string
  providerId?: string
  contextId?: string
  stage?: string
  errorCode?: string
  errorMessage?: string
}

export interface SchoolImportAlertResponse extends SubmitFeedbackResponse {
  schoolDisabled?: boolean
  userMessage?: string
}

export function submitFeedback(data: SubmitFeedbackInput) {
  const fingerprintValues = [data.type, data.content, data.contact]
  assertClientCanSubmit('feedback', fingerprintValues)

  return requestApi<SubmitFeedbackResponse, SubmitFeedbackInput>({
    method: 'POST',
    path: '/feedback',
    data,
    header: getClientAbuseHeader(),
  }).then((response) => {
    markClientSubmitted('feedback', fingerprintValues)
    return response
  })
}

export function submitSchoolImportAlert(data: SchoolImportAlertInput) {
  return requestApi<SchoolImportAlertResponse, SchoolImportAlertInput>({
    method: 'POST',
    path: '/feedback/school-import-alert',
    data,
  })
}
