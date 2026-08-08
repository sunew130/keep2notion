/**
 * Apple Health → Notion 自动同步
 * 
 * 使用方法：
 * 1. 在 iPhone 上安装 Scriptable App（免费）
 * 2. 将此脚本复制到 Scriptable 中
 * 3. 修改下面的 CONFIG 配置
 * 4. 在 iOS「快捷指令」App → 自动化 → 每天凌晨 4:00 → 运行此 Scriptable 脚本
 * 
 * 同步链路：
 * iPhone HealthKit → 此脚本 → Notion API → Go 后端（每小时拉取）→ PostgreSQL
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG — 修改这些配置
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
    // Notion Integration Token（从 keep2notion/.env 获取）
    NOTION_TOKEN: "YOUR_NOTION_TOKEN_HERE",
    
    // Notion 数据库 ID
    DB_WEIGHT: "1dc632bf-6647-813d-a191-d6247ac17710",   // 体重
    DB_SLEEP:  "3b6632bf-6647-81e0-85a5-ed6af9fbd144",   // 睡眠
    DB_HR:     "3b6632bf-6647-81bc-8c5c-cf286b831194",   // 心率
    
    // 回看天数（默认 1 = 只上传昨天的数据）
    LOOKBACK_DAYS: 1,
};

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function formatDate(date) {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function daysAgo(n) {
    let d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
}

function todayStart() {
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

async function notionCreatePage(databaseId, properties) {
    const url = "https://api.notion.com/v1/pages";
    const req = new Request(url);
    req.method = "POST";
    req.headers = {
        "Authorization": `Bearer ${CONFIG.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    };
    req.body = JSON.stringify({
        parent: { database_id: databaseId },
        properties: properties,
    });
    try {
        const resp = await req.loadJSON();
        return resp;
    } catch (e) {
        console.log(`Notion API error: ${e}`);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// HealthKit 数据读取
// ═════════════���═════════════════════════════════════════════════

/**
 * 读取健康样本
 * @param {string} quantityType - HealthKit 类型标识符
 * @param {Date} startDate 
 * @param {Date} endDate
 * @returns {Promise<Array>}
 */
async function getHealthSamples(quantityType, startDate, endDate) {
    try {
        const health = HealthKit;
        const samples = await health.queryQuantitySamples({
            quantityType: quantityType,
            unit: "count",
            startDate: startDate,
            endDate: endDate,
            limit: 1000,
        });
        return samples;
    } catch (e) {
        console.log(`HealthKit error for ${quantityType}: ${e}`);
        return [];
    }
}

/**
 * 获取最新的单个样本值
 */
async function getLatestSample(quantityType, startDate, endDate, unit) {
    try {
        const health = HealthKit;
        const samples = await health.queryQuantitySamples({
            quantityType: quantityType,
            unit: unit || "count",
            startDate: startDate,
            endDate: endDate,
            limit: 1,
            sortDescriptors: [{ key: "startDate", ascending: false }],
        });
        return samples.length > 0 ? samples[0] : null;
    } catch (e) {
        console.log(`HealthKit error: ${e}`);
        return null;
    }
}

/**
 * 计算样本总和
 */
async function getSumSamples(quantityType, startDate, endDate, unit) {
    try {
        const health = HealthKit;
        const samples = await health.queryQuantitySamples({
            quantityType: quantityType,
            unit: unit || "count",
            startDate: startDate,
            endDate: endDate,
            limit: 10000,
        });
        let sum = 0;
        for (const s of samples) {
            sum += s.quantity;
        }
        return sum;
    } catch (e) {
        console.log(`HealthKit sum error: ${e}`);
        return 0;
    }
}

// ═══════════════════════════════════════════════════════════════
// 同步函数
// ═══════════════════════════════════════════════════════════════

// 1. 同步体重
async function syncWeight(date) {
    const dateStr = formatDate(date);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    
    const sample = await getLatestSample("bodyMass", dayStart, dayEnd, "kg");
    if (!sample) {
        console.log(`⚖️ 体重 ${dateStr}: 无数据`);
        return;
    }
    
    const weight = Math.round(sample.quantity * 10) / 10;
    const sourceId = `apple_weight_${dateStr}`;
    
    await notionCreatePage(CONFIG.DB_WEIGHT, {
        "来源": { title: [{ text: { content: "Apple Health" } }] },
        "重量": { number: weight },
        "时间": { date: { start: dateStr } },
        "id": { rich_text: [{ text: { content: sourceId } }] },
        "单位": { rich_text: [{ text: { content: "kg" } }] },
    });
    console.log(`⚖️ 体重 ${dateStr}: ${weight}kg ✓`);
}

// 2. 同步睡眠
async function syncSleep(date) {
    const dateStr = formatDate(date);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    
    // 读取睡眠分析（Asleep + InBed）
    let sleepSamples = [];
    try {
        const health = HealthKit;
        // 尝试读取 category samples
        sleepSamples = await health.queryCategorySamples({
            categoryType: "sleepAnalysis",
            startDate: dayStart,
            endDate: dayEnd,
            limit: 1000,
        });
    } catch (e) {
        console.log(`😴 睡眠 ${dateStr}: HealthKit 读取失败 ${e}`);
        return;
    }
    
    if (!sleepSamples || sleepSamples.length === 0) {
        console.log(`😴 睡眠 ${dateStr}: 无数据`);
        return;
    }
    
    // 计算总睡眠时长（Asleep 类别 = 1 in HK）
    let totalSleepMs = 0;
    let earliestBed = null;
    let latestWake = null;
    
    for (const s of sleepSamples) {
        // Apple's sleepAnalysis values: 0=InBed, 1=Asleep, 2=Awake, 3=AsleepCore, etc
        if (s.value === 1 || s.value === 3 || s.value === 4 || s.value === 5) {
            // Asleep (unified) or AsleepCore/Deep/REM
            const dur = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
            totalSleepMs += dur;
        }
        // 记录最早的入睡时间和最晚的起床时间
        const start = new Date(s.startDate);
        const end = new Date(s.endDate);
        if (!earliestBed || start < earliestBed) earliestBed = start;
        if (!latestWake || end > latestWake) latestWake = end;
    }
    
    if (totalSleepMs === 0) {
        console.log(`😴 睡眠 ${dateStr}: 无 Asleep 数据`);
        return;
    }
    
    const sleepMin = Math.round(totalSleepMs / 60000);
    const sourceId = `apple_sleep_${dateStr}`;
    
    const properties = {
        "标题": { title: [{ text: { content: `睡眠 ${dateStr}` } }] },
        "日期": { date: { start: dateStr } },
        "时长(分钟)": { number: sleepMin },
        "来源": { rich_text: [{ text: { content: "Apple Health" } }] },
        "id": { rich_text: [{ text: { content: sourceId } }] },
    };
    
    if (earliestBed) {
        properties["入睡时间"] = { date: { start: earliestBed.toISOString() } };
    }
    if (latestWake) {
        properties["起床时间"] = { date: { start: latestWake.toISOString() } };
    }
    
    await notionCreatePage(CONFIG.DB_SLEEP, properties);
    console.log(`😴 睡眠 ${dateStr}: ${sleepMin}分钟 (${Math.round(sleepMin/60*10)/10}h) ✓`);
}

// 3. 同步静息心率
async function syncRestingHR(date) {
    const dateStr = formatDate(date);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    
    const sample = await getLatestSample("restingHeartRate", dayStart, dayEnd, "count/min");
    if (!sample) {
        console.log(`❤️ 静息心率 ${dateStr}: 无数据`);
        return;
    }
    
    const hr = Math.round(sample.quantity);
    const ts = sample.startDate ? new Date(sample.startDate).toISOString() : dateStr + "T08:00:00+08:00";
    const sourceId = `apple_rhr_${dateStr}`;
    
    await notionCreatePage(CONFIG.DB_HR, {
        "标题": { title: [{ text: { content: `静息心率 ${dateStr}` } }] },
        "日期": { date: { start: dateStr } },
        "时间戳": { date: { start: ts } },
        "心率": { number: hr },
        "类型": { select: { name: "静息心率" } },
        "来源": { rich_text: [{ text: { content: "Apple Health" } }] },
        "id": { rich_text: [{ text: { content: sourceId } }] },
    });
    console.log(`❤️ 静息心率 ${dateStr}: ${hr}bpm ✓`);
}

// 4. 同步步数（写入 personal life system API）
async function syncSteps(date) {
    const dateStr = formatDate(date);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    
    const steps = await getSumSamples("stepCount", dayStart, dayEnd, "count");
    if (steps === 0) {
        console.log(`👟 步数 ${dateStr}: 无数据`);
        return;
    }
    
    console.log(`👟 步数 ${dateStr}: ${steps}步 ✓`);
    // 步数暂时只记录日志，后续可以写入 Notion 或直接 API
    // 如果需要写入个人系统，需要一个 API key 或 token
}

// 5. 同步步行距离（可选）
async function syncDistance(date) {
    const dateStr = formatDate(date);
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    
    const dist = await getSumSamples("distanceWalkingRunning", dayStart, dayEnd, "km");
    if (dist > 0) {
        console.log(`🚶 步行距离 ${dateStr}: ${Math.round(dist*100)/100}km`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log("══════════════════════════════");
    console.log("Apple Health → Notion 同步");
    console.log(`时间: ${new Date().toLocaleString()}`);
    console.log("══════════════════════════════");
    
    // 检查 Notion Token
    if (CONFIG.NOTION_TOKEN === "YOUR_NOTION_TOKEN_HERE") {
        console.log("❌ 请先设置 NOTION_TOKEN!");
        return;
    }
    
    // 同步过去 N 天的数据
    for (let i = 1; i <= CONFIG.LOOKBACK_DAYS; i++) {
        const date = daysAgo(i);
        const dateStr = formatDate(date);
        console.log(`\n--- ${dateStr} ---`);
        
        try {
            await syncWeight(date);
        } catch (e) { console.log(`体重同步异常: ${e}`); }
        
        try {
            await syncSleep(date);
        } catch (e) { console.log(`睡眠同步异常: ${e}`); }
        
        try {
            await syncRestingHR(date);
        } catch (e) { console.log(`心率同步异常: ${e}`); }
        
        try {
            await syncSteps(date);
        } catch (e) { console.log(`步数同步异常: ${e}`); }
        
        try {
            await syncDistance(date);
        } catch (e) { console.log(`距离同步异常: ${e}`); }
    }
    
    console.log("\n══════════════════════════════");
    console.log("✅ 同步完成！");
    console.log("══════════════════════════════");
    
    // 如果在 Scriptable 中运行，显示通知
    if (config.runsInApp) {
        const alert = new Alert();
        alert.title = "Health → Notion 同步完成";
        alert.message = `已同步 ${CONFIG.LOOKBACK_DAYS} 天数据`;
        alert.addAction("OK");
        await alert.present();
    } else {
        // 自动化运行时发通知
        const notif = new Notification();
        notif.title = "✅ Health → Notion 同步完成";
        notif.body = `已同步 ${CONFIG.LOOKBACK_DAYS} 天健康数据`;
        notif.schedule();
    }
}

// 运行
await main();
Script.complete();
