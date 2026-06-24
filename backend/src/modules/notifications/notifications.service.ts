import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { NotificationTargetType, Prisma } from '@prisma/client'

import { PrismaService } from '../../common/prisma/prisma.service'

export interface CreateNotificationInput {
  title?: string
  content?: string
  targetType?: NotificationTargetType
  targetSchoolId?: string | null
  targetAccountId?: string | null
  active?: boolean
}

export interface UpdateNotificationInput {
  title?: string
  content?: string
  active?: boolean
}

interface NotificationPageOptions {
  limit?: number
  offset?: number
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPendingForAccount(accountId: string, limitInput?: number) {
    const account = await this.ensureAccount(accountId)
    const limit = this.normalizeLimit(limitInput, 5, 10)

    const items = await this.prisma.adminNotification.findMany({
      where: {
        active: true,
        OR: [
          { targetType: 'global' },
          { targetType: 'school', targetSchoolId: account.schoolId },
          { targetType: 'user', targetAccountId: accountId },
        ],
        receipts: {
          none: { accountId },
        },
      },
      select: {
        id: true,
        title: true,
        content: true,
        targetType: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    return {
      items: items.map((item) => this.toPublicNotification(item)),
      total: items.length,
    }
  }

  async listForAccount(accountId: string, options: NotificationPageOptions = {}) {
    const account = await this.ensureAccount(accountId)
    const limit = this.normalizeLimit(options.limit, 20, 50)
    const offset = Math.max(Number(options.offset) || 0, 0)

    const items = await this.prisma.adminNotification.findMany({
      where: {
        OR: [
          {
            receipts: {
              some: { accountId },
            },
          },
          {
            active: true,
            OR: [
              { targetType: 'global' },
              { targetType: 'school', targetSchoolId: account.schoolId },
              { targetType: 'user', targetAccountId: accountId },
            ],
          },
        ],
      },
      select: {
        id: true,
        title: true,
        content: true,
        targetType: true,
        createdAt: true,
        receipts: {
          where: { accountId },
          select: { readAt: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      skip: offset,
    })
    const pageItems = items.slice(0, limit)

    return {
      items: pageItems.map((item) => ({
        ...this.toPublicNotification(item),
        readAt: item.receipts[0]?.readAt ?? null,
      })),
      total: pageItems.length,
      limit,
      offset,
      hasMore: items.length > limit,
    }
  }

  async markRead(accountId: string, notificationId: string) {
    await this.ensureAccount(accountId)
    const notification = await this.prisma.adminNotification.findUnique({
      where: { id: notificationId },
      select: {
        active: true,
        targetType: true,
        targetSchoolId: true,
        targetAccountId: true,
      },
    })

    if (!notification || !(await this.canAccountRead(notification, accountId))) {
      throw new NotFoundException('Notification not found')
    }

    await this.prisma.notificationReceipt.upsert({
      where: {
        notificationId_accountId: {
          notificationId,
          accountId,
        },
      },
      update: { readAt: new Date() },
      create: {
        notificationId,
        accountId,
      },
    })
  }

  async listAdmin(params: {
    keyword?: string
    targetType?: NotificationTargetType
    active?: boolean
    limit?: number
    offset?: number
  }) {
    const { keyword, targetType, active, limit = 50, offset = 0 } = params
    const take = Math.min(limit, 200)
    const where: Prisma.AdminNotificationWhereInput = {}

    if (targetType) where.targetType = targetType
    if (active !== undefined) where.active = active
    if (keyword?.trim()) {
      const value = keyword.trim()
      where.OR = [
        { title: { contains: value, mode: 'insensitive' } },
        { content: { contains: value, mode: 'insensitive' } },
        { targetSchoolId: { contains: value, mode: 'insensitive' } },
        { targetAccountId: { contains: value, mode: 'insensitive' } },
      ]
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminNotification.findMany({
        where,
        include: { _count: { select: { receipts: true } } },
        orderBy: { createdAt: 'desc' },
        take,
        skip: offset,
      }),
      this.prisma.adminNotification.count({ where }),
    ])
    const targetAccountIds = [
      ...new Set(items.map((item) => item.targetAccountId).filter(Boolean)),
    ] as string[]
    const accounts = targetAccountIds.length
      ? await this.prisma.studentAccount.findMany({
          where: { id: { in: targetAccountIds } },
          select: {
            id: true,
            schoolId: true,
            providerId: true,
            displayName: true,
            status: true,
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
    const targetSchoolIds = [
      ...new Set(items.map((item) => item.targetSchoolId).filter(Boolean)),
    ] as string[]
    const schools = targetSchoolIds.length
      ? await this.prisma.school.findMany({
          where: { id: { in: targetSchoolIds } },
          select: {
            id: true,
            name: true,
            shortName: true,
          },
        })
      : []
    const schoolMap = new Map(schools.map((school) => [school.id, school]))

    return {
      items: items.map((item) => ({
        ...this.toPublicNotification(item),
        active: item.active,
        targetType: item.targetType,
        targetSchoolId: item.targetSchoolId,
        targetAccountId: item.targetAccountId,
        expiresAt: item.expiresAt,
        createdBy: item.createdBy,
        updatedAt: item.updatedAt,
        readCount: item._count.receipts,
        targetSchool: item.targetSchoolId ? schoolMap.get(item.targetSchoolId) ?? null : null,
        targetAccount: item.targetAccountId ? accountMap.get(item.targetAccountId) ?? null : null,
      })),
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    }
  }

  async createAdmin(input: CreateNotificationInput, createdBy?: string) {
    const title = this.normalizeText(input.title)
    const content = this.normalizeText(input.content)
    const targetType = input.targetType || 'global'
    const targetSchoolId = this.normalizeOptionalText(input.targetSchoolId)
    const targetAccountId = this.normalizeOptionalText(input.targetAccountId)

    if (!title || !content) {
      throw new BadRequestException('Title and content are required')
    }

    if (targetType === 'school' && !targetSchoolId) {
      throw new BadRequestException('targetSchoolId is required for school notification')
    }

    if (targetType === 'user' && !targetAccountId) {
      throw new BadRequestException('targetAccountId is required for user notification')
    }

    if (targetType === 'global' && (targetSchoolId || targetAccountId)) {
      throw new BadRequestException('Global notification cannot include target ids')
    }

    if (targetType === 'school' && targetAccountId) {
      throw new BadRequestException('School notification cannot include targetAccountId')
    }

    if (targetType === 'user' && targetSchoolId) {
      throw new BadRequestException('User notification cannot include targetSchoolId')
    }

    if (targetSchoolId) {
      await this.ensureSchool(targetSchoolId)
    }

    if (targetAccountId) {
      await this.ensureAccount(targetAccountId)
    }

    return this.prisma.adminNotification.create({
      data: {
        title,
        content,
        targetType,
        targetSchoolId: targetType === 'school' ? targetSchoolId : null,
        targetAccountId: targetType === 'user' ? targetAccountId : null,
        active: input.active ?? true,
        expiresAt: null,
        createdBy: createdBy || null,
      },
    })
  }

  async updateAdmin(notificationId: string, input: UpdateNotificationInput) {
    const notification = await this.prisma.adminNotification.findUnique({
      where: { id: notificationId },
    })

    if (!notification) {
      throw new NotFoundException('Notification not found')
    }

    const data: Prisma.AdminNotificationUpdateInput = {}

    if (input.title !== undefined) {
      const title = this.normalizeText(input.title)
      if (!title) throw new BadRequestException('Title cannot be empty')
      data.title = title
    }

    if (input.content !== undefined) {
      const content = this.normalizeText(input.content)
      if (!content) throw new BadRequestException('Content cannot be empty')
      data.content = content
    }

    if (input.active !== undefined) data.active = input.active

    return this.prisma.adminNotification.update({
      where: { id: notificationId },
      data,
    })
  }

  async countActive() {
    return this.prisma.adminNotification.count({
      where: {
        active: true,
      },
    })
  }

  private async ensureSchool(schoolId: string) {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true },
    })

    if (!school) {
      throw new NotFoundException('School not found')
    }
  }

  private async ensureAccount(accountId: string) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
      select: { id: true, schoolId: true },
    })

    if (!account) {
      throw new NotFoundException('Account not found')
    }

    return account
  }

  private async canAccountRead(
    notification: {
      active: boolean
      targetType: NotificationTargetType
      targetSchoolId: string | null
      targetAccountId: string | null
    },
    accountId: string,
  ) {
    if (!notification.active) return false
    if (notification.targetType === 'global') return true
    if (notification.targetType === 'user') return notification.targetAccountId === accountId

    const count = await this.prisma.studentAccount.count({
      where: {
        id: accountId,
        schoolId: notification.targetSchoolId || '',
      },
    })

    return count > 0
  }

  private toPublicNotification(item: {
    id: string
    title: string
    content: string
    targetType: NotificationTargetType
    createdAt: Date
  }) {
    return {
      id: item.id,
      title: item.title,
      content: item.content,
      targetType: item.targetType,
      createdAt: item.createdAt,
    }
  }

  private normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private normalizeOptionalText(value: unknown) {
    const text = this.normalizeText(value)
    return text || null
  }

  private normalizeLimit(value: unknown, fallback: number, max: number) {
    const limit = Number(value)

    if (!Number.isInteger(limit) || limit <= 0) {
      return fallback
    }

    return Math.min(limit, max)
  }

}
