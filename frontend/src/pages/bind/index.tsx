import { useEffect, useMemo, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Checkbox, Input, Text, View } from '@tarojs/components'

import { submitLogin } from '../../shared/api/auth'
import { createLoginContext, listSchools } from '../../shared/api/schools'
import { LoginContextResponse, LoginField, SchoolListItem } from '../../shared/api/types'
import { formatSchoolMeta } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { setStoredAccountId } from '../../shared/storage'

type LoginForm = Record<string, string>
type BindStep = 'select_school' | 'login'

const DEFAULT_LOGIN_FIELDS: LoginField[] = [
  {
    name: 'username',
    label: '学号',
    type: 'text',
    required: true,
    placeholder: '请输入教务系统账号',
  },
  {
    name: 'password',
    label: '密码',
    type: 'password',
    required: true,
    placeholder: '请输入教务系统密码',
  },
]

const HIDDEN_FIELD_NAMES = new Set(['contextId'])

function getVisibleFields(loginContext: LoginContextResponse | null) {
  const contextFields = loginContext ? loginContext.fields : undefined
  const fields = contextFields && contextFields.length ? contextFields : DEFAULT_LOGIN_FIELDS
  return fields.filter((field) => field.type !== 'hidden' && !HIDDEN_FIELD_NAMES.has(field.name))
}

function formatLoginMode(mode?: string) {
  if (mode === 'cas_webview' || mode === 'oauth_webview') return '网页授权'
  if (mode === 'password_captcha') return '账号密码 + 验证码'
  if (mode === 'qrcode') return '扫码登录'
  return '账号密码'
}

function decodeRouteParam(value?: string) {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getInitialSchoolFromRoute(): SchoolListItem | null {
  const params = Taro.getCurrentInstance().router?.params || {}
  const id = decodeRouteParam(params.schoolId)
  const name = decodeRouteParam(params.schoolName)

  if (!id) {
    return null
  }

  return {
    id,
    name: name || '已选择学校',
    shortName: decodeRouteParam(params.shortName) || undefined,
    city: decodeRouteParam(params.city) || undefined,
    province: decodeRouteParam(params.province) || undefined,
    level: decodeRouteParam(params.level) || undefined,
    status: (decodeRouteParam(params.status) || 'enabled') as SchoolListItem['status'],
    enabled: decodeRouteParam(params.enabled) !== 'false',
    capabilities: {
      course: true,
      score: false,
      exam: false,
      profile: false,
    },
  }
}

function getBindErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (
    message.includes('教务系统数据同步失败') ||
    message.includes('教务系统暂时无法访问') ||
    message.includes('无法定位学生课表参数') ||
    message.includes('登录后未返回有效会话')
  ) {
    return '教务系统响应不稳定，课表还没有获取完成。请保持当前页面，稍后再点一次“登录并获取课表”。'
  }

  return message || '绑定失败'
}

export default function BindPage() {
  const [schools, setSchools] = useState<SchoolListItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [selectedSchool, setSelectedSchool] = useState<SchoolListItem | null>(null)
  const [loginContext, setLoginContext] = useState<LoginContextResponse | null>(null)
  const [form, setForm] = useState<LoginForm>({})
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [contextLoading, setContextLoading] = useState(false)
  const [savePassword, setSavePassword] = useState(false)
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const [step, setStep] = useState<BindStep>('select_school')
  const requestSeq = useRef(0)
  const contextSeq = useRef(0)
  const initialSchoolApplied = useRef(false)
  const initialSchool = useRef<SchoolListItem | null>(getInitialSchoolFromRoute())
  const searchCache = useRef(new Map<string, SchoolListItem[]>())

  const visibleFields = useMemo(() => getVisibleFields(loginContext), [loginContext])
  const loginMode = loginContext ? loginContext.mode : undefined
  const isWebviewLogin = loginMode === 'cas_webview' || loginMode === 'oauth_webview'
  const credentialSave = loginContext?.credentialSave || selectedSchool?.credentialSave
  const canSavePassword = Boolean(credentialSave?.passwordVaultAllowed) && !isWebviewLogin
  const canBind = Boolean(selectedSchool) && !loading && !contextLoading

  useEffect(() => {
    const timer = setTimeout(() => {
      void searchSchools(keyword)
    }, 220)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    const routeSchool = initialSchool.current

    if (!routeSchool || initialSchoolApplied.current || selectedSchool) {
      return
    }

    const matchedSchool = schools.find((school) => school.id === routeSchool.id)
    initialSchoolApplied.current = true
    void selectSchool(matchedSchool || routeSchool, false)
  }, [schools, selectedSchool])

  async function searchSchools(value: string) {
    const text = value.trim()
    if (searchCache.current.has(text)) {
      setSchools((searchCache.current.get(text) || []).filter((school) => school.enabled))
      return
    }

    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setSearching(true)
    setErrorText('')

    try {
      const result = await listSchools({ keyword: text, limit: 30, enabledOnly: true })
      if (seq !== requestSeq.current) return
      searchCache.current.set(text, result.items)
      setSchools(result.items.filter((school) => school.enabled))
    } catch (error) {
      if (seq === requestSeq.current) {
        setErrorText(error instanceof Error ? error.message : '学校列表加载失败')
      }
    } finally {
      if (seq === requestSeq.current) setSearching(false)
    }
  }

  async function selectSchool(school: SchoolListItem, syncKeyword = true) {
    setSelectedSchool(school)
    setStep('login')
    setMessage('')
    setErrorText('')
    setLoginContext(null)
    setForm({})
    setSavePassword(false)
    if (syncKeyword) setKeyword(school.name)

    const seq = contextSeq.current + 1
    contextSeq.current = seq
    setContextLoading(true)

    try {
      const context = await createLoginContext(school.id)
      if (seq === contextSeq.current) setLoginContext(context)
    } catch (error) {
      if (seq === contextSeq.current) {
        setErrorText(error instanceof Error ? error.message : '登录配置获取失败')
      }
    } finally {
      if (seq === contextSeq.current) setContextLoading(false)
    }
  }

  function backToSchoolSelect() {
    setStep('select_school')
    setLoginContext(null)
    setForm({})
    setSavePassword(false)
    setErrorText('')
  }

  function updateField(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function validateForm() {
    for (const field of visibleFields) {
      if (field.required && !String(form[field.name] || '').trim()) {
        return `请输入${field.label}`
      }
    }
    return ''
  }

  async function bind() {
    if (!selectedSchool) {
      setErrorText('请选择学校')
      return
    }

    if (!isWebviewLogin) {
      const validationError = validateForm()
      if (validationError) {
        setErrorText(validationError)
        return
      }
    }

    setLoading(true)
    setMessage('正在登录教务系统并获取课表，可能需要十几秒，请不要重复切换页面。')
    setErrorText('')

    try {
      const context = loginContext || (await createLoginContext(selectedSchool.id))
      const result = await submitLogin(selectedSchool.id, {
        contextId: context.contextId,
        username: form.username,
        password: form.password,
        captcha: form.captcha,
        credentialSaveMode: savePassword && canSavePassword ? 'password_vault' : 'none',
        extra: Object.fromEntries(
          Object.entries(form).filter(([key]) => !['username', 'password', 'captcha'].includes(key)),
        ),
      })

      setStoredAccountId(result.accountId, selectedSchool.id)

      if (result.status === 'need_webview_fetch') {
        const webview = context.webview
        const webviewUrl = webview ? webview.url : ''

        if (webviewUrl) {
          const targets = result.requiredFetchTargets || (webview ? webview.requiredFetchTargets : undefined) || ['course']
          Taro.navigateTo({
            url:
              '/pages/webview-sync/index?accountId=' +
              encodeURIComponent(result.accountId) +
              '&schoolId=' +
              encodeURIComponent(selectedSchool.id) +
              '&contextId=' +
              encodeURIComponent(context.contextId) +
              '&url=' +
              encodeURIComponent(webviewUrl) +
              '&targets=' +
              encodeURIComponent(targets.join(',')),
          })
          return
        }

        setMessage('已创建账号，请继续完成学校网页登录。')
      } else {
        setMessage('登录成功，课表已获取。')
      }

      Taro.switchTab({ url: '/pages/index/index' })
    } catch (error) {
      setErrorText(getBindErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title='绑定账号' back subPage contentClassName='login-content'>
      <View className='login-hero'>
        <View className='hero-icon'>
          <View className='hero-icon-book' />
        </View>
        <View className='title'>绑定教务账号</View>
        <View className='subtitle'>选择学校，像登录学校官网一样输入教务系统账号密码。</View>
      </View>

      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}

      <View className='panel'>
        <View className='step-indicator'>
          <View className={'step-dot ' + (step === 'select_school' ? 'step-dot-active' : 'step-dot-done')}>
            <Text>1</Text>
          </View>
          <View className={'step-line ' + (step === 'login' ? 'step-line-active' : '')} />
          <View className={'step-dot ' + (step === 'login' ? 'step-dot-active' : '')}>
            <Text>2</Text>
          </View>
        </View>
        <View className='step-labels'>
          <Text className={'step-label ' + (step === 'select_school' ? 'step-label-active' : '')}>选择学校</Text>
          <Text className={'step-label ' + (step === 'login' ? 'step-label-active' : '')}>登录认证</Text>
        </View>

        {step === 'select_school' && (
          <View>
            <View className='field school-field'>
              <View className='label-row'>
                <Text className='label'>学校</Text>
                <Text className='field-hint'>{searching ? '正在搜索' : '已接入学校'}</Text>
              </View>
              <Input
                className='input'
                value={keyword}
                placeholder='搜索或选择学校'
                onInput={(event) => setKeyword(event.detail.value)}
              />
              <View className='school-list'>
                {schools.map((school) => {
                  const active = selectedSchool ? school.id === selectedSchool.id : false
                  return (
                    <View
                      className={'school-option ' + (active ? 'school-option-active' : '')}
                      key={school.id}
                      onClick={() => void selectSchool(school)}
                    >
                      <View className='school-option-main'>
                        <Text className='school-name'>{school.name}</Text>
                        <Text className='school-meta'>{formatSchoolMeta(school)}</Text>
                      </View>
                      {active && <View className='school-check' />}
                    </View>
                  )
                })}
                {!searching && schools.length === 0 && (
                  <View className='empty-state'>
                    <Text className='empty-title'>未找到匹配学校</Text>
                    <Text className='empty-desc'>当前仅显示已接入的学校</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {step === 'login' && selectedSchool && (
          <View>
            <View className='selected-school-bar'>
              <View>
                <Text className='selected-school-name'>{selectedSchool.name}</Text>
                <Text className='selected-school-mode'>登录方式：{formatLoginMode(loginMode)}</Text>
              </View>
              <View className='change-school-btn' onClick={backToSchoolSelect}>
                <Text>更换</Text>
              </View>
            </View>

            {contextLoading && <View className='status'>正在加载登录表单...</View>}

            {!contextLoading &&
              !isWebviewLogin &&
              visibleFields.map((field) => (
                <View className='field' key={field.name}>
                  <View className='label-row'>
                    <Text className='label'>{field.label}</Text>
                    <Text className='field-hint'>{field.required ? '必填' : '选填'}</Text>
                  </View>
                  <Input
                    className='input'
                    password={field.type === 'password'}
                    value={form[field.name] || ''}
                    placeholder={field.placeholder || `请输入${field.label}`}
                    onInput={(event) => updateField(field.name, event.detail.value)}
                  />
                </View>
              ))}

            {!contextLoading && credentialSave && (
              <View className='credential-save-card'>
                <View className='credential-save-title'>
                  {credentialSave.title || '保存登录信息'}
                </View>
                <View className='credential-save-desc'>{credentialSave.notice}</View>
                {canSavePassword && (
                  <View
                    className='credential-save-option'
                    onClick={() => setSavePassword((value) => !value)}
                  >
                    <Checkbox
                      value='password_vault'
                      checked={savePassword}
                    />
                    <Text>{credentialSave.consentLabel}</Text>
                  </View>
                )}
              </View>
            )}

            {!contextLoading && (
              <Button className='button' disabled={!canBind} loading={loading} onClick={bind}>
                {loading ? '正在获取课表...' : '登录并获取课表'}
              </Button>
            )}
          </View>
        )}
      </View>

      <View className='security-card'>
        <View className='security-icon' />
        <View>
          <View className='security-title'>安全说明</View>
          <View className='note'>
            未勾选保存时，账号密码仅用于本次登录。勾选保存时，账号密码会加密保存，仅用于后续同步教务数据。
          </View>
        </View>
      </View>
    </PageShell>
  )
}
