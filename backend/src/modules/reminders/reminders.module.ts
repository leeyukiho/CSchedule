import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { PrismaModule } from '../../common/prisma/prisma.module'
import { AdminGuard } from '../admin/admin.guard'
import { AccountRemindersController, RemindersAdminController } from './reminders.controller'
import { RemindersScheduler } from './reminders.scheduler'
import { RemindersService } from './reminders.service'
import { WechatSubscribeMessageService } from './wechat-subscribe-message.service'

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [RemindersAdminController, AccountRemindersController],
  providers: [
    RemindersService,
    RemindersScheduler,
    WechatSubscribeMessageService,
    AdminGuard,
  ],
})
export class RemindersModule {}
