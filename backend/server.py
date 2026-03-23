from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File
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

class BaselineData(BaseModel):
    brand_name: str
    items: Dict[str, float]
    baseline_date: str = "24-Feb-25"
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BaselineUpload(BaseModel):
    brands: Dict[str, Dict[str, float]]
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
    items: Dict[str, float]
    vs_baseline: ComparisonStats
    vs_previous: Optional[ComparisonStats] = None
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ScrapeUpload(BaseModel):
    scrape_date: str
    brands: Dict[str, Dict[str, float]]
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
    brands: Dict[str, Dict[str, float]]

def compare_items(baseline_items: Dict[str, float], scrape_items: Dict[str, float]) -> ComparisonStats:
    stats = ComparisonStats()
    baseline_keys = set(baseline_items.keys())
    scrape_keys = set(scrape_items.keys())
    for item_name in scrape_keys:
        scrape_price = scrape_items[item_name]
        baseline_price = baseline_items.get(item_name)
        if baseline_price is None:
            stats.new_items += 1
        else:
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
            baseline_price = baseline_items.get(item_name)
            price_history = [{"date": baseline_date, "price": baseline_price}]
            for scrape in scrapes:
                price = scrape["items"].get(item_name)
                price_history.append({"date": scrape["scrape_date"], "price": price})
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
            cur.execute("SELECT COUNT(*) FROM brand_groups")
            count = cur.fetchone()[0]
            if count == 0:
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
                    cur.execute(
                        "INSERT INTO brand_groups (own_brand, competitors, group_order) VALUES (%s, %s, %s)",
                        (own_brand, competitors, order)
                    )
                logger.info(f"Initialized {len(initial_groups)} brand groups")
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
