import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Text, View } from '@tarojs/components'

import { getBinding, unbind } from '../../shared/api/bindings'
import { createManualSync } from '../../shared/api/sync'
import { BindingSummary } from '../../shared/api/types'
import { formatTime } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { clearStoredBindingId, getStoredBindingId } from '../../shared/storage'

function formatBindingStatus(status?: BindingSummary['status']) {
  if (status === 'unbound' || status === 'disabled') {
    return '未绑定'
  }

  return status ? '已绑定' : 'unknown'
}

export default function ProfilePage() {
  const [binding, setBinding] = useState<BindingSummary | null>(null)
  const [syncUsername, setSyncUsername] = useState('')
  const [syncPassword, setSyncPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    const bindingId = getStoredBindingId()

    if (!bindingId) {
      setErrorText('请先绑定学校账号')
      return
    }

    void loadBinding(bindingId)
  }, [])

  async function loadBinding(bindingId: string) {
    setErrorText('')

    try {
      setBinding(await getBinding(bindingId))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '账号信息读取失败')
    }
  }

  async function handleSync() {
    if (!(binding && binding.id)) {
      Taro.navigateTo({ url: '/pages/bind/index' })
      return
    }

    if (!syncUsername.trim() || !syncPassword) {
      setErrorText('请输入教务系统账号和密码')
      return
    }

    setLoading(true)
    setMessage('')
    setErrorText('')

    try {
      const job = await createManualSync(binding.id, 'course', {
        username: syncUsername.trim(),
        password: syncPassword,
      })
      setMessage(job.status === 'success' ? '课表已同步' : `同步状态：${job.status}`)
      setSyncPassword('')
      await loadBinding(binding.id)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '同步失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleUnbind() {
    if (!(binding && binding.id)) {
      return
    }

    try {
      await unbind(binding.id)
      clearStoredBindingId()
      setMessage('已退出绑定')
      Taro.navigateTo({ url: '/pages/bind/index' })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '退出绑定失败')
    }
  }

  return (
    <PageShell title='个人' activeTab='profile'>
      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}

      <View className='profile-card'>
        <View className='avatar-button'>
          <View className='avatar' />
        </View>
        <View>
          <View className='profile-name'>{binding && binding.displayName ? binding.displayName : '课程表用户'}</View>
          <View className='profile-line'>学校：{(binding && binding.school && binding.school.name) || '未绑定学校'}</View>
          <View className='profile-meta-row'>
            <Text className='profile-meta'>状态：{formatBindingStatus(binding ? binding.status : undefined)}</Text>
          </View>
          <View className='profile-line'>上次获取：{formatTime(binding ? binding.lastCachedAt : undefined)}</View>
        </View>
        <View className='profile-arrow' />
      </View>

      <View className='soft-card info-panel'>
        <View className='panel-title'>基本信息</View>
        <View className='info-row'>
          <Text>绑定状态</Text>
          <Text className='info-value'>{formatBindingStatus(binding ? binding.status : undefined)}</Text>
        </View>
        <View className='info-row'>
          <Text>学校</Text>
          <Text className='info-value'>{(binding && binding.school && binding.school.name) || '未绑定'}</Text>
        </View>
        <View className='info-row'>
          <Text>课表缓存</Text>
          <Text className='info-value'>{formatTime(binding ? binding.lastCachedAt : undefined)}</Text>
        </View>
      </View>

      {binding && binding.id && (
        <View className='soft-card feedback-card card-gap'>
          <Text className='item-title'>手动同步课表</Text>
          <Text className='item-meta'>像登录学校官网一样输入教务系统账号密码。</Text>
          <View className='field field-gap'>
            <Input
              className='input'
              value={syncUsername}
              placeholder='教务系统账号'
              onInput={(event) => setSyncUsername(event.detail.value)}
            />
          </View>
          <View className='field field-gap'>
            <Input
              className='input'
              password
              type='password'
              value={syncPassword}
              placeholder='教务系统密码'
              onInput={(event) => setSyncPassword(event.detail.value)}
            />
          </View>
          <Button className='button' loading={loading} onClick={handleSync}>
            同步课表
          </Button>
        </View>
      )}

      <View className='soft-card action-panel'>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>
          <View className='action-icon action-refresh' />
          <Text>绑定学校账号</Text>
          <View className='row-arrow' />
        </View>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/feedback/index' })}>
          <View className='action-icon action-feedback' />
          <Text>意见反馈</Text>
          <View className='row-arrow' />
        </View>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/settings/index' })}>
          <View className='action-icon action-settings' />
          <Text>设置</Text>
          <View className='row-arrow' />
        </View>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/about/index' })}>
          <View className='action-icon action-about' />
          <Text>关于</Text>
          <View className='row-arrow' />
        </View>
        {binding && binding.id && (
          <Button className='button button-danger' onClick={handleUnbind}>
            退出绑定
          </Button>
        )}
      </View>
    </PageShell>
  )
}
