import Taro from '@tarojs/taro'

import { setStoredOpenidAbuseToken } from '../abuse-guard'
import { requestApi } from './client'

interface WechatSessionResponse {
  abuseToken: string
  expiresIn: number
}

let pendingSession: Promise<void> | null = null

export function initWechatAbuseSession() {
  if (pendingSession) {
    return pendingSession
  }

  pendingSession = loginWithWechat()
    .then((code) => requestApi<WechatSessionResponse, { code: string }>({
      method: 'POST',
      path: '/wechat/session',
      data: { code },
    }))
    .then((response) => {
      setStoredOpenidAbuseToken(response.abuseToken)
    })
    .catch((error) => {
      console.warn('Failed to initialize WeChat abuse session.', error)
    })
    .finally(() => {
      pendingSession = null
    })

  return pendingSession
}

function loginWithWechat() {
  return new Promise<string>((resolve, reject) => {
    Taro.login({
      success(result) {
        if (result.code) {
          resolve(result.code)
          return
        }

        reject(new Error('WECHAT_LOGIN_CODE_MISSING'))
      },
      fail(error) {
        reject(new Error(String(error?.errMsg || 'WECHAT_LOGIN_FAILED')))
      },
    })
  })
}
