// ═══════════════════════════════════════════════════════════════
// HealthKit 权限诊断脚本
// 运行此脚本会触发 iOS 权限弹窗，逐项测试每个数据类型
// ═══════════════════════════════════════════════════════════════

console.log("════════════════════════════════════");
console.log("🔍 HealthKit 权限诊断");
console.log("════��═══════════════════════════════\n");

// Step 1: 检查 HealthKit 是否可用
console.log("Step 1: 检查 HealthKit 是否可用");
try {
    if (typeof HealthKit === 'undefined') {
        console.log("❌ HealthKit 模块不存在��Scriptable 可能版本太旧。");
        console.log("   请更新 Scriptable 到最新版本。");
        Script.complete();
    }
    console.log("✅ HealthKit 模块已加载\n");
} catch(e) {
    console.log("❌ HealthKit 加载失败: " + e + "\n");
}

// Step 2: 请求权限 — 这一步会触发 iOS 弹窗！
console.log("Step 2: 请求 HealthKit 读取权限...");
console.log("(如果弹出权限弹窗，请点击「允许」)\n");

try {
    // 请求所有数据类型的读取权限
    // Scriptable 的 HealthKit.requestRead 会触发系统弹窗
    await HealthKit.requestRead([
        "bodyMass",
        "bodyMassIndex",
        "bodyFatPercentage",
        "leanBodyMass",
        "height",
        "waistCircumference",
        "restingHeartRate",
        "walkingHeartRateAverage",
        "heartRateVariabilitySDNN",
        "heartRate",
        "oxygenSaturation",
        "respiratoryRate",
        "stepCount",
        "distanceWalkingRunning",
        "distanceCycling",
        "distanceSwimming",
        "flightsClimbed",
        "activeEnergyBurned",
        "basalEnergyBurned",
        "appleExerciseTime",
        "appleStandTime",
        "dietaryEnergyConsumed",
        "protein",
        "carbohydrates",
        "fatTotal",
        "fiber",
        "water",
        "caffeine",
        "alcoholConsumption",
        "environmentalSoundExposure",
        "headphoneAudioExposure",
        "sleepAnalysis",
    ]);
    console.log("✅ 权限请求完成\n");
} catch(e) {
    console.log("⚠️ 权限请求: " + e + "\n");
    console.log("这可能是因为：");
    console.log("  1. 首次运行时弹窗已经出现过了，但你点了「不允许」");
    console.log("  2. 需要去 iPhone 设置 → 隐私与安全性 → 健康 → Scriptable → 打开\n");
}

// Step 3: 逐项测试（扩大时间范围到 30 天）
console.log("Step 3: 逐项测试数据（最近 30 天）\n");

const end = new Date();
const start = new Date();
start.setDate(start.getDate() - 30);

const types = [
    ["stepCount",              "步数",        "count",     "👟"],
    ["activeEnergyBurned",     "活动能量",    "kcal",      "🔥"],
    ["appleExerciseTime",      "运动时长",    "min",       "⏱️"],
    ["distanceWalkingRunning", "步行跑步",    "km",        "🚶"],
    ["flightsClimbed",         "爬楼层",      "count",     "🏢"],
    ["restingHeartRate",       "静息心率",    "count/min", "❤️"],
    ["heartRate",              "心率",        "count/min", "❤️"],
    ["walkingHeartRateAverage","步行心率",    "count/min", "🚶"],
    ["heartRateVariabilitySDNN","HRV",       "ms",        "🫀"],
    ["oxygenSaturation",       "血氧",        "%",         "🩸"],
    ["respiratoryRate",        "呼吸频率",    "count/min", "🫁"],
    ["bodyMass",               "体重",        "kg",        "⚖️"],
    ["bodyFatPercentage",      "体脂率",      "%",         "📊"],
    ["height",                 "身高",        "cm",        "📏"],
    ["appleStandTime",         "站立时长",    "min",       "🧍"],
    ["dietaryEnergyConsumed",  "饮食热量",    "kcal",      "🍽️"],
    ["water",                  "饮水",        "L",         "💧"],
    ["environmentalSoundExposure","环境声音","dB",        "🔊"],
    ["headphoneAudioExposure", "耳机音量",    "dB",        "🎧"],
];

let found = 0;
let denied = 0;

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
            const d = new Date(samples[0].startDate);
            console.log(`${icon} ${label}: ✅ ${Math.round(val*100)/100} ${unit} (${d.toLocaleDateString()})`);
            found++;
        } else {
            console.log(`${icon} ${label}: ⬜ 30天内无数据`);
        }
    } catch(e) {
        console.log(`${icon} ${label}: 🚫 无权限或错误`);
        denied++;
    }
}

// 睡眠（Category 类型）
try {
    const sleepSamples = await HealthKit.queryCategorySamples({
        categoryType: "sleepAnalysis",
        startDate: start,
        endDate: end,
        limit: 1,
    });
    if (sleepSamples && sleepSamples.length > 0) {
        const d = new Date(sleepSamples[0].startDate);
        console.log(`😴 睡眠: ✅ 有数据 (${d.toLocaleDateString()})`);
        found++;
    } else {
        console.log(`😴 睡眠: ⬜ 30天内无数据`);
    }
} catch(e) {
    console.log(`😴 睡眠: 🚫 无权限或错误`);
    denied++;
}

// 汇总
console.log(`\n════════════════════════════════════`);
console.log(`📊 汇总: ✅ 有数据 ${found} | ⬜ 空数据 | 🚫 无权限 ${denied}`);
console.log(`════════════════════════════════════`);

if (found === 0 && denied > 0) {
    console.log(`
🚨 所有数据都无权限！

解决方法（必须按顺序操作）：

1. 打开 iPhone「设置」App
2. 滑到最下面找到「Scriptable」
3. 点击「健康」
4. 打开所有开关（步数、心率等全部打开）
5. 如果找不到 Scriptable，先运行一次正式同步脚本触发弹窗

如果上面不行，试这个：
1. iPhone「设置」→「隐私与安全性」→「健康」
2. 找到「Scriptable」
3. 确保所有数据类型都已开启
`);
} else if (found === 0) {
    console.log(`
⚠️ 30 天内没有任何健康数据。

可能原因：
1. Apple Watch 没有佩戴/���有同步
2. iPhone「健康」App 里确实没有数据
3. 需要先在「健康」App 中查看是否有数据

请打开 iPhone 自带的「健康」App → 浏览 → 确认有数据
`);
} else {
    console.log(`
✅ HealthKit 数据正常！
找到 ${found} 种数据。
可以运行正式同步脚本了。
`);
}

// 弹窗显示
const alert = new Alert();
alert.title = "HealthKit 诊断完成";
alert.message = `找到 ${found} 种数据，${denied} 项无权限。\n\n详见控制台输出。`;
alert.addAction("确定");
await alert.present();

Script.complete();
