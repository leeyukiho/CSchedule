import { Module } from '@nestjs/common'

import { PrismaModule } from '../../common/prisma/prisma.module'
import { OpenidAbuseTokenService } from '../../common/security/openid-abuse-token.service'
import { AccountsModule } from '../accounts/accounts.module'
import { FeedbackController } from './feedback.controller'
import { FeedbackService } from './feedback.service'

@Module({
  imports: [AccountsModule, PrismaModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, OpenidAbuseTokenService],
})
export class FeedbackModule {}
