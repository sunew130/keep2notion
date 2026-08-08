# ═══════════════════════════════════════════════════════════════
# Apple Health → Notion 自动同步
# 使用 Scriptable App（免费） + iOS 自动化
# ═══════════════════════════════════════════════════════════════

## 完整设置步骤

### Step 1: 安装 Scriptable App
在 App Store 搜索 **Scriptable**（免费），安装。

### Step 2: 获取 Notion Token
你的 Notion Token 已保存到服务器 `/tmp/real_token.txt`。
在终端执行 `cat /tmp/real_token.txt` 查看完整 token。
格式为 `ntn_` 开头的 50 字符字符串。

### Step 3: 在 Scriptable 中创建脚本
1. 打开 Scriptable App
2. 点击右上角 **+** 新建脚本
3. 命名为 **HealthToNotion**
4. 将同目录下 `AppleHealthToNotion.js` 的全部内容粘贴进去
5. 修改脚本中的 `NOTION_TOKEN` 为你的实际 token
6. 点击 **运行** 测试（首次会请求健康数据权限）

### Step 4: 创建 iOS 自动化（每天凌晨 4:00）
1. 打开 iPhone **「快捷指令」** App
2. 切换到 **「自动化」** Tab
3. 点击 **+** → **「创建个人自动化」**
4. 选择 **「时间」** → 设置 **04:00** → 选择 **每天**
5. 添加操作：**「运行脚本」**
   - Script: 选择 **HealthToNotion**
6. 关闭 **「运行前询问」**（iOS 16+ 支持，实现无感运行）
7. 点击 **「完成」**

### 数据同步链路

```
每天凌晨 4:00 iOS 自动触发
  → Scriptable 读取 Apple HealthKit（昨天的体重/睡眠/心率/步数）
  → POST 到 Notion 数据库（体重表/睡眠表/心率表）
  → Go 后端每小时自动拉取 Notion → PostgreSQL
  → 前端展示
```

### 同步的数据

| 数据 | Apple Health 类型 | Notion 表 | 去重 ID |
|------|-------------------|-----------|---------|
| ⚖️ 体重 | Body Mass | 体重 | apple_weight_YYYY-MM-DD |
| 😴 睡眠 | Sleep Analysis | 睡眠 | apple_sleep_YYYY-MM-DD |
| ❤️ 静息心率 | Resting Heart Rate | 心率 | apple_rhr_YYYY-MM-DD |
| 👟 步数 | Step Count | (日志) | — |

### 验证
运行脚本后在 Scriptable 控制台看到：
```
⚖️ 体重 2026-08-07: 67.5kg ✓
😴 睡眠 2026-08-07: 432分钟 (7.2h) ✓
❤️ 静息心率 2026-08-07: 58bpm ✓
👟 步数 2026-08-07: 8532步 ✓
✅ 同步完成！
```

然后 Notion 中会自动出现新记录，Go 后端下一轮同步（最多1小时后）会拉入 PostgreSQL。
也可手动触发：`curl -X POST http://your-server:8095/v1/health/sync-notion -H "Authorization: Bearer TOKEN"`
