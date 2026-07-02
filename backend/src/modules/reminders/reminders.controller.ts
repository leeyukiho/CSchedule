import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ReminderType } from '@prisma/client'

import { AccountAccessGuard } from '../accounts/account-access-token.service'
import { AdminGuard } from '../admin/admin.guard'
import { RemindersService } from './reminders.service'

@Controller('admin/reminders')
@UseGuards(AdminGuard)
export class RemindersAdminController {
  constructor(private readonly reminders: RemindersService) {}

  @Get('config')
  getConfig() {
    return this.reminders.getConfig()
  }

  @Post('config')
  updateConfig(@Body() input: Record<string, unknown>) {
    return this.reminders.updateConfig(input)
  }

  @Get('deliveries')
  listDeliveries(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.reminders.listRecentDeliveries({
      limit: Number(limit) || undefined,
      status,
      accountId,
    })
  }

  @Get('subscriptions')
  listSubscriptions(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('accountId') accountId?: string,
    @Query('openid') openid?: string,
  ) {
    return this.reminders.listSubscribedWxUsers({
      limit: Number(limit) || undefined,
      status,
      accountId,
      openid,
    })
  }

  @Post('subscriptions/clear')
  clearSubscriptions(@Body() input: { openid?: string; accountId?: string }) {
    return this.reminders.clearSubscriptions(input)
  }

  @Post('subscriptions/test')
  testSubscription(@Body() input: { openid?: string; accountId?: string; type?: ReminderType }) {
    return this.reminders.sendTestReminderToWxUser(String(input.openid || ''), input.type, String(input.accountId || ''))
  }

  @Post('subscriptions')
  upsertSubscription(
    @Body()
    input: {
      accountId: string
      openid: string
      type: ReminderType
      templateId?: string
      preferredTime?: string
      status?: 'enabled' | 'disabled' | 'blocked'
    },
  ) {
    return this.reminders.upsertSubscription(input)
  }

  @Post('run')
  run(
    @Query('force') force?: string,
    @Query('dryRun') dryRun?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: ReminderType,
    @Query('accountId') accountId?: string,
    @Query('openid') openid?: string,
  ) {
    return this.reminders.runDueReminders({
      force: force === 'true',
      dryRun: dryRun === undefined ? undefined : dryRun !== 'false',
      limit: Number(limit) || undefined,
      type,
      accountId,
      openid,
    })
  }
}

@Controller('account/:accountId/reminders')
@UseGuards(AccountAccessGuard)
export class AccountRemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  getPreferences(@Param('accountId') accountId: string) {
    return this.reminders.getAccountPreferences(accountId)
  }

  @Post('openid')
  resolveOpenid(@Body() input: { code?: string }) {
    return this.reminders.resolveOpenid(String(input.code || ''))
  }

  @Post()
  updatePreference(
    @Param('accountId') accountId: string,
    @Body()
    input: {
      enabled: boolean
      preferredTime?: string
      openid?: string
      dailyCourseEnabled?: boolean
      examEnabled?: boolean
      templateIdMap?: {
        dailyCourse?: string
        exam?: string
      }
    },
  ) {
    return this.reminders.updateAccountPreference(accountId, input)
  }
}
