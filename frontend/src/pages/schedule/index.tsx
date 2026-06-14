import { useEffect, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'

import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, FeatureDisplayField, TimetableCacheResponse } from '../../shared/api/types'
import { SECTION_TIMES, getCourseSections, getCourseTone } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredBindingId } from '../../shared/storage'

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

function getCourseValue(course: CourseItem, field: FeatureDisplayField) {
  for (const key of [field.key, ...(field.fallbackKeys || [])]) {
    const value = course[key as keyof CourseItem]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

export default function SchedulePage() {
  const [bindingId, setBindingId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
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

  const weekdays = useMemo(
    () =>
      WEEKDAYS.map((weekday, index) => ({
        weekday,
        style: `left:calc(${LEFT_WIDTH}rpx + (100% - ${LEFT_WIDTH}rpx) / 7 * ${index});top:0rpx;width:calc((100% - ${LEFT_WIDTH}rpx) / 7);height:${HEADER_HEIGHT}rpx;`,
      })),
    [],
  )

  const lessons = useMemo<PositionedLesson[]>(() => {
    return (timetable ? timetable.courses : [])
      .map((course, index) => toLesson(course, index))
      .filter((lesson): lesson is PositionedLesson => Boolean(lesson))
  }, [timetable])

  useEffect(() => {
    const id = getStoredBindingId()
    setBindingId(id)

    if (id) {
      void loadTimetable(id)
    }
  }, [])

  async function loadTimetable(id = bindingId) {
    if (!id) {
      setErrorText('请先绑定学校账号')
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      setTimetable(await getTimetable(id))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '课表读取失败')
    } finally {
      setLoading(false)
    }
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
        <View className='filter-picker semester-picker'>
          <View className='filter-select'>
          <Text>{(timetable && timetable.termId) || '当前学期'}</Text>
            <View className='chevron-down' />
          </View>
        </View>
        <View className='filter-picker week-picker'>
          <View className='filter-select'>
            <Text>本周</Text>
            <View className='chevron-down' />
          </View>
        </View>
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}
      {loading && <View className='soft-card state-card'>正在读取课表...</View>}

      <View className='timetable'>
        {weekdays.map((item) => (
          <View className='weekday' key={item.weekday} style={item.style}>
            <View className='weekday-name'>{item.weekday}</View>
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
    </PageShell>
  )
}
