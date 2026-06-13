import { requestApi } from './client'
import { SubmitFeedbackResponse } from './types'

export interface SubmitFeedbackInput {
  userId?: string
  bindingId?: string
  type?: string
  content: string
  contact?: string
}

export function submitFeedback(data: SubmitFeedbackInput) {
  return requestApi<SubmitFeedbackResponse, SubmitFeedbackInput>({
    method: 'POST',
    path: '/feedback',
    data,
  })
}

