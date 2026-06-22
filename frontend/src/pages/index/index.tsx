import { useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'

import { getExams } from '../../shared/api/features'
import {
  getCachedReminderPreferenceState,
  getLocalReminderTemplateIds,
  getReminderPreferences,
  ReminderPreferencesResponse,
  resolveReminderOpenid,
  updateReminderPreference,
} from '../../shared/api/reminders'
import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, FeatureCacheResponse, TimetableCacheResponse } from '../../shared/api/types'
import {
  formatCourseTime,
  formatDateText,
  formatSections,
  getWeekday,
} from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredAccountSummary, getStoredAuthState, getStoredTermStarts } from '../../shared/storage'
import { buildTermOptions, courseRunsInWeek, getTeachingWeekForDate } from '../../shared/term'

import './index.scss'

const STATUS_CLEAR_DELAY_MS = 3000
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000
const REMINDER_STATE_REFRESH_PREFIX = 'cschedule.reminderStateRefreshAt.'
const REMINDER_STATE_REFRESH_GRACE_MS = 2 * 60 * 1000
const REMINDER_STATE_RETRY_MS = 2 * 60 * 1000
const REMINDER_STATE_FAST_RETRY_WINDOW_MS = 30 * 60 * 1000
const REMINDER_STATE_SLOW_RETRY_MS = 5 * 60 * 1000
const REMINDER_STATE_STALE_RETRY_MS = 30 * 60 * 1000
const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast'
const AIR_QUALITY_API_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'

type SchoolWeatherLocation = {
  id: string
  schoolIds: string[]
  providerIds: string[]
  names: string[]
  displayName: string
  latitude: number
  longitude: number
}

type SchoolWeatherIdentity = {
  schoolId: string
  providerId: string
  schoolName: string
}

type WeatherCacheEntry = {
  text: string
  cachedAt: number
}

type HomeExamItem = {
  id: string
  courseName: string
  date: string
  time: string
  startAt: string
  endAt: string
  location: string
  seatNo: string
  status: 'today' | 'finished'
}

const EMPTY_SCHOOL_IDENTITY: SchoolWeatherIdentity = {
  schoolId: '',
  providerId: '',
  schoolName: '',
}

const SCHOOL_WEATHER_LOCATIONS: SchoolWeatherLocation[] = [
  {
    id: 'wtbu',
    schoolIds: ['wtbu', 'moe_4142013242', '4142013242'],
    providerIds: ['wtbu'],
    names: ['武汉工商学院', '武工商'],
    displayName: '武工商',
    latitude: 30.4611,
    longitude: 114.279297,
  },
  {
    id: 'whhxit',
    schoolIds: ['whhxit', 'moe_4142013666', '4142013666'],
    providerIds: ['whhxit'],
    names: ['武汉华夏理工学院', '华夏理工学院', '华夏理工'],
    displayName: '华夏理工',
    latitude: 30.466706,
    longitude: 114.412072,
  },
]

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷雨',
  96: '雷雨冰雹',
  99: '强雷雨冰雹',
}

const schoolWeatherCache = new Map<string, WeatherCacheEntry>()

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getTextValue(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }

  return ''
}

function normalizeSchoolMatchValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function hasSchoolMatch(candidate: string, keys: string[]) {
  const normalizedCandidate = normalizeSchoolMatchValue(candidate)

  if (!normalizedCandidate) {
    return false
  }

  return keys.some((key) => {
    const normalizedKey = normalizeSchoolMatchValue(key)

    return normalizedKey && (
      normalizedCandidate === normalizedKey ||
      normalizedCandidate.includes(normalizedKey) ||
      normalizedKey.includes(normalizedCandidate)
    )
  })
}

function resolveSchoolWeatherLocation(identity: SchoolWeatherIdentity) {
  const candidates = [
    identity.schoolId,
    identity.providerId,
    identity.schoolName,
  ].filter(Boolean)

  return SCHOOL_WEATHER_LOCATIONS.find((location) => {
    const keys = [
      location.id,
      ...location.schoolIds,
      ...location.providerIds,
      ...location.names,
    ]

    return candidates.some((candidate) => hasSchoolMatch(candidate, keys))
  }) || null
}

function getFiniteNumber(value: unknown) {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN

  return Number.isFinite(numberValue) ? numberValue : undefined
}

function getWeatherCodeLabel(code: number | undefined) {
  if (typeof code !== 'number') {
    return '天气'
  }

  return WEATHER_CODE_LABELS[code] || '天气'
}

function formatTemperature(value: number | undefined) {
  return typeof value === 'number' ? `${Math.round(value)}°` : ''
}

function formatAirQualityLevel(value: number | undefined) {
  if (typeof value !== 'number' || value < 0) {
    return ''
  }

  if (value <= 50) {
    return '优'
  }

  if (value <= 100) {
    return '良'
  }

  if (value <= 150) {
    return '轻度污染'
  }

  if (value <= 200) {
    return '中度污染'
  }

  if (value <= 300) {
    return '重度污染'
  }

  return '严重污染'
}

function buildWeatherRequestUrl(location: SchoolWeatherLocation) {
  const currentFields = [
    'temperature_2m',
    'apparent_temperature',
    'weather_code',
  ].join(',')
  const params = [
    `latitude=${location.latitude}`,
    `longitude=${location.longitude}`,
    `current=${encodeURIComponent(currentFields)}`,
    'timezone=Asia%2FShanghai',
    'forecast_days=1',
  ]

  return `${WEATHER_API_URL}?${params.join('&')}`
}

function buildAirQualityRequestUrl(location: SchoolWeatherLocation) {
  const params = [
    `latitude=${location.latitude}`,
    `longitude=${location.longitude}`,
    'current=us_aqi',
    'timezone=Asia%2FShanghai',
    'forecast_days=1',
  ]

  return `${AIR_QUALITY_API_URL}?${params.join('&')}`
}

function buildWeatherText(data: unknown) {
  const record = asRecord(data)
  const current = asRecord(record.current)
  const legacyCurrent = asRecord(record.current_weather)
  const temperature = getFiniteNumber(current.temperature_2m) ?? getFiniteNumber(legacyCurrent.temperature)
  const weatherCode = getFiniteNumber(current.weather_code) ?? getFiniteNumber(legacyCurrent.weathercode)
  const conditionText = getWeatherCodeLabel(weatherCode)
  const temperatureText = formatTemperature(temperature)

  return [conditionText, temperatureText].filter(Boolean).join(' ')
}

function buildAirQualityText(data: unknown) {
  const record = asRecord(data)
  const current = asRecord(record.current)
  const aqi = getFiniteNumber(current.us_aqi)
  const level = formatAirQualityLevel(aqi)

  return level ? `空气质量 ${level}` : ''
}

async function requestWeatherData(location: SchoolWeatherLocation) {
  const response = await Taro.request<unknown>({
    url: buildWeatherRequestUrl(location),
    method: 'GET',
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error('天气读取失败')
  }

  return response.data
}

async function requestAirQualityData(location: SchoolWeatherLocation) {
  const response = await Taro.request<unknown>({
    url: buildAirQualityRequestUrl(location),
    method: 'GET',
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error('空气质量读取失败')
  }

  return response.data
}

function settleRequest<T>(request: Promise<T>) {
  return request.catch(() => undefined)
}

async function fetchSchoolWeatherText(location: SchoolWeatherLocation) {
  const cached = schoolWeatherCache.get(location.id)

  if (cached && Date.now() - cached.cachedAt < WEATHER_CACHE_TTL_MS) {
    return cached.text
  }

  const [weatherData, airQualityData] = await Promise.all([
    settleRequest(requestWeatherData(location)),
    settleRequest(requestAirQualityData(location)),
  ])
  const weatherText = weatherData ? buildWeatherText(weatherData) : ''
  const airQualityText = airQualityData ? buildAirQualityText(airQualityData) : ''

  if (!weatherText && !airQualityText) {
    throw new Error('天气读取失败')
  }

  const text = [location.displayName, weatherText, airQualityText].filter(Boolean).join(' · ')
  schoolWeatherCache.set(location.id, {
    text,
    cachedAt: Date.now(),
  })

  return text
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getReminderRefreshKey(accountId: string, date = new Date()) {
  return `${REMINDER_STATE_REFRESH_PREFIX}${accountId}.${getLocalDateKey(date)}`
}

function getReminderRefreshAt(accountId: string) {
  const value = Number(Taro.getStorageSync(getReminderRefreshKey(accountId)))
  return Number.isFinite(value) ? value : 0
}

function markReminderRefresh(accountId: string) {
  Taro.setStorageSync(getReminderRefreshKey(accountId), Date.now())
}

function getPreferredTimeMs(preferredTime: string, date = new Date()) {
  const match = preferredTime.match(/^(\d{1,2}):(\d{2})$/)

  if (!match) {
    return 0
  }

  const hour = Number(match[1])
  const minute = Number(match[2])

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return 0
  }

  const result = new Date(date)
  result.setHours(hour, minute, 0, 0)
  return result.getTime()
}

function shouldRefreshReminderState(
  accountId: string,
  preference: ReminderPreferencesResponse | null,
  now = Date.now(),
  hasFreshCache = false,
) {
  if (!accountId) {
    return false
  }

  const msSinceRefresh = now - getReminderRefreshAt(accountId)

  if (!preference) {
    return msSinceRefresh >= REMINDER_STATE_RETRY_MS
  }

  if (preference.enabled) {
    const preferredTimeMs = getPreferredTimeMs(preference.preferredTime, new Date(now))
    const msSincePreferredTime = preferredTimeMs ? now - preferredTimeMs : -1

    if (msSincePreferredTime >= REMINDER_STATE_REFRESH_GRACE_MS) {
      const retryMs = msSincePreferredTime <= REMINDER_STATE_REFRESH_GRACE_MS + REMINDER_STATE_FAST_RETRY_WINDOW_MS
        ? REMINDER_STATE_RETRY_MS
        : REMINDER_STATE_SLOW_RETRY_MS

      return msSinceRefresh >= retryMs
    }
  }

  return !hasFreshCache && msSinceRefresh >= REMINDER_STATE_STALE_RETRY_MS
}

function normalizeDateKey(date: string) {
  const match = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)

  if (!match) {
    return ''
  }

  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function parseExamTimeValue(value: string) {
  const time = value ? Date.parse(value) : 0

  return Number.isFinite(time) ? time : 0
}

function parseExamRangeTime(exam: Pick<HomeExamItem, 'date' | 'time'>, edge: 'start' | 'end') {
  const match = exam.time.match(/(\d{1,2})\s*:\s*(\d{2})\s*[~\-—至]\s*(\d{1,2})\s*:\s*(\d{2})/)

  if (!exam.date || !match) {
    return 0
  }

  const dateMatch = exam.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!dateMatch) {
    return 0
  }

  const hour = edge === 'start' ? match[1] : match[3]
  const minute = edge === 'start' ? match[2] : match[4]

  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(hour),
    Number(minute),
  ).getTime()
}

function getExamSortTime(exam: HomeExamItem) {
  return (
    parseExamTimeValue(exam.startAt) ||
    parseExamRangeTime(exam, 'start') ||
    parseExamTimeValue(exam.endAt) ||
    Number.MAX_SAFE_INTEGER
  )
}

function getExamTimeParts(exam: HomeExamItem) {
  const match = exam.time.match(/(\d{1,2})\s*:\s*(\d{2})\s*[~\-—至]\s*(\d{1,2})\s*:\s*(\d{2})/)

  if (match) {
    return {
      start: `${match[1].padStart(2, '0')}:${match[2]}`,
      end: `${match[3].padStart(2, '0')}:${match[4]}`,
    }
  }

  if (exam.time) {
    return {
      start: exam.time,
      end: '结束待定',
    }
  }

  return {
    start: '时间',
    end: '待定',
  }
}

function normalizeHomeExamItem(item: Record<string, unknown>, index: number, now: number): HomeExamItem {
  const courseName = getTextValue(item, ['courseName', 'name', 'course']) || '未命名考试'
  const date = getTextValue(item, ['date'])
  const time = getTextValue(item, ['time'])
  const startAt = getTextValue(item, ['startAt'])
  const endAt = getTextValue(item, ['endAt'])
  const rawStatus = getTextValue(item, ['status'])
  const endTime = parseExamTimeValue(endAt) || parseExamRangeTime({ date, time }, 'end')

  return {
    id: String(item.id || item.courseCode || `${courseName}-${index}`),
    courseName,
    date,
    time,
    startAt,
    endAt,
    location: getTextValue(item, ['location', 'classroom', 'room']),
    seatNo: getTextValue(item, ['seatNo', 'seat', 'seatNumber']),
    status: rawStatus === 'finished' || (endTime && endTime < now) ? 'finished' : 'today',
  }
}

function buildTodayExamItems(data: unknown, now = Date.now()): HomeExamItem[] {
  const record = asRecord(data)
  const directList = Array.isArray(data) ? data : []
  const upcoming = asArray(record.upcoming)
  const finished = asArray(record.finished)
  const fallback = directList.length ? directList : asArray(record.items)
  const sourceItems = (upcoming.length || finished.length
    ? [...upcoming, ...finished]
    : fallback
  ).map(asRecord)
  const todayKey = getLocalDateKey(new Date(now))

  return sourceItems
    .map((item, index) => normalizeHomeExamItem(item, index, now))
    .filter((exam) => normalizeDateKey(exam.date) === todayKey)
    .sort((left, right) => getExamSortTime(left) - getExamSortTime(right))
}

function getHomeTone(index: number) {
  return ['blue', 'green', 'purple', 'red'][index % 4]
}

export default function HomePage() {
  const [accountId, setAccountId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [exams, setExams] = useState<FeatureCacheResponse | null>(null)
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [subscribingReminder, setSubscribingReminder] = useState(false)
  const [reminderSubscribed, setReminderSubscribed] = useState(false)
  const [schoolIdentity, setSchoolIdentity] = useState<SchoolWeatherIdentity>(EMPTY_SCHOOL_IDENTITY)
  const [homeWeatherText, setHomeWeatherText] = useState('')

  useEffect(() => {
    if (!errorText) {
      return undefined
    }

    const timer = setTimeout(() => setErrorText(''), STATUS_CLEAR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [errorText])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!accountId) {
      return
    }

    void loadReminderState(accountId)
  }, [accountId, nowMs])

  const weatherLocation = useMemo(
    () => resolveSchoolWeatherLocation({
      schoolId: timetable?.schoolId || schoolIdentity.schoolId,
      providerId: timetable?.providerId || schoolIdentity.providerId,
      schoolName: schoolIdentity.schoolName,
    }),
    [schoolIdentity.providerId, schoolIdentity.schoolId, schoolIdentity.schoolName, timetable?.providerId, timetable?.schoolId],
  )

  useEffect(() => {
    if (!weatherLocation) {
      setHomeWeatherText('')
      return undefined
    }

    let cancelled = false

    setHomeWeatherText(`${weatherLocation.displayName} · 天气加载中`)
    void fetchSchoolWeatherText(weatherLocation)
      .then((text) => {
        if (!cancelled) {
          setHomeWeatherText(text)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHomeWeatherText(`${weatherLocation.displayName} · 天气暂不可用`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [weatherLocation])

  const todayCourses = useMemo(() => {
    const weekday = getWeekday()
    const termOptions = buildTermOptions(timetable)
    const currentTerm =
      termOptions.find((term) => term.id === timetable?.termId) ||
      termOptions[0] ||
      null
    const currentWeek = getTeachingWeekForDate(new Date(), currentTerm, timetable?.termId, termStarts)
    const courseMap = new Map<string, CourseItem>()

    for (const course of timetable ? timetable.courses : []) {
      if (Number(course.weekday) !== weekday || !courseRunsInWeek(course, currentWeek)) {
        continue
      }

      const sections = Array.isArray(course.sections) ? course.sections.map(Number).join(',') : ''
      const key = [
        course.name || '',
        course.teacher || '',
        course.classroom || course.location || '',
        course.weekday || '',
        course.startSection || '',
        course.endSection || '',
        sections,
      ].join('|')

      if (!courseMap.has(key)) {
        courseMap.set(key, course)
      }
    }

    return [...courseMap.values()].sort((left, right) => {
      const leftStart = Number(left.startSection || left.sections?.[0] || 0)
      const rightStart = Number(right.startSection || right.sections?.[0] || 0)
      return leftStart - rightStart
    })
  }, [termStarts, timetable])

  useDidShow(() => {
    const authState = getStoredAuthState()
    const id = authState.accountId
    const accountSummary = getStoredAccountSummary(id)

    setAccountId(id)
    setSchoolIdentity(id
      ? {
          schoolId: authState.schoolId || accountSummary?.schoolId || '',
          providerId: accountSummary?.providerId || '',
          schoolName: accountSummary?.school?.name || '',
        }
      : EMPTY_SCHOOL_IDENTITY)
    setTermStarts(getStoredTermStarts())

    if (!id) {
      setTimetable(null)
      setExams(null)
      setLoading(false)
      setErrorText('')
      setReminderSubscribed(false)
      setHomeWeatherText('')
      return
    }

    if (id) {
      void loadTimetable(id)
      void loadReminderState(id)
    }
  })

  async function loadTimetable(id: string) {
    setLoading(true)
    setErrorText('')

    try {
      const [nextTimetable, nextExams] = await Promise.all([
        getTimetable(id),
        getExams(id),
      ])

      setTimetable(nextTimetable)
      setExams(nextExams)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '课表读取失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadReminderState(id: string) {
    const cachedPreference = getCachedReminderPreferenceState(id)
    const freshPreference = await getReminderPreferences(id, { cacheOnly: true })
    const preference = freshPreference || cachedPreference
    setReminderSubscribed(Boolean(preference?.enabled))

    if (!shouldRefreshReminderState(id, preference, nowMs, Boolean(freshPreference))) {
      return
    }

    markReminderRefresh(id)

    try {
      const nextPreference = await getReminderPreferences(id, { forceRefresh: true })
      setReminderSubscribed(Boolean(nextPreference.enabled))
    } catch {
      markReminderRefresh(id)
    }
  }

  function openProfileTab() {
    Taro.switchTab({ url: '/pages/profile/index' })
  }

  function getReminderOpenid(id: string) {
    return new Promise<string>((resolve, reject) => {
      Taro.login({
        success: async (result) => {
          try {
            if (!result.code) {
              reject(new Error('微信登录凭证获取失败'))
              return
            }

            const response = await resolveReminderOpenid(id, result.code)
            resolve(response.openid)
          } catch (error) {
            reject(error)
          }
        },
        fail: () => reject(new Error('微信登录失败')),
      })
    })
  }

  function requestReminderSubscribe(templateIds: string[]) {
    return new Promise<boolean>((resolve, reject) => {
      const options = {
        tmplIds: templateIds,
        success: (result) => {
          const values = result as Record<string, string>
          resolve(templateIds.some((templateId) => values[templateId] === 'accept'))
        },
        fail: (error) => reject(error),
      } as unknown as Parameters<typeof Taro.requestSubscribeMessage>[0]

      Taro.requestSubscribeMessage(options)
    })
  }

  function confirmOneTimeReminder() {
    return new Promise<boolean>((resolve) => {
      Taro.showModal({
        title: '订阅本次提醒',
        content: '微信一次性订阅通常只能发送一次。授权后，我们会在默认提醒时间发送下一次最近的课程或考试提醒；发送后可再次订阅下一次提醒。',
        confirmText: '去订阅',
        cancelText: '取消',
        success: (result) => resolve(Boolean(result.confirm)),
        fail: () => resolve(false),
      })
    })
  }

  async function subscribeOneTimeReminder() {
    if (!accountId || subscribingReminder) {
      return
    }

    setSubscribingReminder(true)

    try {
      const confirmed = await confirmOneTimeReminder()
      if (!confirmed) {
        return
      }

      const preference = getCachedReminderPreferenceState(accountId)
      const templateIds = preference?.templateIds?.length
        ? preference.templateIds
        : getLocalReminderTemplateIds()

      if (templateIds.length === 0) {
        Taro.showToast({ title: '暂时无法订阅，请稍后再试', icon: 'none' })
        return
      }

      const accepted = await requestReminderSubscribe(templateIds)

      if (!accepted) {
        Taro.showToast({ title: '未授权订阅消息', icon: 'none' })
        return
      }

      if (preference?.enabled && preference.openid) {
        setReminderSubscribed(true)
        Taro.showToast({ title: '已订阅', icon: 'success' })
        return
      }

      const openid = preference?.openid || await getReminderOpenid(accountId)
      const nextPreference = await updateReminderPreference(accountId, {
        enabled: true,
        preferredTime: preference?.preferredTime || '07:30',
        openid,
      })
      setReminderSubscribed(Boolean(nextPreference.enabled))
      Taro.showToast({ title: '已订阅', icon: 'success' })
    } catch (error) {
      Taro.showToast({
        title: error instanceof Error ? error.message : '订阅失败',
        icon: 'none',
      })
    } finally {
      setSubscribingReminder(false)
    }
  }

  const showGuestEmpty = Boolean(!accountId && !loading && !errorText)
  const todayExamItems = useMemo(() => buildTodayExamItems(exams?.data, nowMs), [exams, nowMs])
  const activeTodayExamItems = todayExamItems.filter((exam) => exam.status !== 'finished')
  const finishedTodayExamItems = todayExamItems.filter((exam) => exam.status === 'finished')
  const todayItemCount = todayCourses.length + todayExamItems.length
  const showTodayRestText = Boolean(accountId && timetable && !loading && !errorText && todayItemCount === 0)
  const weatherDisplayText = homeWeatherText || (weatherLocation ? `${weatherLocation.displayName} · 天气加载中` : '')

  return (
    <PageShell title='首 页' activeTab='home' contentClassName='home-content' customNav>
      <View className='date-row'>
        <View className='date-main'>
          <View className='date-title'>
            <Text>{formatDateText()}</Text>
            {loading && <Text className='date-updated'>同步中</Text>}
          </View>
          {weatherDisplayText && <View className='date-weather'>{weatherDisplayText}</View>}
        </View>
        <View className='date-actions'>
          {accountId && (
            <View
              className={`home-reminder-button${subscribingReminder || reminderSubscribed ? ' home-reminder-button-disabled' : ''}`}
              onClick={reminderSubscribed ? undefined : subscribeOneTimeReminder}
            >
              {reminderSubscribed ? '已订阅' : (subscribingReminder ? '订阅中' : '订阅提醒')}
            </View>
          )}
          <View className='calendar-mini' />
        </View>
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}

      {loading && <View className='soft-card state-card'>正在读取已缓存课程和考试...</View>}

      {showGuestEmpty && (
        <View className='soft-card home-empty-card'>
          <View className='home-empty-title'>今天没有安排，可以好好放松一下。</View>
          <View className='home-empty-desc'>选择学校并绑定账号后，会在这里显示今日课程。</View>
          <View className='home-empty-button' onClick={openProfileTab}>去选择学校</View>
        </View>
      )}

      {showTodayRestText && <View className='today-empty-text'>今天没有安排，可以好好放松一下。</View>}

      <View className='section-head'>
        <View className='section-title'>今日安排</View>
        <View className='section-head-actions'>
          <Text>共 {todayItemCount} 项</Text>
        </View>
      </View>

      {todayCourses.length > 0 && (
        <View className='home-arrangement-group'>
          {todayCourses.map((course: CourseItem, index) => {
            const time = formatCourseTime(
              course,
              timetable?.sectionTimes,
              timetable?.providerId,
            )
            const timeFallback = formatSections(course)
            const tone = getHomeTone(index)

            return (
              <View className='soft-card course-card home-arrangement-card' key={course.id || `${course.name}-${index}`}>
                <View className='course-main'>
                  <View className='course-meta'>{timeFallback}　　{time || '时间待定'}</View>
                  <View className='course-title'>{course.name || '未命名课程'}</View>
                  <View className='course-place'>
                    <View className='pin' />
                    <Text>{course.classroom || course.location || '地点待定'}</Text>
                  </View>
                </View>
                <View className='course-side'>
                  <View className={`class-icon class-icon-${tone}`}>
                    <View className='card-symbol symbol-book' />
                  </View>
                  <Text className='teacher'>{course.teacher || '教师待定'}</Text>
                </View>
              </View>
            )
          })}
        </View>
      )}

      {todayExamItems.length > 0 && (
        <View className='home-arrangement-group'>
          <View className='home-arrangement-title'>
            <Text>考试</Text>
            <Text>{todayExamItems.length} 项</Text>
          </View>
          {[...activeTodayExamItems, ...finishedTodayExamItems].map((exam, index) => {
            const timeParts = getExamTimeParts(exam)
            const status = exam.status === 'finished' ? 'finished' : 'today'

            return (
              <View
                className={`soft-card course-card exam-card home-exam-card home-arrangement-card exam-card-${status === 'today' ? 'today' : 'finished'}`}
                key={`exam-${exam.id}-${index}`}
              >
                <View className='course-main'>
                  <View className='course-meta'>考试　　{timeParts.start}-{timeParts.end}</View>
                  <View className='course-title'>{exam.courseName}</View>
                  <View className='course-place'>
                    <View className='pin' />
                    <Text>{exam.location || '地点待安排'}</Text>
                  </View>
                </View>
                <View className='course-side'>
                  <View className='class-icon class-icon-red'>
                    <View className='card-symbol symbol-exam' />
                  </View>
                  <Text className='teacher'>{status === 'today' ? (exam.seatNo || '今日') : '已结束'}</Text>
                </View>
              </View>
            )
          })}
        </View>
      )}

      {!loading && todayItemCount === 0 && !showGuestEmpty && !showTodayRestText && (
        <View className='soft-card empty-card'>
          <View className='empty-icon' />
          <Text>今日暂无安排</Text>
        </View>
      )}
    </PageShell>
  )
}
