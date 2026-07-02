import { Module } from '@nestjs/common'

import { PrismaModule } from '../../common/prisma/prisma.module'
import { OpenidAbuseTokenService } from '../../common/security/openid-abuse-token.service'
import { SettingsModule } from '../settings/settings.module'
import { SubmissionsController } from './submissions.controller'
import { SubmissionsService } from './submissions.service'

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, OpenidAbuseTokenService],
})
export class SubmissionsModule {}
