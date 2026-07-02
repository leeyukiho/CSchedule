export interface ReminderWorkerConfig {
  enabled: boolean
  dryRun: boolean
  sendWindowStart: string
  sendWindowEnd: string
  scanIntervalMs: number
  batchSize: number
  concurrency: number
  ratePerSecond: number
  maxRuntimeMs: number
  testOpenid: string
  dailyCourseTemplateId: string
  examTemplateId: string
  miniProgramState: 'developer' | 'trial' | 'formal'
  lang: 'zh_CN' | 'en_US' | 'zh_HK' | 'zh_TW'
  hasWechatCredentials: boolean
  readyToSend: boolean
  missingConfig: string[]
}

export type ReminderConfigPatch = Partial<{
  enabled: boolean
  dryRun: boolean
  sendWindowStart: string
  sendWindowEnd: string
  scanIntervalMs: number
  batchSize: number
  concurrency: number
  ratePerSecond: number
  maxRuntimeMs: number
  testOpenid: string
  dailyCourseTemplateId: string
  examTemplateId: string
  miniProgramState: 'developer' | 'trial' | 'formal'
  lang: 'zh_CN' | 'en_US' | 'zh_HK' | 'zh_TW'
}>

function getBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name]

  if (value === undefined) {
    return fallback
  }

  return value === 'true'
}

function getTimeEnv(name: string, fallback: string) {
  const value = String(process.env[name] || '').trim()

  return /^\d{2}:\d{2}$/.test(value) ? value : fallback
}

function normalizeTime(value: unknown, fallback: string) {
  if (value === '' && fallback === '') {
    return ''
  }

  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback
}

export function getReminderConfig(): ReminderWorkerConfig {
  const dailyCourseTemplateId = String(process.env.WECHAT_DAILY_COURSE_TEMPLATE_ID || '').trim()
  const examTemplateId = String(process.env.WECHAT_EXAM_TEMPLATE_ID || '').trim()
  const hasWechatCredentials = Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET)
  const readyToSend = Boolean(hasWechatCredentials && (dailyCourseTemplateId || examTemplateId))
  const enabled = getBooleanEnv('REMINDER_ENABLED', false)
  const dryRun = getBooleanEnv('REMINDER_DRY_RUN', !readyToSend)

  return {
    enabled,
    dryRun,
    sendWindowStart: '00:00',
    sendWindowEnd: '',
    scanIntervalMs: 60_000,
    batchSize: 100,
    concurrency: 5,
    ratePerSecond: 10,
    maxRuntimeMs: 25 * 60 * 1000,
    testOpenid: '',
    dailyCourseTemplateId,
    examTemplateId,
    miniProgramState: normalizeMiniProgramState(process.env.WECHAT_MINIPROGRAM_STATE),
    lang: normalizeLang(process.env.WECHAT_SUBSCRIBE_MESSAGE_LANG),
    hasWechatCredentials,
    readyToSend,
    missingConfig: getMissingConfig({
      enabled,
      dryRun,
      hasWechatCredentials,
      dailyCourseTemplateId,
      examTemplateId,
    }),
  }
}

export function mergeReminderConfig(
  base: ReminderWorkerConfig,
  patch: unknown,
): ReminderWorkerConfig {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch)
    ? (patch as ReminderConfigPatch)
    : {}

  const dailyCourseTemplateId = typeof source.dailyCourseTemplateId === 'string'
    ? source.dailyCourseTemplateId.trim()
    : base.dailyCourseTemplateId
  const examTemplateId = typeof source.examTemplateId === 'string'
    ? source.examTemplateId.trim()
    : base.examTemplateId
  const next = {
    ...base,
    enabled: typeof source.enabled === 'boolean' ? source.enabled : base.enabled,
    dryRun: typeof source.dryRun === 'boolean' ? source.dryRun : base.dryRun,
    sendWindowStart: normalizeTime(source.sendWindowStart, base.sendWindowStart),
    sendWindowEnd: source.sendWindowEnd === ''
      ? ''
      : normalizeTime(source.sendWindowEnd, base.sendWindowEnd),
    scanIntervalMs: getPositivePatch(source.scanIntervalMs, base.scanIntervalMs),
    batchSize: getPositivePatch(source.batchSize, base.batchSize),
    concurrency: getPositivePatch(source.concurrency, base.concurrency),
    ratePerSecond: getPositivePatch(source.ratePerSecond, base.ratePerSecond),
    maxRuntimeMs: getPositivePatch(source.maxRuntimeMs, base.maxRuntimeMs),
    testOpenid: typeof source.testOpenid === 'string' ? source.testOpenid.trim() : base.testOpenid,
    dailyCourseTemplateId,
    examTemplateId,
    miniProgramState: normalizeMiniProgramState(source.miniProgramState, base.miniProgramState),
    lang: normalizeLang(source.lang, base.lang),
  }

  return {
    ...next,
    readyToSend: Boolean(next.hasWechatCredentials && (next.dailyCourseTemplateId || next.examTemplateId)),
    missingConfig: getMissingConfig(next),
  }
}

export function isWithinReminderWindow(
  now = new Date(),
  start = '07:30',
  end = '08:00',
) {
  if (!end) {
    return now.getHours() * 60 + now.getMinutes() >= toMinutes(start)
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes
}

function getPositivePatch(value: unknown, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function normalizeMiniProgramState(value: unknown, fallback: 'developer' | 'trial' | 'formal' = 'formal') {
  return value === 'developer' || value === 'trial' || value === 'formal' ? value : fallback
}

function normalizeLang(value: unknown, fallback: 'zh_CN' | 'en_US' | 'zh_HK' | 'zh_TW' = 'zh_CN') {
  return value === 'zh_CN' || value === 'en_US' || value === 'zh_HK' || value === 'zh_TW' ? value : fallback
}

function getMissingConfig(config: {
  enabled: boolean
  dryRun: boolean
  hasWechatCredentials: boolean
  dailyCourseTemplateId: string
  examTemplateId: string
}) {
  return [
    config.hasWechatCredentials ? '' : 'WECHAT_APP_ID/WECHAT_APP_SECRET',
    config.dailyCourseTemplateId ? '' : 'WECHAT_DAILY_COURSE_TEMPLATE_ID',
    config.examTemplateId ? '' : 'WECHAT_EXAM_TEMPLATE_ID',
    config.dryRun ? 'REMINDER_DRY_RUN=false' : '',
    config.enabled ? '' : 'REMINDER_ENABLED=true',
  ].filter(Boolean)
}

function toMinutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':')

  return Number(hour) * 60 + Number(minute)
}
