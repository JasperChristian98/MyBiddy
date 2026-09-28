#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "data" / "players.json"

data = json.loads(path.read_text(encoding="utf-8"))
errors = []
warnings = []
ids = set()

for p in data.get("players", []):
    pid = p.get("id")
    if pid in ids:
        errors.append(f"{p.get('name')}: duplicate id {pid}")
    ids.add(pid)

    clubs = p.get("eligible_clubs", [])
    keys = []
    for c in clubs:
        # Match scraper's practical notion of duplicate club key.
        key = "".join(ch for ch in c["name"].casefold() if ch.isalnum())
        keys.append(key)
        if c.get("league_appearances", 0) < 1:
            errors.append(f"{p['name']}: ineligible club in eligible_clubs: {c['name']}")

    if len(keys) != len(set(keys)):
        warnings.append(f"{p['name']}: possible duplicate eligible club")
    if len(clubs) != p.get("eligible_club_count"):
        errors.append(f"{p['name']}: club count mismatch")
    if len(clubs) < 2:
        warnings.append(f"{p['name']}: fewer than 2 eligible clubs")

print(f"Players: {len(data.get('players', []))}")
print(f"Errors: {len(errors)}")
print(f"Warnings: {len(warnings)}")

for x in errors[:100]:
    print("ERROR:", x)
for x in warnings[:100]:
    print("WARN :", x)

raise SystemExit(1 if errors else 0)
