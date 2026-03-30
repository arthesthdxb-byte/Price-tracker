# Menu Price Tracker

## Overview
A full-stack web application for tracking and comparing food menu prices across different restaurant brands over time. Built for Talabat UAE competitive pricing intelligence.

## Architecture
- **Frontend**: React 19 with Tailwind CSS, Radix UI (Shadcn pattern), CRACO build system
- **Backend**: Python FastAPI with PostgreSQL database
- **Database**: Replit's built-in PostgreSQL (via psycopg2)

## Project Structure
```
frontend/          # React frontend (CRA + CRACO)
  src/
    components/    # UI components (Dashboard.js is the main view)
    hooks/         # Custom React hooks
    lib/           # Utility functions
  craco.config.js  # Webpack/ESLint config with dev server settings
  package.json     # Node dependencies

backend/           # Python FastAPI backend
  server.py        # Main API server with all routes
  insights_router.py # Combo Insights & Menu Gap Analyzer API router
  competitor_router.py # Competitor Price Check API router
  requirements.txt # Python dependencies

frontend/          # React frontend (CRA + CRACO)
  src/
    pages/         # Feature view pages
      InsightsViews.jsx  # ComboInsightsView & MenuGapAnalyzerView components
      CompetitorPriceCheck.jsx  # Competitor Price Check view
```

## Database Schema (PostgreSQL)
- **baseline**: Stores baseline price data per brand (brand_name, items JSONB, baseline_date)
- **scrapes**: Stores daily scrape data with comparisons (scrape_date, brand_name, items JSONB, vs_baseline JSONB, vs_previous JSONB, ai_summary)
- **brand_groups**: Stores brand groupings (own_brand, competitors TEXT[], group_order)
- **npd_summaries**: Caches AI-generated NPD summaries by date pair (latest_date, previous_date, summary, created_at)
- **ai_insight_cache**: Caches AI insights for Combo & Menu Gap features (cache_key, insight_type, insight_data JSONB, created_at)
- **competitor_item_matches**: Caches AI-matched item pairs between own brands and competitors (own_brand, own_item_name, competitor_brand, matched_item_name, match_confidence, data_hash)
- **competitor_price_analysis**: Caches AI pricing analysis results keyed by data hash (data_hash, analysis_text, created_at)

## Development
- Frontend runs on port 5000 (webview workflow)
- Backend API runs on port 8000 (console workflow)
- Frontend connects to backend via relative `/api` path (proxied to localhost:8000 in dev via craco.config.js)

## Key Features
- Upload baseline pricing data from Excel files
- Upload daily scrape data and auto-compare against baseline
- Brand group management (own brands vs competitors)
- Historical price trend analysis
- AI-generated summaries (requires ANTHROPIC_API_KEY)
- Excel export of comparison results
- Competitor Price Check: per-item competitor price comparison with AI-powered fuzzy name matching and strategic pricing analysis, with caching
- NPD (New Product Development) Tracker: identifies newly launched and removed menu items between consecutive scrape dates, with AI-powered summaries
- Combo Insights: analyzes combo/meal/deal items across brands with price tier breakdowns, gap identification, and AI recommendations
- Menu Gap Analyzer: identifies missing categories, price range gaps, and variety gaps between own brands and competitors with AI recommendations
- Enriched item format support: items can be float OR dict with price, original_price, description, category, image_url (use get_price()/get_item_detail() helpers)
- Apify webhook integration for automated scrape data ingestion

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (auto-set by Replit)
- `APIFY_TOKEN`: Required for Apify webhook automated scrape ingestion
- `ANTHROPIC_API_KEY`: Optional, for AI summary generation
- `CORS_ORIGINS`: Optional, comma-separated allowed origins

## Deployment
- Build: `cd frontend && npm run build`
- Run: `cd backend && uvicorn server:app --host 0.0.0.0 --port 5000`
- In production, backend serves the frontend build as static files
