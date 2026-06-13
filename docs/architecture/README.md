# 架构设计索引

后续架构维护以本目录为准。

## 阅读顺序

1. [01-设计目标与总体架构](./01-设计目标与总体架构.md)
2. [02-目录结构与模块边界](./02-目录结构与模块边界.md)
3. [03-登录与数据获取方式](./03-登录与数据获取方式.md)
4. [04-Provider设计](./04-Provider设计.md)
5. [05-教务能力连接器与模型](./05-教务能力连接器与模型.md)
6. [06-学校目录绑定与缓存](./06-学校目录绑定与缓存.md)
7. [07-同步任务与WebView流程](./07-同步任务与WebView流程.md)
8. [08-API与错误码](./08-API与错误码.md)
9. [09-安全限流与隐私](./09-安全限流与隐私.md)
10. [10-适配验收与开发路线](./10-适配验收与开发路线.md)
11. [11-学校接入信息提交规范](./11-学校接入信息提交规范.md)
12. [12-AI-Agent爬取规则识别与审核模块](./12-AI-Agent爬取规则识别与审核模块.md)

## 当前关键结论

- 缓存是数据库里的业务快照，不是额外套一层缓存系统。
- 第一版只以 8 张 Prisma 业务表为准：`User`、`School`、`UserSchoolBinding`、`CourseCache`、`FeatureCache`、`SyncRecord`、`FeedbackItem`、`SchoolAccessSubmission`。
- `LoginSession`、`UserIdentity`、`SchoolProviderBinding`、`AccountMigration` 是后续可选表，不写成当前已实现能力。
- `LoginMode` 表示用户如何完成学校认证。
- `DataAccessMode` 表示认证后数据如何进入后端并写缓存。
- 普通读取接口只读缓存，不请求学校系统。
- 同步成功必须以 `CourseCache` 或 `FeatureCache` 写入成功为准。
- Provider 只处理学校差异，不直接访问用户数据库。
- Parser 只处理 raw payload 解析，不做网络请求、鉴权和数据库写入。

## WebView 学校

复杂验证码或强认证学校走官方 WebView：

```text
用户完成学校认证
  -> WebView 内获取课表 raw payload
  -> 上传后端
  -> 后端解析写 CourseCache
  -> complete 返回 canCloseWebview=true
  -> 前端关闭 WebView 并读取缓存
```

如果只绑定了学校但没有写入 `CourseCache`，前端应显示“尚未同步”，不能显示“已同步”。
