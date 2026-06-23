import { useEffect, useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'

import { submitFeedback } from '../../shared/api/feedback'
import { PageShell } from '../../shared/layout'
import { getStoredAccountId } from '../../shared/storage'

const STATUS_CLEAR_DELAY_MS = 3000

export default function FeedbackPage() {
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!message && !errorText) {
      return undefined
    }

    const timer = setTimeout(() => {
      setMessage('')
      setErrorText('')
    }, STATUS_CLEAR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [message, errorText])

  async function submit() {
    setLoading(true)
    setMessage('')
    setErrorText('')

    try {
      const result = await submitFeedback({
        accountId: getStoredAccountId() || undefined,
        content,
        contact,
      })
      setContent('')
      setContact('')
      setMessage('反馈已提交')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '反馈提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title='意见反馈' back subPage>
      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}
      <View className='feedback-page-head'>
        <View className='feedback-title'>意见反馈</View>
        <View className='feedback-subtitle'>问题、建议或课程数据异常都可以告诉我们。</View>
      </View>
      <View className='feedback-form'>
        <View className='feedback-field'>
          <View className='feedback-label-row'>
            <Text className='label'>反馈内容</Text>
            <Text className='field-hint'>必填</Text>
          </View>
          <Textarea
            className='feedback-textarea'
            value={content}
            maxlength={500}
            placeholder='请描述遇到的问题或建议。'
            placeholderClass='feedback-placeholder'
            onInput={(event) => setContent(event.detail.value)}
          />
          <View className='counter'>{content.length}/500</View>
        </View>
        <View className='feedback-field'>
          <View className='feedback-label-row'>
            <Text className='label'>联系方式</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Input
            className='feedback-input'
            value={contact}
            placeholder='微信、QQ 或邮箱'
            placeholderClass='feedback-placeholder'
            onInput={(event) => setContact(event.detail.value)}
          />
        </View>
        <Button
          className='submit-button'
          loading={loading}
          disabled={loading || !content.trim()}
          onClick={submit}
        >
          提交反馈
        </Button>
      </View>
    </PageShell>
  )
}
