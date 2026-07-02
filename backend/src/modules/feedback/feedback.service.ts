import { createHash } from 'crypto'

import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../common/prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'

export interface SubmitFeedbackRequest {
  accountId?: string
  type?: string
  content: string
  contact?: string
}

export interface SubmitSchoolImportAlertRequest {
  schoolId?: string
  accountId?: string
  providerId?: string
  contextId?: string
  stage?: string
  errorCode?: string
  errorMessage?: string
}

export interface SubmitSchoolImportAlertResponse {
  id: string
  status: string
  createdAt: string
  schoolDisabled: boolean
  userMessage?: string
}

const MAX_CONTENT_LENGTH = 1000
const MAX_CONTACT_LENGTH = 120
const CLIENT_COOLDOWN_MS = 60 * 1000
const CLIENT_WINDOW_MS = 15 * 60 * 1000
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000
const MAX_CLIENT_SUBMISSIONS_PER_WINDOW = 5
const MAX_CLIENT_RECORDS = 2000

interface ClientAbuseRecord {
  submittedAt: number[]
  fingerprints: Map<string, number>
}

@Injectable()
export class FeedbackService {
  private readonly clientAbuseRecords = new Map<string, ClientAbuseRecord>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  async submitFeedback(input: SubmitFeedbackRequest, clientKey?: string) {
    await this.settingsService.assertHomeShortcutEnabled('feedback')

    const content = this.getText(input.content, MAX_CONTENT_LENGTH)

    if (!content) {
      throw new BadRequestException('请填写反馈内容')
    }

    this.assertClientCanSubmit(
      clientKey,
      this.getContentFingerprint([input.type, content, input.contact]),
    )

    const accountId = this.getOptionalText(input.accountId, 80)
    const account = accountId
      ? await this.prisma.studentAccount.findUnique({
          where: { id: accountId },
        })
      : null

    const feedback = await this.prisma.feedbackItem.create({
      data: {
        accountId,
        schoolId: account?.schoolId,
        type: String(input.type || 'experience').trim().slice(0, 40),
        content,
        contact: this.getOptionalText(input.contact, MAX_CONTACT_LENGTH),
      },
    })

    return {
      id: feedback.id,
      status: feedback.status,
      createdAt: feedback.createdAt.toISOString(),
    }
  }

  async submitSchoolImportAlert(
    input: SubmitSchoolImportAlertRequest,
  ): Promise<SubmitSchoolImportAlertResponse> {
    const schoolId = this.getOptionalText(input.schoolId, 80)

    if (!schoolId) {
      throw new BadRequestException('缺少学校信息')
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        shortName: true,
        providerId: true,
        enabled: true,
        status: true,
      },
    })

    if (!school) {
      throw new BadRequestException('学校不存在')
    }

    const accountId = this.getOptionalText(input.accountId, 80)
    const account = accountId
      ? await this.prisma.studentAccount.findFirst({
          where: { id: accountId, schoolId },
          select: { id: true },
        })
      : null
    const shouldDisableSchool = this.isSchoolSystemError(input)
    const feedback = await this.prisma.$transaction(async (tx) => {
      if (shouldDisableSchool && (school.enabled || school.status !== 'disabled')) {
        await tx.school.update({
          where: { id: school.id },
          data: { enabled: false, status: 'disabled' },
        })
      }

      return tx.feedbackItem.create({
        data: {
          accountId: account?.id,
          schoolId: school.id,
          type: 'school_import_alert',
          content: this.buildSchoolImportAlertContent({
            school,
            providerId: input.providerId,
            contextId: input.contextId,
            stage: input.stage,
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            schoolDisabled: shouldDisableSchool,
          }),
        },
      })
    })

    return {
      id: feedback.id,
      status: feedback.status,
      createdAt: feedback.createdAt.toISOString(),
      schoolDisabled: shouldDisableSchool,
      ...(shouldDisableSchool
        ? { userMessage: '学校教务系统暂时异常，已暂停该学校导入，请稍后再试' }
        : {}),
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
      throw new HttpException('请稍后再提交反馈', HttpStatus.TOO_MANY_REQUESTS)
    }

    if (record.submittedAt.length >= MAX_CLIENT_SUBMISSIONS_PER_WINDOW) {
      throw new HttpException('反馈提交过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS)
    }

    const duplicatedAt = record.fingerprints.get(fingerprint)

    if (duplicatedAt && now - duplicatedAt < DUPLICATE_WINDOW_MS) {
      throw new HttpException('请勿重复提交相同反馈', HttpStatus.TOO_MANY_REQUESTS)
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
      .update(values.map((value) => this.getText(value, MAX_CONTENT_LENGTH)).join('\n'))
      .digest('hex')
  }

  private getText(value: unknown, maxLength: number) {
    return String(value || '').trim().slice(0, maxLength)
  }

  private getOptionalText(value: unknown, maxLength: number) {
    const text = this.getText(value, maxLength)
    return text || undefined
  }

  private buildSchoolImportAlertContent(input: {
    school: { id: string; name: string; shortName: string | null; providerId: string | null }
    providerId?: string
    contextId?: string
    stage?: string
    errorCode?: string
    errorMessage?: string
    schoolDisabled?: boolean
  }) {
    const lines = [
      `Auto disabled: ${input.schoolDisabled ? 'yes' : 'no'}`,
      '学校导入/同步异常，请管理员优先处理。',
      `学校：${input.school.name}${input.school.shortName ? `（${input.school.shortName}）` : ''}`,
      `学校 ID：${input.school.id}`,
      `Provider：${this.getOptionalText(input.providerId, 80) || input.school.providerId || '--'}`,
      `阶段：${this.getOptionalText(input.stage, 80) || '--'}`,
      `错误码：${this.getOptionalText(input.errorCode, 120) || '--'}`,
      `错误信息：${this.getOptionalText(input.errorMessage, 500) || '--'}`,
      `Context：${this.getOptionalText(input.contextId, 120) || '--'}`,
    ]

    return lines.join('\n').slice(0, MAX_CONTENT_LENGTH)
  }

  private isSchoolSystemError(input: SubmitSchoolImportAlertRequest) {
    const code = this.getOptionalText(input.errorCode, 120)?.toUpperCase() || ''
    const message = this.getOptionalText(input.errorMessage, 500)?.toLowerCase() || ''
    const userErrorCodes = [
      'INVALID_CREDENTIAL',
      'SAVED_CREDENTIAL_REQUIRED',
      'SESSION_EXPIRED',
      'CREDENTIAL_SAVE_UNSUPPORTED',
      'CLIENT_CACHE_RESULTS_UNTRUSTED',
      'CLOUD_IMPORT_PROOF_REQUIRED',
    ]

    if (userErrorCodes.some((item) => code.includes(item) || message.includes(item.toLowerCase()))) {
      return false
    }

    return (
      code.includes('CLOUD_SYNC_FAILED') ||
      code.includes('CLOUD_SYNC_EMPTY_RESULT') ||
      code.includes('SYNC_TASK_TIMEOUT') ||
      code.includes('PARSER_FAILED') ||
      code.includes('UNKNOWN') ||
      message.includes('request:fail') ||
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('cloud_sync_failed') ||
      message.includes('cloud_sync_empty_result') ||
      message.includes('parser') ||
      message.includes('课表导入失败') ||
      message.includes('暂时无法导入')
    )
  }
}
