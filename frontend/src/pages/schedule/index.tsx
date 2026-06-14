import { useMemo, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { Picker, Text, View } from '@tarojs/components'

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
const LEFT_WIDTH = 64
const HEADER_HEIGHT = 100
const ROW_HEIGHT = 110
const DEFAULT_COURSE_FIELDS: FeatureDisplayField[] = [
  { key: 'name', label: '课程', primary: true },
  { key: 'classroom', label: '教室', fallbackKeys: ['location'] },
]

interface PositionedLesson {
  id: string
  name: string
  room: string
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

function buildWeekOptions(timetable: TimetableCacheResponse | null, currentWeek: number | null): WeekOption[] {
  const weekNumbers = new Set<number>()

  for (const course of timetable ? timetable.courses : []) {
    for (const week of course.weeks || []) {
      const value = Number(week)

      if (Number.isFinite(value) && value > 0) {
        weekNumbers.add(value)
      }
    }
  }

  const sortedWeeks = [...weekNumbers].sort((a, b) => a - b)
  const maxWeek = Math.max(20, currentWeek || 0, sortedWeeks[sortedWeeks.length - 1] || 0)
  const rangedWeeks =
    maxWeek > 0
      ? Array.from({ length: maxWeek }, (_, index) => index + 1)
      : []
  const weeks = currentWeek && !rangedWeeks.includes(currentWeek)
    ? [...rangedWeeks, currentWeek].sort((a, b) => a - b)
    : rangedWeeks

  return weeks.map((week) => ({ value: week, label: `第 ${week} 周` }))
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

export default function SchedulePage() {
  const [accountId, setAccountId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [termOptions, setTermOptions] = useState<TermOption[]>([])
  const [selectedTermId, setSelectedTermId] = useState('')
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')

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
  const currentTeachingWeek = useMemo(
    () => getCurrentTeachingWeek(selectedTerm, timetable?.termId, termStarts),
    [selectedTerm, termStarts, timetable?.termId],
  )
  const weekOptions = useMemo(
    () => buildWeekOptions(timetable, currentTeachingWeek),
    [currentTeachingWeek, timetable],
  )
  const selectedWeekIndex = Math.max(
    weekOptions.findIndex((week) => week.value === selectedWeek),
    0,
  )
  const selectedTermLabel = termOptions[selectedTermIndex]?.label || timetable?.termId || '当前学期'
  const selectedWeekLabel = weekOptions[selectedWeekIndex]?.label || '第 1 周'
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

  function handleTermChange(value: string | number) {
    const term = termOptions[Number(value)]

    if (!term || loading) {
      return
    }

    setSelectedTermId(term.id)
    setSelectedWeek(getCurrentTeachingWeek(term, term.id, termStarts))
    void loadTimetable(accountId, term.id === '__current__' ? '' : term.id)
  }

  function handleWeekChange(value: string | number) {
    const week = weekOptions[Number(value)]

    if (!week) {
      return
    }

    setSelectedWeek(week.value)
  }

  function handleBackToday() {
    const todayTerm = getTodayTermOption(termOptions) || selectedTerm
    const todayWeek = getCurrentTeachingWeek(todayTerm, todayTerm?.id || timetable?.termId, termStarts)

    if (todayTerm && todayTerm.id !== selectedTermId) {
      setSelectedTermId(todayTerm.id)
      void loadTimetable(accountId, todayTerm.id === '__current__' ? '' : todayTerm.id)
    }

    setSelectedWeek(todayWeek)
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
      `left:calc(${LEFT_WIDTH}rpx + (100% - ${LEFT_WIDTH}rpx) / 7 * ${leftIndex})`,
      `top:${top}rpx`,
      `width:calc((100% - ${LEFT_WIDTH}rpx) / 7)`,
      `height:${height}rpx`,
    ].join(';')

    return {
      id: course.id || `${weekday}-${start}-${course.name || index}`,
      name: getCourseValue(course, primaryField) || '未命名课程',
      room: getCourseValue(course, roomField),
      tone: getCourseTone(course, index),
      style,
    }
  }

  return (
    <PageShell title='课表' activeTab='schedule' contentClassName='schedule-content'>
      <View className='schedule-filters'>
        <Picker
          className='filter-picker semester-picker'
          mode='selector'
          range={termOptions.map((term) => term.label)}
          value={selectedTermIndex}
          disabled={loading || termOptions.length === 0}
          onChange={(event) => handleTermChange(event.detail.value)}
        >
          <View className='filter-select'>
            <Text>{selectedTermLabel}</Text>
            <View className='chevron-down' />
          </View>
        </Picker>
        <Picker
          className='filter-picker week-picker'
          mode='selector'
          range={weekOptions.map((week) => week.label)}
          value={selectedWeekIndex}
          disabled={loading}
          onChange={(event) => handleWeekChange(event.detail.value)}
        >
          <View className='filter-select'>
            <Text>{selectedWeekLabel}</Text>
            <View className='chevron-down' />
          </View>
        </Picker>
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}
      {loading && <View className='soft-card state-card'>正在读取课表...</View>}

      <View className='timetable'>
        {weekdays.map((item) => (
          <View className='weekday' key={item.weekday} style={item.style}>
            <View className='weekday-name'>{item.weekday}</View>
            <View className={'weekday-date ' + (item.isToday ? 'weekday-date-active' : '')}>
              {item.dateText}
            </View>
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
          <View className={`lesson-block lesson-${lesson.tone}`} key={lesson.id} style={lesson.style}>
            <View>{lesson.name}</View>
            {lesson.room && <View className='lesson-room'>{lesson.room}</View>}
          </View>
        ))}
      </View>

      {!loading && lessons.length === 0 && <View className='soft-card state-card empty-schedule'>暂无课表数据</View>}
      <View className='back-today-button' onClick={handleBackToday}>回到今天</View>
    </PageShell>
  )
}
