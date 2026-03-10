from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Optional, Any
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

# Models
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

# Helper functions
def compare_items(baseline_items: Dict[str, float], scrape_items: Dict[str, float]) -> ComparisonStats:
    stats = ComparisonStats()
    
    baseline_keys = set(baseline_items.keys())
    scrape_keys = set(scrape_items.keys())
    
    # Check items in scrape
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
    
    # Check removed items
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
        # Fallback for unexpected formats
        return datetime.now(timezone.utc)

# Routes
@api_router.get("/")
async def root():
    return {"message": "Menu Price Tracker API"}

@api_router.post("/baseline")
async def upload_baseline(data: BaselineUpload):
    """Upload or update baseline data"""
    try:
        # Clear existing baseline
        await db.baseline.delete_many({})
        
        # Insert new baseline data
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
    """Upload daily scrape data and calculate comparisons"""
    try:
        # Get baseline data
        baseline_docs = await db.baseline.find({}, {"_id": 0}).to_list(1000)
        if not baseline_docs:
            raise HTTPException(status_code=400, detail="Baseline data not found. Please upload master file first.")
        
        baseline = {doc["brand_name"]: doc["items"] for doc in baseline_docs}
        
        # Get all existing scrape dates (excluding current date)
        existing_scrapes = await db.scrapes.find(
            {"scrape_date": {"$ne": data.scrape_date}},
            {"_id": 0}
        ).to_list(10000)
        
        # Find the most recent previous date
        previous_by_brand = {}
        if existing_scrapes:
            # Get all unique dates
            all_dates = list(set(scrape["scrape_date"] for scrape in existing_scrapes))
            # Sort chronologically and get the most recent one before current upload
            sorted_dates = sorted(all_dates, key=parse_date_for_sorting)
            
            # Get the latest previous date
            current_date_obj = parse_date_for_sorting(data.scrape_date)
            previous_dates = [d for d in sorted_dates if parse_date_for_sorting(d) < current_date_obj]
            
            if previous_dates:
                most_recent_previous = previous_dates[-1]  # Last date before current
                
                # Get scrapes for that date
                for scrape in existing_scrapes:
                    if scrape["scrape_date"] == most_recent_previous:
                        previous_by_brand[scrape["brand_name"]] = scrape["items"]
        
        # Delete existing scrapes for this date
        await db.scrapes.delete_many({"scrape_date": data.scrape_date})
        
        # Process and store scrapes
        scrape_docs = []
        for brand_name, items in data.brands.items():
            baseline_items = baseline.get(brand_name, {})
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
        
        if scrape_docs:
            await db.scrapes.insert_many(scrape_docs)
        
        # Update baseline if requested
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
            "baseline_updated": data.set_as_baseline
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/dashboard")
async def get_dashboard():
    """Get dashboard summary with all historical data"""
    try:
        # Get all scrapes
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        
        if not all_scrapes:
            return {
                "has_data": False,
                "latest_date": None,
                "previous_date": None,
                "brands": []
            }
        
        # Group by brand and date
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
                "vs_previous": scrape.get("vs_previous")
            }
        
        # Sort dates chronologically
        sorted_dates = sorted(dates, key=parse_date_for_sorting)
        latest_date = sorted_dates[-1] if sorted_dates else None
        previous_date = sorted_dates[-2] if len(sorted_dates) > 1 else None
        
        # Build response
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
        ).sort("scrape_date", 1).to_list(1000)
        
        history = []
        for scrape in scrapes:
            vs_baseline = scrape["vs_baseline"]
            history.append({
                "date": scrape["scrape_date"],
                "price_up": vs_baseline["price_up"],
                "price_down": vs_baseline["price_down"],
                "new_items": vs_baseline["new_items"],
                "removed": vs_baseline["removed"],
                "no_change": vs_baseline["no_change"],
                "total": vs_baseline["total"],
                "change_percent": vs_baseline["change_percent"]
            })
        
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
        # Get baseline
        baseline_doc = await db.baseline.find_one(
            {"brand_name": brand_name},
            {"_id": 0}
        )
        
        baseline_items = baseline_doc["items"] if baseline_doc else {}
        baseline_date = baseline_doc.get("baseline_date", "24-Feb-25") if baseline_doc else "24-Feb-25"
        
        # Get all scrapes for this brand
        scrapes = await db.scrapes.find(
            {"brand_name": brand_name},
            {"_id": 0}
        ).sort("scrape_date", 1).to_list(1000)
        
        # Build item history
        all_items = set(baseline_items.keys())
        for scrape in scrapes:
            all_items.update(scrape["items"].keys())
        
        items_history = []
        for item_name in sorted(all_items):
            baseline_price = baseline_items.get(item_name)
            
            price_history = [{"date": baseline_date, "price": baseline_price}]
            
            for scrape in scrapes:
                price = scrape["items"].get(item_name)
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

@api_router.get("/all-history")
async def get_all_history():
    """Get date-by-date summary across all own brands"""
    try:
        # Define own brands
        own_brands = [
            'Operational Falafel', 'Sushi DO', 'Right Bite', 'Chin Chin',
            'Taqado', 'Pizzaro', 'Biryani Pot', 'Luca', 'High Joint',
            'Hot Bun Sliders', 'Awani', 'Zaroob', 'Circle Cafe'
        ]
        
        # Get all scrapes
        all_scrapes = await db.scrapes.find({}, {"_id": 0}).to_list(10000)
        
        if not all_scrapes:
            return {
                "dates_summary": [],
                "latest_date": None,
                "total_brands": 0,
                "own_brands_count": len(own_brands)
            }
        
        # Group by date
        dates_data = {}
        for scrape in all_scrapes:
            date = scrape["scrape_date"]
            brand = scrape["brand_name"]
            
            if date not in dates_data:
                dates_data[date] = {"brands": {}, "own_brands_only": {}}
            
            dates_data[date]["brands"][brand] = scrape["vs_baseline"]
            
            if brand in own_brands:
                dates_data[date]["own_brands_only"][brand] = scrape["vs_baseline"]
        
        # Calculate summary for each date (own brands only)
        dates_summary = []
        for date in sorted(dates_data.keys(), key=parse_date_for_sorting):  # Chronological order with proper date parsing
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
        
        latest_date = sorted(dates_data.keys(), reverse=True)[0] if dates_data else None
        
        return {
            "dates_summary": dates_summary,  # Already in chronological order
            "latest_date": latest_date,
            "total_brands": len(set(brand for date_data in dates_data.values() for brand in date_data["brands"].keys())),
            "own_brands_count": len(own_brands)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/fix-dates")
async def fix_dates():
    """Fix date formats in database"""
    try:
        # Map old dates to new dates
        date_mapping = {
            "11 mar": "11-Mar-26",
            "6 Mar": "6-Mar-26",
            "9 Mar": "9-Mar-26"
        }
        
        # Update scrapes collection
        for old_date, new_date in date_mapping.items():
            result = await db.scrapes.update_many(
                {"scrape_date": old_date},
                {"$set": {"scrape_date": new_date}}
            )
            print(f"Updated {result.modified_count} scrapes from '{old_date}' to '{new_date}'")
        
        # Update baseline date
        baseline_result = await db.baseline.update_many(
            {"baseline_date": "24-Feb-25"},
            {"$set": {"baseline_date": "24-Feb-26"}}
        )
        print(f"Updated {baseline_result.modified_count} baseline records")
        
        return {
            "success": True,
            "message": "Dates updated successfully",
            "updates": {
                "scrapes": sum(1 for _ in date_mapping),
                "baseline": baseline_result.modified_count
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
