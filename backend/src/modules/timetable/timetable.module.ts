import { Module } from '@nestjs/common'

import { AccountsModule } from '../accounts/accounts.module'
import { ProvidersModule } from '../providers/providers.module'
import { TimetableController } from './timetable.controller'
import { TimetableService } from './timetable.service'

@Module({
  imports: [AccountsModule, ProvidersModule],
  controllers: [TimetableController],
  providers: [TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
