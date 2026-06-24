# Cloud Sync Architecture

当前项目采用最新同步架构：

```text
客户端首次导入
  -> 客户端提交教务账号密码到后端
  -> 后端调用学校专用云函数
  -> 云函数登录学校系统、抓取并解析数据
  -> 后端写 CourseCache / FeatureCache

后端手动同步 / 自动同步
  -> 后端解密 password_vault 凭据
  -> 后端排队、去重、按学校限流
  -> 后端调用同一组学校专用云函数
  -> 云函数登录学校系统、抓取并解析数据
  -> 后端写 CourseCache / FeatureCache
```

后端不再实现学校外网访问和解析逻辑。后端直连学校、通用 provider worker、通用 cloud parser 都属于旧方式，已删除。

## 设计目标

- 后端只负责账号、凭据、任务、限流、云函数调用和缓存写入。
- 云函数是唯一访问学校教务外网的执行层。
- 客户端不为新增学校频繁发版，只接收后端下发的同步策略和展示配置。
- 普通页面默认读本地缓存，云函数不承担日常浏览流量。
- 自动同步时按账号、学校、target 去重和限流，避免并发重复请求。
- 云函数返回给后端的结果尽量精简，减少云函数出站流量。

## 能力标记

`DataAccessMode` 当前语义：

- `cloud_worker`: 使用学校专用云函数完成账号密码同步。
- `webview_client_fetch`: 用户在 WebView 内完成登录，前端上传结构化 JSON。
- `manual_import`: 用户手动导入。
- `session_import`: 预留能力。

只有满足以下条件的 target 才能自动同步：

- provider metadata 允许 `password_login` 自动同步。
- 学校 seed 的 `dataAccess[target]` 包含 `cloud_worker`。
- 学校配置存在 `providerConfig.cloudFunctions[target].url`。
- 用户账号已选择 `password_vault`。

## 云函数配置

`backend/prisma/data/connected-schools.json`：

```json
{
  "dataAccess": {
    "course": ["cloud_worker", "webview_client_fetch", "manual_import"]
  },
  "providerConfig": {
    "cloudFunctions": {
      "course": { "url": "https://your-cloud-function-url.example.com/syncWtbu" }
    }
  }
}
```

后端同步通过 `cloudFunctions.<target>.url` 调用 HTTP 触发器；首次绑定导入允许前端使用后端下发的短期 `clientImportToken` 直接调用同一个 HTTP 触发器，以降低应用服务器带宽压力。前端不能携带 `CSCHEDULE_WORKER_SECRET`，云函数必须返回 `cloudProof`，后端只接受签名匹配的导入结果。

## 请求次数优化

- 后端同一账号同一 target 同时只允许一个 active sync。
- `SYNC_ACCOUNT_COOLDOWN_MS` 控制账号 target 冷却时间。
- `SYNC_GLOBAL_CONCURRENCY` 控制全局并发。
- `SYNC_SCHOOL_CONCURRENCY` 控制单学校并发。
- `AUTO_SYNC_TARGETS` 控制自动同步目标，默认只同步 `course`。
- 云函数内部按 target 拉取数据，不为 `score`、`profile`、`exam` 顺手抓课表。

## 出站流量优化

- `source=backend_auto_sync` 时，云函数返回精简 `cacheData`，只包含后端写缓存必需字段。
- `source=backend_auto_sync` 时，云函数返回标准 `cacheResults`，由后端写入缓存。
- 后端不再代理 WebView/raw payload 到云函数。
- 日常页面读取客户端本地缓存，不触发云函数。

## 新增学校流程

1. 新增 provider metadata 文件，只写能力、展示配置和凭据保存策略。
2. 注册 provider。
3. 在 `connected-schools.json` 增加学校 seed 和 `cloudFunctions.<target>.url`。
4. 新增 `cloudfunctions/sync<School>/index.js`。
5. 验证首次导入、手动同步、自动同步都走同一个云函数。

## 旧方式禁止恢复

- 不恢复后端 provider 凭据抓取接口。
- 不恢复旧的通用 provider worker 云函数。
- 不恢复旧的通用 raw payload parser 云函数。
- 不恢复旧的前端 cloud parser API。
- 不恢复旧的后端直连模式。
