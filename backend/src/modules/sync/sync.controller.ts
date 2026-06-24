import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'

import {
  AccountAccessGuard,
  AccountAccessHeaders,
  AccountAccessTokenService,
} from '../accounts/account-access-token.service'
import { DataTarget } from '../providers/provider.types'
import { SyncService } from './sync.service'

@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly accountAccess: AccountAccessTokenService,
  ) {}

  @Get(':jobId')
  async getSyncJob(
    @Param('jobId') jobId: string,
    @Headers() headers: AccountAccessHeaders,
    @Query('includeCache') includeCache?: string,
  ) {
    const access = await this.accountAccess.assertHeadersAccountAccess(headers)

    return this.syncService.getSyncJob(
      jobId,
      includeCache === '1' || includeCache === 'true',
      access.accountId,
    )
  }
}

@Controller('account/:accountId/sync')
@UseGuards(AccountAccessGuard)
export class AccountSyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post()
  createManualSync(
    @Param('accountId') accountId: string,
    @Body() input: { username?: string; password?: string; semesterId?: string; targets?: DataTarget[] } = {},
  ) {
    return this.syncService.createManualSync(accountId, input)
  }
}
