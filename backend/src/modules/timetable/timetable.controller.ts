import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'

import { AccountAccessGuard } from '../accounts/account-access-token.service'
import { TimetableService } from './timetable.service'

@Controller('account/:accountId/timetable')
@UseGuards(AccountAccessGuard)
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  @Get()
  getTimetable(
    @Param('accountId') accountId: string,
    @Query('termId') termId?: string,
    @Query('knownHash') knownHash?: string,
  ) {
    return this.timetableService.getTimetable(accountId, termId, knownHash)
  }
}
