import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common'

import { AdminGuard } from '../admin/admin.guard'
import { AccountAccessGuard } from './account-access-token.service'
import { StudentAccountsService } from './accounts.service'

@Controller('account')
export class StudentAccountController {
  constructor(private readonly accountsService: StudentAccountsService) {}

  @Get()
  @UseGuards(AdminGuard)
  listAccounts() {
    return this.accountsService.listAccounts()
  }

  @Get(':accountId')
  @UseGuards(AccountAccessGuard)
  getAccount(@Param('accountId') accountId: string) {
    return this.accountsService.getAccount(accountId)
  }

  @Delete(':accountId')
  @UseGuards(AccountAccessGuard)
  deactivateAccount(@Param('accountId') accountId: string) {
    return this.accountsService.deactivateAccount(accountId)
  }
}
