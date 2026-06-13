import Taro from '@tarojs/taro'

const BINDING_ID_KEY = 'cschedule.bindingId'
const USER_ID_KEY = 'cschedule.userId'

export function getStoredBindingId() {
  return String(Taro.getStorageSync(BINDING_ID_KEY) || '')
}

export function setStoredBindingId(bindingId: string) {
  Taro.setStorageSync(BINDING_ID_KEY, bindingId)
}

export function clearStoredBindingId() {
  Taro.removeStorageSync(BINDING_ID_KEY)
}

export function getStoredUserId() {
  return String(Taro.getStorageSync(USER_ID_KEY) || '')
}

export function setStoredUserId(userId: string) {
  Taro.setStorageSync(USER_ID_KEY, userId)
}

