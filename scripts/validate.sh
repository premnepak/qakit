#!/usr/bin/env bash
# QAKit validation script
# Run from repo root: ./scripts/validate.sh
# Exits 0 if all checks pass, 1 otherwise.

set -e

SRC_DIR="src"
FAIL=0

# Colors (only when terminal supports it)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; NC=''
fi

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=1; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
section() { echo ""; echo -e "${BLUE}── $1 ──${NC}"; }

# ─────────────────────────────────────────────────────────────
# Pre-checks
# ─────────────────────────────────────────────────────────────
if [ ! -d "$SRC_DIR" ]; then
  echo -e "${RED}ERROR: src/ directory not found. Run from repo root.${NC}"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}ERROR: node not found. Install Node.js to run JS syntax checks.${NC}"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo -e "${RED}ERROR: python3 not found. Required for HTML balance check.${NC}"
  exit 1
fi

echo "============================================================"
echo "  QAKit validation"
echo "============================================================"

# ─────────────────────────────────────────────────────────────
# 1. JS syntax check (excluding spell-bundle.js)
# ─────────────────────────────────────────────────────────────
section "1. JS syntax (excluding spell-bundle.js)"
ok_count=0
bad_count=0
for f in "$SRC_DIR"/*.js; do
  fname=$(basename "$f")
  [ "$fname" = "spell-bundle.js" ] && continue

  out=$(node --check "$f" 2>&1)
  if [ -z "$out" ]; then
    ok_count=$((ok_count + 1))
  else
    fail "$fname: $(echo "$out" | head -2 | tail -1)"
    bad_count=$((bad_count + 1))
  fi
done
if [ "$bad_count" = "0" ]; then
  ok "$ok_count JS files clean"
else
  fail "$bad_count file(s) have syntax errors"
fi

# ─────────────────────────────────────────────────────────────
# 2. HTML balance
# ─────────────────────────────────────────────────────────────
section "2. HTML tag balance"
python3 << PYEOF
import re, sys
import os
SRC = '$SRC_DIR'
files = ['popup.html','json-diff-tool.html','text-compare.html','help.html','privacy-policy.html']
all_ok = True
for fname in files:
    path = os.path.join(SRC, fname)
    if not os.path.exists(path):
        print(f'  ⚠ {fname} not found')
        continue
    c = open(path).read()
    issues = []
    tags = ['div','button','select','option','label','script','style','span',
            'section','textarea','pre','header','table','tr','td','th',
            'ul','ol','li','h1','h2','h3','h4','p','nav','footer','main','article']
    for tag in tags:
        opens = len(re.findall(rf'<{tag}[\s>]', c))
        closes = len(re.findall(rf'</{tag}>', c))
        if opens != closes:
            issues.append(f'{tag}:{opens}/{closes}')
    if issues:
        print(f'  ✗ {fname}: {", ".join(issues)}')
        all_ok = False
    else:
        print(f'  ✓ {fname}')
sys.exit(0 if all_ok else 1)
PYEOF

if [ $? -ne 0 ]; then FAIL=1; fi

# ─────────────────────────────────────────────────────────────
# 3. Manifest validation
# ─────────────────────────────────────────────────────────────
section "3. Manifest"
python3 << PYEOF
import json, sys, os
try:
    m = json.load(open('$SRC_DIR/manifest.json'))
except Exception as e:
    print(f'  ✗ manifest.json invalid JSON: {e}')
    sys.exit(1)

errors = []
if m.get('manifest_version') != 3:
    errors.append('manifest_version must be 3')
if not m.get('version'):
    errors.append('version is missing')
if not m.get('name'):
    errors.append('name is missing')
if not m.get('description'):
    errors.append('description is missing')
elif len(m['description']) > 132:
    errors.append(f'description is {len(m["description"])} chars (max 132)')

# Check icons exist
for size in ['16','48','128']:
    p = m.get('icons', {}).get(size)
    if not p or not os.path.exists(os.path.join('$SRC_DIR', p)):
        errors.append(f'icon {size} missing or path invalid: {p}')

# WAR resources
miss = []
for r in m.get('web_accessible_resources', []):
    for f in r.get('resources', []):
        if not os.path.exists(os.path.join('$SRC_DIR', f)):
            miss.append(f)
total_war = sum(len(r['resources']) for r in m.get('web_accessible_resources', []))

if errors:
    for e in errors: print(f'  ✗ {e}')
    sys.exit(1)
else:
    print(f'  ✓ manifest_version: {m["manifest_version"]}')
    print(f'  ✓ name: {m["name"]} v{m["version"]}')
    print(f'  ✓ description: {len(m["description"])}/132 chars')
    print(f'  ✓ icons 16/48/128 present')
    if miss:
        print(f'  ✗ MISSING WAR resources: {miss}')
        sys.exit(1)
    else:
        print(f'  ✓ all {total_war} WAR resources present')
PYEOF
if [ $? -ne 0 ]; then FAIL=1; fi

# ─────────────────────────────────────────────────────────────
# 4. Brand consistency
# ─────────────────────────────────────────────────────────────
section "4. Brand consistency"
if grep -rli "kahulogic\|qantas" "$SRC_DIR" 2>/dev/null | grep -v spell-bundle.js > /dev/null; then
  fail "Found legacy brand references (kahulogic/qantas):"
  grep -rli "kahulogic\|qantas" "$SRC_DIR" 2>/dev/null | grep -v spell-bundle.js | sed 's/^/    /'
else
  ok "No legacy brand references"
fi

if grep -l "qakit.extension@gmail.com" "$SRC_DIR/help.html" "$SRC_DIR/privacy-policy.html" >/dev/null 2>&1; then
  ok "Support email present in help.html and privacy-policy.html"
else
  warn "Support email may be missing in help.html or privacy-policy.html"
fi

# ─────────────────────────────────────────────────────────────
# 5. Critical guards present
# ─────────────────────────────────────────────────────────────
section "5. Critical guards"

# Inspector race condition guard
if grep -q "if (!window.__qInspectorActive) { hideAll(); return; }" "$SRC_DIR/inspector.js" 2>/dev/null; then
  ok "Inspector rAF guard present (Fix 75)"
else
  fail "Inspector rAF guard missing — green border may persist after Esc"
fi

# Page Audit urlKey declaration
if grep -q "const urlKey = auditKeyForUrl" "$SRC_DIR/page-audit.js" 2>/dev/null; then
  ok "Page Audit urlKey declared (Fix 78)"
else
  fail "Page Audit urlKey not declared — history will be empty"
fi

# Console noise filter
if grep -q "NOISE_PATTERNS" "$SRC_DIR/console-shim.js" 2>/dev/null; then
  ok "Console noise filter present (Fix 80)"
else
  warn "Console noise filter not found"
fi

# ─────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
if [ "$FAIL" = "0" ]; then
  echo -e "  ${GREEN}✓ All validation checks passed${NC}"
  echo "============================================================"
  exit 0
else
  echo -e "  ${RED}✗ Validation failed${NC}"
  echo "============================================================"
  exit 1
fi
