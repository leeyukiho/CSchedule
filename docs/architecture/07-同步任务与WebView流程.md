# 同步任务与 WebView 流程

## 原则

同步只做同步，读取只做读取。

普通读取接口永远优先读数据库缓存，不直接请求学校系统。同步接口负责创建或执行一次明确的同步流程，结果写入 `CourseCache` 或 `FeatureCache`。

## SyncRecord 状态

```text
pending
running
success
failed
need_login
need_webview_fetch
cancelled
```

`success` 只能在对应缓存写入成功后设置。只创建了 binding 但没有写入 `CourseCache`，不能算同步成功。

## 手动同步

```text
前端点击同步
  -> POST /bindings/:bindingId/sync/course
  -> 后端校验 binding 归属
  -> 创建 SyncRecord
  -> 根据 School.dataAccess.course 选择路径
```

`server_session` 路径：

```text
获取学校配置
  -> Provider 登录或复用当前 authState
  -> 抓取课表 raw payload
  -> parse
  -> normalize
  -> upsert CourseCache
  -> 更新 Binding.lastCachedAt
  -> SyncRecord success
```

`webview_client_fetch` 路径：

```text
SyncRecord need_webview_fetch
  -> 前端打开 WebView
  -> 用户在学校页面完成认证
  -> WebView 内获取 raw payload
  -> POST /bindings/:bindingId/raw-data
  -> 后端 parse + 写 CourseCache
  -> POST /bindings/:bindingId/webview-sync/complete
  -> 返回 canCloseWebview=true
```

第一版可以同步执行，也可以后续接入队列。文档不强制要求 BullMQ。只有当请求耗时、并发和重试真的需要队列时，再接入 Redis/BullMQ。

## WebView 关闭条件

WebView 不能只因为用户登录成功就关闭。必须满足：

```text
course raw payload 已上传
后端解析成功
CourseCache 已写入
UserSchoolBinding.lastCachedAt 已更新
complete 接口返回 canCloseWebview=true
```

关闭后前端跳转课表页读取：

```text
GET /bindings/:bindingId/timetable
```

如果没有 `CourseCache`，应显示“尚未同步课表”，不要显示“已同步”。

## 绑定状态更新

推荐规则：

```text
写入 CourseCache 成功
  -> Binding.lastCachedAt = now
  -> 如果有可复用认证: active
  -> 如果无可复用认证但有缓存: cached_only

需要重新认证且没有缓存
  -> need_login

需要 WebView 抓取
  -> SyncRecord need_webview_fetch
  -> Binding 保持 active/cached_only/need_login，按是否已有缓存决定
```

这能避免“个人中心显示学校，但状态未同步，点同步又跳回重新绑定”的混乱：重新绑定只用于没有 binding；已有 binding 时，同步入口应进入对应的同步或 WebView 抓取流程。

## 失败处理

- 学校账号密码错误：`INVALID_CREDENTIAL`，Binding 可设为 `need_login`。
- 学校系统超时：`SCHOOL_TIMEOUT`，保留旧缓存。
- 解析失败：`PARSER_FAILED`，保留旧缓存。
- 需要 WebView：`WEBVIEW_CLIENT_FETCH_REQUIRED` 或 SyncRecord `need_webview_fetch`。
- 已有同步进行中：`SYNC_RUNNING`。

失败不删除旧缓存，不无限重试。
