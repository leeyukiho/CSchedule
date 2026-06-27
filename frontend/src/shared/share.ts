import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import shareCardImage from '../assets/share-card.jpg'

const SHARE_TITLE = 'UniLink校园'
const SHARE_PATH = '/pages/index/index'
const SHARE_QUERY = 'from=share'

export function useDefaultShare() {
  useDidShow(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      showShareItems: ['shareAppMessage', 'shareTimeline'],
    })
  })

  useShareAppMessage(() => ({
    title: SHARE_TITLE,
    path: SHARE_PATH,
    imageUrl: shareCardImage,
  }))

  useShareTimeline(() => ({
    title: SHARE_TITLE,
    query: SHARE_QUERY,
    imageUrl: shareCardImage,
  }))
}
