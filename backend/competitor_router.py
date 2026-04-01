from fastapi import APIRouter, HTTPException
import psycopg2
import psycopg2.extras
import os
import json
import logging
import hashlib
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from contextlib import contextmanager

logger = logging.getLogger(__name__)
competitor_router = APIRouter(prefix="/api/competitor")

DATABASE_URL = os.environ.get('DATABASE_URL')


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


def ensure_competitor_tables():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS competitor_item_matches (
                    id SERIAL PRIMARY KEY,
                    own_brand TEXT NOT NULL,
                    own_item_name TEXT NOT NULL,
                    competitor_brand TEXT NOT NULL,
                    matched_item_name TEXT NOT NULL,
                    match_confidence REAL DEFAULT 0,
                    data_hash TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(own_brand, own_item_name, competitor_brand, data_hash)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS competitor_price_analysis (
                    id SERIAL PRIMARY KEY,
                    data_hash TEXT UNIQUE NOT NULL,
                    analysis_text TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_comp_match_own ON competitor_item_matches(own_brand, own_item_name)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_comp_match_hash ON competitor_item_matches(data_hash)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_comp_analysis_hash ON competitor_price_analysis(data_hash)")
            cur.close()
    except Exception as e:
        logger.error(f"Error creating competitor tables: {e}")


ensure_competitor_tables()


def compute_data_hash(data: Any) -> str:
    serialized = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode()).hexdigest()[:32]


def _parse_date_for_sorting(date_str: str) -> datetime:
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return datetime.min


def get_all_scrape_dates(country: str = "UAE") -> list:
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT scrape_date FROM scrapes WHERE country = %s", (country,))
        rows = cur.fetchall()
        cur.close()
        if not rows:
            return []
        dates = [r[0] for r in rows]
        dates.sort(key=_parse_date_for_sorting, reverse=True)
        return dates


def get_latest_scrape_date(country: str = "UAE") -> Optional[str]:
    dates = get_all_scrape_dates(country)
    return dates[0] if dates else None


def get_brand_items(brand_name: str, scrape_date: Optional[str] = None, country: str = "UAE") -> dict:
    with get_db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if scrape_date:
            cur.execute(
                "SELECT items FROM scrapes WHERE brand_name = %s AND scrape_date = %s AND country = %s ORDER BY uploaded_at DESC LIMIT 1",
                (brand_name, scrape_date, country)
            )
        else:
            cur.execute(
                "SELECT items FROM scrapes WHERE brand_name = %s AND country = %s ORDER BY uploaded_at DESC LIMIT 1",
                (brand_name, country)
            )
        row = cur.fetchone()
        cur.close()
        if row and row["items"]:
            return row["items"] if isinstance(row["items"], dict) else json.loads(row["items"])
        return {}


def get_competitors_for_brand(own_brand: str, country: str = "UAE") -> list:
    with get_db() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT competitors FROM brand_groups WHERE own_brand = %s AND country = %s", (own_brand, country))
        row = cur.fetchone()
        cur.close()
        if row and row["competitors"]:
            return list(row["competitors"])
        return []


def get_cached_matches(own_brand: str, own_item: str, data_hash: str) -> list:
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                "SELECT competitor_brand, matched_item_name, match_confidence FROM competitor_item_matches WHERE own_brand = %s AND own_item_name = %s AND data_hash = %s",
                (own_brand, own_item, data_hash)
            )
            rows = cur.fetchall()
            cur.close()
            return [dict(r) for r in rows]
    except:
        return []


def save_matches(own_brand: str, own_item: str, matches: list, data_hash: str):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM competitor_item_matches WHERE own_brand = %s AND own_item_name = %s",
                (own_brand, own_item)
            )
            if matches:
                for m in matches:
                    cur.execute(
                        "INSERT INTO competitor_item_matches (own_brand, own_item_name, competitor_brand, matched_item_name, match_confidence, data_hash) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                        (own_brand, own_item, m["competitor_brand"], m["matched_item_name"], m.get("match_confidence", 0), data_hash)
                    )
            else:
                cur.execute(
                    "INSERT INTO competitor_item_matches (own_brand, own_item_name, competitor_brand, matched_item_name, match_confidence, data_hash) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    (own_brand, own_item, "__NO_MATCH__", "__NO_MATCH__", 0.0, data_hash)
                )
            cur.close()
    except Exception as e:
        logger.error(f"Error saving matches: {e}")


def save_matches_bulk(own_brand: str, batch_items: list, batch_results: dict, data_hashes: dict):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            for it in batch_items:
                name = it["name"]
                matches = batch_results.get(name, [])
                dh = data_hashes.get(name, "")
                cur.execute("DELETE FROM competitor_item_matches WHERE own_brand = %s AND own_item_name = %s", (own_brand, name))
                if matches:
                    for m in matches:
                        cur.execute(
                            "INSERT INTO competitor_item_matches (own_brand, own_item_name, competitor_brand, matched_item_name, match_confidence, data_hash) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                            (own_brand, name, m["competitor_brand"], m["matched_item_name"], m.get("match_confidence", 0), dh)
                        )
                else:
                    cur.execute(
                        "INSERT INTO competitor_item_matches (own_brand, own_item_name, competitor_brand, matched_item_name, match_confidence, data_hash) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                        (own_brand, name, "__NO_MATCH__", "__NO_MATCH__", 0.0, dh)
                    )
            cur.close()
    except Exception as e:
        logger.error(f"Error saving bulk matches: {e}")


def get_cached_analysis(data_hash: str) -> Optional[str]:
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT analysis_text FROM competitor_price_analysis WHERE data_hash = %s LIMIT 1", (data_hash,))
            row = cur.fetchone()
            cur.close()
            return row["analysis_text"] if row else None
    except:
        return None


def save_analysis(data_hash: str, analysis_text: str):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO competitor_price_analysis (data_hash, analysis_text, created_at) VALUES (%s, %s, %s) ON CONFLICT (data_hash) DO UPDATE SET analysis_text = EXCLUDED.analysis_text, created_at = EXCLUDED.created_at",
                (data_hash, analysis_text, datetime.now(timezone.utc))
            )
            cur.close()
    except Exception as e:
        logger.error(f"Error saving analysis: {e}")


async def call_claude(prompt: str, max_tokens: int = 800, retries: int = 3) -> Optional[str]:
    try:
        import httpx
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set")
            return None

        async with httpx.AsyncClient() as client:
            for attempt in range(retries):
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json"
                    },
                    json={
                        "model": "claude-sonnet-4-20250514",
                        "max_tokens": max_tokens,
                        "messages": [{"role": "user", "content": prompt}]
                    },
                    timeout=60.0
                )
                if response.status_code == 200:
                    return response.json()["content"][0]["text"]
                elif response.status_code == 429:
                    wait = (attempt + 1) * 3
                    logger.warning(f"Claude rate limited, retrying in {wait}s (attempt {attempt+1}/{retries})")
                    await asyncio.sleep(wait)
                else:
                    logger.error(f"Claude API error: {response.status_code}")
                    return None
            logger.error("Claude API: exhausted retries after rate limiting")
            return None
    except Exception as e:
        logger.error(f"Claude API call failed: {e}")
        return None


def safe_float(val, default=0.0) -> float:
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def get_item_price(item_data) -> float:
    if isinstance(item_data, dict):
        return safe_float(item_data.get("price", 0))
    return safe_float(item_data)


def get_item_detail(item_data) -> dict:
    if isinstance(item_data, dict):
        orig = item_data.get("original_price")
        return {
            "price": safe_float(item_data.get("price", 0)),
            "original_price": safe_float(orig) if orig is not None else None,
            "description": str(item_data.get("description", "")),
            "category": str(item_data.get("category", "")),
            "image_url": str(item_data.get("image_url", "")),
        }
    return {"price": safe_float(item_data), "original_price": None, "description": "", "category": "", "image_url": ""}


@competitor_router.get("/available-dates")
async def get_available_dates(country: str = "UAE"):
    try:
        dates = get_all_scrape_dates(country)
        return {"dates": dates}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@competitor_router.get("/brands")
async def get_own_brands(country: str = "UAE"):
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT own_brand, competitors FROM brand_groups WHERE country = %s ORDER BY group_order", (country,))
            rows = cur.fetchall()
            cur.close()
        brands = []
        for r in rows:
            brands.append({
                "own_brand": r["own_brand"],
                "competitors": list(r["competitors"]) if r["competitors"] else []
            })
        return {"brands": brands}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@competitor_router.get("/items/{own_brand}")
async def get_own_brand_items(own_brand: str, country: str = "UAE", scrape_date: str = None):
    try:
        target_date = scrape_date or get_latest_scrape_date(country)
        if not target_date:
            return {"items": [], "scrape_date": None}

        items = get_brand_items(own_brand, target_date, country)
        item_list = []
        for name, data in sorted(items.items()):
            detail = get_item_detail(data)
            item_list.append({
                "item_name": name,
                **detail
            })
        return {"items": item_list, "scrape_date": target_date}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@competitor_router.get("/match/{own_brand}/{item_name:path}")
async def match_competitor_items(own_brand: str, item_name: str, country: str = "UAE", scrape_date: str = None):
    try:
        latest_date = scrape_date or get_latest_scrape_date(country)
        if not latest_date:
            raise HTTPException(status_code=404, detail="No scrape data available")

        own_items = get_brand_items(own_brand, latest_date, country)
        if item_name not in own_items:
            raise HTTPException(status_code=404, detail=f"Item '{item_name}' not found for {own_brand}")

        own_detail = get_item_detail(own_items[item_name])
        competitors = get_competitors_for_brand(own_brand, country)
        if not competitors:
            return {
                "own_item": {"item_name": item_name, **own_detail},
                "matches": [],
                "cached": False,
                "scrape_date": latest_date
            }

        competitor_items_map = {}
        for comp in competitors:
            comp_items = get_brand_items(comp, latest_date, country)
            if comp_items:
                competitor_items_map[comp] = comp_items

        if not competitor_items_map:
            return {
                "own_item": {"item_name": item_name, **own_detail},
                "matches": [],
                "cached": False,
                "scrape_date": latest_date
            }

        hash_input = {
            "own_brand": own_brand,
            "own_item": item_name,
            "own_price": own_detail["price"],
            "own_description": own_detail.get("description", ""),
            "own_category": own_detail.get("category", ""),
            "competitors": {
                comp: {name: get_item_price(data) for name, data in items.items()}
                for comp, items in competitor_items_map.items()
            }
        }
        data_hash = compute_data_hash(hash_input)

        cached = get_cached_matches(own_brand, item_name, data_hash)
        if cached:
            matches = []
            for c in cached:
                if c.get("match_confidence", 0) < 0.5:
                    continue
                comp_items = competitor_items_map.get(c["competitor_brand"], {})
                matched_data = comp_items.get(c["matched_item_name"])
                if matched_data:
                    detail = get_item_detail(matched_data)
                    price_diff = detail["price"] - own_detail["price"]
                    price_diff_pct = (price_diff / own_detail["price"] * 100) if own_detail["price"] > 0 else 0
                    matches.append({
                        "competitor_brand": c["competitor_brand"],
                        "item_name": c["matched_item_name"],
                        "match_confidence": c["match_confidence"],
                        "price_diff": round(price_diff, 2),
                        "price_diff_pct": round(price_diff_pct, 1),
                        **detail
                    })
            return {
                "own_item": {"item_name": item_name, **own_detail},
                "matches": matches,
                "cached": True,
                "scrape_date": latest_date
            }

        comp_items_summary = {}
        for comp, items in competitor_items_map.items():
            comp_items_summary[comp] = [
                {"name": n, "price": get_item_price(d), "description": get_item_detail(d).get("description", "")[:100]} for n, d in items.items()
            ]

        prompt = f"""You are a menu item matching expert for food/restaurant brands in the UAE.

Given this menu item from "{own_brand}":
- Item: "{item_name}"
- Price: AED {own_detail['price']}
- Description: "{own_detail.get('description', '')}"
- Category: "{own_detail.get('category', '')}"

Find the BEST matching item from each competitor brand below. Match items that are essentially the same dish/product (e.g., "Chicken Shawarma" matches "Shawarma Chicken", "Classic Shawarma" etc).

Competitor menus:
{json.dumps(comp_items_summary, indent=2)}

CRITICAL MATCHING RULES:
- Read the item descriptions carefully to understand what the item actually is
- Size/portion matters: NEVER match different sizes (e.g., "Large Pizza" should NOT match "Small Pizza" or "Medium Pizza"). Only match the SAME size or closest equivalent size
- "Regular", "Small", "Medium", "Large", "Family", "Party" etc. are DIFFERENT items — do not cross-match sizes
- Match the actual dish/product, not just the category (e.g., "Chicken Burger" should NOT match "Beef Burger")
- If an item specifies a quantity (e.g., "6 pcs", "12 pcs"), only match the same quantity
- Pay attention to variants: "Spicy" vs "Classic" vs "BBQ" are different items unless the core product is clearly the same

Return a JSON array of matches. For each competitor, return the single best match (or skip if no reasonable match exists). Format:
[{{"competitor_brand": "BrandName", "matched_item_name": "exact item name from their menu", "match_confidence": 0.0-1.0}}]

Only return the JSON array, nothing else. Be strict — only match truly similar items (confidence >= 0.5). Use exact item names from the competitor menus."""

        ai_response = await call_claude(prompt, max_tokens=600)
        matches_raw = []
        ai_succeeded = False
        if ai_response:
            try:
                cleaned = ai_response.strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
                    cleaned = cleaned.rsplit("```", 1)[0]
                matches_raw = json.loads(cleaned)
                ai_succeeded = True
            except json.JSONDecodeError:
                logger.error(f"Failed to parse Claude match response: {ai_response[:200]}")
                matches_raw = []

        if ai_succeeded and matches_raw:
            save_matches(own_brand, item_name, matches_raw, data_hash)

        matches = []
        for m in matches_raw:
            comp = m.get("competitor_brand", "")
            matched_name = m.get("matched_item_name", "")
            comp_items = competitor_items_map.get(comp, {})
            matched_data = comp_items.get(matched_name)
            if matched_data and m.get("match_confidence", 0) >= 0.5:
                detail = get_item_detail(matched_data)
                price_diff = detail["price"] - own_detail["price"]
                price_diff_pct = (price_diff / own_detail["price"] * 100) if own_detail["price"] > 0 else 0
                matches.append({
                    "competitor_brand": comp,
                    "item_name": matched_name,
                    "match_confidence": m.get("match_confidence", 0),
                    "price_diff": round(price_diff, 2),
                    "price_diff_pct": round(price_diff_pct, 1),
                    **detail
                })

        return {
            "own_item": {"item_name": item_name, **own_detail},
            "matches": matches,
            "cached": False,
            "scrape_date": latest_date
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error matching items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@competitor_router.post("/analyze")
async def analyze_pricing(data: dict):
    try:
        own_item = data.get("own_item", {})
        matches = data.get("matches", [])
        force = data.get("force", False)

        if not own_item or not matches:
            raise HTTPException(status_code=400, detail="own_item and matches are required")

        analysis_input = {
            "own_brand": data.get("own_brand", ""),
            "own": {"name": own_item.get("item_name"), "price": own_item.get("price")},
            "matches": [{"brand": m.get("competitor_brand"), "name": m.get("item_name"), "price": m.get("price")} for m in matches]
        }
        data_hash = compute_data_hash(analysis_input)

        if not force:
            cached = get_cached_analysis(data_hash)
            if cached:
                return {"analysis": cached, "cached": True}

        own_name = own_item.get("item_name", "Unknown")
        own_price = own_item.get("price", 0)
        own_brand = data.get("own_brand", "Your brand")

        comp_lines = []
        prices = [own_price]
        for m in matches:
            p = m.get("price", 0)
            prices.append(p)
            diff = p - own_price
            direction = "higher" if diff > 0 else "lower" if diff < 0 else "same"
            comp_lines.append(f"- {m.get('competitor_brand')}: \"{m.get('item_name')}\" at AED {p:.2f} ({direction} by AED {abs(diff):.2f})")

        avg_comp_price = sum(prices[1:]) / len(prices[1:]) if len(prices) > 1 else 0
        market_position = "above" if own_price > avg_comp_price else "below" if own_price < avg_comp_price else "at"
        pct_diff = abs((own_price - avg_comp_price) / avg_comp_price * 100) if avg_comp_price > 0 else 0

        prompt = f"""You are a pricing strategy expert for food delivery brands in the UAE market.

Analyze this competitive pricing situation:

{own_brand}'s item: "{own_name}" at AED {own_price:.2f}

Competitor pricing:
{chr(10).join(comp_lines)}

Average competitor price: AED {avg_comp_price:.2f}
{own_brand}'s price is {market_position} the market average by {abs(own_price - avg_comp_price):.2f} AED ({pct_diff:.1f}% difference).

Provide a concise pricing analysis (3-5 bullet points) covering:
1. Market position assessment
2. Whether the current price is justified
3. Specific pricing recommendation (raise, lower, or maintain with reasoning)
4. Any value-add suggestions if priced higher than competitors

Keep it actionable and specific to the UAE food delivery market. Use AED currency."""

        analysis = await call_claude(prompt, max_tokens=600)
        if not analysis:
            analysis = f"Unable to generate AI analysis. Your item \"{own_name}\" at AED {own_price:.2f} is priced {market_position} the competitor average of AED {avg_comp_price:.2f}."

        save_analysis(data_hash, analysis)
        return {"analysis": analysis, "cached": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing pricing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@competitor_router.get("/bulk-match/{own_brand}")
async def bulk_match_brand(own_brand: str, country: str = "UAE", scrape_date: str = None):
    try:
        target_date = scrape_date or get_latest_scrape_date(country)
        if not target_date:
            return {"items": [], "competitors": [], "matches": {}, "scrape_date": None}

        own_items = get_brand_items(own_brand, target_date, country)
        if not own_items:
            return {"items": [], "competitors": [], "matches": {}, "scrape_date": target_date}

        competitors = get_competitors_for_brand(own_brand, country)
        competitor_items_map = {}
        for comp in competitors:
            comp_items = get_brand_items(comp, target_date, country)
            if comp_items:
                competitor_items_map[comp] = comp_items

        item_list = []
        all_matches = {}
        items_needing_match = []

        for name in sorted(own_items.keys()):
            detail = get_item_detail(own_items[name])
            item_list.append({"item_name": name, **detail})

            if not competitor_items_map:
                all_matches[name] = []
                continue

            hash_input = {
                "own_brand": own_brand,
                "own_item": name,
                "own_price": detail["price"],
                "own_description": detail.get("description", ""),
                "own_category": detail.get("category", ""),
                "competitors": {
                    comp: {n: get_item_price(d) for n, d in items.items()}
                    for comp, items in competitor_items_map.items()
                }
            }
            data_hash = compute_data_hash(hash_input)

            cached = get_cached_matches(own_brand, name, data_hash)
            if cached:
                matches = []
                for c in cached:
                    if c.get("match_confidence", 0) < 0.5:
                        continue
                    comp_items = competitor_items_map.get(c["competitor_brand"], {})
                    matched_data = comp_items.get(c["matched_item_name"])
                    if matched_data:
                        md = get_item_detail(matched_data)
                        price_diff = md["price"] - detail["price"]
                        price_diff_pct = (price_diff / detail["price"] * 100) if detail["price"] > 0 else 0
                        matches.append({
                            "competitor_brand": c["competitor_brand"],
                            "item_name": c["matched_item_name"],
                            "match_confidence": c["match_confidence"],
                            "price_diff": round(price_diff, 2),
                            "price_diff_pct": round(price_diff_pct, 1),
                            **md
                        })
                all_matches[name] = matches
            else:
                items_needing_match.append({"name": name, "detail": detail, "data_hash": data_hash})

        if items_needing_match and competitor_items_map:
            comp_items_summary = {}
            for comp, items in competitor_items_map.items():
                comp_items_summary[comp] = [
                    {"name": n, "price": get_item_price(d), "description": get_item_detail(d).get("description", "")[:100]} for n, d in items.items()
                ]

            BATCH_SIZE = 15
            for i in range(0, len(items_needing_match), BATCH_SIZE):
                if i > 0:
                    await asyncio.sleep(2)
                batch = items_needing_match[i:i + BATCH_SIZE]
                items_block = "\n".join(
                    f'{idx+1}. "{it["name"]}" | AED {it["detail"]["price"]} | Category: "{it["detail"].get("category", "")}" | Desc: "{it["detail"].get("description", "")[:100]}"'
                    for idx, it in enumerate(batch)
                )

                prompt = f"""You are a menu item matching expert for food/restaurant brands in the UAE.

Match each item from "{own_brand}" to the BEST equivalent item from each competitor brand below. Items should be essentially the same dish/product.

Own brand items:
{items_block}

Competitor menus:
{json.dumps(comp_items_summary, indent=2)}

Return a JSON object where keys are the own item names (exactly as given) and values are arrays of matches:
{{
  "Item Name": [{{"competitor_brand": "BrandName", "matched_item_name": "exact name from their menu", "match_confidence": 0.0-1.0}}],
  ...
}}

CRITICAL MATCHING RULES:
- Read the item descriptions carefully to understand what the item actually is
- Size/portion matters: NEVER match different sizes (e.g., "Large Pizza" should NOT match "Small Pizza" or "Medium Pizza"). Only match the SAME size or closest equivalent size
- "Regular", "Small", "Medium", "Large", "Family", "Party" etc. are DIFFERENT items — do not cross-match sizes
- Match the actual dish/product, not just the category (e.g., "Chicken Burger" should NOT match "Beef Burger")
- If an item specifies a quantity (e.g., "6 pcs", "12 pcs"), only match the same quantity
- Pay attention to variants: "Spicy" vs "Classic" vs "BBQ" are different items unless the core product is clearly the same
- Only match truly similar items (confidence >= 0.5)
- Use EXACT item names from competitor menus
- Skip items with no good match (empty array)
- Return ONLY the JSON object, nothing else"""

                ai_response = await call_claude(prompt, max_tokens=min(3000, 200 * len(batch)))
                if ai_response:
                    try:
                        cleaned = ai_response.strip()
                        if cleaned.startswith("```"):
                            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
                            cleaned = cleaned.rsplit("```", 1)[0]
                        batch_results = json.loads(cleaned)

                        normalized_results = {}
                        for it in batch:
                            name = it["name"]
                            raw_matches = batch_results.get(name, [])
                            if not isinstance(raw_matches, list):
                                raw_matches = []
                            normalized_results[name] = raw_matches

                        data_hashes = {it["name"]: it["data_hash"] for it in batch}
                        save_matches_bulk(own_brand, batch, normalized_results, data_hashes)

                        for it in batch:
                            name = it["name"]
                            raw_matches = normalized_results.get(name, [])
                            matches = []
                            for m in raw_matches:
                                comp = m.get("competitor_brand", "")
                                matched_name = m.get("matched_item_name", "")
                                comp_items = competitor_items_map.get(comp, {})
                                matched_data = comp_items.get(matched_name)
                                if matched_data and m.get("match_confidence", 0) >= 0.5:
                                    md = get_item_detail(matched_data)
                                    price_diff = md["price"] - it["detail"]["price"]
                                    price_diff_pct = (price_diff / it["detail"]["price"] * 100) if it["detail"]["price"] > 0 else 0
                                    matches.append({
                                        "competitor_brand": comp,
                                        "item_name": matched_name,
                                        "match_confidence": m.get("match_confidence", 0),
                                        "price_diff": round(price_diff, 2),
                                        "price_diff_pct": round(price_diff_pct, 1),
                                        **md
                                    })
                            all_matches[name] = matches
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse bulk match response")
                        for it in batch:
                            all_matches.setdefault(it["name"], [])
                else:
                    for it in batch:
                        all_matches.setdefault(it["name"], [])

        return {
            "items": item_list,
            "competitors": list(competitor_items_map.keys()),
            "matches": all_matches,
            "scrape_date": target_date,
            "total_items": len(item_list),
            "matched_items": sum(1 for m in all_matches.values() if m),
            "cached_note": f"{len(item_list) - len(items_needing_match)} cached, {len(items_needing_match)} fresh"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in bulk match: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
