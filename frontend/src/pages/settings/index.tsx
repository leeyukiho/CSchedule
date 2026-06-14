import Taro from '@tarojs/taro'
import { Button, View } from '@tarojs/components'

import { deactivateAccount } from '../../shared/api/accounts'
import { PageShell } from '../../shared/layout'
import { clearStoredAccountId, getStoredAccountId } from '../../shared/storage'

export default function SettingsPage() {
  async function clearCache() {
    const accountId = getStoredAccountId()

    try {
      if (accountId) {
        await deactivateAccount(accountId)
      }

      clearStoredAccountId()
      Taro.showToast({ title: '已清理缓存', icon: 'success' })
      Taro.switchTab({ url: '/pages/profile/index' })
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '清理失败',
        icon: 'none',
      })
    }
  }

  return (
    <PageShell title='设置' back subPage>
      <View className='soft-card settings-card'>
        <View className='settings-row'>
          <View>
            <View className='settings-title'>清理缓存</View>
            <View className='settings-desc'>清理后需要重新登录学校官网账号。</View>
          </View>
          <Button className='small-button danger-button' onClick={clearCache}>
            清理
          </Button>
        </View>
      </View>
      <View className='settings-note'>清理缓存会退出当前账号，并清空本机保存的登录状态。</View>
    </PageShell>
  )
}
