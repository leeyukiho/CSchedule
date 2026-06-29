import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { PrismaService } from '../../common/prisma/prisma.service'
import { SchoolsService } from './schools.service'

const WEATHER_REFRESH_PERIOD_MS = 3 * 60 * 60 * 1000
const WEATHER_SCHEDULER_TICK_MS = 60 * 1000
const WEATHER_REFRESH_RETRY_MS = 10 * 60 * 1000

type ScheduledWeatherSchool = {
  id: string
  nextRunAtMs: number
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function getFiniteNumber(value: unknown) {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN

  return Number.isFinite(numberValue) ? numberValue : undefined
}

function hasWeatherLocation(config: unknown) {
  const root = asRecord(config)
  const provider = asRecord(root.provider)
  const providerConfig = asRecord(root.providerConfig)
  const weatherLocation = asRecord(provider.weatherLocation || providerConfig.weatherLocation)

  return (
    getFiniteNumber(weatherLocation.latitude) !== undefined &&
    getFiniteNumber(weatherLocation.longitude) !== undefined
  )
}

@Injectable()
export class WeatherScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeatherScheduler.name)
  private readonly schedule = new Map<string, ScheduledWeatherSchool>()
  private timer: NodeJS.Timeout | null = null
  private running = false
  private refreshingSchedule = false
  private destroyed = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly schools: SchoolsService,
  ) {}

  onModuleInit() {
    void this.refreshSchedule('startup')
    this.timer = setInterval(() => {
      void this.tick()
    }, WEATHER_SCHEDULER_TICK_MS)
  }

  onModuleDestroy() {
    this.destroyed = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  notifySchoolsChanged() {
    void this.refreshSchedule('admin-update')
  }

  private async refreshSchedule(reason: string) {
    if (this.refreshingSchedule || this.destroyed) {
      return
    }

    this.refreshingSchedule = true

    try {
      const schools = await this.prisma.school.findMany({
        where: {
          enabled: true,
          status: 'enabled',
        },
        select: {
          id: true,
          config: true,
        },
        orderBy: { id: 'asc' },
      })
      const enabledSchoolIds = schools
        .filter((school) => hasWeatherLocation(school.config))
        .map((school) => school.id)
      const enabledSet = new Set(enabledSchoolIds)

      for (const schoolId of [...this.schedule.keys()]) {
        if (!enabledSet.has(schoolId)) {
          this.schedule.delete(schoolId)
        }
      }

      const now = Date.now()
      const intervalMs = this.getIntervalMs(enabledSchoolIds.length)
      const plannedTimes = [...this.schedule.values()]
        .map((item) => item.nextRunAtMs)
        .filter((nextRunAtMs) => nextRunAtMs > now)
        .sort((left, right) => left - right)

      for (const schoolId of enabledSchoolIds) {
        if (this.schedule.has(schoolId)) {
          continue
        }

        const nextRunAtMs = this.findNextAvailableRunAt(now, intervalMs, plannedTimes)
        plannedTimes.push(nextRunAtMs)
        plannedTimes.sort((left, right) => left - right)
        this.schedule.set(schoolId, { id: schoolId, nextRunAtMs })
      }

      this.logger.log(
        `Weather schedule refreshed (${reason}): ${enabledSchoolIds.length} schools, interval ${Math.round(intervalMs / 60000)}m`,
      )
    } catch (error) {
      this.logger.warn(`Failed to refresh weather schedule: ${this.getErrorMessage(error)}`)
    } finally {
      this.refreshingSchedule = false
    }
  }

  private async tick() {
    if (this.running || this.destroyed) {
      return
    }

    this.running = true

    try {
      const due = [...this.schedule.values()]
        .filter((item) => item.nextRunAtMs <= Date.now())
        .sort((left, right) => left.nextRunAtMs - right.nextRunAtMs)

      for (const item of due) {
        await this.runSchool(item.id)
      }
    } finally {
      this.running = false
    }
  }

  private async runSchool(schoolId: string) {
    try {
      await this.schools.refreshSchoolWeather(schoolId)
      this.scheduleNextCycle(schoolId)
      this.logger.log(`Weather refreshed for school ${schoolId}`)
    } catch (error) {
      const entry = this.schedule.get(schoolId)
      if (entry) {
        entry.nextRunAtMs = Date.now() + WEATHER_REFRESH_RETRY_MS
      }
      this.logger.warn(
        `Failed to refresh weather for school ${schoolId}: ${this.getErrorMessage(error)}`,
      )
    }
  }

  private scheduleNextCycle(schoolId: string) {
    const ids = [...this.schedule.keys()].sort()
    const index = ids.indexOf(schoolId)
    const intervalMs = this.getIntervalMs(ids.length)
    const nextRunAtMs = Date.now() + intervalMs * Math.max(index + 1, 1)

    this.schedule.set(schoolId, { id: schoolId, nextRunAtMs })
  }

  private getIntervalMs(count: number) {
    return count > 0 ? WEATHER_REFRESH_PERIOD_MS / count : WEATHER_REFRESH_PERIOD_MS
  }

  private findNextAvailableRunAt(now: number, intervalMs: number, plannedTimes: number[]) {
    let candidate = now + intervalMs

    for (let index = 0; index <= plannedTimes.length; index += 1) {
      const conflicts = plannedTimes.some((time) => Math.abs(time - candidate) < intervalMs / 2)

      if (!conflicts) {
        return candidate
      }

      candidate += intervalMs
    }

    return candidate
  }

  private getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error || 'Unknown error')
  }
}
