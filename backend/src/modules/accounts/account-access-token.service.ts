import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'

import { PrismaService } from '../../common/prisma/prisma.service'

export type AccountAccessHeaders = Record<
  string,
  string | string[] | undefined
>

const ACCOUNT_TOKEN_BYTES = 32
const AUTHORIZATION_SCHEME = 'Bearer '
const DEFAULT_ACCOUNT_TOKEN_TTL_DAYS = 180
const MS_PER_DAY = 24 * 60 * 60 * 1000

@Injectable()
export class AccountAccessTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issueToken(accountId: string, label?: string) {
    const token = randomBytes(ACCOUNT_TOKEN_BYTES).toString('base64url')
    const expiresAt = this.getTokenExpiresAt()
    const record = await this.prisma.accountAccessToken.create({
      data: {
        accountId,
        tokenHash: this.hashToken(token),
        label,
        expiresAt,
      },
    })

    return {
      token,
      tokenId: record.id,
      expiresAt: record.expiresAt?.toISOString(),
    }
  }

  async assertAccountAccess(
    accountId: string | undefined,
    headers: AccountAccessHeaders | undefined,
  ) {
    const token = this.getTokenFromHeaders(headers)

    if (!accountId || !token) {
      throw new UnauthorizedException('ACCOUNT_TOKEN_REQUIRED')
    }

    const record = await this.prisma.accountAccessToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: {
        id: true,
        accountId: true,
        expiresAt: true,
        revokedAt: true,
      },
    })
    const now = new Date()

    if (
      !record ||
      record.accountId !== accountId ||
      record.revokedAt ||
      (record.expiresAt && record.expiresAt <= now)
    ) {
      throw new UnauthorizedException('ACCOUNT_TOKEN_INVALID')
    }

    await this.prisma.accountAccessToken.updateMany({
      where: { id: record.id },
      data: { lastUsedAt: now },
    })

    return { accountId: record.accountId, tokenId: record.id }
  }

  async assertHeadersAccountAccess(headers: AccountAccessHeaders | undefined) {
    return this.assertAccountAccess(this.getAccountIdFromHeaders(headers), headers)
  }

  getAccountIdFromHeaders(headers: AccountAccessHeaders | undefined) {
    return this.getHeader(headers, 'x-cschedule-account-id')
  }

  private getTokenFromHeaders(headers: AccountAccessHeaders | undefined) {
    const explicit = this.getHeader(headers, 'x-cschedule-account-token')

    if (explicit) {
      return explicit
    }

    const authorization = this.getHeader(headers, 'authorization')

    if (!authorization.startsWith(AUTHORIZATION_SCHEME)) {
      return ''
    }

    return authorization.slice(AUTHORIZATION_SCHEME.length).trim()
  }

  private getHeader(
    headers: AccountAccessHeaders | undefined,
    key: string,
  ) {
    if (!headers) {
      return ''
    }

    const lowerKey = key.toLowerCase()
    const value =
      headers[lowerKey] ??
      headers[key] ??
      headers[Object.keys(headers).find((item) => item.toLowerCase() === lowerKey) || '']

    return Array.isArray(value) ? String(value[0] || '').trim() : String(value || '').trim()
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private getTokenExpiresAt() {
    const ttlDays = Number(
      process.env.ACCOUNT_ACCESS_TOKEN_TTL_DAYS ??
        DEFAULT_ACCOUNT_TOKEN_TTL_DAYS,
    )
    const safeTtlDays =
      Number.isFinite(ttlDays) && ttlDays > 0
        ? ttlDays
        : DEFAULT_ACCOUNT_TOKEN_TTL_DAYS

    return new Date(Date.now() + safeTtlDays * MS_PER_DAY)
  }
}

@Injectable()
export class AccountAccessGuard implements CanActivate {
  constructor(private readonly accountAccess: AccountAccessTokenService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      params?: Record<string, string | undefined>
      headers?: AccountAccessHeaders
    }>()

    await this.accountAccess.assertAccountAccess(
      request.params?.accountId,
      request.headers,
    )

    return true
  }
}
