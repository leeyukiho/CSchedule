# 周五六大节缓存测试脚本

把下面整段复制到微信开发者工具 Console 里执行，然后重新进入课表页即可看到周五排满六大节。

```js
(() => {
  const accountId = 'cmqsmwvo7001bv49m8pn3a78q'
  const termId = '622'
  const latestKey = `cschedule.dataCache.${accountId}.timetable.latest`
  const termKey = `cschedule.dataCache.${accountId}.timetable.${termId}`
  const now = new Date().toISOString()
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17]

  const baseCache = wx.getStorageSync(latestKey) || wx.getStorageSync(termKey)

  if (!baseCache || !baseCache.data || !Array.isArray(baseCache.data.courses)) {
    console.error('未找到课表缓存，请先导入/打开一次课表后再执行。', { latestKey, termKey, baseCache })
    return
  }

  const addedCourses = [
    {
      id: 'local-friday-7-8',
      name: '缓存测试课A',
      weeks,
      teacher: '测试教师',
      weekday: 5,
      location: '教学楼2#101',
      sections: [7, 8],
      classroom: '教学楼2#101',
      endSection: 8,
      startSection: 7,
      building: '教学楼2',
      sectionTimeProfileId: 'bwu-teaching-building-2',
      startTime: '16:00',
      endTime: '17:40',
    },
    {
      id: 'local-friday-9-10',
      name: '缓存测试课缓存测试课缓存测试课缓存测试课B',
      weeks,
      teacher: '测试教师',
      weekday: 5,
      location: '教学楼2#306',
      sections: [9, 10],
      classroom: '教学楼2#306',
      endSection: 10,
      startSection: 9,
      building: '教学楼2',
      sectionTimeProfileId: 'bwu-teaching-building-2',
      startTime: '18:30',
      endTime: '20:10',
    },
    {
      id: 'local-friday-11-12',
      name: '缓存测试课C',
      weeks,
      teacher: '测试教师',
      weekday: 5,
      location: '教学楼2#409',
      sections: [11, 12],
      classroom: '教学楼2#409',
      endSection: 12,
      startSection: 11,
      building: '教学楼2',
      sectionTimeProfileId: 'bwu-teaching-building-2',
      startTime: '20:30',
      endTime: '22:10',
    },
  ]

  const addedIds = new Set(addedCourses.map((course) => course.id))
  const nextCourses = [
    ...baseCache.data.courses.filter((course) => !addedIds.has(course && course.id)),
    ...addedCourses,
  ]

  const nextData = {
    ...baseCache.data,
    termId,
    courses: nextCourses,
    sourceHash: 'local-friday-full-11-12-20260626',
    syncedAt: now,
  }

  const nextCache = {
    data: nextData,
    sourceHash: nextData.sourceHash,
    syncedAt: now,
    cachedAt: now,
  }

  wx.setStorageSync(latestKey, nextCache)
  wx.setStorageSync(termKey, nextCache)

  console.log('周五六大节测试课表缓存已写入。', {
    latestKey,
    termKey,
    fridayCourses: nextCourses
      .filter((course) => Number(course.weekday) === 5)
      .map((course) => ({
        id: course.id,
        name: course.name,
        sections: course.sections,
        classroom: course.classroom || course.location,
      })),
  })
})()
```

执行后周五应显示：

- 第 1-2 节：中国近现代史纲要
- 第 3-4 节：高等数学A2
- 第 5-6 节：高级程序设计（Java）
- 第 7-8 节：缓存测试课A
- 第 9-10 节：缓存测试课B
- 第 11-12 节：缓存测试课C
