import Taro from '@tarojs/taro'

const AUTH_STATE_KEY = 'cschedule.authState'
const TERM_STARTS_KEY = 'cschedule.termStarts'

export interface StoredAuthState {
  accountId: string
  schoolId: string
  updatedAt: string
}

function normalizeAuthState(value: unknown): StoredAuthState {
  const state = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<StoredAuthState>)
    : {}

  const accountId = typeof state.accountId === 'string' ? state.accountId : ''

  if (accountId && typeof state.schoolId === 'string') {
    return {
      accountId,
      schoolId: state.schoolId,
      updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : '',
    }
  }

  return { accountId: '', schoolId: '', updatedAt: '' }
}

export function getStoredAuthState(): StoredAuthState {
  return normalizeAuthState(Taro.getStorageSync(AUTH_STATE_KEY))
}

export function getStoredAccountId() {
  return getStoredAuthState().accountId
}

export function setStoredAccountId(accountId: string, schoolId = '') {
  Taro.setStorageSync(AUTH_STATE_KEY, {
    accountId,
    schoolId,
    updatedAt: new Date().toISOString(),
  })
}

export function clearStoredAccountId() {
  Taro.removeStorageSync(AUTH_STATE_KEY)
}

function normalizeTermStarts(value: unknown): Record<string, string> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
  const result: Record<string, string> = {}

  for (const [key, date] of Object.entries(source)) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result[key] = date
    }
  }

  return result
}

export function getStoredTermStarts() {
  return normalizeTermStarts(Taro.getStorageSync(TERM_STARTS_KEY))
}

export function setStoredTermStart(termId: string, startDate: string) {
  const starts = getStoredTermStarts()

  if (!termId) {
    return
  }

  if (startDate) {
    starts[termId] = startDate
  } else {
    delete starts[termId]
  }

  Taro.setStorageSync(TERM_STARTS_KEY, starts)
}

export function clearStoredTermStarts() {
  Taro.removeStorageSync(TERM_STARTS_KEY)
}
