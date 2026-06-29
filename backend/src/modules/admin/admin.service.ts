import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { PrismaService } from '../../common/prisma/prisma.service'
import { AccountStatus, DataAccessMode, LoginMode, NotificationTargetType, Prisma, SchoolStatus } from '@prisma/client'
import {
  CreateNotificationInput,
  NotificationsService,
  UpdateNotificationInput,
} from '../notifications/notifications.service'
import { WeatherScheduler } from '../schools/weather.scheduler'

type AdminSchoolTermMap = Map<string, { id: string; label: string }> & {
  courseBuildings?: Map<string, number>
}

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
  sectionTimeProfiles?: Array<{
    id?: string
    name?: string
    buildingKeywords?: string[]
    sectionTimes?: Array<{ section: number; start: string; end: string }>
  }>
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

interface ConnectedSchoolConfig {
  id: string
  catalogCode: string
  name: string
  shortName?: string
  providerId: string
  loginMode: LoginMode
  eduSystemType?: string | null
  homepageUrl?: string | null
  authUrl?: string | null
  verifiedAt?: string | null
  capabilities: Record<string, boolean>
  dataAccess: Partial<Record<'course' | 'score' | 'exam' | 'profile', DataAccessMode[]>>
  providerConfig: Record<string, unknown>
}

const CONNECTED_SCHOOLS_FILES = [
  path.resolve(process.cwd(), 'prisma/data/connected-schools.json'),
  path.resolve(process.cwd(), 'backend/prisma/data/connected-schools.json'),
]

@Injectable()
export class AdminService {
  private connectedSchoolConfigs: ConnectedSchoolConfig[] | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly weatherScheduler: WeatherScheduler,
  ) {}

  async listAllSchools(params: {
    keyword?: string
    status?: SchoolStatus
    enabled?: boolean
    sortBy?: 'default' | 'userCount'
    sortOrder?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) {
    const { keyword, status, enabled, sortBy = 'default', sortOrder = 'desc', limit = 50, offset = 0 } = params
    const where: Record<string, unknown> = {}
    const take = Math.min(limit, 200)
    const orderFactor = sortOrder === 'asc' ? 1 : -1

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

    if (sortBy === 'userCount') {
      const [allSchools, total] = await this.prisma.$transaction([
        this.prisma.school.findMany({
          where: where as any,
          orderBy: [{ enabled: 'desc' }, { status: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.school.count({ where: where as any }),
      ])
      const allSchoolIds = allSchools.map((school) => school.id)
      const allUserCounts = allSchoolIds.length
        ? await this.prisma.studentAccount.groupBy({
            by: ['schoolId'],
            where: { schoolId: { in: allSchoolIds } },
            _count: { _all: true },
          })
        : []
      const allUserCountMap = new Map(allUserCounts.map((item) => [item.schoolId, item._count._all]))
      const sortedSchools = allSchools.sort((left, right) => {
        const enabledDiff = Number(right.enabled) - Number(left.enabled)
        if (enabledDiff) return enabledDiff
        if (!left.enabled && !right.enabled) {
          return left.status.localeCompare(right.status) || left.name.localeCompare(right.name, 'zh-CN')
        }

        const countDiff = ((allUserCountMap.get(left.id) ?? 0) - (allUserCountMap.get(right.id) ?? 0)) * orderFactor
        return countDiff || left.name.localeCompare(right.name, 'zh-CN')
      })
      const schools = sortedSchools.slice(offset, offset + take)
      const schoolIds = schools.map((school) => school.id)
      const courseCaches = await this.getCourseCachesForSchools(schoolIds)
      const termMap = this.getSchoolTermMap(courseCaches)

      return {
        items: schools.map((school) => ({
          ...school,
          weatherLocation: this.getWeatherLocation(school.config),
          termStarts: this.getTermStarts(school.config),
          terms: this.getSchoolTerms(
            termMap.get(school.id),
            this.getTermStarts(school.config),
          ),
          sectionTimes: this.getSectionTimes(school.config),
          sectionTimeProfiles: this.getSectionTimeProfiles(school.config),
          courseBuildings: this.getCourseBuildings(termMap.get(school.id)?.courseBuildings, school.providerId),
          userCount: allUserCountMap.get(school.id) ?? 0,
        })),
        total,
        limit,
        offset,
        hasMore: offset + schools.length < total,
      }
    }

    const [schools, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where: where as any,
        orderBy: [{ enabled: 'desc' }, { status: 'asc' }, { name: 'asc' }],
        take,
        skip: offset,
      }),
      this.prisma.school.count({ where: where as any }),
    ])
    const schoolIds = schools.map((school) => school.id)
    const userCounts = schools.length
      ? await this.prisma.studentAccount.groupBy({
          by: ['schoolId'],
          where: { schoolId: { in: schoolIds } },
          _count: { _all: true },
        })
      : []
    const courseCaches = await this.getCourseCachesForSchools(schoolIds)
    const userCountMap = new Map(userCounts.map((item) => [item.schoolId, item._count._all]))
    const termMap = this.getSchoolTermMap(courseCaches)

    return {
      items: schools.map((school) => ({
        ...school,
        weatherLocation: this.getWeatherLocation(school.config),
        termStarts: this.getTermStarts(school.config),
        terms: this.getSchoolTerms(
          termMap.get(school.id),
          this.getTermStarts(school.config),
        ),
        sectionTimes: this.getSectionTimes(school.config),
        sectionTimeProfiles: this.getSectionTimeProfiles(school.config),
        courseBuildings: this.getCourseBuildings(termMap.get(school.id)?.courseBuildings, school.providerId),
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
    const shouldEnable =
      input.status === 'enabled' ||
      (input.status === undefined && input.enabled === true)
    const builtInConfig = shouldEnable
      ? await this.getBuiltInConnectedSchoolConfig(schoolId)
      : undefined

    if (input.name !== undefined) data.name = input.name
    else if (builtInConfig?.name) data.name = builtInConfig.name

    if (input.shortName !== undefined) data.shortName = input.shortName
    else if (builtInConfig?.shortName !== undefined) data.shortName = builtInConfig.shortName

    if (input.status !== undefined) {
      data.status = input.status
      data.enabled = input.status === 'enabled'
    } else if (input.enabled !== undefined) {
      data.enabled = input.enabled
      data.status = input.enabled ? 'enabled' : 'disabled'
    }
    if (input.loginMode !== undefined) data.loginMode = input.loginMode
    else if (builtInConfig?.loginMode !== undefined) data.loginMode = builtInConfig.loginMode

    if (input.authUrl !== undefined) data.authUrl = input.authUrl
    else if (builtInConfig?.authUrl !== undefined) data.authUrl = builtInConfig.authUrl

    if (input.homepageUrl !== undefined) data.homepageUrl = input.homepageUrl
    else if (builtInConfig?.homepageUrl !== undefined) data.homepageUrl = builtInConfig.homepageUrl

    if (input.providerId !== undefined) data.providerId = input.providerId
    else if (builtInConfig?.providerId !== undefined) data.providerId = builtInConfig.providerId

    if (input.eduSystemType !== undefined) data.eduSystemType = input.eduSystemType
    else if (builtInConfig?.eduSystemType !== undefined) data.eduSystemType = builtInConfig.eduSystemType

    if (input.capabilities !== undefined) data.capabilities = this.toJson(input.capabilities)
    else if (builtInConfig?.capabilities !== undefined) data.capabilities = this.toJson(builtInConfig.capabilities)

    if (input.dataAccess !== undefined) data.dataAccess = this.toJson(input.dataAccess)
    else if (builtInConfig?.dataAccess !== undefined) data.dataAccess = this.toJson(builtInConfig.dataAccess)

    if (builtInConfig?.verifiedAt) {
      data.verifiedAt = new Date(builtInConfig.verifiedAt)
    }

    if (
      input.note ||
      input.authConfig !== undefined ||
      input.providerConfig !== undefined ||
      input.termStarts !== undefined ||
      builtInConfig?.providerConfig !== undefined
    ) {
      data.config = await this.mergeSchoolConfig(schoolId, {
        note: input.note,
        authConfig: input.authConfig,
        providerConfig:
          input.providerConfig !== undefined
            ? input.providerConfig
            : builtInConfig?.providerConfig,
        termStarts: input.termStarts,
      })
    }

    const school = await this.prisma.school.update({
      where: { id: schoolId },
      data: data as any,
    })

    this.weatherScheduler.notifySchoolsChanged()

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

    const updatedSchool = await this.prisma.school.update({
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
        ...(shouldUpdateProviderConfig ||
        input.sectionTimes !== undefined ||
        input.sectionTimeProfiles !== undefined
          ? {
              config: await this.mergeSchoolConfig(schoolId, {
                authConfig: input.authConfig,
                providerConfig: shouldUpdateProviderConfig ? providerConfig : undefined,
                sectionTimes: input.sectionTimes,
                sectionTimeProfiles: input.sectionTimeProfiles,
              }),
            }
          : {}),
      },
    })
  
    this.weatherScheduler.notifySchoolsChanged()

    return updatedSchool
  }

  async listSubmissions(params: {
    keyword?: string
    status?: string
    extraVerification?: string
    adaptationHelp?: string
    sortBy?: 'createdAt' | 'requestCount'
    sortOrder?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }) {
    const { keyword, status, extraVerification, adaptationHelp, sortBy = 'createdAt', sortOrder = 'desc', limit = 50, offset = 0 } = params
    const where: Record<string, unknown> = {}
    const and: Record<string, unknown>[] = []
    const take = Math.min(limit, 200)
    const orderFactor = sortOrder === 'asc' ? 1 : -1
    if (status === 'candidate') {
      where.status = { notIn: ['submitted', 'disabled'] }
    } else if (status) {
      where.status = status
    }
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

    if (sortBy === 'requestCount') {
      const [allSubmissions, total] = await this.prisma.$transaction([
        this.prisma.schoolAccessSubmission.findMany({
          where: where as any,
          orderBy: [{ schoolName: 'asc' }, { createdAt: 'desc' }],
        }),
        this.prisma.schoolAccessSubmission.count({ where: where as any }),
      ])
      const schoolCounts = new Map<string, number>()

      for (const item of allSubmissions) {
        const key = item.schoolName.trim().toLocaleLowerCase() || item.id
        schoolCounts.set(key, (schoolCounts.get(key) ?? 0) + 1)
      }

      const submissions = allSubmissions
        .sort((left, right) => {
          const leftKey = left.schoolName.trim().toLocaleLowerCase() || left.id
          const rightKey = right.schoolName.trim().toLocaleLowerCase() || right.id
          const countDiff = ((schoolCounts.get(leftKey) ?? 0) - (schoolCounts.get(rightKey) ?? 0)) * orderFactor
          return countDiff || right.createdAt.getTime() - left.createdAt.getTime()
        })
        .slice(offset, offset + take)

      return {
        items: submissions,
        total,
        limit,
        offset,
        hasMore: offset + submissions.length < total,
      }
    }

    const [submissions, total] = await this.prisma.$transaction([
      this.prisma.schoolAccessSubmission.findMany({
        where: where as any,
        orderBy: { createdAt: sortOrder },
        take,
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

  async deleteSubmission(submissionId: string) {
    const submission = await this.prisma.schoolAccessSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, status: true },
    })

    if (!submission) {
      throw new NotFoundException('Submission not found')
    }

    if (submission.status !== 'disabled') {
      throw new BadRequestException('Only rejected submissions can be deleted')
    }

    return this.prisma.schoolAccessSubmission.delete({
      where: { id: submissionId },
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
    const [schoolCount, enabledCount, accountCount, submissionCount, feedbackCount, activeNotificationCount] =
      await Promise.all([
        this.prisma.school.count(),
        this.prisma.school.count({
          where: { enabled: true, status: 'enabled' },
        }),
        this.prisma.studentAccount.count(),
        this.prisma.schoolAccessSubmission.count({ where: { status: 'submitted' } }),
        this.prisma.feedbackItem.count({ where: { status: 'pending' } }),
        this.notificationsService.countActive(),
      ])

    return {
      schools: { total: schoolCount, enabled: enabledCount },
      accounts: accountCount,
      pendingSubmissions: submissionCount,
      pendingFeedback: feedbackCount,
      activeNotifications: activeNotificationCount,
    }
  }

  listNotifications(params: {
    keyword?: string
    targetType?: NotificationTargetType
    active?: boolean
    limit?: number
    offset?: number
  }) {
    return this.notificationsService.listAdmin(params)
  }

  createNotification(input: CreateNotificationInput, createdBy?: string) {
    return this.notificationsService.createAdmin(input, createdBy)
  }

  updateNotification(notificationId: string, input: UpdateNotificationInput) {
    return this.notificationsService.updateAdmin(notificationId, input)
  }

  private async getBuiltInConnectedSchoolConfig(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, config: true },
    })

    if (!school) {
      throw new NotFoundException('School not found')
    }

    const catalogCode = this.getCatalogCode(school.config)
    const connectedSchools = this.getConnectedSchoolConfigs()

    return connectedSchools.find((item) => {
      return item.id === school.id || Boolean(catalogCode && item.catalogCode === catalogCode)
    })
  }

  private getConnectedSchoolConfigs() {
    if (this.connectedSchoolConfigs) {
      return this.connectedSchoolConfigs
    }

    const connectedSchoolsFile = CONNECTED_SCHOOLS_FILES.find((file) =>
      fs.existsSync(file),
    )

    if (!connectedSchoolsFile) {
      this.connectedSchoolConfigs = []
      return this.connectedSchoolConfigs
    }

    const payload = JSON.parse(fs.readFileSync(connectedSchoolsFile, 'utf8')) as
      | ConnectedSchoolConfig[]
      | { schools?: ConnectedSchoolConfig[] }

    this.connectedSchoolConfigs = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.schools)
        ? payload.schools
        : []

    return this.connectedSchoolConfigs
  }

  private getCatalogCode(config: unknown) {
    const catalog = this.asRecord(this.asRecord(config).catalog)
    const code = catalog.code

    return typeof code === 'string' && code.trim() ? code.trim() : ''
  }

  private async mergeSchoolConfig(
    schoolId: string,
    input: {
      note?: string
      authConfig?: Record<string, unknown> | null
      providerConfig?: Record<string, unknown> | null
      termStarts?: Record<string, string>
      sectionTimes?: Array<{ section: number; start: string; end: string }>
      sectionTimeProfiles?: Array<{
        id?: string
        name?: string
        buildingKeywords?: string[]
        sectionTimes?: Array<{ section: number; start: string; end: string }>
      }>
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
      nextConfig.provider = this.mergeProviderConfig(config.provider, input.providerConfig)
    }

    if (input.termStarts !== undefined) {
      nextConfig.termStarts = this.normalizeTermStarts(input.termStarts)
    }

    if (input.sectionTimes !== undefined) {
      nextConfig.sectionTimes = this.normalizeSectionTimes(input.sectionTimes)
    }

    if (input.sectionTimeProfiles !== undefined) {
      nextConfig.sectionTimeProfiles = this.normalizeSectionTimeProfiles(input.sectionTimeProfiles)
    }

    return this.toJson(nextConfig)
  }

  private mergeProviderConfig(current: unknown, patch: Record<string, unknown> | null) {
    if (patch === null) {
      return null
    }

    const nextProvider = {
      ...this.asRecord(current),
      ...this.asRecord(patch),
    }

    for (const [key, value] of Object.entries(patch || {})) {
      if (value === null || value === undefined) {
        delete nextProvider[key]
      }
    }

    return nextProvider
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

  private normalizeSectionTimeProfiles(
    value: Array<{
      id?: string
      name?: string
      buildingKeywords?: string[]
      sectionTimes?: Array<{ section: number; start: string; end: string }>
    }>,
  ) {
    return (Array.isArray(value) ? value : [])
      .map((item, index) => {
        const id = String(item.id || `profile-${index + 1}`).trim()
        const name = String(item.name || id).trim()
        const buildingKeywords = Array.isArray(item.buildingKeywords)
          ? [...new Set(item.buildingKeywords.map((keyword) => String(keyword || '').trim()).filter(Boolean))]
          : []
        const sectionTimes = this.normalizeSectionTimes(item.sectionTimes || [])

        return { id, name, buildingKeywords, sectionTimes }
      })
      .filter((item) => item.id && item.name && item.sectionTimes.length > 0)
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

  private getWeatherLocation(config: unknown) {
    const provider = this.asRecord(this.asRecord(config).provider)
    const weatherLocation = this.asRecord(provider.weatherLocation)
    const latitude = this.getFiniteNumber(weatherLocation.latitude)
    const longitude = this.getFiniteNumber(weatherLocation.longitude)

    if (latitude === undefined || longitude === undefined) {
      return undefined
    }

    return {
      displayName: this.getOptionalText(weatherLocation.displayName),
      latitude,
      longitude,
    }
  }

  private getOptionalText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  private getFiniteNumber(value: unknown) {
    const numberValue = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN

    return Number.isFinite(numberValue) ? numberValue : undefined
  }

  private getSchoolTermMap(
    caches: Array<{ schoolId: string; termId: string | null; termsJson: unknown; coursesJson: unknown }>,
  ) {
    const map = new Map<string, AdminSchoolTermMap>()

    for (const cache of caches) {
      const terms = map.get(cache.schoolId) ?? (new Map<string, { id: string; label: string }>() as AdminSchoolTermMap)
      this.addTermOption(terms, cache.termId, cache.termId)

      for (const term of Array.isArray(cache.termsJson) ? cache.termsJson : []) {
        const record = this.asRecord(term)
        const id = this.getFirstText(record, ['id'])
        const label = this.getFirstText(record, ['label', 'title', 'name', 'rawLabel'])
        this.addTermOption(terms, id, label)
      }

      this.collectCourseBuildings(terms, cache.coursesJson)
      map.set(cache.schoolId, terms)
    }

    return map
  }

  private async getCourseCachesForSchools(schoolIds: string[]) {
    return schoolIds.length
      ? (
          await Promise.all(schoolIds.map((schoolId) => (
            this.prisma.courseCache.findMany({
              where: { schoolId },
              select: {
                schoolId: true,
                termId: true,
                termsJson: true,
                coursesJson: true,
              },
              orderBy: { syncedAt: 'desc' },
              take: 20,
            })
          )))
        ).flat()
      : []
  }

  private getSchoolTerms(
    terms: Map<string, { id: string; label: string }> | undefined,
    termStarts: Record<string, string>,
  ) {
    const result = new Map(terms ?? [])

    for (const termId of Object.keys(termStarts)) {
      this.addTermOption(result, termId, termId)
    }

    return [...result.values()]
  }

  private addTermOption(
    terms: Map<string, { id: string; label: string }>,
    idValue: unknown,
    labelValue: unknown,
  ) {
    const id = typeof idValue === 'string' || typeof idValue === 'number'
      ? String(idValue).trim()
      : ''

    if (!id) {
      return
    }

    const label = typeof labelValue === 'string' || typeof labelValue === 'number'
      ? String(labelValue).trim()
      : ''
    const nextLabel = label || id
    const existing = terms.get(id)

    if (existing) {
      const nextLooksAcademic = /20\d{2}.*20\d{2}.*学期/.test(nextLabel)
      const existingLooksAcademic = /20\d{2}.*20\d{2}.*学期/.test(existing.label)

      if (
        nextLabel !== id &&
        (existing.label === existing.id || (nextLooksAcademic && !existingLooksAcademic))
      ) {
        terms.set(id, { id, label: nextLabel })
      }

      return
    }

    terms.set(id, { id, label: nextLabel })
  }

  private getSectionTimes(config: unknown) {
    const record = this.asRecord(config)
    const source = record.sectionTimes ?? this.asRecord(record.provider).sectionTimes
    return Array.isArray(source) ? this.normalizeSectionTimes(source as Array<{ section: number; start: string; end: string }>) : []
  }

  private getSectionTimeProfiles(config: unknown) {
    const record = this.asRecord(config)
    const source = record.sectionTimeProfiles ?? this.asRecord(record.provider).sectionTimeProfiles
    return Array.isArray(source)
      ? this.normalizeSectionTimeProfiles(source as Array<{
          id?: string
          name?: string
          buildingKeywords?: string[]
          sectionTimes?: Array<{ section: number; start: string; end: string }>
        }>)
      : []
  }

  private collectCourseBuildings(
    terms: { courseBuildings?: Map<string, number> },
    coursesJson: unknown,
  ) {
    const buildings = terms.courseBuildings ?? new Map<string, number>()

    for (const course of Array.isArray(coursesJson) ? coursesJson : []) {
      const record = this.asRecord(course)
      const building = this.extractCourseBuilding(
        record.building ?? record.location ?? record.classroom ?? record.room,
      )

      if (building) {
        buildings.set(building, (buildings.get(building) ?? 0) + 1)
      }
    }

    terms.courseBuildings = buildings
  }

  private getCourseBuildings(buildings?: Map<string, number>, providerId?: string | null) {
    if (providerId === 'bwu') {
      return [...this.normalizeBwuCourseBuildings(buildings).entries()]
        .map(([name, count]) => ({ name, count }))
    }

    return [...(buildings ?? new Map<string, number>()).entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
      .slice(0, 50)
      .map(([name, count]) => ({ name, count }))
  }

  private normalizeBwuCourseBuildings(buildings?: Map<string, number>) {
    const normalized = new Map<string, number>([
      ['教学楼1', 0],
      ['教学楼2', 0],
      ['经管中心', 0],
      ['体育课', 0],
    ])

    for (const [name, count] of buildings ?? new Map<string, number>()) {
      const canonical = this.getBwuCanonicalBuilding(name)

      if (canonical) {
        normalized.set(canonical, (normalized.get(canonical) ?? 0) + count)
      }
    }

    return normalized
  }

  private getBwuCanonicalBuilding(value: string) {
    const text = value.replace(/\s+/g, '').toLocaleLowerCase()

    if (!text) {
      return ''
    }

    if (/(体育课|体育场|轮滑场|操场|体育馆)/.test(text)) {
      return '体育课'
    }

    if (/(经管中心|经济管理中心|研究生|实验教学中心|实验教学楼区|南北实验楼|科研楼)/.test(text)) {
      return '经管中心'
    }

    if (/(教学楼2|教学楼二|第二教学楼|二教|2教)/.test(text)) {
      return '教学楼2'
    }

    if (/(教学楼1|教学楼一|第一教学楼|一教|1教)/.test(text)) {
      return '教学楼1'
    }

    return ''
  }

  private extractCourseBuilding(value: unknown) {
    const text = String(value || '').trim()

    if (!text) {
      return ''
    }

    const normalized = text.replace(/\s+/g, '')
    const numberedTeachingBuilding = normalized.match(/(教学楼[一二三四五六七八九十\d]+)/)

    if (numberedTeachingBuilding) {
      return numberedTeachingBuilding[1]
    }

    const explicit = normalized.match(/(.+?(?:教学楼|实验楼|实训楼|楼|馆|中心|校区|院区))/)

    if (explicit) {
      return explicit[1]
    }

    const roomMatch = normalized.match(/^([A-Za-z\u4e00-\u9fa5]+)[-_\d]/)
    return roomMatch ? roomMatch[1] : normalized
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
