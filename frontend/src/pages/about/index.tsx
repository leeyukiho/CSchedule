import { Text, View } from '@tarojs/components'

import { PageShell } from '../../shared/layout'
import { useDefaultShare } from '../../shared/share'

export default function AboutPage() {
  useDefaultShare()
  return (
    <PageShell title='关于 UniLink校园' back subPage>
      <View className='about-hero'>
        <View className='about-logo'>
          <View className='logo-mark' />
        </View>
        <View>
          <View className='about-name'>UniLink校园</View>
          <View className='about-version'>Version 1.0.0</View>
        </View>
      </View>

      <View className='soft-card about-card about-security-card'>
        <View className='about-section-title'>安全与隐私</View>
        <View className='about-text'>
          我们只在你授权后同步课表、成绩、考试等教务数据，并尽量减少不必要的数据传输。
        </View>

        <View className='about-security-list'>
          <View className='about-security-item'>
            <View className='about-security-icon about-security-icon-lock' />
            <View>
              <View className='about-security-title'>加密保护</View>
              <View className='about-security-desc'>保存的敏感凭据会加密处理，不明文展示。</View>
            </View>
          </View>
          <View className='about-security-item'>
            <View className='about-security-icon about-security-icon-shield' />
            <View>
              <View className='about-security-title'>按需使用</View>
              <View className='about-security-desc'>账号信息仅用于登录教务系统和同步学习数据。</View>
            </View>
          </View>
          <View className='about-security-item'>
            <View className='about-security-icon about-security-icon-eye' />
            <View>
              <View className='about-security-title'>隐私优先</View>
              <View className='about-security-desc'>不主动公开、出售或用于无关用途。</View>
            </View>
          </View>
        </View>
      </View>

      <View className='soft-card about-list'>
        <View className='about-row'>
          <Text>数据来源</Text>
          <Text>学校教务系统</Text>
        </View>
        <View className='about-row'>
          <Text>同步方式</Text>
          <Text>用户授权后执行</Text>
        </View>
        <View className='about-row'>
          <Text>当前状态</Text>
          <Text>持续维护</Text>
        </View>
      </View>
    </PageShell>
  )
}
