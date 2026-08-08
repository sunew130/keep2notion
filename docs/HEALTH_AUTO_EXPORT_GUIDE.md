# 🏥 Apple Health → Notion 全量数据同步方案

> **架构**：Apple Watch → Apple Health → Health Auto Export → Notion API → Health Data Warehouse
>
> **零服务器依赖**：iPhone 直接调 Notion API，不经过任何公网服务器

---

## 一、整体架构

```
┌───────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Apple     │────▶│ Apple Health │────▶│ Health Auto      │────▶│ Notion API  │
│ Watch     │     │ (HealthKit)  │     │ Export (iPhone)  │     │             │
└───────────┘     └──────────────┘     └──────────────────┘     └──────┬──────┘
                                                                    │
                                                          ┌─────────▼──────────┐
                                                          │  Health Data       │
                                                          │  Warehouse (5 DBs) │
                                                          └────────────────────┘
```

### 数据流

1. **Apple Watch** 采集心率/步数/睡眠/运动等原始数据
2. **Apple Health** (HealthKit) 统一存储
3. **Health Auto Export** App 读取 HealthKit 全量数据，生成 JSON
4. **REST API POST** → `https://api.notion.com/v1/pages`
5. **Notion** 5 个数据库组成 Health Data Warehouse

---

## 二、Notion Database 设计

### 已创建的 5 个数据库

| 数据库 | ID | 用途 |
|--------|-----|------|
| 📊 Health Summary | `3b6632bf-6647-8104-befd-f4620f4074fc` | 每日健康摘要（每天1条） |
| 💊 Health Samples | `3b6632bf-6647-810c-a3cc-e749a2518f11` | 原始指标数据（心率/步数/血氧等） |
| 😴 Sleep Records | `3b6632bf-6647-8196-a8c3-de9695741685` | 睡眠分阶段记录 |
| 🏃 Workout Records | `3b6632bf-6647-811f-b74e-d4863d7f9042` | 运动记录 |
| ⚖️ Body Metrics | `3b6632bf-6647-81fc-a41b-fb9b69195882` | 身体成分指标 |

Parent Page: `3b6632bf-6647-813a-9c1b-d3220cfdd0ba` (Health Data Warehouse)

---

### Database 1: 📊 Health Summary

| 属性名 | 类型 | 说明 |
|--------|------|------|
| 标题 | title | 自动生成 "Health 2026-08-08" |
| 日期 | date | 当天日期 |
| 健康评分 | number | 0-100 |
| 步数 | number | 每日总步数 |
| 睡眠小时 | number | 总睡眠时长 |
| 运动分钟 | number | 运动总时长 |
| 活动消耗 | number | 活动能量 kcal |
| 静息心率 | number | bpm |
| HRV | number | ms |
| 体重 | number | kg |
| 血氧 | number | % |
| VO2 Max | number | ml/kg/min |
| AI总结 | rich_text | 自动生成分析 |
| source_id | rich_text | 去重用唯一键 |

### Database 2: 💊 Health Samples

| 属性名 | 类型 | 说明 |
|--------|------|------|
| 标题 | title | "心率 2026-08-08 14:30" |
| 日期 | date | 数据日期 |
| 类型 | select | 心率/步数/血氧/呼吸频率等 |
| 数值 | number | |
| 单位 | rich_text | bpm/count/%/等 |
| 开始时间 | date | ISO datetime |
| 结束时间 | date | ISO datetime |
| 来源 | rich_text | Apple Watch / 小米手环 |
| source_id | rich_text | 去重键 = type_startTime |

### Database 3: 😴 Sleep Records

| 属性名 | 类型 | 说明 |
|--------|------|------|
| 标题 | title | "睡眠 2026-08-08" |
| 日期 | date | |
| 阶段 | select | Deep / Core / REM / Awake |
| 时长分钟 | number | |
| 开始时间 | date | |
| 结束时间 | date | |
| 来源 | rich_text | |
| source_id | rich_text | 去重键 = date_stage_start |

### Database 4: 🏃 Workout Records

| 属性名 | 类型 | 说明 |
|--------|------|------|
| 标题 | title | "跑步 2026-08-08" |
| 日期 | date | |
| 类型 | select | Running / Walking / Cycling 等 |
| 时长秒 | number | |
| 距离米 | number | |
| 卡路里 | number | |
| 平均心率 | number | |
| 最大心率 | number | |
| 来源 | rich_text | |
| source_id | rich_text | 去重键 = type_startTime |

### Database 5: ⚖️ Body Metrics

| 属性名 | 类型 | 说明 |
|--------|------|------|
| 标题 | title | "体重 2026-08-08" |
| 日期 | date | |
| 体重kg | number | |
| 身高cm | number | |
| BMI | number | |
| 体脂率 | number | % |
| 肌肉量kg | number | |
| 来源 | rich_text | |
| source_id | rich_text | 去重键 = date_type |

---

## 三、HealthKit 字段映射表

### Activity → Health Samples

| HealthKit Identifier | Notion 类型 | Notion 数值 | 单位 |
|---------------------|-------------|-------------|------|
| `HKQuantityTypeIdentifierStepCount` | 步数 | 原始值 | count |
| `HKQuantityTypeIdentifierDistanceWalkingRunning` | 步行跑步距离 | 原始值 | km |
| `HKQuantityTypeIdentifierFlightsClimbed` | 爬楼层数 | 原始值 | count |
| `HKQuantityTypeIdentifierActiveEnergy` | 活动能量 | 原始值 | kcal |
| `HKQuantityTypeIdentifierBasalEnergy` | 基础能量 | 原始值 | kcal |
| `HKQuantityTypeIdentifierAppleExerciseTime` | 运动时间 | 原始值 | min |
| `HKQuantityTypeIdentifierAppleStandTime` | 站立时间 | 原始值 | min |

### Heart → Health Samples

| HealthKit Identifier | Notion 类型 | 单位 |
|---------------------|-------------|------|
| `HKQuantityTypeIdentifierHeartRate` | 心率 | bpm |
| `HKQuantityTypeIdentifierRestingHeartRate` | 静息心率 | bpm |
| `HKQuantityTypeIdentifierWalkingHeartRateAverage` | 步行平均心率 | bpm |
| `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | HRV | ms |
| `HKQuantityTypeIdentifierHeartRateRecoveryAtOneMinute` | 心率恢复 | bpm |

### Sleep → Sleep Records

| HealthKit Identifier | Notion 阶段 |
|---------------------|-------------|
| `HKCategoryValueSleepAnalysisInBed` | InBed |
| `HKCategoryValueSleepAnalysisAsleepUnspecified` | Core |
| `HKCategoryValueSleepAnalysisAsleepDeep` | Deep |
| `HKCategoryValueSleepAnalysisAsleepCore` | Core |
| `HKCategoryValueSleepAnalysisAsleepREM` | REM |
| `HKCategoryValueSleepAnalysisAwake` | Awake |

### Body → Body Metrics

| HealthKit Identifier | Notion 字段 | 单位 |
|---------------------|-------------|------|
| `HKQuantityTypeIdentifierBodyMass` | 体重kg | kg |
| `HKQuantityTypeIdentifierHeight` | 身高cm | cm |
| `HKQuantityTypeIdentifierBodyMassIndex` | BMI | - |
| `HKQuantityTypeIdentifierBodyFatPercentage` | 体脂率 | % |
| `HKQuantityTypeIdentifierLeanBodyMass` | 肌���量kg | kg |

### Respiratory → Health Samples

| HealthKit Identifier | Notion 类型 | 单位 |
|---------------------|-------------|------|
| `HKQuantityTypeIdentifierRespiratoryRate` | 呼吸频率 | count/min |
| `HKQuantityTypeIdentifierOxygenSaturation` | 血氧 | % |
| `HKQuantityTypeIdentifierVO2Max` | VO2 Max | ml/kg/min |

### Workout → Workout Records

| HealthKit 字段 | Notion 字段 |
|---------------|-------------|
| `workoutActivityType` | 类型 |
| `duration` | 时长秒 |
| `totalDistance` | 距离米 |
| `totalEnergyBurned` | 卡路里 |
| `averageHeartRate` | 平均心率 |
| `maximumHeartRate` | 最大心率 |
| `startDate` | 开始时间 |

---

## 四、Health Auto Export 配置

### Step 1: 安装 App

App Store 搜索 **"Health Auto Export"**（开发者：Cosmic, Inc.）

> ⚠️ 这是付费 App（¥68），但功能完整、稳定可靠，是目前最成熟的 HealthKit → REST API 方案。

### Step 2: 授予 HealthKit 权限

1. 打开 Health Auto Export
2. 首次启动会弹出健康权限请求
3. **全选** 所有数据类型（右上角"全选"）
4. 点"允许"

### Step 3: 配置 REST API

在 App 中进入 **Settings → REST API**：

```
┌─────────────────────────────────────┐
│  REST API Configuration             │
├─────────────────────────────────────┤
│                                     │
│  Method:     POST                   │
│                                     │
│  URL:        见下方各数据库配置       │
│                                     │
│  Headers:                           │
│    Authorization:  Bearer YOUR_TOKEN│
│    Notion-Version: 2022-06-28       │
│    Content-Type:   application/json │
│                                     │
│  Body Format: JSON                  │
│                                     │
│  Trigger:     Daily / Manual        │
│                                     │
└─────────────────────────────────────┘
```

### Step 4: 配置每个数据库的 Endpoint

由于 Notion API 一次只能创建一个 page，Health Auto Export 需要配置 **多个 Endpoint** 或使用 **Transformation** 功能。

#### 方案 A：多 Endpoint 配置（推荐）

在 Health Auto Export 的 **Transformations** 功能中，为每种数据类型配置独立的 POST 请求：

| 数据类型 | Endpoint URL | 目标数据库 |
|---------|-------------|-----------|
| Heart Rate | `https://api.notion.com/v1/pages` | Health Samples |
| Steps | `https://api.notion.com/v1/pages` | Health Samples |
| Sleep | `https://api.notion.com/v1/pages` | Sleep Records |
| Workout | `https://api.notion.com/v1/pages` | Workout Records |
| Weight | `https://api.notion.com/v1/pages` | Body Metrics |
| Daily Summary | `https://api.notion.com/v1/pages` | Health Summary |

#### 方案 B：单 Endpoint + Daily Summary（更简单）

只配置一个 Endpoint，每天生成一条 Health Summary：

```
URL: https://api.notion.com/v1/pages
```

---

## 五、Notion API JSON 模板

### 模板 1: Health Summary (每日摘要)

```json
{
  "parent": {
    "database_id": "3b6632bf-6647-8104-befd-f4620f4074fc"
  },
  "properties": {
    "标题": {
      "title": [{"text": {"content": "Health {{DATE}}"}}]
    },
    "日期": {
      "date": {"start": "{{DATE}}"}
    },
    "步数": {
      "number": {{STEPS}}
    },
    "睡眠小时": {
      "number": {{SLEEP_HOURS}}
    },
    "运动分钟": {
      "number": {{EXERCISE_MINUTES}}
    },
    "活动消耗": {
      "number": {{ACTIVE_ENERGY}}
    },
    "静息心率": {
      "number": {{RESTING_HR}}
    },
    "HRV": {
      "number": {{HRV}}
    },
    "体重": {
      "number": {{WEIGHT}}
    },
    "血氧": {
      "number": {{SPO2}}
    },
    "VO2 Max": {
      "number": {{VO2MAX}}
    },
    "健康评分": {
      "number": {{HEALTH_SCORE}}
    },
    "source_id": {
      "rich_text": [{"text": {"content": "health_{{DATE}}"}}]
    }
  }
}
```

### 模板 2: Health Samples (单条指标)

```json
{
  "parent": {
    "database_id": "3b6632bf-6647-810c-a3cc-e749a2518f11"
  },
  "properties": {
    "标题": {
      "title": [{"text": {"content": "{{TYPE_NAME}} {{DATETIME}}"}}]
    },
    "日期": {
      "date": {"start": "{{DATE}}"}
    },
    "类型": {
      "select": {"name": "{{TYPE_NAME}}"}
    },
    "数值": {
      "number": {{VALUE}}
    },
    "单位": {
      "rich_text": [{"text": {"content": "{{UNIT}}"}}]
    },
    "开始时间": {
      "date": {"start": "{{START_TIME_ISO}}"}
    },
    "结束时间": {
      "date": {"start": "{{END_TIME_ISO}}"}
    },
    "来源": {
      "rich_text": [{"text": {"content": "{{SOURCE}}"}}]
    },
    "source_id": {
      "rich_text": [{"text": {"content": "{{TYPE}}_{{START_TIME}}"}}]
    }
  }
}
```

### 模板 3: Sleep Records

```json
{
  "parent": {
    "database_id": "3b6632bf-6647-8196-a8c3-de9695741685"
  },
  "properties": {
    "标题": {
      "title": [{"text": {"content": "睡眠 {{DATE}}"}}]
    },
    "日期": {
      "date": {"start": "{{DATE}}"}
    },
    "阶段": {
      "select": {"name": "{{STAGE}}"}
    },
    "时长分钟": {
      "number": {{DURATION_MIN}}
    },
    "开始时间": {
      "date": {"start": "{{START_ISO}}"}
    },
    "结束时间": {
      "date": {"start": "{{END_ISO}}"}
    },
    "来源": {
      "rich_text": [{"text": {"content": "{{SOURCE}}"}}]
    },
    "source_id": {
      "rich_text": [{"text": {"content": "sleep_{{DATE}}_{{STAGE}}_{{START}}"}}]
    }
  }
}
```

### 模板 4: Workout Records

```json
{
  "parent": {
    "database_id": "3b6632bf-6647-811f-b74e-d4863d7f9042"
  },
  "properties": {
    "标题": {
      "title": [{"text": {"content": "{{WORKOUT_TYPE}} {{DATE}}"}}]
    },
    "日期": {
      "date": {"start": "{{DATE}}"}
    },
    "类型": {
      "select": {"name": "{{WORKOUT_TYPE}}"}
    },
    "时长秒": {
      "number": {{DURATION_SEC}}
    },
    "距离米": {
      "number": {{DISTANCE_M}}
    },
    "卡路里": {
      "number": {{CALORIES}}
    },
    "平均心率": {
      "number": {{AVG_HR}}
    },
    "最大心率": {
      "number": {{MAX_HR}}
    },
    "来源": {
      "rich_text": [{"text": {"content": "{{SOURCE}}"}}]
    },
    "source_id": {
      "rich_text": [{"text": {"content": "workout_{{TYPE}}_{{START_TIME}}"}}]
    }
  }
}
```

### 模板 5: Body Metrics

```json
{
  "parent": {
    "database_id": "3b6632bf-6647-81fc-a41b-fb9b69195882"
  },
  "properties": {
    "标题": {
      "title": [{"text": {"content": "体重 {{DATE}}"}}]
    },
    "日期": {
      "date": {"start": "{{DATE}}"}
    },
    "体重kg": {
      "number": {{WEIGHT}}
    },
    "身高cm": {
      "number": {{HEIGHT}}
    },
    "BMI": {
      "number": {{BMI}}
    },
    "体脂率": {
      "number": {{BODY_FAT}}
    },
    "肌肉量kg": {
      "number": {{LEAN_MASS}}
    },
    "来源": {
      "rich_text": [{"text": {"content": "{{SOURCE}}"}}]
    },
    "source_id": {
      "rich_text": [{"text": {"content": "body_{{DATE}}"}}]
    }
  }
}
```

---

## 六、增量同步方案

### 首次同步

1. 打开 Health Auto Export
2. 选择 **Export All History**
3. App 会分批 POST 到 Notion API
4. 每批间隔 ~350ms（避免触发 Notion 限流 3次/秒）

### 日常增量同步

```
┌─────────────────────────────────────────────┐
│  每日自动同步流程                             │
├─────────────────────────────────────────────┤
│                                             │
│  1. Health Auto Export 记录 last_sync_time   │
│  2. 每天凌晨 4:00 自动触发                    │
│  3. 只读取 last_sync_time 之后的新数据         │
│  4. 按 source_id 去重                        │
│  5. 分批 POST 到 Notion                       │
│  6. 更新 last_sync_time                      │
│                                             │
└─────────────────────────────────────────────┘
```

### 去重策略

每条记录的 `source_id` 格式：

| 数据类型 | source_id 格式 | 示例 |
|---------|---------------|------|
| Health Samples | `{type}_{startTime}` | `heartRate_2026-08-08T14:30:00` |
| Sleep Records | `sleep_{date}_{stage}_{startTime}` | `sleep_2026-08-08_Deep_2026-08-08T02:00:00` |
| Workout Records | `workout_{type}_{startTime}` | `workout_Running_2026-08-08T07:00:00` |
| Body Metrics | `body_{date}` | `body_2026-08-08` |
| Health Summary | `health_{date}` | `health_2026-08-08` |

> Notion API 不支持 upsert，去重依赖 Health Auto Export 的增量同步逻辑（只发送新数据）。

---

## 七、性能优化

### Notion API 限制

| 限制 | 值 |
|------|-----|
| 速率限制 | 3 请求/秒（每个 integration） |
| 单次请求大小 | 1MB |
| 建议批次大小 | 100 条/批 |

### Health Auto Export 批量配置

```
Settings:
  ┌──────────────────────────┐
  │ Batch Size:  50 records  │
  │ Delay:       350ms       │
  │ Retry:       3 times     │
  │ Retry Delay: 2s          │
  └──────────────────────────┘
```

### 失败重试

```
┌─────────────────────────────────────┐
│  POST → Notion API                  │
│                                     │
│  成功 (200) → 继续下一条              │
│  限流 (429) → 等待 2s → 重试         │
│  失败 (4xx/5xx) → 重试 3 次          │
│  3次失败 → 记录日志，跳过             │
│                                     │
└─────────────────────────────────────┘
```

---

## 八、安全方案

### Token 保护

Health Auto Export 支持自定义 HTTP Headers，Token 存储在 App 内部，不会暴露在 URL 或请求体中。

```
Headers 配置（在 Health Auto Export 内设置）:
┌────────────────────────────────────────────┐
│ Authorization:  Bearer ntn_xxxxxxxxxxxx    │  ← 仅存储在 App 内部
│ Notion-Version: 2022-06-28                 │
│ Content-Type:   application/json           │
└────────────────────────────────────────────┘
```

### 安全建议

1. **不要截图 Headers 配置**
2. **不要将 Token 写在任何 JSON 模板文件里**
3. **Token 只在 Health Auto Export App 内输入**
4. **定期在 Notion 设置中检查 Integration 权限**
5. **如需撤销：Notion → Settings → Connections → 移除 Integration**

---

## 九、完整配置步骤（保姆级）

### 第 1 步：安装 Health Auto Export

App Store 搜索 `Health Auto Export`，购买安装（¥68）。

### 第 2 步：授权 HealthKit

打开 App → 首次启动 → 弹出健康权限 → **右上角"全选"** → 允许。

### 第 3 步：获取 Notion Token

你的 Token 已经创建好，在 Health Auto Export 中配置 Headers：

```
Authorization: Bearer [你的Notion Token]
Notion-Version: 2022-06-28
Content-Type: application/json
```

### 第 4 步：配置 REST API Endpoint

在 Health Auto Export → **Settings → Upload / Sync**：

1. 开启 **REST API**
2. Method: `POST`
3. URL: `https://api.notion.com/v1/pages`
4. 输入上面 3 个 Headers

### 第 5 步：配置 Data Transformation

在 **Transformations** 中创建规则，将 Apple Health 数据映射到 Notion JSON：

1. 创建 Transformation Rule
2. 选择数据类型（如 Step Count）
3. 选择目标格式：Custom JSON
4. 粘贴上方对应的 JSON 模板
5. 用 `{{variable}}` 占位符映射 Health Auto Export 的变量

### 第 6 步：首次全量同步

1. 回到主界面 → **Sync Now**
2. 选择 **Full History**（首次）或 **Last 7 Days**
3. 点 **Start**
4. 等待上传完成（1000条约需 6 分钟）

### 第 7 步：设置自动同步

Settings → **Auto Sync**：
- 频率：Every 24 hours
- 时间：04:00（凌晨自动）
- 数据范围：Since Last Sync

---

## 十、Notion 数据库链接

创建完成后，在 Notion 中访问：

**Health Data Warehouse 主页：**
https://app.notion.com/p/Health-Data-Warehouse-3b6632bf6647813a9c1bd3220cfdd0ba

| 数据库 | 直接链接 |
|--------|---------|
| Health Summary | `https://www.notion.so/3b6632bf66478104befdf4620f4074fc` |
| Health Samples | `https://www.notion.so/3b6632bf6647810ca3cce749a2518f11` |
| Sleep Records | `https://www.notion.so/3b6632bf66478196a8c3de9695741685` |
| Workout Records | `https://www.notion.so/3b6632bf6647811fb74ed4863d7f9042` |
| Body Metrics | `https://www.notion.so/3b6632bf664781fca41bfb9b69195882` |

---

## 十一、后续扩展：接入 Life OS

当 Notion 数据积累后，可以通过现有的 `POST /v1/health/sync-notion` 接口将数据拉入 PostgreSQL：

```bash
curl -X POST http://your-server:8090/v1/health/sync-notion \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

服务器会自动从 Notion 拉取：
- Health Summary → `fitness.daily_vitals`
- Health Samples → `fitness.heart_rate_logs`
- Sleep Records → `fitness.sleep_logs`
- Workout Records → `fitness.workouts`
- Body Metrics → `fitness.daily_vitals`

最终在 Life OS 前端展示完整的健康看板。
