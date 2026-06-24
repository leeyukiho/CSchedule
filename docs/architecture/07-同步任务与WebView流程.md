# 同步任务与 WebView 流程

同步只负责刷新缓存，读取只读缓存。

普通读取接口永远优先读数据库或小程序本地缓存，不直接访问学校系统。访问学校系统只发生在学校专用云函数里。

## SyncRecord 状态

```text
pending
running
success
failed
need_login
need_webview_fetch
rate_limited
cancelled
```

`success` 只能在对应缓存写入成功后设置。

## 手动同步

```text
前端点击同步
  -> POST /account/:accountId/sync/:target
  -> SyncService 校验账号和 dataAccess
  -> 创建 SyncRecord
  -> 后端解密 password_vault 凭据
  -> CloudCredentialSyncService 调用 cloudFunctions[target].url
  -> CourseSyncService.writeCloudCacheResult 写缓存
  -> SyncRecord success
```

如果 target 未配置 `cloud_worker` 或缺少云函数配置，返回 `need_webview_fetch`。

## 自动同步

```text
AutoSyncScheduler 扫描到期账号
  -> 仅选择 password_vault 账号
  -> 仅选择 dataAccess[target] 包含 cloud_worker 的学校
  -> 仅选择配置了 cloudFunctions[target].url 的学校
  -> 调用 SyncService.createManualSync
```

并发控制：

- `SYNC_GLOBAL_CONCURRENCY`
- `SYNC_SCHOOL_CONCURRENCY`
- `SYNC_ACCOUNT_COOLDOWN_MS`
- 同一账号同一 target active job 去重

## WebView 导入

```text
SyncRecord need_webview_fetch
  -> 前端打开 WebView
  -> 用户在学校页面完成认证
  -> WebView 内获取结构化 JSON
  -> POST /account/:accountId/raw-data
  -> 后端写 CourseCache / FeatureCache
  -> POST /account/:accountId/webview-sync/complete
  -> 返回 canCloseWebview
```

WebView 不保存账号密码，不参与自动同步。

## 关闭条件

WebView 不能只因为登录成功就关闭。必须满足：

```text
必要 target 的 payload 已上传
后端写缓存成功
complete 接口返回 canCloseWebview=true
```

## 失败处理

- `INVALID_CREDENTIAL`: 账号需要重新登录。
- `CLOUD_SYNC_NOT_CONFIGURED`: target 未配置云函数。
- `NEED_WEBVIEW_FETCH`: 需要用户走 WebView。
- `SCHOOL_RATE_LIMITED`: 学校限流，保留旧缓存。
- `PARSER_FAILED`: 云函数解析失败，保留旧缓存。

失败不删除旧缓存，不无限重试。
