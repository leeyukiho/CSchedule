import Taro from '@tarojs/taro'

const AUTH_STATE_KEY = 'cschedule.authState'

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
