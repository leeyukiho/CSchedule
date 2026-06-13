import Taro from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'

import { unbind } from '../../shared/api/bindings'
import { PageShell } from '../../shared/layout'
import { clearStoredBindingId, getStoredBindingId } from '../../shared/storage'

export default function SettingsPage() {
  async function clearCache() {
    const bindingId = getStoredBindingId()

    try {
      if (bindingId) {
        await unbind(bindingId)
      }

      clearStoredBindingId()
      Taro.showToast({ title: '已清理缓存', icon: 'success' })
      Taro.navigateTo({ url: '/pages/bind/index' })
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
            <View className='settings-title'>自动缓存</View>
            <View className='settings-desc'>课表、成绩和个人资料会缓存在本机，减少重复加载。</View>
          </View>
          <View className='small-button'>开启</View>
        </View>
        <View className='settings-row'>
          <View>
            <View className='settings-title'>本机缓存</View>
            <View className='settings-desc'>清理后需要重新登录学校官网账号。</View>
          </View>
          <Button className='small-button danger-button' onClick={clearCache}>
            清理
          </Button>
        </View>
      </View>
      <View className='settings-note'>清理缓存会解除当前绑定，并清空本机保存的绑定标识。</View>
    </PageShell>
  )
}
