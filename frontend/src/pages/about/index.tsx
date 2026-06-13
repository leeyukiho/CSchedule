import { Text, View } from '@tarojs/components'

import { PageShell } from '../../shared/layout'

export default function AboutPage() {
  return (
    <PageShell title='关于我们' back subPage>
      <View className='about-hero'>
        <View className='about-logo'>
          <View className='logo-mark' />
        </View>
        <View>
          <View className='about-name'>课程表助手</View>
          <View className='about-version'>Version 1.0.0</View>
        </View>
      </View>
      <View className='soft-card about-card'>
        <View className='about-section-title'>服务说明</View>
        <View className='about-text'>
          项目通过学校 Provider 获取原始教务数据，解析为统一模型后写入后端缓存。小程序页面只读取缓存，不直接依赖学校系统页面仍然打开。
        </View>
      </View>
      <View className='soft-card about-card'>
        <View className='about-section-title'>数据安全</View>
        <View className='about-text'>账号密码仅用于登录学校教务系统获取数据，绑定信息由后端统一管理。</View>
      </View>
      <View className='soft-card about-list'>
        <View className='about-row'>
          <Text>适配学校</Text>
          <Text>持续扩展</Text>
        </View>
        <View className='about-row'>
          <Text>数据来源</Text>
          <Text>教务管理系统</Text>
        </View>
        <View className='about-row'>
          <Text>当前状态</Text>
          <Text>持续维护</Text>
        </View>
      </View>
    </PageShell>
  )
}
