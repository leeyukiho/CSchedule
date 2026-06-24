import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common'

import { AccountAccessGuard } from '../accounts/account-access-token.service'
import { NotificationsService } from './notifications.service'

@Controller('account/:accountId/notifications')
@UseGuards(AccountAccessGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Param('accountId') accountId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notificationsService.listForAccount(accountId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Get('pending')
  listPending(
    @Param('accountId') accountId: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.listPendingForAccount(
      accountId,
      limit ? Number(limit) : undefined,
    )
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  markRead(
    @Param('accountId') accountId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationsService.markRead(accountId, notificationId)
  }
}
