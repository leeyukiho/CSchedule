import { useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Text, View } from '@tarojs/components'

import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, TimetableCacheResponse } from '../../shared/api/types'
import {
  formatCourseTime,
  formatDateText,
  formatSections,
  formatTime,
  getCourseTone,
  getWeekday,
} from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredAccountId, getStoredTermStarts } from '../../shared/storage'
import { buildTermOptions, courseRunsInWeek, getTeachingWeekForDate } from '../../shared/term'

const STATUS_CLEAR_DELAY_MS = 3000

export default function HomePage() {
  const [accountId, setAccountId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    if (!errorText) {
      return undefined
    }

    const timer = setTimeout(() => setErrorText(''), STATUS_CLEAR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [errorText])

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
      setTimetable(await getTimetable(id))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '课表读取失败')
    } finally {
      setLoading(false)
    }
  }

  function goSchedule() {
    Taro.switchTab({ url: '/pages/schedule/index' })
  }

  return (
    <PageShell title='首页' activeTab='home' contentClassName='home-content'>
      <View className='date-row'>
        <View>
          <View className='date-title'>{formatDateText()}</View>
          <View className='date-week'>
            {accountId ? `更新于 ${formatTime(timetable ? timetable.syncedAt : undefined)}` : ''}
          </View>
        </View>
        <View className='calendar-mini' />
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}

      {loading && <View className='soft-card state-card'>正在加载课程...</View>}

      {todayCourses.length > 0 && (
        <View className='section-head'>
          <View className='section-title'>今日安排</View>
          <Text>共 {todayCourses.length} 项</Text>
        </View>
      )}

      {todayCourses.map((course: CourseItem, index) => {
        const tone = getCourseTone(course, index)

        return (
          <View className='soft-card course-card' key={course.id || `${course.name}-${index}`}>
            <View>
              <View className='course-meta'>
                {[formatSections(course), formatCourseTime(course)].filter(Boolean).join('  ')}
              </View>
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

      {accountId && (
        <View className='card'>
          <Text className='item-title'>已登录教务账号</Text>
          <Text className='item-meta'>上次更新：{formatTime(timetable ? timetable.syncedAt : undefined)}</Text>
          <Button className='button button-secondary' loading={loading} onClick={goSchedule}>
            查看完整课表
          </Button>
        </View>
      )}
    </PageShell>
  )
}
