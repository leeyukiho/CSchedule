# API 与错误码

本页只描述第一版需要的接口。接口职责保持单一：查询只查询，绑定只绑定，同步只同步。

## 学校

```text
GET /schools
GET /schools?keyword={keyword}
```

返回学校目录和能力摘要。前端不写死学校列表。

## 登录上下文

```text
POST /schools/:schoolId/login-context
```

返回：

```ts
interface LoginContextResponse {
  contextId: string
  mode: LoginMode
  fields: LoginField[]
  captcha?: CaptchaDescriptor
  webview?: WebviewLoginDescriptor
  expireAt: string
}
```

## 提交绑定登录

```text
POST /schools/:schoolId/login
```

请求：

```ts
interface LoginSubmitRequest {
  contextId: string
  username?: string
  password?: string
  captcha?: string
  extra?: Record<string, unknown>
}
```

返回：

```ts
interface LoginSubmitResponse {
  bindingId: string
  status: 'bound' | 'cached' | 'need_webview_fetch'
  bindingStatus: 'active' | 'need_login' | 'cached_only'
  requiredFetchTargets?: DataTarget[]
}
```

不要返回未实现的 `sessionId`。当前没有独立 `LoginSession` 表。

## 上传原始数据

```text
POST /bindings/:bindingId/raw-data
```

用于 `webview_client_fetch` 或 `manual_import`。

```ts
interface RawDataUploadRequest {
  contextId?: string
  target: DataTarget
  accessMode: 'webview_client_fetch' | 'manual_import'
  termId?: string
  contentType: 'json' | 'html' | 'text' | 'csv' | 'xlsx' | 'ics' | 'pdf'
  sourceUrl?: string
  payload: unknown
  meta?: Record<string, unknown>
}
```

返回：

```ts
interface RawDataUploadResponse {
  bindingId: string
  target: DataTarget
  cacheId: string
  status: 'cached'
  parsedCount: number
  warnings?: string[]
}
```

## WebView 同步完成

```text
POST /bindings/:bindingId/webview-sync/complete
```

只有后端确认必需缓存已写入，才返回 `canCloseWebview=true`。

```ts
interface WebviewSyncCompleteResponse {
  bindingId: string
  status: 'ready' | 'partial'
  canCloseWebview: boolean
  missingRequiredTargets: DataTarget[]
}
```

## 读取缓存

```text
GET /bindings/:bindingId/timetable?termId={termId}
GET /bindings/:bindingId/scores?termId={termId}
GET /bindings/:bindingId/exams?termId={termId}
GET /bindings/:bindingId/profile
```

读取接口返回缓存和绑定摘要，不触发学校请求。

```ts
interface BindingSummary {
  bindingId: string
  bindingStatus: 'active' | 'need_login' | 'cached_only' | 'disabled' | 'unbound'
  lastCachedAt?: string
  sessionReusable: boolean
  sessionRefreshable: boolean
  sessionExpireAt?: string
}
```

## 手动同步

```text
POST /bindings/:bindingId/sync/:target
```

`target`：

```text
course
score
exam
profile
```

同步接口返回同步记录。是否异步队列化由实现决定，不写死为 BullMQ。

```ts
interface SyncStartResponse {
  syncId: string
  status: SyncStatus
  nextAction?: 'wait' | 'open_webview' | 'login'
}
```

## 查询同步状态

```text
GET /sync/:syncId
```

## 错误码

```ts
type AppErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_INVALID'
  | 'WEBVIEW_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'WEBVIEW_CLIENT_FETCH_REQUIRED'
  | 'WEBVIEW_SYNC_INCOMPLETE'
  | 'RAW_PAYLOAD_INVALID'
  | 'CACHE_NOT_READY'
  | 'SCHOOL_TIMEOUT'
  | 'SCHOOL_MAINTENANCE'
  | 'RATE_LIMITED'
  | 'PARSER_FAILED'
  | 'TERM_NOT_FOUND'
  | 'UNSUPPORTED_SCHOOL'
  | 'BINDING_NOT_FOUND'
  | 'BINDING_FORBIDDEN'
  | 'SYNC_RUNNING'
  | 'UNKNOWN'
```

常见含义：

| 错误码 | 含义 |
| --- | --- |
| `INVALID_CREDENTIAL` | 学号或密码错误 |
| `WEBVIEW_REQUIRED` | 需要在学校页面完成认证 |
| `WEBVIEW_CLIENT_FETCH_REQUIRED` | 需要在 WebView 内抓取并上传数据 |
| `WEBVIEW_SYNC_INCOMPLETE` | WebView 关闭前仍有必需数据未缓存 |
| `CACHE_NOT_READY` | 缓存尚未生成 |
| `PARSER_FAILED` | 课表格式变化或解析失败 |
| `SYNC_RUNNING` | 已有同步任务进行中 |
