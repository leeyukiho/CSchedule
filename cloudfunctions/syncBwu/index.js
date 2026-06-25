const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')
const zlib = require('node:zlib')

const BWU_CONFIG = {
  baseUrl: 'https://jwxt-443.webvpn.bwu.edu.cn',
  casBaseUrl: 'https://cas.webvpn.bwu.edu.cn',
  portalUrl: 'https://my.webvpn.bwu.edu.cn',
  ssoLoginUrl: 'https://jwxt-443.webvpn.bwu.edu.cn/eams/sso/login.action',
  homePath: '/eams/home.action',
  scheduleIndexPath: '/eams/courseTableForStd.action',
  scheduleTablePath: '/eams/courseTableForStd!courseTable.action',
  allowedRedirectHosts: [
    'cas.webvpn.bwu.edu.cn',
    'my.webvpn.bwu.edu.cn',
    'webvpn.bwu.edu.cn',
    'jwxt-443.webvpn.bwu.edu.cn',
  ],
}
const BWU_LOGIN_MAX_ATTEMPTS = 2
const BWU_SCHEDULE_FETCH_MAX_ATTEMPTS = 3
const BWU_EXAM_BATCH_REQUEST_DELAY_MS = 1200
const BWU_REQUEST_DELAY_MS = 1200
const FRONTEND_IMPORT_SOURCE = 'frontend_cloud_import'
const CLIENT_IMPORT_CLOCK_SKEW_MS = 60 * 1000
const RECOVERABLE_EDU_TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
])

function isRecoverableEduTlsError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()

  return (
    RECOVERABLE_EDU_TLS_ERROR_CODES.has(code) ||
    message.includes('unable to verify the first certificate') ||
    message.includes('unable to get local issuer certificate') ||
    message.includes('unable to get issuer certificate')
  )
}

function ok(result) {
  return { ok: true, result }
}

function fail(errorCode, errorMessage, extra) {
  return {
    ok: false,
    errorCode,
    errorMessage,
    ...(extra || {}),
  }
}

function isHttpEvent(event) {
  return Boolean(
    event &&
      typeof event === 'object' &&
      (event.httpMethod || event.headers || event.requestContext),
  )
}

function parseHttpBody(event) {
  if (!event.body) {
    return {}
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body

  return typeof body === 'string'
    ? JSON.parse(body.replace(/^\uFEFF/, '') || '{}')
    : body
}

function httpResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-cschedule-client-import-token',
    },
    body: JSON.stringify(body),
  }
}

function assertAuthorized(event) {
  if (event?.source === FRONTEND_IMPORT_SOURCE) {
    return assertFrontendImportAuthorized(event)
  }

  const secret = String(process.env.CSCHEDULE_WORKER_SECRET || '').trim()

  if (!secret) {
    throw new Error('WORKER_SECRET_NOT_CONFIGURED')
  }

  const received =
    event.headers?.['x-cschedule-worker-secret'] ||
    event.headers?.['X-CSchedule-Worker-Secret']

  if (received !== secret) {
    throw new Error('WORKER_UNAUTHORIZED')
  }
}

function assertFrontendImportAuthorized(event) {
  const secret = String(process.env.CSCHEDULE_WORKER_SECRET || '').trim()

  if (!secret) {
    throw new Error('WORKER_SECRET_NOT_CONFIGURED')
  }

  const token =
    event.clientImportToken ||
    event.headers?.['x-cschedule-client-import-token'] ||
    event.headers?.['X-CSchedule-Client-Import-Token']
  const payload = verifyClientImportToken(token, secret)

  if (
    payload.source !== FRONTEND_IMPORT_SOURCE ||
    payload.schoolId !== event.schoolId ||
    payload.providerId !== event.providerId ||
    payload.contextId !== event.contextId
  ) {
    throw new Error('CLIENT_IMPORT_TOKEN_INVALID')
  }

  const requestedTargets = normalizeTargets(event.targets)
  const allowedTargets = normalizeTargets(payload.targets)

  if (
    requestedTargets.length === 0 ||
    requestedTargets.some((target) => !allowedTargets.includes(target))
  ) {
    throw new Error('CLIENT_IMPORT_TARGET_UNAUTHORIZED')
  }

  return payload
}

function verifyClientImportToken(token, secret) {
  const [encodedPayload, signature] = String(token || '').split('.')

  if (!encodedPayload || !signature) {
    throw new Error('CLIENT_IMPORT_TOKEN_REQUIRED')
  }

  const expected = hmacHex(secret, encodedPayload)

  if (!safeEqualHex(signature, expected)) {
    throw new Error('CLIENT_IMPORT_TOKEN_INVALID')
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  const expiresAtMs = Date.parse(payload.expiresAt || '')

  if (!Number.isFinite(expiresAtMs) || expiresAtMs + CLIENT_IMPORT_CLOCK_SKEW_MS <= Date.now()) {
    throw new Error('CLIENT_IMPORT_TOKEN_EXPIRED')
  }

  return payload
}

function createCloudProof(event, cacheResults) {
  const secret = String(process.env.CSCHEDULE_WORKER_SECRET || '').trim()
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const proof = {
    version: 1,
    source: FRONTEND_IMPORT_SOURCE,
    schoolId: event.schoolId,
    providerId: event.providerId,
    contextId: event.contextId,
    targets: normalizeTargets(event.targets),
    resultHash: hashCacheResultsForProof(cacheResults),
    issuedAt,
    expiresAt,
  }

  return {
    ...proof,
    signature: hmacHex(secret, stableStringify(proof)),
  }
}

function hashCacheResultsForProof(cacheResults) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(normalizeCacheResultsForProof(cacheResults)))
    .digest('hex')
}

function normalizeCacheResultsForProof(cacheResults) {
  return (Array.isArray(cacheResults) ? cacheResults : []).map((item) => {
    const result = {
      target: item.target,
      cacheData: item.cacheData,
    }

    if (typeof item.termId === 'string' && item.termId) {
      result.termId = item.termId
    }

    if (typeof item.parsedCount === 'number') {
      result.parsedCount = item.parsedCount
    }

    if (typeof item.sourceHash === 'string' && item.sourceHash) {
      result.sourceHash = item.sourceHash
    }

    if (typeof item.syncedAt === 'string' && item.syncedAt) {
      result.syncedAt = item.syncedAt
    }

    if (Array.isArray(item.warnings)) {
      result.warnings = item.warnings
    }

    return result
  })
}

function hmacHex(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

function safeEqualHex(left, right) {
  if (!/^[0-9a-f]+$/i.test(String(left || ''))) {
    return false
  }

  const leftBuffer = Buffer.from(String(left), 'hex')
  const rightBuffer = Buffer.from(String(right), 'hex')

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function stableStringify(value) {
  return JSON.stringify(normalizeForJson(value))
}

function normalizeForJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForJson)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.keys(value).sort().reduce((result, key) => {
    if (value[key] !== undefined) {
      result[key] = normalizeForJson(value[key])
    }

    return result
  }, {})
}

function createCookieJar() {
  const cookies = new Map()

  return {
    header() {
      return [...cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ')
    },
    set(setCookie) {
      for (const item of [setCookie].flat()) {
        if (!item) {
          continue
        }

        const pair = String(item).split(';')[0]
        const index = pair.indexOf('=')

        if (index <= 0) {
          continue
        }

        cookies.set(pair.slice(0, index), pair.slice(index + 1))
      }
    },
  }
}

function decodeText(buffer, contentType) {
  const charset = (
    String(contentType || '').match(/charset=([^;\s]+)/i) || []
  )[1]
  const label = charset ? charset.trim().toLowerCase() : 'utf-8'

  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

function decodeBody(buffer, encoding, contentType) {
  const contentEncoding = String(encoding || '').toLowerCase()
  let body = buffer

  if (contentEncoding.includes('gzip')) {
    body = zlib.gunzipSync(buffer)
  } else if (contentEncoding.includes('deflate')) {
    body = zlib.inflateSync(buffer)
  } else if (contentEncoding.includes('br') && zlib.brotliDecompressSync) {
    body = zlib.brotliDecompressSync(buffer)
  }

  return decodeText(body, contentType)
}

function createHttpClient(baseUrl) {
  const jar = createCookieJar()
  const allowedRedirectHosts = new Set(
    [new URL(baseUrl).host, ...(BWU_CONFIG.allowedRedirectHosts || [])].filter(Boolean),
  )
  const tlsFallbackHosts = new Set(allowedRedirectHosts)
  const tlsFallbackActiveHosts = new Set()
  const tlsFallbackAgents = new Map()

  function getTlsFallbackAgent(host) {
    let agent = tlsFallbackAgents.get(host)

    if (!agent) {
      agent = new https.Agent({ rejectUnauthorized: false })
      tlsFallbackAgents.set(host, agent)
    }

    return agent
  }

  async function request(method, path, body, options = {}) {
    const url = new URL(path || '/', baseUrl)
    const isHttps = url.protocol === 'https:'
    const headers = {
      'User-Agent': 'Mozilla/5.0 MiniProgram Schedule Fetcher',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'identity',
      ...(options.headers || {}),
    }
    const cookie = jar.header()

    if (cookie) {
      headers.Cookie = cookie
    }

    const payload = body ? Buffer.from(String(body)) : undefined

    if (payload) {
      headers['Content-Length'] = payload.length
    }

    const sendRequest = (useTlsFallback) => new Promise((resolve, reject) => {
      const transport = isHttps ? https : http
      const req = transport.request(
        url,
        {
          method,
          headers,
          timeout: options.timeout || 15000,
          agent: isHttps && useTlsFallback ? getTlsFallbackAgent(url.host) : undefined,
        },
        (res) => {
          const chunks = []

          jar.set(res.headers['set-cookie'])
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              data: decodeBody(
                Buffer.concat(chunks),
                res.headers['content-encoding'],
                res.headers['content-type'],
              ),
            })
          })
        },
      )

      req.on('timeout', () => req.destroy(new Error('REQUEST_TIMEOUT')))
      req.on('error', reject)

      if (payload) {
        req.write(payload)
      }

      req.end()
    })
    const useTlsFallback = isHttps && tlsFallbackActiveHosts.has(url.host)
    let response

    try {
      response = await sendRequest(useTlsFallback)
    } catch (error) {
      if (
        isHttps &&
        !useTlsFallback &&
        tlsFallbackHosts.has(url.host) &&
        isRecoverableEduTlsError(error)
      ) {
        tlsFallbackActiveHosts.add(url.host)
        console.warn(
          `Retrying ${url.host} with scoped TLS certificate fallback: ${error.message || error.code}`,
        )
        response = await sendRequest(true)
      } else {
        throw error
      }
    }

    const location = response.headers.location

    if (
      options.followRedirects !== false &&
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      location
    ) {
      const redirectUrl = new URL(location, url)

      if (!allowedRedirectHosts.has(redirectUrl.host)) {
        throw new Error('REDIRECT_ORIGIN_BLOCKED')
      }

      return request('GET', redirectUrl.href, undefined, {
        ...options,
        followRedirects: true,
      })
    }

    return response
  }

  return {
    get(path, options) {
      return request('GET', path, undefined, options)
    },
    post(path, body, options) {
      return request('POST', path, body, options)
    },
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function getTextFromHtml(html) {
  return cleanText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  )
}

function isLoginPage(html) {
  const text = String(html || '')

  return text.includes('loginForm') || text.includes('password') || text.includes('username')
}

function hasInvalidCredentialMessage(html) {
  const text = getTextFromHtml(html)

  return [
    '\u5bc6\u7801\u9519\u8bef',
    '\u7528\u6237\u540d\u6216\u5bc6\u7801',
    '\u8d26\u53f7\u6216\u5bc6\u7801',
    '\u767b\u5f55\u5931\u8d25',
    '\u7528\u6237\u4e0d\u5b58\u5728',
  ].some((keyword) => text.includes(keyword))
}

function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(
    `\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  )
  const match = String(tag || '').match(pattern)

  return match ? match[1] || match[2] || match[3] || '' : ''
}

function normalizeEduHref(href, baseUrl) {
  const value = String(href || '').trim()

  if (!value || /^javascript:/i.test(value) || value === '#') {
    return ''
  }

  try {
    const url = new URL(value, baseUrl)

    if (url.origin !== baseUrl) {
      return ''
    }

    return `${url.pathname}${url.search}`
  } catch {
    return ''
  }
}

async function followLoginRedirect(client, config, location) {
  const path = normalizeEduHref(location, config.baseUrl)

  if (path) {
    await client.get(path)
  }
}

async function fetchLoggedInHome(client, config) {
  const homePage = await client.get(config.homePath).catch(() => null)
  const homeHtml = String(homePage?.data || '')

  if (homeHtml && !isLoginPage(homeHtml)) {
    return homeHtml
  }

  return ''
}

function buildCasLoginPayload(loginHtml, username, password) {
  const form = (String(loginHtml || '').match(/<form[\s\S]*?<\/form>/i) || [''])[0]
  const formOpen = (form.match(/<form[^>]*>/i) || [''])[0]
  const action = getHtmlAttribute(formOpen, 'action') || '/cas/login'
  const params = new URLSearchParams()

  for (const input of form.match(/<input[^>]*>/gi) || []) {
    const name = getHtmlAttribute(input, 'name')

    if (name) {
      params.set(name, getHtmlAttribute(input, 'value'))
    }
  }

  params.set('username', String(username || '').trim())
  params.set('password', String(password || ''))

  if (!params.has('cryptoType')) {
    params.set('cryptoType', '1')
  }

  if (!params.has('_eventId')) {
    params.set('_eventId', 'submit')
  }

  return {
    action,
    body: params.toString(),
  }
}

function isBwuCasLoginSuccess(html) {
  const text = getTextFromHtml(html)

  return text.includes('\u767b\u5f55\u6210\u529f') || text.includes('\u60a8\u5df2\u6210\u529f\u767b\u5f55')
}

function isBwuTooFastPage(html) {
  return getTextFromHtml(html).includes('\u8bf7\u4e0d\u8981\u8fc7\u5feb\u70b9\u51fb')
}

async function loginToBwu(client, config, username, password) {
  for (let attempt = 1; attempt <= BWU_LOGIN_MAX_ATTEMPTS; attempt += 1) {
    const loginPage = await client.get(`${config.casBaseUrl}/cas/login`)
    const loginHtml = String(loginPage.data || '')

    if (!isLoginPage(loginHtml)) {
      throw new Error('BWU_LOGIN_PARAMS_MISSING')
    }

    const loginPayload = buildCasLoginPayload(loginHtml, username, password)
    const loginResponse = await client.post(
      new URL(loginPayload.action, config.casBaseUrl).href,
      loginPayload.body,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${config.casBaseUrl}/cas/login`,
          Origin: config.casBaseUrl,
        },
      },
    )
    const loginBody = String(loginResponse.data || '')

    if (hasInvalidCredentialMessage(loginBody) || !isBwuCasLoginSuccess(loginBody)) {
      throw new Error('BWU_INVALID_CREDENTIALS')
    }

    await client.get(config.portalUrl).catch(() => null)
    await client.get(config.ssoLoginUrl)
    await delay(BWU_REQUEST_DELAY_MS)

    const homeHtml = await fetchLoggedInHome(client, config)

    if (homeHtml) {
      return homeHtml
    }
  }

  throw new Error('BWU_SESSION_INVALID')
}

function parseJsStringLiteral(value) {
  const text = String(value || '').trim()

  if (!text || text === 'null') {
    return ''
  }

  if (text.startsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }

  if (text.startsWith("'")) {
    return text.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }

  return ''
}

function splitJsArguments(argsText) {
  const args = []
  let current = ''
  let quote = ''
  let depth = 0
  let escaped = false

  for (const char of argsText) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    if (quote) {
      current += char
      if (char === quote) {
        quote = ''
      }
      continue
    }

    if (char === '"' || char === "'") {
      current += char
      quote = char
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1
      current += char
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      current += char
      continue
    }

    if (char === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) {
    args.push(current.trim())
  }

  return args
}

function parseWeekRange(weekText) {
  const weeks = []
  const matches = String(weekText || '').match(/\d+\s*(?:-\s*\d+)?/g) || []

  for (const match of matches) {
    const [startText, endText] = match.split('-').map((item) => item.trim())
    const start = Number(startText)
    const end = Number(endText || startText)

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue
    }

    for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
      weeks.push(week)
    }
  }

  return [...new Set(weeks)].sort((a, b) => a - b)
}

function getCourseName(rawName) {
  return String(rawName || '')
    .replace(/\([0-9A-Za-z.]+\)$/, '')
    .trim()
}

function takeTrailingParenthesized(text) {
  const source = String(text || '').trim()
  const match = source.match(/\s*\(([^()]*)\)\s*$/)

  if (!match) {
    return { rest: source, value: '' }
  }

  return {
    rest: source.slice(0, match.index).trim(),
    value: match[1].trim(),
  }
}

function parseCourseInfoText(rawText) {
  let rest = String(rawText || '')
    .trim()
    .replace(/^\{|\}$/g, '')
  const info = {
    name: getCourseName(rest),
    teacher: '',
    location: '',
    weeks: [],
  }
  const weekLocation = takeTrailingParenthesized(rest)

  if (weekLocation.value && /\d/.test(weekLocation.value)) {
    const parts = weekLocation.value.split(/[,\uFF0C]/)
    info.weeks = parseWeekRange(parts.shift())
    info.location = parts.join(' ').trim()
    rest = weekLocation.rest
  }

  const teacher = takeTrailingParenthesized(rest)

  if (teacher.value && !/^[0-9A-Za-z.]+$/.test(teacher.value)) {
    info.teacher = teacher.value
    rest = teacher.rest
  }

  info.name = getCourseName(rest)

  return info
}

function extractTeacherNames(html, activityPosition) {
  const prefix = html.slice(Math.max(0, activityPosition - 1800), activityPosition)
  const matches = [...prefix.matchAll(/var\s+actTeachers\s*=\s*\[([\s\S]*?)\];/g)]
  const latest = matches[matches.length - 1]

  if (!latest) {
    return ''
  }

  return [...latest[1].matchAll(/name\s*:\s*"((?:\\.|[^"\\])*)"/g)]
    .map((match) => parseJsStringLiteral(`"${match[1]}"`))
    .filter(Boolean)
    .join(',')
}

function getWeekNumbers(validWeeks, from, startWeek, endWeek) {
  if (!validWeeks) {
    return []
  }

  let rotatedWeeks = validWeeks

  if (from > 1) {
    const before = validWeeks.substring(0, from - 1)
    rotatedWeeks = validWeeks.substring(from - 1)

    if (before.includes('1')) {
      rotatedWeeks += before
    }

    while (rotatedWeeks.length < validWeeks.length) {
      rotatedWeeks += '0'
    }
  }

  const weeks = []

  for (let week = startWeek; week <= endWeek; week += 1) {
    if (rotatedWeeks.charAt(week - 1) === '1') {
      weeks.push(week)
    }
  }

  return weeks
}

function splitContinuousSections(sections) {
  const sorted = [...new Set(sections)].sort((a, b) => a - b)
  const groups = []

  for (const section of sorted) {
    const latest = groups[groups.length - 1]

    if (!latest || latest[latest.length - 1] + 1 !== section) {
      groups.push([section])
    } else {
      latest.push(section)
    }
  }

  return groups
}

function extractCourseBuilding(value) {
  const text = String(value || '').trim().replace(/\s+/g, '')

  if (!text) {
    return ''
  }

  const numberedTeachingBuilding = text.match(/(教学楼[一二三四五六七八九十\d]+)/)

  if (numberedTeachingBuilding) {
    return numberedTeachingBuilding[1]
  }

  const explicit = text.match(/(.+?(?:教学楼|实验楼|实训楼|楼|馆|中心|校区|院区))/)

  if (explicit) {
    return explicit[1]
  }

  const prefix = text.match(/^([A-Za-z\u4e00-\u9fa5]+)[-_\d]/)
  return prefix ? prefix[1] : text
}

function stripTags(value) {
  return cleanText(String(value || '').replace(/<[^>]+>/g, ' '))
}

function getSemesterSelectSource(html) {
  const match = String(html || '').match(
    /<select\b(?=[^>]*(?:name|id)\s*=\s*["']semester\.id["'])[^>]*>([\s\S]*?)<\/select>/i,
  )

  return match ? match[1] : ''
}

function toSemesterNumber(value) {
  const text = cleanText(value)

  if (text === '2' || text === '二' || text === '两' || text === '下') {
    return '2'
  }

  return '1'
}

function getAcademicTermLabel(value) {
  const text = cleanText(String(value || '').replace(/&nbsp;/gi, ' '))
  const compactText = text.replace(/\s+/g, '')
  const patterns = [
    /(20\d{2})\s*[-~—至]\s*(20\d{2})\s*学年\s*第?\s*([一二两12])\s*学期/,
    /(20\d{2})\s*[-~—至]\s*(20\d{2})[\s_-]*第?\s*([一二两12])\s*学期/,
    /(20\d{2})\s*[-~—至]\s*(20\d{2})[\s._-]+([12])(?:\s*学期)?/,
    /(20\d{2})\s*[-~—至]\s*(20\d{2}).*?([上下])\s*学期/,
  ]

  for (const source of [text, compactText]) {
    for (const pattern of patterns) {
      const match = source.match(pattern)

      if (match) {
        return `${match[1]}-${match[2]} 第${toSemesterNumber(match[3])}学期`
      }
    }
  }

  return ''
}

function getAcademicTermKey(value) {
  const label = getAcademicTermLabel(value)
  const match = label.match(/(20\d{2})-(20\d{2})\s*第([12])学期/)

  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function stripScheduleTermNoise(value) {
  return cleanText(String(value || '').replace(/&nbsp;/gi, ' '))
    .replace(/\s*学生\s*课表\s*/g, ' ')
    .replace(
      /[\s,，、;；|/\\_-]*第?\s*[\d一二三四五六七八九十]+(?:\s*[-~—至]\s*[\d一二三四五六七八九十]+)?\s*周\s*/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .replace(/^[\s,，、;；|/\\_-]+|[\s,，、;；|/\\_-]+$/g, '')
    .trim()
}

function isScheduleTermNoise(value) {
  const text = cleanText(String(value || '').replace(/&nbsp;/gi, ' '))

  if (!text || getAcademicTermLabel(text)) {
    return false
  }

  return stripScheduleTermNoise(text).replace(/[\s,，、;；|/\\_-]+/g, '') === ''
}

function cleanScheduleTermTitle(value) {
  const text = cleanText(String(value || '').replace(/&nbsp;/gi, ' '))
  const academicLabel = getAcademicTermLabel(text)

  if (academicLabel) {
    return academicLabel
  }

  return stripScheduleTermNoise(text)
}

function normalizeSemesterRecord(semester) {
  const id = cleanText(semester.id)
  const rawLabel = cleanText(semester.rawLabel || semester.label || semester.title || (id ? `term ${id}` : ''))
  const label = cleanScheduleTermTitle(rawLabel)

  return {
    ...semester,
    id,
    rawLabel,
    title: label,
    label,
  }
}

function findSemesterByTermText(semesters, value) {
  const key = getAcademicTermKey(value)

  if (!key) {
    return null
  }

  return semesters.find((semester) => {
    return (
      getAcademicTermKey(semester.label) === key ||
      getAcademicTermKey(semester.title) === key ||
      getAcademicTermKey(semester.id) === key
    )
  }) || null
}

function resolveScheduleSemesterId(semesters, requestedId, currentId) {
  const requested = cleanText(requestedId)

  if (requested && semesters.some((semester) => semester.id === requested)) {
    return requested
  }

  const requestedSemester = findSemesterByTermText(semesters, requested)

  if (requestedSemester?.id) {
    return requestedSemester.id
  }

  if (currentId) {
    return currentId
  }

  return requested && !getAcademicTermKey(requested) ? requested : ''
}

function parseSemesters(indexHtml) {
  const html = String(indexHtml || '')
  const semesters = []
  const source = getSemesterSelectSource(html)
  const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
  let option

  while ((option = optionRegex.exec(source)) !== null) {
    const attr = option[1] || ''
    const id = (attr.match(/\bvalue\s*=\s*["']?([^"'\s>]*)/i) || [])[1] || ''
    const label = stripTags(option[2])

    if (!id && !label) {
      continue
    }

    const semester = normalizeSemesterRecord({
      id,
      title: label || `term ${id}`,
      label: label || `term ${id}`,
      selected: /\bselected\b/i.test(attr),
    })

    if (!semester.label || isScheduleTermNoise(label || semester.title)) {
      continue
    }

    semesters.push(semester)
  }

  return semesters
}

function getCurrentSemesterId(indexHtml) {
  const html = String(indexHtml || '')
  const source = getSemesterSelectSource(html)
  const selectedOption =
    (source.match(/<option\b[^>]*selected[^>]*\bvalue\s*=\s*["']?([^"'\s>]*)/i) || [])[1] ||
    (source.match(/<option\b[^>]*\bvalue\s*=\s*["']?([^"'\s>]*)[^>]*selected/i) || [])[1]
  const inputValue =
    (html.match(/name=["']semester\.id["'][^>]*value=["']([^"']*)["']/i) || [])[1] ||
    (html.match(/value=["']([^"']*)["'][^>]*name=["']semester\.id["']/i) || [])[1]
  const calendarValue =
    (html.match(/semesterCalendar\(\{[^}]*value:"([^"]+)"/i) || [])[1]

  return selectedOption || inputValue || calendarValue || ''
}

function createFallbackSemesterId(term) {
  const text = cleanText(term)
  const academicKey = getAcademicTermKey(text)

  if (academicKey) {
    return academicKey
  }

  return text
    ? `term-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 10)}`
    : ''
}

function parseSchedule(scheduleHtml) {
  const html = String(scheduleHtml || '')
  const titleMatch =
    html.match(/<h3[^>]*align=["']center["'][^>]*>([\s\S]*?)<\/h3>/i) ||
    html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
  const term = titleMatch ? cleanScheduleTermTitle(stripTags(titleMatch[1])) : ''
  const marshalMatch = html.match(
    /\.marshalTable\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/,
  )
  const from = marshalMatch ? Number(marshalMatch[1]) : 1
  const startWeek = marshalMatch ? Number(marshalMatch[2]) : 1
  const endWeek = marshalMatch ? Number(marshalMatch[3]) : 25
  const courses = []
  const activityRegex =
    /activity\s*=\s*new\s+TaskActivity\(([\s\S]*?)\);\s*((?:\s*index\s*=\s*\d+\s*\*\s*unitCount\s*\+\s*\d+\s*;\s*table\d+\.activities\[index\]\[table\d+\.activities\[index\]\.length\]\s*=\s*activity\s*;\s*)+)/g
  let match

  while ((match = activityRegex.exec(html)) !== null) {
    const args = splitJsArguments(match[1])
    const rawCourseName = parseJsStringLiteral(args[3])
    const parsedCourseInfo = parseCourseInfoText(rawCourseName)
    const name = parsedCourseInfo.name || getCourseName(rawCourseName)
    const roomName = parseJsStringLiteral(args[5]) || parsedCourseInfo.location
    const validWeeks = parseJsStringLiteral(args[6])
    const teacherName =
      extractTeacherNames(html, match.index) ||
      parseJsStringLiteral(args[1]) ||
      parsedCourseInfo.teacher
    const weeks = getWeekNumbers(validWeeks, from, startWeek, endWeek)
    const activeWeeks = weeks.length > 0 ? weeks : parsedCourseInfo.weeks
    const slotsByDay = new Map()

    for (const slot of match[2].matchAll(
      /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g,
    )) {
      const weekday = Number(slot[1]) + 1
      const section = Number(slot[2]) + 1
      const sections = slotsByDay.get(weekday) || []
      sections.push(section)
      slotsByDay.set(weekday, sections)
    }

    for (const [weekday, sections] of slotsByDay.entries()) {
      for (const sectionGroup of splitContinuousSections(sections)) {
        courses.push({
          id: `${courses.length + 1}`,
          name,
          teacher: teacherName,
          location: roomName,
          classroom: roomName,
          weekday,
          sections: sectionGroup,
          startSection: sectionGroup[0],
          endSection: sectionGroup[sectionGroup.length - 1],
          weeks: activeWeeks,
        })
      }
    }
  }

  return {
    term,
    courses: courses.sort((a, b) => {
      if (a.weekday !== b.weekday) {
        return a.weekday - b.weekday
      }

      return (a.sections?.[0] || 0) - (b.sections?.[0] || 0)
    }),
  }
}

async function fetchBwuSchedule(client, config, semesterId) {
  let indexHtml = ''

  for (let attempt = 1; attempt <= BWU_SCHEDULE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await delay(BWU_REQUEST_DELAY_MS)
    }

    const indexResponse = await client.get(config.scheduleIndexPath)
    indexHtml = String(indexResponse.data || '')

    if (isBwuTooFastPage(indexHtml)) {
      continue
    }

    if (
      indexHtml.includes('bg.form.addInput') ||
      indexHtml.includes('semester.id') ||
      indexHtml.includes('courseTableForStd')
    ) {
      break
    }
  }

  const idsMatch = indexHtml.match(
    /bg\.form\.addInput\(form,\s*["']ids["'],\s*["']([^"']+)["']\)/,
  )

  if (!idsMatch) {
    throw new Error('BWU_SCHEDULE_PARAMS_MISSING')
  }

  let semesters = parseSemesters(indexHtml)
  const currentSemesterId = getCurrentSemesterId(indexHtml)
  const selectedSemesterId = resolveScheduleSemesterId(semesters, semesterId, currentSemesterId)
  const tablePayload = new URLSearchParams({
    ids: idsMatch[1],
    'semester.id': selectedSemesterId,
    'setting.kind': 'std',
    startWeek: '',
  })
  const response = await client.post(
    config.scheduleTablePath,
    tablePayload.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  )
  const parsedSchedule = parseSchedule(response.data)
  const fallbackSemesterId = createFallbackSemesterId(parsedSchedule.term)
  const matchedParsedSemester = findSemesterByTermText(semesters, parsedSchedule.term)
  const normalizedSemesterId = matchedParsedSemester?.id || selectedSemesterId || fallbackSemesterId

  if (
    (normalizedSemesterId || parsedSchedule.term) &&
    !semesters.some((semester) => semester.id === normalizedSemesterId)
  ) {
    semesters = [
      normalizeSemesterRecord({
        id: normalizedSemesterId || '',
        title: parsedSchedule.term || 'current term',
        label: parsedSchedule.term || 'current term',
        selected: true,
      }),
      ...semesters,
    ]
  }

  const selectedSemester =
    semesters.find((semester) => semester.id === normalizedSemesterId) ||
    semesters.find((semester) => semester.selected) ||
    semesters[0]

  return {
    ...parsedSchedule,
    semesters: selectedSemester
      ? [
          {
            ...normalizeSemesterRecord({
              ...selectedSemester,
              title: selectedSemester.title || selectedSemester.label || parsedSchedule.term,
              label: selectedSemester.label || selectedSemester.title || parsedSchedule.term,
            }),
            selected: true,
          },
        ]
      : [],
    selectedSemesterId: normalizedSemesterId,
  }
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim()
    }
  }

  return ''
}

function maskStudentId(studentId) {
  const value = String(studentId || '').trim()

  if (value.length <= 6) {
    return value ? `masked:${value}` : ''
  }

  return `${value.slice(0, 2)}****${value.slice(-2)}`
}

function normalizeLabel(value) {
  return cleanText(value).replace(/[：:]/g, '').replace(/\s+/g, '').trim()
}

function getPairValue(pairs, labels) {
  const entries = Object.entries(pairs || {})

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && exact[1]) {
      return exact[1]
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key)
      return (
        normalizedKey.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedKey)
      )
    })

    if (fuzzy && fuzzy[1]) {
      return fuzzy[1]
    }
  }

  return ''
}

function parseProfile(homeHtml, fallbackStudentId) {
  const text = getTextFromHtml(homeHtml)
  const accountMatch = text.match(
    /([\u4e00-\u9fa5A-Za-z·]{2,30})\(([^)]+)\)\s+([^\s]+)/,
  )
  const name = accountMatch ? accountMatch[1] : ''
  const studentId = accountMatch ? accountMatch[2] : fallbackStudentId
  const role = accountMatch ? accountMatch[3] : '学生'

  return {
    name,
    studentId,
    role,
    maskedStudentId: maskStudentId(studentId),
    major: '',
    grade: '',
    level: '',
    className: '',
    gender: '',
    birthDate: '',
    politicalStatus: '',
    phone: '',
    email: '',
    nativePlace: '',
    enrollmentDate: '',
    studentStatus: '',
    dormitory: '',
    counselor: '',
    updatedAt: new Date().toISOString(),
  }
}

function parseKeyValuePairs(html) {
  const pairs = {}
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch

  function addPair(label, value) {
    const key = normalizeLabel(label)
    const text = cleanText(value)

    if (!key || !text || key.length > 24) {
      return
    }

    pairs[key] = text
  }

  while ((rowMatch = rowRegex.exec(String(html || ''))) !== null) {
    const cells = [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map((match) => stripTags(match[1]))
      .filter(Boolean)

    if (cells.length < 2) {
      continue
    }

    for (let index = 0; index < cells.length - 1; index += 2) {
      addPair(cells[index], cells[index + 1])
    }
  }

  const text = getTextFromHtml(html)
  const labels = [
    '姓名',
    '学号',
    '性别',
    '出生年月',
    '出生日期',
    '政治面貌',
    '手机号',
    '联系电话',
    '邮箱',
    '电子邮箱',
    '籍贯',
    '生源地',
    '入学时间',
    '入学日期',
    '学籍状态',
    '学生状态',
    '宿舍信息',
    '宿舍',
    '辅导员',
    '班级',
    '行政班',
    '专业',
    '专业名称',
    '年级',
    '培养层次',
    '层次',
  ]

  for (const label of labels) {
    const pattern = new RegExp(
      `${label}\\s*[：:]\\s*([^：:]{1,80}?)(?=\\s+(?:${labels.join('|')})\\s*[：:]|$)`,
    )
    const match = text.match(pattern)

    if (match) {
      addPair(label, match[1])
    }
  }

  return pairs
}

function mergeProfile(baseProfile, detailHtml, fallbackStudentId) {
  const pairs = parseKeyValuePairs(detailHtml)
  const studentId =
    firstValue(
      getPairValue(pairs, ['学号', '学籍号']),
      baseProfile.studentId,
      fallbackStudentId,
    ) || fallbackStudentId

  return {
    ...baseProfile,
    name: firstValue(getPairValue(pairs, ['姓名']), baseProfile.name),
    studentId: String(studentId),
    role: firstValue(baseProfile.role, '学生'),
    maskedStudentId: maskStudentId(studentId),
    major: firstValue(getPairValue(pairs, ['专业名称', '专业']), baseProfile.major),
    grade: firstValue(getPairValue(pairs, ['年级']), baseProfile.grade),
    level: firstValue(getPairValue(pairs, ['培养层次', '层次']), baseProfile.level),
    className: firstValue(getPairValue(pairs, ['行政班', '班级']), baseProfile.className),
    gender: firstValue(getPairValue(pairs, ['性别']), baseProfile.gender),
    birthDate: firstValue(getPairValue(pairs, ['出生日期', '出生年月']), baseProfile.birthDate),
    politicalStatus: firstValue(getPairValue(pairs, ['政治面貌']), baseProfile.politicalStatus),
    phone: firstValue(getPairValue(pairs, ['手机号', '联系电话', '电话']), baseProfile.phone),
    email: firstValue(getPairValue(pairs, ['电子邮箱', '邮箱']), baseProfile.email),
    nativePlace: firstValue(getPairValue(pairs, ['籍贯', '生源地']), baseProfile.nativePlace),
    enrollmentDate: firstValue(getPairValue(pairs, ['入学日期', '入学时间']), baseProfile.enrollmentDate),
    studentStatus: firstValue(getPairValue(pairs, ['学籍状态', '学生状态']), baseProfile.studentStatus),
    dormitory: firstValue(getPairValue(pairs, ['宿舍信息', '宿舍']), baseProfile.dormitory),
    counselor: firstValue(getPairValue(pairs, ['辅导员']), baseProfile.counselor),
    updatedAt: new Date().toISOString(),
  }
}

function extractHrefFromOnclick(onclick) {
  const text = String(onclick || '')
  const match =
    text.match(/(?:location\.href|open|href|url)\s*\(?\s*['"]([^'"]+)['"]/i) ||
    text.match(/['"](\/eams\/[^'"]+)['"]/i)

  return match ? match[1] : ''
}

function findEduLinksByKeywords(html, keywords, baseUrl) {
  const source = String(html || '')
  const candidates = []
  const anchorRegex = /<(?:a|area)\b([^>]*)>([\s\S]*?)<\/(?:a|area)>/gi
  let anchor

  while ((anchor = anchorRegex.exec(source)) !== null) {
    const attrs = anchor[1] || ''
    const text = cleanText(`${stripTags(anchor[2])} ${attrs}`)
    const hrefAttr = (attrs.match(/\bhref=["']([^"']+)["']/i) || [])[1]
    const onclick = (attrs.match(/\bonclick=["']([^"']+)["']/i) || [])[1] || ''
    const href =
      normalizeEduHref(hrefAttr, baseUrl) ||
      normalizeEduHref(extractHrefFromOnclick(onclick), baseUrl)

    if (keywords.some((keyword) => text.includes(keyword)) && href) {
      candidates.push(href)
    }
  }

  for (const keyword of keywords) {
    const pattern = new RegExp(`.{0,160}${keyword}.{0,160}`, 'g')
    const snippets = source.match(pattern) || []

    for (const snippet of snippets) {
      const matches = snippet.match(/\/eams\/[^'"<>\s)]+/g) || []
      candidates.push(
        ...matches.map((href) => normalizeEduHref(href, baseUrl)).filter(Boolean),
      )
    }
  }

  return [...new Set(candidates)]
}

async function fetchEduPath(client, path, baseUrl) {
  const normalizedPath = normalizeEduHref(path, baseUrl)

  if (!normalizedPath) {
    return ''
  }

  const response = await client.get(normalizedPath)
  const html = String(response.data || '')

  if (!html || isLoginPage(html)) {
    return ''
  }

  return html
}

async function fetchEduPageByKeywords(client, homeHtml, keywords, fallbackPaths, baseUrl) {
  const paths = [
    ...findEduLinksByKeywords(homeHtml, keywords, baseUrl),
    ...fallbackPaths,
  ]
    .map((path) => normalizeEduHref(path, baseUrl))
    .filter(Boolean)
  const uniquePaths = [...new Set(paths)]

  for (const path of uniquePaths) {
    try {
      const html = await fetchEduPath(client, path, baseUrl)

      if (html) {
        return html
      }
    } catch (error) {
      console.warn('fetch BWU page failed', path, error.message || '')
    }
  }

  return ''
}

async function fetchProfile(client, config, homeHtml, studentId) {
  const fallbackProfile = parseProfile(homeHtml, studentId)
  const profileHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['学籍信息', '个人信息', '基本信息'],
    ['/eams/stdDetail.action', '/eams/stdDetail!info.action', '/eams/home.action'],
    config.baseUrl,
  )

  return profileHtml
    ? mergeProfile(fallbackProfile, profileHtml, studentId)
    : fallbackProfile
}

function getStrictCellByLabels(row, labels) {
  const entries = Object.entries(row || {})

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && exact[1]) {
      return cleanText(exact[1])
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key)

      if (normalizedLabel === '课程' && normalizedKey !== '课程') {
        return false
      }

      return (
        normalizedKey.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedKey)
      )
    })

    if (fuzzy && fuzzy[1]) {
      return cleanText(fuzzy[1])
    }
  }

  return ''
}

function getGradeCellByLabels(row, labels, options = {}) {
  const entries = Object.entries(row || {})
  const negativePattern = options.exclude ? new RegExp(options.exclude) : null

  function canUseKey(key) {
    const normalizedKey = normalizeLabel(key)
    return !negativePattern || !negativePattern.test(normalizedKey)
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && exact[1] && canUseKey(exact[0])) {
      return cleanText(exact[1])
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key)
      return (
        canUseKey(key) &&
        normalizedKey.includes(normalizedLabel) &&
        !normalizedLabel.includes(normalizedKey)
      )
    })

    if (fuzzy && fuzzy[1]) {
      return cleanText(fuzzy[1])
    }
  }

  return ''
}

function isCourseCategoryText(value) {
  return /^(必修课?|选修课?|限选课?|任选课?|公选课?|通识课?|实践课?|专业必修|专业选修|公共必修)$/u.test(
    cleanText(value),
  )
}

function isBadCourseName(value) {
  const text = cleanText(value)

  return (
    !text ||
    isCourseCategoryText(text) ||
    /^(课程名称|课程类别|课程性质|课程属性|成绩|学分|绩点)$/u.test(text) ||
    /^\d+(?:\.\d+)?$/.test(text)
  )
}

function getGradeCourseName(row) {
  const entries = Object.entries(row || {})
  const exactLabels = ['课程名称', '课程名', '科目名称', '考试课程', '教学班名称']

  for (const label of exactLabels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && !isBadCourseName(exact[1])) {
      return cleanText(exact[1])
    }
  }

  const nameLike = entries.find(([key, value]) => {
    const normalizedKey = normalizeLabel(key)

    return (
      /名称|课程名|科目/.test(normalizedKey) &&
      !/类别|性质|属性|序号|代码|编号|学分|成绩|绩点/.test(normalizedKey) &&
      !isBadCourseName(value)
    )
  })

  if (nameLike) {
    return cleanText(nameLike[1])
  }

  const cells = Array.isArray(row.__cells) ? row.__cells : []
  const fallback = cells
    .filter((cell) => !isBadCourseName(cell))
    .filter((cell) => !/20\d{2}\s*-\s*20\d{2}|第?[一二12]学期|已修|通过/.test(cell))
    .sort((a, b) => b.length - a.length)[0]

  return fallback || ''
}

function extractTableRows(html) {
  const rows = []
  const tableMatches = [...String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
  const sources = tableMatches.length ? tableMatches.map((match) => match[1]) : [String(html || '')]

  for (const source of sources) {
    let headers = []
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let row

    while ((row = rowRegex.exec(source)) !== null) {
      const cells = [...row[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((match) => ({
          tag: match[1].toLowerCase(),
          text: stripTags(match[2]),
        }))
      const cellTexts = cells.map((cell) => cell.text)
      const nonEmptyCells = cellTexts.filter(Boolean)

      if (nonEmptyCells.length === 0) {
        continue
      }

      const hasHeaderCell = cells.some((cell) => cell.tag === 'th')
      const looksLikeHeader = nonEmptyCells.some((cell) =>
        /课程|成绩|学分|绩点|考试|时间|地点|座位|学期/.test(cell),
      )

      if ((hasHeaderCell || headers.length === 0) && looksLikeHeader) {
        headers = cellTexts.map((cell, index) => cell || `列${index + 1}`)
        continue
      }

      if (headers.length === 0 || nonEmptyCells.length < 2) {
        continue
      }

      const data = {}

      cellTexts.forEach((cell, index) => {
        data[headers[index] || `列${index + 1}`] = cell
      })
      Object.defineProperty(data, '__cells', {
        value: cellTexts,
        enumerable: false,
      })
      rows.push(data)
    }
  }

  return rows
}

function getTableCell(row, labels) {
  return getStrictCellByLabels(row, labels) ||
    getGradeCellByLabels(row, labels) ||
    ''
}

function parseExamTimeRange(value) {
  const text = cleanText(value)
  const match = text.match(/(\d{1,2})\s*:\s*(\d{2})\s*[~\-—至]\s*(\d{1,2})\s*:\s*(\d{2})/)

  if (!match) {
    return null
  }

  return {
    startHour: match[1].padStart(2, '0'),
    startMinute: match[2],
    endHour: match[3].padStart(2, '0'),
    endMinute: match[4],
    text: `${match[1].padStart(2, '0')}:${match[2]}~${match[3].padStart(2, '0')}:${match[4]}`,
  }
}

function toChinaIso(date, hour, minute) {
  return `${date}T${hour}:${minute}:00+08:00`
}

function parseChinaTimestamp(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/)

  if (!match) {
    return 0
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6]),
  )
}

function isUnscheduledText(value) {
  return /未安排|待安排|暂无|无/.test(cleanText(value))
}

function parseExamRecords(examHtml, now = new Date()) {
  const rows = extractTableRows(examHtml)
  const records = []
  const nowTime = now.getTime()

  for (const row of rows) {
    const cells = Array.isArray(row.__cells) ? row.__cells : []
    const courseCode = getTableCell(row, ['课程序号', '课程代码', '课程编号']) || cleanText(cells[0])
    const courseName = getTableCell(row, ['课程名称', '课程名', '科目']) || cleanText(cells[1])
    const examType = getTableCell(row, ['考试类别', '考试类型']) || cleanText(cells[2])
    const rawDate = getTableCell(row, ['考试日期', '日期']) || cleanText(cells[3])
    const rawTime = getTableCell(row, ['考试安排', '考试时间', '时间']) || cleanText(cells[4])
    const rawLocation = getTableCell(row, ['考试地点', '考场', '地点']) || cleanText(cells[5])
    const rawSeatNo = getTableCell(row, ['考场座位号', '座位号', '座位']) || cleanText(cells[6])
    const rawStatus = getTableCell(row, ['考试情况', '状态']) || cleanText(cells[7])
    const remark = getTableCell(row, ['其它说明', '备注', '说明']) || cleanText(cells[8])
    const dateMatch = cleanText(rawDate).match(/20\d{2}-\d{2}-\d{2}/)
    const date = dateMatch ? dateMatch[0] : ''
    const timeRange = parseExamTimeRange(rawTime)

    if (!courseName || /课程名称|考试类别|考试日期/.test(courseName)) {
      continue
    }

    const startAt = date && timeRange
      ? toChinaIso(date, timeRange.startHour, timeRange.startMinute)
      : ''
    const endAt = date && timeRange
      ? toChinaIso(date, timeRange.endHour, timeRange.endMinute)
      : ''
    const unscheduled =
      !date ||
      !timeRange ||
      isUnscheduledText(rawDate) ||
      isUnscheduledText(rawTime)
    const finished = Boolean(endAt && parseChinaTimestamp(endAt) < nowTime)
    const status = unscheduled ? 'unscheduled' : finished ? 'finished' : 'upcoming'

    records.push({
      courseCode,
      courseName,
      examType,
      date,
      time: timeRange ? timeRange.text : '',
      startAt,
      endAt,
      location: isUnscheduledText(rawLocation) ? '' : cleanText(rawLocation),
      seatNo: isUnscheduledText(rawSeatNo) ? '' : cleanText(rawSeatNo),
      status,
      rawStatus,
      remark: remark || (unscheduled ? '时间未安排' : ''),
    })
  }

  return records
}

function parseExamBatchCandidates(...htmlSources) {
  const candidates = []

  for (const html of htmlSources) {
    const source = String(html || '')

    for (const select of source.matchAll(/<select\b[^>]*name=["']examBatch\.id["'][^>]*>([\s\S]*?)<\/select>/gi)) {
      for (const option of select[1].matchAll(/<option\b[^>]*value=["']?(\d+)/gi)) {
        candidates.push(option[1])
      }
    }

    for (const match of source.matchAll(/examBatch\.id\s*=\s*["']?(\d+)/g)) {
      candidates.push(match[1])
    }

    for (const match of source.matchAll(/[?&]examBatch\.id=(\d+)/g)) {
      candidates.push(match[1])
    }
  }

  return [...new Set(candidates)]
    .sort((left, right) => Number(right) - Number(left))
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildExamResult(examHtml, batchId, now = new Date()) {
  const records = parseExamRecords(examHtml, now)
  const rawLabel = getAcademicTermLabel(examHtml)
  const title = rawLabel ? cleanScheduleTermTitle(rawLabel) : ''
  const upcoming = records
    .filter((record) => record.status !== 'finished')
    .sort((left, right) => {
      const leftTime = parseChinaTimestamp(left.startAt) || Number.MAX_SAFE_INTEGER
      const rightTime = parseChinaTimestamp(right.startAt) || Number.MAX_SAFE_INTEGER
      return leftTime - rightTime || left.courseName.localeCompare(right.courseName, 'zh-Hans-CN')
    })
  const finished = records
    .filter((record) => record.status === 'finished')
    .sort((left, right) => (parseChinaTimestamp(right.startAt) || 0) - (parseChinaTimestamp(left.startAt) || 0))

  return {
    term: {
      id: batchId || '',
      rawLabel,
      title,
      label: title,
      selected: true,
    },
    upcoming,
    finished,
  }
}

function getEmptyExamResult() {
  return {
    term: {
      id: '',
      rawLabel: '',
      title: '',
      label: '',
      selected: true,
    },
    upcoming: [],
    finished: [],
  }
}

function getExamRecordKey(record) {
  return [
    record.courseCode,
    record.courseName,
    record.examType,
    record.date,
    record.time,
    record.location,
    record.seatNo,
  ].map((value) => String(value || '').trim()).join('|')
}

function mergeExamResults(results) {
  const merged = getEmptyExamResult()
  const seen = new Set()

  for (const result of results) {
    if (!merged.term.id && result.term) {
      merged.term = result.term
    }

    for (const status of ['upcoming', 'finished']) {
      for (const record of Array.isArray(result[status]) ? result[status] : []) {
        const key = getExamRecordKey(record)

        if (seen.has(key)) {
          continue
        }

        seen.add(key)
        merged[status].push(record)
      }
    }
  }

  merged.upcoming.sort((left, right) => {
    const leftTime = parseChinaTimestamp(left.startAt) || Number.MAX_SAFE_INTEGER
    const rightTime = parseChinaTimestamp(right.startAt) || Number.MAX_SAFE_INTEGER
    return leftTime - rightTime || left.courseName.localeCompare(right.courseName, 'zh-Hans-CN')
  })
  merged.finished.sort((left, right) => {
    const leftTime = parseChinaTimestamp(left.startAt) || 0
    const rightTime = parseChinaTimestamp(right.startAt) || 0
    return rightTime - leftTime || left.courseName.localeCompare(right.courseName, 'zh-Hans-CN')
  })

  return merged
}

function toNumber(value) {
  const match = String(value || '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function getNumericScore(value) {
  const text = String(value || '').trim()

  if (/^(优秀|优)$/u.test(text)) {
    return 95
  }

  if (/^良好?$/u.test(text)) {
    return 85
  }

  if (/^中等?$/u.test(text)) {
    return 75
  }

  if (/^及格$/u.test(text)) {
    return 60
  }

  if (/^(不及格|缺考|缓考|作弊)$/u.test(text)) {
    return 0
  }

  return toNumber(text)
}

function isLowScore(value) {
  const text = String(value || '').trim()

  if (!text || text === '--') {
    return false
  }

  return (
    (/[\d]/.test(text) && toNumber(text) < 60) ||
    /^(不及格|不合格|缺考|缓考|作弊)$/u.test(text)
  )
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value) || value <= 0) {
    return '--'
  }

  return Number(value.toFixed(digits)).toString()
}

function calculateGpa(score, sourceGpa) {
  const numericScore = getNumericScore(score)

  if (numericScore < 60) {
    return { value: 0, text: '--' }
  }

  const existingGpa = toNumber(sourceGpa)
  const gpa = existingGpa > 0 ? existingGpa : (numericScore - 50) / 10

  return { value: gpa, text: formatNumber(gpa, 1) }
}

function toSemesterDisplayName(value) {
  const semester = toSemesterNumber(value)

  return semester === '2' ? '二' : '一'
}

function normalizeGradeTermTitle(value) {
  const text = cleanText(String(value || '').replace(/&nbsp;/gi, ' '))

  if (!text || text === '未分组学期') {
    return text
  }

  const academicLabel = getAcademicTermLabel(text)

  if (academicLabel) {
    return academicLabel.replace(/第([12])学期/, (_, semester) => `第${toSemesterDisplayName(semester)}学期`)
  }

  const academicMatch = text.match(
    /^(20\d{2})\s*[-~—至]\s*(20\d{2})(?:\s*学年)?[\s._-]*(?:第)?([一二两12上下])(?:\s*学期)?$/,
  )

  if (academicMatch) {
    return `${academicMatch[1]}-${academicMatch[2]} 第${toSemesterDisplayName(academicMatch[3])}学期`
  }

  const semesterOnlyMatch = text.match(/^第?\s*([一二两12上下])\s*学期?$/)

  if (semesterOnlyMatch) {
    return `第${toSemesterDisplayName(semesterOnlyMatch[1])}学期`
  }

  return text
}

function extractGradeRecords(gradesHtml, defaultTerm = '') {
  const rows = extractTableRows(gradesHtml)
  const records = []

  for (const row of rows) {
    const name = getGradeCourseName(row)
    const score = getGradeCellByLabels(
      row,
      ['最终成绩', '总评成绩', '总评', '成绩'],
      { exclude: '绩点|学分' },
    )

    if (!name || !score || isBadCourseName(name)) {
      continue
    }

    records.push({
      term:
        normalizeGradeTermTitle(
          getStrictCellByLabels(row, ['学年学期', '开课学期', '学期', '学年']) ||
          defaultTerm ||
          '未分组学期',
        ),
      name,
      credit: getGradeCellByLabels(row, ['学分', '课程学分'], {
        exclude: '成绩|绩点',
      }),
      score,
      gpa: getGradeCellByLabels(row, ['绩点', '课程绩点'], {
        exclude: '成绩|学分',
      }),
    })
  }

  return records
}

function buildGradesResult(records) {
  const semesters = new Map()
  const seen = new Set()
  const groupedRecordKeys = new Set(
    records
      .filter((record) => record.term && record.term !== '未分组学期')
      .map((record) => [record.name, record.credit, record.score, record.gpa].join('|')),
  )
  let totalCredit = 0
  let weightedScore = 0
  let weightedGpa = 0
  let scoreCredit = 0
  let gpaCredit = 0

  for (const record of records) {
    const basicKey = [record.name, record.credit, record.score, record.gpa].join('|')

    if (
      (!record.term || record.term === '未分组学期') &&
      groupedRecordKeys.has(basicKey)
    ) {
      continue
    }

    const uniqueKey = [record.term, record.name, record.credit, record.score, record.gpa].join('|')

    if (seen.has(uniqueKey)) {
      continue
    }

    seen.add(uniqueKey)

    const term = record.term || '未分组学期'
    const credit = toNumber(record.credit)
    const numericScore = getNumericScore(record.score)
    const scoreLow = isLowScore(record.score)
    const gpa = calculateGpa(record.score, record.gpa)
    const grade = {
      name: record.name,
      credit: record.credit || '--',
      score: record.score,
      scoreLow,
      gpa: gpa.text,
    }

    if (!semesters.has(term)) {
      semesters.set(term, {
        id: `semester-${semesters.size + 1}`,
        title: term,
        creditValue: 0,
        scoreValue: 0,
        scoreCredit: 0,
        gpaValue: 0,
        gpaCredit: 0,
        grades: [],
      })
    }

    const semester = semesters.get(term)
    semester.grades.push(grade)

    if (credit > 0 && !scoreLow) {
      semester.creditValue += credit
      totalCredit += credit

      if (numericScore > 0) {
        semester.scoreValue += numericScore * credit
        semester.scoreCredit += credit
        weightedScore += numericScore * credit
        scoreCredit += credit
      }

      if (gpa.value > 0) {
        semester.gpaValue += gpa.value * credit
        semester.gpaCredit += credit
        weightedGpa += gpa.value * credit
        gpaCredit += credit
      }
    }
  }

  return {
    summary: [
      { label: '总学分', value: formatNumber(totalCredit, 1) },
      { label: '平均分', value: formatNumber(weightedScore / scoreCredit, 2) },
      { label: '绩点', value: formatNumber(weightedGpa / gpaCredit, 2) },
    ],
    semesters: [...semesters.values()].map((semester, index) => ({
      id: semester.id,
      title: semester.title,
      credit: formatNumber(semester.creditValue, 1),
      average: formatNumber(semester.scoreValue / semester.scoreCredit, 2),
      gpa: formatNumber(semester.gpaValue / semester.gpaCredit, 2),
      expanded: index === 0,
      grades: semester.grades,
    })),
  }
}

function mergeGradePages(pages) {
  return buildGradesResult(
    pages.flatMap((page) => extractGradeRecords(page.html, page.term)),
  )
}

function parseGradeSemesters(gradesHtml) {
  const html = String(gradesHtml || '')
  const semesters = []

  function addSemester(id, label) {
    const semesterId = String(id || '').trim()

    if (!semesterId || semesters.some((semester) => semester.id === semesterId)) {
      return
    }

    semesters.push({
      id: semesterId,
      label: cleanText(label) || `学期 ${semesterId}`,
    })
  }

  for (const select of html.matchAll(/<select\b[^>]*(?:name=["']semester(?:\.id|Id)["'])[^>]*>([\s\S]*?)<\/select>/gi)) {
    for (const option of select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      addSemester((option[1].match(/\bvalue=["']?([^"'\s>]*)/i) || [])[1], stripTags(option[2]))
    }
  }

  for (const match of html.matchAll(/[?&]semesterId=([^&#"']+)/g)) {
    addSemester(decodeURIComponent(match[1]), '')
  }

  for (const match of html.matchAll(/semesterId\s*[=:]\s*['"]?(\d+)/g)) {
    const start = Math.max(0, (match.index || 0) - 120)
    const end = Math.min(html.length, (match.index || 0) + 160)
    const label = getTextFromHtml(html.slice(start, end)).match(
      /20\d{2}\s*-\s*20\d{2}\s*(?:学年)?\s*(?:第?[一二12]学期|学期[一二12])?/,
    )

    addSemester(match[1], label ? label[0] : '')
  }

  return semesters
}

function emptyGrades() {
  return {
    summary: [
      { label: '总学分', value: '--' },
      { label: '平均分', value: '--' },
      { label: '绩点', value: '--' },
    ],
    semesters: [],
  }
}

async function fetchGrades(client, config, homeHtml) {
  const gradesHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['我的成绩', '成绩查询', '成绩'],
    [
      '/eams/teach/grade/course/person.action',
      '/eams/teach/grade/course/person!search.action?semesterId=&projectType=',
      '/eams/teach/grade/course/person!historyCourseGrade.action?projectType=MAJOR',
    ],
    config.baseUrl,
  )

  if (!gradesHtml) {
    return emptyGrades()
  }

  const pages = [{ html: gradesHtml, term: '' }]
  const semesters = parseGradeSemesters(gradesHtml)
  const paths = [
    '/eams/teach/grade/course/person!search.action?semesterId=&projectType=',
    '/eams/teach/grade/course/person!historyCourseGrade.action?projectType=MAJOR',
    ...semesters.flatMap((semester) => [
      `/eams/teach/grade/course/person!search.action?semesterId=${encodeURIComponent(semester.id)}&projectType=`,
      `/eams/teach/grade/course/person!search.action?semesterId=${encodeURIComponent(semester.id)}&projectType=MAJOR`,
    ]),
  ]
  const seenPaths = new Set()

  for (const path of paths) {
    if (seenPaths.has(path)) {
      continue
    }

    seenPaths.add(path)

    try {
      const html = await fetchEduPath(client, path, config.baseUrl)

      if (!html) {
        continue
      }

      const semesterId = (path.match(/[?&]semesterId=([^&#]*)/) || [])[1] || ''
      const semester = semesters.find((item) => item.id === decodeURIComponent(semesterId))
      pages.push({
        html,
        term: semester ? semester.label : '',
      })
    } catch (error) {
      console.warn('fetch BWU grades page failed', path, error.message || '')
    }
  }

  const result = mergeGradePages(pages)
  return result.semesters.length > 0 ? result : emptyGrades()
}

function countScoreItems(data) {
  return (data.semesters || []).reduce((count, semester) => {
    return count + (Array.isArray(semester.grades) ? semester.grades.length : 0)
  }, 0)
}

async function fetchExams(client, config, homeHtml) {
  const examIndexHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['考试安排', '考试查询', '考试'],
    [
      '/eams/stdExamTable.action',
      '/eams/stdExamTable!examTable.action?examBatch.id=1428',
    ],
    config.baseUrl,
  )
  const batchIds = parseExamBatchCandidates(examIndexHtml, homeHtml)
  const paths = [
    ...batchIds.map((batchId) => `/eams/stdExamTable!examTable.action?examBatch.id=${encodeURIComponent(batchId)}`),
    '/eams/stdExamTable!examTable.action?examBatch.id=1428',
  ]
  const seenPaths = new Set()
  const results = []
  let requestedPathCount = 0

  for (const path of paths) {
    if (seenPaths.has(path)) {
      continue
    }

    seenPaths.add(path)

    try {
      if (requestedPathCount > 0) {
        await delay(BWU_EXAM_BATCH_REQUEST_DELAY_MS)
      }

      requestedPathCount += 1
      const html = await fetchEduPath(client, path, config.baseUrl)
      const records = parseExamRecords(html)

      if (!records.length) {
        continue
      }

      const batchId = (path.match(/[?&]examBatch\.id=([^&#]*)/) || [])[1] || ''
      results.push(buildExamResult(html, decodeURIComponent(batchId)))
    } catch (error) {
      console.warn('fetch BWU exams page failed', path, error.message || '')
    }
  }

  return results.length ? mergeExamResults(results) : getEmptyExamResult()
}

function countExamItems(data) {
  return (
    (Array.isArray(data.upcoming) ? data.upcoming.length : 0) +
    (Array.isArray(data.finished) ? data.finished.length : 0)
  )
}

function createFeatureCacheData(event, target, data, syncedAt, options = {}) {
  const sourceHash = createSourceHash({
    providerId: event.providerId,
    target,
    termId: options.termId,
    data,
  })

  return {
    cacheData: {
      data,
      meta: {
        source: 'cloud_worker',
        ...(options.meta || {}),
      },
    },
    termId: options.termId,
    sourceHash,
    syncedAt,
  }
}

function createSourceHash(input) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
}

function normalizeTargets(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(
    value
      .map((item) => String(item || '').trim())
      .filter((item) => ['course', 'score', 'exam', 'profile'].includes(item)),
  )]
}

async function fetchTargetCacheResult(target, event, client, config, homeHtml, syncedAt) {
  if (target === 'course') {
    const schedule = await fetchBwuSchedule(client, config, event.semesterId)

    if (!schedule.courses.length) {
      throw new Error('BWU_SCHEDULE_EMPTY')
    }

    const termId = schedule.selectedSemesterId
    const sourceHash = createSourceHash({
      providerId: event.providerId,
      target,
      termId,
      courses: schedule.courses,
    })
    const cacheData = {
      courses: schedule.courses,
      terms: schedule.semesters || [],
    }

    return {
      target: 'course',
      termId,
      cacheData,
      parsedCount: schedule.courses.length,
      sourceHash,
      syncedAt,
    }
  }

  if (target === 'profile') {
    const profile = await fetchProfile(client, config, homeHtml, event.username).catch((error) => {
      console.warn('fetch BWU profile failed', error.message || '')
      return parseProfile(homeHtml, event.username)
    })
    const cache = createFeatureCacheData(event, 'profile', profile, syncedAt)

    return {
      target: 'profile',
      termId: cache.termId,
      cacheData: cache.cacheData,
      parsedCount: Object.keys(profile).filter((key) => profile[key]).length,
      sourceHash: cache.sourceHash,
      syncedAt: cache.syncedAt,
    }
  }

  if (target === 'score') {
    const score = await fetchGrades(client, config, homeHtml).catch((error) => {
      console.warn('fetch BWU grades failed', error.message || '')
      return emptyGrades()
    })
    const cache = createFeatureCacheData(event, 'score', score, syncedAt)

    return {
      target: 'score',
      termId: cache.termId,
      cacheData: cache.cacheData,
      parsedCount: countScoreItems(score),
      sourceHash: cache.sourceHash,
      syncedAt: cache.syncedAt,
    }
  }

  const exam = await fetchExams(client, config, homeHtml).catch((error) => {
    console.warn('fetch BWU exams failed', error.message || '')
    return getEmptyExamResult()
  })
  const cache = createFeatureCacheData(event, 'exam', exam, syncedAt, {
    termId: exam.term?.id,
    meta: {
      scope: 'current_term_only',
    },
  })

  return {
    target: 'exam',
    termId: cache.termId,
    cacheData: cache.cacheData,
    parsedCount: countExamItems(exam),
    sourceHash: cache.sourceHash,
    syncedAt: cache.syncedAt,
  }
}

async function runBwuProviderSync(event) {
  const targets = normalizeTargets(event.targets)

  if (!targets.length) {
    return fail(
      'TARGET_UNSUPPORTED',
      'BWU cloud sync supports targets course, score, exam and profile only.',
      { unsupported: true },
    )
  }

  const config = BWU_CONFIG
  const client = createHttpClient(config.baseUrl)

  const homeHtml = await loginToBwu(client, config, event.username, event.password)
  const syncedAt = new Date().toISOString()
  const cacheResults = []

  for (const target of targets) {
    cacheResults.push(
      await fetchTargetCacheResult(target, event, client, config, homeHtml, syncedAt),
    )
  }

  return ok({
    cacheResults,
    ...(event.source === FRONTEND_IMPORT_SOURCE
      ? { cloudProof: createCloudProof(event, cacheResults) }
      : {}),
  })
}

async function handleEvent(event) {
  try {
    assertAuthorized(event || {})

    if (!event || !event.providerId || !Array.isArray(event.targets) || !event.username || !event.password) {
      return fail(
        'SYNC_INPUT_INVALID',
        'providerId, targets, username and password are required',
      )
    }

    if (event.providerId !== 'bwu') {
      return fail(
        'PROVIDER_NOT_FOUND',
        `syncBwu only supports providerId bwu, got ${event.providerId}.`,
        { unsupported: true },
      )
    }

    return await runBwuProviderSync(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLOUD_SYNC_FAILED'
    const code = message.includes(':') ? message.split(':')[0] : message

    return fail(code || 'CLOUD_SYNC_FAILED', message)
  }
}

exports.main = async function main(event) {
  if (!isHttpEvent(event)) {
    return handleEvent(event)
  }

  try {
    const method = String(event.httpMethod || event.requestContext?.httpMethod || 'POST')
      .toUpperCase()

    if (method !== 'POST') {
      if (method === 'OPTIONS') {
        return httpResponse(204, {})
      }

      return httpResponse(405, fail('METHOD_NOT_ALLOWED', 'Only POST is supported'))
    }

    const body = parseHttpBody(event)
    const result = await handleEvent({
      ...body,
      headers: event.headers || {},
    })

    return httpResponse(result.ok ? 200 : 400, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLOUD_SYNC_FAILED'

    return httpResponse(400, fail('CLOUD_SYNC_FAILED', message))
  }
}
