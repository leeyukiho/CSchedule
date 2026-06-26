import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'

import {
  AccountAccessGuard,
  AccountAccessHeaders,
  AccountAccessTokenService,
} from '../accounts/account-access-token.service'
import { AuthService } from './auth.service'
import { LoginSubmitRequest } from './auth.types'

@Controller('schools/:schoolId/login')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountAccess: AccountAccessTokenService,
  ) {}

  @Post()
  async submitLogin(
    @Param('schoolId') schoolId: string,
    @Body() input: LoginSubmitRequest,
    @Headers() headers: AccountAccessHeaders,
  ) {
    if (input.accountId) {
      await this.accountAccess.assertAccountAccess(input.accountId, headers)
    }

    return this.authService.submitLogin(schoolId, input)
  }
}

@Controller('wechat/session')
export class WechatSessionController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  createSession(@Body() input: { code?: string }) {
    return this.authService.createWechatAbuseSession(String(input.code || ''))
  }
}

@Controller('schools/:schoolId/session-import')
export class SessionImportController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountAccess: AccountAccessTokenService,
  ) {}

  @Post()
  async importSession(
    @Param('schoolId') schoolId: string,
    @Body() input: { contextId?: string; accountId?: string; session?: unknown },
    @Headers() headers: AccountAccessHeaders,
  ) {
    if (input.accountId) {
      await this.accountAccess.assertAccountAccess(input.accountId, headers)
    }

    return this.authService.importSession(schoolId, input)
  }
}

@Controller('account/:accountId/wechat')
@UseGuards(AccountAccessGuard)
export class AccountWechatController {
  constructor(private readonly authService: AuthService) {}

  @Post('openid')
  bindOpenid(
    @Param('accountId') accountId: string,
    @Body() input: { openid?: string },
  ) {
    return this.authService.bindWechatOpenid(accountId, String(input.openid || ''))
  }
}
