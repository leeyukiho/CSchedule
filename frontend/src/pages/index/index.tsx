import { useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { ScrollView, Text, View } from '@tarojs/components'

import { getExams } from '../../shared/api/features'
import { getAppSettings } from '../../shared/api/settings'
import {
  getCachedReminderPreferenceState,
  getLocalReminderTemplateIdMap,
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
import {
  buildHomeShortcutRuntimeItems,
  HOME_SHORTCUT_CONFIG_UPDATED_EVENT,
  HomeShortcutRuntimeItem,
} from '../../shared/home-shortcuts'
import { useDefaultShare } from '../../shared/share'
import { getStoredAuthState, getStoredTermStarts } from '../../shared/storage'
import { buildTermOptions, courseRunsInWeek, getTeachingWeekForDate } from '../../shared/term'

import './index.scss'

const STATUS_CLEAR_DELAY_MS = 3000
const REMINDER_STATE_REFRESH_PREFIX = 'cschedule.reminderStateRefreshAt.'
const REMINDER_STATE_EXPIRE_PREFIX = 'cschedule.reminderStateExpireAt.'
const REMINDER_STATE_REFRESH_GRACE_MS = 2 * 60 * 1000
const REMINDER_STATE_RETRY_MS = 2 * 60 * 1000
const REMINDER_STATE_FAST_RETRY_WINDOW_MS = 30 * 60 * 1000
const REMINDER_STATE_STALE_RETRY_MS = 30 * 60 * 1000
const REMINDER_STATE_KEEP_DAYS = 2
const HOME_SHORTCUT_SCROLL_EDGE_TOLERANCE = 24

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

type ReminderSubscribeResult = {
  acceptedTemplateIds: string[]
  dailyCourseEnabled: boolean
  examEnabled: boolean
}

function getReminderSubscribeTemplateIdMap(
  preference: ReminderPreferencesResponse | null,
  templateIds: string[],
) {
  const templateIdMap = preference?.templateIdMap || getLocalReminderTemplateIdMap()

  return {
    dailyCourse: templateIdMap.dailyCourse || templateIds[0],
    exam: templateIdMap.exam || templateIds[1],
  }
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

function cleanupReminderStateStorage(accountId: string, now = new Date()) {
  if (!accountId) {
    return
  }

  const keepDateKeys = new Set<string>()

  for (let offset = 0; offset < REMINDER_STATE_KEEP_DAYS; offset += 1) {
    const date = new Date(now)
    date.setDate(now.getDate() - offset)
    keepDateKeys.add(getLocalDateKey(date))
  }

  const prefixes = [
    `${REMINDER_STATE_REFRESH_PREFIX}${accountId}.`,
    `${REMINDER_STATE_EXPIRE_PREFIX}${accountId}.`,
  ]
  const info = Taro.getStorageInfoSync()

  for (const key of info.keys || []) {
    const prefix = prefixes.find((item) => key.startsWith(item))

    if (prefix && !keepDateKeys.has(key.slice(prefix.length))) {
      Taro.removeStorageSync(key)
    }
  }
}

function getReminderRefreshAt(accountId: string) {
  const value = Number(Taro.getStorageSync(getReminderRefreshKey(accountId)))
  return Number.isFinite(value) ? value : 0
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

      return msSinceRefresh >= REMINDER_STATE_STALE_RETRY_MS ? 'refresh' : 'none'
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

function getMinuteDistanceLabel(targetAt: number, now: number, prefix = '', suffix = '') {
  if (!targetAt) {
    return ''
  }

  const minutes = Math.max(0, Math.ceil((targetAt - now) / (60 * 1000)))

  if (minutes > 60) {
    return ''
  }

  return `${prefix}${minutes}分钟${suffix}`
}

function getCourseStatusLabel(status: ArrangementStatus, startAt = 0, endAt = 0, now = Date.now()) {
  if (status === 'current') {
    return getMinuteDistanceLabel(endAt, now, '剩余') || '当前'
  }

  if (status === 'ended') {
    return '结束'
  }

  return status === 'next'
    ? getMinuteDistanceLabel(startAt, now, '', '后') || '下一节'
    : '待上课'
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
  return [...items].sort(compareArrangementDisplayItems)
}

function doArrangementTimesOverlap(left: HomeArrangementDisplayItem, right: HomeArrangementDisplayItem) {
  if (!left.startAt || !right.startAt) {
    return false
  }

  const leftEndAt = left.endAt || left.startAt
  const rightEndAt = right.endAt || right.startAt

  return Math.max(left.startAt, right.startAt) < Math.min(leftEndAt, rightEndAt)
}

function getOverlappingArrangementGroup<T extends HomeArrangementDisplayItem>(items: T[], firstItem?: T) {
  if (!firstItem) {
    return []
  }

  const group: T[] = [firstItem]

  for (const item of items) {
    if (item === firstItem || item.status === 'ended') {
      continue
    }

    if (group.some((groupItem) => doArrangementTimesOverlap(groupItem, item))) {
      group.push(item)
    }
  }

  return sortArrangementDisplayItems(group)
}

function getCollapsedArrangementDisplay<T extends HomeArrangementDisplayItem>(items: T[]) {
  const sortedItems = sortArrangementDisplayItems(items)
  const currentItems = sortedItems
    .filter((item) => item.status === 'current')
    .sort((left, right) => getArrangementSortValue(right) - getArrangementSortValue(left) || right.order - left.order)
  const nextItems = sortedItems.filter((item) => item.status === 'next')
  const futureItems = sortedItems.filter((item) => item.status === 'next' || item.status === 'pending')
  const fallbackItems = sortedItems.filter((item) => item.status !== 'ended')
  const currentItem = currentItems[0]

  if (currentItem) {
    const mainItem = nextItems.find((item) => item !== currentItem)
    const mainItems = getOverlappingArrangementGroup(futureItems, mainItem)

    return {
      mainItems: mainItems.length ? mainItems : [currentItem],
      stackedItems: mainItem ? [currentItem] : [],
    }
  }

  const mainItems = getOverlappingArrangementGroup(futureItems, nextItems[0])

  return {
    mainItems: mainItems.length ? mainItems : fallbackItems.slice(0, 1),
    stackedItems: [],
  }
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
  const [showAllTodayArrangements, setShowAllTodayArrangements] = useState(false)
  const [activeOverlapHintKey, setActiveOverlapHintKey] = useState('')
  const [homeShortcuts, setHomeShortcuts] = useState<HomeShortcutRuntimeItem[]>([])
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
      setHomeShortcuts(
        config && typeof config === 'object' && 'items' in config
          ? buildHomeShortcutRuntimeItems(config as Parameters<typeof buildHomeShortcutRuntimeItems>[0], {
              includeMissingDefaults: false,
            })
          : [],
      )
    }
    let cancelled = false

    const loadHomeShortcuts = async () => {
      try {
        const response = await getAppSettings()

        if (!cancelled) {
          updateHomeShortcuts(response.homeShortcuts)
        }
      } catch (error) {
        console.warn('Failed to load home shortcuts.', error)
      }
    }

    Taro.eventCenter.on(HOME_SHORTCUT_CONFIG_UPDATED_EVENT, updateHomeShortcuts)
    void loadHomeShortcuts()

    return () => {
      cancelled = true
      Taro.eventCenter.off(HOME_SHORTCUT_CONFIG_UPDATED_EVENT, updateHomeShortcuts)
    }
  }, [])

  useEffect(() => {
    setShowAllTodayArrangements(false)
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

    setShowAllTodayArrangements(false)
    setAccountId(id)
    setTermStarts(getStoredTermStarts())

    if (!id) {
      setTimetable(null)
      setExams(null)
      setLoading(false)
      setErrorText('')
      setReminderSubscribed(false)
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
    cleanupReminderStateStorage(id, new Date(nowMs))
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

      if (!nextPreference.enabled) {
        markReminderExpired(id)
      }

      setReminderSubscribed(Boolean(nextPreference.enabled))
    } catch {
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

  function expandTodayArrangements() {
    if (foldedTodayArrangementCount <= 0 || showAllTodayArrangements) {
      setActiveOverlapHintKey('')
      return
    }

    setActiveOverlapHintKey('')
    setShowAllTodayArrangements(true)
  }

  function toggleTodayArrangements() {
    if (foldedTodayArrangementCount <= 0 && !showAllTodayArrangements) {
      return
    }

    setActiveOverlapHintKey('')
    setShowAllTodayArrangements((value) => !value)
  }

  function toggleTodayOverlapHint(event: { stopPropagation: () => void }, key: string) {
    event.stopPropagation()
    setActiveOverlapHintKey((value) => value === key ? '' : key)
  }

  function dismissTodayOverlapHint() {
    if (!activeOverlapHintKey) {
      return
    }

    setActiveOverlapHintKey('')
  }

  function renderArrangementFoldHint(
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
            ? '收起'
            : `剩余${remainingCount}项`}
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

  function requestReminderSubscribe(templateIds: string[], templateIdMap = getLocalReminderTemplateIdMap()) {
    return new Promise<ReminderSubscribeResult>((resolve, reject) => {
      const options = {
        tmplIds: templateIds,
        success: (result) => {
          const values = result as Record<string, string>
          const acceptedTemplateIds = templateIds.filter((templateId) => values[templateId] === 'accept')

          resolve({
            acceptedTemplateIds,
            dailyCourseEnabled: Boolean(templateIdMap.dailyCourse && values[templateIdMap.dailyCourse] === 'accept'),
            examEnabled: Boolean(templateIdMap.exam && values[templateIdMap.exam] === 'accept'),
          })
        },
        fail: (error) => reject(error),
      } as unknown as Parameters<typeof Taro.requestSubscribeMessage>[0]

      Taro.requestSubscribeMessage(options)
    })
  }

  async function subscribeOneTimeReminder() {
    if (!accountId || subscribingReminder) {
      return
    }

    setSubscribingReminder(true)

    try {
      const cachedPreference = getCachedReminderPreferenceState(accountId)
      const preference = cachedPreference?.templateIds?.length
        ? cachedPreference
        : await getReminderPreferences(accountId, { forceRefresh: true }).catch(() => cachedPreference)
      const templateIds = preference?.templateIds?.length
        ? preference.templateIds
        : getLocalReminderTemplateIds()
      const templateIdMap = getReminderSubscribeTemplateIdMap(preference, templateIds)

      if (templateIds.length === 0) {
        Taro.showToast({ title: '暂时无法订阅', icon: 'none' })
        return
      }

      const subscribeResult = await requestReminderSubscribe(templateIds, templateIdMap)

      if (subscribeResult.acceptedTemplateIds.length === 0) {
        Taro.showToast({ title: '未授权订阅消息', icon: 'none' })
        return
      }

      const openid = await getReminderOpenid(accountId)
      const nextPreference = await updateReminderPreference(accountId, {
        enabled: true,
        preferredTime: preference?.preferredTime || '07:30',
        openid,
        dailyCourseEnabled: subscribeResult.dailyCourseEnabled,
        examEnabled: subscribeResult.examEnabled,
        templateIdMap,
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
        statusLabel: getCourseStatusLabel(status, item.startAt, item.endAt, nowMs),
      }
    })
  }, [
    nowMs,
    timetable?.providerId,
    timetable?.sectionTimeProfiles,
    timetable?.sectionTimes,
    todayCourses,
  ])
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
  const sortedTodayArrangementItems = sortArrangementDisplayItems([
    ...todayCourseItems.map((item) => ({
      ...item,
      key: `course-${item.course.id || `${item.course.name}-${item.index}`}`,
      order: item.index,
      type: 'course' as const,
    })),
    ...todayExamCards.map((item) => ({
      ...item,
      key: `exam-${item.exam.id || `${item.exam.courseName}-${item.order}`}`,
      order: todayCourseItems.length + item.order,
      type: 'exam' as const,
    })),
  ])
  const nextArrangementStartAt = Math.min(
    ...sortedTodayArrangementItems
      .filter((item) => item.status === 'next' && item.startAt)
      .map((item) => item.startAt),
  )
  let nextArrangementWithoutTimeUsed = false
  const normalizedTodayArrangementItems = sortedTodayArrangementItems.map((item) => {
    let status = item.status

    if (item.status === 'next') {
      const isNextArrangement = Number.isFinite(nextArrangementStartAt)
        ? item.startAt === nextArrangementStartAt
        : !nextArrangementWithoutTimeUsed

      status = isNextArrangement ? 'next' : 'pending'
      nextArrangementWithoutTimeUsed = nextArrangementWithoutTimeUsed || isNextArrangement
    }

    return {
      ...item,
      status,
      statusLabel: item.type === 'exam'
        ? getExamStatusLabel(status)
        : getCourseStatusLabel(status, item.startAt, item.endAt, nowMs),
    }
  })
  const activeTodayArrangementItems = normalizedTodayArrangementItems.filter((item) => item.status !== 'ended')
  const collapsedTodayArrangementDisplay = !showAllTodayArrangements
    ? getCollapsedArrangementDisplay(activeTodayArrangementItems)
    : { mainItems: [], stackedItems: [] }
  const mainTodayArrangementItems = collapsedTodayArrangementDisplay.mainItems
  const stackedTodayArrangementItems = collapsedTodayArrangementDisplay.stackedItems
  const visibleTodayArrangementItems = showAllTodayArrangements
    ? normalizedTodayArrangementItems
    : mainTodayArrangementItems
  const overlappingTodayArrangementKeys = new Set(
    activeTodayArrangementItems
      .filter((item) => activeTodayArrangementItems.some((otherItem) => item !== otherItem && doArrangementTimesOverlap(item, otherItem)))
      .map((item) => item.key),
  )
  const foldedTodayArrangementCount = Math.max(
    0,
    normalizedTodayArrangementItems.length - visibleTodayArrangementItems.length - stackedTodayArrangementItems.length,
  )
  const visibleTodayArrangementKeys = new Set([
    ...visibleTodayArrangementItems.map((item) => item.key),
    ...stackedTodayArrangementItems.map((item) => item.key),
  ])
  const hiddenTodayArrangementLayerCount = !showAllTodayArrangements
    ? activeTodayArrangementItems.filter((item) => {
      if (visibleTodayArrangementKeys.has(item.key)) {
        return false
      }

      return true
    }).length
    : 0
  const remainingTodayArrangementCount = hiddenTodayArrangementLayerCount
  const todayUnderlayCount = Math.min(hiddenTodayArrangementLayerCount, 2)
  const todayItemCount = todayCourses.length + todayExamItems.length
  const activeTodayItemCount = activeTodayArrangementItems.length
  const isTodayComplete = todayItemCount > 0 && activeTodayItemCount === 0
  const todayCompleteSummary = [
    todayCourses.length ? `${todayCourses.length} 节课程` : '',
    todayExamItems.length ? `${todayExamItems.length} 场考试` : '',
  ].filter(Boolean).join('，')
  const isTodayCompleteExpanded = isTodayComplete && showAllTodayArrangements
  const showTodayRestText = Boolean(accountId && timetable && !loading && !errorText && todayItemCount === 0)
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

    setShowAllTodayArrangements(nextExpanded)
  }

  return (
    <PageShell title='首 页' activeTab='home' contentClassName='home-content' customNav>
      <View className='home-overlap-dismiss-layer' onClick={dismissTodayOverlapHint}>
        <View className='date-row'>
          <View className='date-main'>
            <View className='date-title'>
              <Text>{formatDateText()}</Text>
              {loading && <Text className='date-updated'>同步中</Text>}
            </View>
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

        {(showAllTodayArrangements || !isTodayComplete) && visibleTodayArrangementItems.length > 0 && (
          <View
            className={`home-arrangement-group home-arrangement-group-animated${showAllTodayArrangements ? ' home-arrangement-group-open' : ' home-arrangement-group-collapsed'}`}
            onClick={expandTodayArrangements}
          >
            {stackedTodayArrangementItems.map((item) => (
              <View
                className={`home-current-course-stack${item.type === 'exam' ? ' home-current-exam-stack' : ''}`}
                key={`stack-${item.key}`}
              >
                {item.type === 'exam' && <View className='home-current-exam-stack-watermark'>考试</View>}
                <Text className={`home-current-course-name${item.type === 'exam' ? ' home-current-exam-name' : ''}`}>
                  {item.type === 'exam'
                    ? item.exam.courseName || '未命名考试'
                    : item.course.name || '未命名课程'}
                </Text>
                <Text className={`home-current-course-status${item.type === 'exam' ? ' home-current-exam-status' : ''}`}>
                  {item.statusLabel}
                </Text>
              </View>
            ))}
            {visibleTodayArrangementItems.map((item) => {
              const shouldMarkItemOverlap = item.status !== 'ended' && overlappingTodayArrangementKeys.has(item.key)

              if (item.type === 'exam') {
                const { exam, status, statusLabel } = item

                return (
                  <View
                    className={`soft-card course-card exam-card home-exam-card home-arrangement-card home-arrangement-card-full home-arrangement-card-${status} exam-card-${status === 'ended' ? 'finished' : 'today'}${shouldMarkItemOverlap ? ' home-arrangement-card-overlap' : ''}`}
                    key={item.key}
                  >
                    {shouldMarkItemOverlap && (
                      <View
                        className={`home-overlap-chip${activeOverlapHintKey === item.key ? ' home-overlap-chip-active' : ''}`}
                        onClick={(event) => toggleTodayOverlapHint(event, item.key)}
                      >
                        <Text className='home-overlap-chip-mark'>!</Text>
                      </View>
                    )}
                    {shouldMarkItemOverlap && activeOverlapHintKey === item.key && (
                      <View className='home-overlap-tip'>
                        <Text className='home-overlap-tip-text'>该时间段有多项安排</Text>
                      </View>
                    )}
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
              }

              const { course, index, location, sectionText, status, statusLabel, teacher, timeText } = item

              return (
                <View
                  className={`soft-card course-card home-arrangement-card home-arrangement-card-${status}${shouldMarkItemOverlap ? ' home-arrangement-card-overlap' : ''}`}
                  key={item.key || course.id || `${course.name}-${index}`}
                >
                  {shouldMarkItemOverlap && (
                    <View
                      className={`home-overlap-chip${activeOverlapHintKey === item.key ? ' home-overlap-chip-active' : ''}`}
                      onClick={(event) => toggleTodayOverlapHint(event, item.key)}
                    >
                      <Text className='home-overlap-chip-mark'>!</Text>
                    </View>
                  )}
                  {shouldMarkItemOverlap && activeOverlapHintKey === item.key && (
                    <View className='home-overlap-tip'>
                      <Text className='home-overlap-tip-text'>该时间段有多项安排</Text>
                    </View>
                  )}
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
            {todayUnderlayCount > 0 && (
              <View className='home-course-underlay-stack'>
                {Array.from({ length: todayUnderlayCount }).map((_, index) => (
                  <View className={`home-course-underlay home-course-underlay-${index + 1}`} key={`today-underlay-${index}`} />
                ))}
              </View>
            )}
          {!isTodayComplete &&
            renderArrangementFoldHint(showAllTodayArrangements, foldedTodayArrangementCount, remainingTodayArrangementCount, toggleTodayArrangements)}
          </View>
        )}

        {!loading && todayItemCount === 0 && !showGuestEmpty && !showTodayRestText && (
          <View className='soft-card empty-card'>
            <View className='empty-icon' />
            <Text>今日暂无安排</Text>
          </View>
        )}
      </View>
    </PageShell>
  )
}
