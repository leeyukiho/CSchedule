# Provider 扩展规范

本文档按当前源码整理，目标是让新增学校 provider 能被后端真实注册、登录、同步并落库。

## 1. 必须改动的位置

新增一个学校通常只改 3 处：

1. 新建 adapter：`backend/src/modules/providers/adapters/<providerId>.provider.ts`
2. 注册 provider：`backend/src/modules/providers/providers.module.ts`
3. 写入学校种子：`backend/prisma/seed-schools.ts` 的 `CONNECTED_SCHOOLS`

`providerId` 必须全局唯一，并且 adapter、`meta.providerId`、学校 seed 的 `providerId` 保持一致。

## 2. 当前真实调用链

`direct_password` 学校的登录和同步链路是：

`AuthService.submitLogin` -> `CourseSyncService.fetchAndCacheByCredentials` -> `ProviderRegistryService.getProvider(providerId)` -> `provider.course.fetchByCredentials(...)` -> 写入 `CourseCache` / `FeatureCache`

注意：

- 当前直接密码登录不会调用 `provider.login`。
- `course.fetchByCredentials` 是 direct_password provider 的核心必需接口。
- 手动同步接口目前只支持 `course`、`score`、`profile`；`exam` 类型存在，但 `SyncService` 暂未开放独立手动同步。
- `course.fetchByCredentials` 可以通过 `features` 顺带返回 `score`、`exam`、`profile`，这些会被写入 `FeatureCache`。

## 3. Provider 对象最低结构

```ts
import {
  CourseConnector,
  CourseFetchResult,
  SchoolProvider,
} from '../provider.types'

const xxxCourseConnector: CourseConnector = {
  async fetchByCredentials(input): Promise<CourseFetchResult> {
    // input: username, password, semesterId?, allSemesters?, providerConfig?
    return {
      schedule: {
        term: '2025-2026 第一学期',
        selectedSemesterId: '2025-1',
        semesters: [
          { id: '2025-1', title: '2025-2026 第一学期', selected: true },
        ],
        courses: [],
      },
      profile: null,
    }
  },
}

export const xxxProvider: SchoolProvider = {
  id: 'xxx',
  meta: {
    id: 'xxx',
    name: '学校全称',
    shortName: '学校简称',
    providerId: 'xxx',
    loginMode: 'direct_password',
    eduSystemType: 'eams',
    status: 'enabled',
    verifiedAt: '2026-06-15T00:00:00.000Z',
    capabilities: { course: true, score: false, exam: false, profile: false },
    dataAccess: {
      course: ['server_session'],
      score: [],
      exam: [],
      profile: [],
    },
  },
  course: xxxCourseConnector,
}
```

## 4. `fetchByCredentials` 入参

```ts
{
  username: string
  password: string
  semesterId?: string
  allSemesters?: boolean
  providerConfig?: Record<string, unknown>
}
```

约定：

- `providerConfig` 来自数据库 `School.config.provider`，用于放 `baseUrl`、接口路径、系统类型、验证码配置等学校差异。
- `semesterId` 是用户指定学期；provider 应尽量按该学期拉取。
- `allSemesters=true` 时，provider 可以返回 `schedules`，用于一次缓存多个学期。
- 登录失败要抛出包含“学号或密码错误 / 用户名或密码错误 / invalid credential”等语义的 `Error`，后端会识别为 `INVALID_CREDENTIAL`。

## 5. 课程返回结构

`CourseFetchResult`：

```ts
{
  schedule: ProviderSchedule
  schedules?: ProviderSchedule[]
  profile?: ProviderProfile | null
  features?: {
    score?: ProviderScoreResult
    exam?: unknown[]
    profile?: ProviderProfile
  }
}
```

`schedule` 永远必填。`schedules` 可选；如果存在且非空，落库时会用 `schedules`，否则只写 `schedule`。

`ProviderSchedule`：

```ts
{
  term?: string
  selectedSemesterId?: string
  semesters?: Array<{ id: string; title?: string; label?: string; selected?: boolean }>
  courses: ProviderCourse[]
  sectionTimes?: unknown[]
}
```

`ProviderCourse` 规范：

```ts
{
  id?: string
  name: string
  teacher?: string
  location?: string
  classroom?: string
  weekday: number
  sections?: number[]
  startSection?: number
  endSection?: number
  weeks: number[]
  rawWeeks?: string
  campus?: string
  remark?: string
  source?: unknown
}
```

要求：

- `name`、`weekday`、`weeks` 必须可靠。
- `weekday` 使用数字，保持和教务源一致；现有落库只转数字，不做星期语义修正。
- `sections` 优先；没有时必须给 `startSection` / `endSection`，否则节次为空。
- `weeks` 必须是数字数组，不要只返回原始周次文本。
- `source` 可以保存原始行数据，便于排查解析问题。

## 6. 考试、成绩和资料接口

考试数据当前推荐从课程同步顺带返回：

```ts
return {
  schedule,
  features: {
    exam: [
      {
        name: '高等数学',
        date: '2026-01-10',
        time: '09:00-11:00',
        location: '一教 101',
        seat: '12',
        remark: '',
        source: rawExamRow,
      },
    ],
  },
}
```

说明：

- `provider.types.ts` 里预留了 `exam?: FeatureConnector<unknown[]>`。
- `CourseSyncService` 会把 `course.fetchByCredentials` 返回的 `features.exam` 写入 `FeatureCache`。
- 但 `SyncService.createManualSync` 目前只开放 `course`、`score`、`profile`，所以独立 `exam` 手动同步暂不可用。
- 因此要让考试数据在当前系统可用，必须在课程同步结果里返回 `features.exam`。

独立成绩同步需要实现：

```ts
score: {
  async fetchByCredentials(input) {
    return {
      data: {
        summary: [{ label: '平均分', value: '90' }],
        semesters: [
          {
            id: '2025-1',
            title: '2025-2026 第一学期',
            credit: '20',
            average: '90',
            gpa: '3.8',
            grades: [
              { name: '高等数学', credit: '4', score: '95', gpa: '4.0' },
            ],
          },
        ],
      },
      termId: '2025-1',
      meta: { source: 'server_session' },
    }
  },
}
```

独立资料同步需要实现：

```ts
profile: {
  async fetchByCredentials(input) {
    const data = {
      name: '张三',
      studentId: '20250001',
      maskedStudentId: '20****01',
      major: '计算机科学与技术',
      className: '计科 2501',
    }

    return {
      data,
      profile: data,
      meta: { source: 'server_session' },
    }
  },
}
```

如果只在课程同步时拿得到资料或成绩，也可以从 `course.fetchByCredentials` 的 `profile` / `features` 返回。

## 7. HTTP 和解析约定

优先使用项目已有工具：

- `createProviderHttpClient({ baseUrl, timeout, rejectUnauthorized })`：带 CookieJar、重定向、默认 UA。
- `cleanText`：清理空白。
- `firstValue`：按候选字段取第一个非空值。
- `parseWeekRange`：把 `1-16周` 之类文本转为周次数组。
- `parseSections`：把 `1-2节` 之类文本转为节次数组。
- `maskStudentId`：生成脱敏学号。

不要在多个请求之间新建 HTTP client；登录、拉课表、拉资料应复用同一个 client，保证 Cookie 会话连续。

## 8. Provider meta 必须和能力一致

`capabilities` 和 `dataAccess` 决定前端展示与后端可用性：

```ts
capabilities: { course: true, score: true, exam: false, profile: true },
dataAccess: {
  course: ['server_session'],
  score: ['server_session'],
  exam: [],
  profile: ['server_session'],
}
```

规则：

- 未实现 connector 的能力必须写 `false`，对应 `dataAccess` 写空数组。
- 实现 `score` / `profile` connector 后，才把对应能力打开。
- `featureDisplay` 可选；不写时后端会使用默认展示配置。
- `credentialSave.passwordVaultAllowed=true` 时，必须确认该 provider 能稳定用账号密码后台同步。

## 9. 注册 provider

在 `providers.module.ts` 中导入并注册：

```ts
import { xxxProvider } from './adapters/xxx.provider'

registry.register(xxxProvider)
```

没有注册时，后端会在同步时抛出 `Provider not found: xxx`。

## 10. 学校 seed 规范

在 `backend/prisma/seed-schools.ts` 的 `CONNECTED_SCHOOLS` 新增：

```ts
{
  id: 'xxx',
  catalogCode: '教育部学校代码',
  name: '学校全称',
  shortName: '学校简称',
  province: '省份',
  city: '城市',
  aliases: ['学校全称', '简称', 'XXX'],
  providerId: 'xxx',
  loginMode: 'direct_password',
  eduSystemType: 'eams',
  homepageUrl: 'https://...',
  authUrl: 'https://...',
  verifiedAt: '2026-06-15T00:00:00.000Z',
  capabilities: { course: true, score: false, exam: false, profile: true },
  dataAccess: {
    course: ['server_session'],
    score: [],
    exam: [],
    profile: ['server_session'],
  },
  providerConfig: {
    baseUrl: 'https://...',
    system: 'EAMS',
    authConfig: {
      captchaRequired: false,
      captchaKind: 'none',
      uiPreset: 'password',
      passwordTransform: 'plain',
    },
  },
}
```

seed 会把 `providerConfig` 写入 `School.config.provider`。provider 运行时通过 `input.providerConfig` 读取这些值。

## 11. 验收清单

新增 provider 必须至少验证：

1. `npm run build` 在 `backend` 目录通过。
2. `npm run seed:schools` 后，`GET /schools?keyword=<学校名>` 能看到学校且 `enabled=true`。
3. `POST /schools/:schoolId/login-context` 返回正确登录字段。
4. 使用真实测试账号调用登录，能写入课程缓存。
5. 课程至少覆盖：单双周、连续周、非连续周、跨多节、无教室、实践课或无固定节次。
6. 密码错误时返回认证失败语义，而不是被误判为普通同步失败。
7. 若开启 `allSemesters`，确认返回的 `schedules` 不包含未来学年，且学期 ID 稳定。

## 12. 不要做的事

- 不要只改学校目录而不注册 provider。
- 不要把未实现的 `score` / `profile` 标成 `true`。
- 不要把原始 HTML 或教务系统字段直接当最终课程字段返回。
- 不要在 provider 内写数据库；provider 只负责登录教务系统并返回标准数据。
- 不要把验证码、CAS、OAuth 等预留类型写成已支持，除非确认当前后端链路已经接入。
