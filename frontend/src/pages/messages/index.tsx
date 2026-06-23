import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'

import { getNotifications, PendingNotification } from '../../shared/api/notifications'
import { PageShell } from '../../shared/layout'
import { getStoredAccountId } from '../../shared/storage'

function formatMessageTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function getMessageTypeLabel(targetType?: string) {
  return targetType === 'user' ? '个人消息' : '平台通知'
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<PendingNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState('')
  const [hasAccount, setHasAccount] = useState(true)

  useEffect(() => {
    void loadMessages()
  }, [])

  async function loadMessages() {
    const accountId = getStoredAccountId()

    if (!accountId) {
      setHasAccount(false)
      setMessages([])
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setErrorText('')
      const response = await getNotifications(accountId)
      setMessages(response.items)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '消息读取失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title='消息' back subPage>
      <View className='messages-page-head'>
        <Text className='messages-page-title'>消息</Text>
        <Text className='messages-page-subtitle'>查看管理员发送的个人消息和全平台通知。</Text>
      </View>
      {loading && <View className='messages-empty'>正在加载消息...</View>}
      {!loading && !hasAccount && <View className='messages-empty'>登录学校账号后可以查看消息。</View>}
      {!loading && errorText && <View className='status status-error'>{errorText}</View>}
      {!loading && hasAccount && !errorText && messages.length === 0 && (
        <View className='messages-empty'>暂无消息。</View>
      )}
      {!loading && hasAccount && !errorText && messages.length > 0 && (
        <View className='messages-list'>
          {messages.map((item) => (
            <View className='soft-card message-card' key={item.id}>
              <View className='message-card-head'>
                <View className='message-title-group'>
                  <Text className='message-type'>{getMessageTypeLabel(item.targetType)}</Text>
                  <Text className='message-title'>{item.title}</Text>
                </View>
                <Text className={item.readAt ? 'message-badge read' : 'message-badge'}>{item.readAt ? '已读' : '未读'}</Text>
              </View>
              <View className='message-content'>{item.content}</View>
              <View className='message-time'>{formatMessageTime(item.createdAt)}</View>
            </View>
          ))}
        </View>
      )}
    </PageShell>
  )
}
