import { Body, Controller, Headers, Post } from '@nestjs/common'

import {
  AccountAccessHeaders,
  AccountAccessTokenService,
} from '../accounts/account-access-token.service'
import { FeedbackService, SubmitFeedbackRequest } from './feedback.service'

@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly feedbackService: FeedbackService,
    private readonly accountAccess: AccountAccessTokenService,
  ) {}

  @Post()
  async submitFeedback(
    @Body() input: SubmitFeedbackRequest,
    @Headers() headers: AccountAccessHeaders,
  ) {
    if (input.accountId) {
      await this.accountAccess.assertAccountAccess(input.accountId, headers)
    }

    return this.feedbackService.submitFeedback(input)
  }
}
