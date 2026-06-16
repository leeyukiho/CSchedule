const crypto = require('node:crypto')

const DATA_TARGETS = new Set(['course', 'score', 'exam', 'profile'])
const CONTENT_TYPES = new Set(['json', 'html', 'text', 'csv', 'xlsx', 'ics', 'pdf'])
const MAX_COURSES = 500
const MAX_FEATURE_ITEMS = 1000
const MAX_TEXT_LENGTH = 1024 * 1024
const parserRegistry = new Map()

function ok(result) {
  return { ok: true, result }
}

function fail(errorCode, errorMessage) {
  return { ok: false, errorCode, errorMessage }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function findArray(value, keys) {
  if (Array.isArray(value)) {
    return value
  }

  const record = asRecord(value)

  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key]
    }
  }

  return undefined
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeNumberList(value) {
  return asArray(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
}

function normalizeSections(row) {
  const sections = normalizeNumberList(row.sections)

  if (sections.length) {
    return sections
  }

  const start = Number(row.startSection)
  const end = Number(row.endSection || start)

  if (!Number.isFinite(start) || start <= 0) {
    return []
  }

  return Array.from(
    { length: Math.max((Number.isFinite(end) ? end : start) - start + 1, 1) },
    (_, index) => start + index,
  )
}

function normalizeCourse(value, index) {
  const row = asRecord(value)
  const sections = normalizeSections(row)
  const startSection = Number(row.startSection || sections[0] || 1)
  const endSection = Number(row.endSection || sections[sections.length - 1] || startSection)

  return {
    id: text(row.id) || `course-${index + 1}`,
    name: text(row.name) || text(row.courseName) || 'Unnamed Course',
    teacher: text(row.teacher) || text(row.teacherName),
    location: text(row.location) || text(row.classroom) || text(row.room),
    classroom: text(row.classroom) || text(row.location) || text(row.room),
    weekday: Number(row.weekday || row.dayOfWeek || row.week || 0),
    startSection,
    endSection,
    sections: sections.length
      ? sections
      : Array.from(
          { length: Math.max(endSection - startSection + 1, 1) },
          (_, sectionIndex) => startSection + sectionIndex,
        ),
    weeks: normalizeNumberList(row.weeks),
    rawWeeks: text(row.rawWeeks),
  }
}

function createSourceHash(input) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        providerId: input.providerId,
        target: input.target,
        termId: input.termId,
        contentType: input.contentType,
        payload: input.payload,
      }),
    )
    .digest('hex')
}

function parseJsonPayload(input) {
  const root = asRecord(input.payload)
  const source = root.data || root.result || root.cacheData || input.payload
  const sourceRecord = asRecord(source)
  const syncedAt = new Date().toISOString()
  const sourceHash = createSourceHash(input)

  if (input.target === 'course') {
    const courses = findArray(source, ['courses', 'courseList', 'lessons'])

    if (!courses) {
      throw new Error('RAW_PAYLOAD_INVALID: course payload must include courses')
    }

    if (courses.length > MAX_COURSES) {
      throw new Error('PAYLOAD_TOO_LARGE')
    }

    const cacheData = {
      accountId: '',
      schoolId: input.schoolId,
      providerId: input.providerId,
      termId: input.termId || sourceRecord.termId || sourceRecord.selectedSemesterId,
      courses: courses.map(normalizeCourse),
      terms: findArray(source, ['terms', 'semesters']) || [],
      sectionTimes: findArray(source, ['sectionTimes', 'sections']) || [],
      sourceHash,
      syncedAt,
      session: {
        sessionReusable: false,
        sessionRefreshable: false,
        accountStatus: 'cached_only',
      },
    }

    return {
      target: input.target,
      termId: cacheData.termId,
      cacheData,
      payload: cacheData,
      parsedCount: cacheData.courses.length,
      sourceHash,
      warnings: [],
    }
  }

  const data = root.data !== undefined ? root.data : source
  const count = Array.isArray(data)
    ? data.length
    : (findArray(data, ['items', 'records', 'summary', 'semesters']) || []).length

  if (count > MAX_FEATURE_ITEMS) {
    throw new Error('PAYLOAD_TOO_LARGE')
  }

  const cacheData = {
    accountId: '',
    schoolId: input.schoolId,
    providerId: input.providerId,
    target: input.target,
    termId: input.termId || sourceRecord.termId || sourceRecord.selectedSemesterId,
    data,
    meta: {
      ...(input.meta || {}),
      contentType: input.contentType,
      sourceUrl: input.sourceUrl,
      source: 'cloud_function',
    },
    sourceHash,
    syncedAt,
    session: {
      sessionReusable: false,
      sessionRefreshable: false,
      accountStatus: 'cached_only',
    },
  }

  return {
    target: input.target,
    termId: cacheData.termId,
    cacheData,
    payload: cacheData,
    parsedCount: count,
    sourceHash,
    warnings: [],
  }
}

function registerParser(providerId, parser) {
  parserRegistry.set(providerId, parser)
}

async function parseWithProvider(input) {
  const parser = parserRegistry.get(input.providerId)

  if (!parser) {
    return null
  }

  return parser(input)
}

registerParser('normalized-json', parseJsonPayload)

function validateInput(event) {
  if (!DATA_TARGETS.has(event.target)) {
    throw new Error('RAW_TARGET_INVALID')
  }

  if (!CONTENT_TYPES.has(event.contentType)) {
    throw new Error('RAW_CONTENT_TYPE_INVALID')
  }

  if (!event.schoolId || !event.providerId) {
    throw new Error('PROVIDER_NOT_FOUND')
  }

  if (
    typeof event.payload === 'string' &&
    event.payload.length > MAX_TEXT_LENGTH
  ) {
    throw new Error('PAYLOAD_TOO_LARGE')
  }
}

exports.main = async function main(event) {
  try {
    validateInput(event || {})

    const providerResult = await parseWithProvider(event)

    if (providerResult) {
      return ok(providerResult)
    }

    if (event.contentType !== 'json') {
      return fail(
        'PARSER_NOT_FOUND',
        `No cloud parser is registered for provider ${event.providerId} and content type ${event.contentType}.`,
      )
    }

    return ok(parseJsonPayload(event))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PARSER_FAILED'
    const code = message.includes(':') ? message.split(':')[0] : message

    return fail(code || 'PARSER_FAILED', message)
  }
}
