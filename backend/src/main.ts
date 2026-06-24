import 'reflect-metadata'

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import compression from 'compression'
import { json, urlencoded } from 'express'

import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    cors: false,
  })
  const configuredOrigins = [
    process.env.CORS_ORIGIN,
    process.env.ADMIN_CORS_ORIGIN,
  ]
    .flatMap((value) => (value ?? '').split(','))
    .map((item) => item.trim())
    .filter(Boolean)
  const isProduction = process.env.NODE_ENV === 'production'
  const allowAnyOrigin =
    configuredOrigins.includes('*') ||
    (!isProduction && configuredOrigins.length === 0)
  const allowedOrigins = new Set(configuredOrigins.filter((item) => item !== '*'))
  const defaultBodyLimit = process.env.REQUEST_BODY_LIMIT ?? '256kb'
  const rawDataBodyLimit = process.env.RAW_DATA_BODY_LIMIT ?? '2mb'

  app.setGlobalPrefix('api/v1')
  app.use(compression({ threshold: 1024 }))
  app.use('/api/v1/account/:accountId/raw-data', json({ limit: rawDataBodyLimit }))
  app.use('/api/v1/account/:accountId/raw-course', json({ limit: rawDataBodyLimit }))
  app.use(json({ limit: defaultBodyLimit }))
  app.use(urlencoded({ extended: true, limit: defaultBodyLimit }))
  app.enableCors({
    origin: allowAnyOrigin
      ? true
      : (
          requestOrigin: string | undefined,
          callback: (error: Error | null, allow?: boolean) => void,
        ) => {
          if (
            !requestOrigin ||
            allowedOrigins.has(requestOrigin) ||
            (!isProduction && isLoopbackOrigin(requestOrigin))
          ) {
            callback(null, true)
            return
          }

          callback(null, false)
        },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'x-admin-api-key',
      'x-cschedule-account-id',
      'x-cschedule-account-token',
    ],
    credentials: false,
  })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  )

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
}

function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

void bootstrap()
