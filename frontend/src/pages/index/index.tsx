import { useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { ScrollView, Text, View } from '@tarojs/components'

import { getExams } from '../../shared/api/features'
import {
  getCachedReminderPreferenceState,
  getLocalReminderTemplateIds,
  getReminderPreferences,
  ReminderPreferencesResponse,
  resolveReminderOpenid,
  setLocalReminderPreferenceState,
  updateReminderPreference,
} from '../../shared/api/reminders'
import { getSchoolWeather } from '../../shared/api/schools'
import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, FeatureCacheResponse, TimetableCacheResponse } from '../../shared/api/types'
import {
  formatCourseTime,
  formatDateText,
  formatSections,
  getWeekday,
} from '../../shared/format'
import { PageShell } from '../../shared/layout'
import {
  buildHomeShortcutRuntimeItems,
  getStoredHomeShortcutConfig,
  HOME_SHORTCUT_CONFIG_UPDATED_EVENT,
  HomeShortcutRuntimeItem,
} from '../../shared/home-shortcuts'
import { useDefaultShare } from '../../shared/share'
import { getStoredAccountSummary, getStoredAuthState, getStoredTermStarts } from '../../shared/storage'
import { buildTermOptions, courseRunsInWeek, getTeachingWeekForDate } from '../../shared/term'

import './index.scss'

const STATUS_CLEAR_DELAY_MS = 3000
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000
const REMINDER_STATE_REFRESH_PREFIX = 'cschedule.reminderStateRefreshAt.'
const REMINDER_STATE_EXPIRE_PREFIX = 'cschedule.reminderStateExpireAt.'
const REMINDER_STATE_REFRESH_GRACE_MS = 2 * 60 * 1000
const REMINDER_STATE_RETRY_MS = 2 * 60 * 1000
const REMINDER_STATE_FAST_RETRY_WINDOW_MS = 30 * 60 * 1000
const REMINDER_STATE_STALE_RETRY_MS = 30 * 60 * 1000
const WEATHER_STORAGE_CACHE_PREFIX = 'cschedule.weather.'
const HOME_SHORTCUT_SCROLL_EDGE_TOLERANCE = 24

type SchoolWeatherLocation = {
  id: string
  displayName: string
}

type SchoolWeatherIdentity = {
  schoolId: string
  providerId: string
  schoolName: string
}

type WeatherCacheEntry = {
  text: string
  cachedAt: number
  unavailable?: boolean
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

type ArrangementStatus = 'current' | 'next' | 'pending' | 'ended'
type HomeShortcutScrollPosition = 'start' | 'middle' | 'end'

const EMPTY_SCHOOL_IDENTITY: SchoolWeatherIdentity = {
  schoolId: '',
  providerId: '',
  schoolName: '',
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

function resolveSchoolWeatherLocation(
  identity: SchoolWeatherIdentity,
  accountSummary: ReturnType<typeof getStoredAccountSummary>,
) {
  const schoolId = identity.schoolId || accountSummary?.schoolId || accountSummary?.school?.id || ''

  if (!schoolId) {
    return null
  }

  return {
    id: schoolId,
    displayName: accountSummary?.school?.weatherLocation?.displayName ||
      accountSummary?.school?.shortName ||
      identity.schoolName ||
      '天气',
  }
}

async function fetchSchoolWeatherText(location: SchoolWeatherLocation) {
  const cached = schoolWeatherCache.get(location.id)

  if (cached && !cached.unavailable && Date.now() - cached.cachedAt < WEATHER_CACHE_TTL_MS) {
    return cached.text
  }

  const stored = getStoredWeatherCache(location.id)

  if (stored && !stored.unavailable && Date.now() - stored.cachedAt < WEATHER_CACHE_TTL_MS) {
    schoolWeatherCache.set(location.id, stored)
    return stored.text
  }

  let response

  response = await getSchoolWeather(location.id)

  if (!response.text) {
    throw new Error('天气读取失败')
  }

  const text = response.text
  schoolWeatherCache.set(location.id, {
    text,
    cachedAt: Date.now(),
  })
  setStoredWeatherCache(location.id, {
    text,
    cachedAt: Date.now(),
  })

  return text
}

function getWeatherStorageCacheKey(locationId: string) {
  return `${WEATHER_STORAGE_CACHE_PREFIX}${locationId}`
}

function normalizeWeatherCacheEntry(value: unknown): WeatherCacheEntry | null {
  const record = asRecord(value)
  const text = typeof record.text === 'string' ? record.text : ''
  const unavailable = record.unavailable === true
  const cachedAt = typeof record.cachedAt === 'number'
    ? record.cachedAt
    : typeof record.cachedAt === 'string'
      ? Number(record.cachedAt)
      : 0

  return (text || unavailable) && cachedAt > 0 ? { text, cachedAt, unavailable } : null
}

function getStoredWeatherCache(locationId: string) {
  return normalizeWeatherCacheEntry(Taro.getStorageSync(getWeatherStorageCacheKey(locationId)))
}

function setStoredWeatherCache(locationId: string, entry: WeatherCacheEntry) {
  Taro.setStorageSync(getWeatherStorageCacheKey(locationId), entry)
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

function getReminderExpireKey(accountId: string, date = new Date()) {
  return `${REMINDER_STATE_EXPIRE_PREFIX}${accountId}.${getLocalDateKey(date)}`
}

function getReminderRefreshAt(accountId: string) {
  const value = Number(Taro.getStorageSync(getReminderRefreshKey(accountId)))
  return Number.isFinite(value) ? value : 0
}

function hasReminderExpired(accountId: string) {
  return Boolean(Taro.getStorageSync(getReminderExpireKey(accountId)))
}

function markReminderRefresh(accountId: string) {
  Taro.setStorageSync(getReminderRefreshKey(accountId), Date.now())
}

function markReminderExpired(accountId: string) {
  Taro.setStorageSync(getReminderExpireKey(accountId), Date.now())
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

function getReminderStateRefreshAction(
  accountId: string,
  preference: ReminderPreferencesResponse | null,
  now = Date.now(),
  hasFreshCache = false,
) {
  if (!accountId) {
    return 'none'
  }

  const lastRefreshAt = getReminderRefreshAt(accountId)
  const msSinceRefresh = now - lastRefreshAt

  if (!preference) {
    return msSinceRefresh >= REMINDER_STATE_RETRY_MS ? 'refresh' : 'none'
  }

  if (preference.enabled) {
    const preferredTimeMs = getPreferredTimeMs(preference.preferredTime, new Date(now))
    const msSincePreferredTime = preferredTimeMs ? now - preferredTimeMs : -1

    if (msSincePreferredTime >= REMINDER_STATE_REFRESH_GRACE_MS) {
      if (msSincePreferredTime <= REMINDER_STATE_REFRESH_GRACE_MS + REMINDER_STATE_FAST_RETRY_WINDOW_MS) {
        return msSinceRefresh >= REMINDER_STATE_RETRY_MS ? 'refresh' : 'none'
      }

      return hasReminderExpired(accountId) ? 'none' : 'expire'
    }
  }

  return !hasFreshCache && msSinceRefresh >= REMINDER_STATE_STALE_RETRY_MS ? 'refresh' : 'none'
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

function getExamStartTime(exam: HomeExamItem) {
  return (
    parseExamTimeValue(exam.startAt) ||
    parseExamRangeTime(exam, 'start') ||
    0
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

function getExamTimeText(exam: HomeExamItem) {
  const timeParts = getExamTimeParts(exam)

  if (!exam.time && !exam.startAt && !exam.endAt) {
    return '时间待定'
  }

  return `${timeParts.start}-${timeParts.end}`
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

function parseTodayTimeRangeMs(timeText: string, now: number) {
  const match = timeText.match(/(\d{1,2})\s*:\s*(\d{2})(?:\s*[~\-—至]\s*(\d{1,2})\s*:\s*(\d{2}))?/)

  if (!match) {
    return { startAt: 0, endAt: 0 }
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  const endHour = match[3] ? Number(match[3]) : NaN
  const endMinute = match[4] ? Number(match[4]) : NaN

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { startAt: 0, endAt: 0 }
  }

  const startDate = new Date(now)
  startDate.setHours(hour, minute, 0, 0)

  if (!Number.isInteger(endHour) || !Number.isInteger(endMinute) || endHour < 0 || endHour > 23 || endMinute < 0 || endMinute > 59) {
    return { startAt: startDate.getTime(), endAt: 0 }
  }

  const endDate = new Date(now)
  endDate.setHours(endHour, endMinute, 0, 0)

  return {
    startAt: startDate.getTime(),
    endAt: endDate.getTime(),
  }
}

function getArrangementStatus(startAt: number, endAt: number, now: number, finished = false): ArrangementStatus {
  if (finished || (endAt && endAt < now)) {
    return 'ended'
  }

  if (startAt && startAt <= now && (!endAt || endAt >= now)) {
    return 'current'
  }

  return 'next'
}

function getCourseStatusLabel(status: ArrangementStatus) {
  if (status === 'current') {
    return '当前'
  }

  if (status === 'ended') {
    return '结束'
  }

  return status === 'next' ? '下一节' : '待上课'
}

function getExamStatusLabel(status: ArrangementStatus) {
  if (status === 'current') {
    return '当前'
  }

  if (status === 'ended') {
    return '结束'
  }

  return status === 'next' ? '下一场' : '待考试'
}

type HomeArrangementDisplayItem = {
  status: ArrangementStatus
  startAt: number
  endAt: number
  order: number
}

function getArrangementSortValue(item: HomeArrangementDisplayItem) {
  return item.startAt || item.endAt || Number.MAX_SAFE_INTEGER
}

function compareArrangementDisplayItems<T extends HomeArrangementDisplayItem>(left: T, right: T) {
  return getArrangementSortValue(left) - getArrangementSortValue(right) || left.order - right.order
}

function sortArrangementDisplayItems<T extends HomeArrangementDisplayItem>(items: T[]) {
  const activeItems = items
    .filter((item) => item.status !== 'ended')
    .sort(compareArrangementDisplayItems)
  const endedItems = items
    .filter((item) => item.status === 'ended')
    .sort(compareArrangementDisplayItems)

  return [...activeItems, ...endedItems]
}

function getCollapsedCourseDisplayItems<T extends HomeArrangementDisplayItem>(items: T[]) {
  const sortedItems = sortArrangementDisplayItems(items)
  const nextItems = sortedItems.filter((item) => item.status === 'next')

  return (nextItems.length ? nextItems : sortedItems.filter((item) => item.status !== 'ended'))
    .slice(0, 1)
}

export default function HomePage() {
  useDefaultShare()
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
  const [accountSummary, setAccountSummary] = useState<ReturnType<typeof getStoredAccountSummary>>(null)
  const [homeWeatherText, setHomeWeatherText] = useState('')
  const [showAllCourses, setShowAllCourses] = useState(false)
  const [showAllExams, setShowAllExams] = useState(false)
  const [homeShortcuts, setHomeShortcuts] = useState(() => buildHomeShortcutRuntimeItems(getStoredHomeShortcutConfig()))
  const [homeShortcutScrollPosition, setHomeShortcutScrollPosition] = useState<HomeShortcutScrollPosition>('start')
  const homeShortcutScrollMetricsRef = useRef({ clientWidth: 0, scrollWidth: 0 })
  const homeShortcutScrollPositionRef = useRef<HomeShortcutScrollPosition>('start')
  const currentDateKey = getLocalDateKey(new Date(nowMs))

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
    const updateHomeShortcuts = (config?: unknown) => {
      setHomeShortcuts(buildHomeShortcutRuntimeItems(config || getStoredHomeShortcutConfig()))
    }

    Taro.eventCenter.on(HOME_SHORTCUT_CONFIG_UPDATED_EVENT, updateHomeShortcuts)

    return () => {
      Taro.eventCenter.off(HOME_SHORTCUT_CONFIG_UPDATED_EVENT, updateHomeShortcuts)
    }
  }, [])

  useEffect(() => {
    setShowAllCourses(false)
    setShowAllExams(false)
  }, [accountId, currentDateKey])

  useEffect(() => {
    if (homeShortcuts.length < 6) {
      return
    }

    homeShortcutScrollPositionRef.current = 'start'
    setHomeShortcutScrollPosition('start')
    measureHomeShortcutScroll()
  }, [homeShortcuts.length])

  useEffect(() => {
    if (!accountId) {
      return
    }

    void loadReminderState(accountId)
  }, [accountId, nowMs])

  const weatherLocation = useMemo(
    () => resolveSchoolWeatherLocation(
      {
        schoolId: timetable?.schoolId || schoolIdentity.schoolId,
        providerId: timetable?.providerId || schoolIdentity.providerId,
        schoolName: schoolIdentity.schoolName,
      },
      accountSummary,
    ),
    [
      accountSummary,
      schoolIdentity.providerId,
      schoolIdentity.schoolId,
      schoolIdentity.schoolName,
      timetable?.providerId,
      timetable?.schoolId,
    ],
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
    const nextAccountSummary = getStoredAccountSummary(id)

    setShowAllCourses(false)
    setShowAllExams(false)
    setAccountId(id)
    setAccountSummary(nextAccountSummary)
    setSchoolIdentity(id
      ? {
          schoolId: authState.schoolId || nextAccountSummary?.schoolId || '',
          providerId: nextAccountSummary?.providerId || '',
          schoolName: nextAccountSummary?.school?.name || '',
        }
      : EMPTY_SCHOOL_IDENTITY)
    setTermStarts(getStoredTermStarts())

    if (!id) {
      setTimetable(null)
      setExams(null)
      setLoading(false)
      setErrorText('')
      setReminderSubscribed(false)
      setAccountSummary(null)
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
    const refreshAction = getReminderStateRefreshAction(id, preference, nowMs, Boolean(freshPreference))

    if (refreshAction === 'none') {
      return
    }

    markReminderRefresh(id)

    try {
      const nextPreference = await getReminderPreferences(id, { forceRefresh: true })
      if (!nextPreference) {
        return
      }

      if (refreshAction === 'expire' && nextPreference.enabled) {
        const expiredPreference = {
          ...nextPreference,
          enabled: false,
          dailyCourseEnabled: false,
          examEnabled: false,
        }
        markReminderExpired(id)
        setLocalReminderPreferenceState(id, expiredPreference)
        setReminderSubscribed(false)
        await updateReminderPreference(id, {
          enabled: false,
          preferredTime: nextPreference.preferredTime,
          openid: nextPreference.openid,
        })
        return
      }

      if (refreshAction === 'expire') {
        markReminderExpired(id)
      }

      setReminderSubscribed(Boolean(nextPreference.enabled))
    } catch {
      if (refreshAction === 'expire' && preference?.enabled) {
        markReminderExpired(id)
        setLocalReminderPreferenceState(id, {
          ...preference,
          enabled: false,
          dailyCourseEnabled: false,
          examEnabled: false,
        })
        setReminderSubscribed(false)
        return
      }

      markReminderRefresh(id)
    }
  }

  function openProfileTab() {
    Taro.switchTab({ url: '/pages/profile/index' })
  }

  function openHomeShortcut(shortcut: HomeShortcutRuntimeItem) {
    if (shortcut.tab) {
      Taro.switchTab({ url: shortcut.url })
      return
    }

    Taro.navigateTo({ url: shortcut.url })
  }

  function handleHomeShortcutScroll(event: { detail?: { scrollLeft?: number; scrollWidth?: number } }) {
    const detail = event.detail || {}
    const scrollLeft = Number(detail.scrollLeft || 0)
    const scrollWidth = Number(detail.scrollWidth || 0)
    const metrics = homeShortcutScrollMetricsRef.current

    if (scrollWidth > 0) {
      metrics.scrollWidth = scrollWidth
    }

    const maxLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth)
    const isAtStart = scrollLeft <= HOME_SHORTCUT_SCROLL_EDGE_TOLERANCE
    const isAtEnd = maxLeft > 0 && scrollLeft >= maxLeft - HOME_SHORTCUT_SCROLL_EDGE_TOLERANCE
    const nextPosition: HomeShortcutScrollPosition = isAtStart
      ? 'start'
      : isAtEnd
        ? 'end'
        : 'middle'

    if (homeShortcutScrollPositionRef.current !== nextPosition) {
      homeShortcutScrollPositionRef.current = nextPosition
      setHomeShortcutScrollPosition(nextPosition)
    }
  }

  function measureHomeShortcutScroll() {
    Taro.nextTick(() => {
      const query = Taro.createSelectorQuery()

      query.select('.home-shortcuts').boundingClientRect()
      query.select('.home-shortcut-track').boundingClientRect()
      query.exec((rects) => {
        const viewport = Array.isArray(rects) ? rects[0] : null
        const track = Array.isArray(rects) ? rects[1] : null
        const viewportWidth = Number(viewport?.width || 0)
        const trackWidth = Number(track?.width || 0)

        homeShortcutScrollMetricsRef.current = {
          clientWidth: viewportWidth || homeShortcutScrollMetricsRef.current.clientWidth,
          scrollWidth: trackWidth || homeShortcutScrollMetricsRef.current.scrollWidth,
        }
      })
    })
  }

  function expandTodayCourses() {
    if (foldedTodayCourseCount <= 0 || showAllCourses) {
      return
    }

    setShowAllCourses(true)
  }

  function toggleTodayCourses() {
    if (foldedTodayCourseCount <= 0 && !showAllCourses) {
      return
    }

    setShowAllCourses((value) => !value)
  }

  function expandTodayExams() {
    if (foldedTodayExamCount <= 0 || showAllExams) {
      return
    }

    setShowAllExams(true)
  }

  function toggleTodayExams() {
    if (foldedTodayExamCount <= 0 && !showAllExams) {
      return
    }

    setShowAllExams((value) => !value)
  }

  function renderArrangementFoldHint(
    kind: string,
    expanded: boolean,
    hiddenCount: number,
    remainingCount: number,
    onClick: () => void,
  ) {
    if (hiddenCount <= 0 && !expanded) {
      return null
    }

    return (
      <View
        className={`home-fold-hint${expanded ? ' home-fold-hint-open' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
      >
        <Text>
          {expanded
            ? `收起${kind}`
            : remainingCount > 0
              ? `剩余 ${remainingCount} 项${kind}`
              : `查看已结束${kind}`}
        </Text>
        <View className='home-fold-hint-icon' />
      </View>
    )
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
        content: '授权后会发送下一次课程或考试提醒。',
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
        Taro.showToast({ title: '暂时无法订阅', icon: 'none' })
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
  const todayCourseItems = useMemo(() => {
    const items = todayCourses.map((course, index) => {
      const time = formatCourseTime(
        course,
        timetable?.sectionTimes,
        timetable?.providerId,
        timetable?.sectionTimeProfiles,
      )
      const timeFallback = formatSections(course)
      const timeText = time || '时间待定'
      const { startAt, endAt } = parseTodayTimeRangeMs(time, nowMs)
      const status = getArrangementStatus(startAt, endAt, nowMs)

      return {
        course,
        endAt,
        index,
        location: course.classroom || course.location || '地点待定',
        startAt,
        status,
        teacher: course.teacher?.trim(),
        timeText,
        sectionText: timeFallback,
        tone: getHomeTone(index),
      }
    })
    const nextStartAt = Math.min(
      ...items
        .filter((item) => item.status === 'next' && item.startAt)
        .map((item) => item.startAt),
    )
    let nextWithoutTimeUsed = false

    return items.map((item) => {
      let status = item.status

      if (item.status === 'next') {
        const isNextCourse = Number.isFinite(nextStartAt)
          ? item.startAt === nextStartAt
          : !nextWithoutTimeUsed

        status = isNextCourse ? 'next' : 'pending'
        nextWithoutTimeUsed = nextWithoutTimeUsed || isNextCourse
      }

      return {
        ...item,
        status,
        statusLabel: getCourseStatusLabel(status),
      }
    })
  }, [
    nowMs,
    timetable?.providerId,
    timetable?.sectionTimeProfiles,
    timetable?.sectionTimes,
    todayCourses,
  ])
  const sortedTodayCourseItems = sortArrangementDisplayItems(
    todayCourseItems.map((item) => ({ ...item, order: item.index })),
  )
  const activeTodayCourseItems = sortedTodayCourseItems.filter((item) => item.status !== 'ended')
  const collapsedTodayCourseItems = getCollapsedCourseDisplayItems(sortedTodayCourseItems)
  const foldedTodayCourseCount = todayCourseItems.length - collapsedTodayCourseItems.length
  const visibleTodayCourseItems = showAllCourses
    ? sortedTodayCourseItems
    : collapsedTodayCourseItems
  const stackedCurrentCourseItem = !showAllCourses
    ? activeTodayCourseItems.find((item) => item.status === 'current')
    : undefined
  const shouldShowStackedCurrentCourse = Boolean(
    stackedCurrentCourseItem && visibleTodayCourseItems.some((item) => item.status === 'next'),
  )
  const visibleTodayCourseIds = new Set(
    visibleTodayCourseItems.map((item) => item.course.id || `${item.course.name}-${item.index}`),
  )
  const hiddenTodayCourseLayerCount = !showAllCourses
    ? activeTodayCourseItems.filter((item) => {
      const itemId = item.course.id || `${item.course.name}-${item.index}`

      if (visibleTodayCourseIds.has(itemId)) {
        return false
      }

      return !shouldShowStackedCurrentCourse || item !== stackedCurrentCourseItem
    }).length
    : 0
  const remainingTodayCourseCount = hiddenTodayCourseLayerCount
  const courseUnderlayCount = Math.min(hiddenTodayCourseLayerCount, 2)
  const todayExamItems = useMemo(() => buildTodayExamItems(exams?.data, nowMs), [exams, nowMs])
  const todayExamCards = todayExamItems.map((exam, index) => {
    const startAt = getExamStartTime(exam)
    const endAt = parseExamTimeValue(exam.endAt) || parseExamRangeTime(exam, 'end')
    const status = getArrangementStatus(startAt, endAt, nowMs, exam.status === 'finished')

    return {
      endAt,
      exam,
      order: index,
      startAt,
      status,
      statusLabel: getExamStatusLabel(status),
    }
  })
  const sortedTodayExamItems = sortArrangementDisplayItems(todayExamCards)
  const nextExamStartAt = Math.min(
    ...sortedTodayExamItems
      .filter((item) => item.status === 'next' && item.startAt)
      .map((item) => item.startAt),
  )
  let nextExamWithoutTimeUsed = false
  const normalizedTodayExamItems = sortedTodayExamItems.map((item) => {
    let status = item.status

    if (item.status === 'next') {
      const isNextExam = Number.isFinite(nextExamStartAt)
        ? item.startAt === nextExamStartAt
        : !nextExamWithoutTimeUsed

      status = isNextExam ? 'next' : 'pending'
      nextExamWithoutTimeUsed = nextExamWithoutTimeUsed || isNextExam
    }

    return {
      ...item,
      status,
      statusLabel: getExamStatusLabel(status),
    }
  })
  const activeTodayExamItems = normalizedTodayExamItems.filter((item) => item.status !== 'ended')
  const collapsedTodayExamItems = getCollapsedCourseDisplayItems(normalizedTodayExamItems)
  const foldedTodayExamCount = todayExamCards.length - collapsedTodayExamItems.length
  const visibleTodayExamItems = showAllExams
    ? normalizedTodayExamItems
    : collapsedTodayExamItems
  const stackedCurrentExamItem = !showAllExams
    ? activeTodayExamItems.find((item) => item.status === 'current')
    : undefined
  const shouldShowStackedCurrentExam = Boolean(
    stackedCurrentExamItem && visibleTodayExamItems.some((item) => item.status === 'next'),
  )
  const visibleTodayExamIds = new Set(
    visibleTodayExamItems.map((item) => item.exam.id || `${item.exam.courseName}-${item.order}`),
  )
  const hiddenTodayExamLayerCount = !showAllExams
    ? activeTodayExamItems.filter((item) => {
      const itemId = item.exam.id || `${item.exam.courseName}-${item.order}`

      if (visibleTodayExamIds.has(itemId)) {
        return false
      }

      return !shouldShowStackedCurrentExam || item !== stackedCurrentExamItem
    }).length
    : 0
  const remainingTodayExamCount = hiddenTodayExamLayerCount
  const examUnderlayCount = Math.min(hiddenTodayExamLayerCount, 2)
  const todayItemCount = todayCourses.length + todayExamItems.length
  const activeTodayItemCount = activeTodayCourseItems.length + activeTodayExamItems.length
  const isCourseComplete = todayCourses.length > 0 && activeTodayCourseItems.length === 0
  const isExamComplete = todayExamItems.length > 0 && activeTodayExamItems.length === 0
  const isTodayComplete = todayItemCount > 0 && activeTodayItemCount === 0
  const todayCompleteSummary = [
    todayCourses.length ? `${todayCourses.length} 节课程` : '',
    todayExamItems.length ? `${todayExamItems.length} 场考试` : '',
  ].filter(Boolean).join('，')
  const isTodayCompleteExpanded = isTodayComplete && (showAllCourses || showAllExams)
  const showTodayRestText = Boolean(accountId && timetable && !loading && !errorText && todayItemCount === 0)
  const weatherDisplayText = homeWeatherText || (weatherLocation ? `${weatherLocation.displayName} · 天气加载中` : '')
  const homeShortcutCount = homeShortcuts.length
  const homeShortcutLayoutClass = homeShortcutCount <= 1
    ? 'home-shortcuts-left'
    : homeShortcutCount <= 5
      ? 'home-shortcuts-even'
      : 'home-shortcuts-scroll'
  const shouldUseShortcutScrollAffordance = homeShortcutCount >= 6
  const shouldShowShortcutLeftArrow = shouldUseShortcutScrollAffordance &&
    homeShortcutScrollPosition !== 'start'
  const shouldShowShortcutRightArrow = shouldUseShortcutScrollAffordance &&
    homeShortcutScrollPosition !== 'end'

  function toggleTodayCompleteArrangements() {
    if (!isTodayComplete) {
      return
    }

    const nextExpanded = !isTodayCompleteExpanded

    setShowAllCourses(nextExpanded && todayCourses.length > 0)
    setShowAllExams(nextExpanded && todayExamItems.length > 0)
  }

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

      {homeShortcutCount > 0 && (
        <View className={`home-shortcut-shell ${shouldUseShortcutScrollAffordance ? 'home-shortcut-shell-scroll' : ''}`}>
          <ScrollView
            className={`home-shortcuts ${homeShortcutLayoutClass}`}
            scrollX={homeShortcutCount >= 6}
            enhanced={homeShortcutCount >= 6}
            showScrollbar={false}
            onScroll={handleHomeShortcutScroll}
          >
            <View className='home-shortcut-track'>
              {homeShortcuts.map((shortcut) => (
                <View
                  className='home-shortcut-item'
                  key={shortcut.key}
                  onClick={() => openHomeShortcut(shortcut)}
                >
                  <View className={`home-shortcut-icon ${shortcut.iconClass}`} />
                  <Text>{shortcut.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          {shouldUseShortcutScrollAffordance && (
            <>
              <View className={`home-shortcut-edge home-shortcut-edge-left${shouldShowShortcutLeftArrow ? ' home-shortcut-edge-visible' : ''}`} />
              <View className={`home-shortcut-edge home-shortcut-edge-right${shouldShowShortcutRightArrow ? ' home-shortcut-edge-visible' : ''}`} />
            </>
          )}
        </View>
      )}

      {errorText && <View className='status status-error'>{errorText}</View>}

      {loading && <View className='soft-card state-card'>正在读取数据</View>}

      <View className='section-head'>
        <View className='section-title'>
          <Text>今日安排</Text>
          <Text className='section-count'>共 {todayItemCount} 项</Text>
        </View>
        <View className='section-head-actions' />
      </View>

      {showGuestEmpty && (
        <View className='soft-card home-empty-card'>
          <View className='home-empty-title'>今天没有安排</View>
          <View className='home-empty-desc'>绑定账号后显示今日课程。</View>
          <View className='home-empty-button' onClick={openProfileTab}>去选择学校</View>
        </View>
      )}

      {showTodayRestText && <View className='today-empty-text'>今天没有安排</View>}

      {isTodayComplete && (
        <View
          className={`soft-card today-complete-card today-complete-card-clickable${isTodayCompleteExpanded ? ' today-complete-card-open' : ''}`}
          onClick={toggleTodayCompleteArrangements}
        >
          <View className='today-complete-icon' />
          <View className='today-complete-main'>
            <View className='today-complete-title'>今日安排已完成</View>
            <View className='today-complete-desc'>
              {todayCompleteSummary ? `已结束 ${todayCompleteSummary}` : '今天的安排都已结束'}
            </View>
          </View>
          <View className='today-complete-expand-icon' />
        </View>
      )}

      {!isTodayComplete && isCourseComplete && (
        <View className='soft-card today-complete-card today-complete-card-compact'>
          <View className='today-complete-icon' />
          <View className='today-complete-main'>
            <View className='today-complete-title'>今日课程已完成</View>
            <View className='today-complete-desc'>已结束 {todayCourses.length} 节课程</View>
          </View>
        </View>
      )}

      {!isTodayComplete && isCourseComplete && !showAllCourses &&
        renderArrangementFoldHint('课程', showAllCourses, foldedTodayCourseCount, remainingTodayCourseCount, toggleTodayCourses)}

      {(showAllCourses || !isTodayComplete) && visibleTodayCourseItems.length > 0 && (
        <View
          className={`home-arrangement-group home-arrangement-group-animated${showAllCourses ? ' home-arrangement-group-open' : ' home-arrangement-group-collapsed'}`}
          onClick={expandTodayCourses}
        >
          {shouldShowStackedCurrentCourse && stackedCurrentCourseItem && (
            <View className='home-current-course-stack'>
              <Text className='home-current-course-name'>
                {stackedCurrentCourseItem.course.name || '未命名课程'}
              </Text>
              <Text className='home-current-course-status'>{stackedCurrentCourseItem.statusLabel}</Text>
            </View>
          )}
          {visibleTodayCourseItems.map(({ course, index, location, sectionText, status, statusLabel, teacher, timeText }) => {
            return (
              <View
                className={`soft-card course-card home-arrangement-card home-arrangement-card-${status}`}
                key={course.id || `${course.name}-${index}`}
              >
                <View className='course-main home-card-main'>
                  <View className={`home-card-head ${teacher ? 'home-card-head-with-teacher' : ''}`}>
                    <Text className='home-primary-value'>{course.name || '未命名课程'}</Text>
                    {teacher && <Text className='home-side-meta home-side-meta-teacher'>{teacher}</Text>}
                  </View>
                  <View className='home-time-row'>
                    <Text className='home-time-value'>{timeText}</Text>
                    {sectionText && <Text className='home-section-chip'>{sectionText}</Text>}
                  </View>
                  <Text className='home-info-value home-info-secondary'>{location}</Text>
                </View>
                <View className='home-card-icon-side'>
                  <Text className={`home-status-badge home-status-badge-${status}`}>{statusLabel}</Text>
                </View>
              </View>
            )
          })}
          {courseUnderlayCount > 0 && (
            <View className='home-course-underlay-stack'>
              {Array.from({ length: courseUnderlayCount }).map((_, index) => (
                <View className={`home-course-underlay home-course-underlay-${index + 1}`} key={`course-underlay-${index}`} />
              ))}
            </View>
          )}
          {!isTodayComplete &&
            renderArrangementFoldHint('课程', showAllCourses, foldedTodayCourseCount, remainingTodayCourseCount, toggleTodayCourses)}
        </View>
      )}

      {!isTodayComplete && isExamComplete && (
        <View className='soft-card today-complete-card today-complete-card-compact today-complete-card-exam'>
          <View className='today-complete-icon today-complete-icon-exam' />
          <View className='today-complete-main'>
            <View className='today-complete-title'>今日考试已完成</View>
            <View className='today-complete-desc'>已结束 {todayExamItems.length} 场考试</View>
          </View>
        </View>
      )}

      {!isTodayComplete && isExamComplete && !showAllExams &&
        renderArrangementFoldHint('考试', showAllExams, foldedTodayExamCount, remainingTodayExamCount, toggleTodayExams)}

      {(showAllExams || !isTodayComplete) && visibleTodayExamItems.length > 0 && (
        <View
          className={`home-arrangement-group home-arrangement-group-animated${showAllExams ? ' home-arrangement-group-open' : ' home-arrangement-group-collapsed'}`}
          onClick={expandTodayExams}
        >
          {shouldShowStackedCurrentExam && stackedCurrentExamItem && (
            <View className='home-current-course-stack home-current-exam-stack'>
              <Text className='home-current-course-name home-current-exam-name'>
                {stackedCurrentExamItem.exam.courseName || '未命名考试'}
              </Text>
              <Text className='home-current-course-status home-current-exam-status'>{stackedCurrentExamItem.statusLabel}</Text>
            </View>
          )}
          {visibleTodayExamItems.map(({ exam, status, statusLabel }, index) => {
            return (
              <View
                className={`soft-card course-card exam-card home-exam-card home-arrangement-card home-arrangement-card-full home-arrangement-card-${status} exam-card-${status === 'ended' ? 'finished' : 'today'}`}
                key={`exam-${exam.id}-${index}`}
              >
                <View className='course-main home-card-main'>
                  <View className='home-card-head'>
                    <Text className='home-primary-value'>{exam.courseName}</Text>
                  </View>
                  <Text className='home-time-value'>{getExamTimeText(exam)}</Text>
                  <Text className='home-info-value home-info-secondary'>{exam.location || '地点待安排'}</Text>
                  <Text className='home-info-value home-info-secondary'>座位：{exam.seatNo || '待安排'}</Text>
                </View>
                <View className='home-card-icon-side'>
                  <Text className={`home-status-badge home-status-badge-${status}`}>{statusLabel}</Text>
                </View>
              </View>
            )
          })}
          {examUnderlayCount > 0 && (
            <View className='home-course-underlay-stack home-exam-underlay-stack'>
              {Array.from({ length: examUnderlayCount }).map((_, index) => (
                <View className={`home-course-underlay home-exam-underlay home-course-underlay-${index + 1}`} key={`exam-underlay-${index}`} />
              ))}
            </View>
          )}
          {!isTodayComplete &&
            renderArrangementFoldHint('考试', showAllExams, foldedTodayExamCount, remainingTodayExamCount, toggleTodayExams)}
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
