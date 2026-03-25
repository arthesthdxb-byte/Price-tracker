from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Request, Header
import hashlib
import hmac
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import json
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Optional, Any
from datetime import datetime, timezone
import psycopg2
import psycopg2.extras

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL')

from contextlib import contextmanager

@contextmanager
def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

app = FastAPI()
api_router = APIRouter(prefix="/api")

def get_price(item_data) -> float:
    if isinstance(item_data, dict):
        return float(item_data.get("price", 0))
    return float(item_data)

def get_item_detail(item_data) -> dict:
    if isinstance(item_data, dict):
        return {
            "price": float(item_data.get("price", 0)),
            "original_price": item_data.get("original_price"),
            "description": item_data.get("description", ""),
            "category": item_data.get("category", ""),
            "image_url": item_data.get("image_url", ""),
        }
    return {
        "price": float(item_data),
        "original_price": None,
        "description": "",
        "category": "",
        "image_url": "",
    }

class BaselineData(BaseModel):
    brand_name: str
    items: Dict[str, Any]
    baseline_date: str = "24-Feb-25"
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BaselineUpload(BaseModel):
    brands: Dict[str, Dict[str, Any]]
    baseline_date: str = "24-Feb-25"

class ComparisonStats(BaseModel):
    price_up: int = 0
    price_down: int = 0
    new_items: int = 0
    removed: int = 0
    no_change: int = 0
    total: int = 0
    change_percent: float = 0.0

class DailyScrape(BaseModel):
    model_config = ConfigDict(extra="ignore")
    scrape_date: str
    brand_name: str
    items: Dict[str, Any]
    vs_baseline: ComparisonStats
    vs_previous: Optional[ComparisonStats] = None
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ScrapeUpload(BaseModel):
    scrape_date: str
    brands: Dict[str, Dict[str, Any]]
    set_as_baseline: bool = False

class BrandHistoryItem(BaseModel):
    date: str
    price_up: int
    price_down: int
    new_items: int
    removed: int
    no_change: int
    total: int
    change_percent: float

class ItemPriceHistory(BaseModel):
    item_name: str
    brand_name: str
    baseline_price: Optional[float]
    history: List[Dict[str, Any]]

class BrandGroup(BaseModel):
    own_brand: str
    competitors: List[str] = []
    group_order: int

class BrandGroupCreate(BaseModel):
    own_brand: str
    competitors: List[str] = []
    group_order: int

class BrandGroupUpdate(BaseModel):
    own_brand: Optional[str] = None
    competitors: Optional[List[str]] = None
    group_order: Optional[int] = None

class NewBrandsData(BaseModel):
    brands: Dict[str, Dict[str, Any]]

SLUG_TO_BRAND = {
    "operation-falafel-downtown-burj-khalifa": "Operational Falafel",
    "sushido": "Sushi DO",
    "right-bite": "Right Bite",
    "chin-chin-chinese-asian-noodles-business-bay-4": "Chin Chin",
    "taqado-mexican-kitchen-burritos-bowls-bay-square-business-bay": "Taqado",
    "pizzaro-italian-pizza-pasta": "Pizzaro",
    "biryani-pot-savour-the-heritage-business-bay-4": "Biryani Pot",
    "luca-italian-pasta": "Luca",
    "high-joint": "High Joint",
    "hotbun-sliders": "Hot Bun Sliders",
    "awani-middle-eastern-flavors": "Awani",
    "zaroob-levant-street-flavors": "Zaroob",
    "circle-cafe-healthy-salads-bowls-difc": "Circle Cafe",
    "kfc": "KFC",
    "aloo-beirut": "Aloo Beirut",
    "zaatar-w-zeit-dubai-hills": "Zaatar w Zeit",
    "sushi-buzz": "Sushi Buzz",
    "sushi-art-dubai-land": "Sushi Art",
    "the-500-calorie-project-business-bay": "The 500 Calorie Project",
    "kcal-al-satwa": "Kcal",
    "mandarin-oak-jumeirah-lakes-towers-jlt": "Mandarin Oak",
    "china-bistro": "China Bistro",
    "tortilla-dubai-malldowntown-burj-khalifa": "Tortilla",
    "chipotle": "Chipotle",
    "pizza-di-rocco-jumeirah-lakes-towers--jlt": "Pizza di Rocco",
    "oregano": "Oregano",
    "pizza-hut": "Pizza Hut",
    "gazebo-jumeirah-lakes-towers-jlt": "Gazebo",
    "art-of-dum": "Art of Dum",
    "pasta-della-nonna-dubai-silicon-oasis": "Pasta Della Nonna",
    "pasta-2-go": "Pasta 2 Go",
    "just-burger-al-quoz-1": "Just Burger",
    "krush-burger-difc": "Krush Burger",
    "salt-bbq-box": "Salt",
    "chick-n-slider": "Chick N Slider",
    "bait-maryam": "Bait Maryam",
    "al-safadi-um-al-sheif": "Al Safadi",
    "allo-beirut-al-badaa-city-walk": "Allo Beirut",
    "barbar": "Barbar",
    "ldc-kitchen-coffee": "LDC",
    "jones-the-grocer2": "Jones the Grocer",
    "parkers-al-mushrif": "Parkers",
}

def extract_slug(url: str) -> str:
    try:
        parts = url.split("/")
        for i, part in enumerate(parts):
            if part == "restaurant" and i + 2 < len(parts):
                return parts[i + 2].split("?")[0]
    except Exception:
        pass
    return ""

def parse_apify_items(menu_items: list) -> dict:
    items = {}
    for mi in menu_items:
        name = str(mi.get("name", "")).strip()
        if not name:
            continue
        orig = mi.get("originalPriceNumeric")
        price = mi.get("price") or mi.get("priceNumeric")
        if orig is not None and isinstance(orig, (int, float)) and orig > 0:
            use_price = float(orig)
        elif price is not None:
            use_price = float(price)
        else:
            continue
        if use_price > 0:
            items[name] = use_price
    return items

def compare_items(baseline_items: Dict[str, Any], scrape_items: Dict[str, Any]) -> ComparisonStats:
    stats = ComparisonStats()
    baseline_keys = set(baseline_items.keys())
    scrape_keys = set(scrape_items.keys())
    for item_name in scrape_keys:
        scrape_price = get_price(scrape_items[item_name])
        baseline_data = baseline_items.get(item_name)
        if baseline_data is None:
            stats.new_items += 1
        else:
            baseline_price = get_price(baseline_data)
            if scrape_price > baseline_price:
                stats.price_up += 1
            elif scrape_price < baseline_price:
                stats.price_down += 1
            else:
                stats.no_change += 1
    for item_name in baseline_keys:
        if item_name not in scrape_keys:
            stats.removed += 1
    stats.total = len(scrape_keys)
    if stats.total > 0:
        stats.change_percent = ((stats.price_up + stats.price_down) / stats.total) * 100
    return stats

def parse_date_for_sorting(date_str: str) -> datetime:
    try:
        return datetime.strptime(date_str, "%d-%b-%y")
    except:
        return datetime.now(timezone.utc)

@api_router.get("/")
async def root():
    return {"message": "Menu Price Tracker API"}

@api_router.post("/baseline")
async def upload_baseline(data: BaselineUpload):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM baseline")
            for brand_name, items in data.brands.items():
                cur.execute(
                    "INSERT INTO baseline (brand_name, items, baseline_date, updated_at) VALUES (%s, %s, %s, %s)",
                    (brand_name, json.dumps(items), data.baseline_date, datetime.now(timezone.utc))
                )
            cur.close()
        return {
            "success": True,
            "brands_count": len(data.brands),
            "items_count": sum(len(items) for items in data.brands.values())
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/baseline")
async def get_baseline():
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT brand_name, items, baseline_date FROM baseline")
            rows = cur.fetchall()
            cur.close()
        if not rows:
            return {"exists": False, "brands": {}}
        brands = {}
        baseline_date = rows[0]["baseline_date"]
        for row in rows:
            brands[row["brand_name"]] = row["items"]
        return {
            "exists": True,
            "baseline_date": baseline_date,
            "brands": brands,
            "brands_count": len(brands)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/scrape")
async def upload_scrape(data: ScrapeUpload):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cur.execute("SELECT own_brand FROM brand_groups")
            own_brands = [r["own_brand"] for r in cur.fetchall()]

            cur.execute("SELECT brand_name, items FROM baseline")
            baseline = {r["brand_name"]: r["items"] for r in cur.fetchall()}

            cur.execute("SELECT scrape_date, brand_name, items FROM scrapes WHERE scrape_date != %s", (data.scrape_date,))
            existing_scrapes = cur.fetchall()

            previous_by_brand = {}
            if existing_scrapes:
                all_dates = list(set(s["scrape_date"] for s in existing_scrapes))
                sorted_dates = sorted(all_dates, key=parse_date_for_sorting)
                current_date_obj = parse_date_for_sorting(data.scrape_date)
                previous_dates = [d for d in sorted_dates if parse_date_for_sorting(d) < current_date_obj]
                if previous_dates:
                    most_recent_previous = previous_dates[-1]
                    for scrape in existing_scrapes:
                        if scrape["scrape_date"] == most_recent_previous:
                            previous_by_brand[scrape["brand_name"]] = scrape["items"]

            cur.execute("DELETE FROM scrapes WHERE scrape_date = %s", (data.scrape_date,))

            new_baselines = []
            comparison_data = {}
            brands_count = 0

            for brand_name, items in data.brands.items():
                baseline_items = baseline.get(brand_name, {})
                if not baseline_items:
                    cur.execute(
                        "INSERT INTO baseline (brand_name, items, baseline_date, updated_at) VALUES (%s, %s, %s, %s)",
                        (brand_name, json.dumps(items), data.scrape_date, datetime.now(timezone.utc))
                    )
                    new_baselines.append(brand_name)
                    baseline_items = items

                previous_items = previous_by_brand.get(brand_name, {})
                vs_baseline = compare_items(baseline_items, items)
                vs_previous = compare_items(previous_items, items) if previous_items else None

                cur.execute(
                    "INSERT INTO scrapes (scrape_date, brand_name, items, vs_baseline, vs_previous, uploaded_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (data.scrape_date, brand_name, json.dumps(items),
                     json.dumps(vs_baseline.model_dump()),
                     json.dumps(vs_previous.model_dump()) if vs_previous else None,
                     datetime.now(timezone.utc))
                )
                brands_count += 1
                comparison_data[brand_name] = {
                    "vs_baseline": vs_baseline.model_dump(),
                    "is_own_brand": brand_name in own_brands
                }

            ai_summary = None
            if not data.set_as_baseline:
                ai_summary = await generate_ai_summary(data.scrape_date, comparison_data)
                if ai_summary:
                    cur.execute("UPDATE scrapes SET ai_summary = %s WHERE scrape_date = %s", (ai_summary, data.scrape_date))

            if data.set_as_baseline:
                cur.execute("DELETE FROM baseline")
                for brand_name, items in data.brands.items():
                    cur.execute(
                        "INSERT INTO baseline (brand_name, items, baseline_date, updated_at) VALUES (%s, %s, %s, %s)",
                        (brand_name, json.dumps(items), data.scrape_date, datetime.now(timezone.utc))
                    )

            cur.close()
        return {
            "success": True,
            "scrape_date": data.scrape_date,
            "brands_count": brands_count,
            "baseline_updated": data.set_as_baseline,
            "new_baselines_created": len(new_baselines),
            "ai_summary": ai_summary
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/dashboard")
async def get_dashboard():
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT scrape_date, brand_name, items, vs_baseline, vs_previous FROM scrapes")
            all_scrapes = cur.fetchall()
            cur.close()

        if not all_scrapes:
            return {"has_data": False, "latest_date": None, "previous_date": None, "brands": []}

        brands_data = {}
        dates = set()
        for scrape in all_scrapes:
            brand = scrape["brand_name"]
            date = scrape["scrape_date"]
            dates.add(date)
            if brand not in brands_data:
                brands_data[brand] = {}
            brands_data[brand][date] = {
                "items": scrape["items"],
                "vs_baseline": scrape["vs_baseline"],
                "vs_previous": scrape["vs_previous"]
            }

        sorted_dates = sorted(dates, key=parse_date_for_sorting)
        latest_date = sorted_dates[-1] if sorted_dates else None
        previous_date = sorted_dates[-2] if len(sorted_dates) > 1 else None

        brands_list = []
        for brand_name, date_data in brands_data.items():
            latest_data = date_data.get(latest_date, {})
            brands_list.append({
                "brand_name": brand_name,
                "latest_data": latest_data,
                "all_dates": list(date_data.keys())
            })

        return {
            "has_data": True,
            "latest_date": latest_date,
            "previous_date": previous_date,
            "all_dates": sorted_dates,
            "brands": brands_list
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/brand-history/{brand_name}")
async def get_brand_history(brand_name: str):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT scrape_date, vs_baseline, vs_previous, ai_summary FROM scrapes WHERE brand_name = %s", (brand_name,))
            scrapes = cur.fetchall()
            cur.close()

        scrapes.sort(key=lambda x: parse_date_for_sorting(x["scrape_date"]))
        history = []
        for scrape in scrapes:
            vs_baseline = scrape["vs_baseline"]
            vs_previous = scrape["vs_previous"]
            entry = {
                "date": scrape["scrape_date"],
                "vs_baseline": {
                    "price_up": vs_baseline["price_up"],
                    "price_down": vs_baseline["price_down"],
                    "new_items": vs_baseline["new_items"],
                    "removed": vs_baseline["removed"],
                    "no_change": vs_baseline["no_change"],
                    "total": vs_baseline["total"],
                    "change_percent": vs_baseline["change_percent"],
                },
                "vs_previous": {
                    "price_up": vs_previous["price_up"],
                    "price_down": vs_previous["price_down"],
                    "new_items": vs_previous["new_items"],
                    "removed": vs_previous["removed"],
                    "no_change": vs_previous["no_change"],
                    "total": vs_previous["total"],
                    "change_percent": vs_previous["change_percent"],
                } if vs_previous else None,
                "ai_summary": scrape.get("ai_summary"),
                "price_up": vs_baseline["price_up"],
                "price_down": vs_baseline["price_down"],
                "new_items": vs_baseline["new_items"],
                "removed": vs_baseline["removed"],
                "no_change": vs_baseline["no_change"],
                "total": vs_baseline["total"],
                "change_percent": vs_baseline["change_percent"],
            }
            history.append(entry)

        return {"brand_name": brand_name, "history": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/items/{brand_name}")
async def get_items_history(brand_name: str):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT items, baseline_date FROM baseline WHERE brand_name = %s LIMIT 1", (brand_name,))
            baseline_row = cur.fetchone()
            baseline_items = baseline_row["items"] if baseline_row else {}
            baseline_date = baseline_row["baseline_date"] if baseline_row else "24-Feb-25"
            cur.execute("SELECT scrape_date, items FROM scrapes WHERE brand_name = %s", (brand_name,))
            scrapes = cur.fetchall()
            cur.close()

        scrapes.sort(key=lambda x: parse_date_for_sorting(x["scrape_date"]))

        all_items = set(baseline_items.keys())
        for scrape in scrapes:
            all_items.update(scrape["items"].keys())

        items_history = []
        for item_name in sorted(all_items):
            raw_baseline = baseline_items.get(item_name)
            baseline_price = get_price(raw_baseline) if raw_baseline is not None else None
            price_history = [{"date": baseline_date, "price": baseline_price}]
            for scrape in scrapes:
                raw_price = scrape["items"].get(item_name)
                price_history.append({"date": scrape["scrape_date"], "price": get_price(raw_price) if raw_price is not None else None})
            items_history.append({
                "item_name": item_name,
                "baseline_price": baseline_price,
                "history": price_history
            })

        return {"brand_name": brand_name, "baseline_date": baseline_date, "items": items_history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/compare/{target_date}")
async def compare_with_date(target_date: str):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT scrape_date, brand_name, items FROM scrapes")
            all_scrapes = cur.fetchall()
            cur.close()

        if not all_scrapes:
            return {"brands": [], "latest_date": None, "target_date": target_date}

        brand_date_items = {}
        dates = set()
        for scrape in all_scrapes:
            brand = scrape["brand_name"]
            date = scrape["scrape_date"]
            dates.add(date)
            if brand not in brand_date_items:
                brand_date_items[brand] = {}
            brand_date_items[brand][date] = scrape["items"]

        sorted_dates = sorted(dates, key=parse_date_for_sorting)
        latest_date = sorted_dates[-1] if sorted_dates else None

        brands_comparison = []
        for brand_name, date_data in brand_date_items.items():
            latest_items = date_data.get(latest_date, {})
            target_items = date_data.get(target_date, {})
            if latest_items and target_items:
                stats = compare_items(target_items, latest_items)
                brands_comparison.append({"brand_name": brand_name, "stats": stats.model_dump()})
            elif latest_items:
                brands_comparison.append({
                    "brand_name": brand_name,
                    "stats": {"price_up": 0, "price_down": 0, "new_items": len(latest_items), "removed": 0, "no_change": 0, "total": len(latest_items), "change_percent": 0}
                })

        return {"latest_date": latest_date, "target_date": target_date, "brands": brands_comparison}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/all-history")
async def get_all_history():
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT own_brand FROM brand_groups")
            own_brands = [r["own_brand"] for r in cur.fetchall()]
            cur.execute("SELECT scrape_date, brand_name, vs_baseline FROM scrapes")
            all_scrapes = cur.fetchall()
            cur.close()

        if not all_scrapes:
            return {"dates_summary": [], "latest_date": None, "total_brands": 0, "own_brands_count": len(own_brands)}

        dates_data = {}
        for scrape in all_scrapes:
            date = scrape["scrape_date"]
            brand = scrape["brand_name"]
            if date not in dates_data:
                dates_data[date] = {"brands": {}, "own_brands_only": {}}
            dates_data[date]["brands"][brand] = scrape["vs_baseline"]
            if brand in own_brands:
                dates_data[date]["own_brands_only"][brand] = scrape["vs_baseline"]

        dates_summary = []
        for date in sorted(dates_data.keys(), key=parse_date_for_sorting):
            own_data = dates_data[date]["own_brands_only"]
            total_price_up = sum(b["price_up"] for b in own_data.values())
            total_price_down = sum(b["price_down"] for b in own_data.values())
            total_new_items = sum(b["new_items"] for b in own_data.values())
            total_removed = sum(b["removed"] for b in own_data.values())
            total_no_change = sum(b["no_change"] for b in own_data.values())
            total_items = sum(b["total"] for b in own_data.values())
            dates_summary.append({
                "date": date, "brands_count": len(own_data),
                "total_price_up": total_price_up, "total_price_down": total_price_down,
                "total_new_items": total_new_items, "total_removed": total_removed,
                "total_no_change": total_no_change, "total_items": total_items
            })

        latest_date = sorted(dates_data.keys(), key=parse_date_for_sorting, reverse=True)[0] if dates_data else None
        return {
            "dates_summary": dates_summary, "latest_date": latest_date,
            "total_brands": len(set(brand for dd in dates_data.values() for brand in dd["brands"].keys())),
            "own_brands_count": len(own_brands)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/npd")
async def get_npd(target_date: str = None, baseline_date: str = None, latest_date: str = None):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT scrape_date, brand_name, items FROM scrapes")
            all_scrapes = cur.fetchall()
            cur.execute("SELECT own_brand FROM brand_groups")
            own_brands = [r["own_brand"] for r in cur.fetchall()]
            cur.close()

        if not all_scrapes:
            return {"has_data": False, "latest_date": None, "previous_date": None, "brands": [], "available_dates": []}

        dates = sorted(set(s["scrape_date"] for s in all_scrapes), key=parse_date_for_sorting)

        if len(dates) < 2:
            return {"has_data": False, "latest_date": dates[0] if dates else None, "previous_date": None, "brands": [], "available_dates": dates, "message": "Need at least 2 scrape dates for NPD comparison"}

        sel_latest = latest_date if latest_date and latest_date in dates else dates[-1]
        sel_baseline = baseline_date if baseline_date and baseline_date in dates else (target_date if target_date and target_date in dates else dates[-2])

        if sel_baseline == sel_latest:
            sel_baseline = dates[-2] if sel_latest == dates[-1] else dates[0]

        latest_by_brand = {}
        baseline_by_brand = {}
        for scrape in all_scrapes:
            if scrape["scrape_date"] == sel_latest:
                latest_by_brand[scrape["brand_name"]] = scrape["items"]
            elif scrape["scrape_date"] == sel_baseline:
                baseline_by_brand[scrape["brand_name"]] = scrape["items"]

        brands_npd = []
        all_brand_names = set(list(latest_by_brand.keys()) + list(baseline_by_brand.keys()))

        for brand_name in sorted(all_brand_names):
            latest_items = latest_by_brand.get(brand_name, {})
            baseline_items_data = baseline_by_brand.get(brand_name, {})

            latest_keys = set(latest_items.keys())
            baseline_keys = set(baseline_items_data.keys())

            new_item_names = latest_keys - baseline_keys
            removed_item_names = baseline_keys - latest_keys

            if not new_item_names and not removed_item_names:
                continue

            new_items = []
            for name in sorted(new_item_names):
                detail = get_item_detail(latest_items[name])
                detail["item_name"] = name
                new_items.append(detail)

            removed_items = []
            for name in sorted(removed_item_names):
                detail = get_item_detail(baseline_items_data[name])
                detail["item_name"] = name
                removed_items.append(detail)

            brands_npd.append({
                "brand_name": brand_name,
                "is_own_brand": brand_name in own_brands,
                "new_items": new_items,
                "removed_items": removed_items,
                "new_count": len(new_items),
                "removed_count": len(removed_items),
            })

        brands_npd.sort(key=lambda x: (not x["is_own_brand"], -x["new_count"] - x["removed_count"]))

        return {
            "has_data": True,
            "latest_date": sel_latest,
            "previous_date": sel_baseline,
            "brands": brands_npd,
            "total_new": sum(b["new_count"] for b in brands_npd),
            "total_removed": sum(b["removed_count"] for b in brands_npd),
            "brands_with_changes": len(brands_npd),
            "available_dates": dates,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/npd-ai-summary")
async def get_npd_ai_summary(target_date: str = None, baseline_date: str = None, latest_date: str = None):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT scrape_date, brand_name, items FROM scrapes")
            all_scrapes = cur.fetchall()
            cur.close()

        if not all_scrapes:
            raise HTTPException(status_code=404, detail="No scrape data found")

        dates = sorted(set(s["scrape_date"] for s in all_scrapes), key=parse_date_for_sorting)
        if len(dates) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 scrape dates")

        sel_latest = latest_date if latest_date and latest_date in dates else dates[-1]
        sel_baseline = baseline_date if baseline_date and baseline_date in dates else (target_date if target_date and target_date in dates else dates[-2])
        if sel_baseline == sel_latest:
            sel_baseline = dates[-2] if sel_latest == dates[-1] else dates[0]

        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT summary FROM npd_summaries WHERE latest_date = %s AND previous_date = %s LIMIT 1", (sel_latest, sel_baseline))
            cached = cur.fetchone()
            cur.close()

        if cached:
            return {"success": True, "summary": cached["summary"], "latest_date": sel_latest, "previous_date": sel_baseline, "cached": True}

        latest_by_brand = {}
        baseline_by_brand = {}
        for scrape in all_scrapes:
            if scrape["scrape_date"] == sel_latest:
                latest_by_brand[scrape["brand_name"]] = scrape["items"]
            elif scrape["scrape_date"] == sel_baseline:
                baseline_by_brand[scrape["brand_name"]] = scrape["items"]

        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT own_brand FROM brand_groups")
            own_brands = [r["own_brand"] for r in cur.fetchall()]
            cur.close()

        npd_data = []
        for brand_name in set(list(latest_by_brand.keys()) + list(baseline_by_brand.keys())):
            sel_items = latest_by_brand.get(brand_name, {})
            cmp_items = baseline_by_brand.get(brand_name, {})
            new_names = set(sel_items.keys()) - set(cmp_items.keys())
            removed_names = set(cmp_items.keys()) - set(sel_items.keys())
            if not new_names and not removed_names:
                continue
            new_details = []
            for name in new_names:
                detail = get_item_detail(sel_items[name])
                new_details.append({"name": name, "price": detail["price"], "category": detail.get("category", ""), "description": detail.get("description", "")[:100]})
            removed_details = [{"name": name, "price": get_price(cmp_items[name])} for name in removed_names]
            npd_data.append({"brand": brand_name, "is_own_brand": brand_name in own_brands, "new_items": new_details, "removed_items": removed_details})

        if not npd_data:
            return {"success": True, "summary": "No new product changes detected between the two dates.", "latest_date": sel_latest, "previous_date": sel_baseline}

        summary = await generate_npd_ai_summary(sel_latest, sel_baseline, npd_data)
        if summary:
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute("""INSERT INTO npd_summaries (latest_date, previous_date, summary, created_at) 
                                VALUES (%s, %s, %s, %s)
                                ON CONFLICT (latest_date, previous_date) DO UPDATE SET summary = EXCLUDED.summary, created_at = EXCLUDED.created_at""",
                            (sel_latest, sel_baseline, summary, datetime.now(timezone.utc)))
                cur.close()
            return {"success": True, "summary": summary, "latest_date": sel_latest, "previous_date": sel_baseline, "cached": False}
        else:
            return {"success": True, "summary": None, "latest_date": sel_latest, "previous_date": sel_baseline, "cached": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/npd-ai-summary/regenerate")
async def regenerate_npd_ai_summary_endpoint(baseline_date: str = None, latest_date: str = None):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT DISTINCT scrape_date FROM scrapes")
            all_dates = [r["scrape_date"] for r in cur.fetchall()]
            cur.close()

        dates = sorted(all_dates, key=parse_date_for_sorting)
        if len(dates) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 scrape dates")

        sel_latest = latest_date if latest_date and latest_date in dates else dates[-1]
        sel_baseline = baseline_date if baseline_date and baseline_date in dates else dates[-2]
        if sel_baseline == sel_latest:
            sel_baseline = dates[-2] if sel_latest == dates[-1] else dates[0]

        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM npd_summaries WHERE latest_date = %s AND previous_date = %s", (sel_latest, sel_baseline))
            cur.close()

        return await get_npd_ai_summary(baseline_date=sel_baseline, latest_date=sel_latest)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/fix-dates")
async def fix_dates():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            date_mapping = {"11 mar": "11-Mar-26", "6 Mar": "6-Mar-26", "9 Mar": "9-Mar-26"}
            for old_date, new_date in date_mapping.items():
                cur.execute("UPDATE scrapes SET scrape_date = %s WHERE scrape_date = %s", (new_date, old_date))
            cur.execute("UPDATE baseline SET baseline_date = %s WHERE baseline_date = %s", ("24-Feb-26", "24-Feb-25"))
            cur.close()
        return {"success": True, "message": "Dates updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/scrape/{scrape_date}")
async def delete_scrape_date(scrape_date: str):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM scrapes WHERE scrape_date = %s", (scrape_date,))
            deleted = cur.rowcount
            cur.close()
        return {"success": True, "message": f"Deleted scrapes for {scrape_date}", "deleted_count": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/fix-brand-data")
async def fix_brand_data():
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT items FROM baseline WHERE brand_name = %s LIMIT 1", ("Mandarin Oak",))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Mandarin Oak not found in baseline")

            baseline_items = row["items"]
            dates_to_fix = ["6-Mar-26", "9-Mar-26", "11-Mar-26"]
            updated_count = 0
            for scrape_date in dates_to_fix:
                cur.execute(
                    "UPDATE scrapes SET items = %s, vs_baseline = %s WHERE scrape_date = %s AND brand_name = %s",
                    (json.dumps(baseline_items),
                     json.dumps({"price_up": 0, "price_down": 0, "new_items": 0, "removed": 0,
                                 "no_change": len(baseline_items), "total": len(baseline_items), "change_percent": 0.0}),
                     scrape_date, "Mandarin Oak")
                )
                if cur.rowcount > 0:
                    updated_count += 1
            cur.close()
        return {"success": True, "message": "Mandarin Oak data fixed", "dates_updated": updated_count, "items_count": len(baseline_items)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/add-new-brands")
async def add_new_brands(data: NewBrandsData):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            baseline_date = "24-Feb-26"
            dates_to_update = ["6-Mar-26", "9-Mar-26", "11-Mar-26"]

            for brand_name, items in data.brands.items():
                cur.execute(
                    "INSERT INTO baseline (brand_name, items, baseline_date, updated_at) VALUES (%s, %s, %s, %s)",
                    (brand_name, json.dumps(items), baseline_date, datetime.now(timezone.utc))
                )

            scrapes_added = 0
            for brand_name, items in data.brands.items():
                for scrape_date in dates_to_update:
                    cur.execute(
                        "INSERT INTO scrapes (scrape_date, brand_name, items, vs_baseline, vs_previous, uploaded_at) VALUES (%s, %s, %s, %s, %s, %s)",
                        (scrape_date, brand_name, json.dumps(items),
                         json.dumps({"price_up": 0, "price_down": 0, "new_items": 0, "removed": 0,
                                     "no_change": len(items), "total": len(items), "change_percent": 0.0}),
                         None, datetime.now(timezone.utc))
                    )
                    scrapes_added += 1
            cur.close()
        return {"success": True, "message": "New brands added", "baseline_brands_added": len(data.brands), "scrapes_added": scrapes_added}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/brand-groups")
async def get_brand_groups():
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT own_brand, competitors, group_order FROM brand_groups ORDER BY group_order")
            rows = cur.fetchall()
            cur.close()
        groups = [{"own_brand": r["own_brand"], "competitors": list(r["competitors"]) if r["competitors"] else [], "group_order": r["group_order"]} for r in rows]
        return {"brand_groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/brand-groups")
async def create_brand_group(group: BrandGroupCreate):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO brand_groups (own_brand, competitors, group_order) VALUES (%s, %s, %s)",
                (group.own_brand, group.competitors, group.group_order)
            )
            cur.close()
        return {"success": True, "message": "Brand group created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/brand-groups/{own_brand}")
async def update_brand_group(own_brand: str, update: BrandGroupUpdate):
    try:
        update_data = {k: v for k, v in update.model_dump().items() if v is not None}
        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")

        with get_db() as conn:
            cur = conn.cursor()
            set_clauses = []
            values = []
            for k, v in update_data.items():
                set_clauses.append(f"{k} = %s")
                values.append(v)
            values.append(own_brand)
            cur.execute(f"UPDATE brand_groups SET {', '.join(set_clauses)} WHERE own_brand = %s", values)
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Brand group not found")
            cur.close()
        return {"success": True, "message": "Brand group updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/brand-groups/{own_brand}")
async def delete_brand_group(own_brand: str):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM brand_groups WHERE own_brand = %s", (own_brand,))
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Brand group not found")
            cur.close()
        return {"success": True, "message": "Brand group deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def generate_ai_summary(scrape_date: str, comparison_data: dict) -> str:
    try:
        import httpx
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set, skipping AI summary")
            return None

        own_brands_data = []
        for brand_name, data in comparison_data.items():
            if data.get('is_own_brand'):
                own_brands_data.append({
                    "brand": brand_name,
                    "price_up": data['vs_baseline']['price_up'],
                    "price_down": data['vs_baseline']['price_down'],
                    "new_items": data['vs_baseline']['new_items'],
                    "removed": data['vs_baseline']['removed'],
                    "total": data['vs_baseline']['total']
                })

        prompt = f"""Analyze this menu pricing data for Talabat UAE restaurants on {scrape_date}.

Key changes across 14 own brands:
{json.dumps(own_brands_data, indent=2)}

Provide a concise 2-3 sentence summary highlighting:
1. Overall pricing trend (net increases vs decreases)
2. Brands with most significant changes
3. Any notable patterns (e.g., menu expansions, major price adjustments)

Keep it professional and data-driven."""

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 300,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=30.0
            )
            if response.status_code == 200:
                result = response.json()
                return result["content"][0]["text"]
            else:
                logger.error(f"Claude API error: {response.status_code} - {response.text}")
                return None
    except Exception as e:
        logger.error(f"Error generating AI summary: {e}")
        return None

async def generate_npd_ai_summary(latest_date: str, previous_date: str, npd_data: list) -> str:
    try:
        import httpx
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set, skipping NPD AI summary")
            return None

        prompt = f"""You are analyzing New Product Development (NPD) data for Talabat UAE restaurant brands.

Comparing menu changes between {previous_date} and {latest_date}:

{json.dumps(npd_data, indent=2)}

Provide a professional brand-level summary covering:
1. Which brands launched new items and what types of products (combos, healthy options, seasonal items, etc.)
2. Which brands removed items and possible reasons (seasonal removal, menu optimization, etc.)
3. Key trends across brands (e.g., focus on value combos, health-conscious additions, premium items)
4. Separate analysis for own brands vs competitor brands if both have changes

Write in plain text only — do NOT use markdown, asterisks, bold, headers, or any formatting. Just use plain sentences. Keep it concise but insightful — 4-6 sentences max. Focus on strategic insights, not just listing items."""

        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 500,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=30.0
            )
            if response.status_code == 200:
                result = response.json()
                return result["content"][0]["text"]
            else:
                logger.error(f"Claude API error for NPD: {response.status_code} - {response.text}")
                return None
    except Exception as e:
        logger.error(f"Error generating NPD AI summary: {e}")
        return None

@api_router.post("/regenerate-summary/{scrape_date}")
async def regenerate_summary(scrape_date: str):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT brand_name, vs_baseline FROM scrapes WHERE scrape_date = %s", (scrape_date,))
            scrapes = cur.fetchall()
            if not scrapes:
                raise HTTPException(status_code=404, detail="No data found for this date")

            cur.execute("SELECT own_brand FROM brand_groups")
            own_brands = [r["own_brand"] for r in cur.fetchall()]

            comparison_data = {}
            for scrape in scrapes:
                comparison_data[scrape["brand_name"]] = {
                    "vs_baseline": scrape["vs_baseline"],
                    "is_own_brand": scrape["brand_name"] in own_brands
                }

            ai_summary = await generate_ai_summary(scrape_date, comparison_data)
            if ai_summary:
                cur.execute("UPDATE scrapes SET ai_summary = %s WHERE scrape_date = %s", (ai_summary, scrape_date))
                cur.close()
            else:
                cur.close()
                raise HTTPException(status_code=500, detail="Failed to generate summary")
        return {"success": True, "summary": ai_summary}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/upload-excel")
async def upload_excel(file: UploadFile = File(...), upload_type: str = "baseline", scrape_date: str = "24-Feb-25"):
    try:
        import pandas as pd
        import io

        contents = await file.read()
        xls = pd.ExcelFile(io.BytesIO(contents))

        skip_keywords = ['Executive Summary', 'Price History', 'Trend Data', 'Price Increases', 'Price Decreases']
        brands = {}

        for sheet_name in xls.sheet_names:
            if any(kw in sheet_name for kw in skip_keywords):
                continue
            df = pd.read_excel(xls, sheet_name=sheet_name, header=None)
            items = {}
            for i in range(5, min(605, len(df))):
                row = df.iloc[i]
                if len(row) > 7:
                    item_name = row[6]
                    price = row[7]
                    if pd.notna(item_name) and pd.notna(price):
                        try:
                            tn = str(item_name).strip()
                            pp = float(price)
                            if tn:
                                items[tn] = pp
                        except (ValueError, TypeError):
                            continue
            if items:
                brands[sheet_name] = items

        if not brands:
            raise HTTPException(status_code=400, detail="No valid data found in Excel file")

        with get_db() as conn:
            cur = conn.cursor()

            if upload_type == "baseline":
                cur.execute("DELETE FROM baseline")
                for brand_name, items in brands.items():
                    cur.execute(
                        "INSERT INTO baseline (brand_name, items, baseline_date, updated_at) VALUES (%s, %s, %s, %s)",
                        (brand_name, json.dumps(items), scrape_date, datetime.now(timezone.utc))
                    )
            else:
                cur.execute("DELETE FROM scrapes WHERE scrape_date = %s", (scrape_date,))
                cur2 = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                cur2.execute("SELECT brand_name, items FROM baseline")
                baseline = {r["brand_name"]: r["items"] for r in cur2.fetchall()}
                cur2.close()

                for brand_name, items in brands.items():
                    baseline_items = baseline.get(brand_name, {})
                    vs_baseline = compare_items(baseline_items, items) if baseline_items else ComparisonStats(total=len(items))
                    cur.execute(
                        "INSERT INTO scrapes (scrape_date, brand_name, items, vs_baseline, uploaded_at) VALUES (%s, %s, %s, %s, %s)",
                        (scrape_date, brand_name, json.dumps(items), json.dumps(vs_baseline.model_dump()), datetime.now(timezone.utc))
                    )

            cur.close()

        return {
            "success": True,
            "upload_type": upload_type,
            "brands_count": len(brands),
            "items_count": sum(len(items) for items in brands.values()),
            "brands": list(brands.keys())
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/apify-webhook")
async def apify_webhook(request: Request):
    try:
        body = await request.json()

        if "items" in body:
            jsonl_records = body["items"]
            scrape_date = body.get("scrape_date", "")
            if not scrape_date:
                now = datetime.now(timezone.utc)
                scrape_date = now.strftime("%-d-%b-%y").replace("-0", "-")
            logger.info(f"[Apify Direct] Received {len(jsonl_records)} records for {scrape_date}")

        elif "resource" in body:
            resource = body.get("resource", {})
            dataset_id = resource.get("defaultDatasetId")
            if not dataset_id:
                raise HTTPException(status_code=400, detail="No datasetId in webhook payload")
            apify_token = os.environ.get("APIFY_TOKEN")
            if not apify_token:
                raise HTTPException(status_code=500, detail="APIFY_TOKEN not configured")
            import httpx
            async with httpx.AsyncClient() as http_client:
                dataset_url = f"https://api.apify.com/v2/datasets/{dataset_id}/items?token={apify_token}&format=json"
                resp = await http_client.get(dataset_url, timeout=60.0)
                if resp.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Apify API returned {resp.status_code}")
                jsonl_records = resp.json()
            now = datetime.now(timezone.utc)
            scrape_date = now.strftime("%-d-%b-%y").replace("-0", "-")
            logger.info(f"[Apify Webhook] Fetched {len(jsonl_records)} records from dataset {dataset_id}")
        else:
            raise HTTPException(status_code=400, detail="Invalid payload")

        brands = {}
        unmatched_slugs = []
        skipped_empty = []

        for record in jsonl_records:
            url = record.get("url", "")
            slug = extract_slug(url)
            menu_items = record.get("menuItems", [])
            if not menu_items:
                skipped_empty.append(slug)
                continue
            brand_name = SLUG_TO_BRAND.get(slug)
            if not brand_name:
                unmatched_slugs.append(slug)
                logger.warning(f"[Apify] Unmatched slug: {slug}")
                continue
            items = parse_apify_items(menu_items)
            if items:
                if brand_name in brands:
                    brands[brand_name].update(items)
                else:
                    brands[brand_name] = items

        if not brands:
            return {"success": False, "error": "No valid brands parsed", "unmatched_slugs": unmatched_slugs, "skipped_empty": skipped_empty}

        logger.info(f"[Apify] Parsed {len(brands)} brands, {sum(len(v) for v in brands.values())} total items")

        scrape_payload = ScrapeUpload(scrape_date=scrape_date, brands=brands, set_as_baseline=False)
        result = await upload_scrape(scrape_payload)

        return {
            "success": True,
            "scrape_date": scrape_date,
            "brands_parsed": len(brands),
            "total_items": sum(len(v) for v in brands.values()),
            "unmatched_slugs": unmatched_slugs,
            "skipped_empty": skipped_empty,
            "scrape_result": result
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Apify Webhook] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/migrate-data")
async def migrate_data(request: Request):
    try:
        data = await request.json()
        token = data.get("token", "")
        if token != os.environ.get("APIFY_TOKEN", ""):
            raise HTTPException(status_code=403, detail="Invalid token")
        with get_db() as conn:
            cur = conn.cursor()
            if data.get("baseline"):
                for r in data["baseline"]:
                    cur.execute("INSERT INTO baseline (brand_name, items) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                                (r["brand_name"], json.dumps(r["items"])))
            if data.get("scrapes"):
                for r in data["scrapes"]:
                    cur.execute("INSERT INTO scrapes (scrape_date, brand_name, items) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                                (r["scrape_date"], r["brand_name"], json.dumps(r["items"])))
            if data.get("brand_groups"):
                cur.execute("DELETE FROM brand_groups")
                for r in data["brand_groups"]:
                    comps = r["competitors"] if isinstance(r["competitors"], list) else json.loads(r["competitors"])
                    cur.execute("INSERT INTO brand_groups (own_brand, competitors, group_order) VALUES (%s, %s, %s)",
                                (r["own_brand"], comps, r["group_order"]))
            cur.close()
        return {"success": True, "message": "Data migrated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS baseline (
                    id SERIAL PRIMARY KEY,
                    brand_name TEXT NOT NULL,
                    items JSONB NOT NULL DEFAULT '{}',
                    baseline_date TEXT,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS scrapes (
                    id SERIAL PRIMARY KEY,
                    scrape_date TEXT NOT NULL,
                    brand_name TEXT NOT NULL,
                    items JSONB NOT NULL DEFAULT '{}',
                    vs_baseline JSONB,
                    vs_previous JSONB,
                    ai_summary TEXT,
                    uploaded_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS brand_groups (
                    id SERIAL PRIMARY KEY,
                    own_brand TEXT NOT NULL UNIQUE,
                    competitors TEXT[] DEFAULT '{}',
                    group_order INTEGER DEFAULT 0
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS npd_summaries (
                    id SERIAL PRIMARY KEY,
                    latest_date TEXT NOT NULL,
                    previous_date TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(latest_date, previous_date)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_baseline_brand ON baseline(brand_name)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_scrapes_date ON scrapes(scrape_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_scrapes_brand ON scrapes(brand_name)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_scrapes_date_brand ON scrapes(scrape_date, brand_name)")
            conn.commit()
            logger.info("Database schema initialized")

            cur.execute("SELECT COUNT(*) FROM baseline")
            baseline_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM scrapes WHERE vs_baseline IS NOT NULL AND vs_baseline::text != '{}' AND vs_baseline::text != 'null'")
            computed_count = cur.fetchone()[0]
            needs_recompute = baseline_count > 0 and computed_count == 0
            if baseline_count == 0:
                seed_file = ROOT_DIR / "seed_data.json"
                if seed_file.exists():
                    logger.info("Empty database detected — loading seed data...")
                    import json as _json
                    with open(seed_file) as sf:
                        seed = _json.load(sf)
                    for r in seed.get("baseline", []):
                        cur.execute("INSERT INTO baseline (brand_name, items) VALUES (%s, %s)",
                                    (r["brand_name"], _json.dumps(r["items"])))
                    for r in seed.get("scrapes", []):
                        cur.execute("INSERT INTO scrapes (scrape_date, brand_name, items) VALUES (%s, %s, %s)",
                                    (r["scrape_date"], r["brand_name"], _json.dumps(r["items"])))
                    cur.execute("DELETE FROM brand_groups")
                    for r in seed.get("brand_groups", []):
                        comps = r["competitors"] if isinstance(r["competitors"], list) else _json.loads(r["competitors"])
                        cur.execute("INSERT INTO brand_groups (own_brand, competitors, group_order) VALUES (%s, %s, %s)",
                                    (r["own_brand"], comps, r["group_order"]))
                    conn.commit()
                    logger.info(f"Seeded {len(seed.get('baseline', []))} baseline, {len(seed.get('scrapes', []))} scrapes, {len(seed.get('brand_groups', []))} brand groups")

                    logger.info("Recomputing vs_baseline and vs_previous for seeded scrapes...")
                    cur2 = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                    cur2.execute("SELECT brand_name, items FROM baseline")
                    baseline_map = {r["brand_name"]: r["items"] for r in cur2.fetchall()}
                    cur2.execute("SELECT id, scrape_date, brand_name, items FROM scrapes ORDER BY brand_name")
                    all_scrapes_list = cur2.fetchall()
                    cur2.close()

                    scrapes_by_brand = {}
                    for s in all_scrapes_list:
                        scrapes_by_brand.setdefault(s["brand_name"], []).append(s)
                    for brand_name, brand_scrapes in scrapes_by_brand.items():
                        brand_scrapes.sort(key=lambda x: parse_date_for_sorting(x["scrape_date"]))
                        bl_items = baseline_map.get(brand_name, {})
                        prev_items = bl_items
                        for s in brand_scrapes:
                            vs_bl = compare_items(bl_items, s["items"])
                            vs_prev = compare_items(prev_items, s["items"])
                            cur3 = conn.cursor()
                            cur3.execute("UPDATE scrapes SET vs_baseline = %s, vs_previous = %s WHERE id = %s",
                                         (_json.dumps(vs_bl.model_dump()), _json.dumps(vs_prev.model_dump()), s["id"]))
                            cur3.close()
                            prev_items = s["items"]
                    conn.commit()
                    logger.info("Recomputation complete")
                else:
                    cur.execute("SELECT COUNT(*) FROM brand_groups")
                    bg_count = cur.fetchone()[0]
                    if bg_count == 0:
                        initial_groups = [
                            ("Operational Falafel", ["Zaatar w Zeit", "Aloo Beirut"], 1),
                            ("Sushi DO", ["Sushi Buzz", "Sushi Art"], 2),
                            ("Right Bite", ["The 500 Calorie Project", "Kcal"], 3),
                            ("Chin Chin", ["Mandarin Oak", "China Bistro"], 4),
                            ("Taqado", ["Tortilla", "Chipotle"], 5),
                            ("Pizzaro", ["Pizza di Rocco", "Oregano", "Pizza Hut"], 6),
                            ("Biryani Pot", ["Gazebo", "Art of Dum"], 7),
                            ("Luca", ["Pasta Della Nonna", "The Pasta Cup"], 8),
                            ("High Joint", ["Just Burger", "Krush Burger"], 9),
                            ("Hot Bun Sliders", ["Slider Stop"], 10),
                            ("Awani", ["Bait Maryam", "Al Safadi"], 11),
                            ("Zaroob", ["Allo Beirut", "Barbar"], 12),
                            ("Circle Cafe", ["LDC", "Jones the Grocer", "Parkers"], 13),
                            ("KFC", [], 14),
                        ]
                        for own_brand, competitors, order in initial_groups:
                            cur.execute("INSERT INTO brand_groups (own_brand, competitors, group_order) VALUES (%s, %s, %s)",
                                        (own_brand, competitors, order))
                        conn.commit()
                        logger.info(f"Initialized {len(initial_groups)} brand groups")
            if needs_recompute:
                import json as _json2
                logger.info("Recomputing vs_baseline and vs_previous for existing scrapes...")
                cur4 = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                cur4.execute("SELECT brand_name, items FROM baseline")
                baseline_map = {r["brand_name"]: r["items"] for r in cur4.fetchall()}
                cur4.execute("SELECT id, scrape_date, brand_name, items FROM scrapes ORDER BY brand_name")
                all_scrapes_list = cur4.fetchall()
                cur4.close()

                scrapes_by_brand = {}
                for s in all_scrapes_list:
                    scrapes_by_brand.setdefault(s["brand_name"], []).append(s)
                for brand_name, brand_scrapes in scrapes_by_brand.items():
                    brand_scrapes.sort(key=lambda x: parse_date_for_sorting(x["scrape_date"]))
                    bl_items = baseline_map.get(brand_name, {})
                    prev_items = bl_items
                    for s in brand_scrapes:
                        vs_bl = compare_items(bl_items, s["items"])
                        vs_prev = compare_items(prev_items, s["items"])
                        cur5 = conn.cursor()
                        cur5.execute("UPDATE scrapes SET vs_baseline = %s, vs_previous = %s WHERE id = %s",
                                     (_json2.dumps(vs_bl.model_dump()), _json2.dumps(vs_prev.model_dump()), s["id"]))
                        cur5.close()
                        prev_items = s["items"]
                conn.commit()
                logger.info("Recomputation complete")
            cur.close()
    except Exception as e:
        logger.error(f"Error initializing brand groups: {e}")

FRONTEND_BUILD = ROOT_DIR.parent / "frontend" / "build"
if FRONTEND_BUILD.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_BUILD / "static")), name="static")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = FRONTEND_BUILD / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_BUILD / "index.html"))
