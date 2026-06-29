import { Module } from '@nestjs/common'

import { ProvidersModule } from '../providers/providers.module'
import { CloudCredentialSyncModule } from '../sync/cloud-credential-sync.module'
import { SchoolsController } from './schools.controller'
import { SchoolsService } from './schools.service'
import { WeatherScheduler } from './weather.scheduler'

@Module({
  imports: [ProvidersModule, CloudCredentialSyncModule],
  controllers: [SchoolsController],
  providers: [SchoolsService, WeatherScheduler],
  exports: [SchoolsService, WeatherScheduler],
})
export class SchoolsModule {}
