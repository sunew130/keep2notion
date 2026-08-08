#!/usr/bin/python
# -*- coding: UTF-8 -*-
import json
import os
from dotenv import load_dotenv
import pendulum
from keep2notion.notion_helper import NotionHelper
import requests
from keep2notion import utils
from keep2notion.config import workout_properties_type_dict

LOGIN_API = "https://api.gotokeep.com/v1.1/users/login"
DATA_API = "https://api.gotokeep.com/pd/v3/stats/detail?dateUnit=all&type=all&lastDate={last_date}"
LOG_API = "https://api.gotokeep.com/pd/v3/{type}log/{id}"
WEIGHT = "https://api.gotokeep.com/feynman/v3/data-center/sub/body-data/detail?indicatorType=WEIGHT&pageSize=10"
SLEEP_DETAIL = "https://api.gotokeep.com/feynman/v3/data-center/sub/sleep/detail?dateUnit={unit}&date={date}"
SLEEP_OVERVIEW = "https://api.gotokeep.com/feynman/v3/data-center/sub/sleep/overview?date={date}"
HR_DETAIL = "https://api.gotokeep.com/feynman/v3/data-center/sub/body-data/detail?indicatorType={indicator}&pageSize=100"

keep_headers = {
    "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0",
    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
}
load_dotenv()


def get_equipment():
    categories = ["shoe","intelligent_wear","sport_facilities","bicycle"]
    results = []
    for category in categories:
        response = requests.get(
            f"https://api.gotokeep.com/equipment-webapp/enableBind/my/all/list?firstCategory={category}", headers=keep_headers)
        if response.ok:
            data = response.json().get("data")
            if data:
                itemList = data.get("itemList")
                if itemList:
                    results.extend(itemList)
        else:
            print("请求失败:", response.text)
    return results


def login():
    countryCode = os.getenv("COUNTRY_CODE","86")
    mobile = os.getenv("KEEP_MOBILE")
    password = os.getenv("KEEP_PASSWORD")
    data = {"mobile": mobile, "password": password,"countryCode":countryCode}
    r = requests.post(LOGIN_API, headers=keep_headers, data=data)
    if r.ok:
        print("登录成功")
        token = r.json()["data"]["token"]
        return token
    else:
        print(r.text)
        return None


def get_enable_bind_equipment(logId,equipment_dict):
    url = f"https://api.gotokeep.com/equipment-webapp/equipmentType/first/category/enableBind/listAll?logId={logId}"
    response = requests.get(url, headers=keep_headers)
    if response.ok:
        data = response.json().get("data", [])
        results = []
        for item in data:
            first_category = item.get("type")
            category_response = requests.get(
                f"https://api.gotokeep.com/equipment-webapp/enableBind/my/all/list?logId={logId}&firstCategory={first_category}",
                headers=keep_headers
            )
            if category_response.ok:
                items = category_response.json().get("data", {}).get("itemList", [])
                # 过滤掉bindStatus为false的item，并且只返回itemId
                filtered_items = [equipment_dict[item.get("itemId")] for item in items if item.get("bindStatus") and item.get("itemId") in equipment_dict]
                results.extend(filtered_items)
            else:
                print(f"请求失败: {category_response.text}")
        with open("enable_bind_equipment.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=4)
        return results
    else:
        print("请求失败:", response.text)
        return None

def get_weight_data():
    results = []
    next_page_token = None
    while True:
        url = WEIGHT
        if next_page_token:
            url += f"&nextPageToken={next_page_token}"
        response = requests.get(url, headers=keep_headers)
        if response.ok:
            data = response.json().get("data", {})
            results.extend(data.get("list", []))
            if not data.get("hasNextPage"):
                break
            next_page_token = data.get("nextPageToken")
        else:
            print("获取数据失败:", response.text)
            break
    return results




def insert_weight_data_to_notion(weight_data):
    # 获取 Notion 数据库中的所有数据
    existing_ids = set()
    notion_weights = notion_helper.query_all(
        database_id=notion_helper.weight_database_id)
    for item in notion_weights:
        if item.get("properties").get("id"):
            existing_ids.add(item.get("properties").get(
                "id").get("rich_text")[0].get("plain_text"))

    # 遍历数据并插入到 Notion
    for entry in weight_data:
        entry_id = entry.get("id")
        if entry_id in existing_ids:
            continue  # 跳过已存在的数据
        # 准备 Notion 数据库属性
        properties = {
            "id": {"rich_text": [{"text": {"content": entry_id}}]},
            "时间": {"date": {"start": pendulum.from_timestamp(entry["time"]["sampleEndTime"] / 1000, tz='Asia/Shanghai').to_iso8601_string()}},
            "重量": {"number": entry["value"]},
            "来源": {"title": [{"text": {"content": entry["source"]["displayName"]}}]},
            "单位": {"rich_text": [{"text": {"content": entry["indicatorUnit"]}}]},
        }
        icon_url = entry["source"].get("iconUrl")
        if icon_url:
            icon = utils.get_icon(icon_url)
            # 插入数据到 Notion
            notion_helper.client.pages.create(
                parent={"database_id": notion_helper.weight_database_id},
                properties=properties,
                cover=icon, icon=icon
            )
        else:
            notion_helper.client.pages.create(
                parent={"database_id": notion_helper.weight_database_id},
                properties=properties
            )

equipment_dict = {
    "intelligent_wear":"智能穿戴",
    "shoe":"运动鞋",
    "intelligent_hardware":"运动器械",
    "bicycle":"自行车",
}

def insert_equipment_to_notion(equipments, database_id):
    # 获取 Notion 数据库中的所有数据
    existing_ids = dict()
    notion_shoes = notion_helper.query_all(
        database_id=database_id)
    for item in notion_shoes:
        if item.get("properties").get("id"):
            page_id = item.get("id")
            rich_text = item.get("properties").get("id").get("rich_text")
            if rich_text:
                id = rich_text[0].get("plain_text")
                existing_ids[id] = page_id
    # 遍历数据并插入到 Notion
    for entry in equipments:
        entry_id = entry.get("itemId")
        if entry_id in existing_ids:
            continue  # 跳过已存在的数据
        # 准备 Notion 数据库属性
        properties = {
            "id": {"rich_text": [{"text": {"content": entry_id}}]},
            "Name": {"title": [{"text": {"content": entry["name"]}}]},
            "类型": {"select": {"name":equipment_dict.get(entry["equipmentType"])}},
            "描述": {"rich_text": [{"text": {"content": entry["desc"]}}]},
            "关联记录": {"rich_text": [{"text": {"content": entry["bindDesc"]}}]},
        }
        icon_url = entry["image"]
        if icon_url:
            icon = utils.get_icon(icon_url)
            # 插入数据到 Notion
            result = notion_helper.client.pages.create(
                parent={"database_id": database_id},
                properties=properties,
                cover=icon, icon=icon
            )
        else:
            result = notion_helper.client.pages.create(
                parent={"database_id": database_id},
                properties=properties
            )
        if result:
            existing_ids[result.get("id")] = entry_id
    return existing_ids


def get_run_id():
    last_date = 0
    results = []
    while 1:
        r = requests.get(DATA_API.format(
            last_date=last_date), headers=keep_headers)
        if r.ok:
            last_date = r.json()["data"]["lastTimestamp"]
            records = r.json().get("data").get("records")
            for record in records:
                for log in record.get("logs"):
                    if log.get("type") == "stats":
                        results.append(log.get("stats"))
        print(f"last date = {last_date}")
        if not last_date:
            break
    return results


def get_lastest():
    s = set()
    notion_workouts = notion_helper.query_all(
        database_id=notion_helper.workout_database_id
    )
    for i in notion_workouts:
        if i.get("properties").get("Id"):
            rich_text = i.get("properties").get("Id").get("rich_text")
            if rich_text:
                s.add(rich_text[0].get("plain_text"))
    return s


def get_run_data(log,equipment_dict):
    r = requests.get(
        LOG_API.format(type=log.get("type"), id=log.get("id")), headers=keep_headers
    )
    if r.ok:
        data = r.json().get("data")
        workout = {}
        end_time = pendulum.from_timestamp(
            data.get("endTime") / 1000, tz="Asia/Shanghai"
        )
        workout["标题"] = log.get("name")
        workout["Id"] = data.get("id")
        workout["开始时间"] = data.get("startTime") / 1000
        workout["结束时间"] = data.get("endTime") / 1000
        workout["距离"] = round(data.get("distance", 0))
        workout["运动时长"] = data.get("duration")
        workout["平均配速"] = data.get("averagePace")
        workout["消耗热量"] = data.get("calorie")
        workout["运动类型"] = [
            notion_helper.get_relation_id(
                log.get("name"), id=notion_helper.type_database_id, icon=log.get("icon"))
        ]
        type_name = None
        if (log.get("type") == "running"):
            type_name = "跑步"
        elif (log.get("type") == "hiking"):
            type_name = "步行"
        elif (log.get("type") == "cycling"):
            type_name = "骑行"
        if type_name:
            workout["运动类型"].append(notion_helper.get_relation_id(
                type_name, id=notion_helper.type_database_id, icon=log.get("icon")))
        heartRate = data.get("heartRate")
        if heartRate:
            workout["平均心率"] = heartRate.get("averageHeartRate")
            workout["最大心率"] = heartRate.get("maxHeartRate")
        end_time = pendulum.from_timestamp(
            data.get("endTime") / 1000, tz="Asia/Shanghai"
        )
        cover = data.get("shareImg")
        if cover is None:
            cover = log.get("trackWaterMark")
        equipment = get_enable_bind_equipment(log.get("id"),equipment_dict)
        if equipment:
            workout["我的装备"] = equipment
        add_to_notion(workout, end_time, log.get("icon"), cover)


def add_to_notion(workout, end_time, icon, cover):
    properties = utils.get_properties(workout, workout_properties_type_dict)
    notion_helper.get_date_relation(properties, end_time)
    parent = {
        "database_id": notion_helper.workout_database_id,
        "type": "database_id",
    }
    icon = utils.get_icon(icon) if icon else {"type":"emoji","emoji": "🏃"}
    # 封面长图有限制
    if cover and len(cover) <= 2000:
        pass
    else:
        if cover:
            cover = utils.upload_cover(cover)
        else:
            cover = "https://images.unsplash.com/photo-1547483238-f400e65ccd56?q=80&w=2970&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
    notion_helper.create_page(
        parent=parent, properties=properties, cover=utils.get_icon(cover), icon=icon
    )
notion_helper = NotionHelper()

# ── 睡眠数据同步 ──

def get_sleep_data():
    """从 Keep API 拉取最近 7 天的睡眠数据"""
    import datetime
    results = []
    today = datetime.date.today()
    for i in range(7):
        date = (today - datetime.timedelta(days=i)).strftime("%Y-%m-%d")
        url = SLEEP_DETAIL.format(unit="day", date=date)
        try:
            response = requests.get(url, headers=keep_headers, timeout=15)
            if response.ok:
                data = response.json().get("data", {})
                card_list = data.get("cardList", [])
                if card_list:
                    for card in card_list:
                        card_type = card.get("type", "")
                        card_data = card.get("data", {})
                        # 提取睡眠记录
                        record = card_data.get("sleepRecord") or card_data.get("record") or card_data
                        if record and isinstance(record, dict):
                            record["_date"] = date
                            results.append(record)
                            print(f"  睡眠 {date}: 找到记录")
                else:
                    # 也尝试 overview 接口
                    pass
            else:
                print(f"  睡眠 {date}: HTTP {response.status_code}")
        except Exception as e:
            print(f"  睡眠 {date}: 异常 {e}")
    return results


def insert_sleep_data_to_notion(sleep_data):
    """将睡眠数据写入 Notion 睡眠数据库"""
    if not notion_helper.sleep_database_id:
        print("  睡眠数据库未找到，跳过")
        return

    existing_ids = set()
    notion_sleeps = notion_helper.query_all(
        database_id=notion_helper.sleep_database_id)
    for item in notion_sleeps:
        props = item.get("properties", {})
        if props.get("id"):
            rt = props.get("id").get("rich_text")
            if rt:
                existing_ids.add(rt[0].get("plain_text"))

    count = 0
    for entry in sleep_data:
        entry_id = entry.get("id") or entry.get("_date", "")
        if entry_id in existing_ids:
            continue

        # 解析时间戳 (Keep 返回毫秒时间戳)
        start_ts = entry.get("sleepStartTime") or entry.get("startTime") or entry.get("bedTime")
        end_ts = entry.get("sleepEndTime") or entry.get("endTime") or entry.get("wakeTime")

        properties = {}
        date_str = entry.get("_date", "")

        if start_ts and isinstance(start_ts, (int, float)) and start_ts > 1000000000:
            start_dt = pendulum.from_timestamp(start_ts / 1000, tz="Asia/Shanghai")
            properties["入睡时间"] = {"date": {"start": start_dt.to_iso8601_string()}}
            if not date_str:
                date_str = start_dt.format("YYYY-MM-DD")

        if end_ts and isinstance(end_ts, (int, float)) and end_ts > 1000000000:
            end_dt = pendulum.from_timestamp(end_ts / 1000, tz="Asia/Shanghai")
            properties["起床时间"] = {"date": {"start": end_dt.to_iso8601_string()}}

        if date_str:
            properties["日期"] = {"date": {"start": date_str}}

        # 时长（分钟）
        duration = entry.get("sleepDuration") or entry.get("duration") or entry.get("totalDuration")
        if duration:
            if duration > 100000:  # 毫秒
                duration = duration / 60000
            properties["时长(分钟)"] = {"number": round(duration)}

        # 深睡
        deep = entry.get("deepSleepDuration") or entry.get("deepDuration")
        if deep:
            if deep > 100000:
                deep = deep / 60000
            properties["深睡(分钟)"] = {"number": round(deep)}

        # 浅睡
        light = entry.get("lightSleepDuration") or entry.get("shallowDuration") or entry.get("lightDuration")
        if light:
            if light > 100000:
                light = light / 60000
            properties["浅睡(分钟)"] = {"number": round(light)}

        # REM
        rem = entry.get("remDuration") or entry.get("remSleepDuration")
        if rem:
            if rem > 100000:
                rem = rem / 60000
            properties["REM(分钟)"] = {"number": round(rem)}

        # 清醒
        awake = entry.get("awakeDuration") or entry.get("wakeDuration")
        if awake:
            if awake > 100000:
                awake = awake / 60000
            properties["清醒(分钟)"] = {"number": round(awake)}

        # 评分
        score = entry.get("score") or entry.get("sleepScore")
        if score:
            properties["评分"] = {"number": score}

        # 来源
        source = entry.get("source", "")
        if isinstance(source, dict):
            source = source.get("displayName", "Keep")
        properties["来源"] = {"rich_text": [{"text": {"content": source or "Keep"}}]}
        properties["id"] = {"rich_text": [{"text": {"content": str(entry_id)}}]}
        properties["标题"] = {"title": [{"text": {"content": f"睡眠 {date_str}"}}]}

        try:
            notion_helper.client.pages.create(
                parent={"database_id": notion_helper.sleep_database_id},
                properties=properties,
            )
            count += 1
        except Exception as e:
            print(f"  睡眠写入失败 {date_str}: {e}")

    print(f"  睡眠: 新增 {count} 条")


# ── 心率数据同步 ──

def get_heart_rate_data():
    """从 Keep API 拉取静息心率和最大心率"""
    results = []
    for indicator, hr_type in [("RESTING_HEART_RATE", "静息心率"), ("MAX_HEART_RATE", "最大心率")]:
        url = HR_DETAIL.format(indicator=indicator)
        next_page_token = None
        while True:
            full_url = url
            if next_page_token:
                full_url += f"&nextPageToken={next_page_token}"
            try:
                response = requests.get(full_url, headers=keep_headers, timeout=15)
                if response.ok:
                    data = response.json().get("data", {})
                    items = data.get("list", [])
                    for item in items:
                        item["_hrType"] = hr_type
                        results.append(item)
                    if not data.get("hasNextPage"):
                        break
                    next_page_token = data.get("nextPageToken")
                else:
                    print(f"  心率 {indicator}: HTTP {response.status_code}")
                    break
            except Exception as e:
                print(f"  心率 {indicator}: 异常 {e}")
                break
    return results


def insert_hr_data_to_notion(hr_data):
    """将心率数据写入 Notion 心率数据库"""
    if not notion_helper.heartrate_database_id:
        print("  心率数据库未找到，跳过")
        return

    existing_ids = set()
    notion_hrs = notion_helper.query_all(
        database_id=notion_helper.heartrate_database_id)
    for item in notion_hrs:
        props = item.get("properties", {})
        if props.get("id"):
            rt = props.get("id").get("rich_text")
            if rt:
                existing_ids.add(rt[0].get("plain_text"))

    count = 0
    for entry in hr_data:
        entry_id = entry.get("id", "")
        if entry_id in existing_ids:
            continue

        properties = {}
        hr_type = entry.get("_hrType", "")

        # 时间
        time_info = entry.get("time", {})
        sample_end = time_info.get("sampleEndTime") or time_info.get("endTime")
        if sample_end and sample_end > 1000000000:
            dt = pendulum.from_timestamp(sample_end / 1000, tz="Asia/Shanghai")
            date_str = dt.format("YYYY-MM-DD")
            properties["日期"] = {"date": {"start": date_str}}
            properties["时间戳"] = {"date": {"start": dt.to_iso8601_string()}}
        else:
            continue

        # 心率值
        value = entry.get("value", 0)
        if value:
            properties["心率"] = {"number": value}

        # 类型
        if hr_type:
            properties["类型"] = {"select": {"name": hr_type}}

        properties["来源"] = {"rich_text": [{"text": {"content": "Keep"}}]}
        properties["id"] = {"rich_text": [{"text": {"content": str(entry_id)}}]}
        properties["标题"] = {"title": [{"text": {"content": f"{hr_type} {date_str}"}}]}

        try:
            notion_helper.client.pages.create(
                parent={"database_id": notion_helper.heartrate_database_id},
                properties=properties,
            )
            count += 1
        except Exception as e:
            print(f"  心率写入失败 {date_str}: {e}")

    print(f"  心率: 新增 {count} 条")


def main():
    s = get_lastest()
    token = login()
    keep_headers["Authorization"] = f"Bearer {token}"
    weight_data = get_weight_data()
    if weight_data:
        insert_weight_data_to_notion(weight_data)
    equipments = get_equipment()
    equipment_dict= {}
    if equipments:
        equipment_dict = insert_equipment_to_notion(equipments,notion_helper.equipment_database_id)
    logs = get_run_id()
    if logs:
        # 按照结束时间倒序排序
        logs = sorted(logs, key=lambda x: x["endTime"])
        for log in logs:
            id = log.get("id")
            if id in s:
                continue
            # 去掉重复数据
            if log.get("isDoubtful"):
                continue
            get_run_data(log,equipment_dict)
    # 同步睡眠数据
    print("=== 同步睡眠数据 ===")
    sleep_data = get_sleep_data()
    if sleep_data:
        insert_sleep_data_to_notion(sleep_data)
    else:
        print("  未获取到睡眠数据")
    # 同步心率数据
    print("=== 同步心率数据 ===")
    hr_data = get_heart_rate_data()
    if hr_data:
        insert_hr_data_to_notion(hr_data)
    else:
        print("  未获取到心率数据")

if __name__ == "__main__":
    main()
