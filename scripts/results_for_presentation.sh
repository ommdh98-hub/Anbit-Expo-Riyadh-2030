#!/usr/bin/env bash
# Regenerates docs/RESULTS_FOR_PRESENTATION.md from fresh audits and test runs.
set -euo pipefail
cd "$(dirname "$0")/.."
logs="$(mktemp -d)"
node research/simulation/audit_twin.mjs frontend/lib/twin 5 28 riyadh generated > research/simulation/audit_weather_generated.json
node research/simulation/audit_twin.mjs frontend/lib/twin 5 28 riyadh real2025 > research/simulation/audit_weather_real2025.json
node research/simulation/audit_sensor_count.mjs > research/simulation/audit_sensor_count.json
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q > "$logs/pytest.log" 2>&1 || true
node --test frontend/tests/*.mjs > "$logs/node.log" 2>&1 || true
tail -1 "$logs/pytest.log"
grep -E "^ℹ (tests|pass|fail)" "$logs/node.log"
python3 -I research/simulation/results_for_presentation.py "$logs/pytest.log" "$logs/node.log"
