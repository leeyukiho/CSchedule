import { Module } from '@nestjs/common'

import { PrismaModule } from '../../common/prisma/prisma.module'
import { AccountsModule } from '../accounts/accounts.module'
import { SettingsModule } from '../settings/settings.module'
import { TimetableModule } from '../timetable/timetable.module'
import { BuddiesController } from './buddies.controller'
import { BuddiesService } from './buddies.service'

@Module({
  imports: [PrismaModule, AccountsModule, SettingsModule, TimetableModule],
  controllers: [BuddiesController],
  providers: [BuddiesService],
})
export class BuddiesModule {}
