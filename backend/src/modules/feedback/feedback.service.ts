import { createHash } from 'crypto'

import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common'

import { PrismaService } from '../../common/prisma/prisma.service'

export interface SubmitFeedbackRequest {
  accountId?: string
  type?: string
  content: string
  contact?: string
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

  constructor(private readonly prisma: PrismaService) {}

  async submitFeedback(input: SubmitFeedbackRequest, clientKey?: string) {
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
}
