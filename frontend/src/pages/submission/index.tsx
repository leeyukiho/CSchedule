import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Text, Textarea, View } from '@tarojs/components'
import { submitSchoolAccess } from '../../shared/api/submissions'
import { PageShell } from '../../shared/layout'

const STATUS_CLEAR_DELAY_MS = 3000

function decodeRouteParam(value?: string) {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default function SubmissionPage() {
  const routeParams = Taro.getCurrentInstance().router?.params || {}
  const [schoolName, setSchoolName] = useState(() => decodeRouteParam(routeParams.schoolName))
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [loginUrl, setLoginUrl] = useState('')
  const [eduSystemWebsite, setEduSystemWebsite] = useState('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
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
        note: [
          contact.trim() ? `联系方式：${contact.trim()}` : '',
          note.trim() ? `备注：${note.trim()}` : '',
        ].filter(Boolean).join('\n') || undefined,
        requestedTargets: ['course'],
      })
      setMessage('已提交：' + result.id)
      setSchoolName('')
      setProvince('')
      setCity('')
      setLoginUrl('')
      setEduSystemWebsite('')
      setContact('')
      setNote('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title='学校接入申请' back subPage>
      <Text className='page-subtitle'>提交学校和联系方式，管理员会主动联系你确认接入信息。</Text>
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
            <Text className='label'>联系方式</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Input className='input' value={contact} placeholder='手机号、微信或邮箱' onInput={(e) => setContact(e.detail.value)} />
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
