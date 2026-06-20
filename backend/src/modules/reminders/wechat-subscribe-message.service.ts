import { Injectable, Logger } from '@nestjs/common'

interface SubscribeMessagePayload {
  touser: string
  template_id: string
  page?: string
  data: Record<string, { value: string }>
  miniprogram_state?: 'developer' | 'trial' | 'formal'
}

@Injectable()
export class WechatSubscribeMessageService {
  private readonly logger = new Logger(WechatSubscribeMessageService.name)
  private accessToken = ''
  private accessTokenExpiresAt = 0

  async send(payload: SubscribeMessagePayload, dryRun: boolean) {
    if (dryRun) {
      this.logger.log(`[dry-run] subscribe message ${payload.template_id} -> ${payload.touser}`)
      return { errcode: 0, errmsg: 'dry-run' }
    }

    const token = await this.getAccessToken()
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const result = await response.json().catch(() => ({}))

    if (!response.ok || Number(result.errcode || 0) !== 0) {
      throw new Error(`WECHAT_SUBSCRIBE_SEND_FAILED:${result.errcode || response.status}:${result.errmsg || response.statusText}`)
    }

    return result
  }

  async resolveOpenid(code: string) {
    const appid = process.env.WECHAT_APP_ID
    const secret = process.env.WECHAT_APP_SECRET

    if (!appid || !secret) {
      throw new Error('WECHAT_CONFIG_MISSING')
    }

    const response = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`,
    )
    const result = await response.json().catch(() => ({}))

    if (!response.ok || !result.openid) {
      throw new Error(`WECHAT_CODE2SESSION_FAILED:${result.errcode || response.status}:${result.errmsg || response.statusText}`)
    }

    return String(result.openid)
  }

  private async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken
    }

    const appid = process.env.WECHAT_APP_ID
    const secret = process.env.WECHAT_APP_SECRET

    if (!appid || !secret) {
      throw new Error('WECHAT_CONFIG_MISSING')
    }

    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`,
    )
    const result = await response.json().catch(() => ({}))

    if (!response.ok || !result.access_token) {
      throw new Error(`WECHAT_TOKEN_FAILED:${result.errcode || response.status}:${result.errmsg || response.statusText}`)
    }

    this.accessToken = String(result.access_token)
    this.accessTokenExpiresAt = Date.now() + Math.max(Number(result.expires_in || 7200) - 300, 60) * 1000

    return this.accessToken
  }
}
