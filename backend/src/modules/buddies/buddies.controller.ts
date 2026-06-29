import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from '@nestjs/common'

import {
  AccountAccessHeaders,
  AccountAccessTokenService,
} from '../accounts/account-access-token.service'
import { BuddiesService } from './buddies.service'

@Controller('buddies')
export class BuddiesController {
  constructor(
    private readonly buddiesService: BuddiesService,
    private readonly accountAccess: AccountAccessTokenService,
  ) {}

  @Get('invite/:code')
  previewInvite(@Param('code') code: string) {
    return this.buddiesService.previewInvite(code)
  }

  @Post('invite')
  async createInvite(@Headers() headers: AccountAccessHeaders) {
    const access = await this.accountAccess.assertHeadersAccountAccess(headers)

    return this.buddiesService.createInvite(access.accountId)
  }

  @Post('invite/:code/accept')
  async acceptInvite(
    @Param('code') code: string,
    @Headers() headers: AccountAccessHeaders,
  ) {
    const access = await this.accountAccess.assertHeadersAccountAccess(headers)

    return this.buddiesService.acceptInvite(code, access.accountId)
  }

  @Get('space')
  async getSpace(@Headers() headers: AccountAccessHeaders) {
    const access = await this.accountAccess.assertHeadersAccountAccess(headers)

    return this.buddiesService.getSpace(access.accountId)
  }

  @Delete('link')
  async unbind(
    @Query('partnerAccountId') partnerAccountId: string | undefined,
    @Body() body: { partnerAccountId?: string } = {},
    @Headers() headers: AccountAccessHeaders,
  ) {
    const access = await this.accountAccess.assertHeadersAccountAccess(headers)

    return this.buddiesService.unbind(access.accountId, partnerAccountId || body.partnerAccountId || '')
  }
}
