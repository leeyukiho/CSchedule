import { Module } from '@nestjs/common'

import { ProvidersModule } from '../providers/providers.module'
import { CloudCredentialSyncModule } from '../sync/cloud-credential-sync.module'
import { QrcodeLoginService } from '../auth/qrcode-login.service'
import { SchoolsController } from './schools.controller'
import { SchoolsService } from './schools.service'
import { WeatherScheduler } from './weather.scheduler'

@Module({
  imports: [ProvidersModule, CloudCredentialSyncModule],
  controllers: [SchoolsController],
  providers: [SchoolsService, WeatherScheduler, QrcodeLoginService],
  exports: [SchoolsService, WeatherScheduler],
})
export class SchoolsModule {}
