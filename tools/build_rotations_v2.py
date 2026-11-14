#!/usr/bin/env python3
"""Rebuild data/rotations.json (v2) from the v1 library and validate it.

    python3 tools/build_rotations_v2.py            # build, validate, write data/rotations.json
    python3 tools/build_rotations_v2.py --check    # build, validate, fail if data/rotations.json differs
    python3 tools/build_rotations_v2.py --validate-only data/rotations.json

Inputs (defaults):
    tools/rotations_v1.json        the v1 library (48 rotations, 7 regions), as committed before v2
    tools/rotations_v2_delta.json  what v2 adds or changes: crops, regions with match rules, rotations

Validation also checks data/pests.json, whose crop and region ids must resolve in the library, and
data/region-test-points.json: every region needs at least one known point, and each point must match
its expected region (the same file drives packages/library/region.test.ts).
Exit code 0 = OK, 1 = validation failed or --check found a difference.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IRRIGATION = {"required", "optional", "none"}
WATER = {"low", "medium", "high"}
GOALS = {"margin", "water", "soil", "drought"}
TIERS = {"A", "B", "C"}
HEMISPHERES = {"N", "S"}

def build(v1, delta):
    out = {"version": delta["version"], "notes": delta["notes"]}

    crops = dict(v1["crops"])
    for cid, crop in delta["crops_added"].items():
        if cid in crops:
            raise ValueError(f"crop {cid} already exists in v1")
        crops[cid] = crop
    out["crops"] = crops

    regions = {}
    for rid in delta["region_order"]:
        region = dict(v1["regions"].get(rid, {}))
        region.update(delta["regions"].get(rid, {}))
        regions[rid] = region
    missing = set(v1["regions"]) - set(regions)
    if missing:
        raise ValueError(f"v1 regions dropped from region_order: {sorted(missing)}")
    out["regions"] = regions

    ids = {r["id"] for r in v1["rotations"]}
    added = delta["rotations_added"]
    clash = ids & {r["id"] for r in added}
    if clash:
        raise ValueError(f"added rotations reuse v1 ids: {sorted(clash)}")
    out["rotations"] = list(v1["rotations"]) + list(added)
    return out


def seq_crops(item):
    if isinstance(item, str):
        return [item]
    if isinstance(item, dict) and set(item) == {"main", "second"}:
        return [item["main"], item["second"]]
    raise ValueError(f"bad sequence item {item!r}")


def region_for(lib, admin, lat, lon):
    country = admin.split("-")[0]
    for rid, region in lib["regions"].items():
        for rule in region.get("match", []):
            codes = rule.get("admin", [])
            if admin not in codes and country not in codes:
                continue
            if "lat" in rule and not (rule["lat"][0] <= lat <= rule["lat"][1]):
                continue
            if "lon" in rule and not (rule["lon"][0] <= lon <= rule["lon"][1]):
                continue
            return rid
    return None


def validate(lib, pests=None, points=None):
    errors = []
    err = errors.append
    crops, regions, rotations = lib["crops"], lib["regions"], lib["rotations"]

    for cid, c in crops.items():
        if not (c.get("en") and c.get("uk") and c.get("family")):
            err(f"crop {cid}: needs en, uk, family")

    for rid, r in regions.items():
        if not (r.get("en") and r.get("uk")):
            err(f"region {rid}: needs en and uk")
        if r.get("tier") not in TIERS:
            err(f"region {rid}: tier must be one of {sorted(TIERS)}")
        if r.get("hemisphere") not in HEMISPHERES:
            err(f"region {rid}: hemisphere must be N or S")
        p = r.get("precipMm")
        if not (isinstance(p, list) and len(p) == 2 and p[0] < p[1]):
            err(f"region {rid}: precipMm must be [min, max]")
        if not r.get("countries"):
            err(f"region {rid}: countries missing")
        if not isinstance(r.get("verify"), bool):
            err(f"region {rid}: verify must be true or false")
        rules = r.get("match")
        if not rules:
            err(f"region {rid}: no match rules")
        for i, rule in enumerate(rules or []):
            if not rule.get("admin"):
                err(f"region {rid} rule {i}: admin codes missing")
            for code in rule.get("admin", []):
                if code.split("-")[0] not in r.get("countries", []):
                    err(f"region {rid} rule {i}: {code} is not in the region's countries")
            for axis, lo, hi in (("lat", -90, 90), ("lon", -180, 180)):
                if axis in rule:
                    b = rule[axis]
                    if not (len(b) == 2 and lo <= b[0] < b[1] <= hi):
                        err(f"region {rid} rule {i}: bad {axis} bounds {b}")

    seen = set()
    per_region = {rid: {"count": 0, "baseline": 0} for rid in regions}
    for r in rotations:
        rid = r.get("id")
        where = f"rotation {rid}"
        if rid in seen:
            err(f"{where}: duplicate id")
        seen.add(rid)
        if r.get("region") not in regions:
            err(f"{where}: unknown region {r.get('region')}")
        else:
            per_region[r["region"]]["count"] += 1
            per_region[r["region"]]["baseline"] += bool(r.get("baseline"))
        seq = r.get("sequence") or []
        if not 1 <= len(seq) <= 6:
            err(f"{where}: sequence must have 1-6 seasons")
        for item in seq:
            try:
                for c in seq_crops(item):
                    if c not in crops:
                        err(f"{where}: unknown crop {c}")
            except ValueError as e:
                err(f"{where}: {e}")
        if "cover" in r and r["cover"] not in crops:
            err(f"{where}: unknown cover crop {r['cover']}")
        if r.get("irrigation") not in IRRIGATION:
            err(f"{where}: irrigation must be one of {sorted(IRRIGATION)}")
        if r.get("water") not in WATER:
            err(f"{where}: water must be one of {sorted(WATER)}")
        if not r.get("goals") or not set(r["goals"]) <= GOALS:
            err(f"{where}: goals must be a non-empty subset of {sorted(GOALS)}")
        for field in ("name", "rationale", "risks"):
            if not (r.get(field, {}).get("en") and r.get(field, {}).get("uk")):
                err(f"{where}: {field} needs en and uk")

    for rid, n in per_region.items():
        if n["count"] < 3:
            err(f"region {rid}: {n['count']} rotations, needs at least 3")
        if n["baseline"] < 1:
            err(f"region {rid}: no baseline rotation")

    if points is not None:
        covered = set()
        for pt in points["points"]:
            got = region_for(lib, pt["admin"], pt["lat"], pt["lon"])
            if got != pt["region"]:
                err(f"match test {pt['name']}: got {got}, expected {pt['region']}")
            if pt["region"]:
                covered.add(pt["region"])
        for rid in regions:
            if rid not in covered:
                err(f"region {rid}: no known test point in region-test-points.json")

    if pests:
        for p in pests["pests"]:
            for c in p["crops"]:
                if c not in crops:
                    err(f"pests.json {p['id']}: unknown crop {c}")
            for reg in p["regions"]:
                if reg not in regions:
                    err(f"pests.json {p['id']}: unknown region {reg}")
    return errors


def summary(lib):
    countries = {c for r in lib["regions"].values() for c in r["countries"]}
    used = {c for r in lib["rotations"] for item in r["sequence"] for c in seq_crops(item)}
    used |= {r["cover"] for r in lib["rotations"] if "cover" in r}
    double = sum(any(isinstance(i, dict) for i in r["sequence"]) for r in lib["rotations"])
    unverified = [rid for rid, r in lib["regions"].items() if r.get("verify")]
    return (
        f"{len(lib['rotations'])} rotations, {len(lib['regions'])} regions, {len(countries)} countries, "
        f"{len(lib['crops'])} crops ({len(lib['crops']) - len(used)} unused: "
        f"{', '.join(sorted(set(lib['crops']) - used)) or '-'}), "
        f"{double} with double cropping, {len(unverified)} regions marked verify"
    )


def dump(lib):
    return json.dumps(lib, ensure_ascii=False, indent=2) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--v1", default=ROOT / "tools/rotations_v1.json", type=Path)
    ap.add_argument("--delta", default=ROOT / "tools/rotations_v2_delta.json", type=Path)
    ap.add_argument("--out", default=ROOT / "data/rotations.json", type=Path)
    ap.add_argument("--pests", default=ROOT / "data/pests.json", type=Path)
    ap.add_argument("--points", default=ROOT / "data/region-test-points.json", type=Path)
    ap.add_argument("--check", action="store_true", help="do not write; fail if --out differs from the build")
    ap.add_argument("--validate-only", type=Path, metavar="FILE", help="only validate an existing library file")
    args = ap.parse_args()

    pests = json.loads(args.pests.read_text()) if args.pests.exists() else None
    points = json.loads(args.points.read_text()) if args.points.exists() else None

    if args.validate_only:
        lib = json.loads(args.validate_only.read_text())
    else:
        lib = build(json.loads(args.v1.read_text()), json.loads(args.delta.read_text()))

    errors = validate(lib, pests, points)
    if errors:
        print(f"{len(errors)} validation error(s):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("valid:", summary(lib))

    if args.validate_only:
        return 0
    text = dump(lib)
    if args.check:
        if not args.out.exists() or args.out.read_text() != text:
            print(f"{args.out} differs from the build; run without --check to rewrite it", file=sys.stderr)
            return 1
        print(f"{args.out} matches the build")
        return 0
    args.out.write_text(text)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
