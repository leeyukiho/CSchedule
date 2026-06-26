import { Body, Controller, Headers, Post, Req } from '@nestjs/common'
import { Request } from 'express'

import {
  AccountAccessHeaders,
  AccountAccessTokenService,
} from '../accounts/account-access-token.service'
import { getRequestClientIp } from '../../common/security/client-identity'
import { OpenidAbuseTokenService } from '../../common/security/openid-abuse-token.service'
import { FeedbackService, SubmitFeedbackRequest } from './feedback.service'

const CLIENT_ID_HEADER = 'x-cschedule-client-id'
const OPENID_ABUSE_TOKEN_HEADER = 'x-cschedule-openid-token'

@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly accountAccess: AccountAccessTokenService,
    private readonly openidAbuseTokens: OpenidAbuseTokenService,
  ) {}

  @Post()
  async submitFeedback(
    @Body() input: SubmitFeedbackRequest,
    @Headers() headers: AccountAccessHeaders,
    @Req() request: Request,
  ) {
    if (input.accountId) {
      await this.accountAccess.assertAccountAccess(input.accountId, headers)
    }

    return this.feedbackService.submitFeedback(
      input,
      this.getFeedbackClientKey(input, request),
    )
  }

  private getFeedbackClientKey(input: SubmitFeedbackRequest, request: Request) {
    if (input.accountId) {
      return `account:${input.accountId}`
    }

    const openid = this.openidAbuseTokens.verify(getHeaderValue(request, OPENID_ABUSE_TOKEN_HEADER))

    if (openid) {
      return `openid:${openid}`
    }

    const clientId = getHeaderValue(request, CLIENT_ID_HEADER)

    if (clientId) {
      return `client:${clientId}`
    }

    return `ip:${getRequestClientIp(request)}`
  }
}

function getHeaderValue(request: Request, headerName: string) {
  const value = request.headers[headerName]
  const firstValue = Array.isArray(value) ? value[0] : value

  return String(firstValue || '').trim().slice(0, 120)
}
