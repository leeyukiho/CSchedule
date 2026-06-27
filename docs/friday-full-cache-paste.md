(() => {
  const accountId = 'cmqrvh3ae0001v49ozz2hwyq4'
  const schoolId = 'moe_4142011798'
  const providerId = 'wdu'
  const termId = '2025-12'
  const timetableLatestKey = `cschedule.dataCache.${accountId}.timetable.latest`
  const timetableTermKey = `cschedule.dataCache.${accountId}.timetable.${termId}`
  const examLatestKey = `cschedule.dataCache.${accountId}.exam.latest`
  const examTermKey = `cschedule.dataCache.${accountId}.exam.${termId}`
  const now = new Date().toISOString()
  const sourceHash = 'local-fixed-20260627-2100-20260628-0600'
  const weeks = Array.from({ length: 60 }, (_, index) => index + 1)

  const nightDate = '2026-06-27'
  const morningDate = '2026-06-28'
  const nightWeekday = 6
  const morningWeekday = 7

  const makeCourse = ({ id, name, weekday, sections, room, startTime, endTime }) => ({
    id,
    name,
    weeks,
    campus: 'Main',
    teacher: 'Test Teacher',
    weekday,
    location: room,
    rawWeeks: '1-60 weeks',
    sections,
    classroom: room,
    startSection: sections[0],
    endSection: sections[sections.length - 1],
    startTime,
    endTime,
  })

  const makeExam = ({ id, courseName, date, startAt, endAt, location, seatNo, status, remark }) => ({
    id,
    courseName,
    examType: 'Test Exam',
    date,
    time: `${startAt.slice(11, 16)}-${endAt.slice(11, 16)}`,
    startAt,
    endAt,
    location,
    seatNo,
    status,
    remark,
  })

  const baseTimetableCache = wx.getStorageSync(timetableLatestKey) || wx.getStorageSync(timetableTermKey)

  if (!baseTimetableCache || !baseTimetableCache.data || !Array.isArray(baseTimetableCache.data.courses)) {
    console.error('Timetable cache not found. Open/import timetable once, then run this script.', {
      timetableLatestKey,
      timetableTermKey,
      baseTimetableCache,
    })
    return
  }

  const addedCourses = [
    makeCourse({
      id: 'local-fixed-night-ended-1-2',
      name: 'Fixed Night Ended Course A',
      weekday: nightWeekday,
      sections: [1, 2],
      room: '3-101',
      startTime: '21:00',
      endTime: '22:00',
    }),
    makeCourse({
      id: 'local-fixed-night-ended-3-4',
      name: 'Fixed Night Ended Course B',
      weekday: nightWeekday,
      sections: [3, 4],
      room: '3-203',
      startTime: '22:00',
      endTime: '22:45',
    }),
    makeCourse({
      id: 'local-fixed-night-current-5-6',
      name: 'Fixed Night Current Course C',
      weekday: nightWeekday,
      sections: [5, 6],
      room: 'B-508',
      startTime: '22:45',
      endTime: '23:30',
    }),
    makeCourse({
      id: 'local-fixed-night-short-7-8',
      name: 'Fixed Night Short Course D',
      weekday: nightWeekday,
      sections: [7, 8],
      room: 'D-408',
      startTime: '23:30',
      endTime: '23:45',
    }),
    makeCourse({
      id: 'local-fixed-night-next-9-10',
      name: 'Fixed Night Next Course E With A Long Name For Wrapping',
      weekday: nightWeekday,
      sections: [9, 10],
      room: '2-506',
      startTime: '23:45',
      endTime: '23:55',
    }),
    makeCourse({
      id: 'local-fixed-night-pending-11-12',
      name: 'Fixed Night Pending Course F',
      weekday: nightWeekday,
      sections: [11, 12],
      room: '1-609',
      startTime: '23:55',
      endTime: '23:59',
    }),
    makeCourse({
      id: 'local-fixed-morning-1-2',
      name: 'Fixed Morning Course A',
      weekday: morningWeekday,
      sections: [1, 2],
      room: 'M-101',
      startTime: '00:00',
      endTime: '01:00',
    }),
    makeCourse({
      id: 'local-fixed-morning-3-4',
      name: 'Fixed Morning Course B',
      weekday: morningWeekday,
      sections: [3, 4],
      room: 'M-203',
      startTime: '01:15',
      endTime: '02:15',
    }),
    makeCourse({
      id: 'local-fixed-morning-5-6',
      name: 'Fixed Morning Course C',
      weekday: morningWeekday,
      sections: [5, 6],
      room: 'M-305',
      startTime: '02:30',
      endTime: '03:30',
    }),
    makeCourse({
      id: 'local-fixed-morning-7-8',
      name: 'Fixed Morning Course D',
      weekday: morningWeekday,
      sections: [7, 8],
      room: 'M-407',
      startTime: '03:45',
      endTime: '04:45',
    }),
    makeCourse({
      id: 'local-fixed-morning-9-10',
      name: 'Fixed Morning Course E',
      weekday: morningWeekday,
      sections: [9, 10],
      room: 'M-509',
      startTime: '05:00',
      endTime: '06:00',
    }),
  ]

  const previousTestCoursePrefixes = ['local-friday-', 'local-saturday-', 'local-today-', 'local-fixed-']
  const addedCourseIds = new Set(addedCourses.map((course) => course.id))
  const nextCourses = [
    ...baseTimetableCache.data.courses.filter((course) => {
      const id = course && String(course.id || '')
      return !addedCourseIds.has(id) && !previousTestCoursePrefixes.some((prefix) => id.startsWith(prefix))
    }),
    ...addedCourses,
  ]

  const nextTimetableData = {
    ...baseTimetableCache.data,
    accountId,
    schoolId,
    providerId,
    termId,
    courses: nextCourses,
    sourceHash,
    syncedAt: now,
  }

  const nextTimetableCache = {
    data: nextTimetableData,
    sourceHash,
    syncedAt: now,
    cachedAt: now,
  }

  const baseExamCache = wx.getStorageSync(examLatestKey) || wx.getStorageSync(examTermKey)
  const baseExamData =
    baseExamCache && baseExamCache.data && baseExamCache.data.data && typeof baseExamCache.data.data === 'object'
      ? baseExamCache.data.data
      : {}
  const existingExamItems = Array.isArray(baseExamData.items)
    ? baseExamData.items
    : Array.isArray(baseExamData.upcoming)
      ? baseExamData.upcoming
      : Array.isArray(baseExamData)
        ? baseExamData
        : []

  const addedExams = [
    makeExam({
      id: 'local-fixed-exam-ended-a',
      courseName: 'Fixed Ended Exam A',
      date: nightDate,
      startAt: `${nightDate}T21:00:00+08:00`,
      endAt: `${nightDate}T22:00:00+08:00`,
      location: '3-101',
      seatNo: 'A01',
      status: 'finished',
      remark: 'Ended in the fixed test window.',
    }),
    makeExam({
      id: 'local-fixed-exam-ended-b',
      courseName: 'Fixed Ended Exam B',
      date: nightDate,
      startAt: `${nightDate}T22:00:00+08:00`,
      endAt: `${nightDate}T22:45:00+08:00`,
      location: '3-203',
      seatNo: 'B12',
      status: 'finished',
      remark: 'Second ended exam for folded-state testing.',
    }),
    makeExam({
      id: 'local-fixed-exam-current-cross-midnight',
      courseName: 'Fixed Current Cross Midnight Exam C',
      date: nightDate,
      startAt: `${nightDate}T22:45:00+08:00`,
      endAt: `${nightDate}T23:30:00+08:00`,
      location: 'B-508',
      seatNo: 'C08',
      status: 'upcoming',
      remark: 'Current around 2026-06-27 23:10 without overlapping other exams.',
    }),
    makeExam({
      id: 'local-fixed-exam-next-cross-midnight',
      courseName: 'Fixed Next Cross Midnight Exam D With A Long Name For Wrapping',
      date: nightDate,
      startAt: `${nightDate}T23:30:00+08:00`,
      endAt: `${morningDate}T00:30:00+08:00`,
      location: '2-506',
      seatNo: 'D20',
      status: 'upcoming',
      remark: 'Next cross-midnight exam near the end of 2026-06-27.',
    }),
    makeExam({
      id: 'local-fixed-exam-morning-a',
      courseName: 'Fixed Morning Exam E',
      date: morningDate,
      startAt: `${morningDate}T00:30:00+08:00`,
      endAt: `${morningDate}T02:00:00+08:00`,
      location: 'M-101',
      seatNo: 'E01',
      status: 'upcoming',
      remark: 'Visible on 2026-06-28.',
    }),
    makeExam({
      id: 'local-fixed-exam-morning-b',
      courseName: 'Fixed Morning Exam F',
      date: morningDate,
      startAt: `${morningDate}T05:00:00+08:00`,
      endAt: `${morningDate}T06:00:00+08:00`,
      location: 'M-509',
      seatNo: 'F06',
      status: 'upcoming',
      remark: 'End of the fixed test window.',
    }),
  ]

  const previousTestExamPrefixes = ['local-friday-', 'local-saturday-', 'local-today-', 'local-fixed-']
  const addedExamIds = new Set(addedExams.map((exam) => exam.id))
  const nextExamItems = [
    ...existingExamItems.filter((exam) => {
      const id = exam && String(exam.id || '')
      return !addedExamIds.has(id) && !previousTestExamPrefixes.some((prefix) => id.startsWith(prefix))
    }),
    ...addedExams,
  ]
  const nextExamData = {
    ...(baseExamCache && baseExamCache.data ? baseExamCache.data : {}),
    accountId,
    schoolId,
    providerId,
    target: 'exam',
    termId,
    data: {
      ...baseExamData,
      items: nextExamItems,
      upcoming: nextExamItems.filter((exam) => exam.status !== 'finished'),
      finished: nextExamItems.filter((exam) => exam.status === 'finished'),
    },
    meta: (baseExamCache && baseExamCache.data && baseExamCache.data.meta) || {},
    sourceHash,
    syncedAt: now,
    session: baseTimetableCache.data.session || (baseExamCache && baseExamCache.data && baseExamCache.data.session) || {
      sessionReusable: false,
      sessionRefreshable: false,
      accountStatus: 'cached_only',
    },
  }

  const nextExamCache = {
    data: nextExamData,
    sourceHash,
    syncedAt: now,
    cachedAt: now,
  }

  wx.setStorageSync(timetableLatestKey, nextTimetableCache)
  wx.setStorageSync(timetableTermKey, nextTimetableCache)
  wx.setStorageSync(examLatestKey, nextExamCache)
  wx.setStorageSync(examTermKey, nextExamCache)

  console.log('Fixed 2026-06-27 21:00 to 2026-06-28 06:00 cache written.', {
    timetableLatestKey,
    timetableTermKey,
    examLatestKey,
    examTermKey,
    window: `${nightDate} 21:00 - ${morningDate} 06:00`,
    courseCount: addedCourses.length,
    examCount: addedExams.length,
    nightCourses: addedCourses.filter((course) => course.weekday === nightWeekday).map((course) => ({
      id: course.id,
      name: course.name,
      sections: course.sections,
      time: `${course.startTime}-${course.endTime}`,
      classroom: course.classroom,
    })),
    morningCourses: addedCourses.filter((course) => course.weekday === morningWeekday).map((course) => ({
      id: course.id,
      name: course.name,
      sections: course.sections,
      time: `${course.startTime}-${course.endTime}`,
      classroom: course.classroom,
    })),
    exams: addedExams.map((exam) => ({
      id: exam.id,
      courseName: exam.courseName,
      date: exam.date,
      time: exam.time,
      status: exam.status,
      startAt: exam.startAt,
      endAt: exam.endAt,
      location: exam.location,
    })),
  })
})()