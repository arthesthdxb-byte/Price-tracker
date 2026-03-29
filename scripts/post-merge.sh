#!/bin/bash
set -e

cd /home/runner/workspace

pip install -q -r backend/requirements.txt 2>/dev/null || true

cd frontend
npm install --legacy-peer-deps --no-audit --no-fund 2>/dev/null || true
npm run build 2>/dev/null || true
