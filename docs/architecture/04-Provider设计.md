# Provider 设计

Provider 现在只描述学校能力、展示协议、凭据保存策略和同步入口配置。Provider 不再承载后端直连学校系统的代码。

## ProviderRegistry

```ts
class ProviderRegistryService {
  private readonly providers = new Map<string, SchoolProvider>()

  register(provider: SchoolProvider) {
    this.providers.set(provider.id, provider)
  }

  getProvider(providerId: string) {
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error(`Provider not found: ${providerId}`)
    return provider
  }
}
```

## SchoolProvider

```ts
interface SchoolProvider {
  id: string
  meta: SchoolProviderMeta
}
```

`SchoolProviderMeta` 包含：

- 学校和 provider 标识。
- `loginMode`、`eduSystemType`、状态和验收时间。
- `capabilities`。
- `dataAccess`。
- `credentialSave`。
- `featureDisplay`。

不包含 `course`、`score`、`exam`、`profile` connector。

## 学校配置示例

```json
{
  "id": "wtbu",
  "providerId": "wtbu",
  "loginMode": "direct_password",
  "eduSystemType": "eams",
  "capabilities": {
    "course": true,
    "score": true,
    "exam": true,
    "profile": true
  },
  "dataAccess": {
    "course": ["cloud_worker", "webview_client_fetch", "manual_import"],
    "score": ["cloud_worker", "webview_client_fetch", "manual_import"],
    "exam": ["cloud_worker", "webview_client_fetch", "manual_import"],
    "profile": ["cloud_worker", "webview_client_fetch", "manual_import"]
  },
  "providerConfig": {
    "baseUrl": "https://jxgl.wtbu.edu.cn",
    "cloudFunctions": {
      "course": { "functionName": "syncWtbu" },
      "score": { "functionName": "syncWtbu" },
      "exam": { "functionName": "syncWtbu" },
      "profile": { "functionName": "syncWtbu" }
    }
  }
}
```

## Enabled 条件

学校标为 `enabled` 前至少满足：

- `providerId` 指向已注册 provider。
- `loginMode` 明确。
- `capabilities` 和 `dataAccess` 与实际能力一致。
- 若声明 `cloud_worker`，必须配置对应 `cloudFunctions[target]`。
- 已有云函数或 WebView 导入验收记录。
- 错误输出不泄露账号、密码、Cookie 或 Token。

## 展示配置

前端按 `FeatureDisplayConfig` 渲染字段，不直接判断学校 ID：

```ts
type FeatureDisplayKind =
  | 'course_grid'
  | 'profile_fields'
  | 'score_semesters'
  | 'exam_list'
  | 'raw'
```

优先级：

```text
School.config.featureDisplay[target]
  -> School.config.provider.featureDisplay[target]
  -> Provider.meta.featureDisplay[target]
  -> 后端默认展示配置
```
