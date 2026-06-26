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
