import Taro from '@tarojs/taro'

import { acceptBuddyInvite } from './api/buddies'
import {
  clearPendingBuddyInvite,
  getPendingBuddyInvite,
  setPendingBuddyInvite,
} from './storage'

export async function completePendingBuddyInvite(options: { silent?: boolean } = {}) {
  const invite = getPendingBuddyInvite()

  if (!invite?.code) {
    return false
  }

  await acceptBuddyInvite(invite.code)
  clearPendingBuddyInvite()

  if (!options.silent) {
    await Taro.showModal({
      title: '已绑定搭子',
      content: `${invite.inviterName || '对方'} 的课表已加入搭子空间，双方都可以查看彼此课表。`,
      showCancel: false,
      confirmText: '去查看',
    })
  }

  return true
}

export function rememberPendingBuddyInvite(code: string, inviterName?: string) {
  if (!code) {
    return
  }

  setPendingBuddyInvite({
    code,
    inviterName,
    acceptedAt: new Date().toISOString(),
  })
}
