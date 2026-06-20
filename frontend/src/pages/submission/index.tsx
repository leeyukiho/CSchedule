import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components'
import { submitSchoolAccess } from '../../shared/api/submissions'
import { PageShell } from '../../shared/layout'

const STATUS_CLEAR_DELAY_MS = 3000
const EXTRA_VERIFICATION_OPTIONS = ['不需要', '需要验证码或短信', '需要扫码或校内验证', '不确定']
const ADAPTATION_HELP_OPTIONS = ['愿意沟通', '先了解，愿意等', '暂不方便']
const CONTACT_REQUIRED_ADAPTATION_HELP_INDEX = 0

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
  const [eduSystemWebsite, setEduSystemWebsite] = useState('')
  const [contact, setContact] = useState('')
  const [extraVerificationIndex, setExtraVerificationIndex] = useState(-1)
  const [adaptationHelpIndex, setAdaptationHelpIndex] = useState(0)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const [loading, setLoading] = useState(false)
  const isContactRequired = adaptationHelpIndex === CONTACT_REQUIRED_ADAPTATION_HELP_INDEX
  const canSubmit = Boolean(
    schoolName.trim() &&
    eduSystemWebsite.trim() &&
    extraVerificationIndex >= 0 &&
    (!isContactRequired || contact.trim()),
  )

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
    if (!eduSystemWebsite.trim()) {
      setErrorText('请输入教务系统网址')
      return
    }
    if (extraVerificationIndex < 0) {
      setErrorText('请选择除账号密码外是否需要验证')
      return
    }
    if (isContactRequired && !contact.trim()) {
      setErrorText('请填写联系方式，方便后续沟通适配进度')
      return
    }
    setLoading(true)
    setMessage('')
    setErrorText('')
    try {
      await submitSchoolAccess({
        schoolName: schoolName.trim(),
        eduSystemWebsite: eduSystemWebsite.trim(),
        note: [
          `除账号密码外的验证：${EXTRA_VERIFICATION_OPTIONS[extraVerificationIndex]}`,
          `是否愿意协助首个接入适配：${ADAPTATION_HELP_OPTIONS[adaptationHelpIndex]}（不需要在此填写真实账号密码）`,
          note.trim() ? `备注：${note.trim()}` : '',
          contact.trim() ? `联系方式：${contact.trim()}` : '',
        ].filter(Boolean).join('\n') || undefined,
        requestedTargets: ['course'],
      })
      setMessage('提交成功，我们会尽快评估接入信息。')
      setSchoolName('')
      setEduSystemWebsite('')
      setContact('')
      setExtraVerificationIndex(-1)
      setAdaptationHelpIndex(0)
      setNote('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title='学校接入申请' back subPage>
      <Text className='page-subtitle'>提交学校和教务系统信息，方便后续评估接入。</Text>
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
            <Text className='label'>教务系统网址</Text>
            <Text className='field-hint'>必填</Text>
          </View>
          <Input className='input' value={eduSystemWebsite} placeholder='教务系统主页或统一认证入口' onInput={(e) => setEduSystemWebsite(e.detail.value)} />
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>除账号密码外是否需要验证</Text>
            <Text className='field-hint'>必填</Text>
          </View>
          <Picker
            mode='selector'
            range={EXTRA_VERIFICATION_OPTIONS}
            value={extraVerificationIndex >= 0 ? extraVerificationIndex : 0}
            onChange={(e) => setExtraVerificationIndex(Number(e.detail.value))}
          >
            <View className='submission-picker'>
              <Text>{extraVerificationIndex >= 0 ? EXTRA_VERIFICATION_OPTIONS[extraVerificationIndex] : '请选择'}</Text>
              <View className='submission-picker-arrow' />
            </View>
          </Picker>
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>是否愿意协助首个适配</Text>
            <Text className='field-hint'>不填账号密码</Text>
          </View>
          <Picker
            mode='selector'
            range={ADAPTATION_HELP_OPTIONS}
            value={adaptationHelpIndex}
            onChange={(e) => setAdaptationHelpIndex(Number(e.detail.value))}
          >
            <View className='submission-picker'>
              <Text>{ADAPTATION_HELP_OPTIONS[adaptationHelpIndex]}</Text>
              <View className='submission-picker-arrow' />
            </View>
          </Picker>
          <Text className='submission-tip'>这里只记录意向，后续如需协助会再联系确认。</Text>
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>备注说明</Text>
            <Text className='field-hint'>选填</Text>
          </View>
          <Textarea
            className='textarea submission-note-textarea'
            value={note}
            placeholder='可补充申请原因、已知限制或其他说明'
            placeholderClass='submission-note-placeholder'
            maxlength={300}
            onInput={(e) => setNote(e.detail.value)}
          />
        </View>
        <View className='field'>
          <View className='label-row'>
            <Text className='label'>联系方式</Text>
            <Text className='field-hint'>{isContactRequired ? '必填' : '选填'}</Text>
          </View>
          <Input className='input' value={contact} placeholder='手机号、微信或邮箱' onInput={(e) => setContact(e.detail.value)} />
        </View>
        <Button className='button submission-submit-button' loading={loading} disabled={!canSubmit} onClick={submit}>
          提交申请
        </Button>
      </View>
    </PageShell>
  )
}
