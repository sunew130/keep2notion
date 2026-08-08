/**
 * Apple HealthKit 全量数据导出脚本（备选方案）
 * 
 * 此脚本一次性导出全部历史数据到 Notion。
 * 适用于初次设置时回填历史数据。
 * 
 * 使用方法：
 * 1. 设置 LOOKBACK_DAYS 为要回填的天数（例如 365 = 过去一年）
 * 2. 在 Scriptable 中运行
 * 3. 注意：大量数据上传可能需要几分钟，Notion API 有速率限制
 * 
 * HealthKit 全部支持的数据类型（按分类）：
 * 
 * 【身体测量】bodyMass, bodyMassIndex, bodyFatPercentage, leanBodyMass,
 *   height, waistCircumference, wristTemperature
 * 
 * 【健身数据】activeEnergyBurned, basalEnergyBurned, appleExerciseTime,
 *   appleStandTime, stepCount, distanceWalkingRunning, distanceCycling,
 *   distanceSwimming, distanceDownhillSnowSports, flightsClimbed,
 *   nikeFuel, pushCount, swimmingStrokeCount, vo2Max, heartRate
 * 
 * 【营养数据】dietaryEnergyConsumed, dietaryFatTotal, dietaryFatSaturated,
 *   dietaryFatMonounsaturated, dietaryFatPolyunsaturated, dietaryCarbohydrates,
 *   dietaryFiber, dietarySugar, dietaryProtein, dietaryCholesterol,
 *   dietaryVitaminA, dietaryVitaminB6, dietaryVitaminB12, dietaryVitaminC,
 *   dietaryVitaminD, dietaryVitaminE, dietaryVitaminK, dietaryCalcium,
 *   dietaryIron, dietaryThiamin, dietaryRiboflavin, dietaryNiacin,
 *   dietaryFolate, dietaryBiotin, dietaryPantothenicAcid, dietaryPhosphorus,
 *   dietaryIodine, dietaryMagnesium, dietaryZinc, dietarySelenium,
 *   dietaryCopper, dietaryManganese, dietaryChromium, dietaryMolybdenum,
 *   dietaryChloride, dietaryPotassium, dietarySodium, dietaryWater,
 *   dietaryCaffeine, dietaryChloride
 * 
 * 【心率血氧】restingHeartRate, walkingHeartRateAverage, heartRateVariabilitySDNN,
 *   oxygenSaturation, respiratoryRate, peripheralPerfusionIndex
 * 
 * 【睡眠数据】sleepAnalysis (category: InBed/Asleep/AsleepCore/AsleepDeep/AsleepREM/Awake)
 * 
 * 【生殖健康】cervicalMucusQuality, menstrualFlow, ovulationTestResult,
 *   sexualActivity, basalBodyTemperature, intermenstrualBleeding
 * 
 * 【其他健康】appleSleepingWristTemperature, environmentalSoundExposure,
 *   environmentalSoundReduction, headphoneAudioExposure, numberOfTimesFallen,
 *   numberOfAlcoholicBeverages, bloodAlcoholContent, inhalerUsage, insulinDelivery,
 *   bloodGlucose, bloodPressureSystolic, bloodPressureDiastolic, electrocardiogramType,
 *   lowCardioFitnessEvent, appleWalkingSteadiness, sixMinuteWalkTestDistance,
 *   underwaterDepth, waterTemperature, uvExposure, appleMoveTime, atrialFibrillationBurden
 * 
 * 【心理健康】mindfulSession, mindfulSessionTime, stateOfMind
 * 
 * 【症状记录】appleSymptoms (generalBodyAche, appetiteChanges, chestTightness,
 *   congestion, constipation, coughing, diarrhea, dizziness, drySkin, fainting,
 *   fatigue, fever, headache, heartburn, nausea, nightSweats, painOrAche, rapidPounding,
 *   runnyNose, shortnessOfBreath, skippedMeals, sleepChanges, soreThroat, vomiting, wheezing)
 * 
 * 【移动能力】appleWalkingSteadiness, sixMinuteWalkTestDistance, numberOfTimesFallen
 */
