import { useEffect, useMemo, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Checkbox, Input, Text, View } from '@tarojs/components'

import { submitLogin } from '../../shared/api/auth'
import {
  CloudCredentialCacheResult,
  CloudCredentialSyncResult,
  hasCloudCredentialSync,
  runCredentialSyncWithCloud,
} from '../../shared/api/cloud-sync'
import { createLoginContext, listSchools } from '../../shared/api/schools'
import {
  FeatureCacheResponse,
  LoginContextResponse,
  LoginField,
  AccountSessionSummary,
  ProfileData,
  SchoolListItem,
  StudentAccountSummary,
  TimetableCacheResponse,
} from '../../shared/api/types'
import { formatSchoolMeta } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import {
  setStoredAccountId,
  setStoredAccountSummary,
  setStoredDataCache,
} from '../../shared/storage'

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
const STATUS_CLEAR_DELAY_MS = 3000

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
    providerId: decodeRouteParam(params.providerId) || undefined,
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
    message.includes('云函数未配置') ||
    message.includes('PROVIDER_NOT_FOUND') ||
    message.includes('SYNC_INPUT_INVALID') ||
    message.includes('教务系统数据同步失败') ||
    message.includes('教务系统暂时无法访问') ||
    message.includes('无法定位学生课表参数') ||
    message.includes('登录后未返回有效会话')
  ) {
    return '教务系统响应不稳定，请进入学校页面完成首次导入，或稍后再试。'
  }

  return message || '绑定失败'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function createCachedOnlySession(): AccountSessionSummary {
  return {
    sessionReusable: false,
    sessionRefreshable: false,
    accountStatus: 'cached_only',
  }
}

function getCacheResult(
  cacheResults: CloudCredentialSyncResult['cacheResults'],
  target: 'course' | 'profile',
) {
  return cacheResults.find((item) => item.target === target)
}

function createClientCacheData(
  accountId: string,
  school: SchoolListItem,
  cacheResult: CloudCredentialCacheResult,
): TimetableCacheResponse | FeatureCacheResponse | null {
  const cacheData = isRecord(cacheResult.cacheData) ? cacheResult.cacheData : {}
  const providerId = school.providerId || school.id
  const base = {
    accountId,
    schoolId: school.id,
    providerId,
    termId: getText(cacheResult.termId) || getText(cacheData.termId),
    sourceHash: getText(cacheResult.sourceHash) || getText(cacheData.sourceHash),
    syncedAt: getText(cacheResult.syncedAt) || getText(cacheData.syncedAt),
    session: createCachedOnlySession(),
  }

  if (cacheResult.target === 'course') {
    if (!Array.isArray(cacheData.courses)) {
      return null
    }

    return {
      ...base,
      courses: cacheData.courses as TimetableCacheResponse['courses'],
      terms: Array.isArray(cacheData.terms) ? cacheData.terms : [],
      sectionTimes: Array.isArray(cacheData.sectionTimes) ? cacheData.sectionTimes : [],
    }
  }

  if (!['score', 'exam', 'profile'].includes(cacheResult.target)) {
    return null
  }

  return {
    ...base,
    target: cacheResult.target,
    data: 'data' in cacheData ? cacheData.data : null,
    meta: cacheData.meta ?? {},
  } as FeatureCacheResponse
}

function persistLoginCache(
  accountId: string,
  cacheData?: TimetableCacheResponse | FeatureCacheResponse,
) {
  if (!cacheData) {
    return
  }

  if ('courses' in cacheData) {
    const timetable = {
      ...(cacheData as TimetableCacheResponse),
      accountId,
    }

    setStoredDataCache(accountId, 'timetable', timetable, {
      sourceHash: timetable.sourceHash,
      syncedAt: timetable.syncedAt,
    })

    if (timetable.termId) {
      setStoredDataCache(accountId, 'timetable', timetable, {
        termId: timetable.termId,
        sourceHash: timetable.sourceHash,
        syncedAt: timetable.syncedAt,
      })
    }

    return
  }

  const feature = {
    ...(cacheData as FeatureCacheResponse),
    accountId,
  }

  if (!isRecord(feature) || !['score', 'exam', 'profile'].includes(String(feature.target))) {
    return
  }

  setStoredDataCache(accountId, feature.target, feature, {
    termId: feature.termId,
    sourceHash: feature.sourceHash,
    syncedAt: feature.syncedAt,
  })
}

function persistCloudCache(
  accountId: string,
  school: SchoolListItem,
  cacheResults: NonNullable<CloudCredentialSyncResult['cacheResults']>,
) {
  const savedCaches: Array<TimetableCacheResponse | FeatureCacheResponse> = []

  for (const cacheResult of cacheResults) {
    const cacheData = createClientCacheData(accountId, school, cacheResult)

    if (!cacheData) {
      continue
    }

    persistLoginCache(accountId, cacheData)
    savedCaches.push(cacheData)
  }

  return savedCaches
}

function getSavedCacheData(
  cacheData: Array<TimetableCacheResponse | FeatureCacheResponse>,
  target: 'course' | 'profile',
) {
  if (target === 'course') {
    return cacheData.find((item) => 'courses' in item)
  }

  return cacheData.find((item) => {
    return !('courses' in item) && item.target === target
  })
}

function buildAccountSummary(input: {
  accountId: string
  school: SchoolListItem
  credentialSaveMode?: StudentAccountSummary['credentialSaveMode']
  syncStrategy?: StudentAccountSummary['syncStrategy']
  cacheData?: TimetableCacheResponse | FeatureCacheResponse
  profileCacheData?: TimetableCacheResponse | FeatureCacheResponse
}): StudentAccountSummary {
  const session = input.cacheData?.session
  const profile = input.profileCacheData as FeatureCacheResponse<ProfileData> | undefined

  return {
    id: input.accountId,
    schoolId: input.school.id,
    providerId: input.school.providerId || input.cacheData?.providerId || input.school.id,
    displayName: getText(profile?.data?.name),
    status: session?.accountStatus || 'cached_only',
    credentialSaveMode: input.credentialSaveMode,
    sessionReusable: Boolean(session?.sessionReusable),
    sessionRefreshable: Boolean(session?.sessionRefreshable),
    sessionExpireAt: session?.sessionExpireAt,
    lastCachedAt: input.cacheData?.syncedAt,
    syncStrategy: input.syncStrategy,
    school: {
      id: input.school.id,
      name: input.school.name,
      shortName: input.school.shortName,
    },
  }
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

  const visibleFields = useMemo(() => getVisibleFields(loginContext), [loginContext])
  const loginMode = loginContext ? loginContext.mode : undefined
  const isExternalWebviewLogin = loginMode === 'cas_webview' || loginMode === 'oauth_webview'
  const syncStrategy = loginContext?.syncStrategy || selectedSchool?.syncStrategy
  const isPasswordServerImport = syncStrategy?.importMode === 'password_server'
  const credentialSave = loginContext?.credentialSave || selectedSchool?.credentialSave
  const canSaveForAutoSync =
    credentialSave?.autoSync === 'password_login' ||
    credentialSave?.autoSync === 'password_login_may_need_verification'
  const canSavePassword =
    Boolean(credentialSave?.passwordVaultAllowed) &&
    canSaveForAutoSync &&
    !isExternalWebviewLogin
  const wantsPasswordVault = canSavePassword && savePassword
  const shouldCollectCredentials =
    isPasswordServerImport ||
    wantsPasswordVault
  const credentialFields = useMemo(
    () => visibleFields.filter((field) => field.name === 'username' || field.name === 'password'),
    [visibleFields],
  )
  const canBind = Boolean(selectedSchool) && !loading && !contextLoading
  const bindButtonText = loading
    ? isPasswordServerImport
      ? '正在导入...'
      : '正在进入学校页面...'
    : isPasswordServerImport
      ? '登录并导入'
      : '进入学校页面导入'

  useEffect(() => {
    const timer = setTimeout(() => {
      void searchSchools(keyword)
    }, 220)
    return () => clearTimeout(timer)
  }, [keyword])

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

    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setSearching(true)
    setErrorText('')

    try {
      const result = await listSchools({ keyword: text, limit: 30, enabledOnly: true })
      if (seq !== requestSeq.current) return
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
      if (seq === contextSeq.current) {
        setLoginContext(context)
        setSavePassword(false)
      }
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
    for (const field of credentialFields) {
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

    if (shouldCollectCredentials) {
      const validationError = validateForm()
      if (validationError) {
        setErrorText(validationError)
        return
      }
    }

    setLoading(true)
    setMessage(isPasswordServerImport ? '正在导入课表。' : '正在登录。')
    setErrorText('')

    try {
      const context = loginContext || (await createLoginContext(selectedSchool.id))

      if (context.syncStrategy?.importMode === 'password_server') {
        const cloudFunction = context.syncStrategy.cloudFunctions?.course

        if (!hasCloudCredentialSync(cloudFunction)) {
          throw new Error('暂时无法导入该学校。')
        }

        const cloudResult = await runCredentialSyncWithCloud({
          schoolId: selectedSchool.id,
          providerId: selectedSchool.providerId || selectedSchool.id,
          target: 'course',
          username: form.username,
          password: form.password,
          cloudFunction,
        })

        const primaryCourseResult = getCacheResult(cloudResult.cacheResults, 'course')

        if (
          !primaryCourseResult ||
          !isRecord(primaryCourseResult.cacheData) ||
          !Array.isArray(primaryCourseResult.cacheData.courses)
        ) {
          throw new Error('课表导入失败，请稍后再试。')
        }

        setMessage('正在保存账号。')

        const cloudWarnings = cloudResult.cacheResults.flatMap((item) => item.warnings || [])
        const result = await submitLogin(selectedSchool.id, {
          contextId: context.contextId,
          username: form.username,
          password: wantsPasswordVault ? form.password : undefined,
          credentialSaveMode:
            wantsPasswordVault ? 'password_vault' : 'none',
          verifiedByCloud: true,
          cacheResults: cloudResult.cacheResults,
          ...(cloudWarnings.length ? { cloudWarnings } : {}),
        })

        setStoredAccountId(result.accountId, selectedSchool.id)
        const savedCaches = persistCloudCache(
          result.accountId,
          selectedSchool,
          cloudResult.cacheResults,
        )
        const savedCourseCache = getSavedCacheData(savedCaches, 'course')
        const savedProfileCache = getSavedCacheData(savedCaches, 'profile')

        if (!savedCourseCache) {
          throw new Error('课表导入失败，请稍后再试。')
        }

        setStoredAccountSummary(
          buildAccountSummary({
            accountId: result.accountId,
            school: selectedSchool,
            credentialSaveMode: wantsPasswordVault ? 'password_vault' : 'none',
            syncStrategy: context.syncStrategy,
            cacheData: savedCourseCache,
            profileCacheData: savedProfileCache,
          }),
        )
        setMessage('登录成功，数据已获取。')
        Taro.switchTab({ url: '/pages/index/index' })
        return
      }

      const result = await submitLogin(selectedSchool.id, {
        contextId: context.contextId,
        username: undefined,
        password: undefined,
        credentialSaveMode: 'none',
      })

      setStoredAccountId(result.accountId, selectedSchool.id)

      if (result.status === 'need_webview_fetch') {
        const webview = context.webview
        const webviewUrl = webview ? webview.url : ''

        if (!webviewUrl || webviewUrl === 'about:blank') {
          throw new Error('暂时无法导入该学校。')
        }

        const targets = (webview ? webview.requiredFetchTargets : undefined) || result.requiredFetchTargets || ['course']
        Taro.navigateTo({
          url:
            '/pages/webview-sync/index?accountId=' +
            encodeURIComponent(result.accountId) +
            '&schoolId=' +
            encodeURIComponent(selectedSchool.id) +
            '&schoolName=' +
            encodeURIComponent(selectedSchool.name) +
            '&shortName=' +
            encodeURIComponent(selectedSchool.shortName || '') +
            '&providerId=' +
            encodeURIComponent(selectedSchool.providerId || selectedSchool.id) +
            '&contextId=' +
            encodeURIComponent(context.contextId) +
            '&url=' +
            encodeURIComponent(webviewUrl) +
            '&targets=' +
            encodeURIComponent(targets.join(',')),
        })
        return
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
              shouldCollectCredentials &&
              credentialFields.map((field) => (
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
                    onClick={() =>
                      setSavePassword((value) => !value)
                    }
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
                {bindButtonText}
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
            支持自动同步的学校可保存登录信息，用于后续更新课表。网页登录的学校不会保存账号密码。
          </View>
        </View>
      </View>
    </PageShell>
  )
}
