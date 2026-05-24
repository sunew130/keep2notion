#!/usr/bin/env python3
"""Explore Keep API to find all available data endpoints"""
import requests
import json
import os
import sys

mobile = os.getenv("KEEP_MOBILE")
password = os.getenv("KEEP_PASSWORD")
country_code = os.getenv("COUNTRY_CODE", "86")

headers = {
    "User-Agent": "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:78.0) Gecko/20100101 Firefox/78.0",
    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
}

# Login
print("=" * 60)
print("1. LOGIN")
print("=" * 60)
r = requests.post(
    "https://api.gotokeep.com/v1.1/users/login",
    headers=headers,
    data={"mobile": mobile, "password": password, "countryCode": country_code}
)
login_data = r.json()
print(json.dumps(login_data, indent=2, ensure_ascii=False)[:500])
token = login_data["data"]["token"]
headers["Authorization"] = f"Bearer {token}"

# Explore stats/detail - see all log types
print("\n" + "=" * 60)
print("2. STATS/DETAIL - type=all")
print("=" * 60)
r = requests.get(
    "https://api.gotokeep.com/pd/v3/stats/detail?dateUnit=all&type=all&lastDate=0",
    headers=headers
)
stats = r.json()

# Collect all unique log types
log_types = set()
if stats.get("data", {}).get("records"):
    for record in stats["data"]["records"]:
        for log in record.get("logs", []):
            log_type = log.get("type", "unknown")
            log_types.add(log_type)
            if log_type != "stats":
                print(f"  Type: {log_type:15s} | Name: {log.get('name',''):20s} | ID: {log.get('id','')}")

print(f"\nAll log types found: {sorted(log_types)}")

# Try body data - ALL indicator types
print("\n" + "=" * 60)
print("3. BODY DATA - all indicators")
print("=" * 60)
indicators = ["WEIGHT", "HEIGHT", "BODY_FAT", "BMI", "WAIST", "HIP", "MUSCLE", "BMR", "BODY_AGE", "VISCERAL_FAT", "BONE_MUSCLE_MASS", "PROTEIN_RATE", "BODY_SHAPE"]
for indicator in indicators:
    r = requests.get(
        f"https://api.gotokeep.com/feynman/v3/data-center/sub/body-data/detail?indicatorType={indicator}&pageSize=5",
        headers=headers
    )
    if r.ok:
        data = r.json()
        items = data.get("data", {}).get("items", data.get("data", []))
        count = len(items) if isinstance(items, list) else 1
        if count > 0:
            print(f"  ✅ {indicator:20s}: {count} records")
            # Show sample
            if isinstance(items, list) and items:
                sample = items[0]
                print(f"     Sample: {json.dumps(sample, ensure_ascii=False)[:200]}")
        else:
            print(f"  ⬜ {indicator:20s}: 0 records")
    else:
        print(f"  ❌ {indicator:20s}: HTTP {r.status_code}")

# Try sleep data
print("\n" + "=" * 60)
print("4. SLEEP DATA")
print("=" * 60)
sleep_endpoints = [
    "https://api.gotokeep.com/pd/v3/stats/detail?dateUnit=all&type=sleep&lastDate=0",
    "https://api.gotokeep.com/pd/v3/sleeplog?pageSize=10",
    "https://api.gotokeep.com/feynman/v3/data-center/sub/sleep/detail?pageSize=10",
    "https://api.gotokeep.com/sleep/v1/sleep?pageSize=10",
    "https://api.gotokeep.com/v1/sleep/list?pageSize=10",
    "https://api.gotokeep.com/pd/v3/sleeplog/list?pageSize=10",
]
for url in sleep_endpoints:
    r = requests.get(url, headers=headers, timeout=10)
    print(f"  {r.status_code} {url}")
    if r.ok:
        try:
            print(f"     {json.dumps(r.json(), ensure_ascii=False)[:300]}")
        except:
            print(f"     {r.text[:200]}")

# Try diet/food data
print("\n" + "=" * 60)
print("5. DIET/FOOD DATA")
print("=" * 60)
diet_endpoints = [
    "https://api.gotokeep.com/pd/v3/dietlog?pageSize=10",
    "https://api.gotokeep.com/pd/v3/foodlog?pageSize=10",
    "https://api.gotokeep.com/feynman/v3/data-center/sub/diet/detail?pageSize=10",
    "https://api.gotokeep.com/v2.1/diary?dateUnit=all&type=diet&lastDate=0",
    "https://api.gotokeep.com/pd/v3/stats/detail?dateUnit=all&type=diet&lastDate=0",
    "https://api.gotokeep.com/pd/v3/stats/detail?dateUnit=all&type=food&lastDate=0",
]
for url in diet_endpoints:
    r = requests.get(url, headers=headers, timeout=10)
    print(f"  {r.status_code} {url}")
    if r.ok:
        try:
            print(f"     {json.dumps(r.json(), ensure_ascii=False)[:300]}")
        except:
            print(f"     {r.text[:200]}")

# Try other data endpoints
print("\n" + "=" * 60)
print("6. OTHER DATA ENDPOINTS")
print("=" * 60)
other_endpoints = [
    "https://api.gotokeep.com/feynman/v3/data-center/sub?all=true",
    "https://api.gotokeep.com/feynman/v3/data-center/home",
    "https://api.gotokeep.com/v1/user/profile",
    "https://api.gotokeep.com/v2.1/user/stats",
    "https://api.gotokeep.com/pd/v3/stats/summary",
    "https://api.gotokeep.com/pd/v3/traininglog?pageSize=10",
]
for url in other_endpoints:
    r = requests.get(url, headers=headers, timeout=10)
    print(f"  {r.status_code} {url}")
    if r.ok:
        try:
            print(f"     {json.dumps(r.json(), ensure_ascii=False)[:300]}")
        except:
            print(f"     {r.text[:200]}")

print("\n" + "=" * 60)
print("DONE!")
print("=" * 60)
