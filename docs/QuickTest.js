// 🧪 最简 HealthKit 权限测试
// 在 Scriptable 中新建脚本，粘贴此代码，点运行

try {
  // 请求步数读取权限
  const ok = await HealthKit.requestRead(["stepCount"])
  console.log("权限结果: " + ok)
  
  if (ok) {
    // 读今天的步数
    const steps = await HealthKit.dailyTotal("stepCount")
    console.log("✅ 今天步数: " + steps)
    
    // 读心率
    const hr = await HealthKit.latestQuantity("heartRate")
    if (hr) {
      console.log("✅ 最新心率: " + Math.round(hr) + " bpm")
    }
    
    // 读写过的健康数据类型
    const types = await HealthKit.availableTypes()
    console.log("✅ 可用数据类型: " + types.length + " 种")
    
    console.log("🎉 HealthKit 权限已获得！可以运行 AppleHealthToNotion.js 了")
  } else {
    console.log("❌ 权限被拒绝")
    console.log("👉 手动开启：设置 → 隐私与安全性 → 健康 → Scriptable → 打开")
  }
} catch (e) {
  console.log("❌ 错误: " + e.message)
  console.log("👉 可能是你的 iOS 版本不支持，或者 Scriptable 版本太旧")
}
