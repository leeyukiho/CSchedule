# Provider Extension Guide

当前架构已经去掉后端直连学校系统的旧方式。新增学校时，后端只维护学校元数据、展示配置、云函数配置和缓存写入；访问学校外网、登录教务系统和解析页面都放到学校专用云函数。

## 新增学校要改哪里

通常只需要改后端和云函数，不需要改小程序：

1. `backend/src/modules/providers/adapters/<providerId>.provider.ts`
   只声明 `SchoolProvider` 元数据，不写账号密码登录、不写 HTTP 抓取。
2. `backend/src/modules/providers/providers.module.ts`
   注册 provider。
3. `backend/prisma/data/connected-schools.json`
   增加学校 seed、能力、`dataAccess` 和 `providerConfig.cloudFunctions`。
4. `cloudfunctions/sync<School>/`
   学校专用云函数，负责登录学校系统、按 target 拉取并返回标准 `cacheResults`。

小程序侧通过后端返回的 `syncStrategy.cloudFunctions` 调用云函数，后端自动同步也调用同一组云函数。

## SchoolProvider 最小结构

```ts
import { SchoolProvider } from '../provider.types'

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
    verifiedAt: '2026-06-17T00:00:00.000Z',
    capabilities: { course: true, score: false, exam: false, profile: false },
    credentialSave: {
      passwordVaultAllowed: true,
      autoSync: 'password_login',
      scheduledSyncSupported: true,
      notice: '保存教务账号密码后，可通过云函数完成首次导入和自动同步。',
      consentLabel: '加密保存账号密码，用于自动同步',
    },
    dataAccess: {
      course: ['cloud_worker'],
      score: [],
      exam: [],
      profile: [],
    },
    featureDisplay: {
      course: {
        title: '课表',
        kind: 'course_grid',
        itemPath: 'courses',
      },
    },
  },
}
```

`SchoolProvider` 不再包含后端凭据抓取 connector。

## dataAccess 语义

- `cloud_worker`: 账号密码保存在后端，后端或小程序调用学校专用云函数完成外网访问和解析。
- `webview_client_fetch`: 用户在 WebView 内完成登录，前端上传结构化 JSON 到后端 `raw-data`。
- `manual_import`: 用户手动导入结构化数据。
- `session_import`: 预留能力，不作为默认路径。

不要再使用旧的后端直连模式。该模式表示后端直接登录学校系统抓取数据，已经删除。

## connected-schools.json 示例

```json
{
  "id": "xxx",
  "catalogCode": "4142000000",
  "name": "学校全称",
  "shortName": "学校简称",
  "province": "湖北省",
  "city": "武汉市",
  "aliases": ["学校全称", "学校简称", "XXX"],
  "providerId": "xxx",
  "loginMode": "direct_password",
  "eduSystemType": "eams",
  "homepageUrl": "https://example.edu.cn",
  "authUrl": "https://example.edu.cn/login",
  "verifiedAt": "2026-06-17T00:00:00.000Z",
  "status": "enabled",
  "capabilities": { "course": true, "score": false, "exam": false, "profile": false },
  "dataAccess": {
    "course": ["cloud_worker"],
    "score": [],
    "exam": [],
    "profile": []
  },
  "providerConfig": {
    "baseUrl": "https://example.edu.cn",
    "system": "EAMS",
    "cloudFunctions": {
      "course": { "functionName": "syncXxx" }
    },
    "authConfig": {
      "captchaRequired": false,
      "captchaKind": "none",
      "uiPreset": "password",
      "passwordTransform": "plain"
    }
  }
}
```

只有已配置 `cloudFunctions.<target>` 的 target 才能声明 `cloud_worker`，否则自动同步会被后端拒绝。

## 云函数返回协议

云函数输入：

```ts
{
  source: 'frontend_first_import' | 'backend_auto_sync'
  schoolId: string
  providerId: string
  target: 'course' | 'score' | 'exam' | 'profile'
  username: string
  password: string
  semesterId?: string
}
```

云函数输出：

```ts
{
  ok: true,
  result: {
    target: 'course',
    termId?: string,
    cacheResults: [
      {
        target: 'course',
        termId?: string,
        cacheData: {
          termId?: string,
          courses?: unknown[],
          terms?: unknown[],
          sectionTimes?: unknown[],
          data?: unknown,
          meta?: Record<string, unknown>,
          sourceHash?: string,
          syncedAt?: string
        },
        parsedCount?: number,
        sourceHash?: string,
        warnings?: string[]
      }
    ],
    parsedCount?: number,
    warnings?: string[]
  }
}
```

`backend_auto_sync` 可以返回精简 `cacheData`，后端会补 account、school、provider 等上下文；`frontend_first_import` 需要保留小程序本地缓存所需字段。

## 验收清单

1. `cd backend && pnpm build`
2. `cd frontend && pnpm build:weapp`
3. `node --check cloudfunctions/syncXxx/index.js`
4. `backend/prisma/data/connected-schools.json` 是合法 JSON。
5. 学校列表能返回正确的 `syncStrategy`。
6. 首次绑定走云函数，后端 `AuthService.submitLogin` 只接收并写入 `cacheResults`。
7. 手动/自动同步走 `SyncService -> CloudCredentialSyncService -> cloud function -> CourseSyncService.writeCloudCacheResult`。

## 不要做

- 不要在后端 provider adapter 里写学校登录或抓取逻辑。
- 不要恢复旧的后端直连模式。
- 不要让后端代理大体积 raw payload 到云函数。
- 不要把未配置云函数的 target 标为 `cloud_worker`。
