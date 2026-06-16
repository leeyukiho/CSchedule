# Provider、云函数解析与自动同步优化方案

## 背景

当前项目的核心约束是：

- 自有服务器规格较低，约 2 核 2G、4M 带宽、300G 月流量。
- 学校 provider 差异很大，大多数学校需要单独适配。
- 部分大型教务系统可以复用抓取框架，但页面、接口、字段仍可能有学校级差异。
- 希望首次导入后，用户日常查看课表、成绩、考试、个人资料尽量完全读本地缓存。
- 希望自动同步由后端发任务，不依赖前端常驻。
- 不希望每新增一个学校都重新提交小程序审核。
- 希望云函数额度用于高价值任务，而不是被日常读取消耗。

本方案默认采用：

```text
前端本地缓存 + 通用导入容器
后端账号/任务/配置/数据库
云函数解析与可选同步执行
每校独立 provider 为主，教务系统模板复用为辅
```

## 目标

1. 普通查看不请求服务器。
2. 首次导入优先保证用户立即可用。
3. 后端只负责发任务、保存状态、控制限流和接收结果。
4. provider 扩展不绑定小程序发版。
5. 自动同步只给真正支持稳定账号密码登录的学校开放。
6. 云函数调用次数只用于导入解析和同步 worker，不用于日常页面读取。

## 总体架构

```text
用户打开页面
  -> 前端读取 Taro 本地缓存
  -> 无网络请求

首次导入 / 手动导入
  -> 前端 WebView 或学校页面采集 raw payload
  -> 前端可解析则本地解析
  -> 前端不可解析则直连云函数解析
  -> 前端写入本地缓存
  -> 后台小包上传后端保存

手动同步 / 自动同步
  -> 后端创建 SyncJob
  -> 后端按学校、账号、target 限流
  -> 后端分发给本机 worker 或云函数 worker
  -> worker 调 provider 拉取学校数据
  -> worker 返回标准缓存数据
  -> 后端写 CourseCache / FeatureCache
  -> 用户下次打开仍默认读本地缓存
```

关键原则：

- 前端不作为自动同步执行环境。
- 服务器不代理大体积 raw payload 到云函数。
- 云函数不承担日常读取流量。
- provider 不直接操作用户数据库。
- parser 只解析 raw payload，不做登录、鉴权和数据库写入。

## 首次导入策略

### 推荐链路

```text
WebView 抓取 raw payload
  -> normalize locally if parser exists
  -> setStoredDataCache(...)
  -> upload normalized cache or raw summary to backend
  -> backend stores cache / account status
```

如果前端没有对应 parser：

```text
WebView 抓取 raw payload
  -> call cloud parser directly
  -> cloud parser returns normalized cacheData
  -> setStoredDataCache(...)
  -> upload normalized cache or sourceHash to backend
```

### 为什么不是全部后端解析

全部后端解析的问题是：

- 4M 带宽会承受首次导入的大 payload。
- 导入高峰会把 CPU、数据库和网络同时压在小服务器上。
- 后端失败会影响用户第一次可用。

首次导入应以“用户本地先可用”为第一目标。后端持久化是增强能力，不应阻塞用户基础使用。

### 前端解析和云函数解析的边界

前端适合：

- 已经是结构化 JSON 的课表、成绩、考试、个人资料。
- 字段映射简单、数据量小、规则稳定的学校。
- 可用声明式规则完成的表格列映射。

云函数适合：

- HTML 结构复杂。
- 需要 Cheerio、正则组合、编码处理、表格合并等逻辑。
- 需要复用 Node 生态依赖。
- 学校差异经常变化，且不希望发小程序审核。

不建议：

- 在前端放大量学校专用复杂 parser。
- 让小程序为了新增学校频繁发版。
- 让自有后端转发 raw payload。

## 自动同步策略

自动同步只适用于以下学校：

- `credentialSave.passwordVaultAllowed = true`
- `credentialSave.autoSync = password_login`
- provider 能用账号密码稳定登录。
- 不依赖每次人工验证码、扫码、强 WebView 行为。
- 学校系统没有明显禁止或高风险限制。

不适合自动同步的学校：

- 每次登录都需要验证码。
- 需要短信、扫码、设备确认。
- 强依赖 WebView 行为。
- IP、设备、Cookie 风控明显。
- 登录流程频繁变化。

### 后端发任务模型

```text
cron / admin trigger / user manual sync
  -> SyncService.createJob(accountId, target)
  -> SyncScheduler picks due jobs
  -> SyncDispatcher chooses executor
  -> executor runs provider
  -> result writes cache
```

任务状态：

```ts
type SyncJobStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'need_login'
  | 'need_webview_fetch'
  | 'rate_limited'
  | 'cancelled'
```

任务去重 key：

```text
sync:{accountId}:{target}:{termId || latest}
```

同一个账号、同一个 target 同一时间只允许一个任务运行。

### 执行位置选择

本机 worker 适合：

- 调用量低。
- provider 依赖简单。
- 目标学校响应快。
- 不需要绕开服务器带宽。

云函数 worker 适合：

- 首次导入解析高峰。
- HTML 解析 CPU 较重。
- 希望弹性承接突发。
- 学校 provider 代码频繁更新，但不想动小程序。

默认建议：

```text
手动同步：后端发任务，优先本机 worker；高峰或重 parser 可切云函数。
自动同步：后端发任务，稳定学校可用云函数 worker 执行。
首次导入解析：前端本地 parser 优先，云函数 parser 兜底。
```

## Provider 设计

### Provider 分层

```text
ProviderDefinition
  -> 学校能力、登录方式、同步策略、parser 策略

ProviderAdapter
  -> 真正访问学校系统
  -> fetchByCredentials / fetchBySession / fetchByWebviewPayload

Parser
  -> raw payload -> normalized cacheData
  -> 不登录、不写库

DisplaySchema
  -> 前端如何展示字段
```

### 每校独立 provider 为主

因为多数学校差异较大，默认一个学校一个 provider：

```text
wtbu.provider.ts
whggvc.provider.ts
school_x.provider.ts
school_y.provider.ts
```

每个 provider 独立声明：

```ts
{
  providerId: 'school_x',
  schoolId: 'school_x',
  eduSystemType: 'custom' | 'eams' | 'urp' | 'jwxt' | 'zhjw',
  capabilities: {
    course: true,
    score: false,
    exam: false,
    profile: false,
  },
  dataAccess: {
    course: ['webview_client_fetch', 'server_session'],
    score: [],
    exam: [],
    profile: [],
  },
  credentialSave: {
    passwordVaultAllowed: true,
    autoSync: 'password_login',
    scheduledSyncSupported: true,
  },
  syncPolicy: {
    minIntervalHours: 12,
    maxConcurrentPerSchool: 1,
    maxAutoSyncPerDay: 1,
  },
}
```

### 教务系统模板复用

对大型教务系统，不直接假设完全一致，而是做模板 + 学校覆写：

```text
providers/templates/eams/
  login.ts
  course.ts
  score.ts
  parser.ts

providers/adapters/school_x.provider.ts
  -> extends eams template
  -> override baseUrl / paths / fieldMap / selectors
```

适合复用的部分：

- 登录入口发现。
- 统一认证跳转处理。
- 学期列表解析。
- 通用表格课程解析。
- 成绩表字段映射。

需要学校覆写的部分：

- `baseUrl`
- 登录路径
- 课表接口路径
- 学期参数名
- 表格列顺序
- 编码和时间节次
- 异常提示识别

## Provider 注册与扩展方式

### 小程序侧保持通用

小程序前端只保留：

- 学校选择。
- 通用登录页。
- 通用 WebView 导入页。
- 通用课表/成绩/考试/个人资料展示。
- 本地缓存读写。
- 根据后端返回的 schema 渲染字段。

新增学校不改小程序代码。

### 后端/云端扩展

新增学校优先只改：

1. 学校目录配置。
2. provider definition。
3. parser definition。
4. 如有必要，新增 provider adapter 代码。

如果是声明式 parser：

- 只改数据库或远程配置。
- 不部署后端代码。
- 不提交小程序审核。

如果是代码 provider：

- 部署后端或云函数代码。
- 不提交小程序审核。

## Parser 设计

Parser 输入：

```ts
interface RawPayloadEnvelope {
  schoolId: string
  providerId: string
  target: 'course' | 'score' | 'exam' | 'profile'
  contentType: 'json' | 'html' | 'text'
  sourceUrl?: string
  termId?: string
  payload: unknown
  meta?: Record<string, unknown>
}
```

Parser 输出：

```ts
type ParserResult =
  | TimetableCacheResponse
  | FeatureCacheResponse
```

Parser 类型：

```ts
type ParserKind =
  | 'frontend_builtin'
  | 'cloud_function'
  | 'backend_builtin'
  | 'declarative'
```

推荐优先级：

```text
declarative frontend parser
  -> frontend_builtin
  -> cloud_function
  -> backend_builtin fallback
```

后端 builtin 只作为兜底，不作为大流量入口。

## 云函数使用策略

云函数可以自己写代码，适合承接：

- 复杂解析。
- 重 HTML 标准化。
- 稳定学校自动同步 worker。
- 临时 hotfix parser。

调用次数控制：

- 日常查看：0 次云函数。
- 首次导入：每个 target 最多 1 次云函数。
- 手动同步：用户主动触发才调用。
- 自动同步：只同步活跃用户。
- 7 天未打开用户暂停自动同步。
- 同一账号每天自动同步最多 1 次。
- 同一学校并发默认 1。

如果月额度是 20 万次，按调用估算：

```text
1 次完整导入只解析 course：约 200,000 人次/月
1 次完整导入解析 course + score + exam + profile：约 50,000 人次/月
每用户每月 1 次导入 + 2 次同步，每次 1 target：约 66,000 MAU
每用户每月 1 次导入 + 2 次同步，每次 4 target：约 16,000 MAU
```

实际应保守按 30%-50% 预算使用，留出失败重试和调试调用。

## 同步频率建议

默认策略：

```text
课程：12-24 小时自动同步一次，仅活跃用户
成绩：24-72 小时一次，或用户手动触发
考试：24-72 小时一次，考试周可提高
个人资料：7-30 天一次，或用户手动触发
```

活跃用户定义：

```text
lastOpenAt <= 7 days
```

暂停自动同步：

```text
lastOpenAt > 7 days
failedCount >= 3
need_login
need_webview_fetch
school status disabled
provider marked unstable
```

## 数据流与缓存

前端本地缓存 key：

```text
cschedule.dataCache.{accountId}.timetable.latest
cschedule.dataCache.{accountId}.timetable.{termId}
cschedule.dataCache.{accountId}.score.latest
cschedule.dataCache.{accountId}.exam.latest
cschedule.dataCache.{accountId}.profile.latest
cschedule.accountSummary.{accountId}
```

后端缓存表：

```text
CourseCache
FeatureCache
SyncRecord / SyncJob
StudentAccount
School
```

读取策略：

```text
页面展示 -> 前端本地缓存
手动刷新 -> 后端创建同步任务
同步成功 -> 前端 forceRefresh 拉一次最新后端缓存并写本地
自动同步成功 -> 用户下次打开仍先看本地；可后台检查版本
```

## 需要实现的模块

### 前端

- 通用本地缓存读写。
- 导入成功后立即写本地缓存。
- 解析失败时降级调用云函数 parser。
- 普通页面默认不请求后端。
- 手动同步完成后只拉取对应 target 并写缓存。

### 后端

- `SyncJob` 创建、去重、状态查询。
- 学校级并发限制。
- 账号级同步冷却。
- 活跃用户筛选。
- provider registry。
- sync dispatcher。
- 云函数 worker 调用与回调校验。
- 凭据加密保存和解密使用。

### 云函数

- `parseRawPayload`：raw payload -> cacheData。
- `runProviderSync`：账号凭据 + providerId + target -> cacheData。
- 统一错误码。
- 版本号和 provider 配置热更新。

## 错误码

```ts
type SyncErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'NEED_CAPTCHA'
  | 'NEED_WEBVIEW_FETCH'
  | 'SCHOOL_RATE_LIMITED'
  | 'SCHOOL_UNAVAILABLE'
  | 'PARSER_NOT_FOUND'
  | 'PARSER_FAILED'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_UNSTABLE'
  | 'PAYLOAD_TOO_LARGE'
  | 'QUOTA_EXCEEDED'
```

前端处理：

- `NEED_WEBVIEW_FETCH`：引导用户重新进入 WebView 导入。
- `NEED_CAPTCHA`：不再后台重试，提示需要人工同步。
- `INVALID_CREDENTIAL`：要求重新授权或修改密码。
- `QUOTA_EXCEEDED`：降级为后端低频执行或提示稍后重试。

## 扩展流程

### 新增普通独立学校

1. 增加学校目录记录。
2. 创建 provider definition。
3. 判断是否支持自动同步。
4. 实现 WebView raw payload parser。
5. 如支持密码登录，实现 `fetchByCredentials`。
6. 配置展示 schema。
7. 用测试账号验证 course。
8. 再逐步开放 score / exam / profile。

### 新增同类教务系统学校

1. 选择已有 template。
2. 配置 `baseUrl`、路径、字段映射。
3. 跑 template parser 测试。
4. 只在差异无法配置时写 adapter override。

### 上线前检查

- 首次导入不依赖自有服务器大带宽。
- 导入成功后本地缓存可直接展示。
- 同步任务有去重。
- 单学校并发有限制。
- 自动同步只对 password vault 学校开放。
- 失败三次后停止自动同步。
- 新增学校不需要小程序审核。

## 默认决策

当前无需继续确认即可按以下策略推进：

1. 每校独立 provider 为主。
2. 大型教务系统做 template 复用，但不强求完全通用。
3. 自动同步由后端发任务。
4. 云函数可作为 parser 和 worker 执行层。
5. 前端只做通用导入、缓存和展示。
6. 新增学校尽量通过后端/云端配置或部署完成，不触发小程序审核。
7. 自有服务器不代理大 payload。
8. 20 万次/月额度只用于导入解析、手动同步和少量自动同步。

## 分阶段落地

### 第一阶段：缓存闭环

- 首次导入后前端立即写本地缓存。
- 普通页面默认只读本地缓存。
- 手动同步成功后只刷新对应 target。

### 第二阶段：parser 下沉

- 抽出 `parser` 概念。
- 简单 JSON parser 放前端。
- 复杂 HTML parser 放云函数。
- 后端 parser 作为兼容兜底。

### 第三阶段：同步任务化

- 后端创建 SyncJob。
- 本机 worker 先跑。
- 加账号去重、学校限流、失败退避。

### 第四阶段：云函数 worker

- 将重 parser 和稳定 provider 同步迁到云函数。
- 后端只发任务和验签接结果。
- 监控云函数调用次数、失败率和耗时。

### 第五阶段：provider template

- 抽取通用教务系统模板。
- 独立学校 adapter 只写差异。
- 建立 provider 验收清单和测试样例。

