import { createHmac, timingSafeEqual } from 'crypto'

import { Injectable } from '@nestjs/common'

const TOKEN_VERSION = 'v1'
const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

@Injectable()
export class OpenidAbuseTokenService {
  issue(openid: string) {
    const cleanOpenid = this.normalizeOpenid(openid)
    const expiresAt = Date.now() + DEFAULT_TOKEN_TTL_MS
    const payload = `${TOKEN_VERSION}.${expiresAt}.${this.toBase64Url(cleanOpenid)}`
    const signature = this.sign(payload)

    return `${payload}.${signature}`
  }

  verify(token: string | undefined) {
    const parts = String(token || '').split('.')

    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
      return ''
    }

    const [version, expiresAtText, openidBase64, signature] = parts
    const expiresAt = Number(expiresAtText)

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return ''
    }

    const payload = `${version}.${expiresAtText}.${openidBase64}`
    const expectedSignature = this.sign(payload)

    if (!this.isEqual(signature, expectedSignature)) {
      return ''
    }

    return this.normalizeOpenid(this.fromBase64Url(openidBase64))
  }

  private sign(payload: string) {
    return createHmac('sha256', this.getSecret()).update(payload).digest('base64url')
  }

  private getSecret() {
    return (
      process.env.OPENID_ABUSE_TOKEN_SECRET ||
      process.env.CSCHEDULE_WORKER_SECRET ||
      process.env.ADMIN_API_KEY ||
      'cschedule-local-abuse-token-secret'
    )
  }

  private normalizeOpenid(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, 128) : ''
  }

  private toBase64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url')
  }

  private fromBase64Url(value: string) {
    try {
      return Buffer.from(value, 'base64url').toString('utf8')
    } catch {
      return ''
    }
  }

  private isEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left)
    const rightBuffer = Buffer.from(right)

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    )
  }
}
