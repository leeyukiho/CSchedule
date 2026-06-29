import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../../common/prisma/prisma.service'
import { ProviderRegistryService } from '../providers/provider-registry.service'
import {
  EMPTY_CAPABILITIES,
  EMPTY_DATA_ACCESS,
  LoginContextResponse,
  SchoolCatalogSeed,
  SchoolListResponse,
  SchoolTermStartsResponse,
  SchoolWeatherResponse,
} from './schools.types'
import {
  CredentialSaveCapability,
  DataTarget,
  FrontendCloudImportConfig,
  ProviderAuthConfig,
  SchoolSyncStrategy,
} from '../providers/provider.types'
import { CloudCredentialSyncService } from '../sync/cloud-credential-sync.service'
import {
  canIssueFrontendCloudImportToken,
  createFrontendCloudImportToken,
} from '../sync/frontend-cloud-import-proof'

const WEATHER_CACHE_TTL_MS = 3 * 60 * 60 * 1000
const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'
const AIR_QUALITY_API_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'

type SchoolWeatherLocation = {
  displayName?: string
  latitude: number
  longitude: number
}

type SchoolWeatherCacheEntry = SchoolWeatherResponse & {
  expiresAtMs: number
}

@Injectable()
export class SchoolsService {
  private readonly weatherCache = new Map<string, SchoolWeatherCacheEntry>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistryService,
    private readonly cloudSync: CloudCredentialSyncService,
  ) {}

  async listSchools(
    keyword?: string,
    enabledOnly = true,
    limitInput?: number,
    offsetInput?: number,
    fields: 'full' | 'summary' = 'full',
  ): Promise<SchoolListResponse> {
    const text = keyword?.trim()
    const limit = Math.min(Math.max(Number(limitInput) || 50, 1), 100)
    const offset = Math.max(Number(offsetInput) || 0, 0)
    const summaryOnly = fields === 'summary'
    const where = text
      ? {
          OR: [
            { id: { contains: text, mode: 'insensitive' as const } },
            { name: { contains: text, mode: 'insensitive' as const } },
            { shortName: { contains: text, mode: 'insensitive' as const } },
            { province: { contains: text, mode: 'insensitive' as const } },
            { city: { contains: text, mode: 'insensitive' as const } },
            { providerId: { contains: text, mode: 'insensitive' as const } },
          ],
        }
      : undefined

    const statusFilter = enabledOnly
      ? { enabled: true, status: 'enabled' as const }
      : undefined

    const combinedWhere = where && statusFilter
      ? { AND: [where, statusFilter] }
      : (where || statusFilter)

    const [schools, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where: combinedWhere,
        select: {
          id: true,
          name: true,
          shortName: true,
          province: true,
          city: true,
          config: !summaryOnly,
          status: true,
          enabled: true,
          providerId: true,
          loginMode: !summaryOnly,
          dataAccess: !summaryOnly,
          capabilities: true,
        },
        orderBy: [{ enabled: 'desc' }, { status: 'asc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.school.count({
        where: combinedWhere,
      }),
    ])

    return {
      items: schools.map((school) => ({
        id: school.id,
        name: school.name,
        shortName: school.shortName ?? undefined,
        province: school.province ?? undefined,
        city: school.city ?? undefined,
        ...(summaryOnly ? {} : this.getCatalogInfo(school.config)),
        status: school.status,
        enabled: school.enabled,
        providerId: school.providerId ?? undefined,
        ...(summaryOnly
          ? {}
          : {
              loginMode: school.loginMode ?? undefined,
              dataAccess: this.asDataAccess(school.dataAccess),
            }),
        capabilities: this.asCapabilities(school.capabilities),
        ...(summaryOnly
          ? {}
          : {
              credentialSave: this.getCredentialSaveCapability(
                school.providerId,
                school.config,
              ),
              syncStrategy: this.getSchoolSyncStrategy({
                providerId: school.providerId,
                dataAccess: this.asDataAccess(school.dataAccess),
                capabilities: this.asCapabilities(school.capabilities),
                config: school.config,
              }),
            }),
        message: this.getStatusMessage(school.enabled, school.status),
      })),
      total,
      limit,
      offset,
      hasMore: offset + schools.length < total,
    }
  }

  async getSchoolTermStarts(schoolId: string): Promise<SchoolTermStartsResponse> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        config: true,
        enabled: true,
        status: true,
        updatedAt: true,
      },
    })

    if (!school) {
      throw new NotFoundException('School not found')
    }

    this.assertSchoolAvailable(school)

    return {
      schoolId: school.id,
      termStarts: this.getTermStarts(school.config),
      updatedAt: school.updatedAt.toISOString(),
    }
  }

  async getSchoolWeather(schoolId: string): Promise<SchoolWeatherResponse> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        shortName: true,
        config: true,
        enabled: true,
        status: true,
      },
    })

    if (!school) {
      throw new NotFoundException('School not found')
    }

    this.assertSchoolAvailable(school)

    const location = this.getWeatherLocation(school.config)

    if (!location) {
      throw new NotFoundException('School weather is not configured')
    }

    return this.getCachedSchoolWeather({
      id: school.id,
      name: school.name,
      shortName: school.shortName,
      location,
    })
  }

  async refreshSchoolWeather(schoolId: string): Promise<SchoolWeatherResponse> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        shortName: true,
        config: true,
        enabled: true,
        status: true,
      },
    })

    if (!school) {
      throw new NotFoundException('School not found')
    }

    this.assertSchoolAvailable(school)

    const location = this.getWeatherLocation(school.config)

    if (!location) {
      throw new NotFoundException('School weather is not configured')
    }

    return this.fetchAndCacheSchoolWeather({
      id: school.id,
      name: school.name,
      shortName: school.shortName,
      location,
    })
  }

  private async getCachedSchoolWeather(input: {
    id: string
    name: string
    shortName?: string | null
    location: SchoolWeatherLocation
  }) {
    const cacheKey = this.getWeatherCacheKey(input.id, input.location)
    const cached = this.weatherCache.get(cacheKey)

    if (cached && cached.expiresAtMs > Date.now()) {
      const { expiresAtMs: _expiresAtMs, ...response } = cached
      return response
    }

    return this.fetchAndCacheSchoolWeather(input)
  }

  private async fetchAndCacheSchoolWeather(input: {
    id: string
    name: string
    shortName?: string | null
    location: SchoolWeatherLocation
  }) {
    const displayName = input.location.displayName || input.shortName || input.name
    const text = await this.fetchSchoolWeatherText({
      ...input.location,
      displayName,
    })
    const cachedAtMs = Date.now()
    const response: SchoolWeatherResponse = {
      schoolId: input.id,
      displayName,
      text,
      cachedAt: new Date(cachedAtMs).toISOString(),
      expiresAt: new Date(cachedAtMs + WEATHER_CACHE_TTL_MS).toISOString(),
    }

    this.weatherCache.set(this.getWeatherCacheKey(input.id, input.location), {
      ...response,
      expiresAtMs: cachedAtMs + WEATHER_CACHE_TTL_MS,
    })

    return response
  }

  async createLoginContext(schoolId: string): Promise<LoginContextResponse> {
    const school = await this.findSchool(schoolId)
    this.assertSchoolAvailable(school)

    const loginMode = school.loginMode ?? 'direct_password'
    const authConfig = this.getAuthConfig(school.config)
    const credentialSave = this.getCredentialSaveCapability(
      school.providerId,
      school.config,
    )
    const dataAccess = this.asDataAccess(school.dataAccess)
    const capabilities = this.asCapabilities(school.capabilities)
    const syncStrategy = this.getSchoolSyncStrategy({
      providerId: school.providerId,
      dataAccess,
      capabilities,
      config: school.config,
    })
    const webview = this.createFrontendWebviewDescriptor(school, authConfig)
    const contextId = this.createContextId(school.id)
    const frontendCloudImport = this.createFrontendCloudImport({
      schoolId: school.id,
      providerId: school.providerId ?? school.id,
      contextId,
      syncStrategy,
    })
    const expireAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    if (loginMode === 'cas_webview' || loginMode === 'oauth_webview') {
      return {
        contextId,
        mode: loginMode,
        fields: [],
        webview,
        credentialSave,
        syncStrategy,
        ...(frontendCloudImport ? { frontendCloudImport } : {}),
        expireAt,
      }
    }

    let fields: LoginContextResponse['fields'] = [
      {
        name: 'username',
        label: '学号',
        type: 'text',
        required: true,
        placeholder: '请输入教务系统账号',
      },
      {
        name: 'password',
        label: '密码',
        type: 'password',
        required: true,
        placeholder: '请输入教务系统密码',
      },
    ]

    if (authConfig?.fields?.length) {
      fields = authConfig.fields.map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        required: field.required,
        placeholder: field.placeholder,
      }))
    }

    if (
      !fields.some((field) => field.type === 'captcha') &&
      (loginMode === 'password_captcha' || authConfig?.captchaRequired)
    ) {
      fields.push({
        name: 'captcha',
        label: '验证码',
        type: 'captcha',
        required: true,
        placeholder: '请输入图片验证码',
      })
    }

    return {
      contextId,
      mode: loginMode,
      fields,
      webview,
      captcha:
        loginMode === 'password_captcha' || authConfig?.captchaRequired
          ? {
              id: authConfig?.captcha?.id || `${school.id}-captcha`,
              imageBase64: authConfig?.captcha?.imageBase64,
              refreshable: authConfig?.captcha?.refreshable ?? true,
            }
          : undefined,
      credentialSave,
      syncStrategy,
      ...(frontendCloudImport ? { frontendCloudImport } : {}),
      expireAt,
    }
  }

  private createFrontendWebviewDescriptor(
    school: SchoolCatalogSeed,
    authConfig?: ProviderAuthConfig,
  ): LoginContextResponse['webview'] | undefined {
    const webview = authConfig?.webview
    const url = school.authUrl || webview?.url

    if (!url) {
      return undefined
    }

    return {
      url,
      successUrlPatterns: webview?.successUrlPatterns || ['.*'],
      failureUrlPatterns: webview?.failureUrlPatterns,
      callbackMode:
        webview?.callbackMode === 'manual_confirm'
          ? 'manual_confirm'
          : 'webview_client_fetch',
      requiredFetchTargets:
        webview?.requiredFetchTargets || this.getInitialFetchTargets(school.capabilities),
      closeAfterCacheWritten: webview?.closeAfterCacheWritten ?? true,
    }
  }

  private getInitialFetchTargets(capabilities: unknown): DataTarget[] {
    const source =
      capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
        ? (capabilities as Partial<Record<DataTarget, unknown>>)
        : {}

    if (source.course) {
      return ['course']
    }

    for (const target of ['profile', 'score', 'exam'] as DataTarget[]) {
      if (source[target]) {
        return [target]
      }
    }

    return ['course']
  }

  private async findSchool(schoolId: string): Promise<SchoolCatalogSeed> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    })

    if (school) {
      return {
        id: school.id,
        name: school.name,
        shortName: school.shortName ?? undefined,
        province: school.province ?? undefined,
        city: school.city ?? undefined,
        enabled: school.enabled,
        status: school.status,
        providerId: school.providerId ?? undefined,
        loginMode: school.loginMode ?? undefined,
        dataAccess: this.asDataAccess(school.dataAccess),
        capabilities: this.asCapabilities(school.capabilities),
        authUrl: school.authUrl ?? undefined,
        config: school.config,
      }
    }

    throw new NotFoundException('School not found')
  }

  private assertSchoolAvailable(school: { enabled: boolean; status: string }) {
    if (!school.enabled || school.status !== 'enabled') {
      throw new NotFoundException('School not available')
    }
  }

  private asCapabilities(value: unknown) {
    if (!value || typeof value !== 'object') {
      return EMPTY_CAPABILITIES
    }

    const source = value as Partial<typeof EMPTY_CAPABILITIES>

    return {
      course: Boolean(source.course),
      score: Boolean(source.score),
      exam: Boolean(source.exam),
      profile: Boolean(source.profile),
    }
  }

  private asDataAccess(value: unknown) {
    if (!value || typeof value !== 'object') {
      return EMPTY_DATA_ACCESS
    }

    const source = value as Partial<typeof EMPTY_DATA_ACCESS>

    return {
      course: Array.isArray(source.course) ? source.course : [],
      score: Array.isArray(source.score) ? source.score : [],
      exam: Array.isArray(source.exam) ? source.exam : [],
      profile: Array.isArray(source.profile) ? source.profile : [],
    }
  }

  private getCatalogInfo(value: unknown) {
    if (!value || typeof value !== 'object') {
      return {}
    }

    const catalog = (value as { catalog?: unknown }).catalog

    if (!catalog || typeof catalog !== 'object') {
      return {}
    }

    const source = catalog as {
      code?: unknown
      level?: unknown
      isPrivate?: unknown
    }

    return {
      catalogCode: typeof source.code === 'string' ? source.code : undefined,
      level: typeof source.level === 'string' ? source.level : undefined,
      isPrivate: typeof source.isPrivate === 'boolean' ? source.isPrivate : undefined,
    }
  }

  private getAuthConfig(value: unknown): ProviderAuthConfig | undefined {
    const config = this.asRecord(value)
    const provider = this.asRecord(config.provider)
    const auth = config.authConfig ?? provider.authConfig

    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
      return undefined
    }

    return auth as ProviderAuthConfig
  }

  private getCredentialSaveCapability(
    providerId: string | null | undefined,
    config: unknown,
  ): CredentialSaveCapability | undefined {
    if (providerId) {
      try {
        const providerCapability =
          this.providers.getProvider(providerId).meta.credentialSave

        if (providerCapability) {
          return providerCapability
        }
      } catch {
        // Provider metadata is optional; fall through to school config.
      }
    }

    const root = this.asRecord(config)
    const provider = this.asRecord(root.provider)
    const capability = root.credentialSave ?? provider.credentialSave

    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) {
      return undefined
    }

    return this.asCredentialSaveCapability(capability)
  }

  private getSchoolSyncStrategy(input: {
    providerId?: string | null
    dataAccess: ReturnType<SchoolsService['asDataAccess']>
    capabilities: ReturnType<SchoolsService['asCapabilities']>
    config: unknown
  }): SchoolSyncStrategy {
    const credentialSave = this.getCredentialSaveCapability(
      input.providerId,
      input.config,
    )
    const canSavePassword =
      Boolean(credentialSave?.passwordVaultAllowed) &&
      credentialSave?.autoSync === 'password_login'
    const hasWebviewCourse = input.dataAccess.course.includes('webview_client_fetch')
    const hasManualImport = input.dataAccess.course.includes('manual_import')
    const supportsCourse = Boolean(input.capabilities.course)
    const cloudFunctions = this.cloudSync.getCloudSyncFunctions(input.config)
    const hasCloudCourse =
      input.dataAccess.course.includes('cloud_worker') &&
      Boolean(cloudFunctions.course)
    const canRunCloudCourse = this.cloudSync.canRunTarget(input.config, 'course')

    if (supportsCourse && canSavePassword && hasCloudCourse && canRunCloudCourse) {
      return {
        importMode: 'password_server',
        syncMode: 'cloud_worker',
        ...(Object.keys(cloudFunctions).length ? { cloudFunctions } : {}),
        ...this.getFrontendCloudImportStrategy(input, cloudFunctions),
        cloudParserRequired: false,
        localCachePreferred: false,
        scheduledSyncSupported: true,
        passwordVaultRequired: false,
        passwordVaultOptional: true,
        manualSyncRequired: false,
      }
    }

    if (supportsCourse && hasWebviewCourse) {
      return {
        importMode: 'webview_cloud',
        syncMode: 'manual_webview',
        ...(Object.keys(cloudFunctions).length ? { cloudFunctions } : {}),
        ...this.getFrontendCloudImportStrategy(input, cloudFunctions),
        cloudParserRequired: true,
        localCachePreferred: true,
        scheduledSyncSupported: false,
        passwordVaultRequired: false,
        passwordVaultOptional: false,
        manualSyncRequired: true,
      }
    }

    return {
      importMode: hasManualImport ? 'manual_import' : 'webview_cloud',
      syncMode: 'manual_webview',
      ...(Object.keys(cloudFunctions).length ? { cloudFunctions } : {}),
      ...this.getFrontendCloudImportStrategy(input, cloudFunctions),
      cloudParserRequired: true,
      localCachePreferred: true,
      scheduledSyncSupported: false,
      passwordVaultRequired: false,
      manualSyncRequired: true,
    }
  }

  private getFrontendCloudImportStrategy(
    input: {
      dataAccess: ReturnType<SchoolsService['asDataAccess']>
      capabilities: ReturnType<SchoolsService['asCapabilities']>
    },
    cloudFunctions: ReturnType<CloudCredentialSyncService['getCloudSyncFunctions']>,
  ): Pick<SchoolSyncStrategy, 'frontendCloudImport'> {
    const candidates = ['course', 'profile', 'score', 'exam'] as DataTarget[]
    const targets = candidates.filter((target) => {
      return (
        Boolean(input.capabilities[target]) &&
        input.dataAccess[target].includes('cloud_worker')
      )
    })

    if (!targets.includes('course')) {
      return {}
    }

    const supportedTargets: DataTarget[] = []

    for (const target of targets) {
      const sharedTargets = [...supportedTargets, target]
      const cloudFunction = this.cloudSync.getSharedCloudFunction(
        { cloudFunctions },
        sharedTargets,
      )

      if (cloudFunction?.url) {
        supportedTargets.push(target)
      }
    }

    const cloudFunction = this.cloudSync.getSharedCloudFunction(
      { cloudFunctions },
      supportedTargets,
    )

    if (!cloudFunction?.url || supportedTargets.length === 0) {
      return {}
    }

    return {
      frontendCloudImport: {
        targets: supportedTargets,
        cloudFunction,
      },
    }
  }

  private createFrontendCloudImport(input: {
    schoolId: string
    providerId: string
    contextId: string
    syncStrategy: SchoolSyncStrategy
  }): FrontendCloudImportConfig | undefined {
    const config = input.syncStrategy.frontendCloudImport

    if (!config?.cloudFunction.url || config.targets.length === 0) {
      return undefined
    }

    if (!canIssueFrontendCloudImportToken()) {
      return config
    }

    const token = createFrontendCloudImportToken({
      schoolId: input.schoolId,
      providerId: input.providerId,
      contextId: input.contextId,
      targets: config.targets,
    })

    return {
      ...config,
      clientImportToken: token.token,
      clientImportTokenExpiresAt: token.expiresAt,
    }
  }

  private getRegisteredProvider(providerId: string) {
    try {
      return this.providers.getProvider(providerId)
    } catch {
      return null
    }
  }

  private asCredentialSaveCapability(
    value: unknown,
  ): CredentialSaveCapability | undefined {
    const source = this.asRecord(value)

    if (
      typeof source.passwordVaultAllowed !== 'boolean' ||
      typeof source.autoSync !== 'string' ||
      typeof source.notice !== 'string' ||
      typeof source.consentLabel !== 'string'
    ) {
      return undefined
    }

    if (
      ![
        'manual_only',
        'password_login',
        'password_login_may_need_verification',
      ].includes(source.autoSync)
    ) {
      return undefined
    }

    return {
      passwordVaultAllowed: source.passwordVaultAllowed,
      autoSync: source.autoSync as CredentialSaveCapability['autoSync'],
      scheduledSyncSupported:
        typeof source.scheduledSyncSupported === 'boolean'
          ? source.scheduledSyncSupported
          : undefined,
      title: typeof source.title === 'string' ? source.title : undefined,
      notice: source.notice,
      consentLabel: source.consentLabel,
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
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

  private getWeatherLocation(config: unknown): SchoolWeatherLocation | null {
    const root = this.asRecord(config)
    const provider = this.asRecord(root.provider)
    const providerConfig = this.asRecord(root.providerConfig)
    const weatherLocation = this.asRecord(provider.weatherLocation || providerConfig.weatherLocation)
    const latitude = this.getFiniteNumber(weatherLocation.latitude)
    const longitude = this.getFiniteNumber(weatherLocation.longitude)

    if (latitude === undefined || longitude === undefined) {
      return null
    }

    return {
      displayName: this.getOptionalText(weatherLocation.displayName),
      latitude,
      longitude,
    }
  }

  private getWeatherCacheKey(schoolId: string, location: SchoolWeatherLocation) {
    return [
      schoolId,
      location.latitude.toFixed(6),
      location.longitude.toFixed(6),
    ].join(':')
  }

  private buildWeatherRequestUrl(location: SchoolWeatherLocation) {
    const currentFields = [
      'temperature_2m',
      'apparent_temperature',
      'weather_code',
    ].join(',')
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: currentFields,
      timezone: 'Asia/Shanghai',
      forecast_days: '1',
    })

    return `${WEATHER_API_URL}?${params.toString()}`
  }

  private buildAirQualityRequestUrl(location: SchoolWeatherLocation) {
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: 'us_aqi',
      timezone: 'Asia/Shanghai',
      forecast_days: '1',
    })

    return `${AIR_QUALITY_API_URL}?${params.toString()}`
  }

  private async fetchJson(url: string) {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Weather request failed: ${response.status}`)
    }

    return response.json() as Promise<unknown>
  }

  private async fetchSchoolWeatherText(location: Required<SchoolWeatherLocation>) {
    const [weatherData, airQualityData] = await Promise.all([
      this.settleRequest(this.fetchJson(this.buildWeatherRequestUrl(location))),
      this.settleRequest(this.fetchJson(this.buildAirQualityRequestUrl(location))),
    ])
    const weatherText = weatherData ? this.buildWeatherText(weatherData) : ''
    const airQualityText = airQualityData ? this.buildAirQualityText(airQualityData) : ''

    if (!weatherText && !airQualityText) {
      throw new Error('Weather data unavailable')
    }

    return [location.displayName, weatherText, airQualityText].filter(Boolean).join(' · ')
  }

  private settleRequest<T>(request: Promise<T>) {
    return request.catch(() => undefined)
  }

  private buildWeatherText(data: unknown) {
    const record = this.asRecord(data)
    const current = this.asRecord(record.current)
    const legacyCurrent = this.asRecord(record.current_weather)
    const temperature =
      this.getFiniteNumber(current.temperature_2m) ??
      this.getFiniteNumber(legacyCurrent.temperature)
    const weatherCode =
      this.getFiniteNumber(current.weather_code) ??
      this.getFiniteNumber(legacyCurrent.weathercode)
    const conditionText = this.getWeatherCodeLabel(weatherCode)
    const temperatureText = typeof temperature === 'number' ? `${Math.round(temperature)}°` : ''

    return [conditionText, temperatureText].filter(Boolean).join(' ')
  }

  private buildAirQualityText(data: unknown) {
    const record = this.asRecord(data)
    const current = this.asRecord(record.current)
    const aqi = this.getFiniteNumber(current.us_aqi)
    const level = this.getAirQualityLevel(aqi)

    return level ? `空气质量 ${level}` : ''
  }

  private getWeatherCodeLabel(code: number | undefined) {
    const labels: Record<number, string> = {
      0: '晴',
      1: '晴间多云',
      2: '多云',
      3: '阴',
      45: '有雾',
      48: '雾凇',
      51: '小毛毛雨',
      53: '毛毛雨',
      55: '大毛毛雨',
      56: '冻毛毛雨',
      57: '强冻毛毛雨',
      61: '小雨',
      63: '中雨',
      65: '大雨',
      66: '冻雨',
      67: '强冻雨',
      71: '小雪',
      73: '中雪',
      75: '大雪',
      77: '米雪',
      80: '阵雨',
      81: '强阵雨',
      82: '暴雨',
      85: '阵雪',
      86: '强阵雪',
      95: '雷雨',
      96: '雷雨冰雹',
      99: '强雷雨冰雹',
    }

    return typeof code === 'number' ? labels[code] || '天气' : '天气'
  }

  private getAirQualityLevel(value: number | undefined) {
    if (typeof value !== 'number' || value < 0) return ''
    if (value <= 50) return '优'
    if (value <= 100) return '良'
    if (value <= 150) return '轻度污染'
    if (value <= 200) return '中度污染'
    if (value <= 300) return '重度污染'
    return '严重污染'
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

  private getStatusMessage(enabled: boolean, status: string) {
    if (enabled && status === 'enabled') {
      return undefined
    }

    if (status === 'researching') {
      return '学校适配调研中'
    }

    if (status === 'candidate') {
      return '已收录，待完成 Provider 验收'
    }

    if (status === 'catalog_only') {
      return '已收录至学校目录，暂未接入教务适配'
    }

    return '暂不可绑定'
  }

  private createContextId(schoolId: string) {
    return `${schoolId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }
}
