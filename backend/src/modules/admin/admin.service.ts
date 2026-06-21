import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AccountStatus, DataAccessMode, LoginMode, Prisma, SchoolStatus } from '@prisma/client'

export interface AdminSchoolUpdateInput {
  name?: string
  shortName?: string | null
  status?: SchoolStatus
  enabled?: boolean
  loginMode?: LoginMode | null
  authUrl?: string | null
  homepageUrl?: string | null
  providerId?: string | null
  eduSystemType?: string | null
  capabilities?: Record<string, boolean>
  dataAccess?: Partial<Record<'course' | 'score' | 'exam' | 'profile', DataAccessMode[]>>
  authConfig?: Record<string, unknown> | null
  providerConfig?: Record<string, unknown> | null
  providerStatus?: SchoolStatus
  termStarts?: Record<string, string>
  note?: string
}

export interface AdminProviderConfigUpsertInput {
  providerId: string
  loginMode: LoginMode
  sectionTimes?: Array<{ section: number; start: string; end: string }>
  dataAccess?: Partial<Record<'course' | 'score' | 'exam' | 'profile', DataAccessMode[]>>
  capabilities?: Record<string, boolean>
  eduSystemType?: string | null
  credentialPolicy?: Record<string, unknown>
  providerConfig?: Record<string, unknown>
  featureConfig?: Record<string, unknown>
  authConfig?: Record<string, unknown>
  limits?: Record<string, unknown> | null
  status?: SchoolStatus
  verifiedAt?: string | null
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listAllSchools(params: {
    keyword?: string
    status?: SchoolStatus
    enabled?: boolean
    limit?: number
    offset?: number
  }) {
    const { keyword, status, enabled, limit = 50, offset = 0 } = params
    const where: Record<string, unknown> = {}

    if (keyword) {
      where.OR = [
        { id: { contains: keyword, mode: 'insensitive' } },
        { name: { contains: keyword, mode: 'insensitive' } },
        { shortName: { contains: keyword, mode: 'insensitive' } },
        { province: { contains: keyword, mode: 'insensitive' } },
        { city: { contains: keyword, mode: 'insensitive' } },
      ]
    }
    if (status) where.status = status
    if (enabled !== undefined) where.enabled = enabled

    const [schools, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where: where as any,
        orderBy: [{ enabled: 'desc' }, { status: 'asc' }, { name: 'asc' }],
        take: Math.min(limit, 200),
        skip: offset,
      }),
      this.prisma.school.count({ where: where as any }),
    ])
    const userCounts = schools.length
      ? await this.prisma.studentAccount.groupBy({
          by: ['schoolId'],
          where: { schoolId: { in: schools.map((school) => school.id) } },
          _count: { _all: true },
        })
      : []
    const userCountMap = new Map(userCounts.map((item) => [item.schoolId, item._count._all]))

    return {
      items: schools.map((school) => ({
        ...school,
        termStarts: this.getTermStarts(school.config),
        sectionTimes: this.getSectionTimes(school.config),
        userCount: userCountMap.get(school.id) ?? 0,
      })),
      total,
      limit,
      offset,
      hasMore: offset + schools.length < total,
    }
  }

  async listUsers(params: {
    keyword?: string
    schoolId?: string
    schoolKeyword?: string
    status?: AccountStatus
    limit?: number
    offset?: number
  }) {
    const { keyword, schoolId, schoolKeyword, status, limit = 50, offset = 0 } = params
    const where: Record<string, unknown> = {}
    const take = Math.min(limit, 200)
    const normalizedKeyword = keyword?.trim().toLocaleLowerCase()

    if (status) where.status = status
    if (schoolId) where.schoolId = schoolId
    else if (schoolKeyword) {
      where.schoolId = {
        in: await this.findSchoolIdsByKeyword(schoolKeyword),
      }
    }

    const accountSelect = {
      id: true,
      schoolId: true,
      providerId: true,
      studentNoEncrypted: true,
      displayName: true,
      status: true,
      authState: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
      school: {
        select: {
          id: true,
          name: true,
          shortName: true,
        },
      },
    } satisfies Prisma.StudentAccountSelect
    const [accounts, total] = normalizedKeyword
      ? [
          await this.prisma.studentAccount.findMany({
            where: where as any,
            select: accountSelect,
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
            take: 2000,
          }),
          0,
        ]
      : await this.prisma.$transaction([
          this.prisma.studentAccount.findMany({
            where: where as any,
            select: accountSelect,
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
            take,
            skip: offset,
          }),
          this.prisma.studentAccount.count({ where: where as any }),
        ])
    const accountIds = accounts.map((account) => account.id)
    const profileCaches = accountIds.length
      ? await this.prisma.featureCache.findMany({
          where: {
            accountId: { in: accountIds },
            target: 'profile',
          },
          orderBy: [{ accountId: 'asc' }, { syncedAt: 'desc' }],
        })
      : []
    const profileCacheMap = new Map<string, (typeof profileCaches)[number]>()

    for (const cache of profileCaches) {
      if (!profileCacheMap.has(cache.accountId)) {
        profileCacheMap.set(cache.accountId, cache)
      }
    }
    const filteredItems = accounts
      .map((account) => {
        const profile = this.getFeedbackProfile(account.authState, profileCacheMap.get(account.id)?.dataJson)
        const student = this.getFeedbackStudentInfo(account, profile)
        const contact = this.getUserContact(profile)

        return {
          id: account.id,
          schoolId: account.schoolId,
          providerId: account.providerId,
          displayName: account.displayName,
          status: account.status,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          lastLoginAt: account.lastLoginAt,
          school: account.school,
          student,
          contact,
        }
      })
      .filter((item) => {
        if (!normalizedKeyword) return true

        return [
          item.id,
          item.displayName,
          item.providerId,
          item.schoolId,
          item.school?.name,
          item.school?.shortName,
          item.student.name,
          item.student.studentNo,
          item.student.grade,
          item.student.major,
          item.student.className,
          item.contact.value,
          item.contact.phone,
          item.contact.email,
        ].some((value) => String(value || '').toLocaleLowerCase().includes(normalizedKeyword))
      })
    const items = normalizedKeyword ? filteredItems.slice(offset, offset + take) : filteredItems

    return {
      items,
      total: normalizedKeyword ? filteredItems.length : total,
      limit,
      offset,
      hasMore: normalizedKeyword ? offset + take < filteredItems.length : offset + accounts.length < total,
    }
  }

  async updateSchool(schoolId: string, input: AdminSchoolUpdateInput) {
    const data: Record<string, unknown> = {}
    if (input.name !== undefined) data.name = input.name
    if (input.shortName !== undefined) data.shortName = input.shortName
    if (input.status !== undefined) {
      data.status = input.status
      data.enabled = input.status === 'enabled'
    } else if (input.enabled !== undefined) {
      data.enabled = input.enabled
      data.status = input.enabled ? 'enabled' : 'disabled'
    }
    if (input.loginMode !== undefined) data.loginMode = input.loginMode
    if (input.authUrl !== undefined) data.authUrl = input.authUrl
    if (input.homepageUrl !== undefined) data.homepageUrl = input.homepageUrl
    if (input.providerId !== undefined) data.providerId = input.providerId
    if (input.eduSystemType !== undefined) data.eduSystemType = input.eduSystemType
    if (input.capabilities !== undefined) data.capabilities = this.toJson(input.capabilities)
    if (input.dataAccess !== undefined) data.dataAccess = this.toJson(input.dataAccess)

    if (
      input.note ||
      input.authConfig !== undefined ||
      input.providerConfig !== undefined ||
      input.termStarts !== undefined
    ) {
      data.config = await this.mergeSchoolConfig(schoolId, {
        note: input.note,
        authConfig: input.authConfig,
        providerConfig: input.providerConfig,
        termStarts: input.termStarts,
      })
    }

    const school = await this.prisma.school.update({
      where: { id: schoolId },
      data: data as any,
    })

    return school
  }

  async upsertProviderConfig(
    schoolId: string,
    input: AdminProviderConfigUpsertInput,
  ) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } })

    if (!school) {
      throw new NotFoundException('School not found')
    }

    const shouldUpdateProviderConfig =
      input.providerConfig !== undefined ||
      input.authConfig !== undefined ||
      input.credentialPolicy !== undefined ||
      input.featureConfig !== undefined ||
      input.limits !== undefined
    const providerConfig = shouldUpdateProviderConfig
      ? {
          ...(input.providerConfig || {}),
          ...(input.authConfig ? { authConfig: input.authConfig } : {}),
          ...(input.credentialPolicy ? { credentialPolicy: input.credentialPolicy } : {}),
          ...(input.featureConfig ? { featureConfig: input.featureConfig } : {}),
          ...(input.limits ? { limits: input.limits } : {}),
        }
      : undefined
    const capabilities = input.capabilities ?? (school.capabilities as Record<string, boolean>) ?? {}
    const dataAccess = input.dataAccess ?? (school.dataAccess as Record<string, unknown>) ?? {}
    const status = input.status ?? school.status
    const verifiedAt = input.verifiedAt ? new Date(input.verifiedAt) : undefined

    return this.prisma.school.update({
      where: { id: schoolId },
      data: {
        providerId: input.providerId,
        loginMode: input.loginMode,
        dataAccess: this.toJson(dataAccess),
        capabilities: this.toJson(capabilities),
        eduSystemType: input.eduSystemType ?? school.eduSystemType,
        status,
        enabled: status === 'enabled',
        ...(verifiedAt ? { verifiedAt } : {}),
        ...(shouldUpdateProviderConfig || input.sectionTimes !== undefined
          ? {
              config: await this.mergeSchoolConfig(schoolId, {
                authConfig: input.authConfig,
                providerConfig: shouldUpdateProviderConfig ? providerConfig : undefined,
                sectionTimes: input.sectionTimes,
              }),
            }
          : {}),
      },
    })
  }

  async listSubmissions(params: {
    keyword?: string
    status?: string
    extraVerification?: string
    adaptationHelp?: string
    limit?: number
    offset?: number
  }) {
    const { keyword, status, extraVerification, adaptationHelp, limit = 50, offset = 0 } = params
    const where: Record<string, unknown> = {}
    const and: Record<string, unknown>[] = []
    if (status) where.status = status
    if (keyword) {
      where.OR = [
        { schoolName: { contains: keyword, mode: 'insensitive' } },
        { province: { contains: keyword, mode: 'insensitive' } },
        { city: { contains: keyword, mode: 'insensitive' } },
        { officialWebsite: { contains: keyword, mode: 'insensitive' } },
        { eduSystemWebsite: { contains: keyword, mode: 'insensitive' } },
      ]
    }
    if (extraVerification) {
      and.push({
        note: {
          contains: `除账号密码外的验证：${extraVerification}`,
          mode: 'insensitive',
        },
      })
    }
    if (adaptationHelp) {
      and.push({
        note: {
          contains: `是否愿意协助首个接入适配：${adaptationHelp}`,
          mode: 'insensitive',
        },
      })
    }
    if (and.length) where.AND = and

    const [submissions, total] = await this.prisma.$transaction([
      this.prisma.schoolAccessSubmission.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        skip: offset,
      }),
      this.prisma.schoolAccessSubmission.count({ where: where as any }),
    ])

    return {
      items: submissions,
      total,
      limit,
      offset,
      hasMore: offset + submissions.length < total,
    }
  }

  async updateSubmission(submissionId: string, input: {
    status?: string
    review?: Record<string, unknown>
  }) {
    const data: Record<string, unknown> = {}
    if (input.status) data.status = input.status
    if (input.review) data.review = input.review

    return this.prisma.schoolAccessSubmission.update({
      where: { id: submissionId },
      data: data as any,
    })
  }

  async listFeedback(params: {
    status?: string
    schoolId?: string
    schoolKeyword?: string
    limit?: number
    offset?: number
  }) {
    const { status, schoolId, schoolKeyword, limit = 50, offset = 0 } = params
    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (schoolId) where.schoolId = schoolId
    if (schoolKeyword) {
      where.schoolId = {
        in: await this.findSchoolIdsByKeyword(schoolKeyword),
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.feedbackItem.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        skip: offset,
      }),
      this.prisma.feedbackItem.count({ where: where as any }),
    ])
    const accountIds = [...new Set(items.map((item) => item.accountId).filter(Boolean))]
    const accounts = accountIds.length
      ? await this.prisma.studentAccount.findMany({
          where: { id: { in: accountIds as string[] } },
          select: {
            id: true,
            schoolId: true,
            providerId: true,
            studentNoEncrypted: true,
            displayName: true,
            status: true,
            authState: true,
            school: {
              select: {
                id: true,
                name: true,
                shortName: true,
              },
            },
          },
        })
      : []
    const accountMap = new Map(accounts.map((account) => [account.id, account]))
    const schoolIds = [
      ...new Set([
        ...items.map((item) => item.schoolId).filter(Boolean),
        ...accounts.map((account) => account.schoolId).filter(Boolean),
      ]),
    ] as string[]
    const schools = schoolIds.length
      ? await this.prisma.school.findMany({
          where: { id: { in: schoolIds } },
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        })
      : []
    const schoolMap = new Map(schools.map((school) => [school.id, school]))
    const profileCaches = accountIds.length
      ? await this.prisma.featureCache.findMany({
          where: {
            accountId: { in: accountIds as string[] },
            target: 'profile',
          },
          orderBy: [{ accountId: 'asc' }, { syncedAt: 'desc' }],
        })
      : []
    const profileCacheMap = new Map<string, (typeof profileCaches)[number]>()

    for (const cache of profileCaches) {
      if (!profileCacheMap.has(cache.accountId)) {
        profileCacheMap.set(cache.accountId, cache)
      }
    }

    return {
      items: items.map((item) => {
        const account = item.accountId ? accountMap.get(item.accountId) ?? null : null
        const profile = account
          ? this.getFeedbackProfile(account.authState, profileCacheMap.get(account.id)?.dataJson)
          : {}
        const publicAccount = account
          ? {
              id: account.id,
              schoolId: account.schoolId,
              providerId: account.providerId,
              displayName: account.displayName,
              status: account.status,
              school: account.school,
            }
          : null
        const school = account?.school ?? (item.schoolId ? schoolMap.get(item.schoolId) ?? null : null)

        return {
          ...item,
          account: publicAccount,
          school,
          student: account ? this.getFeedbackStudentInfo(account, profile) : null,
        }
      }),
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    }
  }

  async getStats() {
    const [schoolCount, enabledCount, accountCount, submissionCount, feedbackCount] =
      await Promise.all([
        this.prisma.school.count(),
        this.prisma.school.count({
          where: { enabled: true, status: 'enabled' },
        }),
        this.prisma.studentAccount.count(),
        this.prisma.schoolAccessSubmission.count({ where: { status: 'submitted' } }),
        this.prisma.feedbackItem.count({ where: { status: 'pending' } }),
      ])

    return {
      schools: { total: schoolCount, enabled: enabledCount },
      accounts: accountCount,
      pendingSubmissions: submissionCount,
      pendingFeedback: feedbackCount,
    }
  }

  private async mergeSchoolConfig(
    schoolId: string,
    input: {
      note?: string
      authConfig?: Record<string, unknown> | null
      providerConfig?: Record<string, unknown> | null
      termStarts?: Record<string, string>
      sectionTimes?: Array<{ section: number; start: string; end: string }>
    },
  ) {
    const school = await this.prisma.school.findUnique({ where: { id: schoolId } })
    const config = (school?.config as Record<string, unknown>) ?? {}
    const nextConfig: Record<string, unknown> = { ...config }

    if (input.note) {
      const notes = Array.isArray(config['adminNotes']) ? config['adminNotes'] as string[] : []
      nextConfig.adminNotes = [...notes, `${new Date().toISOString()}: ${input.note}`]
    }

    if (input.authConfig !== undefined) {
      nextConfig.authConfig = input.authConfig
    }

    if (input.providerConfig !== undefined) {
      nextConfig.provider = input.providerConfig
    }

    if (input.termStarts !== undefined) {
      nextConfig.termStarts = this.normalizeTermStarts(input.termStarts)
    }

    if (input.sectionTimes !== undefined) {
      nextConfig.sectionTimes = this.normalizeSectionTimes(input.sectionTimes)
    }

    return this.toJson(nextConfig)
  }

  private normalizeTermStarts(value: Record<string, string>) {
    const result: Record<string, string> = {}

    for (const [termId, date] of Object.entries(value || {})) {
      if (termId && /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
        result[termId] = date
      }
    }

    return result
  }

  private normalizeSectionTimes(value: Array<{ section: number; start: string; end: string }>) {
    return (Array.isArray(value) ? value : [])
      .map((item) => ({
        section: Number(item.section),
        start: String(item.start || '').trim(),
        end: String(item.end || '').trim(),
      }))
      .filter((item) => Number.isInteger(item.section) && item.section > 0 && item.start && item.end)
      .sort((left, right) => left.section - right.section)
  }

  private getTermStarts(config: unknown) {
    const record = this.asRecord(this.asRecord(config).termStarts)
    const result: Record<string, string> = {}

    for (const [termId, date] of Object.entries(record)) {
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        result[termId] = date
      }
    }

    return result
  }

  private getSectionTimes(config: unknown) {
    const record = this.asRecord(config)
    const source = record.sectionTimes ?? this.asRecord(record.provider).sectionTimes
    return Array.isArray(source) ? this.normalizeSectionTimes(source as Array<{ section: number; start: string; end: string }>) : []
  }

  private async findSchoolIdsByKeyword(keyword: string) {
    const value = keyword.trim()

    if (!value) return []

    const schools = await this.prisma.school.findMany({
      where: {
        OR: [
          { id: { contains: value, mode: 'insensitive' } },
          { name: { contains: value, mode: 'insensitive' } },
          { shortName: { contains: value, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 200,
    })

    return schools.map((school) => school.id)
  }

  private getFeedbackProfile(authState: unknown, cacheData: unknown) {
    return {
      ...this.asRecord(this.asRecord(authState).profile),
      ...this.asRecord(cacheData),
    }
  }

  private getFeedbackStudentInfo(
    account: {
      displayName: string | null
      studentNoEncrypted: string | null
    },
    profile: Record<string, unknown>,
  ) {
    return {
      name: this.getFirstText(profile, ['name', 'studentName', 'displayName']) ?? account.displayName,
      studentNo:
        this.getFirstText(profile, [
          'maskedStudentId',
          'studentId',
          'studentNo',
          'studentNumber',
          'studentCode',
          'xh',
          'XH',
        ]) ?? this.normalizeStoredStudentNo(account.studentNoEncrypted),
      grade: this.getFirstText(profile, ['grade', 'level']),
      major: this.getFirstText(profile, ['major']),
      className: this.getFirstText(profile, ['className', 'class']),
      level: this.getFirstText(profile, ['level']),
    }
  }

  private getUserContact(profile: Record<string, unknown>) {
    const phone = this.getFirstText(profile, [
      'phone',
      'mobile',
      'mobilePhone',
      'phoneNumber',
      'telephone',
      'tel',
    ])
    const email = this.getFirstText(profile, ['email', 'mail', 'emailAddress'])
    const direct = this.getFirstText(profile, ['contact', 'contactInfo', 'wechat', 'qq'])

    return {
      phone: phone ?? null,
      email: email ?? null,
      value: direct ?? phone ?? email ?? null,
    }
  }

  private getFirstText(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = record[key]
      const text = typeof value === 'string' || typeof value === 'number'
        ? String(value).trim()
        : ''

      if (text) {
        return text
      }
    }

    return undefined
  }

  private normalizeStoredStudentNo(value: string | null) {
    const text = typeof value === 'string' ? value.trim() : ''

    if (!text) {
      return undefined
    }

    return text.startsWith('masked:') ? text.slice('masked:'.length) : text
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
  }
}
