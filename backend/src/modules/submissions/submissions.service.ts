import { createHash } from 'crypto'

import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { DataTarget as PrismaDataTarget } from '@prisma/client'

import { PrismaService } from '../../common/prisma/prisma.service'
import { DataTarget, LoginMode } from '../providers/provider.types'
import { SettingsService } from '../settings/settings.service'

export interface CreateSchoolSubmissionRequest {
  schoolName: string
  aliases?: string[]
  province?: string
  city?: string
  officialWebsite?: string
  eduSystemWebsite?: string
  loginUrl?: string
  loginModeHint?: LoginMode
  requestedTargets?: DataTarget[]
  note?: string
}

const MAX_TEXT_LENGTHS = {
  schoolName: 80,
  alias: 80,
  province: 40,
  city: 40,
  url: 300,
  note: 1000,
}
const ALLOWED_LOGIN_MODES = [
  'direct_password',
  'password_captcha',
  'cas_simple',
  'cas_webview',
  'oauth_webview',
  'qrcode',
]
const ALLOWED_DATA_TARGETS = ['course', 'score', 'exam', 'profile'] as const
const CLIENT_COOLDOWN_MS = 5 * 60 * 1000
const CLIENT_WINDOW_MS = 24 * 60 * 60 * 1000
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_CLIENT_SUBMISSIONS_PER_WINDOW = 3
const MAX_CLIENT_RECORDS = 2000
const URL_PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i

interface ClientAbuseRecord {
  submittedAt: number[]
  fingerprints: Map<string, number>
}

@Injectable()
export class SubmissionsService {
  private readonly clientAbuseRecords = new Map<string, ClientAbuseRecord>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  async createSubmission(input: CreateSchoolSubmissionRequest, clientKey?: string) {
    await this.settingsService.assertHomeShortcutEnabled('submission')

    const schoolName = this.getText(input.schoolName, MAX_TEXT_LENGTHS.schoolName)

    if (!schoolName) {
      throw new BadRequestException('请填写学校名称')
    }

    const eduSystemWebsite = this.getHttpsUrl(
      input.eduSystemWebsite,
      'eduSystemWebsite',
      true,
    )
    const officialWebsite = this.getHttpsUrl(input.officialWebsite, 'officialWebsite')
    const loginUrl = this.getHttpsUrl(input.loginUrl, 'loginUrl')
    const loginModeHint = this.getLoginMode(input.loginModeHint)
    const requestedTargets = this.getRequestedTargets(input.requestedTargets)

    this.assertClientCanSubmit(
      clientKey,
      this.getContentFingerprint([
        schoolName,
        input.aliases,
        input.province,
        input.city,
        officialWebsite,
        eduSystemWebsite,
        loginUrl,
      ]),
    )

    const submission = await this.prisma.schoolAccessSubmission.create({
      data: {
        schoolName,
        aliases: this.getAliases(input.aliases),
        province: this.getOptionalText(input.province, MAX_TEXT_LENGTHS.province),
        city: this.getOptionalText(input.city, MAX_TEXT_LENGTHS.city),
        officialWebsite,
        eduSystemWebsite,
        loginUrl,
        loginModeHint,
        requestedTargets,
        note: this.getOptionalText(input.note, MAX_TEXT_LENGTHS.note),
      },
    })

    return {
      id: submission.id,
      status: submission.status,
      createdAt: submission.createdAt.toISOString(),
    }
  }

  private assertClientCanSubmit(clientKey: string | undefined, fingerprint: string) {
    if (!clientKey) {
      return
    }

    const now = Date.now()
    const record = this.getClientAbuseRecord(clientKey, now)
    const lastSubmittedAt = record.submittedAt[record.submittedAt.length - 1] ?? 0

    if (now - lastSubmittedAt < CLIENT_COOLDOWN_MS) {
      throw new HttpException('请稍后再提交学校申请', HttpStatus.TOO_MANY_REQUESTS)
    }

    if (record.submittedAt.length >= MAX_CLIENT_SUBMISSIONS_PER_WINDOW) {
      throw new HttpException('学校申请提交过于频繁，请明天再试', HttpStatus.TOO_MANY_REQUESTS)
    }

    const duplicatedAt = record.fingerprints.get(fingerprint)

    if (duplicatedAt && now - duplicatedAt < DUPLICATE_WINDOW_MS) {
      throw new HttpException('请勿重复提交相同学校申请', HttpStatus.TOO_MANY_REQUESTS)
    }

    record.submittedAt.push(now)
    record.fingerprints.set(fingerprint, now)
    this.pruneClientRecords(now)
  }

  private getClientAbuseRecord(clientKey: string, now: number) {
    const record =
      this.clientAbuseRecords.get(clientKey) ?? {
        submittedAt: [],
        fingerprints: new Map<string, number>(),
      }

    record.submittedAt = record.submittedAt.filter(
      (submittedAt) => now - submittedAt <= CLIENT_WINDOW_MS,
    )

    for (const [fingerprint, submittedAt] of record.fingerprints) {
      if (now - submittedAt > DUPLICATE_WINDOW_MS) {
        record.fingerprints.delete(fingerprint)
      }
    }

    this.clientAbuseRecords.set(clientKey, record)
    return record
  }

  private pruneClientRecords(now: number) {
    if (this.clientAbuseRecords.size <= MAX_CLIENT_RECORDS) {
      return
    }

    for (const [clientKey, record] of this.clientAbuseRecords) {
      const lastSubmittedAt = record.submittedAt[record.submittedAt.length - 1] ?? 0

      if (now - lastSubmittedAt > CLIENT_WINDOW_MS && record.fingerprints.size === 0) {
        this.clientAbuseRecords.delete(clientKey)
      }
    }
  }

  private getContentFingerprint(values: unknown[]) {
    return createHash('sha256')
      .update(values.map((value) => this.getFingerprintPart(value)).join('\n'))
      .digest('hex')
  }

  private getFingerprintPart(value: unknown): string {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.getText(item, MAX_TEXT_LENGTHS.alias).toLowerCase())
        .filter(Boolean)
        .sort()
        .join(',')
    }

    return this.getText(value, MAX_TEXT_LENGTHS.note).toLowerCase()
  }

  private getText(value: unknown, maxLength: number) {
    return String(value || '').trim().slice(0, maxLength)
  }

  private getOptionalText(value: unknown, maxLength: number) {
    const text = this.getText(value, maxLength)
    return text || undefined
  }

  private getHttpsUrl(value: unknown, field: string, required = false) {
    const text = this.getOptionalText(value, MAX_TEXT_LENGTHS.url)

    if (!text) {
      if (required) {
        throw new BadRequestException(this.getUrlErrorMessage(field, 'required'))
      }

      return undefined
    }

    let url: URL
    const candidate = URL_PROTOCOL_PATTERN.test(text) ? text : `https://${text}`

    try {
      url = new URL(candidate)
    } catch {
      throw new BadRequestException(this.getUrlErrorMessage(field, 'invalid'))
    }

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      throw new BadRequestException(this.getUrlErrorMessage(field, 'protocol'))
    }

    return url.toString()
  }

  private getUrlErrorMessage(field: string, reason: 'required' | 'invalid' | 'protocol') {
    const label =
      field === 'eduSystemWebsite'
        ? '教务系统网址'
        : field === 'officialWebsite'
          ? '学校官网'
          : '登录入口网址'

    if (reason === 'required') {
      return `请填写${label}`
    }

    if (reason === 'protocol') {
      return `${label}需为 http/https 或域名/IP，不能只填协议或文字说明`
    }

    return `${label}需为完整网址或域名/IP`
  }

  private getAliases(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map((item) => this.getText(item, MAX_TEXT_LENGTHS.alias))
      .filter(Boolean)
      .slice(0, 10)
  }

  private getLoginMode(value: unknown) {
    return typeof value === 'string' && ALLOWED_LOGIN_MODES.includes(value)
      ? value as LoginMode
      : undefined
  }

  private getRequestedTargets(value: unknown) {
    if (!Array.isArray(value)) {
      return [PrismaDataTarget.course]
    }

    const targets = value.filter((target): target is PrismaDataTarget =>
      typeof target === 'string' &&
      (ALLOWED_DATA_TARGETS as readonly string[]).includes(target),
    )

    return targets.length > 0 ? [...new Set(targets)] : [PrismaDataTarget.course]
  }
}
