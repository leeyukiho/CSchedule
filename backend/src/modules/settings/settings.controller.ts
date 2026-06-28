import { Controller, Get } from '@nestjs/common'

import { SettingsService } from './settings.service'

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getAppSettings() {
    return this.settings.getAppSettings()
  }
}
