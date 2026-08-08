# iOS 快捷指令：Apple Health → Notion 自动同步

## 原理

```
iPhone 快捷指令（每天凌晨 4:00 自动触发）
  → 读取 Apple HealthKit 数据
  → POST 到 Notion API
  → Go 后端每小时自动拉取 Notion → PostgreSQL
```

## 前提条件

1. iPhone「设置」→「隐私与安全性」→「健康」→ 确保快捷指令有权限访问健康数据
2. 获取你的 Notion Integration Token（从 keep2notion/.env 中获取）
3. 以下 Notion 数据库需要分享给你的 Integration：
   - 体重表 (`1dc632bf-6647-813d-a191-d6247ac17710`)
   - 睡眠表 (`3b6632bf-6647-81e0-85a5-ed6af9fbd144`)
   - 心率表 (`3b6632bf-6647-81bc-8c5c-cf286b831194`)

## 快捷指令 1：体重上传（每天 4:00）

在 iPhone「快捷指令」App 中创建一个新快捷指令：

### 步骤：

1. **添加操作：** 搜索「健康」→ 选择「查找健康样本」
   - 类型：体重（Body Mass）
   - 限定：今天
   - 排序：最新在前
   - 获取：1 个样本

2. **添加操作：** 搜索「如果」
   - 条件：如果「健康样本」有任意值

3. **添加操作：** 在「如果」内部，搜索「获取字典值」
   - 键：`value`
   - 来源：第一个健康样本

4. **添加操作：** 搜索「文本」，输入以下 JSON 模板：
```
{"parent":{"database_id":"1dc632bf-6647-813d-a191-d6247ac17710"},"properties":{"来源":{"title":[{"text":{"content":"Apple Health"}}]},"重量":{"number":WEIGHT_VALUE},"时间":{"date":{"start":"DATE_TODAY"}},"id":{"rich_text":[{"text":{"content":"apple_DATE_TODAY"}}]},"单位":{"rich_text":[{"text":{"content":"kg"}}]}}}
```
   - 替换 `WEIGHT_VALUE` 为步骤 3 的字典值变量
   - 替换 `DATE_TODAY` 为「当前日期」变量（格式化为 YYYY-MM-DD）

5. **添加操作：** 搜索「获取 URL 内容」
   - URL: `https://api.notion.com/v1/pages`
   - 方法：POST
   - 请求头：
     - `Authorization`: `Bearer YOUR_NOTION_TOKEN`
     - `Notion-Version`: `2022-06-28`
     - `Content-Type`: `application/json`
   - 请求体：步骤 4 的文本

6. **自动化：** 在「自动化」Tab → 创建个人自动化 → 时间：每天 4:00 → 运行此快捷指令

---

## 快捷指令 2：睡眠上传（每天 4:00）

### 步骤：

1. **查找健康样本**
   - 类型：睡眠分析（Sleep Analysis）
   - 限定：昨天
   - 获取：所有样本

2. **计算总睡眠时长**
   - 用「计算」操作统计 `Asleep` 类型的总时长（分钟）

3. **POST 到 Notion：**
   - URL: `https://api.notion.com/v1/pages`
   - 数据库 ID: `3b6632bf-6647-81e0-85a5-ed6af9fbd144`
   - Body:
```json
{
  "parent": {"database_id": "3b6632bf-6647-81e0-85a5-ed6af9fbd144"},
  "properties": {
    "标题": {"title": [{"text": {"content": "睡眠 DATE_YESTERDAY"}}]},
    "日期": {"date": {"start": "DATE_YESTERDAY"}},
    "时长(分钟)": {"number": SLEEP_MINUTES},
    "来源": {"rich_text": [{"text": {"content": "Apple Health"}}]},
    "id": {"rich_text": [{"text": {"content": "apple_sleep_DATE_YESTERDAY"}}]}
  }
}
```

---

## 快捷指令 3：静息心率上传（每天 4:00）

### 步骤：

1. **查找健康样本**
   - 类型：静息心率（Resting Heart Rate）
   - 限定：昨天
   - 获取：1 个样本

2. **POST 到 Notion：**
   - 数据库 ID: `3b6632bf-6647-81bc-8c5c-cf286b831194`
   - Body:
```json
{
  "parent": {"database_id": "3b6632bf-6647-81bc-8c5c-cf286b831194"},
  "properties": {
    "标题": {"title": [{"text": {"content": "静息心率 DATE_YESTERDAY"}}]},
    "日期": {"date": {"start": "DATE_YESTERDAY"}},
    "时间戳": {"date": {"start": "TIMESTAMP_ISO"}},
    "心率": {"number": HR_VALUE},
    "类型": {"select": {"name": "静息心率"}},
    "来源": {"rich_text": [{"text": {"content": "Apple Health"}}]},
    "id": {"rich_text": [{"text": {"content": "apple_rhr_DATE_YESTERDAY"}}]}
  }
}
```

---

## 快捷指令 4：步数上传（每天 4:00）— 写入 daily_summary

### 步骤：

1. **查找健康样本**
   - 类型：步数（Step Count）
   - 限定：昨天
   - 获取：所有样本

2. **求和** 计算总步数

3. **POST 到你的个人系统 API：**
   - URL: `http://212.135.214.6:8095/v1/health/import`
   - 方法：POST
   - Body:
```json
{
  "type": "summary",
  "records": [{
    "date": "DATE_YESTERDAY",
    "steps": STEP_COUNT
  }]
}
```
   - 注意：需要 Bearer token

---

## 关键配置信息

### Notion Token
```
从 /home/suxinjian/keep2notion/.env 中获取 NOTION_TOKEN
格式：ntn_xxxxxxxxxxxx
```

### Notion 数据库 ID
```
体重：1dc632bf-6647-813d-a191-d6247ac17710
睡眠：3b6632bf-6647-81e0-85a5-ed6af9fbd144
心率：3b6632bf-6647-81bc-8c5c-cf286b831194
```

### 注意事项

1. **Notion Integration 权限**：确保三个数据库都已「分享」给你的 Notion Integration
   - 在 Notion 中打开数据库 → 右上角 `...` → `Connections` → 添加你的 Integration

2. **去重机制**：
   - 体重的 `id` 字段用 `apple_YYYY-MM-DD` 格式
   - 睡眠的 `id` 字段用 `apple_sleep_YYYY-MM-DD` 格式
   - 心率的 `id` 字段用 `apple_rhr_YYYY-MM-DD` 格式
   - Go 后端会通过 `source_id` 自动去重

3. **时间设置**：
   - 体重、心率：上传昨天的数据（完整一天的数据）
   - 睡眠：上传昨天的数据（因为凌晨 4 点时昨晚的睡眠已结束）
   - 自动化设置为「运行时不询问」（iOS 16+ 支持无感运行）

4. **iOS 版本要求**：iOS 16+（支持自动化不弹窗确认）
