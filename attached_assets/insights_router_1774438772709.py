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


# ── Combo detection ──
COMBO_KEYWORDS = [
    r'\bcombo\b', r'\bmeal\b', r'\bdeal\b', r'\boffer\b', r'\bbundle\b',
    r'\bbox\b', r'\bfeast\b', r'\bplatter\b', r'\bsharing\b', r'\bfamily\b',
    r'\bfor\s*2\b', r'\bfor\s*two\b', r'\bfor\s*3\b', r'\bfor\s*4\b',
    r'\bvalue\b', r'\bbucket\b', r'\bsaver\b', r'\bspecial\b',
    r'\bset\b', r'\bgroup\b', r'\bpersons?\b',
]
COMBO_PATTERN = re.compile('|'.join(COMBO_KEYWORDS), re.IGNORECASE)

def is_combo(item_name: str, description: str = "") -> bool:
    return bool(COMBO_PATTERN.search(item_name) or COMBO_PATTERN.search(description))


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

def infer_category(item_name: str, stored_category: str = "") -> str:
    if stored_category and stored_category.strip():
        return stored_category.strip()
    for pattern, category in CATEGORY_COMPILED:
        if pattern.search(item_name):
            return category
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
async def combo_insights(scrape_date: str = None):
    """Full combo analysis with price tiers, gaps, and AI recommendations per group."""
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT DISTINCT scrape_date FROM scrapes")
            all_dates = sorted([r["scrape_date"] for r in cur.fetchall()], key=parse_date_for_sorting)
            target = scrape_date if scrape_date and scrape_date in all_dates else (all_dates[-1] if all_dates else None)
            if not target:
                return {"has_data": False, "groups": [], "available_dates": []}

            cur.execute("SELECT brand_name, items FROM scrapes WHERE scrape_date = %s", (target,))
            scrape_data = {r["brand_name"]: r["items"] for r in cur.fetchall()}

            cur.execute("SELECT own_brand, competitors, group_order FROM brand_groups ORDER BY group_order")
            groups = cur.fetchall()
            cur.close()

        def _extract_combos(items: dict) -> list:
            combos = []
            for name, data in items.items():
                price = get_price(data)
                if price <= 0:
                    continue
                desc = get_description(data)
                cat = get_category(data) or infer_category(name)
                if is_combo(name, desc):
                    combos.append({"name": name, "price": price, "category": cat, "description": desc[:100]})
            return sorted(combos, key=lambda x: x["price"])

        def _brand_combo_data(brand_name, items):
            combos = _extract_combos(items)
            non_combo_prices = [get_price(v) for k, v in items.items() if get_price(v) > 0 and not is_combo(k, get_description(v))]
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


@insights_router.get("/combos/ai")
async def combo_ai_insights(scrape_date: str = None, force: bool = False):
    """
    AI-generated combo recommendations. Minimal tokens — sends only numbers, not item lists.
    Cached per date.
    """
    try:
        # Get combo data first
        combo_data = await combo_insights(scrape_date)
        if not combo_data["has_data"]:
            return {"has_data": False, "insights": None}

        target = combo_data["scrape_date"]
        cache_key = f"combo_ai_{target}"

        if not force:
            cached = get_cached_insight(cache_key)
            if cached:
                return {"has_data": True, "scrape_date": target, "insights": cached, "cached": True}

        # Build minimal prompt — numbers only, no item names
        lines = []
        for g in combo_data["groups"]:
            own = g["own_data"]
            gaps_str = "; ".join([f"{gap['tier']}: {gap['detail']}" for gap in g["price_gaps"]]) if g["price_gaps"] else "none"
            comp_summary = ", ".join([f"{c['brand_name']}({c['combo_count']} combos, avg {c['avg_combo_price']}AED)" for c in g["competitors"]])
            lines.append(
                f"{own['brand_name']}: {own['combo_count']} combos/{own['total_items']} items, "
                f"avg {own['avg_combo_price']}AED, range {own['min_combo']}-{own['max_combo']}AED, "
                f"tiers[0-19:{own['tiers']['0-19']['count']},20-29:{own['tiers']['20-29']['count']},"
                f"30-39:{own['tiers']['30-39']['count']},40-49:{own['tiers']['40-49']['count']},"
                f"50+:{own['tiers']['50+']['count']}] | "
                f"Competitors: {comp_summary} | Gaps: {gaps_str}"
            )

        prompt = f"""You are a menu pricing strategist for UAE restaurant brands on Talabat.

Data for {target} — each line is one brand group (own brand | competitors | gaps):
{chr(10).join(lines)}

Give SPECIFIC, ACTIONABLE combo insights in plain text only (no markdown/formatting):
1. Which brands are missing combo opportunities and at what exact price points
2. Where own brands are overpriced/underpriced vs competitors on combos
3. Top 3 concrete combo recommendations with suggested AED price points
4. Any brand that has zero combos but should have them based on competitor activity

Be direct and specific with numbers. No generic advice. 5-8 sentences max."""

        ai_text = await call_claude(prompt, max_tokens=350)
        result = {"text": ai_text, "generated_at": datetime.now(timezone.utc).isoformat()}

        if ai_text:
            set_cached_insight(cache_key, "combo_ai", result)

        return {"has_data": True, "scrape_date": target, "insights": result, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────────────────
# 2. MENU GAP ANALYZER
# ──────────────────────────────────────────────────────────

@insights_router.get("/menu-gaps")
async def menu_gap_analysis(scrape_date: str = None):
    """
    Per brand group: identify category gaps, price tier gaps, and item-type gaps
    between own brand and competitors.
    """
    try:
        with get_db() as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("SELECT DISTINCT scrape_date FROM scrapes")
            all_dates = sorted([r["scrape_date"] for r in cur.fetchall()], key=parse_date_for_sorting)
            target = scrape_date if scrape_date and scrape_date in all_dates else (all_dates[-1] if all_dates else None)
            if not target:
                return {"has_data": False, "groups": [], "available_dates": []}

            cur.execute("SELECT brand_name, items FROM scrapes WHERE scrape_date = %s", (target,))
            scrape_data = {r["brand_name"]: r["items"] for r in cur.fetchall()}

            cur.execute("SELECT own_brand, competitors, group_order FROM brand_groups ORDER BY group_order")
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

            # Aggregate: categories that ANY competitor has but own brand doesn't
            all_missing = all_comp_cats - own_cat_set - {"Other", "Add-ons & Extras"}

            total_category_gaps += len(all_missing)
            total_price_gaps += sum(len(ca["price_gaps"]) for ca in comp_analyses)

            group_results.append({
                "own_brand": own_brand,
                "own_total_items": len(own_items),
                "own_categories": own_cats,
                "own_price_distribution": own_dist,
                "own_category_count": len(own_cat_set),
                "all_missing_categories": sorted(all_missing),
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
                "groups_analyzed": len(group_results),
            },
            "groups": group_results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@insights_router.get("/menu-gaps/ai")
async def menu_gap_ai_insights(scrape_date: str = None, force: bool = False):
    """AI-generated menu gap recommendations. Sends only aggregated numbers to Claude."""
    try:
        gap_data = await menu_gap_analysis(scrape_date)
        if not gap_data["has_data"]:
            return {"has_data": False, "insights": None}

        target = gap_data["scrape_date"]
        cache_key = f"menugap_ai_{target}"

        if not force:
            cached = get_cached_insight(cache_key)
            if cached:
                return {"has_data": True, "scrape_date": target, "insights": cached, "cached": True}

        # Build minimal prompt
        lines = []
        for g in gap_data["groups"]:
            missing = ", ".join(g["all_missing_categories"]) if g["all_missing_categories"] else "none"
            own_cats = ", ".join([f"{k}({v['count']})" for k, v in sorted(g["own_categories"].items(), key=lambda x: -x[1]["count"])[:6]])
            own_dist = ", ".join([f"{k}:{v}" for k, v in g["own_price_distribution"].items() if v > 0])

            comp_lines = []
            for ca in g["competitors"]:
                depth = "; ".join([f"{d['category']}(you:{d['own_count']} vs {d['comp_count']})" for d in ca["depth_gaps"][:3]])
                price_g = "; ".join([f"{pg['range']} AED: {pg['detail']}" for pg in ca["price_gaps"][:3]])
                comp_lines.append(f"  vs {ca['brand_name']}({ca['total_items']} items) — depth gaps: {depth or 'none'}, price gaps: {price_g or 'none'}")

            lines.append(
                f"{g['own_brand']} ({g['own_total_items']} items, {g['own_category_count']} cats): "
                f"top cats=[{own_cats}], price dist=[{own_dist}], "
                f"missing categories=[{missing}]\n" + "\n".join(comp_lines)
            )

        prompt = f"""You are a menu strategist for UAE Talabat restaurant brands.

Menu gap analysis for {target}:
{chr(10).join(lines)}

Give SPECIFIC, ACTIONABLE recommendations in plain text only (no markdown/formatting):
1. Which missing categories represent the biggest revenue opportunity and why
2. Specific price ranges where brands should add items (with AED figures)
3. Where competitors have significantly more variety and what to do about it
4. Top 3 highest-priority menu additions across all brands with suggested price points

Be specific with brand names, categories, and AED numbers. No generic advice. 6-8 sentences max."""

        ai_text = await call_claude(prompt, max_tokens=400)
        result = {"text": ai_text, "generated_at": datetime.now(timezone.utc).isoformat()}

        if ai_text:
            set_cached_insight(cache_key, "menugap_ai", result)

        return {"has_data": True, "scrape_date": target, "insights": result, "cached": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
