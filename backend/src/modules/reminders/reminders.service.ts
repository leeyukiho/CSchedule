import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ReminderSubscription, ReminderType } from '@prisma/client'

import { PrismaService } from '../../common/prisma/prisma.service'
import { ProviderDisplayService } from '../providers/provider-display.service'
import {
  getReminderConfig,
  isWithinReminderWindow,
  mergeReminderConfig,
  ReminderConfigPatch,
  ReminderWorkerConfig,
} from './reminders.config'
import { WechatSubscribeMessageService } from './wechat-subscribe-message.service'

const REMINDER_SETTING_KEY = 'reminders.worker'

interface ReminderRunOptions {
  force?: boolean
  dryRun?: boolean
  limit?: number
  type?: ReminderType
  accountId?: string
  openid?: string
}

interface ReminderContent {
  title: string
  summary: string
  note: string
  shouldSend: boolean
  templateData: Record<string, { value: string }>
}

interface CourseReminderCandidate {
  type: 'daily_course'
  item: Record<string, unknown>
  startsAt: Date
  room: string
  startTime: string
  teacher: string
  summary: string
}

interface ExamReminderCandidate {
  type: 'exam'
  item: Record<string, unknown>
  startsAt: Date
  room: string
  time: string
  tip: string
  summary: string
}

type ReminderCandidate = CourseReminderCandidate | ExamReminderCandidate

interface AccountReminderPreference {
  enabled: boolean
  preferredTime: string
  hasOpenid: boolean
  openid?: string
  dailyCourseEnabled: boolean
  examEnabled: boolean
  templateIds: string[]
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name)
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechat: WechatSubscribeMessageService,
    private readonly providerDisplay: ProviderDisplayService,
  ) {}

  async resolveOpenid(code: string) {
    return { openid: await this.wechat.resolveOpenid(code) }
  }

  async getConfig() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: REMINDER_SETTING_KEY },
    })

    return mergeReminderConfig(getReminderConfig(), setting?.value)
  }

  async updateConfig(input: ReminderConfigPatch) {
    const nextConfig = mergeReminderConfig(await this.getConfig(), input)

    await this.prisma.systemSetting.upsert({
      where: { key: REMINDER_SETTING_KEY },
      update: { value: this.toJson(nextConfig) },
      create: { key: REMINDER_SETTING_KEY, value: this.toJson(nextConfig) },
    })

    return nextConfig
  }

  async runDueReminders(options: ReminderRunOptions = {}) {
    const config = await this.getConfig()
    const dryRun = options.dryRun ?? config.dryRun
    const now = new Date()

    if (!options.force && !config.enabled) {
      return { skipped: true, reason: 'REMINDER_DISABLED', config: this.publicConfig(config) }
    }

    if (
      !options.force &&
      !isWithinReminderWindow(now, config.sendWindowStart, config.sendWindowEnd)
    ) {
      return { skipped: true, reason: 'OUTSIDE_SEND_WINDOW', config: this.publicConfig(config) }
    }

    if (this.running) {
      return { skipped: true, reason: 'REMINDER_WORKER_RUNNING', config: this.publicConfig(config) }
    }

    this.running = true

    try {
      const dateKey = this.getLocalDateKey(now)
      const subscriptions = await this.findDueSubscriptions(config, dateKey, now, options)
      const startedAt = Date.now()
      const stats = {
        total: subscriptions.length,
        sent: 0,
        skipped: 0,
        failed: 0,
        dryRun,
      }
      let cursor = 0
      let nextSendAt = Date.now()

      const workerCount = Math.min(config.concurrency, Math.max(subscriptions.length, 1))
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (cursor < subscriptions.length) {
            if (Date.now() - startedAt > config.maxRuntimeMs) {
              return
            }

            const subscription = subscriptions[cursor]
            cursor += 1

            const waitMs = Math.max(0, nextSendAt - Date.now())
            nextSendAt = Math.max(Date.now(), nextSendAt) + Math.ceil(1000 / config.ratePerSecond)
            await this.delay(waitMs)

            const result = await this.sendOne(subscription, dateKey, { ...config, dryRun })
            stats[result] += 1
          }
        }),
      )

      return {
        ...stats,
        config: this.publicConfig(config, dryRun),
      }
    } finally {
      this.running = false
    }
  }

  async upsertSubscription(input: {
    accountId: string
    openid: string
    type: ReminderType
    templateId?: string
    preferredTime?: string
    status?: 'enabled' | 'disabled' | 'blocked'
  }) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: input.accountId },
      select: { id: true },
    })

    if (!account) {
      throw new NotFoundException('Student account not found')
    }

    return this.prisma.reminderSubscription.upsert({
      where: {
        accountId_openid_type: {
          accountId: input.accountId,
          openid: input.openid,
          type: input.type,
        },
      },
      update: {
        templateId: input.templateId,
        preferredTime: input.preferredTime,
        status: input.status,
      },
      create: {
        accountId: input.accountId,
        openid: input.openid,
        type: input.type,
        templateId: input.templateId,
        preferredTime: input.preferredTime || '07:30',
        status: input.status || 'enabled',
      },
    })
  }

  async getAccountPreferences(accountId: string) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
      select: { id: true, wechatOpenid: true },
    })

    if (!account) {
      throw new NotFoundException('Student account not found')
    }

    const config = await this.getConfig()
    const subscriptions = await this.prisma.reminderSubscription.findMany({
      where: { accountId },
      orderBy: { type: 'asc' },
    })
    const byType = new Map(subscriptions.map((item) => [item.type, item]))

    return this.toAccountReminderPreference(
      byType.get('daily_course'),
      byType.get('exam'),
      config.sendWindowStart,
      this.getTemplateIds(config),
      account.wechatOpenid || undefined,
    )
  }

  async updateAccountPreference(
    accountId: string,
    input: {
      enabled: boolean
      preferredTime?: string
      openid?: string
    },
  ) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
      select: { id: true, wechatOpenid: true },
    })

    if (!account) {
      throw new NotFoundException('Student account not found')
    }

    const config = await this.getConfig()
    const preferredTime = this.normalizePreferredTime(input.preferredTime, config.sendWindowStart)
    const existingSubscriptions = await this.prisma.reminderSubscription.findMany({
      where: { accountId },
    })
    const byType = new Map(existingSubscriptions.map((item) => [item.type, item]))
    const existingOpenid = existingSubscriptions.find((item) => item.openid)?.openid || ''
    const openid = input.openid || account.wechatOpenid || existingOpenid

    if (input.openid && input.openid !== account.wechatOpenid) {
      await this.prisma.studentAccount.update({
        where: { id: accountId },
        data: { wechatOpenid: input.openid },
      })
    }

    if (!openid) {
      if (!input.enabled) {
        await this.prisma.reminderSubscription.updateMany({
          where: { accountId },
          data: {
            status: 'disabled',
            preferredTime,
          },
        })
        return this.toAccountReminderPreference(
          undefined,
          undefined,
          preferredTime,
          this.getTemplateIds(config),
          account.wechatOpenid || undefined,
        )
      }

      throw new Error('OPENID_REQUIRED')
    }

    const [dailyCourse, exam] = await Promise.all([
      this.upsertAccountReminderType(
        accountId,
        openid,
        'daily_course',
        input.enabled,
        preferredTime,
        byType.get('daily_course')?.templateId,
      ),
      this.upsertAccountReminderType(
        accountId,
        openid,
        'exam',
        input.enabled,
        preferredTime,
        byType.get('exam')?.templateId,
      ),
    ])

    return this.toAccountReminderPreference(
      dailyCourse,
      exam,
      config.sendWindowStart,
      this.getTemplateIds(config),
      openid,
    )
  }

  private async findDueSubscriptions(
    config: ReminderWorkerConfig,
    dateKey: string,
    now: Date,
    options: ReminderRunOptions,
  ) {
    const limit = Math.min(options.limit || config.batchSize, config.batchSize)
    const currentTime = this.getLocalTimeValue(now)

    return this.prisma.reminderSubscription.findMany({
      where: {
        status: 'enabled',
        ...(options.type ? { type: options.type } : {}),
        ...(options.accountId ? { accountId: options.accountId } : {}),
        ...(options.openid ? { openid: options.openid } : {}),
        preferredTime: { lte: currentTime },
        OR: [{ lastSentDate: null }, { lastSentDate: { not: dateKey } }],
        account: {
          status: { in: ['active', 'cached_only'] },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    })
  }

  private async sendOne(
    subscription: ReminderSubscription,
    dateKey: string,
    config: ReminderWorkerConfig,
  ): Promise<'sent' | 'skipped' | 'failed'> {
    const content = await this.buildContent(subscription, config)

    if (!content.shouldSend) {
      await this.recordDelivery(subscription, dateKey, 'skipped', content)
      return 'skipped'
    }

    const templateId = this.getTemplateId(subscription, config)

    if (!templateId) {
      if (!config.dryRun) {
        await this.recordDelivery(subscription, dateKey, 'failed', content, undefined, 'TEMPLATE_ID_MISSING')
        return 'failed'
      }
    }

    const request = {
      touser: config.testOpenid || subscription.openid,
      template_id: templateId || `dry-run-${subscription.type}`,
      page: 'pages/index/index',
      data: content.templateData,
      miniprogram_state: this.getMiniProgramState(),
    }

    try {
      const response = await this.wechat.send(request, config.dryRun)
      await this.recordDelivery(subscription, dateKey, 'sent', content, request, undefined, undefined, response)
      return 'sent'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Unknown error')
      await this.recordDelivery(subscription, dateKey, 'failed', content, request, this.getErrorCode(message), message)
      return 'failed'
    }
  }

  private async buildContent(
    subscription: ReminderSubscription,
    config: ReminderWorkerConfig,
  ): Promise<ReminderContent> {
    const candidate = await this.findNextReminderCandidate(subscription.accountId, config)

    if (!candidate) {
      return this.emptyContent(subscription.type, '暂无后续课程或考试')
    }

    if (candidate.type !== subscription.type) {
      return this.emptyContent(subscription.type, '下一次最近安排由另一类提醒发送')
    }

    return candidate.type === 'daily_course'
      ? this.buildCourseContent(candidate)
      : this.buildExamContent(candidate)
  }

  private async findNextReminderCandidate(
    accountId: string,
    config: ReminderWorkerConfig,
  ): Promise<ReminderCandidate | null> {
    const [course, exam] = await Promise.all([
      this.findNextCourseCandidate(accountId, config),
      this.findNextExamCandidate(accountId),
    ])
    const candidates = [course, exam].filter((item): item is ReminderCandidate => Boolean(item))

    return candidates.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())[0] || null
  }

  private async findNextCourseCandidate(
    accountId: string,
    config: ReminderWorkerConfig,
  ): Promise<CourseReminderCandidate | null> {
    const cache = await this.prisma.courseCache.findFirst({
      where: { accountId },
      include: {
        account: {
          select: {
            providerId: true,
            school: { select: { config: true } },
          },
        },
      },
      orderBy: { syncedAt: 'desc' },
    })
    const courses = Array.isArray(cache?.coursesJson) ? cache.coursesJson.map((item) => this.asRecord(item)) : []
    const now = new Date()
    const termStarts = this.getTermStarts(cache?.account.school.config)
    const term = this.getCurrentTerm(cache?.termId || '', cache?.termsJson)
    const weekStart = this.getTeachingWeekStart(term, cache?.termId || '', termStarts)
    const maxWeek = this.getMaxCourseWeek(courses)
    const cacheSectionTimes = Array.isArray(cache?.sectionTimesJson) ? cache.sectionTimesJson : []
    const configuredSectionTimes = this.providerDisplay.getSectionTimes(
      cache?.account.school.config ?? null,
      cache?.account.providerId || '',
    )
    const sectionTimes = cacheSectionTimes.length ? cacheSectionTimes : configuredSectionTimes
    const candidates = courses
      .map((course) => this.toCourseReminderCandidate(course, weekStart, now, sectionTimes, maxWeek))
      .filter((item): item is CourseReminderCandidate => Boolean(item))
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())

    return candidates[0] || null
  }

  private buildCourseContent(candidate: CourseReminderCandidate): ReminderContent {
    const courseName = this.getText(candidate.item, ['name', 'courseName', 'course']) || '未命名课程'

    return {
      title: courseName,
      summary: candidate.summary,
      note: [courseName, candidate.room, candidate.startTime].filter(Boolean).join(' '),
      shouldSend: true,
      templateData: {
        thing8: { value: this.truncate(courseName, 20) },
        thing4: { value: this.truncate(candidate.room, 20) },
        time15: { value: this.toWechatTimeValue(candidate.startTime, this.getLocalDateKey(candidate.startsAt)) },
        thing13: { value: this.truncate(candidate.teacher, 20) },
      },
    }
  }

  private async findNextExamCandidate(accountId: string): Promise<ExamReminderCandidate | null> {
    const cache = await this.prisma.featureCache.findFirst({
      where: { accountId, target: 'exam' },
      orderBy: { syncedAt: 'desc' },
    })
    const items = this.extractExamItems(cache?.dataJson)
    const now = new Date()
    const candidates = items
      .map((exam) => this.toExamReminderCandidate(exam, now))
      .filter((item): item is ExamReminderCandidate => Boolean(item))
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())

    return candidates[0] || null
  }

  private buildExamContent(candidate: ExamReminderCandidate): ReminderContent {
    const courseName = this.getText(candidate.item, ['courseName', 'name', 'course']) || '未命名考试'

    return {
      title: courseName,
      summary: candidate.summary,
      note: [courseName, candidate.time, candidate.room].filter(Boolean).join(' '),
      shouldSend: true,
      templateData: {
        thing10: { value: this.truncate(courseName, 20) },
        thing7: { value: this.truncate(candidate.room, 20) },
        time6: { value: this.toWechatTimeValue(candidate.time, this.getLocalDateKey(candidate.startsAt)) },
        thing3: { value: this.truncate(candidate.tip, 20) },
      },
    }
  }

  private emptyContent(type: ReminderType, reason: string): ReminderContent {
    const isCourse = type === 'daily_course'
    const title = isCourse ? '暂无后续课程' : '暂无后续考试'

    return {
      title,
      summary: reason,
      note: reason,
      shouldSend: false,
      templateData: isCourse
        ? {
          thing8: { value: title },
          thing4: { value: '地点待定' },
          time15: { value: this.toWechatTimeValue('07:30') },
          thing13: { value: '教师待定' },
        }
        : {
          thing10: { value: title },
          thing7: { value: '地点待安排' },
          time6: { value: this.toWechatTimeValue('07:30') },
          thing3: { value: '打开小程序查看详情' },
        },
    }
  }

  private async recordDelivery(
    subscription: ReminderSubscription,
    dateKey: string,
    status: 'sent' | 'skipped' | 'failed',
    content: ReminderContent,
    request?: unknown,
    errorCode?: string,
    errorMessage?: string,
    response?: unknown,
  ) {
    const sentAt = status === 'sent' ? new Date() : undefined

    await this.prisma.reminderDelivery.upsert({
      where: {
        subscriptionId_dateKey: {
          subscriptionId: subscription.id,
          dateKey,
        },
      },
      update: {
        status,
        title: content.title,
        summary: content.summary,
        requestJson: this.toJson(request),
        responseJson: this.toJson(response),
        errorCode,
        errorMessage,
        sentAt,
      },
      create: {
        subscriptionId: subscription.id,
        accountId: subscription.accountId,
        openid: subscription.openid,
        type: subscription.type,
        dateKey,
        status,
        title: content.title,
        summary: content.summary,
        requestJson: this.toJson(request),
        responseJson: this.toJson(response),
        errorCode,
        errorMessage,
        sentAt,
      },
    })

    await this.prisma.reminderSubscription.update({
      where: { id: subscription.id },
      data: {
        ...(status === 'sent' || status === 'skipped'
          ? {
            status: 'disabled',
            lastSentDate: dateKey,
            lastSentAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
          }
          : { lastErrorCode: errorCode, lastErrorMessage: errorMessage }),
      },
    })
  }

  private getTemplateId(subscription: ReminderSubscription, config: ReminderWorkerConfig) {
    return (
      subscription.templateId ||
      (subscription.type === 'daily_course'
        ? config.dailyCourseTemplateId
        : config.examTemplateId)
    )
  }

  private extractExamItems(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.map((item) => this.asRecord(item))
    }

    const record = this.asRecord(value)
    const groups = ['items', 'upcoming', 'finished', 'unscheduled']

    return groups.flatMap((key) =>
      Array.isArray(record[key]) ? (record[key] as unknown[]).map((item) => this.asRecord(item)) : [],
    )
  }

  private publicConfig(config: ReminderWorkerConfig, dryRun = config.dryRun) {
    return {
      enabled: config.enabled,
      dryRun,
      sendWindowStart: config.sendWindowStart,
      sendWindowEnd: config.sendWindowEnd,
      batchSize: config.batchSize,
      concurrency: config.concurrency,
      ratePerSecond: config.ratePerSecond,
      maxRuntimeMs: config.maxRuntimeMs,
    }
  }

  private async upsertAccountReminderType(
    accountId: string,
    openid: string,
    type: ReminderType,
    enabled: boolean,
    preferredTime: string,
    templateId?: string | null,
  ) {
    return this.prisma.reminderSubscription.upsert({
      where: {
        accountId_openid_type: {
          accountId,
          openid,
          type,
        },
      },
      update: {
        status: enabled ? 'enabled' : 'disabled',
        preferredTime,
        templateId: templateId || undefined,
        ...(enabled ? { lastSentDate: null, lastSentAt: null, lastErrorCode: null, lastErrorMessage: null } : {}),
      },
      create: {
        accountId,
        openid,
        type,
        status: enabled ? 'enabled' : 'disabled',
        preferredTime,
        templateId: templateId || undefined,
      },
    })
  }

  private toAccountReminderPreference(
    dailyCourse: ReminderSubscription | undefined,
    exam: ReminderSubscription | undefined,
    defaultTime: string,
    templateIds: string[],
    accountOpenid?: string,
  ): AccountReminderPreference {
    const preferredTime = dailyCourse?.preferredTime || exam?.preferredTime || defaultTime
    const dailyCourseEnabled = dailyCourse?.status === 'enabled'
    const examEnabled = exam?.status === 'enabled'

    return {
      enabled: dailyCourseEnabled || examEnabled,
      preferredTime,
      hasOpenid: Boolean(accountOpenid || dailyCourse?.openid || exam?.openid),
      openid: accountOpenid || dailyCourse?.openid || exam?.openid || undefined,
      dailyCourseEnabled,
      examEnabled,
      templateIds,
    }
  }

  private getTemplateIds(config: ReminderWorkerConfig) {
    return [config.dailyCourseTemplateId, config.examTemplateId].filter(Boolean)
  }

  private normalizePreferredTime(value: string | undefined, fallback: string) {
    return value && /^\d{2}:\d{2}$/.test(value) ? value : fallback
  }

  private getWeekday(date = new Date()) {
    const day = date.getDay()
    return day === 0 ? 7 : day
  }

  private getLocalDateKey(date = new Date()) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
  }

  private getLocalTimeValue(date = new Date()) {
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')

    return `${hour}:${minute}`
  }

  private normalizeDateKey(value: string) {
    const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)

    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : ''
  }

  private toCourseReminderCandidate(
    course: Record<string, unknown>,
    weekStart: Date,
    now: Date,
    sectionTimes: unknown,
    maxWeek: number,
  ): CourseReminderCandidate | null {
    const weekday = Number(course.weekday)

    if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) {
      return null
    }

    const weeks = this.getCourseWeeks(course, maxWeek)
    const startTime = this.getCourseStartTime(course, sectionTimes)
    const timeParts = this.parseTimeParts(startTime)

    for (const week of weeks) {
      const startsAt = new Date(weekStart)
      startsAt.setDate(weekStart.getDate() + (week - 1) * 7 + weekday - 1)
      startsAt.setHours(timeParts.hour, timeParts.minute, 0, 0)

      if (startsAt.getTime() >= now.getTime()) {
        return {
          type: 'daily_course',
          item: course,
          startsAt,
          room: this.getText(course, ['classroom', 'location', 'room']) || '地点待定',
          startTime: startTime || this.formatSections(course) || '时间待定',
          teacher: this.getText(course, ['teacher', 'teacherName', 'instructor']) || '教师待定',
          summary: `下一次课程：${this.formatReminderDate(startsAt)}`,
        }
      }
    }

    return null
  }

  private toExamReminderCandidate(exam: Record<string, unknown>, now: Date): ExamReminderCandidate | null {
    const startsAt = this.getExamStartDate(exam)

    if (!startsAt || startsAt.getTime() < now.getTime()) {
      return null
    }

    return {
      type: 'exam',
      item: exam,
      startsAt,
      room: this.getText(exam, ['location', 'classroom', 'room']) || '地点待安排',
      time: this.getText(exam, ['time', 'startTime', 'startAt']) || '时间待安排',
      tip: this.getText(exam, ['remark', 'note', 'tips']) || '请提前到达考场',
      summary: `下一次考试：${this.formatReminderDate(startsAt)}`,
    }
  }

  private getCurrentTerm(termId: string, termsJson: unknown): { id: string; label: string } | null {
    const terms = Array.isArray(termsJson) ? termsJson.map((item) => this.asRecord(item)) : []
    const matched = terms.find((term) => this.getText(term, ['id']) === termId) || terms[0]

    if (matched) {
      const id = this.getText(matched, ['id']) || termId
      const label = this.getText(matched, ['label', 'name', 'title']) || id
      return id || label ? { id, label } : null
    }

    return termId ? { id: termId, label: termId } : null
  }

  private getTermStarts(config: unknown) {
    const record = this.asRecord(this.asRecord(config).termStarts)

    return Object.entries(record).reduce<Record<string, string>>((result, [key, value]) => {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        result[key] = value
      }

      return result
    }, {})
  }

  private getTeachingWeekStart(
    term: { id: string; label: string } | null,
    fallbackTermId: string,
    termStarts: Record<string, string>,
  ) {
    const customStart = this.parseLocalDate(this.getTermStartDateValue(term, fallbackTermId, termStarts))

    if (customStart) {
      return this.getMondayOnOrAfter(customStart)
    }

    const descriptor = this.parseTermDescriptor(term, fallbackTermId)
    const startYear = descriptor.yearStart || this.getCurrentAcademicStartYear()
    const nominalStart = descriptor.secondSemester
      ? new Date(startYear + 1, 1, 15)
      : new Date(startYear, 8, 1)

    return this.getMondayOnOrAfter(nominalStart)
  }

  private getTermStartDateValue(
    term: { id: string; label: string } | null,
    fallbackTermId: string,
    termStarts: Record<string, string>,
  ) {
    const ids = [term?.id || '', fallbackTermId].filter(Boolean)

    for (const id of ids) {
      const value = termStarts[id]
      if (value) return value

      const scopedMatch = id.match(/^([^:]+):(.+)$/)
      if (scopedMatch && termStarts[scopedMatch[2]]) {
        return termStarts[scopedMatch[2]]
      }

      const scopedKey = Object.keys(termStarts).find((key) => key.endsWith(`:${id}`))
      if (scopedKey && termStarts[scopedKey]) {
        return termStarts[scopedKey]
      }
    }

    return ''
  }

  private parseTermDescriptor(term: { id: string; label: string } | null, fallbackTermId: string) {
    const textParts = [term?.label || '', term?.id || '', fallbackTermId].filter(Boolean)
    const encoded = textParts.map((value) => value.trim().match(/^(20\d{2})-(3|12|16)$/)).find(Boolean)
    const text = textParts.join(' ').replace(/\s+/g, ' ').trim()
    const compactText = text.replace(/\s+/g, '')
    const yearMatch =
      text.match(/(20\d{2})\s*[-~—至]\s*(20\d{2})/) ||
      compactText.match(/(20\d{2})[-~—至]?(20\d{2})/)
    const encodedSemester = encoded?.[2] === '12' ? 2 : encoded?.[2] === '16' ? 3 : undefined
    const semester = encodedSemester || (this.isSecondSemesterText(text, compactText) ? 2 : 1)
    const encodedYear = encoded ? Number(encoded[1]) : undefined

    return {
      yearStart: yearMatch ? Number(yearMatch[1]) : encodedYear,
      secondSemester: semester === 2,
    }
  }

  private isSecondSemesterText(text: string, compactText: string) {
    return /第?\s*(二|2)\s*学期|下\s*学期|学期\s*2/i.test(text) ||
      compactText.includes('第二学期') ||
      compactText.includes('下学期')
  }

  private getCurrentAcademicStartYear(baseDate = new Date()) {
    return baseDate.getMonth() >= 8 ? baseDate.getFullYear() : baseDate.getFullYear() - 1
  }

  private parseLocalDate(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)

    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  }

  private getMondayOnOrAfter(date: Date) {
    const result = new Date(date)
    result.setHours(0, 0, 0, 0)
    const day = result.getDay() || 7
    const offset = day === 1 ? 0 : 8 - day
    result.setDate(result.getDate() + offset)

    return result
  }

  private getMaxCourseWeek(courses: Record<string, unknown>[]) {
    const maxWeek = courses.reduce((max, course) => {
      const weeks = Array.isArray(course.weeks) ? course.weeks.map(Number) : []
      const courseMax = weeks.filter((week) => Number.isFinite(week) && week > 0)
        .reduce((current, week) => Math.max(current, week), 0)

      return Math.max(max, courseMax)
    }, 0)

    return maxWeek || 20
  }

  private getCourseWeeks(course: Record<string, unknown>, maxWeek: number) {
    const weeks = Array.isArray(course.weeks)
      ? [...new Set(course.weeks.map(Number))]
        .filter((week) => Number.isFinite(week) && week > 0)
        .sort((left, right) => left - right)
      : []

    return weeks.length
      ? weeks
      : Array.from({ length: maxWeek }, (_, index) => index + 1)
  }

  private getExamStartDate(exam: Record<string, unknown>) {
    const directTime = this.parseDateTimeValue(this.getText(exam, ['startAt', 'startTime']))

    if (directTime) {
      return directTime
    }

    const date = this.normalizeDateKey(this.getText(exam, ['date']))
    if (!date) {
      return null
    }

    const timeParts = this.parseTimeParts(this.getText(exam, ['time']))
    const [year, month, day] = date.split('-').map(Number)

    return new Date(year, month - 1, day, timeParts.hour, timeParts.minute)
  }

  private parseDateTimeValue(value: string) {
    if (!value) {
      return null
    }

    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }

  private parseTimeParts(value: string) {
    const match = value.match(/(\d{1,2})\s*:\s*(\d{2})/)

    return {
      hour: match ? Number(match[1]) : 7,
      minute: match ? Number(match[2]) : 30,
    }
  }

  private formatReminderDate(date: Date) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const month = date.getMonth() + 1
    const day = date.getDate()
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')

    return `${month}月${day}日${weekdays[date.getDay()]} ${hour}:${minute}`
  }

  private formatSections(course: Record<string, unknown>) {
    const sections = Array.isArray(course.sections)
      ? course.sections.map(Number).filter((section) => Number.isFinite(section))
      : []
    const start = Number(course.startSection || sections[0] || 0)
    const end = Number(course.endSection || sections[sections.length - 1] || start)

    if (!start) {
      return ''
    }

    return start === end ? `第${start}节` : `第${start}-${end}节`
  }

  private getCourseStartSection(course: Record<string, unknown>) {
    const sections = Array.isArray(course.sections)
      ? course.sections.map(Number).filter((section) => Number.isFinite(section))
      : []

    return Number(course.startSection || sections[0] || 999)
  }

  private getCourseStartTime(course: Record<string, unknown>, sectionTimes: unknown) {
    const direct = this.getText(course, ['startTime', 'time'])

    if (direct) {
      return direct
    }

    const startSection = this.getCourseStartSection(course)
    const timeMap = this.getSectionTimeMap(sectionTimes)

    return timeMap[startSection]?.start || ''
  }

  private getSectionTimeMap(sectionTimes: unknown) {
    const result: Record<number, { start: string; end: string }> = {}

    if (Array.isArray(sectionTimes)) {
      sectionTimes.forEach((item, index) => {
        const record = this.asRecord(item)
        const section = Number(record.section || record.index || index + 1)
        const start = this.getText(record, ['start', 'startTime', 'begin'])
        const end = this.getText(record, ['end', 'endTime', 'finish'])

        if (Number.isFinite(section) && start) {
          result[section] = { start, end }
        }
      })
      return result
    }

    const record = this.asRecord(sectionTimes)
    for (const [key, value] of Object.entries(record)) {
      const section = Number(key)
      const item = this.asRecord(value)
      const start = typeof value === 'string'
        ? value
        : this.getText(item, ['start', 'startTime', 'begin'])
      const end = typeof value === 'string'
        ? ''
        : this.getText(item, ['end', 'endTime', 'finish'])

      if (Number.isFinite(section) && start) {
        result[section] = { start, end }
      }
    }

    return result
  }

  private getExamSortValue(exam: Record<string, unknown>) {
    const text = this.getText(exam, ['time', 'startTime', 'startAt'])
    const match = text.match(/(\d{1,2})\s*:\s*(\d{2})/)

    if (!match) {
      return Number.MAX_SAFE_INTEGER
    }

    return Number(match[1]) * 60 + Number(match[2])
  }

  private toWechatTimeValue(value: string, date = this.getLocalDateKey()) {
    const trimmed = value.trim()

    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 16)
    }

    const timeMatch = trimmed.match(/(\d{1,2})\s*:\s*(\d{2})/)
    const normalizedDate = this.normalizeDateKey(date) || this.getLocalDateKey()

    if (timeMatch) {
      return `${normalizedDate} ${String(Number(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`
    }

    return `${normalizedDate} 07:30`
  }

  private getText(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = source[key]

      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
      }
    }

    return ''
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private toJson(value: unknown) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value ?? null))
  }

  private truncate(value: string, maxLength: number) {
    return value.length > maxLength ? value.slice(0, maxLength) : value
  }

  private getMiniProgramState(): 'developer' | 'trial' | 'formal' {
    const value = process.env.WECHAT_MINIPROGRAM_STATE

    return value === 'developer' || value === 'trial' ? value : 'formal'
  }

  private getErrorCode(message: string) {
    return message.includes(':') ? message.split(':')[0] : 'REMINDER_SEND_FAILED'
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
