import { Body, Controller, Post, Req } from '@nestjs/common'
import { Request } from 'express'

import { getRequestClientIp } from '../../common/security/client-identity'
import { OpenidAbuseTokenService } from '../../common/security/openid-abuse-token.service'
import { CreateSchoolSubmissionRequest, SubmissionsService } from './submissions.service'

const CLIENT_ID_HEADER = 'x-cschedule-client-id'
const OPENID_ABUSE_TOKEN_HEADER = 'x-cschedule-openid-token'

@Controller('school-access-submissions')
export class SubmissionsController {
  constructor(
    private readonly submissionsService: SubmissionsService,
    private readonly openidAbuseTokens: OpenidAbuseTokenService,
  ) {}

  @Post()
  createSubmission(
    @Body() input: CreateSchoolSubmissionRequest,
    @Req() request: Request,
  ) {
    return this.submissionsService.createSubmission(input, this.getClientKey(request))
  }

  private getClientKey(request: Request) {
    const openid = this.openidAbuseTokens.verify(getHeaderValue(request, OPENID_ABUSE_TOKEN_HEADER))

    if (openid) {
      return `openid:${openid}`
    }

    const clientId = getHeaderValue(request, CLIENT_ID_HEADER)

    if (clientId) {
      return `client:${clientId}`
    }

    return `ip:${getRequestClientIp(request)}`
  }
}

function getHeaderValue(request: Request, headerName: string) {
  const value = request.headers[headerName]
  const firstValue = Array.isArray(value) ? value[0] : value

  return String(firstValue || '').trim().slice(0, 120)
}
