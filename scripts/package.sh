#!/usr/bin/env bash
# QAKit packaging script
# Bumps version, validates, builds release zip
#
# Usage:
#   ./scripts/package.sh                     # auto-bump patch (1.0.0 → 1.0.1)
#   ./scripts/package.sh --version 1.1.0     # specific version

set -e

SRC_DIR="src"
RELEASES_DIR="releases"
SCRIPTS_DIR="scripts"

# Colors
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BLUE=''; NC=''
fi

# ─────────────────────────────────────────────────────────────
# Pre-flight
# ─────────────────────────────────────────────────────────────
if [ ! -d "$SRC_DIR" ]; then
  echo -e "${RED}ERROR: src/ not found. Run from repo root.${NC}"; exit 1
fi
mkdir -p "$RELEASES_DIR"

# ─────────────────────────────────────────────────────────────
# Determine target version
# ─────────────────────────────────────────────────────────────
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('$SRC_DIR/manifest.json'))['version'])")

if [ "$1" = "--version" ] && [ -n "$2" ]; then
  NEW_VERSION="$2"
  echo -e "${BLUE}Target version (specified): ${NEW_VERSION}${NC}"
else
  # Auto-bump patch
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  NEW_PATCH=$((PATCH + 1))
  NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"
  echo -e "${BLUE}Auto-bumping: ${CURRENT_VERSION} → ${NEW_VERSION}${NC}"
fi

# Validate version format
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo -e "${RED}ERROR: version must be X.Y.Z format${NC}"; exit 1
fi

# ─────────────────────────────────────────────────────────────
# Bump version across all files
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}── Bumping version ${CURRENT_VERSION} → ${NEW_VERSION} ──${NC}"

# 1. Update manifest.json (single source of truth)
python3 -c "
import json, sys
with open('$SRC_DIR/manifest.json') as f: m = json.load(f)
m['version'] = '$NEW_VERSION'
with open('$SRC_DIR/manifest.json', 'w') as f: json.dump(m, f, indent=2)
print('  ✓ manifest.json updated')
"

# 2. Update root package.json
python3 -c "
import json
with open('package.json') as f: p = json.load(f)
p['version'] = '$NEW_VERSION'
with open('package.json', 'w') as f: json.dump(p, f, indent=2)
print('  ✓ package.json updated')
"

# 3. Targeted updates for static HTML pages (no JS runtime)
#    privacy-policy.html — version appears in title, meta, and body text
sed -i.bak "s|v${CURRENT_VERSION}|v${NEW_VERSION}|g; s|Version ${CURRENT_VERSION}|Version ${NEW_VERSION}|g" "$SRC_DIR/privacy-policy.html" && rm -f "$SRC_DIR/privacy-policy.html.bak"
echo "  ✓ privacy-policy.html updated"

#    popup.html <title> tag (Chrome uses it for window/tab title)
sed -i.bak "s|<title>QAKit v${CURRENT_VERSION}</title>|<title>QAKit v${NEW_VERSION}</title>|" "$SRC_DIR/popup.html" && rm -f "$SRC_DIR/popup.html.bak"
echo "  ✓ popup.html title updated"

NEW_MANIFEST_VERSION=$(python3 -c "import json; print(json.load(open('$SRC_DIR/manifest.json'))['version'])")
if [ "$NEW_MANIFEST_VERSION" != "$NEW_VERSION" ]; then
  echo -e "${RED}ERROR: manifest version mismatch — got ${NEW_MANIFEST_VERSION}, expected ${NEW_VERSION}${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Version bumped to ${NEW_VERSION}${NC}"

# ─────────────────────────────────────────────────────────────
# Validate
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}── Running validation ──${NC}"
if ! bash "$SCRIPTS_DIR/validate.sh"; then
  echo -e "${RED}ERROR: validation failed — fix errors before packaging${NC}"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# Package
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}── Building zip ──${NC}"

ZIP_PATH="$RELEASES_DIR/qakit-v${NEW_VERSION}.zip"
rm -f "$ZIP_PATH"

# Build from src/ contents (zip entries should not have src/ prefix)
cd "$SRC_DIR"
zip -r "../$ZIP_PATH" . -x "*.DS_Store" -x ".*" -x "*.bak" -q
cd ..

if [ -f "$ZIP_PATH" ]; then
  SIZE=$(ls -lh "$ZIP_PATH" | awk '{print $5}')
  COUNT=$(unzip -l "$ZIP_PATH" | tail -1 | awk '{print $2}')
  echo -e "${GREEN}✓ ${ZIP_PATH} (${SIZE}, ${COUNT} files)${NC}"
else
  echo -e "${RED}ERROR: zip not created${NC}"
  exit 1
fi

# ─────────────────────────────────────────────────────────────
# Firefox build (uses manifest.firefox.json, omits debugger permission)
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}── Building Firefox zip ──${NC}"

FF_ZIP_PATH="$RELEASES_DIR/qakit-firefox-v${NEW_VERSION}.zip"

python3 - << PYEOF
import json, zipfile, os, pathlib
src = pathlib.Path('$SRC_DIR')
ff_manifest = json.load(open(src / 'manifest.firefox.json'))
ff_manifest['version'] = '$NEW_VERSION'
skip = {'.DS_Store', 'manifest.firefox.json'}
with zipfile.ZipFile('$FF_ZIP_PATH', 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in sorted(src.rglob('*')):
        if not f.is_file(): continue
        rel = f.relative_to(src)
        if rel.name in skip or any(p.startswith('.') or p.endswith('.bak') for p in rel.parts): continue
        if str(rel) == 'manifest.json':
            zf.writestr('manifest.json', json.dumps(ff_manifest, indent=2))
        else:
            zf.write(f, rel)
count = len(zipfile.ZipFile('$FF_ZIP_PATH').namelist())
size = os.path.getsize('$FF_ZIP_PATH')
print(f'  written: {count} files, {size//1024} KB')
PYEOF

if [ -f "$FF_ZIP_PATH" ]; then
  FF_SIZE=$(ls -lh "$FF_ZIP_PATH" | awk '{print $5}')
  FF_COUNT=$(unzip -l "$FF_ZIP_PATH" | tail -1 | awk '{print $2}')
  echo -e "${GREEN}✓ ${FF_ZIP_PATH} (${FF_SIZE}, ${FF_COUNT} files)${NC}"
else
  echo -e "${YELLOW}⚠ Firefox zip not created (non-fatal)${NC}"
fi

echo ""
echo "============================================================"
echo -e "  ${GREEN}✓ Package built successfully${NC}"
echo ""
echo "  Version:  ${NEW_VERSION}"
echo "  Chrome:   ${ZIP_PATH} (${SIZE})"
echo "  Firefox:  ${FF_ZIP_PATH} (${FF_SIZE:-n/a})"
echo ""
echo "  Next steps:"
echo "    1. Test Chrome: load src/ unpacked in chrome://extensions/"
echo "    2. Test Firefox: load ${FF_ZIP_PATH} in about:debugging"
echo "    3. Update CHANGELOG.md with what changed"
echo "    4. Commit: git add . && git commit -m 'Release v${NEW_VERSION}'"
echo "    5. Tag:    git tag -a v${NEW_VERSION} -m 'v${NEW_VERSION}'"
echo "    6. Push:   git push && git push --tags"
echo "    7. Create GitHub Release with both zips"
echo "============================================================"
