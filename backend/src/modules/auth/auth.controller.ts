import { Body, Controller, Param, Post } from '@nestjs/common'

import { AuthService } from './auth.service'
import { LoginSubmitRequest } from './auth.types'

@Controller('schools/:schoolId/login')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  submitLogin(
    @Param('schoolId') schoolId: string,
    @Body() input: LoginSubmitRequest,
  ) {
    return this.authService.submitLogin(schoolId, input)
  }
}

@Controller('schools/:schoolId/session-import')
export class SessionImportController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  importSession(
    @Param('schoolId') schoolId: string,
    @Body() input: { contextId?: string; accountId?: string; session?: unknown },
  ) {
    return this.authService.importSession(schoolId, input)
  }
}

@Controller('account/:accountId/wechat')
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
