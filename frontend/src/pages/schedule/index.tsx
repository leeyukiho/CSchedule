import { useEffect, useMemo, useRef, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { Picker, Text, View, type ITouchEvent } from '@tarojs/components'

import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, FeatureDisplayField, TimetableCacheResponse } from '../../shared/api/types'
import { SECTION_TIMES, getCourseSections, getCourseTone } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredAccountId, getStoredTermStarts } from '../../shared/storage'
import {
  TermOption,
  buildTermOptions,
  courseRunsInWeek,
  dedupeAndSortTerms,
  getCurrentTeachingWeek,
  getTodayTermOption,
  getWeekStartDate,
} from '../../shared/term'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const TOTAL_SECTIONS = 13
const MAX_WEEK = 20
const LEFT_WIDTH = 64
const HEADER_HEIGHT = 84
const ROW_HEIGHT = 88
const LESSON_GAP = 4
const WEEK_SWIPE_THRESHOLD = 48
const STATUS_CLEAR_DELAY_MS = 3000
const DEFAULT_COURSE_FIELDS: FeatureDisplayField[] = [
  { key: 'name', label: '课程', primary: true },
  { key: 'classroom', label: '教室', fallbackKeys: ['location'] },
]

interface PositionedLesson {
  id: string
  name: string
  room: string
  teacher: string
  weeksText: string
  sectionsText: string
  timeText: string
  tone: string
  style: string
}

interface WeekOption {
  value: number | null
  label: string
}

interface WeekdayColumn {
  weekday: string
  dateText: string
  isToday: boolean
  style: string
}

function getCourseValue(course: CourseItem, field: FeatureDisplayField) {
  for (const key of [field.key, ...(field.fallbackKeys || [])]) {
    const value = course[key as keyof CourseItem]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function mergeTermOptions(current: TermOption[], next: TermOption[]) {
  return dedupeAndSortTerms([...current, ...next])
}

function buildWeekOptions(): WeekOption[] {
  return Array.from({ length: MAX_WEEK }, (_, index) => {
    const week = index + 1

    return { value: week, label: `第${week}周` }
  })
}

function formatMonthDay(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function isSameDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function formatSectionsText(sections: number[]) {
  if (sections.length === 0) {
    return ''
  }

  if (sections.length === 1) {
    return `第 ${sections[0]} 节`
  }

  return `第 ${sections[0]}-${sections[sections.length - 1]} 节`
}

function formatWeeksText(weeks: number[] | undefined) {
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return '整学期'
  }

  const sortedWeeks = [...new Set(weeks.map(Number))]
    .filter((week) => Number.isFinite(week) && week > 0)
    .sort((a, b) => a - b)

  if (sortedWeeks.length === 0) {
    return '整学期'
  }

  return sortedWeeks.length > 8
    ? `第 ${sortedWeeks[0]}-${sortedWeeks[sortedWeeks.length - 1]} 周`
    : `第 ${sortedWeeks.join('、')} 周`
}

export default function SchedulePage() {
  const [accountId, setAccountId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [termOptions, setTermOptions] = useState<TermOption[]>([])
  const [selectedTermId, setSelectedTermId] = useState('')
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [selectedLesson, setSelectedLesson] = useState<PositionedLesson | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!errorText) {
      return undefined
    }

    const timer = setTimeout(() => setErrorText(''), STATUS_CLEAR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [errorText])

  const periods = useMemo(
    () =>
      Array.from({ length: TOTAL_SECTIONS }, (_, index) => {
        const section = index + 1
        const time = SECTION_TIMES[section]
        const top = HEADER_HEIGHT + index * ROW_HEIGHT

        return {
          section,
          start: time ? time.start : '',
          end: time ? time.end : '',
          style: `left:0rpx;top:${top}rpx;width:${LEFT_WIDTH}rpx;height:${ROW_HEIGHT}rpx;`,
        }
      }),
    [],
  )

  const selectedTermIndex = Math.max(
    termOptions.findIndex((term) => term.id === (selectedTermId || timetable?.termId || '')),
    0,
  )
  const selectedTerm = termOptions[selectedTermIndex] || null
  const weekOptions = useMemo(() => buildWeekOptions(), [])
  const selectedWeekIndex = Math.max(
    weekOptions.findIndex((week) => week.value === selectedWeek),
    0,
  )
  const selectedTermLabel = termOptions[selectedTermIndex]?.label || timetable?.termId || '当前学期'
  const termWeekRange = useMemo(
    () => [
      termOptions.length > 0 ? termOptions.map((term) => term.label) : [selectedTermLabel],
      weekOptions.map((week) => week.label),
    ],
    [selectedTermLabel, termOptions, weekOptions],
  )
  const weekdays = useMemo<WeekdayColumn[]>(() => {
    const today = new Date()
    const startDate = getWeekStartDate(selectedTerm, selectedWeek, timetable?.termId, termStarts)

    return WEEKDAYS.map((weekday, index) => {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + index)

      return {
        weekday,
        dateText: formatMonthDay(date),
        isToday: isSameDate(date, today),
        style: `left:calc(${LEFT_WIDTH}rpx + (100% - ${LEFT_WIDTH}rpx) / 7 * ${index});top:0rpx;width:calc((100% - ${LEFT_WIDTH}rpx) / 7);height:${HEADER_HEIGHT}rpx;`,
      }
    })
  }, [selectedTerm, selectedWeek, termStarts, timetable?.termId])

  const lessons = useMemo<PositionedLesson[]>(() => {
    return (timetable ? timetable.courses : [])
      .filter((course) => {
        if (selectedWeek === null) {
          return true
        }

        return courseRunsInWeek(course, selectedWeek)
      })
      .map((course, index) => toLesson(course, index))
      .filter((lesson): lesson is PositionedLesson => Boolean(lesson))
  }, [selectedWeek, timetable])

  useDidShow(() => {
    const id = getStoredAccountId()
    const storedTermStarts = getStoredTermStarts()
    setAccountId(id)
    setTermStarts(storedTermStarts)

    if (!id) {
      setTimetable(null)
      setTermOptions([])
      setSelectedTermId('')
      setSelectedWeek(null)
      setLoading(false)
      setErrorText('')
      return
    }

    if (id) {
      void loadTimetable(id, selectedTermId, storedTermStarts)
    }
  })

  async function loadTimetable(
    id = accountId,
    termId = selectedTermId,
    starts = termStarts,
  ) {
    if (!id) {
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      const nextTimetable = await getTimetable(id, termId || undefined)
      const nextTermOptions = buildTermOptions(nextTimetable)
      const todayTerm = termId ? null : getTodayTermOption(nextTermOptions)

      if (todayTerm && nextTimetable.termId !== todayTerm.id) {
        const todayTimetable = await getTimetable(id, todayTerm.id)
        const todayTermOptions = buildTermOptions(todayTimetable)
        const mergedTermOptions = mergeTermOptions(nextTermOptions, todayTermOptions)
        const todaySelectedTerm =
          todayTermOptions.find((term) => term.id === (todayTimetable.termId || todayTerm.id)) ||
          todayTerm

        setTimetable(todayTimetable)
        setTermOptions((current) => mergeTermOptions(current, mergedTermOptions))
        setSelectedTermId(todayTimetable.termId || todayTerm.id)
        setSelectedWeek(getCurrentTeachingWeek(todaySelectedTerm, todayTimetable.termId || todayTerm.id, starts))
        return
      }

      const nextSelectedTerm =
        nextTermOptions.find((term) => term.id === (nextTimetable.termId || termId)) || null
      setTimetable(nextTimetable)
      setTermOptions((current) => mergeTermOptions(current, nextTermOptions))
      setSelectedTermId(nextTimetable.termId || termId || '')
      setSelectedWeek((current) =>
        current === null ? getCurrentTeachingWeek(nextSelectedTerm, nextTimetable.termId, starts) : current,
      )
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '课表读取失败')
    } finally {
      setLoading(false)
    }
  }

  function handleTermWeekChange(value: Array<string | number>) {
    const [termValue, weekValue] = value
    const term = termOptions[Number(termValue)] || selectedTerm
    const week = weekOptions[Number(weekValue)]

    if (!term || !week || loading) {
      return
    }

    if (term.id !== selectedTermId) {
      setSelectedTermId(term.id)
      void loadTimetable(accountId, term.id === '__current__' ? '' : term.id)
    }

    setSelectedLesson(null)
    setSelectedWeek(week.value)
  }

  function handleWeekPage(offset: number) {
    const nextWeek = weekOptions[selectedWeekIndex + offset]

    if (!nextWeek) {
      return
    }

    setSelectedLesson(null)
    setSelectedWeek(nextWeek.value)
  }

  function handleScheduleTouchStart(event: ITouchEvent) {
    const touch = event.touches[0]

    if (!touch) {
      return
    }

    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleScheduleTouchEnd(event: ITouchEvent) {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null

    if (!start || !touch) {
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y

    if (
      Math.abs(deltaX) < WEEK_SWIPE_THRESHOLD ||
      Math.abs(deltaX) < Math.abs(deltaY) * 1.25
    ) {
      return
    }

    handleWeekPage(deltaX < 0 ? 1 : -1)
  }

  function handleScheduleTouchCancel() {
    touchStartRef.current = null
  }

  function handleBackToday() {
    const todayTerm = getTodayTermOption(termOptions) || selectedTerm
    const todayWeek = getCurrentTeachingWeek(todayTerm, todayTerm?.id || timetable?.termId, termStarts)

    if (todayTerm && todayTerm.id !== selectedTermId) {
      setSelectedTermId(todayTerm.id)
      void loadTimetable(accountId, todayTerm.id === '__current__' ? '' : todayTerm.id)
    }

    setSelectedLesson(null)
    setSelectedWeek(todayWeek)
  }

  function closeLessonDetail() {
    setSelectedLesson(null)
  }

  function toLesson(course: CourseItem, index: number): PositionedLesson | null {
    const weekday = Number(course.weekday)

    if (weekday < 1 || weekday > 7) {
      return null
    }

    const sections = getCourseSections(course)
    const start = Math.max(Number(sections[0] || 1), 1)
    const end = Math.min(Number(sections[sections.length - 1] || start), TOTAL_SECTIONS)
    const span = Math.max(end - start + 1, 1)
    const top = HEADER_HEIGHT + (start - 1) * ROW_HEIGHT
    const height = span * ROW_HEIGHT
    const leftIndex = weekday - 1
    const fields = timetable?.display?.itemFields?.length
      ? timetable.display.itemFields
      : DEFAULT_COURSE_FIELDS
    const primaryField = fields.find((field) => field.primary) || fields[0]
    const roomField =
      fields.find((field) => ['classroom', 'location', 'campus'].includes(field.key)) ||
      DEFAULT_COURSE_FIELDS[1]
    const style = [
      `left:calc(${LEFT_WIDTH}rpx + (100% - ${LEFT_WIDTH}rpx) / 7 * ${leftIndex} + ${LESSON_GAP}rpx)`,
      `top:${top + LESSON_GAP}rpx`,
      `width:calc((100% - ${LEFT_WIDTH}rpx) / 7 - ${LESSON_GAP * 2}rpx)`,
      `height:${height - LESSON_GAP * 2}rpx`,
    ].join(';')
    const startTime = SECTION_TIMES[start]?.start || ''
    const endTime = SECTION_TIMES[end]?.end || ''

    return {
      id: course.id || `${weekday}-${start}-${course.name || index}`,
      name: getCourseValue(course, primaryField) || '未命名课程',
      room: getCourseValue(course, roomField),
      teacher: course.teacher?.trim() || '',
      weeksText: formatWeeksText(course.weeks),
      sectionsText: formatSectionsText(sections.map(Number)),
      timeText: startTime && endTime ? `${startTime}-${endTime}` : '',
      tone: getCourseTone(course, index),
      style,
    }
  }

  return (
    <PageShell title='课表' activeTab='schedule' contentClassName='schedule-content'>
      <View className='schedule-header'>
        <Picker
          className='term-week-picker'
          mode='multiSelector'
          range={termWeekRange}
          value={[selectedTermIndex, selectedWeekIndex]}
          disabled={loading || termOptions.length === 0}
          onChange={(event) => handleTermWeekChange(event.detail.value)}
        >
          <View className='filter-select term-week-select'>
            <Text>{selectedTermLabel}</Text>
            <View className='chevron-down' />
          </View>
        </Picker>
        <View className='schedule-today-button' onClick={handleBackToday}>今天</View>
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}
      {loading && <View className='soft-card state-card'>正在读取课表...</View>}

      <View
        className='timetable'
        onTouchStart={handleScheduleTouchStart}
        onTouchEnd={handleScheduleTouchEnd}
        onTouchCancel={handleScheduleTouchCancel}
      >
        {weekdays.map((item) => (
          <View
            className={'weekday ' + (item.isToday ? 'weekday-active' : '')}
            key={item.weekday}
            style={item.style}
          >
            <View className='weekday-name'>{item.weekday}</View>
            <View className='weekday-date'>{item.dateText}</View>
          </View>
        ))}

        {periods.map((item) => (
          <View className='time-cell' key={item.section} style={item.style}>
            <View className='period-index'>{item.section}</View>
            <View>{item.start}</View>
            <View>{item.end}</View>
          </View>
        ))}

        {lessons.map((lesson) => (
          <View
            className={`lesson-block lesson-${lesson.tone}`}
            key={lesson.id}
            style={lesson.style}
            onClick={() => setSelectedLesson(lesson)}
          >
            <View>{lesson.name}</View>
            {lesson.room && <View className='lesson-room'>{lesson.room}</View>}
          </View>
        ))}
      </View>

      {selectedLesson && (
        <View className='lesson-detail-mask' onClick={closeLessonDetail}>
          <View className='lesson-detail-card' onClick={(event) => event.stopPropagation()}>
            <View className='lesson-detail-title'>{selectedLesson.name}</View>
            <View className='lesson-detail-row'>
              <Text>时间</Text>
              <Text>{[selectedLesson.sectionsText, selectedLesson.timeText].filter(Boolean).join(' ') || '--'}</Text>
            </View>
            <View className='lesson-detail-row'>
              <Text>周次</Text>
              <Text>{selectedLesson.weeksText}</Text>
            </View>
            <View className='lesson-detail-row'>
              <Text>地点</Text>
              <Text>{selectedLesson.room || '--'}</Text>
            </View>
            <View className='lesson-detail-row'>
              <Text>教师</Text>
              <Text>{selectedLesson.teacher || '--'}</Text>
            </View>
            <View className='lesson-detail-close' onClick={closeLessonDetail}>关闭</View>
          </View>
        </View>
      )}
    </PageShell>
  )
}
