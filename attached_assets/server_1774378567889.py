from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Optional, Any, Union
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================
# Helper: extract price from either old or new item format
# ============================================================
def get_price(item_data) -> float:
    """Extract price from either old format (float) or new format (dict with 'price' key)"""
    if isinstance(item_data, dict):
        return float(item_data.get("price", 0))
    return float(item_data)

def get_item_detail(item_data) -> dict:
    """Normalize item data to full detail dict"""
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

# ============================================================
# Models
# ============================================================
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

# ============================================================
# Helper functions
# ============================================================
def compare_items(baseline_items: Dict[str, Any], scrape_items: Dict[str, Any]) -> ComparisonStats:
    """Compare items - works with both old (float) and new (dict) format"""
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
    """Parse date string like '6-Mar-26' or '24-Feb-26' to datetime for sorting"""
    try:
        return datetime.strptime(date_str, "%d-%b-%y")
    except:
        return datetime.now(timezone.utc)

# ============================================================
# Routes
# ============================================================
@api_router.get("/")
async def root():
    return {"message": "Menu Price Tracker API"}

@api_router.post("/baseline")
async def upload_baseline(data: BaselineUpload):
    """Upload or update baseline data - supports enriched item format"""
    try:
        await db.baseline.delete_many({})
        
        baseline_docs = []
        for brand_name, items in data.brands.items():
            baseline_docs.append({
                "brand_name": brand_name,
                "items": items,
                "baseline_date": data.baseline_date,
                "updated_at": datetime.now(timezone.utc).isoformat()
            })
        
        if baseline_docs:
            await db.baseline.insert_many(baseline_docs)
        
        return {
            "success": True,
            "brands_count": len(baseline_docs),
            "items_count": sum(len(items) for items in data.brands.values())
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/baseline")
async def get_baseline():
    """Get current baseline data"""
    try:
        baseline_docs = await db.baseline.find({}, {"_id": 0}).to_list(1000)
        
        if not baseline_docs:
            return {"exists": False, "brands": {}}
        
        brands = {}
        baseline_date = baseline_docs[0].get("baseline_date", "24-Feb-25")
        
        for doc in baseline_docs:
            brands[doc["brand_name"]] = doc["items"]
        
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
    """Upload daily scrape data and calculate comparisons - supports enriched format"""
    try:
        brand_groups = await db.brand_groups.find({}, {"_id": 0}).to_list(1000)
        own_brands = [group["own_brand"] for group in brand_groups]
        
        baseline_docs = await db.baseline.find({}, {"_id": 0}).to_list(1000)
        baseline = {doc["brand_name"]: doc["items"] for doc in baseline_docs}
        
        existing_scrapes = await db.scrapes.find(
            {"scrape_date": {"$ne": data.scrape_date}},
            {"_id": 0}
        ).to_list(10000)
        
        previous_by_brand = {}
        if existing_scrapes:
            all_dates = list(set(scrape["scrape_date"] for scrape in existing_scrapes))
            sorted_dates = sorted(all_dates, key=parse_date_for_sorting)
            
            current_date_obj = parse_date_for_sorting(data.scrape_date)
            previous_dates = [d for d in sorted_dates if parse_date_for_sorting(d) < current_date_obj]
            
            if previous_dates:
                most_recent_previous = previous_dates[-1]
                for scrape in existing_scrapes:
                    if scrape["scrape_date"] == most_recent_previous:
                        previous_by_brand[scrape["brand_name"]] = scrape["items"]
        
        await db.scrapes.delete_many({"scrape_date": data.scrape_date})
        
        new_baselines = []
        scrape_docs = []
        comparison_data = {}
        
        for brand_name, items in data.brands.items():
            baseline_items = baseline.get(brand_name, {})
            
            if not baseline_items:
                new_baselines.append({
                    "brand_name": brand_name,
                    "items": items,
                    "baseline_date": data.scrape_date,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                })
                baseline_items = items
            
            previous_items = previous_by_brand.get(brand_name, {})
            
            vs_baseline = compare_items(baseline_items, items)
            vs_previous = compare_items(previous_items, items) if previous_items else None
            
            scrape_doc = {
                "scrape_date": data.scrape_date,
                "brand_name": brand_name,
                "items": items,
                "vs_baseline": vs_baseline.model_dump(),
                "vs_previous": vs_previous.model_dump() if vs_previous else None,
                "uploaded_at": datetime.now(timezone.utc).isoformat()
            }
            scrape_docs.append(scrape_doc)
            
            comparison_data[brand_name] = {
                "vs_baseline": vs_baseline.model_dump(),
                "is_own_brand": brand_name in own_brands
            }
        
        if new_baselines:
            await db.baseline.insert_many(new_baselines)
        
        if scrape_docs:
            await db.scrapes.insert_many(scrape_docs)
        
        ai_summary = None
        if not data.set_as_baseline:
            ai_summary = await generate_ai_summary(data.scrape_date, comparison_data)
            if ai_summary:
                await db.scrapes.update_many(
                    {"scrape_date": data.scrape_date},
                    {"$set": {"ai_summary": ai_summary}}
                )
        
        if data.set_as_baseline:
            await db.baseline.delete_many({})
            baseline_docs = []
            for brand_name, items in data.brands.items():
                baseline_docs.append({
                    "brand_name": brand_name,
                    "items": items,
                    "baseline_date": data.scrape_date,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                })
            if baseline_docs:
                await db.baseline.insert_many(baseline_docs)
        
        return {
            "success": True,
            "scrape_date": data.scrape_date,
            "brands_count": len(scrape_docs),
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
    """Get dashboard summary with all historical data"""
    try:
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        
        if not all_scrapes:
            return {
                "has_data": False,
                "latest_date": None,
                "previous_date": None,
                "brands": []
            }
        
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
                "vs_previous": scrape.get("vs_previous"),
                "ai_summary": scrape.get("ai_summary")
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
    """Get day-wise history for a specific brand"""
    try:
        scrapes = await db.scrapes.find(
            {"brand_name": brand_name},
            {"_id": 0}
        ).to_list(1000)
        
        scrapes.sort(key=lambda x: parse_date_for_sorting(x["scrape_date"]))
        
        history = []
        for scrape in scrapes:
            vs_baseline = scrape["vs_baseline"]
            vs_previous = scrape.get("vs_previous")
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
        
        return {
            "brand_name": brand_name,
            "history": history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/items/{brand_name}")
async def get_items_history(brand_name: str):
    """Get item-wise price history for a brand"""
    try:
        baseline_doc = await db.baseline.find_one(
            {"brand_name": brand_name},
            {"_id": 0}
        )
        
        baseline_items = baseline_doc["items"] if baseline_doc else {}
        baseline_date = baseline_doc.get("baseline_date", "24-Feb-25") if baseline_doc else "24-Feb-25"
        
        scrapes = await db.scrapes.find(
            {"brand_name": brand_name},
            {"_id": 0}
        ).to_list(1000)
        
        scrapes.sort(key=lambda x: parse_date_for_sorting(x["scrape_date"]))
        
        all_items = set(baseline_items.keys())
        for scrape in scrapes:
            all_items.update(scrape["items"].keys())
        
        items_history = []
        for item_name in sorted(all_items):
            baseline_data = baseline_items.get(item_name)
            baseline_price = get_price(baseline_data) if baseline_data is not None else None
            
            price_history = [{"date": baseline_date, "price": baseline_price}]
            
            for scrape in scrapes:
                item_data = scrape["items"].get(item_name)
                price = get_price(item_data) if item_data is not None else None
                price_history.append({
                    "date": scrape["scrape_date"],
                    "price": price
                })
            
            items_history.append({
                "item_name": item_name,
                "baseline_price": baseline_price,
                "history": price_history
            })
        
        return {
            "brand_name": brand_name,
            "baseline_date": baseline_date,
            "items": items_history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/compare/{target_date}")
async def compare_with_date(target_date: str):
    """Compare latest scrape data against a specific target date for all brands"""
    try:
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        
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
                brands_comparison.append({
                    "brand_name": brand_name,
                    "stats": stats.model_dump()
                })
            elif latest_items:
                brands_comparison.append({
                    "brand_name": brand_name,
                    "stats": {"price_up": 0, "price_down": 0, "new_items": len(latest_items), "removed": 0, "no_change": 0, "total": len(latest_items), "change_percent": 0}
                })
        
        return {
            "latest_date": latest_date,
            "target_date": target_date,
            "brands": brands_comparison
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/all-history")
async def get_all_history():
    """Get date-by-date summary across all own brands"""
    try:
        brand_groups = await db.brand_groups.find({}, {"_id": 0}).to_list(1000)
        own_brands = [group["own_brand"] for group in brand_groups]
        
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        
        if not all_scrapes:
            return {
                "dates_summary": [],
                "latest_date": None,
                "total_brands": 0,
                "own_brands_count": len(own_brands)
            }
        
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
                "date": date,
                "brands_count": len(own_data),
                "total_price_up": total_price_up,
                "total_price_down": total_price_down,
                "total_new_items": total_new_items,
                "total_removed": total_removed,
                "total_no_change": total_no_change,
                "total_items": total_items
            })
        
        latest_date = sorted(dates_data.keys(), key=parse_date_for_sorting, reverse=True)[0] if dates_data else None
        
        return {
            "dates_summary": dates_summary,
            "latest_date": latest_date,
            "total_brands": len(set(brand for date_data in dates_data.values() for brand in date_data["brands"].keys())),
            "own_brands_count": len(own_brands)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# NPD (New Product Development) Tracker
# ============================================================
@api_router.get("/npd")
async def get_npd(target_date: str = None):
    """Get new and removed items. Compares target_date vs its previous date. Defaults to latest."""
    try:
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        
        if not all_scrapes:
            return {"has_data": False, "latest_date": None, "previous_date": None, "brands": [], "available_dates": []}
        
        # All available dates sorted
        dates = sorted(set(s["scrape_date"] for s in all_scrapes), key=parse_date_for_sorting)
        
        if len(dates) < 2:
            return {"has_data": False, "latest_date": dates[0] if dates else None, "previous_date": None, "brands": [], "available_dates": dates, "message": "Need at least 2 scrape dates for NPD comparison"}
        
        # Determine which date to compare
        if target_date and target_date in dates:
            selected_date = target_date
            selected_idx = dates.index(target_date)
            if selected_idx == 0:
                return {"has_data": False, "latest_date": selected_date, "previous_date": None, "brands": [], "available_dates": dates, "message": "No previous date to compare against for this date"}
            compare_date = dates[selected_idx - 1]
        else:
            selected_date = dates[-1]
            compare_date = dates[-2]
        
        # Group by brand for both dates
        selected_by_brand = {}
        compare_by_brand = {}
        
        for scrape in all_scrapes:
            if scrape["scrape_date"] == selected_date:
                selected_by_brand[scrape["brand_name"]] = scrape["items"]
            elif scrape["scrape_date"] == compare_date:
                compare_by_brand[scrape["brand_name"]] = scrape["items"]
        
        # Get brand groups to identify own brands
        brand_groups = await db.brand_groups.find({}, {"_id": 0}).to_list(1000)
        own_brands = [group["own_brand"] for group in brand_groups]
        
        # Compare and build NPD data
        brands_npd = []
        all_brand_names = set(list(selected_by_brand.keys()) + list(compare_by_brand.keys()))
        
        for brand_name in sorted(all_brand_names):
            selected_items = selected_by_brand.get(brand_name, {})
            compare_items_data = compare_by_brand.get(brand_name, {})
            
            selected_keys = set(selected_items.keys())
            compare_keys = set(compare_items_data.keys())
            
            new_item_names = selected_keys - compare_keys
            removed_item_names = compare_keys - selected_keys
            
            if not new_item_names and not removed_item_names:
                continue
            
            new_items = []
            for name in sorted(new_item_names):
                detail = get_item_detail(selected_items[name])
                detail["item_name"] = name
                new_items.append(detail)
            
            removed_items = []
            for name in sorted(removed_item_names):
                detail = get_item_detail(compare_items_data[name])
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
            "latest_date": selected_date,
            "previous_date": compare_date,
            "brands": brands_npd,
            "total_new": sum(b["new_count"] for b in brands_npd),
            "total_removed": sum(b["removed_count"] for b in brands_npd),
            "brands_with_changes": len(brands_npd),
            "available_dates": dates,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/npd-ai-summary")
async def get_npd_ai_summary(target_date: str = None):
    """Generate AI summary for NPD data. Compares target_date vs its previous date."""
    try:
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        
        if not all_scrapes:
            raise HTTPException(status_code=404, detail="No scrape data found")
        
        dates = sorted(set(s["scrape_date"] for s in all_scrapes), key=parse_date_for_sorting)
        if len(dates) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 scrape dates")
        
        if target_date and target_date in dates:
            selected_date = target_date
            selected_idx = dates.index(target_date)
            if selected_idx == 0:
                raise HTTPException(status_code=400, detail="No previous date to compare against")
            compare_date = dates[selected_idx - 1]
        else:
            selected_date = dates[-1]
            compare_date = dates[-2]
        
        # Check cache
        cached = await db.npd_summaries.find_one(
            {"latest_date": selected_date, "previous_date": compare_date},
            {"_id": 0}
        )
        if cached:
            return {"success": True, "summary": cached["summary"], "latest_date": selected_date, "previous_date": compare_date, "cached": True}
        
        # Get NPD data
        selected_by_brand = {}
        compare_by_brand = {}
        
        for scrape in all_scrapes:
            if scrape["scrape_date"] == selected_date:
                selected_by_brand[scrape["brand_name"]] = scrape["items"]
            elif scrape["scrape_date"] == compare_date:
                compare_by_brand[scrape["brand_name"]] = scrape["items"]
        
        brand_groups = await db.brand_groups.find({}, {"_id": 0}).to_list(1000)
        own_brands = [group["own_brand"] for group in brand_groups]
        
        # Build summary data for AI
        npd_data = []
        for brand_name in set(list(selected_by_brand.keys()) + list(compare_by_brand.keys())):
            sel_items = selected_by_brand.get(brand_name, {})
            cmp_items = compare_by_brand.get(brand_name, {})
            
            new_names = set(sel_items.keys()) - set(cmp_items.keys())
            removed_names = set(cmp_items.keys()) - set(sel_items.keys())
            
            if not new_names and not removed_names:
                continue
            
            new_details = []
            for name in new_names:
                detail = get_item_detail(sel_items[name])
                new_details.append({
                    "name": name,
                    "price": detail["price"],
                    "category": detail.get("category", ""),
                    "description": detail.get("description", "")[:100]
                })
            
            removed_details = [{"name": name, "price": get_price(cmp_items[name])} for name in removed_names]
            
            npd_data.append({
                "brand": brand_name,
                "is_own_brand": brand_name in own_brands,
                "new_items": new_details,
                "removed_items": removed_details
            })
        
        if not npd_data:
            return {"success": True, "summary": "No new product changes detected between the two dates.", "latest_date": selected_date, "previous_date": compare_date}
        
        # Generate AI summary
        summary = await generate_npd_ai_summary(selected_date, compare_date, npd_data)
        
        if summary:
            # Cache it
            await db.npd_summaries.insert_one({
                "latest_date": selected_date,
                "previous_date": compare_date,
                "summary": summary,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
            return {"success": True, "summary": summary, "latest_date": selected_date, "previous_date": compare_date, "cached": False}
        else:
            raise HTTPException(status_code=500, detail="Failed to generate AI summary")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/npd-ai-summary/regenerate")
async def regenerate_npd_ai_summary_endpoint(target_date: str = None):
    """Force regenerate NPD AI summary"""
    try:
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        dates = sorted(set(s["scrape_date"] for s in all_scrapes), key=parse_date_for_sorting)
        
        if len(dates) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 scrape dates")
        
        if target_date and target_date in dates:
            selected_date = target_date
            selected_idx = dates.index(target_date)
            if selected_idx == 0:
                raise HTTPException(status_code=400, detail="No previous date")
            compare_date = dates[selected_idx - 1]
        else:
            selected_date = dates[-1]
            compare_date = dates[-2]
        
        # Delete cached
        await db.npd_summaries.delete_many({"latest_date": selected_date, "previous_date": compare_date})
        
        # Re-call the get endpoint which will regenerate
        return await get_npd_ai_summary(target_date=selected_date)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# AI Summary Generation
# ============================================================
async def generate_ai_summary(scrape_date: str, comparison_data: dict) -> str:
    """Generate AI summary using Claude API"""
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

Write in plain text only — no markdown, asterisks, bold, or headers. Keep it professional and data-driven."""

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
    """Generate AI summary specifically for NPD (new product) data"""
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

# ============================================================
# Maintenance Routes
# ============================================================
@api_router.post("/fix-dates")
async def fix_dates():
    """Fix date formats in database"""
    try:
        date_mapping = {
            "11 mar": "11-Mar-26",
            "6 Mar": "6-Mar-26",
            "9 Mar": "9-Mar-26"
        }
        
        for old_date, new_date in date_mapping.items():
            result = await db.scrapes.update_many(
                {"scrape_date": old_date},
                {"$set": {"scrape_date": new_date}}
            )
        
        baseline_result = await db.baseline.update_many(
            {"baseline_date": "24-Feb-25"},
            {"$set": {"baseline_date": "24-Feb-26"}}
        )
        
        return {"success": True, "message": "Dates updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/scrape/{scrape_date}")
async def delete_scrape_date(scrape_date: str):
    """Delete all scrapes for a specific date"""
    try:
        result = await db.scrapes.delete_many({"scrape_date": scrape_date})
        return {"success": True, "message": f"Deleted scrapes for {scrape_date}", "deleted_count": result.deleted_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/fix-brand-data")
async def fix_brand_data():
    """Fix Mandarin Oak data by copying from baseline"""
    try:
        baseline_doc = await db.baseline.find_one({"brand_name": "Mandarin Oak"}, {"_id": 0})
        if not baseline_doc:
            raise HTTPException(status_code=404, detail="Mandarin Oak not found in baseline")
        
        baseline_items = baseline_doc["items"]
        dates_to_fix = ["6-Mar-26", "9-Mar-26", "11-Mar-26"]
        
        updated_count = 0
        for scrape_date in dates_to_fix:
            result = await db.scrapes.update_one(
                {"scrape_date": scrape_date, "brand_name": "Mandarin Oak"},
                {"$set": {
                    "items": baseline_items,
                    "vs_baseline": {
                        "price_up": 0, "price_down": 0, "new_items": 0,
                        "removed": 0, "no_change": len(baseline_items),
                        "total": len(baseline_items), "change_percent": 0.0
                    }
                }}
            )
            if result.modified_count > 0:
                updated_count += 1
        
        return {"success": True, "message": "Mandarin Oak data fixed", "dates_updated": updated_count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class NewBrandsData(BaseModel):
    brands: Dict[str, Dict[str, Any]]

@api_router.post("/add-new-brands")
async def add_new_brands(data: NewBrandsData):
    """Add new brands to baseline and all existing scrapes"""
    try:
        baseline_date = "24-Feb-26"
        dates_to_update = ["6-Mar-26", "9-Mar-26", "11-Mar-26"]
        
        baseline_docs = []
        for brand_name, items in data.brands.items():
            baseline_docs.append({
                "brand_name": brand_name,
                "items": items,
                "baseline_date": baseline_date,
                "updated_at": datetime.now(timezone.utc).isoformat()
            })
        
        if baseline_docs:
            await db.baseline.insert_many(baseline_docs)
        
        scrapes_added = 0
        for brand_name, items in data.brands.items():
            for scrape_date in dates_to_update:
                scrape_doc = {
                    "scrape_date": scrape_date,
                    "brand_name": brand_name,
                    "items": items,
                    "vs_baseline": {
                        "price_up": 0, "price_down": 0, "new_items": 0,
                        "removed": 0, "no_change": len(items),
                        "total": len(items), "change_percent": 0.0
                    },
                    "vs_previous": None,
                    "uploaded_at": datetime.now(timezone.utc).isoformat()
                }
                await db.scrapes.insert_one(scrape_doc)
                scrapes_added += 1
        
        return {"success": True, "message": "New brands added", "baseline_brands_added": len(data.brands), "scrapes_added": scrapes_added}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# Brand Groups CRUD
# ============================================================
@api_router.get("/brand-groups")
async def get_brand_groups():
    """Get all brand groups sorted by group_order"""
    try:
        groups = await db.brand_groups.find({}, {"_id": 0}).sort("group_order", 1).to_list(1000)
        return {"brand_groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/brand-groups")
async def create_brand_group(group: BrandGroupCreate):
    try:
        group_doc = group.model_dump()
        await db.brand_groups.insert_one(group_doc)
        return {"success": True, "message": "Brand group created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.put("/brand-groups/{own_brand}")
async def update_brand_group(own_brand: str, update: BrandGroupUpdate):
    try:
        update_data = {k: v for k, v in update.model_dump().items() if v is not None}
        if not update_data:
            raise HTTPException(status_code=400, detail="No update data provided")
        
        result = await db.brand_groups.update_one({"own_brand": own_brand}, {"$set": update_data})
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Brand group not found")
        
        return {"success": True, "message": "Brand group updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.delete("/brand-groups/{own_brand}")
async def delete_brand_group(own_brand: str):
    try:
        result = await db.brand_groups.delete_one({"own_brand": own_brand})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Brand group not found")
        return {"success": True, "message": "Brand group deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/regenerate-summary/{scrape_date}")
async def regenerate_summary(scrape_date: str):
    """Regenerate AI summary for a specific date"""
    try:
        scrapes = await db.scrapes.find({"scrape_date": scrape_date}, {"_id": 0}).to_list(1000)
        if not scrapes:
            raise HTTPException(status_code=404, detail="No data found for this date")
        
        brand_groups = await db.brand_groups.find({}, {"_id": 0}).to_list(1000)
        own_brands = [group["own_brand"] for group in brand_groups]
        
        comparison_data = {}
        for scrape in scrapes:
            comparison_data[scrape["brand_name"]] = {
                "vs_baseline": scrape["vs_baseline"],
                "is_own_brand": scrape["brand_name"] in own_brands
            }
        
        ai_summary = await generate_ai_summary(scrape_date, comparison_data)
        
        if ai_summary:
            await db.scrapes.update_many(
                {"scrape_date": scrape_date},
                {"$set": {"ai_summary": ai_summary}}
            )
            return {"success": True, "summary": ai_summary}
        else:
            raise HTTPException(status_code=500, detail="Failed to generate summary")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# App Setup
# ============================================================
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
    """Initialize brand groups on startup if collection is empty"""
    try:
        count = await db.brand_groups.count_documents({})
        if count == 0:
            initial_groups = [
                {"own_brand": "Operational Falafel", "competitors": ["Zaatar w Zeit", "Aloo Beirut"], "group_order": 1},
                {"own_brand": "Sushi DO", "competitors": ["Sushi Buzz", "Sushi Art"], "group_order": 2},
                {"own_brand": "Right Bite", "competitors": ["The 500 Calorie Project", "Kcal"], "group_order": 3},
                {"own_brand": "Chin Chin", "competitors": ["Mandarin Oak", "China Bistro"], "group_order": 4},
                {"own_brand": "Taqado", "competitors": ["Tortilla", "Chipotle"], "group_order": 5},
                {"own_brand": "Pizzaro", "competitors": ["Pizza di Rocco", "Oregano", "Pizza Hut"], "group_order": 6},
                {"own_brand": "Biryani Pot", "competitors": ["Gazebo", "Art of Dum"], "group_order": 7},
                {"own_brand": "Luca", "competitors": ["Pasta Della Nonna", "The Pasta Cup"], "group_order": 8},
                {"own_brand": "High Joint", "competitors": ["Just Burger", "Krush Burger"], "group_order": 9},
                {"own_brand": "Hot Bun Sliders", "competitors": ["Slider Stop"], "group_order": 10},
                {"own_brand": "Awani", "competitors": ["Bait Maryam", "Al Safadi"], "group_order": 11},
                {"own_brand": "Zaroob", "competitors": ["Allo Beirut", "Barbar"], "group_order": 12},
                {"own_brand": "Circle Cafe", "competitors": ["LDC", "Jones the Grocer", "Parkers"], "group_order": 13},
                {"own_brand": "KFC", "competitors": [], "group_order": 14},
            ]
            await db.brand_groups.insert_many(initial_groups)
            logger.info(f"Initialized {len(initial_groups)} brand groups")
    except Exception as e:
        logger.error(f"Error initializing brand groups: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
