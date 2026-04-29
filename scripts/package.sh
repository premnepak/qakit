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

cd "$SRC_DIR"

# Bump in JS, HTML, JSON files (excluding spell-bundle.js)
for f in *.js *.html *.json; do
  [ "$f" = "spell-bundle.js" ] && continue
  [ -f "$f" ] || continue
  sed -i.bak "s|v${CURRENT_VERSION}|v${NEW_VERSION}|g" "$f" 2>/dev/null || true
  sed -i.bak "s|\"${CURRENT_VERSION}\"|\"${NEW_VERSION}\"|g" "$f" 2>/dev/null || true
  sed -i.bak "s|Version ${CURRENT_VERSION}|Version ${NEW_VERSION}|g" "$f" 2>/dev/null || true
  rm -f "$f.bak"
done

# Update title tags specifically
sed -i.bak "s|<title>QAKit v${CURRENT_VERSION}</title>|<title>QAKit v${NEW_VERSION}</title>|" popup.html 2>/dev/null || true
rm -f popup.html.bak

# Verify no stale version refs
STALE=$(grep -rln "${CURRENT_VERSION}" *.js *.html *.json 2>/dev/null | grep -v spell-bundle || true)
if [ -n "$STALE" ]; then
  echo -e "${YELLOW}⚠ Stale version refs in:${NC}"
  echo "$STALE" | sed 's/^/    /'
fi

NEW_MANIFEST_VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
if [ "$NEW_MANIFEST_VERSION" != "$NEW_VERSION" ]; then
  echo -e "${RED}ERROR: manifest version mismatch — got ${NEW_MANIFEST_VERSION}, expected ${NEW_VERSION}${NC}"
  exit 1
fi

cd ..

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

echo ""
echo "============================================================"
echo -e "  ${GREEN}✓ Package built successfully${NC}"
echo ""
echo "  Version:  ${NEW_VERSION}"
echo "  File:     ${ZIP_PATH}"
echo "  Size:     ${SIZE}"
echo "  Files:    ${COUNT}"
echo ""
echo "  Next steps:"
echo "    1. Test the package: load src/ unpacked in chrome://extensions/"
echo "    2. Update CHANGELOG.md with what changed"
echo "    3. Commit: git add . && git commit -m 'Release v${NEW_VERSION}'"
echo "    4. Tag:    git tag -a v${NEW_VERSION} -m 'v${NEW_VERSION}'"
echo "    5. Push:   git push && git push --tags"
echo "    6. Create GitHub Release with the zip"
echo "============================================================"
