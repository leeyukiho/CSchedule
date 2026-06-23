import { useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Checkbox, Input, ScrollView, Text, View } from '@tarojs/components'

import { submitLogin } from '../../shared/api/auth'
import {
  CloudCredentialSyncResult,
  hasCloudCredentialSync,
  runCredentialSyncWithCloud,
} from '../../shared/api/cloud-sync'
import { createLoginContext, listSchools, refreshSchoolTermStarts, saveSchoolTermStartsFromResponse } from '../../shared/api/schools'
import {
  FeatureCacheResponse,
  LoginContextResponse,
  LoginField,
  CloudSyncFunctionConfig,
  DataTarget,
  ProfileData,
  SchoolListItem,
  StudentAccountSummary,
  TimetableCacheResponse,
} from '../../shared/api/types'
import { formatSchoolMeta } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import {
  clearStoredDataCacheTerms,
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
const CLOUD_IMPORT_TARGETS: DataTarget[] = ['course', 'profile', 'score', 'exam']
const SCHOOL_DROPDOWN_MAX_ROWS = 5

function getVisibleFields(loginContext: LoginContextResponse | null) {
  const contextFields = loginContext ? loginContext.fields : undefined
  const fields = contextFields && contextFields.length ? contextFields : DEFAULT_LOGIN_FIELDS
  return fields.filter((field) => field.type !== 'hidden' && !HIDDEN_FIELD_NAMES.has(field.name))
}

function getWechatOpenid() {
  return new Promise<string>((resolve) => {
    Taro.login({
      success: async (result) => {
        if (!result.code) {
          resolve('')
          return
        }

        try {
          const { resolveReminderOpenid } = await import('../../shared/api/reminders')
          const response = await resolveReminderOpenid('__bind__', result.code)
          resolve(response.openid)
        } catch {
          resolve('')
        }
      },
      fail: () => resolve(''),
    })
  })
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
    loginMode: (decodeRouteParam(params.loginMode) || undefined) as SchoolListItem['loginMode'],
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

function getInitialAccountIdFromRoute() {
  const params = Taro.getCurrentInstance().router?.params || {}
  return decodeRouteParam(params.accountId)
}

function getSchoolBindUrl(school: SchoolListItem) {
  const params = [
    ['schoolId', school.id],
    ['schoolName', school.name],
    ['shortName', school.shortName],
    ['providerId', school.providerId],
    ['loginMode', school.loginMode],
    ['city', school.city],
    ['province', school.province],
    ['level', school.level],
    ['status', school.status],
    ['enabled', String(school.enabled)],
  ]
    .filter((item): item is [string, string] => Boolean(item[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return `/pages/bind/index?${params}`
}

function openSchoolSubmission() {
  Taro.navigateTo({ url: '/pages/submission/index' })
}

function getBindErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''

  if (message.includes('SYNC_INPUT_INVALID')) {
    return '同步配置异常'
  }

  if (
    message.includes('云函数未配置') ||
    message.includes('PROVIDER_NOT_FOUND') ||
    message.includes('教务系统数据同步失败') ||
    message.includes('教务系统暂时无法访问') ||
    message.includes('无法定位学生课表参数') ||
    message.includes('登录后未返回有效会话')
  ) {
    return '教务系统不稳定'
  }

  return message || '绑定失败'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isSameCloudFunction(left?: CloudSyncFunctionConfig, right?: CloudSyncFunctionConfig) {
  return Boolean(
    left &&
      right &&
      (left.functionName || '') === (right.functionName || '') &&
      (left.url || '') === (right.url || ''),
  )
}

function getSharedCloudImport(
  cloudFunctions: Partial<Record<DataTarget, CloudSyncFunctionConfig>> | undefined,
  targets: DataTarget[],
) {
  const configuredTargets = targets.filter((target) => cloudFunctions?.[target])
  const configs = configuredTargets.map((target) => cloudFunctions?.[target])
  const [first] = configs

  return first && configuredTargets.length > 0 && configs.every((config) => isSameCloudFunction(first, config))
    ? { cloudFunction: first, targets: configuredTargets }
    : undefined
}

function getCacheResult(
  cacheResults: CloudCredentialSyncResult['cacheResults'],
  target: 'course' | 'profile',
) {
  return cacheResults.find((item) => item.target === target)
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
    saveSchoolTermStartsFromResponse(timetable.schoolId, timetable.termStarts)
    clearStoredDataCacheTerms(accountId, 'timetable')

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
    sourceHash: feature.sourceHash,
    syncedAt: feature.syncedAt,
  })

  if (feature.termId) {
    setStoredDataCache(accountId, feature.target, feature, {
      termId: feature.termId,
      sourceHash: feature.sourceHash,
      syncedAt: feature.syncedAt,
    })
  }
}

function persistCloudCache(
  accountId: string,
  cacheResults: Array<{
    target: DataTarget
    cacheData: TimetableCacheResponse | FeatureCacheResponse
  }>,
) {
  const savedCaches: Array<TimetableCacheResponse | FeatureCacheResponse> = []

  for (const cacheResult of cacheResults) {
    const cacheData = cacheResult.cacheData

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

interface BindAccountPanelProps {
  subPage?: boolean
}

export function BindAccountPanel({ subPage = true }: BindAccountPanelProps) {
  const [schools, setSchools] = useState<SchoolListItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [selectedSchool, setSelectedSchool] = useState<SchoolListItem | null>(null)
  const [loginContext, setLoginContext] = useState<LoginContextResponse | null>(null)
  const [form, setForm] = useState<LoginForm>({})
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [contextLoading, setContextLoading] = useState(false)
  const [schoolDropdownOpen, setSchoolDropdownOpen] = useState(false)
  const [savePassword, setSavePassword] = useState(false)
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const [step, setStep] = useState<BindStep>('select_school')
  const requestSeq = useRef(0)
  const contextSeq = useRef(0)
  const initialSchoolApplied = useRef(false)
  const initialSchool = useRef<SchoolListItem | null>(getInitialSchoolFromRoute())
  const initialAccountId = useRef(getInitialAccountIdFromRoute())

  const visibleFields = useMemo(() => getVisibleFields(loginContext), [loginContext])
  const loginMode = loginContext?.mode || selectedSchool?.loginMode
  const isExternalWebviewLogin = loginMode === 'cas_webview' || loginMode === 'oauth_webview'
  const syncStrategy = loginContext?.syncStrategy || selectedSchool?.syncStrategy
  const isPasswordServerImport = syncStrategy?.importMode === 'password_server'
  const credentialSave = loginContext?.credentialSave || selectedSchool?.credentialSave
  const requiresCredentialInput = Boolean(selectedSchool) && !isExternalWebviewLogin
  const canSaveForAutoSync =
    credentialSave?.autoSync === 'password_login' ||
    credentialSave?.autoSync === 'password_login_may_need_verification'
  const canSavePassword =
    Boolean(credentialSave?.passwordVaultAllowed) &&
    canSaveForAutoSync &&
    !isExternalWebviewLogin
  const wantsPasswordVault = canSavePassword && savePassword
  const shouldCollectCredentials =
    requiresCredentialInput ||
    isPasswordServerImport ||
    wantsPasswordVault
  const credentialFields = useMemo(
    () => visibleFields.filter((field) => field.name === 'username' || field.name === 'password'),
    [visibleFields],
  )
  const canBind = Boolean(selectedSchool) && !loading && !contextLoading
  const bindButtonText = loading
    ? isPasswordServerImport
      ? '正在导入'
      : '正在进入学校页面'
    : isPasswordServerImport
      ? '登录并导入'
      : '进入学校页面导入'
  const schoolDropdownRows = Math.min(schools.length, SCHOOL_DROPDOWN_MAX_ROWS)
  const schoolScrollClassName = `school-scroll school-scroll-${schoolDropdownRows}`

  useDidShow(() => {
    const routeSchool = getInitialSchoolFromRoute()

    if (!routeSchool || initialSchoolApplied.current || selectedSchool?.id === routeSchool.id) {
      return
    }

    initialSchool.current = routeSchool
    initialSchoolApplied.current = true
    void selectSchool(routeSchool, false)
  })

  useEffect(() => {
    if (initialSchool.current) {
      return undefined
    }

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
    const routeSchool = initialSchool.current || getInitialSchoolFromRoute()

    if (!routeSchool || initialSchoolApplied.current || selectedSchool) {
      return
    }

    initialSchool.current = routeSchool
    initialSchoolApplied.current = true
    void selectSchool(routeSchool, false)
  }, [selectedSchool])

  async function searchSchools(value: string) {
    const text = value.trim()

    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setSearching(true)
    setErrorText('')

    try {
      const result = await listSchools({
        keyword: text,
        limit: 30,
        enabledOnly: true,
        fields: 'summary',
      })
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
    setSchoolDropdownOpen(false)

    if (syncKeyword && !initialSchool.current) {
      Taro.navigateTo({ url: getSchoolBindUrl(school) })
      return
    }

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

  function updateField(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function closeSchoolDropdown() {
    setSchoolDropdownOpen(false)
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
    setMessage(isPasswordServerImport ? '正在导入课表' : '正在进入学校页面')
    setErrorText('')

    try {
      const [context, wechatOpenid] = await Promise.all([
        loginContext ? Promise.resolve(loginContext) : createLoginContext(selectedSchool.id),
        getWechatOpenid(),
      ])

      if (context.syncStrategy?.importMode === 'password_server') {
        const sharedCloudImport = getSharedCloudImport(
          context.syncStrategy.cloudFunctions,
          CLOUD_IMPORT_TARGETS,
        )

        if (!sharedCloudImport || !hasCloudCredentialSync(sharedCloudImport.cloudFunction)) {
          throw new Error('暂时无法导入')
        }

        const cloudResult = await runCredentialSyncWithCloud({
          schoolId: selectedSchool.id,
          providerId: selectedSchool.providerId || selectedSchool.id,
          targets: sharedCloudImport.targets,
          username: form.username,
          password: form.password,
          cloudFunction: sharedCloudImport.cloudFunction,
        })

        const primaryCourseResult = getCacheResult(cloudResult.cacheResults, 'course')

        if (
          !primaryCourseResult ||
          !isRecord(primaryCourseResult.cacheData) ||
          !Array.isArray(primaryCourseResult.cacheData.courses)
        ) {
          throw new Error('课表导入失败')
        }

        setMessage('正在保存账号')

        const cloudWarnings = cloudResult.cacheResults.flatMap((item) => item.warnings || [])
        const result = await submitLogin(selectedSchool.id, {
          accountId: initialAccountId.current || undefined,
          contextId: context.contextId,
          username: form.username,
          password: wantsPasswordVault ? form.password : undefined,
          credentialSaveMode:
            wantsPasswordVault ? 'password_vault' : 'none',
          verifiedByCloud: true,
          cacheResults: cloudResult.cacheResults,
          ...(wechatOpenid ? { wechatOpenid } : {}),
          ...(cloudWarnings.length ? { cloudWarnings } : {}),
        })

        setStoredAccountId(result.accountId, selectedSchool.id)
        const savedCaches = persistCloudCache(
          result.accountId,
          result.cacheResults || [],
        )
        const savedCourseCache = getSavedCacheData(savedCaches, 'course')
        const savedProfileCache = getSavedCacheData(savedCaches, 'profile')
        const courseCache = savedCourseCache

        if (!courseCache) {
          throw new Error('课表导入失败')
        }

        setStoredAccountSummary(
          buildAccountSummary({
            accountId: result.accountId,
            school: selectedSchool,
            credentialSaveMode: wantsPasswordVault ? 'password_vault' : 'none',
            syncStrategy: context.syncStrategy,
            cacheData: courseCache,
            profileCacheData: savedProfileCache,
          }),
        )
        setMessage('登录成功')
        Taro.switchTab({ url: '/pages/index/index' })
        return
      }

      const result = await submitLogin(selectedSchool.id, {
        accountId: initialAccountId.current || undefined,
        contextId: context.contextId,
        username: shouldCollectCredentials ? form.username : undefined,
        password: wantsPasswordVault ? form.password : undefined,
        credentialSaveMode: 'none',
        ...(wechatOpenid ? { wechatOpenid } : {}),
      })

      setStoredAccountId(result.accountId, selectedSchool.id)

      if (result.status === 'need_webview_fetch') {
        const webview = context.webview
        const webviewUrl = webview ? webview.url : ''

        if (!webviewUrl || webviewUrl === 'about:blank') {
          throw new Error('暂时无法导入')
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
        await refreshSchoolTermStarts(selectedSchool.id).catch(() => null)
        setMessage('登录成功')
      }

      Taro.switchTab({ url: '/pages/index/index' })
    } catch (error) {
      setErrorText(getBindErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell title='绑定账号' back={subPage} subPage={subPage} contentClassName='login-content'>
      <View className='bind-page' onClick={closeSchoolDropdown}>
        <View className='login-hero'>
          <View className='title'>绑定教务账号</View>
        </View>

        {message && <View className='status'>{message}</View>}
        {errorText && <View className='status status-error'>{errorText}</View>}

        <View className='bind-surface'>
          {step === 'select_school' && (
            <View>
              <View
                className='field school-field'
                onClick={(event) => event.stopPropagation()}
              >
              <View className='label-row'>
                <Text className='label'>学校</Text>
              </View>
              <View className='school-combobox'>
                <Input
                  className='input school-search-input'
                  value={keyword}
                  placeholder='搜索或选择学校'
                  onFocus={() => setSchoolDropdownOpen(true)}
                  onClick={() => setSchoolDropdownOpen(true)}
                  onInput={(event) => {
                    setKeyword(event.detail.value)
                    setSchoolDropdownOpen(true)
                  }}
                />
                <View className={'school-dropdown-icon ' + (schoolDropdownOpen ? 'school-dropdown-icon-open' : '')} />
              </View>
              {schoolDropdownOpen && (
                <View className='school-dropdown'>
                  {schools.length > 0 ? (
                    <ScrollView scrollY={schools.length > SCHOOL_DROPDOWN_MAX_ROWS} className={schoolScrollClassName}>
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
                    </ScrollView>
                  ) : (
                    !searching && (
                      <View className='empty-state'>
                        <Text className='empty-title'>未找到学校</Text>
                      </View>
                    )
                  )}
                  {searching && schools.length === 0 && (
                    <View className='empty-state'>
                      <Text className='empty-title'>正在搜索</Text>
                    </View>
                  )}
                </View>
              )}
              </View>
              <View className='school-request-link' onClick={openSchoolSubmission}>
                <Text className='school-request-title'>没有找到学校？申请添加新学校</Text>
                <View className='school-request-arrow' />
              </View>
            </View>
          )}

          {step === 'login' && selectedSchool && (
            <View>
              <View className='selected-school-row'>
                <View className='selected-school-main'>
                  <Text className='selected-school-label'>学校</Text>
                  <Text className='selected-school-name'>{selectedSchool.name}</Text>
                </View>
              </View>

              {contextLoading && <View className='inline-status'>正在加载登录表单</View>}

              {!contextLoading &&
                shouldCollectCredentials &&
                credentialFields.map((field) => (
                  <View className='field' key={field.name}>
                    <View className='label-row'>
                      <Text className='label'>{field.label}</Text>
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

              {!contextLoading && credentialSave && canSavePassword && (
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

              {!contextLoading && (
                <Button className='button' disabled={!canBind} loading={loading} onClick={bind}>
                  {bindButtonText}
                </Button>
              )}
            </View>
          )}
        </View>
      </View>
    </PageShell>
  )
}
