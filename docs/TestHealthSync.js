// ═══════════════════════════════════════════════════════════════
// 测试脚本：Apple Health → Notion 连通性验证
// 在 Scriptable 中运行此脚本，验证：
// 1. Notion Token 是否有效
// 2. HealthKit 读取权限是否获取
// 3. 有哪些 HealthKit 数据
// 4. 能否成功写入 Notion
// ═══════════════════════════════════════════════════════════════

// ══════════════ CONFIG ══════════════
const NOTION_TOKEN = "YOUR_NOTION_TOKEN_HERE";  // ← 替换为你的 token

const DB = {
    体重:   "1dc632bf-6647-813d-a191-d6247ac17710",
    睡眠:   "3b6632bf-6647-81e0-85a5-ed6af9fbd144",
    心率:   "3b6632bf-6647-81bc-8c5c-cf286b831194",
    每日活动: "3b6632bf-6647-8192-a8d4-e3fe7c39750e",
    每日营养: "3b6632bf-6647-81a1-ae1b-c3dce9411a09",
    身体成分: "3b6632bf-6647-81f7-889a-cb9936683b90",
    环境监测: "3b6632bf-6647-8133-b7ae-df1cb03e1c35",
    心理健康: "3b6632bf-6647-81d4-806b-e33c5485b2d1",
};

let report = [];

function pad(str, len) {
    str = String(str);
    while (str.length < len) str += " ";
    return str;
}

function add(icon, label, status, detail) {
    report.push(`${icon} ${pad(label, 22)} ${status}  ${detail || ""}`);
}

// ══════════════ Step 1: 验证 Notion Token ══════════════
async function testNotion() {
    console.log("\n═══ Step 1: 验证 Notion 连接 ═══");
    
    if (NOTION_TOKEN === "YOUR_NOTION_TOKEN_HERE") {
        add("🔑", "Notion Token", "❌", "未设置！请填入你的 token");
        return false;
    }
    
    try {
        const req = new Request("https://api.notion.com/v1/users/me");
        req.headers = {
            "Authorization": `Bearer ${NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
        };
        const resp = await req.loadJSON();
        
        if (resp.name) {
            add("🔑", "Notion Token", "✅", `用户: ${resp.name}`);
        } else {
            add("🔑", "Notion Token", "❌", resp.message || "无效 token");
            return false;
        }
    } catch(e) {
        add("🔑", "Notion Token", "❌", String(e));
        return false;
    }
    
    // 检查每个数据库的访问权限
    for (const [name, dbId] of Object.entries(DB)) {
        try {
            const req = new Request(`https://api.notion.com/v1/databases/${dbId}`);
            req.headers = {
                "Authorization": `Bearer ${NOTION_TOKEN}`,
                "Notion-Version": "2022-06-28",
            };
            const resp = await req.loadJSON();
            
            if (resp.title) {
                const title = resp.title.map(t => t.plain_text).join("");
                add("🗄️", `DB: ${title}`, "✅", "可访问");
            } else {
                add("🗄️", `DB: ${name}`, "❌", resp.message || "无权限");
            }
        } catch(e) {
            add("🗄️", `DB: ${name}`, "❌", String(e));
        }
    }
    
    return true;
}

// ══════════════ Step 2: 扫描 HealthKit 数据 ══════════════
async function scanHealthKit() {
    console.log("\n═══ Step 2: 扫描 HealthKit 数据 ═══");
    
    // 扫描过去 7 天的数据
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    
    const types = [
        // 身体
        ["bodyMass",              "体重",        "kg",       "⚖️"],
        ["bodyMassIndex",         "BMI",         "count",    "📊"],
        ["bodyFatPercentage",     "体脂率",      "%",        "📊"],
        ["leanBodyMass",          "去脂体重",    "kg",       "💪"],
        ["height",                "身高",        "cm",       "📏"],
        ["waistCircumference",    "腰围",        "cm",       "📐"],
        // 心率
        ["restingHeartRate",      "静息心率",    "count/min","❤️"],
        ["walkingHeartRateAverage","步行心率",   "count/min","🚶"],
        ["heartRateVariabilitySDNN","HRV",      "ms",       "🫀"],
        ["oxygenSaturation",      "血氧",        "%",        "🩸"],
        ["respiratoryRate",       "呼吸频率",    "count/min","🫁"],
        // 活动
        ["stepCount",             "步数",        "count",    "👟"],
        ["distanceWalkingRunning","步行跑步距离","km",       "🚶"],
        ["distanceCycling",       "骑行距离",    "km",       "🚴"],
        ["distanceSwimming",      "游泳距离",    "km",       "🏊"],
        ["flightsClimbed",        "爬楼层",      "count",    "🏢"],
        ["activeEnergyBurned",    "活动能量",    "kcal",     "🔥"],
        ["appleExerciseTime",     "运动时长",    "min",      "⏱️"],
        ["appleStandTime",        "站立时长",    "min",      "🧍"],
        // 营养
        ["dietaryEnergyConsumed", "饮食热量",    "kcal",     "🍽️"],
        ["protein",               "蛋���质",      "g",        "🥩"],
        ["carbohydrates",         "碳水",        "g",        "🍞"],
        ["fatTotal",              "脂肪",        "g",        "🧈"],
        ["fiber",                 "纤维",        "g",        "🥦"],
        ["water",                 "水",          "L",        "💧"],
        ["caffeine",              "咖啡因",      "mg",       "☕"],
        ["alcoholConsumption",    "酒精",        "g",        "🍺"],
        // 环境
        ["environmentalSoundExposure","环境声音","dB",       "🔊"],
        ["headphoneAudioExposure","耳机音量",    "dB",       "🎧"],
    ];
    
    let hasAnyData = false;
    
    for (const [hkType, label, unit, icon] of types) {
        try {
            const samples = await HealthKit.queryQuantitySamples({
                quantityType: hkType,
                unit: unit,
                startDate: start,
                endDate: end,
                limit: 1,
                sortDescriptors: [{ key: "startDate", ascending: false }],
            });
            
            if (samples && samples.length > 0) {
                const val = samples[0].quantity;
                const dateStr = new Date(samples[0].startDate).toLocaleDateString();
                add(icon, label, "✅", `${round(val)} ${unit} (${dateStr})`);
                hasAnyData = true;
            } else {
                add(icon, label, "⬜", "7天内无数据");
            }
        } catch(e) {
            add(icon, label, "⬜", "无权限或不支持");
        }
    }
    
    // 检查睡眠（Category 类型，单独处理）
    try {
        const sleepSamples = await HealthKit.queryCategorySamples({
            categoryType: "sleepAnalysis",
            startDate: start,
            endDate: end,
            limit: 1,
        });
        if (sleepSamples && sleepSamples.length > 0) {
            const dateStr = new Date(sleepSamples[0].startDate).toLocaleDateString();
            add("😴", "睡眠", "✅", `有数据 (${dateStr})`);
            hasAnyData = true;
        } else {
            add("😴", "睡眠", "⬜", "7天内无数据");
        }
    } catch(e) {
        add("😴", "睡眠", "⬜", "无权限或不支持");
    }
    
    return hasAnyData;
}

function round(v, p) {
    p = p || 1;
    return Math.round(v * p) / p;
}

// ══════════════ Step 3: 写入测试数据到 Notion ══════════════
async function testWrite() {
    console.log("\n═══ Step 3: 测试写入 Notion ═══");
    
    const ds = new Date().toISOString().split('T')[0];
    
    // 向体重表写入一条测试数据
    try {
        const req = new Request("https://api.notion.com/v1/pages");
        req.method = "POST";
        req.headers = {
            "Authorization": `Bearer ${NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        };
        req.body = JSON.stringify({
            parent: { database_id: DB.体重 },
            properties: {
                "来源": { title: [{ text: { content: "🧪 测试连接" }}]},
                "重量": { number: 0.0 },
                "时间": { date: { start: "2000-01-01" }},
                "id":   { rich_text: [{ text: { content: "test_connectivity_check" }}]},
                "单位": { rich_text: [{ text: { content: "kg" }}]},
            },
        });
        const resp = await req.loadJSON();
        
        if (resp.id) {
            add("✍️", "写入测试", "✅", "成功写入并删除测试数据");
            
            // 删除测试数据
            try {
                const delReq = new Request(`https://api.notion.com/v1/pages/${resp.id}`);
                delReq.method = "PATCH";
                delReq.headers = {
                    "Authorization": `Bearer ${NOTION_TOKEN}`,
                    "Notion-Version": "2022-06-28",
                    "Content-Type": "application/json",
                };
                delReq.body = JSON.stringify({ archived: true });
                await delReq.loadJSON();
            } catch(e) {}
        } else {
            add("✍️", "写入测试", "❌", resp.message || "写入失败");
        }
    } catch(e) {
        add("✍️", "写入测试", "❌", String(e));
    }
}

// ══════════════ 主函数 ══════════════
async function main() {
    console.log("══════════════════════════════════");
    console.log("🔍 Apple Health → Notion 连通性测试");
    console.log(`📅 ${new Date().toLocaleString()}`);
    console.log("══════════════════════════════════");
    
    // Step 1: Notion 连接
    const notionOk = await testNotion();
    
    // Step 2: HealthKit 扫描
    const healthOk = await scanHealthKit();
    
    // Step 3: 写入测试（仅在 Notion 连接正常时）
    if (notionOk) {
        await testWrite();
    }
    
    // 生成报告
    let reportText = `══════════════════════════════════
🔍 连通性测试报告
${new Date().toLocaleString()}
══════════════════════════════════

`;
    for (const line of report) {
        reportText += line + "\n";
    }
    
    // 统计
    let okCount = report.filter(r => r.includes("✅")).length;
    let errCount = report.filter(r => r.includes("❌")).length;
    let emptyCount = report.filter(r => r.includes("⬜")).length;
    
    reportText += `\n══════════════════════════════════\n`;
    reportText += `✅ 正常: ${okCount} | ❌ 错误: ${errCount} | ⬜ 无数据: ${emptyCount}\n`;
    reportText += `══════════════════════════════════\n`;
    
    // 指引
    if (errCount > 0) {
        reportText += `\n⚠️ 错误指引:\n`;
        if (report.some(r => r.includes("Notion Token") && r.includes("❌"))) {
            reportText += `• Token 无效 → 检查 NOTION_TOKEN 是否正确\n`;
        }
        if (report.some(r => r.includes("DB:") && r.includes("❌"))) {
            reportText += `• 数据库无权限 → 在 Notion 中打开数据库 → 右上角 ... → Connections → 添加你的 Integration\n`;
        }
    }
    
    if (notionOk && healthOk) {
        reportText += `\n✅ 一切就绪！可以运行正式同步脚本了。\n`;
    }
    
    console.log(reportText);
    
    // 显示弹窗
    const alert = new Alert();
    alert.title = "🔍 连通性测试";
    alert.message = reportText;
    alert.addAction("复制报告");
    alert.addCancelAction("关闭");
    
    const choice = await alert.present();
    
    if (choice === 0) {
        // 复制到剪贴板
        Pasteboard.copy(reportText);
        const notif = new Notification();
        notif.title = "✅ 报告已复制";
        notif.body = "可粘贴到聊天中分享";
        notif.schedule();
    }
}

await main();
Script.complete();
