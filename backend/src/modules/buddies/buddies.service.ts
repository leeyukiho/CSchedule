import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { PrismaService } from '../../common/prisma/prisma.service'
import { TimetableService } from '../timetable/timetable.service'
import { BuddyInvitePreviewResponse, BuddyInviteResponse, BuddySpaceResponse } from './buddies.types'

const BUDDY_INVITE_TTL_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

@Injectable()
export class BuddiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timetableService: TimetableService,
  ) {}

  async createInvite(accountId: string): Promise<BuddyInviteResponse> {
    await this.assertAccountExists(accountId)

    const expiresAt = new Date(Date.now() + BUDDY_INVITE_TTL_DAYS * MS_PER_DAY)
    const invite = await this.prisma.buddyInvite.create({
      data: {
        code: await this.createUniqueInviteCode(),
        inviterAccountId: accountId,
        expiresAt,
      },
    })

    return {
      code: invite.code,
      path: `/pages/buddy-space/index?invite=${encodeURIComponent(invite.code)}`,
      expiresAt: invite.expiresAt.toISOString(),
    }
  }

  async previewInvite(code: string): Promise<BuddyInvitePreviewResponse> {
    const invite = await this.getInviteByCode(code)
    const status = this.getInviteStatus(invite.status, invite.expiresAt)

    return {
      code: invite.code,
      inviter: this.toAccountSummary(invite.inviter),
      status,
      expiresAt: invite.expiresAt.toISOString(),
    }
  }

  async acceptInvite(code: string, accountId: string) {
    const invite = await this.getInviteByCode(code)
    const status = this.getInviteStatus(invite.status, invite.expiresAt)

    if (status !== 'pending') {
      throw new BadRequestException('BUDDY_INVITE_NOT_AVAILABLE')
    }

    if (invite.inviterAccountId === accountId) {
      throw new BadRequestException('BUDDY_INVITE_SELF_NOT_ALLOWED')
    }

    await this.assertAccountExists(accountId)
    await this.createBidirectionalLink(invite.inviterAccountId, accountId, invite.id)
    await this.prisma.buddyInvite.update({
      where: { id: invite.id },
      data: {
        status: 'accepted',
        inviteeAccountId: accountId,
        acceptedAt: new Date(),
      },
    })

    return this.getSpace(accountId)
  }

  async getSpace(accountId: string): Promise<BuddySpaceResponse> {
    await this.assertAccountExists(accountId)

    const links = await this.prisma.buddyLink.findMany({
      where: {
        ownerAccountId: accountId,
        active: true,
      },
      include: {
        partner: {
          select: this.accountSummarySelect(),
        },
      },
      orderBy: { updatedAt: 'desc' },
    })

    const responseLinks = []

    for (const link of links) {
      const timetable = await this.timetableService.getTimetable(link.partnerAccountId)

      responseLinks.push({
        id: link.id,
        partner: this.toAccountSummary(link.partner),
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
        ...('courses' in timetable ? { timetable } : {}),
      })
    }

    return { links: responseLinks }
  }

  async unbind(ownerAccountId: string, partnerAccountId: string) {
    if (!partnerAccountId || ownerAccountId === partnerAccountId) {
      throw new BadRequestException('BUDDY_PARTNER_INVALID')
    }

    const updated = await this.prisma.buddyLink.updateMany({
      where: {
        OR: [
          { ownerAccountId, partnerAccountId },
          { ownerAccountId: partnerAccountId, partnerAccountId: ownerAccountId },
        ],
      },
      data: { active: false },
    })

    if (!updated.count) {
      throw new NotFoundException('BUDDY_LINK_NOT_FOUND')
    }

    return { success: true }
  }

  private async assertAccountExists(accountId: string) {
    const account = await this.prisma.studentAccount.findUnique({
      where: { id: accountId },
      select: { id: true },
    })

    if (!account) {
      throw new ForbiddenException('ACCOUNT_NOT_FOUND')
    }
  }

  private async createBidirectionalLink(leftAccountId: string, rightAccountId: string, inviteId: string) {
    await this.prisma.$transaction([
      this.prisma.buddyLink.upsert({
        where: {
          ownerAccountId_partnerAccountId: {
            ownerAccountId: leftAccountId,
            partnerAccountId: rightAccountId,
          },
        },
        update: { active: true, inviteId },
        create: {
          ownerAccountId: leftAccountId,
          partnerAccountId: rightAccountId,
          inviteId,
        },
      }),
      this.prisma.buddyLink.upsert({
        where: {
          ownerAccountId_partnerAccountId: {
            ownerAccountId: rightAccountId,
            partnerAccountId: leftAccountId,
          },
        },
        update: { active: true, inviteId },
        create: {
          ownerAccountId: rightAccountId,
          partnerAccountId: leftAccountId,
          inviteId,
        },
      }),
    ])
  }

  private async createUniqueInviteCode() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomBytes(12).toString('base64url')
      const existing = await this.prisma.buddyInvite.findUnique({
        where: { code },
        select: { id: true },
      })

      if (!existing) {
        return code
      }
    }

    throw new Error('BUDDY_INVITE_CODE_GENERATION_FAILED')
  }

  private async getInviteByCode(code: string) {
    const cleanCode = String(code || '').trim()

    if (!cleanCode) {
      throw new NotFoundException('BUDDY_INVITE_NOT_FOUND')
    }

    const invite = await this.prisma.buddyInvite.findUnique({
      where: { code: cleanCode },
      include: {
        inviter: {
          select: this.accountSummarySelect(),
        },
      },
    })

    if (!invite) {
      throw new NotFoundException('BUDDY_INVITE_NOT_FOUND')
    }

    return invite
  }

  private getInviteStatus(status: string, expiresAt: Date) {
    if (status === 'pending' && expiresAt <= new Date()) {
      return 'expired'
    }

    return status as 'pending' | 'accepted' | 'expired' | 'cancelled'
  }

  private accountSummarySelect() {
    return {
      id: true,
      displayName: true,
      lastCachedAt: true,
      school: {
        select: {
          name: true,
          shortName: true,
        },
      },
    }
  }

  private toAccountSummary(account: {
    id: string
    displayName: string | null
    lastCachedAt: Date | null
    school?: {
      name: string
      shortName: string | null
    } | null
  }) {
    return {
      accountId: account.id,
      displayName: account.displayName ?? undefined,
      schoolName: account.school?.name,
      schoolShortName: account.school?.shortName ?? undefined,
      lastCachedAt: account.lastCachedAt?.toISOString(),
    }
  }
}
