/**
 * Apple HealthKit 全量数据 → Notion 同步
 * 
 * 覆盖 Apple HealthKit 所有主要数据类型，一个不漏。
 * 每天凌晨 4:00 由 iOS 自动化触发，完全无感。
 * 
 * 同步链路：iPhone HealthKit → Notion → (Go 后端按需拉取)
 * 
 * 使用方法：
 * 1. iPhone 安装 Scriptable App（免费）
 * 2. 复制此脚本，修改 CONFIG.NOTION_TOKEN
 * 3. iOS「快捷指令」→ 自动化 → 每天 4:00 → 运行脚本
 */

// ══════════════════════════════════════════════════════���════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
    NOTION_TOKEN: "YOUR_NOTION_TOKEN_HERE",
    
    // Notion 数据库 ID（8 个数据库，覆盖全部 HealthKit 数据）
    DB: {
        体重:   "1dc632bf-6647-813d-a191-d6247ac17710",
        睡眠:   "3b6632bf-6647-81e0-85a5-ed6af9fbd144",
        心率:   "3b6632bf-6647-81bc-8c5c-cf286b831194",
        每日活动: "3b6632bf-6647-8192-a8d4-e3fe7c39750e",
        每日营养: "3b6632bf-6647-81a1-ae1b-c3dce9411a09",
        身体成分: "3b6632bf-6647-81f7-889a-cb9936683b90",
        环境监测: "3b6632bf-6647-8133-b7ae-df1cb03e1c35",
        心理健康: "3b6632bf-6647-81d4-806b-e33c5485b2d1",
    },
    
    LOOKBACK_DAYS: 1,  // 回看天数（1=昨天的数据）
};

// ═════════════════��═════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function fmtDate(d) { return d.toISOString().split('T')[0]; }
function dayStart(date) { let d = new Date(date); d.setHours(0,0,0,0); return d; }
function dayEnd(date)   { let d = new Date(date); d.setHours(23,59,59,999); return d; }
function round(v, p) { p = p || 1; return Math.round(v * p) / p; }

let stats = { ok: 0, skip: 0, err: 0 };
function logOk(msg)   { console.log(msg); stats.ok++; }
function logSkip(msg) { console.log(msg); stats.skip++; }
function logErr(msg)  { console.log(msg); stats.err++; }

async function notionCreatePage(dbKey, props) {
    const dbId = CONFIG.DB[dbKey];
    if (!dbId) { logErr(`  ❌ 数据库未配置: ${dbKey}`); return false; }
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
    } catch (e) {
        logErr(`  ❌ Notion API 错误: ${e}`);
        return false;
    }
}

// HealthKit 查询
async function hkLatest(type, unit, start, end) {
    try {
        const r = await HealthKit.queryQuantitySamples({
            quantityType: type, unit: unit, startDate: start, endDate: end, limit: 1,
            sortDescriptors: [{ key: "startDate", ascending: false }],
        });
        return r.length > 0 ? r[0] : null;
    } catch (e) { return null; }
}

async function hkSum(type, unit, start, end) {
    try {
        const samples = await HealthKit.queryQuantitySamples({
            quantityType: type, unit: unit, startDate: start, endDate: end, limit: 10000,
        });
        let sum = 0;
        for (const s of samples) sum += s.quantity;
        return sum;
    } catch (e) { return 0; }
}

async function hkCategories(type, start, end) {
    try {
        return await HealthKit.queryCategorySamples({
            categoryType: type, startDate: start, endDate: end, limit: 10000,
        });
    } catch (e) { return []; }
}

// ═══════════════════════════════════════════════════════════════
// 1. ⚖️ 体重 → 体重表
// ═══════════════════════════════════════════════════════════════
async function syncWeight(date) {
    const ds = fmtDate(date);
    const s = await hkLatest("bodyMass", "kg", dayStart(date), dayEnd(date));
    if (!s) { logSkip(`⚖️ 体重 ${ds}: 无数据`); return; }
    const w = round(s.quantity, 10);
    if (await notionCreatePage("体重", {
        "来源": { title: [{ text: { content: "Apple Health" }}]},
        "重量": { number: w },
        "时间": { date: { start: ds }},
        "id":   { rich_text: [{ text: { content: `apple_weight_${ds}` }}]},
        "单位": { rich_text: [{ text: { content: "kg" }}]},
    })) logOk(`⚖️ 体重 ${ds}: ${w}kg ✓`);
}

// ═══════════════════════════════════════════════════════════════
// 2. 📊 身体成分 → 身体成分表（体脂率/去脂体重/腰围/BMI）
// ═══════════════════════════════════════════════════════════════
async function syncBodyComposition(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    const bodyFat   = await hkLatest("bodyFatPercentage", "%", s, e);
    const leanMass  = await hkLatest("leanBodyMass", "kg", s, e);
    const waist     = await hkLatest("waistCircumference", "cm", s, e);
    const bmiVal    = await hkLatest("bodyMassIndex", "count", s, e);
    
    if (!bodyFat && !leanMass && !waist && !bmiVal) {
        logSkip(`📊 身体成分 ${ds}: 无数据`); return;
    }
    
    const props = {
        "标题": { title: [{ text: { content: `身体成分 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":   { rich_text: [{ text: { content: `apple_body_${ds}` }}]},
    };
    if (bodyFat)  props["体脂率(%)"]   = { number: round(bodyFat.quantity, 10) };
    if (leanMass) props["去脂体重(kg)"] = { number: round(leanMass.quantity, 10) };
    if (waist)    props["腰围(cm)"]     = { number: round(waist.quantity, 10) };
    if (bmiVal)   props["BMI"]          = { number: round(bmiVal.quantity, 100) };
    
    if (await notionCreatePage("身体成分", props)) {
        let parts = [];
        if (bodyFat)  parts.push(`体脂${round(bodyFat.quantity,10)}%`);
        if (leanMass) parts.push(`去脂${round(leanMass.quantity,10)}kg`);
        if (waist)    parts.push(`腰围${round(waist.quantity)}cm`);
        if (bmiVal)   parts.push(`BMI${round(bmiVal.quantity,100)}`);
        logOk(`📊 身体成分 ${ds}: ${parts.join(" ")} ✓`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 3. 😴 睡眠 → 睡眠表（深睡/浅睡/REM/清醒/总时长/入睡/起床）
// ═══════════════════════════════════════════════════════════════
async function syncSleep(date) {
    const ds = fmtDate(date);
    // 睡眠数据跨度：当天中午 ~ 次日中午
    const start = new Date(date); start.setHours(12,0,0,0);
    const end   = new Date(date); end.setDate(end.getDate()+1); end.setHours(12,0,0,0);
    
    const samples = await hkCategories("sleepAnalysis", start, end);
    if (!samples || samples.length === 0) { logSkip(`😴 睡眠 ${ds}: 无数据`); return; }
    
    let deepMs=0, lightMs=0, remMs=0, awakeMs=0, totalAsleepMs=0;
    let earliestBed=null, latestWake=null;
    
    for (const s of samples) {
        const dur = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
        const st = new Date(s.startDate), et = new Date(s.endDate);
        switch (s.value) {
            case 1: totalAsleepMs += dur; break;
            case 2: awakeMs += dur; break;
            case 3: lightMs += dur; totalAsleepMs += dur; break;
            case 4: deepMs += dur; totalAsleepMs += dur; break;
            case 5: remMs += dur; totalAsleepMs += dur; break;
        }
        if (!earliestBed || st < earliestBed) earliestBed = st;
        if (!latestWake || et > latestWake) latestWake = et;
    }
    
    if (totalAsleepMs === 0) { logSkip(`😴 睡眠 ${ds}: 无 Asleep 数据`); return; }
    
    const totalMin = round(totalAsleepMs / 60000);
    const props = {
        "标题":      { title: [{ text: { content: `睡眠 ${ds}` }}]},
        "日期":      { date: { start: ds }},
        "时长(分钟)":  { number: totalMin },
        "深睡(分钟)":  { number: round(deepMs / 60000) },
        "浅睡(分钟)":  { number: round(lightMs / 60000) },
        "REM(分钟)":   { number: round(remMs / 60000) },
        "清醒(分钟)":  { number: round(awakeMs / 60000) },
        "来源":      { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":        { rich_text: [{ text: { content: `apple_sleep_${ds}` }}]},
    };
    if (earliestBed) props["入睡时间"] = { date: { start: earliestBed.toISOString() }};
    if (latestWake)  props["起床时间"] = { date: { start: latestWake.toISOString() }};
    
    if (await notionCreatePage("睡眠", props))
        logOk(`😴 睡眠 ${ds}: ${totalMin}min (深${round(deepMs/60000)} 浅${round(lightMs/60000)} REM${round(remMs/60000)} 醒${round(awakeMs/60000)}) ✓`);
}

// ═══════════════════════════════════════════════════════════════
// 4. ❤️ 心率系列 → 心率表（静息/步行平均/最大/HRV/血氧/呼吸）
// ═══════════════════════════════════════════════════════════════
async function syncHeartRates(date) {
    const ds = fmtDate(date);
    const ds_iso = ds + "T08:00:00+08:00";
    const s = dayStart(date), e = dayEnd(date);
    
    const metrics = [
        ["restingHeartRate",          "静息心率",   "apple_rhr_",  "count/min", "❤️"],
        ["walkingHeartRateAverage",   "步行心率",   "apple_whr_",  "count/min", "🚶"],
        ["heartRateVariabilitySDNN",  "心率变异性", "apple_hrv_",  "ms",        "🫀"],
        ["oxygenSaturation",          "血氧",       "apple_spo2_", "%",         "🩸"],
        ["respiratoryRate",           "呼吸频率",   "apple_resp_", "count/min", "🫁"],
    ];
    
    for (const [hkType, label, idPrefix, unit, emoji] of metrics) {
        const sample = await hkLatest(hkType, unit, s, e);
        if (!sample) { logSkip(`${emoji} ${label} ${ds}: 无数据`); continue; }
        
        const val = round(sample.quantity, 100);
        const ts = sample.startDate ? new Date(sample.startDate).toISOString() : ds_iso;
        
        if (await notionCreatePage("心率", {
            "标题": { title: [{ text: { content: `${label} ${ds}` }}]},
            "日期": { date: { start: ds }},
            "时间戳": { date: { start: ts }},
            "心率": { number: val },
            "类型": { select: { name: label }},
            "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
            "id":   { rich_text: [{ text: { content: `${idPrefix}${ds}` }}]},
        })) logOk(`${emoji} ${label} ${ds}: ${val}${unit === "ms" ? "ms" : unit === "%" ? "%" : "bpm"} ✓`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 5. 🏃 每日活动 → 每日活动表（步数/距离/楼层/能量/运动/站立）
// ═══════════════════════════════════════════════════════════════
async function syncActivity(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    const steps       = await hkSum("stepCount", "count", s, e);
    const distWalkRun = await hkSum("distanceWalkingRunning", "km", s, e);
    const distCycle   = await hkSum("distanceCycling", "km", s, e);
    const distSwim    = await hkSum("distanceSwimming", "km", s, e);
    const floors      = await hkSum("flightsClimbed", "count", s, e);
    const activeCal   = await hkSum("activeEnergyBurned", "kcal", s, e);
    const exerciseMin = await hkSum("appleExerciseTime", "min", s, e);
    const standMin    = await hkSum("appleStandTime", "min", s, e);
    
    if (steps === 0 && activeCal === 0 && exerciseMin === 0) {
        logSkip(`🏃 每日活动 ${ds}: 无数据`); return;
    }
    
    const props = {
        "标题":           { title: [{ text: { content: `活动 ${ds}` }}]},
        "日期":           { date: { start: ds }},
        "步数":           { number: Math.round(steps) },
        "来源":           { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":             { rich_text: [{ text: { content: `apple_activity_${ds}` }}]},
    };
    if (distWalkRun > 0) props["步行跑步距离(km)"] = { number: round(distWalkRun, 100) };
    if (distCycle > 0)   props["骑行距离(km)"]     = { number: round(distCycle, 100) };
    if (distSwim > 0)    props["游泳距离(km)"]     = { number: round(distSwim, 100) };
    if (floors > 0)      props["爬楼层"]           = { number: Math.round(floors) };
    if (activeCal > 0)   props["活动能量(kcal)"]   = { number: Math.round(activeCal) };
    if (exerciseMin > 0) props["运动时长(分钟)"]   = { number: Math.round(exerciseMin) };
    if (standMin > 0)    props["站立时长(分钟)"]   = { number: Math.round(standMin) };
    
    if (await notionCreatePage("每日活动", props)) {
        logOk(`🏃 活动 ${ds}: ${Math.round(steps)}步 ${round(distWalkRun,100)}km ${Math.round(activeCal)}kcal ${Math.round(exerciseMin)}min ✓`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 6. 🍽️ 每日营养 → 每日营养表
// ═══════════════════════════════════════════════════════════════
async function syncNutrition(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    const energy  = await hkSum("dietaryEnergyConsumed", "kcal", s, e);
    const protein = await hkSum("protein", "g", s, e);
    const carbs   = await hkSum("carbohydrates", "g", s, e);
    const fat     = await hkSum("fatTotal", "g", s, e);
    const fiber   = await hkSum("fiber", "g", s, e);
    const water   = await hkSum("water", "L", s, e);
    const caffeine= await hkSum("caffeine", "mg", s, e);
    const alcohol = await hkSum("alcoholConsumption", "g", s, e);
    
    if (energy === 0 && water === 0) { logSkip(`🍽️ 每日营养 ${ds}: 无数据`); return; }
    
    const props = {
        "标题":           { title: [{ text: { content: `营养 ${ds}` }}]},
        "日期":           { date: { start: ds }},
        "来源":           { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":             { rich_text: [{ text: { content: `apple_nutrition_${ds}` }}]},
    };
    if (energy > 0)    props["能量摄入(kcal)"]   = { number: Math.round(energy) };
    if (protein > 0)   props["蛋白质(g)"]        = { number: round(protein, 10) };
    if (carbs > 0)     props["碳水化合物(g)"]    = { number: round(carbs, 10) };
    if (fat > 0)       props["脂肪(g)"]          = { number: round(fat, 10) };
    if (fiber > 0)     props["纤维(g)"]          = { number: round(fiber, 10) };
    if (water > 0)     props["水(L)"]            = { number: round(water, 100) };
    if (caffeine > 0)  props["咖啡因(mg)"]       = { number: Math.round(caffeine) };
    if (alcohol > 0)   props["酒精(g)"]          = { number: round(alcohol, 10) };
    
    if (await notionCreatePage("每日营养", props)) {
        logOk(`🍽️ 营养 ${ds}: ${Math.round(energy)}kcal 蛋白${round(protein)}g 碳水${round(carbs)}g 水${round(water,2)}L ✓`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 7. 🔊 环境监测 → 环境监测表
// ═══════════════════════════════════════════════════════════════
async function syncEnvironment(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    // 环境声音平均值
    const envSamples = await hkSum("environmentalSoundExposure", "dB", s, e);
    const envMax     = await hkLatest("environmentalSoundExposure", "dB", s, e);
    const hpVol      = await hkLatest("headphoneAudioExposure", "dB", s, e);
    
    if (!envMax && !hpVol) { logSkip(`🔊 环境监测 ${ds}: 无数据`); return; }
    
    const props = {
        "标题":     { title: [{ text: { content: `环境 ${ds}` }}]},
        "日期":     { date: { start: ds }},
        "来源":     { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":       { rich_text: [{ text: { content: `apple_env_${ds}` }}]},
    };
    if (envMax)  props["环境声音(dB)"]     = { number: round(envMax.quantity) };
    if (hpVol)   props["耳机音量(dB)"]     = { number: round(hpVol.quantity) };
    
    if (await notionCreatePage("环境监测", props)) {
        logOk(`🔊 环境 ${ds}: 环境${envMax ? round(envMax.quantity)+"dB" : "—"} 耳机${hpVol ? round(hpVol.quantity)+"dB" : "—"} ✓`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 8. 🧠 心理健康 → 心理健康表（正念/心情等）
// ═══════════════════════════════════════════════════════════════
async function syncMentalHealth(date) {
    const ds = fmtDate(date);
    const s = dayStart(date), e = dayEnd(date);
    
    // 正念分钟
    const mindfulMin = await hkSum("mindfulSession", "min", s, e);
    
    // 心理状态（如果记录了的话）
    const moodVals = await hkLatest("appleMindfulSessionTime", "min", s, e);
    
    if (mindfulMin === 0 && !moodVals) { logSkip(`🧠 心理健康 ${ds}: 无数据`); return; }
    
    const props = {
        "标题": { title: [{ text: { content: `心理健康 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "类型": { select: { name: "正念" }},
        "数值": { number: Math.round(mindfulMin) },
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":   { rich_text: [{ text: { content: `apple_mental_${ds}` }}]},
    };
    
    if (await notionCreatePage("心理健康", props))
        logOk(`🧠 心理健康 ${ds}: 正念${Math.round(mindfulMin)}min ✓`);
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log("══════════════════════════════════════");
    console.log("🍎 Apple HealthKit 全量 → Notion 同步");
    console.log(`📅 ${new Date().toLocaleString()}`);
    console.log("══════════════════════════════════════");
    
    if (CONFIG.NOTION_TOKEN === "YOUR_NOTION_TOKEN_HERE") {
        console.log("❌ 请先设置 NOTION_TOKEN!");
        Script.complete();
        return;
    }
    
    for (let i = 1; i <= CONFIG.LOOKBACK_DAYS; i++) {
        let d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const ds = fmtDate(d);
        console.log(`\n────── ${ds} ──────`);
        
        await safe(syncWeight,          d, "体重");
        await safe(syncBodyComposition, d, "身体成分");
        await safe(syncSleep,           d, "睡眠");
        await safe(syncHeartRates,      d, "心率系列");
        await safe(syncActivity,        d, "每日活动");
        await safe(syncNutrition,       d, "每日营养");
        await safe(syncEnvironment,     d, "环境监测");
        await safe(syncMentalHealth,    d, "心理健康");
    }
    
    console.log(`\n══════════════════════════════════════`);
    console.log(`✅ 完成! 成功 ${stats.ok} | 跳过 ${stats.skip} | 错误 ${stats.err}`);
    console.log(`══════════════════════════════════════`);
    
    const notif = new Notification();
    notif.title = "🍎 Health → Notion 全量同步完成";
    notif.body = `✅${stats.ok} ⏭️${stats.skip} ❌${stats.err}`;
    notif.schedule();
}

async function safe(fn, date, label) {
    try { await fn(date); }
    catch (e) { logErr(`❌ ${label} 异常: ${e}`); }
}

await main();
Script.complete();
