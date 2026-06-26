import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { AdminGuard } from './admin.guard'
import {
  AdminProviderConfigUpsertInput,
  AdminSchoolUpdateInput,
  AdminService,
} from './admin.service'
import { AccountStatus, NotificationTargetType, SchoolStatus } from '@prisma/client'

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats()
  }

  @Get('schools')
  listSchools(
    @Query('keyword') keyword?: string,
    @Query('status') status?: SchoolStatus,
    @Query('enabled') enabled?: string,
    @Query('sortBy') sortBy?: 'default' | 'userCount',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.adminService.listAllSchools({
      keyword,
      status,
      enabled: enabled === 'true' ? true : enabled === 'false' ? false : undefined,
      sortBy,
      sortOrder,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Get('users')
  listUsers(
    @Query('keyword') keyword?: string,
    @Query('schoolId') schoolId?: string,
    @Query('schoolKeyword') schoolKeyword?: string,
    @Query('status') status?: AccountStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.adminService.listUsers({
      keyword,
      schoolId,
      schoolKeyword,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Patch('schools/:schoolId')
  updateSchool(
    @Param('schoolId') schoolId: string,
    @Body() input: AdminSchoolUpdateInput,
  ) {
    return this.adminService.updateSchool(schoolId, input)
  }

  @Put('schools/:schoolId/provider-config')
  upsertProviderConfig(
    @Param('schoolId') schoolId: string,
    @Body() input: AdminProviderConfigUpsertInput,
  ) {
    return this.adminService.upsertProviderConfig(schoolId, input)
  }

  @Get('submissions')
  listSubmissions(
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('extraVerification') extraVerification?: string,
    @Query('adaptationHelp') adaptationHelp?: string,
    @Query('sortBy') sortBy?: 'createdAt' | 'requestCount',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.adminService.listSubmissions({
      keyword,
      status,
      extraVerification,
      adaptationHelp,
      sortBy,
      sortOrder,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Patch('submissions/:submissionId')
  updateSubmission(
    @Param('submissionId') submissionId: string,
    @Body() input: { status?: string; review?: Record<string, unknown> },
  ) {
    return this.adminService.updateSubmission(submissionId, input)
  }

  @Delete('submissions/:submissionId')
  deleteSubmission(@Param('submissionId') submissionId: string) {
    return this.adminService.deleteSubmission(submissionId)
  }

  @Get('feedback')
  listFeedback(
    @Query('status') status?: string,
    @Query('schoolId') schoolId?: string,
    @Query('schoolKeyword') schoolKeyword?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.adminService.listFeedback({
      status,
      schoolId,
      schoolKeyword,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Get('notifications')
  listNotifications(
    @Query('keyword') keyword?: string,
    @Query('targetType') targetType?: NotificationTargetType,
    @Query('active') active?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.adminService.listNotifications({
      keyword,
      targetType,
      active: active === 'true' ? true : active === 'false' ? false : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Post('notifications')
  createNotification(@Body() input: {
    title?: string
    content?: string
    targetType?: NotificationTargetType
    targetSchoolId?: string | null
    targetAccountId?: string | null
    active?: boolean
  }) {
    return this.adminService.createNotification(input, 'admin')
  }

  @Patch('notifications/:notificationId')
  updateNotification(
    @Param('notificationId') notificationId: string,
    @Body() input: {
      title?: string
      content?: string
      active?: boolean
    },
  ) {
    return this.adminService.updateNotification(notificationId, input)
  }
}
