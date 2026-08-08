/**
 * Apple Health → Notion 全量同步
 * 
 * 适配 Actions App（by Sindre Sorhus）
 * Actions App: https://apps.apple.com/app/actions/id1586435171
 * 
 * 使用方法：
 * 1. App Store 安装 "Actions" App（免费）
 * 2. 打开 Actions → + 新建 Action → Run Script
 * 3. 粘贴此脚本
 * 4. 修改下面的 NOTION_TOKEN
 * 5. 在 Actions 中设置自动化：每天 4:00 触发
 */

const NOTION_TOKEN = "YOUR_NOTION_TOKEN_HERE";

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

// ════════ 工具函数 ════════

function fmtDate(d) { return d.toISOString().split("T")[0]; }
function round(v, p) { p = p || 1; return Math.round(v * p) / p; }

function dayStart(date) { let d = new Date(date); d.setHours(0,0,0,0); return d; }
function dayEnd(date)   { let d = new Date(date); d.setHours(23,59,59,999); return d; }

async function notionCreate(dbKey, props) {
    const dbId = DB[dbKey];
    if (!dbId) return false;
    const resp = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
    });
    return resp.ok;
}

// HealthKit 查询 — 适配 Actions App
async function hkLatest(type, unit, start, end) {
    try {
        const r = await Health.latestQuantity(type, unit, { startDate: start, endDate: end });
        return r;
    } catch (e) { return null; }
}

async function hkSum(type, unit, start, end) {
    try {
        const samples = await Health.quantities(type, unit, { startDate: start, endDate: end, limit: 10000 });
        let sum = 0;
        for (const s of samples) sum += s.quantity;
        return sum;
    } catch (e) { return 0; }
}

async function hkCategories(type, start, end) {
    try {
        return await Health.categories(type, { startDate: start, endDate: end, limit: 10000 });
    } catch (e) { return []; }
}

let stats = { ok: 0, skip: 0 };

// ════════ 同步函数 ════════

async function syncWeight(d) {
    const ds = fmtDate(d);
    const s = await hkLatest("bodyMass", "kg", dayStart(d), dayEnd(d));
    if (!s) { console.log(`⚖️ 体重: 无数据`); return; }
    if (await notionCreate("体重", {
        "来源": { title: [{ text: { content: "Apple Health" }}]},
        "重量": { number: round(s.quantity, 10) },
        "时间": { date: { start: ds }},
        "id":   { rich_text: [{ text: { content: `apple_weight_${ds}` }}]},
        "单位": { rich_text: [{ text: { content: "kg" }}]},
    })) { console.log(`⚖️ 体重: ${round(s.quantity,10)}kg ✓`); stats.ok++; }
}

async function syncBody(d) {
    const ds = fmtDate(d);
    const bf = await hkLatest("bodyFatPercentage", "%", dayStart(d), dayEnd(d));
    const lm = await hkLatest("leanBodyMass", "kg", dayStart(d), dayEnd(d));
    if (!bf && !lm) { console.log(`📊 身体成分: 无数据`); return; }
    const p = {
        "标题": { title: [{ text: { content: `身体成分 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":   { rich_text: [{ text: { content: `apple_body_${ds}` }}]},
    };
    if (bf) p["体脂率(%)"] = { number: round(bf.quantity, 10) };
    if (lm) p["去脂体重(kg)"] = { number: round(lm.quantity, 10) };
    if (await notionCreate("身体成分", p)) { console.log(`📊 身体成分 ✓`); stats.ok++; }
}

async function syncSleep(d) {
    const ds = fmtDate(d);
    const start = new Date(d); start.setHours(12,0,0,0);
    const end = new Date(d); end.setDate(end.getDate()+1); end.setHours(12,0,0,0);
    const samples = await hkCategories("sleepAnalysis", start, end);
    if (!samples || samples.length === 0) { console.log(`😴 睡眠: 无数据`); return; }
    
    let deep=0, light=0, rem=0, awake=0, total=0, bed=null, wake=null;
    for (const s of samples) {
        const dur = new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
        const st = new Date(s.startDate), et = new Date(s.endDate);
        switch (s.value) {
            case 1: total += dur; break;
            case 2: awake += dur; break;
            case 3: light += dur; total += dur; break;
            case 4: deep += dur; total += dur; break;
            case 5: rem += dur; total += dur; break;
        }
        if (!bed || st < bed) bed = st;
        if (!wake || et > wake) wake = et;
    }
    if (total === 0) { console.log(`😴 睡眠: 无 Asleep 数据`); return; }
    
    const p = {
        "标题": { title: [{ text: { content: `睡眠 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "时长(分钟)": { number: round(total/60000) },
        "深睡(分钟)": { number: round(deep/60000) },
        "浅睡(分钟)": { number: round(light/60000) },
        "REM(分钟)":  { number: round(rem/60000) },
        "清醒(分钟)": { number: round(awake/60000) },
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":   { rich_text: [{ text: { content: `apple_sleep_${ds}` }}]},
    };
    if (bed)  p["入睡时间"] = { date: { start: bed.toISOString() }};
    if (wake) p["起床时间"] = { date: { start: wake.toISOString() }};
    if (await notionCreate("睡眠", p)) { console.log(`😴 睡眠: ${round(total/60000)}min ✓`); stats.ok++; }
}

async function syncHR(d) {
    const ds = fmtDate(d);
    const items = [
        ["restingHeartRate", "静息心率", "apple_rhr_", "count/min"],
        ["walkingHeartRateAverage", "步行心率", "apple_whr_", "count/min"],
        ["heartRateVariabilitySDNN", "心率变异性", "apple_hrv_", "ms"],
        ["oxygenSaturation", "血氧", "apple_spo2_", "%"],
        ["respiratoryRate", "呼吸频率", "apple_resp_", "count/min"],
    ];
    for (const [type, label, prefix, unit] of items) {
        const s = await hkLatest(type, unit, dayStart(d), dayEnd(d));
        if (!s) { console.log(`❤️ ${label}: 无数据`); continue; }
        const ts = s.startDate ? new Date(s.startDate).toISOString() : ds + "T08:00:00+08:00";
        if (await notionCreate("心率", {
            "标题": { title: [{ text: { content: `${label} ${ds}` }}]},
            "日期": { date: { start: ds }},
            "时间戳": { date: { start: ts }},
            "心率": { number: round(s.quantity, 100) },
            "类型": { select: { name: label }},
            "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
            "id":   { rich_text: [{ text: { content: `${prefix}${ds}` }}]},
        })) { console.log(`❤️ ${label}: ${round(s.quantity,100)} ✓`); stats.ok++; }
    }
}

async function syncActivity(d) {
    const ds = fmtDate(d);
    const s = dayStart(d), e = dayEnd(d);
    const steps   = await hkSum("stepCount", "count", s, e);
    const dist    = await hkSum("distanceWalkingRunning", "km", s, e);
    const floors  = await hkSum("flightsClimbed", "count", s, e);
    const cal     = await hkSum("activeEnergyBurned", "kcal", s, e);
    const exMin   = await hkSum("appleExerciseTime", "min", s, e);
    const stand   = await hkSum("appleStandTime", "min", s, e);
    const cycle   = await hkSum("distanceCycling", "km", s, e);
    const swim    = await hkSum("distanceSwimming", "km", s, e);
    
    if (steps === 0 && cal === 0) { console.log(`🏃 活动: 无数据`); return; }
    
    const p = {
        "标题": { title: [{ text: { content: `活动 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "步数": { number: Math.round(steps) },
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":   { rich_text: [{ text: { content: `apple_activity_${ds}` }}]},
    };
    if (dist > 0)   p["步行跑步距离(km)"] = { number: round(dist, 100) };
    if (cycle > 0)  p["骑行距离(km)"] = { number: round(cycle, 100) };
    if (swim > 0)   p["游泳距离(km)"] = { number: round(swim, 100) };
    if (floors > 0) p["爬楼层"] = { number: Math.round(floors) };
    if (cal > 0)    p["活动能量(kcal)"] = { number: Math.round(cal) };
    if (exMin > 0)  p["运动时长(分钟)"] = { number: Math.round(exMin) };
    if (stand > 0)  p["站立时长(分钟)"] = { number: Math.round(stand) };
    
    if (await notionCreate("每日活动", p)) { console.log(`🏃 活动: ${Math.round(steps)}步 ✓`); stats.ok++; }
}

async function syncNutrition(d) {
    const ds = fmtDate(d);
    const s = dayStart(d), e = dayEnd(d);
    const energy  = await hkSum("dietaryEnergyConsumed", "kcal", s, e);
    const protein = await hkSum("protein", "g", s, e);
    const carbs   = await hkSum("carbohydrates", "g", s, e);
    const fat     = await hkSum("fatTotal", "g", s, e);
    const fiber   = await hkSum("fiber", "g", s, e);
    const water   = await hkSum("water", "L", s, e);
    const caffeine= await hkSum("caffeine", "mg", s, e);
    const alcohol = await hkSum("alcoholConsumption", "g", s, e);
    
    if (energy === 0 && water === 0) { console.log(`🍽️ 营养: 无数据`); return; }
    
    const p = {
        "标题": { title: [{ text: { content: `营养 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":   { rich_text: [{ text: { content: `apple_nutrition_${ds}` }}]},
    };
    if (energy > 0)    p["能量摄入(kcal)"] = { number: Math.round(energy) };
    if (protein > 0)   p["蛋白质(g)"] = { number: round(protein, 10) };
    if (carbs > 0)     p["碳水化合物(g)"] = { number: round(carbs, 10) };
    if (fat > 0)       p["脂肪(g)"] = { number: round(fat, 10) };
    if (fiber > 0)     p["纤维(g)"] = { number: round(fiber, 10) };
    if (water > 0)     p["水(L)"] = { number: round(water, 100) };
    if (caffeine > 0)  p["咖啡因(mg)"] = { number: Math.round(caffeine) };
    if (alcohol > 0)   p["酒精(g)"] = { number: round(alcohol, 10) };
    
    if (await notionCreate("每日营养", p)) { console.log(`🍽️ 营养: ${Math.round(energy)}kcal ✓`); stats.ok++; }
}

async function syncEnvironment(d) {
    const ds = fmtDate(d);
    const s = dayStart(d), e = dayEnd(d);
    const envMax = await hkLatest("environmentalSoundExposure", "dB", s, e);
    const hpVol  = await hkLatest("headphoneAudioExposure", "dB", s, e);
    if (!envMax && !hpVol) { console.log(`🔊 环境: 无数据`); return; }
    
    const p = {
        "标题": { title: [{ text: { content: `环境 ${ds}` }}]},
        "日期": { date: { start: ds }},
        "来源": { rich_text: [{ text: { content: "Apple Health" }}]},
        "id":   { rich_text: [{ text: { content: `apple_env_${ds}` }}]},
    };
    if (envMax) p["环境声音(dB)"] = { number: round(envMax.quantity) };
    if (hpVol)  p["耳机音量(dB)"] = { number: round(hpVol.quantity) };
    if (await notionCreate("环境监测", p)) { console.log(`🔊 环境 ✓`); stats.ok++; }
}

// ════════ 主函数 ════════

async function main() {
    console.log("═══════════════════════");
    console.log("🍎 Health → Notion 同步");
    console.log(`📅 ${new Date().toLocaleString()}`);
    console.log("═══════════════════════");
    
    if (NOTION_TOKEN === "YOUR_NOTION_TOKEN_HERE") {
        console.log("❌ 请先设置 NOTION_TOKEN!");
        return;
    }
    
    // 同步昨天的数据
    let d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    const ds = fmtDate(d);
    console.log(`\n--- ${ds} ---`);
    
    try { await syncWeight(d); } catch(e) { console.log(`体重异常: ${e}`); }
    try { await syncBody(d); } catch(e) { console.log(`身体异常: ${e}`); }
    try { await syncSleep(d); } catch(e) { console.log(`睡眠异常: ${e}`); }
    try { await syncHR(d); } catch(e) { console.log(`心率异常: ${e}`); }
    try { await syncActivity(d); } catch(e) { console.log(`活动异常: ${e}`); }
    try { await syncNutrition(d); } catch(e) { console.log(`营养异常: ${e}`); }
    try { await syncEnvironment(d); } catch(e) { console.log(`环境异常: ${e}`); }
    
    console.log(`\n═══════════════════════`);
    console.log(`✅ 完成! 成功 ${stats.ok} 项`);
    console.log(`═══════════════════════`);
}

main();
