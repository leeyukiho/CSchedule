import { Body, Controller, Get, Param, Post } from '@nestjs/common'

import { NotificationsService } from './notifications.service'

@Controller('account/:accountId/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.notificationsService.listForAccount(accountId)
  }

  @Get('pending')
  listPending(@Param('accountId') accountId: string) {
    return this.notificationsService.listPendingForAccount(accountId)
  }

  @Post(':notificationId/read')
  markRead(
    @Param('accountId') accountId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationsService.markRead(accountId, notificationId)
  }
}
