"""
Combo Insights & Menu Gap Analyzer — API Router
Adds to your Replit alongside server.py.

Integration:
    from insights_router import insights_router
    app.include_router(insights_router)
"""

from fastapi import APIRouter, HTTPException
import psycopg2
import psycopg2.extras
import os
import re
import json
import logging
import hashlib
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from contextlib import contextmanager
from collections import defaultdict

logger = logging.getLogger(__name__)
insights_router = APIRouter(prefix="/api/insights")

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


# ──────────────────────────────────────────────────────────
# Ensure cache table exists
# ──────────────────────────────────────────────────────────

def ensure_cache_table():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ai_insight_cache (
                    id SERIAL PRIMARY KEY,
                    cache_key TEXT UNIQUE NOT NULL,
                    insight_type TEXT NOT NULL,
                    insight_data JSONB NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_insight_cache_key ON ai_insight_cache(cache_key)")
            cur.close()
    except Exception as e:
        logger.error(f"Error creating cache table: {e}")

ensure_cache_table()


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────

def get_price(item_data) -> float:
    if isinstance(item_data, dict):
        return float(item_data.get("price", 0))
    return float(item_data)

def get_category(item_data) -> str:
    if isinstance(item_data, dict):
        return item_data.get("category", "")
    return ""

def get_description(item_data) -> str:
    if isinstance(item_data, dict):
        return item_data.get("description", "")
    return ""

def parse_date_for_sorting(date_str: str) -> datetime:
    try:
        return datetime.strptime(date_str, "%d-%b-%y")
    except:
        return datetime.now(timezone.utc)


# ── Combo detection (category-first) ──
# Step 1: Category keywords — if the Talabat category contains these, it's a combo
COMBO_CAT_KEYWORDS = re.compile(
    r'\b(combo|deal|offer|bundle|box|meal|feast|gathering|platter|sharing|'
    r'family|bucket|value|promotion|party|slider.*box|wok.*box|'
    r'for\s*[0-9]|set\s*menu|lunch\s*special|celebration|kentaaky|'
    r'duo|limo)\b',
    re.IGNORECASE
)
# Categories that match keywords but are NOT combos
COMBO_CAT_EXCLUDE = re.compile(
    r'(sizzler|starter|appetizer|dessert|drink|sauce|dip|bread|'
    r'curry|soup|salad|dim\s*sum|dumpling|chaat|kebab|kabab|'
    r'single\s*slider|steak|mains|rice|noodle|pizza\s*\(|pasta)',
    re.IGNORECASE
)

# Step 2: Item name patterns — only very specific combo phrases, not single words
COMBO_NAME_PATTERNS = re.compile(
    r'(combo\b|meal\s+for\s+[0-9]|value\s+meal|box\s+\d+\s*pcs|'
    r'\d+\s*pcs\s+box|family\s+(feast|box|meal|pack)|'
    r'sharing\s+(box|platter)|feast\s+for|'
    r'bundle\b|bucket\b|party\s+(box|pack)|gathering\s+box)',
    re.IGNORECASE
)

def is_combo(item_name: str, description: str = "", category: str = "") -> bool:
    """Category-first combo detection. Talabat categories are the best signal."""
    # Step 1: Check category (primary signal)
    if category:
        cat_lower = category.strip()
        if COMBO_CAT_KEYWORDS.search(cat_lower) and not COMBO_CAT_EXCLUDE.search(cat_lower):
            return True

    # Step 2: Check item name for very specific combo patterns only
    if COMBO_NAME_PATTERNS.search(item_name):
        return True

    return False


# ── Category inference ──
CATEGORY_RULES = [
    (r'\b(burger|slider|smash)\b', 'Burgers'),
    (r'\b(pizza|margherita|pepperoni)\b', 'Pizza'),
    (r'\b(pasta|spaghetti|penne|fettuccine|linguine|ravioli|lasagna|risotto)\b', 'Pasta'),
    (r'\b(sushi|maki|nigiri|sashimi|roll|temaki|uramaki)\b', 'Sushi'),
    (r'\b(biryani|dum|pulao)\b', 'Biryani & Rice'),
    (r'\b(wrap|burrito|taco|quesadilla|tortilla|enchilada)\b', 'Wraps & Tacos'),
    (r'\b(falafel|hummus|fattoush|tabbouleh|shawarma|manakish|manakeesh|labneh)\b', 'Middle Eastern'),
    (r'\b(salad|bowl|poke)\b', 'Salads & Bowls'),
    (r'\b(soup|shorba)\b', 'Soups'),
    (r'\b(fries|wedges|onion rings|nuggets|wings|strips|bites|appetizer|starter)\b', 'Sides & Appetizers'),
    (r'\b(sandwich|sub|panini|club|baguette|croissant)\b', 'Sandwiches'),
    (r'\b(steak|grilled|kebab|kabab|tikka|tandoori|bbq)\b', 'Grills & Kebabs'),
    (r'\b(chicken|popcorn chicken)\b', 'Chicken'),
    (r'\b(noodle|chow mein|lo mein|pad thai|fried rice|dim sum|dumpling|spring roll|wonton)\b', 'Asian'),
    (r'\b(cake|brownie|cheesecake|tiramisu|kunafa|baklava|ice cream|sundae|mousse|dessert)\b', 'Desserts'),
    (r'\b(juice|smoothie|shake|milkshake|lemonade|mojito|drink|water|coffee|tea|latte)\b', 'Beverages'),
    (r'\b(bread|garlic bread|naan|roti|pita|khubz)\b', 'Breads'),
    (r'\b(breakfast|egg|omelette|pancake|waffle)\b', 'Breakfast'),
    (r'\b(sauce|dip|extra|add.?on|topping)\b', 'Add-ons & Extras'),
]
CATEGORY_COMPILED = [(re.compile(pat, re.IGNORECASE), cat) for pat, cat in CATEGORY_RULES]

STORED_CAT_NORMALIZE = {
    "grills": "Grills & Kebabs",
    "grills & kebabs": "Grills & Kebabs",
    "1kg family grills": "Grills & Kebabs",
    "homemade skillets": "Grills & Kebabs",
    "salads": "Salads & Bowls",
    "salads & bowls": "Salads & Bowls",
    "signature salads": "Salads & Bowls",
    "power bowls": "Salads & Bowls",
    "sides": "Sides & Appetizers",
    "sides & appetizers": "Sides & Appetizers",
    "hot & cold appetizers": "Sides & Appetizers",
    "teasers": "Sides & Appetizers",
    "snacks": "Sides & Appetizers",
    "soft drinks": "Beverages",
    "beverages": "Beverages",
    "juices": "Beverages",
    "fresh juices": "Beverages",
    "juices & cocktails": "Beverages",
    "shakes": "Beverages",
    "sushi": "Sushi",
    "pasta": "Pasta",
    "pizza": "Pizza",
    "asian": "Asian",
    "desserts": "Desserts",
    "middle eastern": "Middle Eastern",
    "manakich & kaak": "Middle Eastern",
    "manakeesh": "Middle Eastern",
    "wraps & tacos": "Wraps & Tacos",
    "specialty wraps": "Wraps & Tacos",
    "sandwiches & wraps": "Sandwiches",
    "burgers & hotdogs": "Burgers",
    "boom burgers": "Burgers",
    "breakfast": "Breakfast",
    "kids meals": "Kids Meals",
    "emirati dishes": "Middle Eastern",
    "bao": "Asian",
    "daily dish": "Other",
    "daily meal plan": "Other",
    "warm salmon and shrimp meals": "Grills & Kebabs",
    "warm vegetarian meals": "Salads & Bowls",
    "classic soups": "Soups",
    "curries": "Grills & Kebabs",
    "main course veg": "Grills & Kebabs",
    "mains (non veg)": "Grills & Kebabs",
    "mains (veg)": "Grills & Kebabs",
    "rice & noodles": "Asian",
    "rice & noodles (non veg)": "Asian",
    "rice & noodles (veg)": "Asian",
    "starters (non veg)": "Sides & Appetizers",
    "starters (veg)": "Sides & Appetizers",
    "fusion ramen": "Asian",
    "dumplings & momos (veg)": "Asian",
    "cheese baked dumplings (new)": "Asian",
    "mandarin box": "Asian",
    "wok boxes": "Asian",
    "wok box": "Asian",
    "chips & sides": "Sides & Appetizers",
    "winterfire sizzlers (non veg)": "Grills & Kebabs",
    "winterfire sizzlers (veg)": "Grills & Kebabs",
    "appetizers": "Sides & Appetizers",
    "appetisers": "Sides & Appetizers",
    "appetizers & salads": "Sides & Appetizers",
    "chefs specials": "Other",
    "dips and oils": "Add-ons & Extras",
    "fresh salads": "Salads & Bowls",
    "drinks": "Beverages",
    "chill drinks": "Beverages",
    "detox juices": "Beverages",
    "cocktails": "Beverages",
    "beverages -aod": "Beverages",
    "chaat -aod": "Sides & Appetizers",
    "curries (fish)": "Grills & Kebabs",
    "curries (lobster)": "Grills & Kebabs",
    "curries (mutton)": "Grills & Kebabs",
    "curries (chicken)": "Chicken",
    "curries (veg)": "Grills & Kebabs",
    "curries (paneer)": "Grills & Kebabs",
    "cold mezze": "Middle Eastern",
    "hot mezze": "Middle Eastern",
    "daily dishes": "Other",
    "healthy meals": "Salads & Bowls",
    "business lunch": "Other",
    "burgers and sliders": "Burgers",
    "beef brioche signature": "Burgers",
    "main menu": "Other",
    "sides & extras": "Sides & Appetizers",
    "sharing boxes": "Other",
    "let's get cheesy": "Other",
    "barbecue": "Grills & Kebabs",
    "starters": "Sides & Appetizers",
    "soups": "Soups",
    "gnocchi": "Pasta",
    "wraps": "Wraps & Tacos",
    "hot drinks": "Beverages",
    "from the bakery": "Desserts",
    "hey, sweet thing": "Desserts",
    "kids meal": "Kids Meals",
    "mac": "Pasta",
    "curries (prawns)": "Grills & Kebabs",
    "curries (vegetarian)": "Grills & Kebabs",
    "desserts -aod": "Desserts",
    "indian breads -aod": "Breads",
    "indian breads": "Breads",
    "super limo": "Beverages",
    "milkshakes": "Beverages",
    "speciality drinks": "Beverages",
    "refreshing lassi": "Beverages",
    "cold beverages": "Beverages",
    "hot beverages": "Beverages",
    "iced drinks": "Beverages",
    "smoothies": "Beverages",
    "pops": "Beverages",
    "kababs (lobster)": "Grills & Kebabs",
    "kababs (mutton)": "Grills & Kebabs",
    "kababs (prawns)": "Grills & Kebabs",
    "kababs (vegetarian)": "Grills & Kebabs",
    "on the grill": "Grills & Kebabs",
    "non veg starters -aod": "Sides & Appetizers",
    "non-veg main course -aod": "Grills & Kebabs",
    "veg main course -aod": "Grills & Kebabs",
    "veg starters -aod": "Sides & Appetizers",
    "sides -aod": "Sides & Appetizers",
    "salads & raita": "Salads & Bowls",
    "signature biryanis & rice": "Biryani & Rice",
    "snacks & chaat": "Sides & Appetizers",
    "paratha burgers": "Burgers",
    "main course": "Other",
    "main courses": "Other",
    "mains": "Other",
    "sandos": "Sandwiches",
    "i scream": "Desserts",
    "just desserts": "Desserts",
    "bakery": "Desserts",
    "kid's menu": "Kids Meals",
    "side": "Sides & Appetizers",
    "sides and extras": "Sides & Appetizers",
    "from the oven": "Grills & Kebabs",
    "dishes": "Other",
    "tacos": "Wraps & Tacos",
    "jones snacks": "Sides & Appetizers",
}

PROMO_SEASONAL_CATEGORIES = {
    "offers", "deals", "special offers", "combos",
    "celebration combos", "combo meals", "bundle meals", "bundles",
    "value meal box", "build your own bundle",
    "bundle meals (11am to 4pm)",
    "easter 2026", "ramadan specials", "lent menu",
    "promotions", "new arrivals!", "new additions",
    "hut signatures", "nonna's lunch deal",
    "nonna's signature pastas [new]",
    "the vegan menu", "creations by chef omar",
}

IGNORED_CATEGORIES = {
    "picks for you", "picks for you 🏷", "picks for you",
    "al qilabat", "daily al bahriaat",
    "yemeni kitchen meat", "yemeni kitchen chicken",
    "go healthy with fadi el khatib healthy items",
    "fuel first- keto collection", "talabat exclusive",
    "new wraps", "mini z", "flaming wraps", "add on's",
    "featured", "popular", "top picks",
    "coffee", "dips",
    "fatat", "the gathering box_",
    "chillixirs",
}

def _normalize_stored_category(cat: str) -> str:
    import unicodedata
    cat_clean = cat.strip()
    cat_clean = ''.join(c for c in cat_clean if ord(c) < 0x3000 and c.isprintable()).strip()
    cat_clean = ''.join(c for c in cat_clean if unicodedata.category(c)[0] != 'S').strip()
    cat_lower = cat_clean.lower()
    if cat_lower in IGNORED_CATEGORIES:
        return "Other"
    if cat_lower in PROMO_SEASONAL_CATEGORIES:
        return "Promotions & Seasonal"
    if cat_lower in STORED_CAT_NORMALIZE:
        return STORED_CAT_NORMALIZE[cat_lower]
    for pattern, category in CATEGORY_COMPILED:
        if pattern.search(cat_clean):
            return category
    return cat_clean if cat_clean else "Other"

def infer_category(item_name: str, stored_category: str = "") -> str:
    for pattern, category in CATEGORY_COMPILED:
        if pattern.search(item_name):
            return category
    if stored_category and stored_category.strip():
        return _normalize_stored_category(stored_category)
    return "Other"


# ── Claude API call (minimal tokens) ──
async def call_claude(prompt: str, max_tokens: int = 400) -> Optional[str]:
    try:
        import httpx
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set")
            return None

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
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}]
                },
                timeout=30.0
            )
            if response.status_code == 200:
                return response.json()["content"][0]["text"]
            else:
                logger.error(f"Claude API error: {response.status_code}")
                return None
    except Exception as e:
        logger.error(f"Claude API call failed: {e}")
        return None


def get_cached_insight(cache_key: str) -> Optional[dict]:
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT insight_data FROM ai_insight_cache WHERE cache_key = %s LIMIT 1", (cache_key,))
            row = cur.fetchone()
            cur.close()
            return row["insight_data"] if row else None
    except:
        return None


def set_cached_insight(cache_key: str, insight_type: str, data: dict):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO ai_insight_cache (cache_key, insight_type, insight_data, created_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE SET insight_data = EXCLUDED.insight_data, created_at = EXCLUDED.created_at
            """, (cache_key, insight_type, json.dumps(data), datetime.now(timezone.utc)))
            cur.close()
    except Exception as e:
        logger.error(f"Cache write error: {e}")


# ──────────────────────────────────────────────────────────
# 1. COMBO INSIGHTS
# ──────────────────────────────────────────────────────────

def _analyze_price_tiers(combos: list) -> dict:
    """Bucket combos into AED price ranges."""
    tiers = {
        "0-19": {"min": 0, "max": 20, "items": []},
        "20-29": {"min": 20, "max": 30, "items": []},
        "30-39": {"min": 30, "max": 40, "items": []},
        "40-49": {"min": 40, "max": 50, "items": []},
        "50+": {"min": 50, "max": 999, "items": []},
    }
    for c in combos:
        p = c["price"]
        if p < 20:
            tiers["0-19"]["items"].append(c)
        elif p < 30:
            tiers["20-29"]["items"].append(c)
        elif p < 40:
            tiers["30-39"]["items"].append(c)
        elif p < 50:
            tiers["40-49"]["items"].append(c)
        else:
            tiers["50+"]["items"].append(c)
    return {k: {"range": k, "count": len(v["items"]),
                "avg": round(sum(i["price"] for i in v["items"]) / len(v["items"]), 2) if v["items"] else 0,
                "items": v["items"]}
            for k, v in tiers.items()}


def _find_price_gaps(own_tiers: dict, comp_tiers_list: list) -> list:
    """Find price ranges where competitors have combos but own brand doesn't."""
    gaps = []
    for tier_key in ["0-19", "20-29", "30-39", "40-49", "50+"]:
        label = f"{tier_key} AED"
        own_count = own_tiers.get(tier_key, {}).get("count", 0)
        comp_counts = [ct.get(tier_key, {}).get("count", 0) for ct in comp_tiers_list]
        comp_total = sum(comp_counts)
        if own_count == 0 and comp_total > 0:
            gaps.append({"tier": label, "tier_key": tier_key, "type": "missing",
                         "detail": f"Competitors have {comp_total} combos here, you have none"})
        elif own_count > 0 and comp_total > 0:
            own_avg = own_tiers[tier_key]["avg"]
            comp_avgs = [ct[tier_key]["avg"] for ct in comp_tiers_list if ct.get(tier_key, {}).get("count", 0) > 0]
            if comp_avgs:
                avg_comp = sum(comp_avgs) / len(comp_avgs)
                diff_pct = round((own_avg - avg_comp) / avg_comp * 100, 1) if avg_comp else 0
                if abs(diff_pct) > 10:
                    gaps.append({"tier": label, "tier_key": tier_key, "type": "pricing",
                                 "detail": f"Your avg {own_avg} AED vs competitor avg {round(avg_comp, 2)} AED ({'+' if diff_pct > 0 else ''}{diff_pct}%)"})
    return gaps


@insights_router.get("/combos")
async def combo_insights(scrape_date: str = None, country: str = "UAE"):
    """Full combo analysis with price tiers, gaps, and AI recommendations per group."""
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT DISTINCT scrape_date FROM scrapes WHERE country = %s", (country,))
            all_dates = sorted([r["scrape_date"] for r in cur.fetchall()], key=parse_date_for_sorting)
            target = scrape_date if scrape_date and scrape_date in all_dates else (all_dates[-1] if all_dates else None)
            if not target:
                return {"has_data": False, "groups": [], "available_dates": []}

            cur.execute("SELECT brand_name, items FROM scrapes WHERE scrape_date = %s AND country = %s", (target, country))
            scrape_data = {r["brand_name"]: r["items"] for r in cur.fetchall()}

            cur.execute("SELECT own_brand, competitors, group_order FROM brand_groups WHERE country = %s ORDER BY group_order", (country,))
            groups = cur.fetchall()
            cur.close()

        def _extract_combos(items: dict) -> list:
            combos = []
            for name, data in items.items():
                price = get_price(data)
                if price <= 0:
                    continue
                desc = get_description(data)
                cat = get_category(data)
                inferred_cat = cat or infer_category(name)
                if is_combo(name, desc, cat):
                    combos.append({"name": name, "price": price, "category": inferred_cat, "description": desc[:100]})
            return sorted(combos, key=lambda x: x["price"])

        def _brand_combo_data(brand_name, items):
            combos = _extract_combos(items)
            non_combo_prices = [get_price(v) for k, v in items.items() if get_price(v) > 0 and not is_combo(k, get_description(v), get_category(v))]
            tiers = _analyze_price_tiers(combos)
            return {
                "brand_name": brand_name,
                "combo_count": len(combos),
                "total_items": len(items),
                "combo_pct": round(len(combos) / len(items) * 100, 1) if items else 0,
                "combos": combos,
                "tiers": tiers,
                "avg_combo_price": round(sum(c["price"] for c in combos) / len(combos), 2) if combos else 0,
                "avg_non_combo_price": round(sum(non_combo_prices) / len(non_combo_prices), 2) if non_combo_prices else 0,
                "min_combo": round(min(c["price"] for c in combos), 2) if combos else 0,
                "max_combo": round(max(c["price"] for c in combos), 2) if combos else 0,
            }

        group_results = []
        total_combos = 0
        total_items = 0

        for group in groups:
            own_brand = group["own_brand"]
            competitors = list(group["competitors"]) if group["competitors"] else []
            own_items = scrape_data.get(own_brand, {})
            if not own_items:
                continue

            own_data = _brand_combo_data(own_brand, own_items)
            comp_data_list = []
            for comp in competitors:
                if comp in scrape_data:
                    comp_data_list.append(_brand_combo_data(comp, scrape_data[comp]))

            # Find price gaps
            comp_tiers = [cd["tiers"] for cd in comp_data_list]
            price_gaps = _find_price_gaps(own_data["tiers"], comp_tiers)

            total_combos += own_data["combo_count"] + sum(cd["combo_count"] for cd in comp_data_list)
            total_items += own_data["total_items"] + sum(cd["total_items"] for cd in comp_data_list)

            group_results.append({
                "own_brand": own_brand,
                "own_data": own_data,
                "competitors": comp_data_list,
                "price_gaps": price_gaps,
                "group_order": group["group_order"],
            })

        return {
            "has_data": True,
            "scrape_date": target,
            "available_dates": all_dates,
            "summary": {
                "total_combos": total_combos,
                "total_items": total_items,
                "groups_with_gaps": sum(1 for g in group_results if g["price_gaps"]),
            },
            "groups": group_results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _extract_standalone_items(items: dict) -> list:
    """Extract non-combo standalone menu items with prices for discount calculation."""
    standalone = []
    for name, data in items.items():
        price = get_price(data)
        if price <= 0:
            continue
        desc = get_description(data)
        cat = get_category(data)
        if not is_combo(name, desc, cat):
            inferred_cat = cat or infer_category(name)
            standalone.append({"name": name, "price": price, "category": inferred_cat})
    return sorted(standalone, key=lambda x: x["name"])


def _build_standalone_section(brand_name: str, items: dict) -> str:
    """Build standalone menu section for a brand, capped at 80 items."""
    standalone = _extract_standalone_items(items)
    if not standalone:
        return f"{brand_name}: no standalone items available"
    lines = [f"  {s['name']} | {s['price']} AED | {s['category']}" for s in standalone[:80]]
    return f"{brand_name} standalone items ({len(standalone)} total):\n" + "\n".join(lines)


def _parse_combo_json(ai_text: str) -> Optional[dict]:
    """Parse JSON from Claude's combo analysis response, with basic validation."""
    if not ai_text:
        return None
    try:
        start = ai_text.find("{")
        end = ai_text.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(ai_text[start:end])
            if not isinstance(data, dict):
                return None
            for key in ("own_brand_combos", "combo_type_gaps", "pricing_gaps"):
                if key in data and not isinstance(data[key], list):
                    data[key] = []
            if "competitor_combos" in data and not isinstance(data["competitor_combos"], dict):
                data["competitor_combos"] = {}
            for combo in (data.get("own_brand_combos") or []):
                if not isinstance(combo.get("price"), (int, float)):
                    combo["price"] = 0
                if not isinstance(combo.get("discount_pct"), (int, float, type(None))):
                    combo["discount_pct"] = None
                if not isinstance(combo.get("estimated_standalone_total"), (int, float, type(None))):
                    combo["estimated_standalone_total"] = None
                if combo.get("value_flag") not in ("good_value", "weak_value", "aggressive", "unknown", None):
                    combo["value_flag"] = "unknown"
            for gap in (data.get("combo_type_gaps") or []):
                if not isinstance(gap.get("suggested_price"), (int, float, type(None))):
                    gap["suggested_price"] = None
                if not isinstance(gap.get("suggested_discount_pct"), (int, float, type(None))):
                    gap["suggested_discount_pct"] = None
                if gap.get("priority") not in ("P1", "P2", "P3", None):
                    gap["priority"] = "P3"
                if not isinstance(gap.get("competitors_offering"), list):
                    gap["competitors_offering"] = []
            for pg in (data.get("pricing_gaps") or []):
                if not isinstance(pg.get("own_price"), (int, float)):
                    pg["own_price"] = 0
                if not isinstance(pg.get("competitor_price"), (int, float)):
                    pg["competitor_price"] = 0
                if not isinstance(pg.get("price_diff_pct"), (int, float)):
                    pg["price_diff_pct"] = 0
            return data
    except (json.JSONDecodeError, ValueError):
        pass
    return None


@insights_router.get("/combos/ai")
async def combo_ai_insights(scrape_date: str = None, force: bool = False, country: str = "UAE"):
    """
    AI combo insights — per brand group, sends combo details + standalone menu
    so Claude can perform structure, value/discount, and gap analysis.
    Returns structured JSON analysis per brand group.
    """
    try:
        combo_data = await combo_insights(scrape_date, country)
        if not combo_data["has_data"]:
            return {"has_data": False, "insights": None}

        target = combo_data["scrape_date"]
        cache_key = f"combo_ai_v4_{target}_{country}"

        if not force:
            cached = get_cached_insight(cache_key)
            if cached:
                return {"has_data": True, "scrape_date": target, "insights": cached, "cached": True}

        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT brand_name, items FROM scrapes WHERE scrape_date = %s", (target,))
            scrape_data = {r["brand_name"]: r["items"] for r in cur.fetchall()}
            cur.close()

        brand_analyses = []
        for g in combo_data["groups"]:
            own = g["own_data"]
            if not own["combos"] and not any(c["combos"] for c in g["competitors"]):
                continue

            own_brand = own["brand_name"]
            competitor_names = [c["brand_name"] for c in g["competitors"] if c["combos"]]

            own_lines = []
            for c in own["combos"][:30]:
                desc = c.get("description", "")[:80].replace("\n", " ")
                cat = c.get("category", "")
                own_lines.append(f"  {c['name']} | {c['price']} AED | {cat} | {desc}")

            comp_blocks = []
            for comp in g["competitors"]:
                if not comp["combos"]:
                    comp_blocks.append(f"  {comp['brand_name']}: 0 combos")
                    continue
                c_lines = []
                for c in comp["combos"][:30]:
                    desc = c.get("description", "")[:80].replace("\n", " ")
                    cat = c.get("category", "")
                    c_lines.append(f"    {c['name']} | {c['price']} AED | {cat} | {desc}")
                comp_blocks.append(
                    f"  {comp['brand_name']} ({comp['combo_count']} combos, avg {comp['avg_combo_price']} AED):\n"
                    + "\n".join(c_lines)
                )

            standalone_sections = []
            if own_brand in scrape_data:
                standalone_sections.append(_build_standalone_section(own_brand, scrape_data[own_brand]))
            for comp in g["competitors"]:
                if comp["brand_name"] in scrape_data:
                    standalone_sections.append(_build_standalone_section(comp["brand_name"], scrape_data[comp["brand_name"]]))

            prompt = f"""You are a restaurant competitive intelligence analyst specializing in combo/meal deal strategy.

## DATA FORMAT
Each combo is listed as: Name | Price (AED) | Category/Type | Description

## COMBO DATA
[{own_brand}] OWN — {own['combo_count']} combos, avg {own['avg_combo_price']} AED, range {own['min_combo']}-{own['max_combo']} AED
{chr(10).join(own_lines)}

COMPETITORS:
{chr(10).join(comp_blocks)}

## STANDALONE MENU (for discount % calculation)
{chr(10).join(standalone_sections)}

## YOUR TASK
Analyze the combo offerings of {own_brand} against competitors ({', '.join(competitor_names) if competitor_names else 'none'}).

### 1. COMBO STRUCTURE ANALYSIS
For each combo: parse components from description (e.g. "1 Main + 1 Side + 1 Drink"), identify category/occasion (value meal, family sharing, party pack, kids meal, snack combo, build-your-own), and positioning (budget/mid-range/premium).

### 2. VALUE ANALYSIS
For each combo where standalone item prices can be identified from the STANDALONE MENU data:
- Calculate SUM of standalone item prices if ordered individually
- Calculate COMBO DISCOUNT % = ((sum_of_standalone - combo_price) / sum_of_standalone) * 100
- Flag combos where discount % < 10% as "weak_value"
- Flag combos where discount % > 30% as "aggressive"
- If standalone prices cannot be determined, set value_flag to "unknown" — do NOT guess

### 3. GAP ANALYSIS
Compare {own_brand}'s combo portfolio against each competitor:
- Missing combo TYPES (family packs, breakfast bundles, dessert combos, kids meals, sharing platters, build-your-own, snack combos)
- Pricing gaps where comparable combos differ by >15%
- Component gaps (competitor includes drinks/desserts where own brand doesn't)

### 4. RECOMMENDATIONS
For each gap, provide: suggested combo structure, price point, expected discount %, and priority (P1=launch ASAP, P2=next quarter, P3=nice to have).

## OUTPUT FORMAT
Return ONLY a valid JSON object (no markdown, no code fences) with this structure:
{{
  "own_brand_combos": [
    {{
      "name": "...",
      "price": 0.00,
      "category": "...",
      "components_parsed": ["item1", "item2"],
      "estimated_standalone_total": 0.00,
      "discount_pct": 0.00,
      "value_flag": "good_value"
    }}
  ],
  "competitor_combos": {{
    "CompetitorName": [
      {{
        "name": "...",
        "price": 0.00,
        "category": "...",
        "components_parsed": ["item1"],
        "estimated_standalone_total": null,
        "discount_pct": null,
        "value_flag": "unknown"
      }}
    ]
  }},
  "combo_type_gaps": [
    {{
      "gap_type": "...",
      "competitors_offering": ["..."],
      "recommendation": "...",
      "suggested_price": 0.00,
      "suggested_discount_pct": 0.00,
      "priority": "P1"
    }}
  ],
  "pricing_gaps": [
    {{
      "own_combo": "...",
      "own_price": 0.00,
      "competitor": "...",
      "competitor_combo": "...",
      "competitor_price": 0.00,
      "price_diff_pct": 0.00,
      "action": "..."
    }}
  ],
  "summary": "2-3 sentence executive summary"
}}

value_flag must be one of: "good_value", "weak_value", "aggressive", "unknown"
priority must be one of: "P1", "P2", "P3"
Only include combos and gaps that exist — use empty arrays if none found."""

            ai_text = await call_claude(prompt, max_tokens=2500)
            parsed = _parse_combo_json(ai_text)

            if parsed and isinstance(parsed.get("summary"), str):
                brand_analyses.append({
                    "brand": own_brand,
                    "analysis": parsed,
                    "bullets": _extract_bullets_from_combo_analysis(parsed),
                })
            else:
                fallback_bullets = []
                brand_parsed = _parse_brand_insights(ai_text or "", [own_brand])
                if brand_parsed and brand_parsed[0].get("bullets"):
                    fallback_bullets = brand_parsed[0]["bullets"]
                elif ai_text:
                    for line in ai_text.strip().split("\n"):
                        line = line.strip().lstrip("-*").strip()
                        if line and len(line) > 5 and not line.startswith("{") and not line.startswith("}"):
                            fallback_bullets.append(line)
                            if len(fallback_bullets) >= 6:
                                break
                brand_analyses.append({
                    "brand": own_brand,
                    "analysis": None,
                    "bullets": fallback_bullets,
                })

        result = {"brand_insights": brand_analyses, "generated_at": datetime.now(timezone.utc).isoformat()}

        if brand_analyses:
            set_cached_insight(cache_key, "combo_ai_v4", result)

        return {"has_data": True, "scrape_date": target, "insights": result, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _extract_bullets_from_combo_analysis(analysis: dict) -> list:
    """Extract bullet-point summaries from structured combo analysis for backward-compatible display."""
    bullets = []
    if analysis.get("summary"):
        bullets.append(analysis["summary"])
    for gap in (analysis.get("combo_type_gaps") or [])[:4]:
        priority = gap.get("priority", "")
        rec = gap.get("recommendation", "")
        price = gap.get("suggested_price")
        if rec:
            bullet = f"[{priority}] {rec}"
            if price:
                bullet += f" (~{price} AED)"
            bullets.append(bullet)
    for pg in (analysis.get("pricing_gaps") or [])[:2]:
        action = pg.get("action", "")
        if action:
            bullets.append(action)
    return bullets[:6]


def _parse_brand_insights(ai_text: str, brand_names: list) -> list:
    """Parse AI output into per-brand insight blocks with bullet points."""
    if not ai_text:
        return []

    results = []
    lines = ai_text.strip().split("\n")
    current_brand = None
    current_bullets = []

    def _flush():
        nonlocal current_brand, current_bullets
        if current_brand and current_bullets:
            results.append({"brand": current_brand, "bullets": current_bullets})
        current_brand = None
        current_bullets = []

    # Build lowercase lookup for brand matching
    brand_lookup = {bn.lower(): bn for bn in brand_names}

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Check if this line is a brand header
        is_brand_line = False
        for bn_lower, bn in brand_lookup.items():
            # Match "BRANDNAME" or "BRANDNAME:" on its own line (no bullet)
            clean = stripped.rstrip(":").strip().lower()
            if clean == bn_lower and not stripped.startswith("-"):
                _flush()
                current_brand = bn
                is_brand_line = True
                break
            # Also match "BRANDNAME: some text" (treat rest as first bullet)
            if stripped.lower().startswith(bn_lower + ":") and not stripped.startswith("-"):
                _flush()
                current_brand = bn
                after = stripped[len(bn):].lstrip(": ").strip()
                if after:
                    current_bullets.append(after.lstrip("- "))
                is_brand_line = True
                break

        if is_brand_line:
            continue

        # It's a content line — add as bullet
        if current_brand:
            bullet = stripped.lstrip("-•* ").strip()
            if bullet:
                current_bullets.append(bullet)

    _flush()
    return results


# ──────────────────────────────────────────────────────────
# 2. MENU GAP ANALYZER
# ──────────────────────────────────────────────────────────

@insights_router.get("/menu-gaps")
async def menu_gap_analysis(scrape_date: str = None, country: str = "UAE"):
    """
    Per brand group: identify category gaps, price tier gaps, and item-type gaps
    between own brand and competitors.
    """
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT DISTINCT scrape_date FROM scrapes WHERE country = %s", (country,))
            all_dates = sorted([r["scrape_date"] for r in cur.fetchall()], key=parse_date_for_sorting)
            target = scrape_date if scrape_date and scrape_date in all_dates else (all_dates[-1] if all_dates else None)
            if not target:
                return {"has_data": False, "groups": [], "available_dates": []}

            cur.execute("SELECT brand_name, items FROM scrapes WHERE scrape_date = %s AND country = %s", (target, country))
            scrape_data = {r["brand_name"]: r["items"] for r in cur.fetchall()}

            cur.execute("SELECT own_brand, competitors, group_order FROM brand_groups WHERE country = %s ORDER BY group_order", (country,))
            groups = cur.fetchall()
            cur.close()

        def _categorize_menu(items: dict) -> dict:
            """Return {category: {items: [...], avg_price, count, price_tiers}}"""
            cat_map = defaultdict(list)
            for name, data in items.items():
                price = get_price(data)
                if price <= 0:
                    continue
                cat = infer_category(name, get_category(data))
                cat_map[cat].append({"name": name, "price": price})

            result = {}
            for cat, cat_items in cat_map.items():
                prices = [i["price"] for i in cat_items]
                result[cat] = {
                    "count": len(cat_items),
                    "avg_price": round(sum(prices) / len(prices), 2),
                    "min_price": round(min(prices), 2),
                    "max_price": round(max(prices), 2),
                    "items": sorted(cat_items, key=lambda x: x["price"]),
                }
            return result

        def _price_distribution(items: dict) -> dict:
            """Return price distribution in AED buckets."""
            buckets = {"0-19": 0, "20-29": 0, "30-39": 0, "40-49": 0, "50+": 0}
            for name, data in items.items():
                p = get_price(data)
                if p <= 0:
                    continue
                if p < 20: buckets["0-19"] += 1
                elif p < 30: buckets["20-29"] += 1
                elif p < 40: buckets["30-39"] += 1
                elif p < 50: buckets["40-49"] += 1
                else: buckets["50+"] += 1
            return buckets

        group_results = []
        total_category_gaps = 0
        total_price_gaps = 0

        for group in groups:
            own_brand = group["own_brand"]
            competitors = list(group["competitors"]) if group["competitors"] else []
            own_items = scrape_data.get(own_brand, {})
            if not own_items:
                continue

            own_cats = _categorize_menu(own_items)
            own_dist = _price_distribution(own_items)
            own_cat_set = set(own_cats.keys())

            comp_analyses = []
            all_comp_cats = set()
            for comp in competitors:
                if comp not in scrape_data:
                    continue
                comp_items = scrape_data[comp]
                comp_cats = _categorize_menu(comp_items)
                comp_dist = _price_distribution(comp_items)
                comp_cat_set = set(comp_cats.keys())
                all_comp_cats.update(comp_cat_set)

                # Category gaps: categories competitor has that own brand lacks
                missing_cats = []
                for cat in comp_cat_set - own_cat_set:
                    if cat in ("Other", "Add-ons & Extras"):
                        continue
                    missing_cats.append({
                        "category": cat,
                        "comp_count": comp_cats[cat]["count"],
                        "comp_avg_price": comp_cats[cat]["avg_price"],
                        "comp_price_range": f"{comp_cats[cat]['min_price']}-{comp_cats[cat]['max_price']}",
                    })

                # Price tier gaps: buckets where competitor has items but own brand has few/none
                price_gaps = []
                for bucket, comp_count in comp_dist.items():
                    own_count = own_dist.get(bucket, 0)
                    if comp_count > 2 and own_count == 0:
                        price_gaps.append({"range": bucket, "type": "missing",
                                           "detail": f"Competitor has {comp_count} items, you have none"})
                    elif comp_count > 0 and own_count > 0 and comp_count > own_count * 3:
                        price_gaps.append({"range": bucket, "type": "underserved",
                                           "detail": f"Competitor has {comp_count} items vs your {own_count}"})

                # Category depth gaps: same category but competitor has way more variety
                depth_gaps = []
                for cat in own_cat_set & comp_cat_set:
                    own_count = own_cats[cat]["count"]
                    comp_count = comp_cats[cat]["count"]
                    if comp_count > own_count * 2 and comp_count - own_count >= 3:
                        depth_gaps.append({
                            "category": cat,
                            "own_count": own_count,
                            "comp_count": comp_count,
                            "comp_avg_price": comp_cats[cat]["avg_price"],
                        })

                comp_analyses.append({
                    "brand_name": comp,
                    "total_items": len(comp_items),
                    "categories": comp_cats,
                    "price_distribution": comp_dist,
                    "missing_categories": missing_cats,
                    "price_gaps": price_gaps,
                    "depth_gaps": depth_gaps,
                })

            all_missing = all_comp_cats - own_cat_set - {"Other", "Add-ons & Extras"}
            menu_missing = sorted([c for c in all_missing if c != "Promotions & Seasonal"])
            promo_missing = "Promotions & Seasonal" in all_missing and "Promotions & Seasonal" not in own_cat_set

            promo_details = []
            if promo_missing:
                for ca in comp_analyses:
                    promo_cat = ca.get("categories", {}).get("Promotions & Seasonal")
                    if promo_cat:
                        promo_details.append({
                            "brand": ca["brand_name"],
                            "count": promo_cat["count"],
                            "items": [i["name"] for i in promo_cat["items"][:6]],
                        })

            total_category_gaps += len(menu_missing)
            total_price_gaps += sum(len(ca["price_gaps"]) for ca in comp_analyses)

            group_results.append({
                "own_brand": own_brand,
                "own_total_items": len(own_items),
                "own_categories": own_cats,
                "own_price_distribution": own_dist,
                "own_category_count": len(own_cat_set),
                "all_missing_categories": menu_missing,
                "promo_gap": promo_missing,
                "promo_details": promo_details,
                "competitors": comp_analyses,
                "group_order": group["group_order"],
            })

        return {
            "has_data": True,
            "scrape_date": target,
            "available_dates": all_dates,
            "summary": {
                "total_category_gaps": total_category_gaps,
                "total_price_gaps": total_price_gaps,
                "promo_gaps": sum(1 for g in group_results if g.get("promo_gap")),
                "groups_analyzed": len(group_results),
            },
            "groups": group_results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@insights_router.get("/menu-gaps/ai")
async def menu_gap_ai_insights(scrape_date: str = None, force: bool = False, country: str = "UAE"):
    """
    AI menu gap analysis — brand-by-brand, sends actual category items + descriptions
    so Claude can identify protein gaps, offering types missing, specific menu holes.
    Returns array of per-brand insights.
    """
    try:
        gap_data = await menu_gap_analysis(scrape_date, country)
        if not gap_data["has_data"]:
            return {"has_data": False, "insights": None}

        target = gap_data["scrape_date"]
        cache_key = f"menugap_ai_v3_{target}_{country}"

        if not force:
            cached = get_cached_insight(cache_key)
            if cached:
                return {"has_data": True, "scrape_date": target, "insights": cached, "cached": True}

        # Need full item data for descriptions — fetch from DB
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT brand_name, items FROM scrapes WHERE scrape_date = %s", (target,))
            scrape_data = {r["brand_name"]: r["items"] for r in cur.fetchall()}
            cur.execute("SELECT own_brand, competitors, group_order FROM brand_groups ORDER BY group_order")
            groups = cur.fetchall()
            cur.close()

        brand_blocks = []
        for group in groups:
            own_brand = group["own_brand"]
            competitors = list(group["competitors"]) if group["competitors"] else []
            own_items = scrape_data.get(own_brand, {})
            if not own_items:
                continue

            # Own brand: category → items with descriptions
            own_by_cat = defaultdict(list)
            for name, data in own_items.items():
                price = get_price(data)
                if price <= 0:
                    continue
                cat = get_category(data) or infer_category(name)
                desc = get_description(data)[:50].replace("\n", " ")
                if desc:
                    own_by_cat[cat].append(f"{name} ({price} AED) - {desc}")
                else:
                    own_by_cat[cat].append(f"{name} ({price} AED)")

            own_summary = []
            for cat in sorted(own_by_cat.keys()):
                items = own_by_cat[cat]
                own_summary.append(f"  {cat} ({len(items)}): {', '.join(items[:8])}")

            # Competitors: same format
            comp_summaries = []
            for comp in competitors:
                comp_items = scrape_data.get(comp, {})
                if not comp_items:
                    continue
                comp_by_cat = defaultdict(list)
                for name, data in comp_items.items():
                    price = get_price(data)
                    if price <= 0:
                        continue
                    cat = get_category(data) or infer_category(name)
                    desc = get_description(data)[:50].replace("\n", " ")
                    if desc:
                        comp_by_cat[cat].append(f"{name} ({price} AED) - {desc}")
                    else:
                        comp_by_cat[cat].append(f"{name} ({price} AED)")

                comp_cats = []
                for cat in sorted(comp_by_cat.keys()):
                    items = comp_by_cat[cat]
                    comp_cats.append(f"    {cat} ({len(items)}): {', '.join(items[:8])}")

                missing_detail = ""

                comp_summaries.append(
                    f"  {comp} ({len(comp_items)} items):\n" + "\n".join(comp_cats[:15]) + missing_detail
                )

            block = (
                f"[{own_brand}] OWN — {len(own_items)} items\n"
                + "\n".join(own_summary[:15]) + "\n"
                + "COMPETITORS:\n" + "\n".join(comp_summaries)
            )
            brand_blocks.append(block)

        prompt = f"""You are a menu strategist for UAE restaurant brands on Talabat. Analyze each brand's menu vs its competitors.

{chr(10).join(brand_blocks)}

IMPORTANT: When comparing categories between brands, use SEMANTIC matching — not exact string matching. Category names vary across brands (e.g. "Kids Meal" might appear under a parent category like "Operational Falafel > Kids Meal"). If a brand has items of a certain type under any category name, do NOT flag that type as missing. Focus on actual menu content and item descriptions, not category labels.

For EACH own brand, write the brand name on its own line, then 3-5 bullet points below it. Each bullet must be one short actionable sentence with specific items, categories, or AED prices. Cover:
- Missing food TYPES that competitors sell (e.g. seafood, keto, breakfast, desserts, vegetarian, kids meals) — only flag as missing if the brand truly lacks those items, regardless of category naming
- Specific items from competitors worth adding (name the item and price)
- Category depth gaps (e.g. "Competitor has 15 pasta options vs your 3")
- Protein or dietary gaps (missing chicken/beef/seafood/vegan options)
- Quick win: the single highest-impact item to add first

Format exactly like this:
BRANDNAME
- First bullet point
- Second bullet point
- Third bullet point

NEXTBRAND
- First bullet point

Keep each bullet under 20 words. No paragraphs. No bold. No asterisks. Just dashes for bullets."""

        ai_text = await call_claude(prompt, max_tokens=900)

        brand_insights = _parse_brand_insights(ai_text, [g["own_brand"] for g in groups])
        result = {"brand_insights": brand_insights, "generated_at": datetime.now(timezone.utc).isoformat()}

        if ai_text:
            set_cached_insight(cache_key, "menugap_ai_v3", result)

        return {"has_data": True, "scrape_date": target, "insights": result, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
