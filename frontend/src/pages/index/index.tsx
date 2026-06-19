import { useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'

import { getExams } from '../../shared/api/features'
import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, FeatureCacheResponse, TimetableCacheResponse } from '../../shared/api/types'
import {
  formatCourseTime,
  formatDateText,
  formatSections,
  getWeekday,
} from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredAccountId, getStoredTermStarts } from '../../shared/storage'
import { buildTermOptions, courseRunsInWeek, getTeachingWeekForDate } from '../../shared/term'

const STATUS_CLEAR_DELAY_MS = 3000
const ACADEMIC_YEAR_PATTERN = /(20\d{2})\s*[-~—至]\s*(20\d{2})/
const ACADEMIC_YEAR_COMPACT_PATTERN = /(20\d{2})[-~—至]?(20\d{2})/

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

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
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

function formatHomeTermLabel(timetable: TimetableCacheResponse | null) {
  const termOptions = buildTermOptions(timetable)
  const currentTerm =
    termOptions.find((term) => term.id === timetable?.termId) ||
    termOptions[0] ||
    null

  if (!currentTerm) {
    return ''
  }

  const text = [currentTerm.label, currentTerm.id, timetable?.termId || ''].filter(Boolean).join(' ')
  const compactText = text.replace(/\s+/g, '')
  const yearMatch = text.match(ACADEMIC_YEAR_PATTERN) || compactText.match(ACADEMIC_YEAR_COMPACT_PATTERN)

  if (!yearMatch) {
    return currentTerm.label
  }

  const semester = /第\s*二\s*学期|第二学期|下学期|学期\s*2|semester\s*2/i.test(text)
    ? '2'
    : '1'

  return `${yearMatch[1]}-${yearMatch[2]} 第${semester}学期`
}

export default function HomePage() {
  const [accountId, setAccountId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [exams, setExams] = useState<FeatureCacheResponse | null>(null)
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())

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
    const id = getStoredAccountId()
    setAccountId(id)
    setTermStarts(getStoredTermStarts())

    if (!id) {
      setTimetable(null)
      setExams(null)
      setLoading(false)
      setErrorText('')
      return
    }

    if (id) {
      void loadTimetable(id)
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

  function openProfileTab() {
    Taro.switchTab({ url: '/pages/profile/index' })
  }

  const showGuestEmpty = Boolean(!accountId && !loading && !errorText)
  const todayExamItems = useMemo(() => buildTodayExamItems(exams?.data, nowMs), [exams, nowMs])
  const activeTodayExamItems = todayExamItems.filter((exam) => exam.status !== 'finished')
  const finishedTodayExamItems = todayExamItems.filter((exam) => exam.status === 'finished')
  const todayItemCount = todayCourses.length + todayExamItems.length
  const showTodayRestText = Boolean(accountId && timetable && !loading && !errorText && todayItemCount === 0)
  const homeTermLabel = useMemo(() => formatHomeTermLabel(timetable), [timetable])

  return (
    <PageShell title='首页' activeTab='home' contentClassName='home-content'>
      <View className='date-row'>
        <View>
          <View className='date-title'>{formatDateText()}</View>
          {homeTermLabel && <View className='date-week'>{homeTermLabel}</View>}
        </View>
        <View className='calendar-mini' />
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}

      {loading && <View className='soft-card state-card'>正在加载课程...</View>}

      {showGuestEmpty && (
        <View className='soft-card home-empty-card'>
          <View className='home-empty-title'>今天没有安排，可以好好放松一下。</View>
          <View className='home-empty-desc'>选择学校并绑定账号后，会在这里显示今日课程。</View>
          <View className='home-empty-button' onClick={openProfileTab}>去选择学校</View>
        </View>
      )}

      {showTodayRestText && <View className='today-empty-text'>今天没有安排，可以好好放松一下。</View>}

      {todayItemCount > 0 && (
        <View className='section-head'>
          <View className='section-title'>今日安排</View>
          <Text>共 {todayItemCount} 项</Text>
        </View>
      )}

      {todayCourses.length > 0 && (
        <View className='home-arrangement-group'>
          <View className='home-arrangement-title'>
            <Text>课程</Text>
            <Text>{todayCourses.length} 项</Text>
          </View>
          {todayCourses.map((course: CourseItem, index) => {
            const [startTime = '', endTime = ''] = formatCourseTime(
              course,
              timetable?.sectionTimes,
              timetable?.providerId,
            ).split('-')
            const timeFallback = formatSections(course)

            return (
              <View className='soft-card course-card home-arrangement-card' key={course.id || `${course.name}-${index}`}>
                <View className='course-time-column'>
                  <Text>{startTime || timeFallback}</Text>
                  <View className='course-time-divider' />
                  <Text>{endTime || timeFallback}</Text>
                </View>
                <View className='course-main'>
                  <View className='course-title'>{course.name || '未命名课程'}</View>
                  <View className='course-place'>
                    <Text>{course.classroom || course.location || '地点待定'}</Text>
                  </View>
                </View>
                <View className='teacher course-teacher'>{course.teacher || '教师待定'}</View>
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
                className={`soft-card exam-card home-exam-card home-arrangement-card exam-card-${status === 'today' ? 'today' : 'finished'}`}
                key={`exam-${exam.id}-${index}`}
              >
                <View className='exam-time-column'>
                  <Text className='exam-time-text'>{timeParts.start}</Text>
                  <Text className='exam-time-separator'>~</Text>
                  <Text className='exam-time-text'>{timeParts.end}</Text>
                </View>
                <View className='exam-main'>
                  <View className='exam-course'>{exam.courseName}</View>
                  <View className='exam-meta'>
                    <Text>{exam.location || '地点待安排'}</Text>
                    {exam.seatNo && <Text>座位：{exam.seatNo}</Text>}
                  </View>
                </View>
                <View className={`exam-status exam-status-${status}`}>
                  {status === 'today' ? '今日' : '已结束'}
                </View>
              </View>
            )
          })}
        </View>
      )}
    </PageShell>
  )
}
