# wxapp 功能对照检查

检查对象：

- 参考项目：`wxapp`，来自 `https://github.com/LikX-1019/CS-WTBU.git` 的 `master`
- 主项目：`backend` + `frontend`
- 架构约束入口：`docs/架构细节设计.md`
- 实际准则：`docs/architecture/` 下拆分文档

## 结论

主项目目前只实现了架构主链路的骨架：

```text
学校搜索
  -> 创建登录上下文
  -> 提交登录并创建 binding
  -> 读取 CourseCache
  -> 创建 SyncRecord
```

它还没有完整实现 wxapp 的业务能力。尤其是 WTBU 的真实教务登录、课表抓取、成绩、考试、个人信息、反馈、设置、管理员后台等能力，当前主项目没有按新架构迁移完成。

这些能力不能直接把 `wxapp/cloudfunctions/getSchedule/index.js` 整体搬进后端。按架构要求，必须拆到：

```text
Provider LoginStrategy
Provider CourseConnector / ScoreConnector / ExamConnector / ProfileConnector
Parser / Normalizer
CourseCache / FeatureCache
SyncRecord
前端只读后端缓存
```

## 功能对照表

| wxapp 功能 | 参考实现位置 | 主项目状态 | 架构内落点 |
| --- | --- | --- | --- |
| 学校列表、搜索、选择 | `pages/login`、`schools/index.js` | 部分实现 | `GET /schools` + `School` |
| WTBU 教务账号密码绑定 | `action=bind` | 只有占位；没有真实 Provider 登录 | `POST /schools/:schoolId/login` + `LoginStrategy.submit` |
| 教务密码加密保存 | `eduAccountBindings.passwordCipher` | 未实现；第一版默认不长期保存学校密码 | 后续如确需自动续期，再按学校和用户授权扩展 |
| 打开小程序自动读取绑定状态 | `action=status` | 部分实现；当前以内部 `User.id` 和 `UserSchoolBinding` 为准 | `UserSchoolBinding` |
| 首页今日课程/考试 | `pages/home` | 部分实现今日课程；考试未实现 | 读 `CourseCache` / `FeatureCache(target=exam)` |
| 周课表展示 | `pages/schedule` | 部分实现 | `GET /bindings/:bindingId/timetable` |
| 按学期课表缓存 | `scheduleCaches` | 后端模型支持 `termId`，前端能力较弱 | `CourseCache.termId` |
| 手动刷新教务缓存 | `action=refreshAll` | 只创建 `SyncRecord`，尚未完成 Provider 抓取和缓存写入 | `POST /bindings/:bindingId/sync/:target` |
| 成绩查询与缓存 | `action=grades`、`pages/grades` | 未实现 | `FeatureCache(target=score)` |
| 考试安排查询与缓存 | `fetchExams`、`pages/grades` | 未实现 | `FeatureCache(target=exam)` |
| 个人资料查询 | `action=profile`、`pages/profile` | 仅 profile 页占位 | `FeatureCache(target=profile)` |
| 编辑/保存个人资料 | `action=saveProfile` | 未实现 | 独立 App 用户资料能力，不能混入 Provider |
| 解绑账号 | `action=unbind` | 未实现 | 删除/标记 `UserSchoolBinding`，清理相关缓存和状态 |
| 意见反馈 | `action=submitFeedback`、`pages/feedback` | 未实现 | 新增反馈模块，不属于 Provider |
| 管理员后台 | `action=adminDashboard`、`pages/admin` | 未实现 | 新增 admin 模块，不能复用云函数 openid 判权方式 |
| 管理员处理反馈 | `action=adminUpdateFeedback` | 未实现 | admin 模块 + 权限 |
| 设置页清缓存/退出 | `pages/settings` | 未实现 | 前端本地状态 + 后端解绑/清缓存和绑定状态 |
| 关于页 | `pages/about` | 未实现 | 纯前端静态页 |
| WTBU EAMS SHA1 salt 登录 | `wtbu.loginToEduSystem` | 未迁移 | `providers/wtbu/wtbu.login.ts` |
| WTBU 课表 raw 抓取 | `wtbu.fetchSchedule` | 未迁移 | `providers/wtbu/wtbu.course.ts` |
| WTBU TaskActivity 解析 | `wtbu.parseSchedule` | 未迁移 | `providers/wtbu/wtbu.parser.ts` |
| WTBU 成绩解析 | `wtbu.parseGrades` | 未迁移 | `providers/wtbu/wtbu.score.ts` |
| WTBU 考试解析 | `wtbu.parseExams` | 未迁移 | `providers/wtbu/wtbu.exam.ts` |
| WTBU 个人信息解析 | `wtbu.fetchProfile` / parser helpers | 未迁移 | `providers/wtbu/wtbu.profile.ts` |

## 当前主项目已有内容

后端已有：

- `User` / `School` / `UserSchoolBinding` / `CourseCache` / `FeatureCache` / `SyncRecord` / `FeedbackItem` / `SchoolAccessSubmission` Prisma 模型
- `GET /schools`
- `POST /schools/:schoolId/login-context`
- `POST /schools/:schoolId/login`
- `GET /bindings/:bindingId/timetable`
- `POST /bindings/:bindingId/sync/:target`
- `GET /sync/:syncId`

前端已有：

- 学校搜索
- 动态登录上下文渲染的基础能力
- 绑定入口
- 缓存课表读取
- 周课表视图
- 手动同步按钮
- 简单个人状态页

## 主要架构偏差

当前实现里有几个必须修正的点：

1. `AuthService.submitLogin` 直接创建用户和 binding，没有通过 `ProviderRegistry -> LoginStrategy`。
2. 直接密码模式没有调用 WTBU Provider，也没有写入 `CourseCache`。
3. `SyncService` 只写 `SyncRecord`，没有完成 Provider 调用和缓存写入。
4. 没有 `POST /bindings/:bindingId/raw-data` 和 `webview-sync/complete`。
5. 缺少 binding 归属校验。架构要求所有用户数据读取必须验证当前用户 owns `bindingId`。
6. 用户身份复用仍需按现有实现核实。第一版不强制引入 `UserIdentity` 表，但不能每次绑定都生成无法复用的新用户。
7. 没有将成绩、考试、个人信息落到 `FeatureCache`。
8. 前端页面数量和 wxapp 功能不等价，目前是一页多视图，缺少成绩、反馈、设置、关于、管理员视图。

## 不应照搬的 wxapp 行为

按现有架构，不应直接照搬这些旧实现：

- 默认加密保存教务密码。第一版默认不长期保存学校密码。
- 用云函数 openid 直接作为绑定主键。当前主项目必须先有内部 `User.id`，外部身份复用后续再按真实登录方式扩展。
- 云函数一个文件同时处理登录、抓取、解析、缓存、反馈、管理员。新架构必须拆分到业务模块和 Provider。
- 普通读取接口触发学校系统请求。新架构要求前端优先读后端缓存，同步走任务。

## 推荐迁移顺序

1. 先修数据库连通和 seed，保证 `/schools` 可从 PostgreSQL 返回。
2. 将 WTBU 适配拆为 `providers/wtbu/`：
   `wtbu.provider.ts`、`wtbu.login.ts`、`wtbu.course.ts`、`wtbu.parser.ts`、`wtbu.score.ts`、`wtbu.exam.ts`、`wtbu.profile.ts`、`wtbu.constants.ts`。
3. 扩展 `SchoolProvider` 类型，补齐 `login/course/score/exam/profile` connector。
4. 改造 `AuthService`，通过 `ProviderRegistry` 调用 LoginStrategy，不在业务层写学校差异。
5. 实现课程首次缓存写入：登录成功或 WebView raw-data 上传成功后，抓取/解析 course，写 `CourseCache`。
6. 实现 `FeatureCache` 的 score/exam/profile 读写接口。
7. 实现解绑、反馈、设置、关于、管理员模块。
8. 最后做前端页面补齐和状态体验。
