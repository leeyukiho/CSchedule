import Taro, { useRouter } from '@tarojs/taro'
import { Text, View, WebView } from '@tarojs/components'

import { PageShell } from '../../shared/layout'

function decodeRouteValue(value?: string | string[]) {
  const text = Array.isArray(value) ? value[0] : value

  if (!text) {
    return ''
  }

  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

export default function QueryWebviewPage() {
  const router = useRouter()
  const title = decodeRouteValue(router.params.title) || '查询'
  const url = decodeRouteValue(router.params.url)
  const displayUrl = decodeRouteValue(router.params.displayUrl) || url

  function copyUrl() {
    if (!displayUrl) {
      return
    }

    Taro.setClipboardData({ data: displayUrl })
  }

  return (
    <PageShell title={title} back subPage>
      {url && (
        <View className='query-webview-toolbar'>
          <Text className='query-webview-url'>{displayUrl}</Text>
          <View className='query-webview-copy' onClick={copyUrl}>复制链接</View>
        </View>
      )}
      {url ? (
        <WebView src={url} />
      ) : (
        <View className='soft-card state-card'>
          <Text>缺少查询入口地址</Text>
        </View>
      )}
    </PageShell>
  )
}
