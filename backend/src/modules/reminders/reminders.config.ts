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
  const hasWechatConfig = Boolean(
    process.env.WECHAT_APP_ID &&
      process.env.WECHAT_APP_SECRET &&
      (process.env.WECHAT_DAILY_COURSE_TEMPLATE_ID || process.env.WECHAT_EXAM_TEMPLATE_ID),
  )

  return {
    enabled: getBooleanEnv('REMINDER_ENABLED', false),
    dryRun: getBooleanEnv('REMINDER_DRY_RUN', !hasWechatConfig),
    sendWindowStart: '00:00',
    sendWindowEnd: '',
    scanIntervalMs: 60_000,
    batchSize: 100,
    concurrency: 5,
    ratePerSecond: 10,
    maxRuntimeMs: 25 * 60 * 1000,
    testOpenid: '',
    dailyCourseTemplateId: String(process.env.WECHAT_DAILY_COURSE_TEMPLATE_ID || '').trim(),
    examTemplateId: String(process.env.WECHAT_EXAM_TEMPLATE_ID || '').trim(),
  }
}

export function mergeReminderConfig(
  base: ReminderWorkerConfig,
  patch: unknown,
): ReminderWorkerConfig {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch)
    ? (patch as ReminderConfigPatch)
    : {}

  return {
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
    dailyCourseTemplateId: typeof source.dailyCourseTemplateId === 'string'
      ? source.dailyCourseTemplateId.trim()
      : base.dailyCourseTemplateId,
    examTemplateId: typeof source.examTemplateId === 'string'
      ? source.examTemplateId.trim()
      : base.examTemplateId,
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

function toMinutes(value: string) {
  const [hour = '0', minute = '0'] = value.split(':')

  return Number(hour) * 60 + Number(minute)
}
