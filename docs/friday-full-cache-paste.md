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
  const sourceHash = 'local-fixed-20260628-1300-2000'
  const weeks = Array.from({ length: 60 }, (_, index) => index + 1)

  const testDate = '2026-06-28'
  const testWeekday = 7

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
      id: 'local-fixed-afternoon-1-2',
      name: 'Style Test Course 01 - Long Title Alpha',
      weekday: testWeekday,
      sections: [1, 2],
      room: 'A-1301',
      startTime: '13:00',
      endTime: '14:20',
    }),
    makeCourse({
      id: 'local-fixed-afternoon-3',
      name: 'Style Test Course 02 - Single Section',
      weekday: testWeekday,
      sections: [3],
      room: 'B-1430',
      startTime: '14:30',
      endTime: '15:30',
    }),
    makeCourse({
      id: 'local-fixed-afternoon-4-5',
      name: 'Style Test Course 03 - Lab / Workshop',
      weekday: testWeekday,
      sections: [4, 5],
      room: 'Lab-1545',
      startTime: '15:45',
      endTime: '17:00',
    }),
    makeCourse({
      id: 'local-fixed-evening-6',
      name: 'Style Test Course 04 - Seminar',
      weekday: testWeekday,
      sections: [6],
      room: 'C-1715',
      startTime: '17:15',
      endTime: '18:30',
    }),
    makeCourse({
      id: 'local-fixed-evening-7-8',
      name: 'Style Test Course 05 - Night Review',
      weekday: testWeekday,
      sections: [7, 8],
      room: 'Online-1900',
      startTime: '19:00',
      endTime: '20:00',
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
      id: 'local-fixed-exam-1300',
      courseName: 'Style Test Exam 01 - Afternoon Start',
      date: testDate,
      startAt: `${testDate}T13:00:00+08:00`,
      endAt: `${testDate}T14:00:00+08:00`,
      location: 'A-1301',
      seatNo: 'A01',
      status: 'finished',
      remark: 'Start of the 13:00-20:00 fixed test window.',
    }),
    makeExam({
      id: 'local-fixed-exam-1430',
      courseName: 'Style Test Exam 02 - Mid Afternoon',
      date: testDate,
      startAt: `${testDate}T14:30:00+08:00`,
      endAt: `${testDate}T15:30:00+08:00`,
      location: 'B-1430',
      seatNo: 'B12',
      status: 'upcoming',
      remark: 'Middle of the fixed test window.',
    }),
    makeExam({
      id: 'local-fixed-exam-1630',
      courseName: 'Style Test Exam 03 - Long Title For Card Layout',
      date: testDate,
      startAt: `${testDate}T16:30:00+08:00`,
      endAt: `${testDate}T18:00:00+08:00`,
      location: 'Lab-1630',
      seatNo: 'C08',
      status: 'upcoming',
      remark: 'Long exam for vertical spacing tests.',
    }),
    makeExam({
      id: 'local-fixed-exam-1900',
      courseName: 'Style Test Exam 04 - Evening End',
      date: testDate,
      startAt: `${testDate}T19:00:00+08:00`,
      endAt: `${testDate}T20:00:00+08:00`,
      location: 'Online-1900',
      seatNo: 'D20',
      status: 'upcoming',
      remark: 'End of the 13:00-20:00 fixed test window.',
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

  console.log('Fixed 2026-06-28 13:00 to 20:00 cache written.', {
    timetableLatestKey,
    timetableTermKey,
    examLatestKey,
    examTermKey,
    window: `${testDate} 13:00 - ${testDate} 20:00`,
    courseCount: addedCourses.length,
    examCount: addedExams.length,
    courses: addedCourses.map((course) => ({
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
