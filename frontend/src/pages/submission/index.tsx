import { useState } from 'react'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import { submitSchoolAccess } from '../../shared/api/submissions'
import { PageShell } from '../../shared/layout'

export default function SubmissionPage() {
  const [schoolName, setSchoolName] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [loginUrl, setLoginUrl] = useState('')
  const [eduSystemWebsite, setEduSystemWebsite] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit() {
    if (!schoolName.trim()) {
      setErrorText('请输入学校名称')
      return
    }
    setLoading(true)
    setMessage('')
    setErrorText('')
    try {
      const result = await submitSchoolAccess({
        schoolName: schoolName.trim(),
        province: province.trim() || undefined,
        city: city.trim() || undefined,
        loginUrl: loginUrl.trim() || undefined,
        eduSystemWebsite: eduSystemWebsite.trim() || undefined,
        note: note.trim() || undefined,
        requestedTargets: ['course'],
      })
      setMessage('已提交：' + result.id)
      setSchoolName('')
      setProvince('')
      setCity('')
      setLoginUrl('')
      setEduSystemWebsite('')
      setNote('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title='学校接入申请' back subPage>
      <Text className='page-subtitle'>提交未收录学校的教务系统信息，我们将尽快调研接入。</Text>
      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}
      <View className='panel'>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>学校名称</Text>
            <Text className='field-hint'>必填</Text>
          </View>
          <Input className='input' value={schoolName} placeholder='请输入学校全称' onInput={(e) => setSchoolName(e.detail.value)} />
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>省份</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Input className='input' value={province} placeholder='如：北京市' onInput={(e) => setProvince(e.detail.value)} />
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>城市</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Input className='input' value={city} placeholder='如：北京市' onInput={(e) => setCity(e.detail.value)} />
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>教务系统登录网址</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Input className='input' value={loginUrl} placeholder='如：https://jwxt.example.edu.cn' onInput={(e) => setLoginUrl(e.detail.value)} />
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>教务系统网址</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Input className='input' value={eduSystemWebsite} placeholder='教务系统主页或统一认证入口' onInput={(e) => setEduSystemWebsite(e.detail.value)} />
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>备注说明</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Textarea className='textarea' value={note} placeholder='登录方式、教务系统类型等补充信息' onInput={(e) => setNote(e.detail.value)} />
        </View>
        <Button className='button' loading={loading} disabled={!schoolName.trim()} onClick={submit}>
          提交申请
        </Button>
      </View>
    </PageShell>
  )
}
