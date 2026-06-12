#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:3000"

echo "Running smoke tests against $BASE"

# check home
if ! curl -sS "$BASE/" | grep -q "MarmitaTech"; then
  echo "[FAIL] GET / did not contain expected content"
  exit 1
fi

echo "[OK] GET /"

# check dashboard
if ! curl -sS "$BASE/dashboard" | grep -q "MarmitaTech - Dashboard"; then
  echo "[FAIL] GET /dashboard did not contain expected content"
  exit 1
fi

echo "[OK] GET /dashboard"

# create a test order
STATUS_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/orders" -d "customer_name=SmokeTest&item_id=1")
if [ "$STATUS_CODE" != "302" ]; then
  echo "[FAIL] POST /orders returned status $STATUS_CODE"
  exit 1
fi

echo "[OK] POST /orders -> $STATUS_CODE"

# ensure created order appears on dashboard
if ! curl -sS "$BASE/dashboard" | grep -q "SmokeTest"; then
  echo "[FAIL] created order 'SmokeTest' not found on dashboard"
  exit 1
fi

echo "[OK] Created order visible on dashboard"

# check static CSS
if ! curl -sS -I "$BASE/theme.css" | head -n1 | grep -q "200"; then
  echo "[FAIL] theme.css not served (non-200)"
  exit 1
fi

echo "[OK] theme.css served"

echo "All smoke tests passed"
