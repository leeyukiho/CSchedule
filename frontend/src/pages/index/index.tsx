import { useEffect, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
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
import { getStoredBindingId } from '../../shared/storage'

export default function HomePage() {
  const [bindingId, setBindingId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')

  const todayCourses = useMemo(() => {
    const weekday = getWeekday()
    return (timetable ? timetable.courses : []).filter((course) => Number(course.weekday) === weekday)
  }, [timetable])

  useEffect(() => {
    const id = getStoredBindingId()
    setBindingId(id)

    if (id) {
      void loadTimetable(id)
    }
  }, [])

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

  function goBind() {
    Taro.navigateTo({ url: '/pages/bind/index' })
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
            {bindingId ? `更新于 ${formatTime(timetable ? timetable.syncedAt : undefined)}` : '登录后自动获取课表'}
          </View>
        </View>
        <View className='calendar-mini' />
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}

      {!bindingId && (
        <View className='card'>
          <Text className='item-title'>尚未绑定学校账号</Text>
          <Text className='item-meta'>选择学校并登录教务系统后，课表会自动显示在这里。</Text>
          <Button className='button' loading={loading} onClick={goBind}>
            去绑定
          </Button>
        </View>
      )}

      {bindingId && !loading && todayCourses.length === 0 && (
        <View className='soft-card state-card'>今日暂无安排</View>
      )}

      {loading && <View className='soft-card state-card'>正在加载课程...</View>}

      <View className='section-head'>
        <View className='section-title'>今日安排</View>
        <Text>共 {todayCourses.length} 项</Text>
      </View>

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

      {bindingId && (
        <View className='card'>
          <Text className='item-title'>已绑定教务账号</Text>
          <Text className='item-meta'>上次更新：{formatTime(timetable ? timetable.syncedAt : undefined)}</Text>
          <Button className='button button-secondary' loading={loading} onClick={goSchedule}>
            查看完整课表
          </Button>
        </View>
      )}
    </PageShell>
  )
}
