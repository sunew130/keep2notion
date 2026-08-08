/**
 * Apple Health → Notion 全量自动同步
 * 
 * 覆盖 Apple HealthKit 全部主要数据类型：
 * 
 *   📊 身体指标：体重、身高、BMI、体脂率、静息心率、最大心率、步行心率、血氧
 *   😴 睡眠：总时长、入睡/起床时间、深睡、浅睡、REM、清醒
 *   ❤️ 心率：静息、最大、步行平均 + HRV（心率变异性）
 *   🏃 运动：步数、步行距离、跑步距离、骑行距离、游泳距离、楼层、活动能量、运动时长
 *   🧘 健康：呼吸频率、环境声音、耳机音量、站立时间
 *   🍽️ 营养：能量摄入、蛋白质、碳水化合物、脂肪、纤维、水、咖啡因、酒精
 * 
 * 使用方法：
 * 1. iPhone 安装 Scriptable App（免费）
 * 2. 复制此脚本，修改 CONFIG 中的 NOTION_TOKEN
 * 3. iOS「快捷指令」→ 自动化 → 每天凌晨 4:00 → 运行此脚本
 * 
 * 同步链路：iPhone HealthKit → Notion → Go 后端 → PostgreSQL
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
    NOTION_TOKEN: "YOUR_NOTION_TOKEN_HERE",  // 替换为你的 Notion Integration Token
    
    // Notion 数据库 ID
    DB_WEIGHT:    "1dc632bf-6647-813d-a191-d6247ac17710",  // 体重
    DB_SLEEP:     "3b6632bf-6647-81e0-85a5-ed6af9fbd144",  // 睡眠
    DB_HR:        "3b6632bf-6647-81bc-8c5c-cf286b831194",  // 心率

    // 回看天数（1 = 昨天的数据）
    LOOKBACK_DAYS: 1,
};

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function fmtDate(d) { return d.toISOString().split('T')[0]; }
function yesterday() { let d = new Date(); d.setDate(d.getDate()-1); d.setHours(0,0,0,0); return d; }
function todayStart() { let d = new Date(); d.setHours(0,0,0,0); return d; }
function dayStart(date) { let d = new Date(date); d.setHours(0,0,0,0); return d; }
function dayEnd(date) { let d = new Date(date); d.setHours(23,59,59,999); return d; }
function round(v, p) { p = p||1; return Math.round(v*p)/p; }

let stats = { ok: 0, skip: 0, err: 0 };
function logOk(msg) { console.log(msg); stats.ok++; }
function logSkip(msg) { console.log(msg); stats.skip++; }
function logErr(msg) { console.log(msg); stats.err++; }

async function notionCreatePage(dbId, props) {
    const req = new Request("https://api.notion.com/v1/pages");
    req.method = "POST";
    req.headers = {
        "Authorization": `Bearer ${CONFIG.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    };
    req.body = JSON.stringify({ parent: { database_id: dbId }, properties: props });
    try {
        await req.loadJSON();
        return true;
    } catch(e) {
        logErr(`  ❌ Notion API: ${e}`);
        return false;
    }
}

// HealthKit 查询
async function hkQuantity(type, unit, start, end) {
    try {
        return await HealthKit.queryQuantitySamples({
            quantityType: type, unit: unit, startDate: start, endDate: end, limit: 10000,
        });
    } catch(e) { return []; }
}

async function hkLatest(type, unit, start, end) {
    try {
        const r = await HealthKit.queryQuantitySamples({
            quantityType: type, unit: unit, startDate: start, endDate: end, limit: 1,
            sortDescriptors: [{ key: "startDate", ascending: false }],
        });
        return r.length > 0 ? r[0] : null;
    } catch(e) { return null; }
}

async function hkSum(type, unit, start, end) {
    const samples = await hkQuantity(type, unit, start, end);
    let sum = 0;
    for (const s of samples) sum += s.quantity;
    return sum;
}

async function hkCategories(type, start, end) {
    try {
        return await HealthKit.queryCategorySamples({
            categoryType: type, startDate: start, endDate: end, limit: 10000,
        });
    } catch(e) { return []; }
}

// ═══════════════════════════════════════════════════════════════
// 1. 体重
// ═══════════════════════════════════════════════════════════════
async function syncWeight(date) {
    const ds = fmtDate(date);
    const s = await hkLatest("bodyMass", "kg", dayStart(date), dayEnd(date));
    if (!s) { logSkip(`⚖️ 体重 ${ds}: 无数据`); return; }
    const w = round(s.quantity, 10);
    if (await notionCreatePage(CONFIG.DB_WEIGHT, {
        "来源": { title: [{ text: { content: "Apple Health" }}]},
        "重量": { number: w },
        "时间": { date: { start: ds }},
        "id": { rich_text: [{ text: { content: `apple_weight_${ds}` }}]},
        "单位": { rich_text: [{ text: { content: "kg" }}]},
    })) logOk(`⚖️ 体重 ${ds}: ${w}kg ✓`);
}

// ══════���════════════════════════════════════════════════════════
// 2. 睡眠（含深睡/浅睡/REM/清醒分段）
// ═══════════════════════════════════════════════════════════════
async function syncSleep(date) {
    const ds = fmtDate(date);
    // 睡眠数据可能在 "昨天 12 点 ~ 今天 12 点" 的范围
    const start = new Date(date); start.setHours(12,0,0,0);
    const end = new Date(date); end.setDate(end.getDate()+1); end.setHours(12,0,0,0);
    
    const samples = await hkCategories("sleepAnalysis", start, end);
    if (!samples || samples.length === 0) { logSkip(`😴 睡眠 ${ds}: 无数据`); return; }
    
    let deepMs=0, lightMs=0, remMs=0, awakeMs=0, inBedMs=0, totalAsleepMs=0;
    let earliestBed=null, latestWake=null;
    
    for (const s of samples) {
        const dur = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
        const st = new Date(s.startDate), et = new Date(s.endDate);
        
        // HKSleepAnalysis value mapping:
        // 0=InBed, 1=Asleep(Unified/Old), 2=Awake, 3=AsleepCore(Light), 
        // 4=AsleepDeep, 5=AsleepREM, 6=OutOfBed
        switch(s.value) {
            case 0: inBedMs += dur; break;
            case 1: totalAsleepMs += dur; break;  // unified asleep
            case 2: awakeMs += dur; break;
            case 3: lightMs += dur; totalAsleepMs += dur; break;
            case 4: deepMs += dur; totalAsleepMs += dur; break;
            case 5: remMs += dur; totalAsleepMs += dur; break;
        }
        if (!earliestBed || st < earliestBed) earliestBed = st;
        if (!latestWake || et > latestWake) latestWake = et;
    }
    
    if (totalAsleepMs === 0) { logSkip(`😴 睡眠 ${ds}: 无 Asleep 数据`); return; }
    
    const totalMin = round(totalAsleepMs/60000);
    const props = {
        "标题": { title: [{ text: { content: `睡�� ${ds}` }}]},
        "日期": { date: { start: ds }},
        "时长(分钟)": { number: totalMin },
        "深睡(分钟)": { number: round(deepMs/60000) },
        "浅睡(分钟)": { number: round(lightMs/60000) },
        "REM(分钟)": { number: round(remMs/60000) },
        "清醒(分钟)": { number: round(awakeMs/60000) },
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id": { rich_text: [{ text: { content: `apple_sleep_${ds}` }}]},
    };
    if (earliestBed) props["入睡时间"] = { date: { start: earliestBed.toISOString() }};
    if (latestWake) props["起床���间"] = { date: { start: latestWake.toISOString() }};
    
    if (await notionCreatePage(CONFIG.DB_SLEEP, props))
        logOk(`😴 睡眠 ${ds}: ${totalMin}min (深${round(deepMs/60000)} 浅${round(lightMs/60000)} REM${round(remMs/60000)}) ✓`);
}

// ═══════════════════════════════════════════════════════════════
// 3. 心率（静息 + 最大 + 步行平均 + HRV）
// ═══════════════════════════════════════════════════════════════
async function syncHeartRates(date) {
    const ds = fmtDate(date);
    const ds_iso = ds + "T00:00:00+08:00";
    
    const types = [
        ["restingHeartRate",   "静息心率", "apple_rhr_", "count/min"],
        ["walkingHeartRateAverage", "平均心率", "apple_whr_", "count/min"],
        ["heartRateVariabilitySDNN", "心率变异性", "apple_hrv_", "ms"],
    ];
    
    for (const [hkType, label, idPrefix, unit] of types) {
        const s = await hkLatest(hkType, unit, dayStart(date), dayEnd(date));
        if (!s) { logSkip(`❤️ ${label} ${ds}: 无数据`); continue; }
        
        const val = round(s.quantity, 100);
        const ts = s.startDate ? new Date(s.startDate).toISOString() : ds_iso;
        
        // HRV 写入心率表（类型设为 "心率变异性"）
        if (hkType === "heartRateVariabilitySDNN") {
            if (await notionCreatePage(CONFIG.DB_HR, {
                "标题": { title: [{ text: { content: `HRV ${ds}` }}]},
                "日期": { date: { start: ds }},
                "时间戳": { date: { start: ts }},
                "心率": { number: val },
                "类型": { select: { name: "心率变异性" }},
                "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
                "id": { rich_text: [{ text: { content: `${idPrefix}${ds}` }}]},
            })) logOk(`🫀 HRV ${ds}: ${val}ms ✓`);
        } else {
            if (await notionCreatePage(CONFIG.DB_HR, {
                "标题": { title: [{ text: { content: `${label} ${ds}` }}]},
                "日期": { date: { start: ds }},
                "时间戳": { date: { start: ts }},
                "心率": { number: val },
                "类型": { select: { name: label }},
                "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
                "id": { rich_text: [{ text: { content: `${idPrefix}${ds}` }}]},
            })) logOk(`❤️ ${label} ${ds}: ${val}bpm ✓`);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// 4. 血氧
// ═══════════════════════════════════════════════════════════════
async function syncBloodOxygen(date) {
    const ds = fmtDate(date);
    const s = await hkLatest("oxygenSaturation", "%", dayStart(date), dayEnd(date));
    if (!s) { logSkip(`🩸 血氧 ${ds}: 无数据`); return; }
    const val = round(s.quantity, 100);
    // 写入心率表，类型为 "血氧"
    if (await notionCreatePage(CONFIG.DB_HR, {
        "标题": { title: [{ text: { content: `血氧 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "时间戳": { date: { start: s.startDate ? new Date(s.startDate).toISOString() : ds + "T08:00:00+08:00" }},
        "心率": { number: val },
        "类型": { select: { name: "血氧" }},
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id": { rich_text: [{ text: { content: `apple_spo2_${ds}` }}]},
    })) logOk(`🩸 血氧 ${ds}: ${val}% ✓`);
}

// ═══════════════════════════════════════════════════════════════
// 5. 呼吸频率
// ═══════════════════════════════════════════════════════════════
async function syncRespiratoryRate(date) {
    const ds = fmtDate(date);
    const s = await hkLatest("respiratoryRate", "count/min", dayStart(date), dayEnd(date));
    if (!s) { logSkip(`🫁 呼吸频率 ${ds}: 无数据`); return; }
    const val = round(s.quantity);
    if (await notionCreatePage(CONFIG.DB_HR, {
        "标题": { title: [{ text: { content: `呼吸频率 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "时间戳": { date: { start: s.startDate ? new Date(s.startDate).toISOString() : ds + "T08:00:00+08:00" }},
        "心率": { number: val },
        "类型": { select: { name: "呼吸频率" }},
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id": { rich_text: [{ text: { content: `apple_resp_${ds}` }}]},
    })) logOk(`🫁 呼吸频率 ${ds}: ${val}次/分 ✓`);
}

// ═══════════════════════════════════════════════════════════════
// 6. 活动数据（步数/距离/楼层/能量/站立）
// ═══════════════════════════════════════════════════════════════
async function syncActivity(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    const steps = await hkSum("stepCount", "count", s, e);
    const distWalkRun = await hkSum("distanceWalkingRunning", "km", s, e);
    const distCycling = await hkSum("distanceCycling", "km", s, e);
    const distSwim = await hkSum("distanceSwimming", "km", s, e);
    const floors = await hkSum("flightsClimbed", "count", s, e);
    const activeEnergy = await hkSum("activeEnergyBurned", "kcal", s, e);
    const exerciseMin = await hkSum("appleExerciseTime", "min", s, e);
    const standHours = await hkSum("appleStandTime", "min", s, e);
    
    // 至少有步数才算有活动数据
    if (steps === 0 && activeEnergy === 0) { logSkip(`🏃 活动 ${ds}: 无数据`); return; }
    
    // 构建活动摘要文本（因为目前没有专门的活动 Notion 表，先用日志记录）
    let parts = [];
    if (steps > 0) parts.push(`👟${Math.round(steps)}步`);
    if (distWalkRun > 0) parts.push(`🚶${round(distWalkRun,2)}km`);
    if (distCycling > 0) parts.push(`🚴${round(distCycling,2)}km`);
    if (distSwim > 0) parts.push(`🏊${round(distSwim,2)}km`);
    if (floors > 0) parts.push(`🏢${Math.round(floors)}层`);
    if (activeEnergy > 0) parts.push(`🔥${Math.round(activeEnergy)}kcal`);
    if (exerciseMin > 0) parts.push(`⏱️${Math.round(exerciseMin)}min`);
    if (standHours > 0) parts.push(`🧍${Math.round(standHours)}min`);
    
    logOk(`🏃 活动 ${ds}: ${parts.join(" ")} ✓`);
    
    // TODO: 如果创建了活动 Notion 表，这里写入 Notion
}

// ═══════════════════════════════════════════════════════════════
// 7. 营养数据（能量摄入/蛋白质/碳水/脂肪/纤维/水/咖啡因）
// ═══════════════════════════════════════════════════════════════
async function syncNutrition(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    const energy = await hkSum("dietaryEnergyConsumed", "kcal", s, e);
    const protein = await hkSum("protein", "g", s, e);
    const carbs = await hkSum("carbohydrates", "g", s, e);
    const fat = await hkSum("fatTotal", "g", s, e);
    const fiber = await hkSum("fiber", "g", s, e);
    const water = await hkSum("water", "L", s, e);  // 升
    const caffeine = await hkSum("caffeine", "mg", s, e);
    const alcohol = await hkSum("alcoholConsumption", "g", s, e);
    
    if (energy === 0 && water === 0) { logSkip(`🍽️ 营养 ${ds}: 无数据`); return; }
    
    let parts = [];
    if (energy > 0) parts.push(`🔥${Math.round(energy)}kcal`);
    if (protein > 0) parts.push(`🥩${round(protein)}g`);
    if (carbs > 0) parts.push(`🍞${round(carbs)}g`);
    if (fat > 0) parts.push(`🧈${round(fat)}g`);
    if (fiber > 0) parts.push(`🥦${round(fiber)}g`);
    if (water > 0) parts.push(`💧${round(water,2)}L`);
    if (caffeine > 0) parts.push(`☕${Math.round(caffeine)}mg`);
    if (alcohol > 0) parts.push(`🍺${round(alcohol)}g`);
    
    logOk(`🍽️ 营养 ${ds}: ${parts.join(" ")} ✓`);
}

// ═══════════════════════════════════════════════════════════════
// 8. 环境数据（环境声音、耳机音量）
// ═══════════════════════════════════════════════════════════════
async function syncEnvironment(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    const envSound = await hkSum("environmentalSoundExposure", "dB", s, e);
    const headphoneVol = await hkSum("headphoneAudioExposure", "dB", s, e);
    
    if (envSound > 0 || headphoneVol > 0) {
        let parts = [];
        if (envSound > 0) parts.push(`🔊 环境${Math.round(envSound)}dB`);
        if (headphoneVol > 0) parts.push(`🎧 耳机${Math.round(headphoneVol)}dB`);
        logOk(`🔊 环境 ${ds}: ${parts.join(" ")} ✓`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 9. 体脂率/身高/BMI（写入体重表）
// ═══════════════════════════════════════════════════════════════
async function syncBodyComposition(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    // 体脂率
    const bodyFat = await hkLatest("bodyFatPercentage", "%", s, e);
    if (bodyFat && bodyFat.quantity > 0) {
        const val = round(bodyFat.quantity, 10);
        if (await notionCreatePage(CONFIG.DB_WEIGHT, {
            "来源": { title: [{ text: { content: "体脂率" }}]},
            "重量": { number: val },
            "时间": { date: { start: ds }},
            "id": { rich_text: [{ text: { content: `apple_bodyfat_${ds}` }}]},
            "单位": { rich_text: [{ text: { content: "%" }}]},
        })) logOk(`📊 体脂率 ${ds}: ${val}% ✓`);
    }
    
    // 去脂体重
    const leanMass = await hkLatest("leanBodyMass", "kg", s, e);
    if (leanMass && leanMass.quantity > 0) {
        const val = round(leanMass.quantity, 10);
        if (await notionCreatePage(CONFIG.DB_WEIGHT, {
            "来源": { title: [{ text: { content: "去脂体重" }}]},
            "重量": { number: val },
            "时间": { date: { start: ds }},
            "id": { rich_text: [{ text: { content: `apple_leanmass_${ds}` }}]},
            "单位": { rich_text: [{ text: { content: "kg" }}]},
        })) logOk(`💪 去脂体重 ${ds}: ${val}kg ✓`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log("═══════════════════════════════════");
    console.log("🍎 Apple Health → Notion 全量同步");
    console.log(`📅 ${new Date().toLocaleString()}`);
    console.log("═══════════════════════════════════");
    
    if (CONFIG.NOTION_TOKEN === "YOUR_NOTION_TOKEN_HERE") {
        console.log("❌ 请先在脚本顶部设置 NOTION_TOKEN!");
        Script.complete();
        return;
    }
    
    for (let i = 1; i <= CONFIG.LOOKBACK_DAYS; i++) {
        let d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const ds = fmtDate(d);
        console.log(`\n────── ${ds} ──────`);
        
        // 身体指标
        await safe(syncWeight, d, "体重");
        await safe(syncBodyComposition, d, "体脂");
        
        // 睡眠
        await safe(syncSleep, d, "睡眠");
        
        // 心率系列
        await safe(syncHeartRates, d, "心率");
        await safe(syncBloodOxygen, d, "血氧");
        await safe(syncRespiratoryRate, d, "呼吸");
        
        // 活动
        await safe(syncActivity, d, "活动");
        
        // 营养
        await safe(syncNutrition, d, "营养");
        
        // 环境
        await safe(syncEnvironment, d, "环境");
    }
    
    console.log(`\n═══════════════════════════════════`);
    console.log(`✅ 完成! 成功 ${stats.ok} | 跳过 ${stats.skip} | 错误 ${stats.err}`);
    console.log(`═══════════════════════════════════`);
    
    // 通知
    const notif = new Notification();
    notif.title = "✅ Health → Notion 同步完成";
    notif.body = `✅${stats.ok} ⏭️${stats.skip} ❌${stats.err}`;
    notif.schedule();
}

async function safe(fn, date, label) {
    try { await fn(date); }
    catch(e) { logErr(`❌ ${label} 异常: ${e}`); }
}

await main();
Script.complete();
