import { useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'

import { submitFeedback } from '../../shared/api/feedback'
import { PageShell } from '../../shared/layout'
import { getStoredBindingId } from '../../shared/storage'

export default function FeedbackPage() {
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    setLoading(true)
    setMessage('')
    setErrorText('')

    try {
      const result = await submitFeedback({
        bindingId: getStoredBindingId() || undefined,
        content,
        contact,
      })
      setContent('')
      setContact('')
      setMessage(`已提交：${result.id}`)
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
      <View className='soft-card feedback-card'>
        <View className='field'>
          <Text className='label'>反馈内容</Text>
          <Textarea
            className='textarea'
            value={content}
            maxlength={500}
            placeholder='请描述遇到的问题或建议'
            onInput={(event) => setContent(event.detail.value)}
          />
          <View className='counter'>{content.length}/500</View>
        </View>
        <View className='field'>
          <Text className='label'>联系方式</Text>
          <Input className='input' value={contact} placeholder='选填，便于后续联系' onInput={(event) => setContact(event.detail.value)} />
        </View>
        <Button className='submit-button' loading={loading} onClick={submit}>
          提交反馈
        </Button>
      </View>
    </PageShell>
  )
}
