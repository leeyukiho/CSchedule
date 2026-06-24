import { Module } from '@nestjs/common'

import { PrismaModule } from '../../common/prisma/prisma.module'
import { AdminGuard } from '../admin/admin.guard'
import { ProvidersModule } from '../providers/providers.module'
import { CloudCredentialSyncModule } from '../sync/cloud-credential-sync.module'
import { AccountAccessGuard, AccountAccessTokenService } from './account-access-token.service'
import { StudentAccountController } from './accounts.controller'
import { StudentAccountsService } from './accounts.service'
import { StudentIdentityService } from './student-identity.service'

@Module({
  imports: [PrismaModule, ProvidersModule, CloudCredentialSyncModule],
  controllers: [StudentAccountController],
  providers: [
    StudentAccountsService,
    StudentIdentityService,
    AccountAccessTokenService,
    AccountAccessGuard,
    AdminGuard,
  ],
  exports: [
    StudentAccountsService,
    StudentIdentityService,
    AccountAccessTokenService,
    AccountAccessGuard,
  ],
})
export class AccountsModule {}
