import Taro, { useDidShow, useShareAppMessage } from '@tarojs/taro'

const SHARE_TITLE = 'CSchedule 课表助手'
const SHARE_PATH = '/pages/index/index'

export function useDefaultShare() {
  useDidShow(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage'],
    })
  })

  useShareAppMessage(() => ({
    title: SHARE_TITLE,
    path: SHARE_PATH,
  }))
}
