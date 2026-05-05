#!/usr/bin/env bash
# KargoPazar — local development launcher (frontend-only)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/frontend"
npm install
npm run dev
