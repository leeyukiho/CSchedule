# Database Plan

The current product flow only needs eight business tables. Extra tables for
future identity providers, reusable login sessions, provider bindings, and
account migration were removed from the active Prisma schema because there is no
implemented code path using them yet.

## Tables

### User

Internal account anchor.

- `id`: internal user id.
- `status`: `active`, `disabled`, or `pending`.
- `role`: `user` or `admin`.
- `createdAt`, `updatedAt`: audit timestamps.

### School

School catalog and provider configuration.

- `id`: stable school/provider key.
- `name`, `shortName`, `province`, `city`, `aliases`: catalog display fields.
- `providerId`: provider adapter key, when connected.
- `loginMode`: how the user authenticates with the school system.
- `dataAccess`: per-target access modes, stored as JSON.
- `capabilities`: enabled target map, stored as JSON.
- `featureCapabilities`: optional detailed capabilities.
- `eduSystemType`, `homepageUrl`, `authUrl`: provider metadata.
- `enabled`, `status`, `verifiedAt`: rollout state.
- `config`: provider/auth/catalog details that do not need first-class columns.
- `createdAt`, `updatedAt`: audit timestamps.

### UserSchoolBinding

A user's binding to one school account.

- `userId`, `schoolId`, `providerId`: ownership and routing keys.
- `studentNoEncrypted`, `displayName`: optional account display data.
- `status`: active/login/cache lifecycle.
- `authState`, `cacheState`: compact JSON state for the current flow.
- `sessionReusable`, `sessionRefreshable`, `sessionExpireAt`,
  `lastSessionValidatedAt`: session capability markers without a separate
  session table.
- `credentialSaveMode`: selected credential/session retention mode.
- `lastAuthErrorCode`, `lastAuthErrorAt`, `lastLoginAt`, `lastCachedAt`: sync
  and auth state.
- `createdAt`, `updatedAt`: audit timestamps.

### CourseCache

Latest imported course data snapshots.

- `userId`, `bindingId`, `schoolId`, `providerId`: lookup and ownership keys.
- `termId`: optional term selector.
- `coursesJson`, `termsJson`, `sectionTimesJson`: normalized timetable payloads.
- `sourceHash`: deterministic hash of uploaded source.
- `syncedAt`, `createdAt`, `updatedAt`: cache timestamps.

### FeatureCache

Generic cache for score, exam, and profile data.

- `userId`, `bindingId`, `schoolId`, `providerId`: lookup and ownership keys.
- `target`: `score`, `exam`, or `profile`.
- `termId`: optional term selector.
- `dataJson`, `metaJson`: target data and metadata.
- `sourceHash`: deterministic hash of uploaded source.
- `syncedAt`, `createdAt`, `updatedAt`: cache timestamps.

### SyncRecord

Manual sync job and result history.

- `userId`, `bindingId`, `schoolId`, `providerId`: lookup and ownership keys.
- `target`: synced data target.
- `status`: sync lifecycle state.
- `errorCode`, `errorMessage`: failure detail.
- `startedAt`, `finishedAt`, `createdAt`: timing fields.

### FeedbackItem

User feedback queue.

- `userId`, `bindingId`, `schoolId`: optional context.
- `type`, `content`, `contact`, `status`: feedback payload and processing state.
- `createdAt`, `updatedAt`: audit timestamps.

### SchoolAccessSubmission

Request queue for adding or adapting a school.

- `submitterUserId`: optional requester.
- `schoolName`, `aliases`, `province`, `city`: school info.
- `officialWebsite`, `eduSystemWebsite`, `loginUrl`: submitted URLs.
- `loginModeHint`, `requestedTargets`: requested integration scope.
- `status`, `note`, `review`: review workflow.
- `createdAt`, `updatedAt`: audit timestamps.

## Deferred Tables

Add these only after the related flow is implemented:

- `UserIdentity`: when stable WeChat/openid, phone, email, or OAuth login exists.
- `LoginSession`: when the backend actually stores encrypted reusable school
  cookies/tokens and refreshes data in background jobs.
- `SchoolProviderBinding`: when one school needs multiple active provider
  configurations or versioned provider rollout.
- `AccountMigration`: when account merge/migration tools exist.
