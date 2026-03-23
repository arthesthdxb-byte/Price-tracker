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
  requirements.txt # Python dependencies
```

## Database Schema (PostgreSQL)
- **baseline**: Stores baseline price data per brand (brand_name, items JSONB, baseline_date)
- **scrapes**: Stores daily scrape data with comparisons (scrape_date, brand_name, items JSONB, vs_baseline JSONB, vs_previous JSONB, ai_summary)
- **brand_groups**: Stores brand groupings (own_brand, competitors TEXT[], group_order)

## Development
- Frontend runs on port 5000 (webview workflow)
- Backend API runs on port 8000 (console workflow)
- Frontend connects to backend via `REACT_APP_BACKEND_URL` env var

## Key Features
- Upload baseline pricing data from Excel files
- Upload daily scrape data and auto-compare against baseline
- Brand group management (own brands vs competitors)
- Historical price trend analysis
- AI-generated summaries (requires ANTHROPIC_API_KEY)
- Excel export of comparison results
- Server-side Excel upload endpoint at POST /api/upload-excel

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (auto-set by Replit)
- `REACT_APP_BACKEND_URL`: Backend URL for frontend API calls
- `ANTHROPIC_API_KEY`: Optional, for AI summary generation
- `CORS_ORIGINS`: Optional, comma-separated allowed origins

## Deployment
- Build: `cd frontend && npm run build`
- Run: `cd backend && uvicorn server:app --host 0.0.0.0 --port 5000`
- In production, backend serves the frontend build as static files
