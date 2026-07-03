import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../../common/prisma/prisma.service'
import {
  QrcodeLoginConfig,
  QrcodeLoginCreateResponse,
  QrcodeLoginDescriptor,
  QrcodeLoginStatus,
  QrcodeLoginStatusResponse,
} from './qrcode-login.types'

const DEFAULT_EXPIRES_IN_SECONDS = 120
const DEFAULT_POLL_INTERVAL_MS = 2000

type QrcodeLoginSession = {
  id: string
  schoolId: string
  qrcodeKey?: string
  config: QrcodeLoginConfig
  status: QrcodeLoginStatus
  qrcodeImage?: string
  qrcodeUrl?: string
  expiresAtMs: number
  confirmedAt?: string
  sessionPayload?: unknown
  message?: string
  cookies: string[]
}

type FetchResult = {
  data: unknown
  cookies: string[]
}

@Injectable()
export class QrcodeLoginService {
  private readonly sessions = new Map<string, QrcodeLoginSession>()

  constructor(private readonly prisma: PrismaService) {}

  async createSession(schoolId: string): Promise<QrcodeLoginCreateResponse> {
    const config = await this.getEnabledConfig(schoolId)
    const expiresInSeconds = this.getExpiresInSeconds(config)
    const expiresAtMs = Date.now() + expiresInSeconds * 1000
    const sessionId = this.createSessionId(schoolId)

    let qrcodeImage: string | undefined
    let qrcodeUrl: string | undefined
    let qrcodeKey: string | undefined
    let cookies: string[] = []

    if (config.create?.url) {
      const result = await this.fetchConfigured(config.create, {})
      cookies = result.cookies
      qrcodeImage = this.getStringAtPath(result.data, config.create.qrcodeImagePath)
      qrcodeUrl = this.getStringAtPath(result.data, config.create.qrcodeUrlPath)
      qrcodeKey = this.getStringAtPath(result.data, config.create.qrcodeKeyPath)
    }

    if (!qrcodeImage && !qrcodeUrl) {
      throw new BadRequestException('QRCODE_LOGIN_CREATE_NOT_CONFIGURED')
    }

    const session: QrcodeLoginSession = {
      id: sessionId,
      schoolId,
      qrcodeKey,
      config,
      status: 'pending',
      qrcodeImage,
      qrcodeUrl,
      expiresAtMs,
      cookies,
    }

    this.sessions.set(sessionId, session)

    return {
      sessionId,
      status: session.status,
      qrcodeImage,
      qrcodeUrl,
      expiresAt: new Date(expiresAtMs).toISOString(),
      pollIntervalMs: this.getPollIntervalMs(config),
      title: config.title,
      notice: config.notice,
    }
  }

  async getStatus(
    schoolId: string,
    sessionId: string,
  ): Promise<QrcodeLoginStatusResponse> {
    const session = this.getSession(schoolId, sessionId)

    if (this.isExpired(session)) {
      session.status = 'expired'
      return this.toStatusResponse(session)
    }

    if (session.status === 'pending' || session.status === 'scanned') {
      await this.refreshStatus(session)
    }

    return this.toStatusResponse(session)
  }

  cancelSession(schoolId: string, sessionId: string): QrcodeLoginStatusResponse {
    const session = this.getSession(schoolId, sessionId)
    session.status = 'cancelled'
    session.message = 'QRCODE_LOGIN_CANCELLED'
    return this.toStatusResponse(session)
  }

  async getDescriptor(schoolId: string): Promise<QrcodeLoginDescriptor | undefined> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { config: true },
    })
    const config = this.getConfig(school?.config)

    if (!config?.enabled) {
      return undefined
    }

    return {
      enabled: true,
      title: config.title,
      notice: config.notice,
      expiresInSeconds: this.getExpiresInSeconds(config),
      pollIntervalMs: this.getPollIntervalMs(config),
    }
  }

  getDescriptorFromConfig(configValue: unknown): QrcodeLoginDescriptor | undefined {
    const config = this.getConfig(configValue)

    if (!config?.enabled) {
      return undefined
    }

    return {
      enabled: true,
      title: config.title,
      notice: config.notice,
      expiresInSeconds: this.getExpiresInSeconds(config),
      pollIntervalMs: this.getPollIntervalMs(config),
    }
  }

  private async getEnabledConfig(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        enabled: true,
        status: true,
        config: true,
      },
    })

    if (!school || !school.enabled || school.status !== 'enabled') {
      throw new NotFoundException('School not found')
    }

    const config = this.getConfig(school.config)

    if (!config?.enabled) {
      throw new BadRequestException('QRCODE_LOGIN_NOT_SUPPORTED')
    }

    return config
  }

  private async refreshStatus(session: QrcodeLoginSession) {
    const poll = session.config.poll

    if (!poll?.url) {
      return
    }

    try {
      const result = await this.fetchConfigured(poll, {
        qrcodeKey: session.qrcodeKey,
        sessionId: session.id,
        cookies: session.cookies,
      })
      const rawStatus = this.getStringAtPath(result.data, poll.statusPath)
      const nextStatus = this.mapStatus(rawStatus, poll)

      if (result.cookies.length) {
        session.cookies = this.mergeCookies(session.cookies, result.cookies)
      }

      session.status = nextStatus

      if (nextStatus === 'confirmed') {
        session.confirmedAt = new Date().toISOString()
        session.sessionPayload = poll.sessionPath
          ? this.getValueAtPath(result.data, poll.sessionPath)
          : result.data
      }
    } catch (error) {
      session.status = 'failed'
      session.message = error instanceof Error ? error.message : 'QRCODE_LOGIN_POLL_FAILED'
    }
  }

  private async fetchConfigured(
    request: NonNullable<QrcodeLoginConfig['create']> | NonNullable<QrcodeLoginConfig['poll']>,
    variables: { qrcodeKey?: string; sessionId?: string; cookies?: string[] },
  ): Promise<FetchResult> {
    if (!request.url) {
      throw new BadRequestException('QRCODE_LOGIN_URL_REQUIRED')
    }

    const url = this.interpolate(request.url, variables)
    const headers = this.interpolateRecord(request.headers || {}, variables)
    const cookieHeader = variables.cookies?.join('; ')

    if (cookieHeader && !headers.cookie) {
      headers.cookie = cookieHeader
    }

    const response = await fetch(url, {
      method: request.method || 'GET',
      headers,
      body:
        request.method === 'POST' && request.body !== undefined
          ? JSON.stringify(this.interpolateValue(request.body, variables))
          : undefined,
    })

    if (!response.ok) {
      throw new Error(`QRCODE_LOGIN_HTTP_${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    const cookies = this.getSetCookies(response.headers)
    const data = contentType.includes('application/json')
      ? await response.json()
      : await response.text()

    return { data, cookies }
  }

  private mapStatus(
    rawStatus: string | undefined,
    poll: NonNullable<QrcodeLoginConfig['poll']>,
  ): QrcodeLoginStatus {
    const value = String(rawStatus || '').trim()

    if (this.includesValue(poll.successValues, value)) return 'confirmed'
    if (this.includesValue(poll.scannedValues, value)) return 'scanned'
    if (this.includesValue(poll.expiredValues, value)) return 'expired'
    if (this.includesValue(poll.failedValues, value)) return 'failed'
    if (this.includesValue(poll.pendingValues, value)) return 'pending'

    return value ? 'failed' : 'pending'
  }

  private includesValue(values: string[] | undefined, value: string) {
    return Boolean(values?.some((item) => item === value))
  }

  private getSession(schoolId: string, sessionId: string) {
    const session = this.sessions.get(sessionId)

    if (!session || session.schoolId !== schoolId) {
      throw new NotFoundException('QRCODE_LOGIN_SESSION_NOT_FOUND')
    }

    return session
  }

  private toStatusResponse(session: QrcodeLoginSession): QrcodeLoginStatusResponse {
    return {
      sessionId: session.id,
      status: session.status,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      message: session.message,
      confirmedAt: session.confirmedAt,
    }
  }

  private isExpired(session: QrcodeLoginSession) {
    return Date.now() >= session.expiresAtMs && session.status !== 'confirmed'
  }

  private getConfig(configValue: unknown): QrcodeLoginConfig | undefined {
    const root = this.asRecord(configValue)
    const authConfig = this.asRecord(root.authConfig)
    const provider = this.asRecord(root.provider)
    const providerAuthConfig = this.asRecord(provider.authConfig)
    const qrcode =
      root.qrcodeLogin ||
      authConfig.qrcodeLogin ||
      provider.qrcodeLogin ||
      providerAuthConfig.qrcodeLogin

    if (!qrcode || typeof qrcode !== 'object' || Array.isArray(qrcode)) {
      return undefined
    }

    return qrcode as QrcodeLoginConfig
  }

  private getExpiresInSeconds(config: QrcodeLoginConfig) {
    return this.clampNumber(config.expiresInSeconds, 30, 600, DEFAULT_EXPIRES_IN_SECONDS)
  }

  private getPollIntervalMs(config: QrcodeLoginConfig) {
    return this.clampNumber(config.pollIntervalMs, 1000, 10000, DEFAULT_POLL_INTERVAL_MS)
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
  ) {
    const numberValue = Number(value)

    if (!Number.isFinite(numberValue)) {
      return fallback
    }

    return Math.min(Math.max(Math.round(numberValue), min), max)
  }

  private getStringAtPath(value: unknown, path: string | undefined) {
    const result = this.getValueAtPath(value, path)
    return typeof result === 'string' && result.trim() ? result.trim() : undefined
  }

  private getValueAtPath(value: unknown, path: string | undefined): unknown {
    if (!path) {
      return undefined
    }

    return path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') {
        return undefined
      }

      return (current as Record<string, unknown>)[key]
    }, value)
  }

  private interpolateRecord(
    value: Record<string, string>,
    variables: { qrcodeKey?: string; sessionId?: string },
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.toLowerCase(),
        this.interpolate(item, variables),
      ]),
    )
  }

  private interpolateValue(
    value: unknown,
    variables: { qrcodeKey?: string; sessionId?: string },
  ): unknown {
    if (typeof value === 'string') {
      return this.interpolate(value, variables)
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.interpolateValue(item, variables))
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.interpolateValue(item, variables),
        ]),
      )
    }

    return value
  }

  private interpolate(
    value: string,
    variables: { qrcodeKey?: string; sessionId?: string },
  ) {
    return value
      .replace(/\{\{qrcodeKey\}\}/g, encodeURIComponent(variables.qrcodeKey || ''))
      .replace(/\{\{sessionId\}\}/g, encodeURIComponent(variables.sessionId || ''))
  }

  private getSetCookies(headers: Headers) {
    const raw = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : []

    if (raw.length) {
      return raw.map((cookie) => cookie.split(';')[0]).filter(Boolean)
    }

    const cookie = headers.get('set-cookie')
    return cookie ? [cookie.split(';')[0]].filter(Boolean) : []
  }

  private mergeCookies(current: string[], incoming: string[]) {
    const byName = new Map<string, string>()

    for (const cookie of [...current, ...incoming]) {
      const name = cookie.split('=')[0]
      if (name) {
        byName.set(name, cookie)
      }
    }

    return [...byName.values()]
  }

  private createSessionId(schoolId: string) {
    return [
      'qr',
      schoolId.replace(/[^a-zA-Z0-9_-]/g, ''),
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 10),
    ].join('_')
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }
}
