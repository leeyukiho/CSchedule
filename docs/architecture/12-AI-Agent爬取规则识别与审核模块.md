# AI Agent 爬取规则识别与审核模块

本文定义后续 AI Agent 模块的目标、边界和审核流程。该模块当前不实现。

当前阶段只实现或设计用户提交学校接入信息、登录方式配置、登录页展示和基础审核。AI Agent 对登录页面、数据入口和爬取规则的识别能力另行开发。

## 当前状态

```text
状态: not_implemented
是否进入当前开发范围: 否
是否影响学校接入信息提交规范: 否
是否允许用户共同维护爬取规则: 否
```

## 模块目标

AI Agent 模块用于在用户提交学校接入信息后，辅助判断：

- 登录页面结构。
- 登录成功后的目标页面。
- 课程表、成绩、考试、个人信息等数据入口。
- 原始数据格式。
- 可能的请求参数。
- 可能的解析规则。
- 是否适合复用现有 Provider。
- 是否需要新增 Provider 或 Parser。

AI Agent 的输出只作为候选规则，不能绕过基础审核和人工验收。

## 非目标

该模块不做以下事情：

- 不破解验证码。
- 不绕过短信、扫码、设备校验、滑块或学校风控。
- 不保存共享学校账号。
- 不长期保存用户个人密码。
- 不直接把 Agent 生成规则上线为 `enabled`。
- 不让普通用户维护爬取规则。
- 不对学校系统做高频探测。

## 输入来源

AI Agent 可使用的输入包括：

```ts
interface AgentRuleDiscoveryInput {
  submissionId: string
  schoolId: string
  loginUrl: string
  eduSystemWebsite?: string
  loginMode: LoginMode
  requestedTargets: DataTarget[]
  redactedScreenshots?: string[]
  redactedHtmlSamples?: string[]
  userAuthorizedSession?: TemporarySessionRef
}
```

说明：

- `redactedScreenshots` 必须脱敏。
- `redactedHtmlSamples` 如包含个人信息，必须加密并设置短保留期限。
- `userAuthorizedSession` 只能来自用户本人明确授权的短期会话。
- Agent 不应要求用户提交共享账号密码。

## 输出结果

Agent 输出的是候选规则，不是正式 Provider。

```ts
interface AgentRuleDiscoveryResult {
  submissionId: string
  schoolId: string
  confidence: number
  recommendedProviderId?: string
  recommendedLoginMode: LoginMode
  recommendedDataAccess: Partial<Record<DataTarget, DataAccessMode[]>>
  discoveredRoutes: DiscoveredRoute[]
  parserHints: ParserHint[]
  risks: AgentDiscoveryRisk[]
  reviewRequired: true
}

interface DiscoveredRoute {
  target: DataTarget
  url: string
  method: 'GET' | 'POST'
  requiredParams?: string[]
  responseType?: 'html' | 'json' | 'js' | 'excel' | 'pdf' | 'unknown'
  sameOriginRequired?: boolean
}

interface ParserHint {
  target: DataTarget
  format: 'table' | 'json' | 'script_object' | 'excel' | 'text' | 'unknown'
  fields?: string[]
  sampleShape?: Record<string, unknown>
}

interface AgentDiscoveryRisk {
  level: 'low' | 'medium' | 'high'
  code: string
  message: string
}
```

## 审核流程

```text
SchoolAccessSubmission accepted
  -> 创建 AgentRuleDiscoveryJob
  -> Agent 使用脱敏材料和用户授权短期会话分析
  -> 生成候选规则
  -> 基础安全审核
  -> Parser 样例验证
  -> 小范围 beta
  -> 人工验收
  -> ProviderStatus enabled
```

基础审核至少包括：

```text
[ ] 未保存明文密码
[ ] 未输出 Cookie、Token、CAS ticket 到日志
[ ] 未包含验证码绕过逻辑
[ ] 请求频率符合 ProviderLimits
[ ] 只访问用户授权范围内的数据
[ ] 至少一个目标数据能写入缓存
[ ] Parser 对样例数据可重复解析
[ ] 失败时能返回统一错误码
[ ] WebView 学校关闭前能完成 requiredFetchTargets 缓存写入
```

## 状态机

```ts
type AgentDiscoveryStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'needs_user_session'
  | 'agent_failed'
  | 'candidate_generated'
  | 'security_review_failed'
  | 'parser_review_failed'
  | 'ready_for_beta'
  | 'accepted'
```

状态含义：

| 状态 | 含义 |
| --- | --- |
| `not_started` | 尚未进入 Agent 分析 |
| `queued` | 已排队 |
| `running` | Agent 正在分析 |
| `needs_user_session` | 需要用户本人授权短期登录态 |
| `agent_failed` | Agent 未能识别有效规则 |
| `candidate_generated` | 已生成候选规则 |
| `security_review_failed` | 安全审核失败 |
| `parser_review_failed` | 解析验收失败 |
| `ready_for_beta` | 可进入小范围测试 |
| `accepted` | 可转为正式 Provider 适配成果 |

## 与 Provider 的关系

Agent 不能替代 Provider。最终仍应落到现有架构：

```text
School
  -> School.config
  -> SchoolProvider
  -> LoginStrategy
  -> FeatureConnector
  -> Parser
  -> Cache
```

Agent 可以辅助生成：

- `SchoolProviderConfigDraft`
- `providerConfig` 候选字段
- `featureConfig` 候选字段
- `FeatureCapability` 候选声明
- Parser 测试样例

Agent 不应直接修改正式 Provider 配置。

## 风险控制

- 每个学校独立限流。
- 每个用户授权会话独立限流。
- Agent 访问必须绑定 `submissionId` 和 `bindingId`。
- 所有原始响应默认短期保存。
- 调试样例必须脱敏。
- 高风险规则必须人工确认。
- Agent 置信度低于阈值时不得进入 Beta。

建议阈值：

```text
confidence >= 0.85: 可进入人工审核
0.60 <= confidence < 0.85: 需要补充材料
confidence < 0.60: 标记 agent_failed
```

## 开发顺序建议

该模块建议在以下能力稳定后再实现：

```text
1. SchoolAccessSubmission
2. SchoolProviderConfigDraft
3. LoginContext
4. CourseCache / FeatureCache
5. SyncRecord
6. WebView raw-data 上传
7. Provider 验收清单
```

第一版只建议支持课程表 `course`，不要同时开放成绩、考试和个人信息。

## 当前不实现清单

```text
[ ] AgentRuleDiscoveryJob
[ ] AgentRuleDiscoveryInput
[ ] AgentRuleDiscoveryResult
[ ] 自动登录页识别
[ ] 自动数据入口识别
[ ] 自动 Parser 生成
[ ] 自动 Provider 配置生成
[ ] Agent 结果审核页面
[ ] Agent 结果转 Beta 流程
```

这些内容只作为后续模块设计依据，当前开发不接入运行链路。
