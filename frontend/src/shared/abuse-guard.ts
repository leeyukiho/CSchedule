import Taro from '@tarojs/taro'

const CLIENT_ID_KEY = 'cschedule.clientId'
const OPENID_ABUSE_TOKEN_KEY = 'cschedule.openidAbuseToken'
const RECORD_PREFIX = 'cschedule.abuseGuard.'

interface GuardRule {
  cooldownMs: number
  windowMs: number
  duplicateWindowMs: number
  maxSubmissions: number
  cooldownMessage: string
  quotaMessage: string
  duplicateMessage: string
}

interface GuardRecord {
  submittedAt: number[]
  fingerprints: Record<string, number>
}

const RULES: Record<'feedback' | 'schoolSubmission', GuardRule> = {
  feedback: {
    cooldownMs: 60 * 1000,
    windowMs: 15 * 60 * 1000,
    duplicateWindowMs: 10 * 60 * 1000,
    maxSubmissions: 5,
    cooldownMessage: '请稍后再提交反馈',
    quotaMessage: '反馈提交过于频繁，请稍后再试',
    duplicateMessage: '请勿重复提交相同反馈',
  },
  schoolSubmission: {
    cooldownMs: 5 * 60 * 1000,
    windowMs: 24 * 60 * 60 * 1000,
    duplicateWindowMs: 24 * 60 * 60 * 1000,
    maxSubmissions: 3,
    cooldownMessage: '请稍后再提交学校申请',
    quotaMessage: '学校申请提交过于频繁，请明天再试',
    duplicateMessage: '请勿重复提交相同学校申请',
  },
}

export function getClientAbuseHeader() {
  const openidToken = getStoredOpenidAbuseToken()

  return {
    'x-cschedule-client-id': getClientId(),
    ...(openidToken ? { 'x-cschedule-openid-token': openidToken } : {}),
  }
}

export function getStoredOpenidAbuseToken() {
  const token = Taro.getStorageSync(OPENID_ABUSE_TOKEN_KEY)

  return typeof token === 'string' ? token : ''
}

export function setStoredOpenidAbuseToken(token: string) {
  const cleanToken = String(token || '').trim()

  if (!cleanToken) {
    return
  }

  Taro.setStorageSync(OPENID_ABUSE_TOKEN_KEY, cleanToken)
}

export function assertClientCanSubmit(kind: keyof typeof RULES, values: unknown[]) {
  const rule = RULES[kind]
  const now = Date.now()
  const fingerprint = getFingerprint(values)
  const record = getGuardRecord(kind, rule, now)
  const lastSubmittedAt = record.submittedAt[record.submittedAt.length - 1] ?? 0

  if (now - lastSubmittedAt < rule.cooldownMs) {
    throw new Error(rule.cooldownMessage)
  }

  if (record.submittedAt.length >= rule.maxSubmissions) {
    throw new Error(rule.quotaMessage)
  }

  const duplicatedAt = record.fingerprints[fingerprint] ?? 0

  if (duplicatedAt && now - duplicatedAt < rule.duplicateWindowMs) {
    throw new Error(rule.duplicateMessage)
  }
}

export function markClientSubmitted(kind: keyof typeof RULES, values: unknown[]) {
  const rule = RULES[kind]
  const now = Date.now()
  const fingerprint = getFingerprint(values)
  const record = getGuardRecord(kind, rule, now)

  record.submittedAt.push(now)
  record.fingerprints[fingerprint] = now
  Taro.setStorageSync(getRecordKey(kind), record)
}

function getClientId() {
  const existing = Taro.getStorageSync(CLIENT_ID_KEY)

  if (typeof existing === 'string' && existing) {
    return existing
  }

  const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  Taro.setStorageSync(CLIENT_ID_KEY, clientId)
  return clientId
}

function getGuardRecord(kind: keyof typeof RULES, rule: GuardRule, now: number): GuardRecord {
  const value = Taro.getStorageSync(getRecordKey(kind))
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<GuardRecord>)
    : {}
  const submittedAt = Array.isArray(source.submittedAt)
    ? source.submittedAt.filter(
        (item): item is number => typeof item === 'number' && now - item <= rule.windowMs,
      )
    : []
  const fingerprints: Record<string, number> = {}
  const sourceFingerprints = source.fingerprints && typeof source.fingerprints === 'object'
    ? source.fingerprints
    : {}

  for (const [fingerprint, submittedAtValue] of Object.entries(sourceFingerprints)) {
    if (
      typeof submittedAtValue === 'number' &&
      now - submittedAtValue <= rule.duplicateWindowMs
    ) {
      fingerprints[fingerprint] = submittedAtValue
    }
  }

  return { submittedAt, fingerprints }
}

function getRecordKey(kind: keyof typeof RULES) {
  return `${RECORD_PREFIX}${kind}`
}

function getFingerprint(values: unknown[]) {
  return values.map((value) => normalizeValue(value)).join('\n')
}

function normalizeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .filter(Boolean)
      .sort()
      .join(',')
  }

  return String(value || '').trim().toLowerCase().slice(0, 1000)
}
