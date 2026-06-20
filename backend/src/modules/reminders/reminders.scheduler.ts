import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { RemindersService } from './reminders.service'

@Injectable()
export class RemindersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersScheduler.name)
  private timer: NodeJS.Timeout | null = null
  private destroyed = false

  constructor(private readonly reminders: RemindersService) {}

  onModuleInit() {
    void this.runLoop()
  }

  onModuleDestroy() {
    this.destroyed = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async runLoop() {
    if (this.destroyed) {
      return
    }

    const config = await this.reminders.getConfig().catch(() => null)
    await this.run()

    if (!this.destroyed) {
      this.timer = setTimeout(() => {
        void this.runLoop()
      }, config?.scanIntervalMs || 60_000)
    }
  }

  private async run() {
    try {
      const result = await this.reminders.runDueReminders()

      if (!result.skipped) {
        this.logger.log(`Reminder run finished: ${JSON.stringify(result)}`)
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error || 'Reminder run failed'))
    }
  }
}
