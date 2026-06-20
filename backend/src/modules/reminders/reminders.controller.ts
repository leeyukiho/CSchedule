import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ReminderType } from '@prisma/client'

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
    },
  ) {
    return this.reminders.updateAccountPreference(accountId, input)
  }
}
