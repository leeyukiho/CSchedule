# WTBU Provider 适配记录

## 基本信息

```text
schoolId: wtbu
学校名称: 武汉工商学院
教务系统: EAMS
入口地址: https://jxgl.wtbu.edu.cn/eams/home.action
当前实现: wxapp/cloudfunctions/getSchedule/index.js
最近本地验证: 2026-06-12
```

当前 `wxapp` 已经通过微信云函数完成 WTBU 适配。后续迁移到 NestJS 时，应优先把这份实现拆成 `wtbuProvider`，不要重写业务假设。

## 支持能力

```json
{
  "id": "wtbu",
  "name": "武汉工商学院",
  "providerId": "wtbu",
  "loginMode": "direct_password",
  "capabilities": {
    "course": true,
    "score": true,
    "exam": true,
    "profile": true
  }
}
```

说明：

- 当前登录不需要图形验证码。
- 当前登录属于 `direct_password`，但提交逻辑是 WTBU EAMS 专用实现：需要提取动态 salt，并提交 `SHA1(salt + password)`。
- 当前课表通过 EAMS `TaskActivity` 脚本解析。
- 当前成绩、考试、个人信息通过页面关键词发现和表格解析获取。
- 当前实现会加密保存教务系统密码，用于后续自动刷新。

## 当前 wxapp 数据流

```text
pages/login
  -> utils/api.callGetSchedule({ action: "bind" })
  -> cloudfunctions/getSchedule.bindAccount()
  -> loginToEduSystem()
  -> fetchScheduleByCredentials()
  -> parseSchedule()
  -> saveBinding()
  -> pages/schedule 展示缓存
```

已绑定用户打开课表：

```text
pages/home 或 pages/schedule
  -> utils/dataStore.loadSchedule()
  -> cloudfunctions/getSchedule 默认 refresh
  -> readBinding(openid)
  -> decryptPassword()
  -> fetchScheduleByCredentials()
  -> updateScheduleCache()
  -> 前端本地 storage 缓存
```

当前云数据库集合：

```text
eduAccountBindings
  docId: openid
  studentId
  passwordCipher
  profile
  lastSchedule
  lastExams
  lastGrades
  lastFetchedAt
  createdAt
  updatedAt
```

迁移到后端后建议拆分为：

```text
User
UserSchoolBinding
CourseCache
FeatureCache
SyncRecord
```

## WTBU 登录流程

当前实现位置：

```text
wxapp/cloudfunctions/getSchedule/index.js
  createEduClient()
  loginToEduSystem()
```

关键点：

- 固定 `baseUrl` 为 `https://jxgl.wtbu.edu.cn`
- 先请求 `/eams/home.action` 获取登录页
- 从登录页脚本中提取动态 salt
- 使用 `SHA1(salt + password)` 提交
- POST `/eams/login.action`
- 登录后再次请求 `/eams/home.action` 判断是否仍在登录页

迁移时建议拆成：

```text
wtbu.login.ts
  createLoginContext()
  submitLogin()
  validateSession()
```

注意：

- 当前学校 HTTPS 证书链在 Node.js 下不完整，现有实现对 WTBU 专用 HTTP client 设置了 `rejectUnauthorized: false`。
- 这个 TLS 兼容配置必须限定在 WTBU 域名，不能作为全局 HTTP client 默认行为。
- 日志不能输出账号、密码、Cookie、salt、token。

## WTBU 课表流程

当前实现位置：

```text
wxapp/cloudfunctions/getSchedule/index.js
  fetchSchedule()
  parseSchedule()
  parseWeekRange()
  getWeekNumbers()
  splitContinuousSections()
```

请求路径：

```text
GET  /eams/courseTableForStd.action
POST /eams/courseTableForStd!courseTable.action
```

关键参数：

- `ids`
- `semester.id`
- `setting.kind=std`
- `startWeek`

当前解析方式：

- 从课表首页提取 `ids` 和当前学期。
- 请求课程表页面。
- 从返回 HTML/JS 中解析 `TaskActivity`。
- 解析课程名、教师、教室、星期、节次和周次。
- 输出前端可直接渲染的课程数组。

迁移后建议统一模型：

```ts
interface Course {
  id?: string
  name: string
  teacher?: string
  classroom?: string
  weekday: number
  startSection: number
  endSection: number
  weeks: number[]
  rawWeeks?: string
  campus?: string
  remark?: string
  source?: unknown
}
```

## 成绩、考试、个人信息

当前实现已经有成绩、考试、个人信息解析，但多学校扩展时应把它们放在课表之后处理。

当前相关函数：

```text
fetchGrades()
parseGrades()
mergeGradePages()
parseExams()
fetchProfile()
mergeProfile()
```

迁移建议：

- `course` 作为第一阶段强能力。
- `score` 和 `exam` 可以保留接口设计，但实现顺序排在课表稳定之后。
- 前端能力展示应读取后端 `capabilities`，不要写死所有学校都有成绩和考试。

## 已知风险

- WTBU EAMS 登录页脚本变化后，动态 salt 提取可能失败。
- 课表页面 `TaskActivity` 脚本结构变化后，解析可能失败。
- 学校证书链问题需要专用 TLS 兼容处理。
- 当前请求式刷新会在用户打开或下拉刷新时直连学校系统，用户多时容易不稳定。
- 当前长期保存教务密码，虽然已加密；迁移后第一版默认不长期保存学校密码，优先保存 `CourseCache`，失效时提示重新登录。
- 当前 `eduAccountBindings` 以 `openid` 为文档 ID，只支持一个微信用户绑定一个学校账号；多学校时必须引入 `bindingId`。

## 迁移检查清单

```text
[ ] 把 WTBU 常量从云函数中提取到 provider 配置
[ ] 把 HTTP client、CookieJar、TLS 兼容配置封装为 WTBU 专用 client
[ ] 把 loginToEduSystem 拆成登录上下文、提交登录、Session 校验
[ ] 把 fetchSchedule 和 parseSchedule 拆成抓取层和 Parser 层
[ ] 为 parseSchedule 增加样例 HTML 或 JS 片段测试
[ ] 把 openid 单绑定模型迁移为 UserSchoolBinding
[ ] 课表读取优先返回 CourseCache
[ ] 手动同步改成创建 SyncRecord，并完成 Provider 抓取、解析和 CourseCache 写入
[ ] Provider 错误转换成统一错误码
[ ] 前端学校列表从 GET /schools 获取
```

## 增加下一所学校时的对照项

新增学校前先复制本文件模板，并至少确认：

- 登录地址
- 教务系统类型
- 是否需要验证码
- 是否支持后端账号密码登录
- 是否必须 WebView
- 课表入口和参数
- 原始课表格式是 HTML、JSON、JS 还是 Excel
- 学期参数如何获取
- Session 是否容易过期
- 是否存在证书、IP、UA、设备指纹限制
