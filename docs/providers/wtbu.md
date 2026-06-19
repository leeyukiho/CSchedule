# WTBU 入参和数据示例

## syncWtbu 入参

```json
{
  "source": "backend_auto_sync",
  "schoolId": "wtbu",
  "providerId": "wtbu",
  "targets": ["course", "profile", "score", "exam"],
  "username": "2023000000",
  "password": "password",
  "semesterId": "12345",
  "workerSecret": "optional-secret"
}
```

字段说明：

| 字段 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `providerId` | 是 | `wtbu` | 当前云函数只接受 `wtbu` |
| `targets` | 是 | `["course", "profile", "score", "exam"]` | 一次登录后按数组顺序抓取多个数据 |
| `username` | 是 | `2023000000` | WTBU 教务系统账号，通常是学号 |
| `password` | 是 | `password` | WTBU 教务系统密码 |
| `schoolId` | 否 | `wtbu` | 学校 ID |
| `source` | 否 | `backend_auto_sync` | 来源，前端首次导入可为 `frontend_first_import` |
| `semesterId` | 否 | `12345` | 只对课表指定学期有用，不传则取当前学期 |
| `workerSecret` | 否 | `optional-secret` | 后端自动同步时可用于云函数鉴权 |

前端首次导入示例：

```json
{
  "source": "frontend_first_import",
  "schoolId": "wtbu",
  "providerId": "wtbu",
  "targets": ["course", "profile", "score", "exam"],
  "username": "2023000000",
  "password": "password"
}
```

## 成功返回示例

```json
{
  "ok": true,
  "result": {
    "cacheResults": [
      {
        "target": "course",
        "termId": "12345",
        "cacheData": {
          "courses": [
            {
              "id": "1",
              "name": "高等数学",
              "teacher": "张三",
              "location": "教学楼 A101",
              "classroom": "教学楼 A101",
              "weekday": 1,
              "sections": [1, 2],
              "startSection": 1,
              "endSection": 2,
              "weeks": [1, 2, 3, 4, 5, 6, 7, 8]
            }
          ],
          "terms": [
            {
              "id": "12345",
              "rawLabel": "2025-2026 学年第二学期",
              "title": "2025-2026 第2学期",
              "label": "2025-2026 第2学期",
              "selected": true
            }
          ],
          "sectionTimes": []
        },
        "parsedCount": 1,
        "sourceHash": "sha256-hex",
        "syncedAt": "2026-06-18T00:00:00.000Z"
      },
      {
        "target": "profile",
        "cacheData": {
          "data": {
            "name": "张三",
            "studentId": "2023000000",
            "role": "学生",
            "maskedStudentId": "20****00",
            "major": "计算机科学与技术",
            "grade": "2023",
            "level": "本科",
            "className": "计科2301",
            "gender": "男",
            "birthDate": "",
            "politicalStatus": "",
            "phone": "",
            "email": "",
            "nativePlace": "",
            "enrollmentDate": "",
            "studentStatus": "",
            "dormitory": "",
            "counselor": "",
            "updatedAt": "2026-06-18T00:00:00.000Z"
          },
          "meta": {
            "source": "cloud_worker"
          }
        },
        "parsedCount": 20,
        "sourceHash": "sha256-hex",
        "syncedAt": "2026-06-18T00:00:00.000Z"
      },
      {
        "target": "score",
        "cacheData": {
          "data": {
            "summary": [
              { "label": "总学分", "value": "42" },
              { "label": "平均分", "value": "83.25" },
              { "label": "绩点", "value": "3.32" }
            ],
            "semesters": [
              {
                "id": "semester-1",
                "title": "2025-2026 第1学期",
                "credit": "20",
                "average": "83.5",
                "gpa": "3.3",
                "expanded": true,
                "grades": [
                  {
                    "name": "大学英语",
                    "credit": "2",
                    "score": "88",
                    "scoreLow": false,
                    "gpa": "3.8"
                  }
                ]
              }
            ]
          },
          "meta": {
            "source": "cloud_worker"
          }
        },
        "parsedCount": 1,
        "sourceHash": "sha256-hex",
        "syncedAt": "2026-06-18T00:00:00.000Z"
      },
      {
        "target": "exam",
        "cacheData": {
          "data": {
            "term": {
              "id": "1428",
              "rawLabel": "2025-2026 学年第二学期",
              "title": "2025-2026 第2学期",
              "label": "2025-2026 第2学期",
              "selected": true
            },
            "upcoming": [
              {
                "courseCode": "01311004.31",
                "courseName": "大学英语（4）",
                "examType": "期末考试",
                "date": "2026-07-03",
                "time": "13:10~14:50",
                "startAt": "2026-07-03T13:10:00+08:00",
                "endAt": "2026-07-03T14:50:00+08:00",
                "location": "弘德楼（原综合楼）608",
                "seatNo": "8",
                "status": "upcoming",
                "rawStatus": "正常",
                "remark": ""
              },
              {
                "courseCode": "09334003.02",
                "courseName": "解剖与透视",
                "examType": "期末考试",
                "date": "",
                "time": "",
                "startAt": "",
                "endAt": "",
                "location": "",
                "seatNo": "",
                "status": "unscheduled",
                "rawStatus": "正常",
                "remark": "时间未安排"
              }
            ],
            "finished": []
          },
          "meta": {
            "source": "cloud_worker",
            "scope": "current_term_only",
            "sourcePath": "/eams/stdExamTable!examTable.action?examBatch.id=1428",
            "observedAt": "2026-06-18T00:00:00.000+08:00"
          }
        },
        "parsedCount": 2,
        "sourceHash": "sha256-hex",
        "syncedAt": "2026-06-18T00:00:00.000Z"
      }
    ]
  }
}
```

## 学期标题解析

WTBU 教务系统里的学期原始文案会保留在 `rawLabel`，例如：

```json
{
  "rawLabel": "2025-2026 学年第二学期",
  "title": "2025-2026 第2学期",
  "label": "2025-2026 第2学期"
}
```

`rawLabel` 是教务系统返回的原始数据，用于调试和追溯；前端展示、缓存归并和学期匹配应使用规范化后的 `title` / `label`。解析规则应直接从原始文案提取学年和中文序数学期：

| 原始文案 | 展示标题 |
| --- | --- |
| `2025-2026 学年第一学期` | `2025-2026 第1学期` |
| `2025-2026 学年第二学期` | `2025-2026 第2学期` |

## WTBU 考试解析

考试只展示当前/最新学期，不抓取历史学期考试安排。当前学期由教务系统当前考试批次或当前学期接口确定，考试页面形如：

```text
/eams/stdExamTable!examTable.action?examBatch.id=1428
```

2026-06-18 访问该页面时，登录后返回的是 EAMS 表格，列结构如下：

| 列名 | 输出字段 | 说明 |
| --- | --- | --- |
| 课程序号 | `courseCode` | 课程教学班号 |
| 课程名称 | `courseName` | 考试课程名 |
| 考试类别 | `examType` | 例如 `期末考试` |
| 考试日期 | `date` | `YYYY-MM-DD`；`时间未安排` 记为空 |
| 考试安排 | `time` | 例如 `13:10~14:50`；`时间未安排` 记为空 |
| 考试地点 | `location` | `地点未安排` 记为空 |
| 考场座位号 | `seatNo` | `地点未安排` 记为空 |
| 考试情况 | `rawStatus` | 例如 `正常` |
| 其它说明 | `remark` | 额外说明；无内容为空字符串 |

解析结果按当前时间分为两个列表：

| 分组 | 条件 |
| --- | --- |
| `upcoming` | 当前学期内未结束的考试。包含已安排未来时间的考试，也包含 `时间未安排` 的待安排考试。 |
| `finished` | 当前学期内已经结束的考试，即 `endAt` 早于当前时间。 |

状态字段建议：

| `status` | 含义 |
| --- | --- |
| `upcoming` | 已安排时间，尚未结束 |
| `unscheduled` | 当前学期考试存在，但时间或地点未安排 |
| `finished` | 已结束 |

`date` 和 `time` 都可解析时，应生成东八区时间的 `startAt` / `endAt`。例如 `2026-07-03` + `13:10~14:50` 解析为：

```json
{
  "startAt": "2026-07-03T13:10:00+08:00",
  "endAt": "2026-07-03T14:50:00+08:00"
}
```

截至 2026-06-18，`examBatch.id=1428` 中已经安排到 `2026-07-03` 的考试应归入 `upcoming`，没有已结束考试；`时间未安排` 的当前学期记录也保留在 `upcoming`，并标记为 `status: "unscheduled"`。

## 失败返回示例

```json
{
  "ok": false,
  "errorCode": "WTBU_INVALID_CREDENTIALS",
  "errorMessage": "WTBU_INVALID_CREDENTIALS"
}
```
