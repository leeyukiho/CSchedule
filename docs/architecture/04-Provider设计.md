# Provider 设计

Provider 负责学校差异，业务层不关心学校页面结构、密码算法、课表接口和 raw 格式。

## 当前模型

第一版不引入 `SchoolProviderBinding` 表。学校目录和 Provider 配置直接放在 `School` 表：

```text
School.providerId
School.loginMode
School.dataAccess
School.capabilities
School.featureCapabilities
School.eduSystemType
School.homepageUrl
School.authUrl
School.config
```

`School.config` 放学校级配置，例如 baseUrl、登录路径、课表路径、参数映射、节次时间、authConfig。只有当一个学校需要多套 Provider 配置、灰度发布或版本切换时，再新增 `SchoolProviderBinding`。

## ProviderRegistry

```ts
class ProviderRegistry {
  private providers = new Map<string, SchoolProvider>()

  register(provider: SchoolProvider) {
    this.providers.set(provider.id, provider)
  }

  getProvider(providerId: string): SchoolProvider {
    const provider = this.providers.get(providerId)
    if (!provider) throw new Error(`Provider not found: ${providerId}`)
    return provider
  }
}
```

业务层查找 Provider 的路径：

```text
binding.schoolId
  -> School.providerId
  -> ProviderRegistry.getProvider(providerId)
```

## SchoolProvider

```ts
interface SchoolProvider {
  id: string
  login: LoginStrategy
  course?: CourseConnector
  score?: FeatureConnector
  exam?: FeatureConnector
  profile?: FeatureConnector
}
```

Provider 负责：

- 创建登录上下文。
- 提交学校认证请求或提供 WebView 描述。
- 按学校配置抓取或接收 raw payload。
- 解析 raw payload。
- 返回统一模型。

Provider 不负责：

- 创建用户。
- 判断当前用户是否拥有 binding。
- 直接写数据库。
- 创建同步记录。
- 决定前端页面结构。

## 学校配置示例

```json
{
  "id": "whhxit",
  "providerId": "whhxit",
  "loginMode": "direct_password",
  "eduSystemType": "zf_jwglxt",
  "capabilities": {
    "course": true,
    "score": false,
    "exam": false,
    "profile": true
  },
  "dataAccess": {
    "course": ["server_session"],
    "score": [],
    "exam": [],
    "profile": ["server_session"]
  },
  "config": {
    "authConfig": {
      "captchaRequired": false,
      "captchaKind": "none",
      "uiPreset": "password",
      "passwordTransform": "rsa_public_key"
    },
    "baseUrl": "https://example.edu.cn",
    "loginPath": "/jwglxt/xtgl/login_slogin.html",
    "coursePath": "/jwglxt/kbcx/xskbcx_cxXsgrkb.html"
  }
}
```

同一类教务系统不等于同一登录方式。`eduSystemType=zf_jwglxt` 只说明大体系统类型；是否需要验证码、是否能后端直登、密码如何加密，由 `loginMode` 和 `config.authConfig` 决定。

## 低耦合规则

- 新学校优先新增配置和 Provider 适配，不改业务服务。
- Parser 可以共享通用周次、节次工具，但不要共享学校登录实现，除非协议确认一致。
- 每个 Provider 只声明自己已验证的能力；未实现的成绩、考试、个人信息不要在同步课表时顺手请求。
- `password_vault` 不是默认能力。第一版不因为方便同步而长期保存学校密码。

## Enabled 条件

学校标为 `enabled` 前至少满足：

- `providerId` 指向已注册 Provider。
- `loginMode` 明确。
- `dataAccess.course` 明确。
- 至少课表能成功写入 `CourseCache`。
- 有适配记录和验证样例。
- 错误不会输出账号、密码、Cookie、Token。

## 学校级能力展示配置

课表、个人资料、成绩、考试不再由前端写死字段。Provider 或 `School.config.featureDisplay`
声明每个学校的展示协议，Feature API 随缓存一起返回 `display`，前端按该配置渲染。

```ts
type FeatureDisplayKind =
  | 'course_grid'
  | 'profile_fields'
  | 'score_semesters'
  | 'exam_list'
  | 'raw'

interface FeatureDisplayField {
  key: string
  label: string
  visible?: boolean
  editable?: boolean
  primary?: boolean
  fallbackKeys?: string[]
}

interface FeatureDisplayConfig {
  title?: string
  kind?: FeatureDisplayKind
  summaryFields?: FeatureDisplayField[]
  detailFields?: FeatureDisplayField[]
  editableFields?: FeatureDisplayField[]
  itemFields?: FeatureDisplayField[]
  itemPath?: string
  groupPath?: string
  emptyText?: string
}
```

优先级：

```text
School.config.featureDisplay[target]
  -> School.config.provider.featureDisplay[target]
  -> Provider.meta.featureDisplay[target]
  -> 后端默认展示配置
```

新增学校时，Provider 负责两件事：

- 把学校原始数据解析成稳定的 `course` / `score` / `exam` / `profile` 缓存数据。
- 在 `featureDisplay` 中声明该学校前端应该展示哪些字段、字段顺序、是否可编辑。

前端只理解 `display` 协议，不直接判断学校 ID。这样同一页面可以支持“有完整成绩绩点的学校”、“只有课程分数的学校”、“只返回基础资料的学校”等不同形态。

统一 UI 的边界：

- 课表页始终是统一网格，学校只决定课程标题、地点、教师等字段从哪个 key 取。
- 成绩页始终是统一“汇总 + 分组 + 明细”布局，学校只决定汇总字段、分组路径和明细字段。
- 考试页始终是统一列表布局，学校只决定考试项字段。
- 资料页始终是统一资料卡和信息列表，学校只决定显示字段和可编辑字段。
