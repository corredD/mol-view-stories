#!/usr/bin/env bash
#
# Build and deploy the webapp (editor + dev API + MCP endpoint) to mesoscope.
#
# The running service is a Next.js standalone build:
#   mvs.service -> /usr/bin/node server.js
#   WorkingDirectory=/opt/mol-view-stories/mol-view-stories/@mol-view-stories/webapp
#   PORT=3000, bound to 127.0.0.1, reverse-proxied at https://<host>/mvs
#
# Standalone output ships no source tree, so docs/ and cli/examples/ have to be
# copied alongside it and pointed at with MVS_REFERENCE_ROOT — otherwise the
# mvs_doc_* and example_* MCP tools come back empty.
#
# Restarting the service needs root, which the deploy user does not have
# passwordless. This script stages everything and then tells you the one command
# left to run. Pass --activate to swap the staged build in (still needs the
# restart afterwards).
set -euo pipefail

HOST="${MVS_DEPLOY_HOST:-autin@mesoscope.scripps.edu}"
REMOTE_ROOT="${MVS_DEPLOY_ROOT:-/opt/mol-view-stories}"
BASE_PATH="${MVS_BASE_PATH:-/mvs}"
# Used verbatim for the pairing link and export downloads handed to the user,
# so it must be the public URL, not whatever Host the proxy forwards.
PUBLIC_URL="${MVS_PUBLIC_URL:-https://mesoscope.scripps.edu$BASE_PATH}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBAPP="$REPO/@mol-view-stories/webapp"
STAGE="$REMOTE_ROOT/staging"
LIVE="$REMOTE_ROOT/mol-view-stories"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# NEXT_PUBLIC_* values are inlined at build time, so this has to be decided here
# rather than in the remote .env.local the service reads. Left to .env.local it
# depends on whatever the build machine happens to have, which is exactly the
# non-reproducibility this script exists to remove.
#
# It is a public/-relative path; localStoriesUrl() prepends basePath. Empty means
# the preview loads mvs-stories from jsDelivr, which is correct unless a story
# needs an unreleased molstar feature.
if [ -d "$WEBAPP/public/mvs-stories" ]; then
  STORIES_BASE="${MVS_STORIES_BASE:-/mvs-stories}"
else
  STORIES_BASE="${MVS_STORIES_BASE:-}"
  # public/mvs-stories/ is gitignored and no build step produces it: it is copied
  # in by hand from a molstar / molstar-components build. A fresh clone has none.
  echo "    note: public/mvs-stories/ absent, preview will use the jsDelivr bundle" >&2
fi

say "Building standalone bundle (basePath=$BASE_PATH, stories=${STORIES_BASE:-jsDelivr})"
cd "$WEBAPP"
MVS_BUILD_STANDALONE=1 \
NEXT_PUBLIC_DEV_API=1 \
NEXT_PUBLIC_BASE_PATH="$BASE_PATH" \
NEXT_PUBLIC_MVS_STORIES_BASE="$STORIES_BASE" \
NODE_ENV=production \
  pnpm build

# .next/standalone/ maps 1:1 onto the live $LIVE directory: in a pnpm workspace
# the shared node_modules and package.json sit at the standalone ROOT, and
# server.js sits in the @mol-view-stories/webapp subdirectory. Shipping only the
# subdirectory leaves server.js unable to require('next').
STANDALONE="$WEBAPP/.next/standalone"
SA="$STANDALONE/@mol-view-stories/webapp"
[ -d "$SA" ] || { echo "standalone output missing at $SA" >&2; exit 1; }

# Next's standalone tracing copies neither of these; they have to be placed by hand.
say "Assembling bundle"
rm -rf "$SA/.next/static" "$SA/public"
cp -R "$WEBAPP/.next/static" "$SA/.next/static"
cp -R "$WEBAPP/public" "$SA/public"

# Text only: example binary assets are referenced by absolute URL, never inlined,
# so shipping them would add ~87M for nothing.
say "Collecting reference material (docs + examples)"
REF="$(mktemp -d)/reference"
mkdir -p "$REF/docs" "$REF/cli/examples"
rsync -a --include='*/' --include='*.qmd' --exclude='*' "$REPO/docs/" "$REF/docs/"
rsync -a --include='*/' --include='*.yaml' --include='*.yml' --include='*.md' --include='*.js' \
      --exclude='*' "$REPO/cli/examples/" "$REF/cli/examples/"
echo "    $(find "$REF" -type f | wc -l | tr -d ' ') files, $(du -sh "$REF" | cut -f1)"

say "Staging to $HOST:$STAGE"
ssh "$HOST" "mkdir -p '$STAGE'"
rsync -az --delete "$STANDALONE/" "$HOST:$STAGE/app/"
rsync -az --delete "$REF/" "$HOST:$STAGE/reference/"

# The service reads this; NEXT_PUBLIC_DEV_API must stay set or every dev route 404s.
ssh "$HOST" "cat > '$STAGE/app/@mol-view-stories/webapp/.env.local' <<ENV
NEXT_PUBLIC_DEV_API=1
NEXT_PUBLIC_BASE_PATH=$BASE_PATH
MVS_REFERENCE_ROOT=$REMOTE_ROOT/reference
MVS_PUBLIC_URL=$PUBLIC_URL
ENV"

if [ "${1:-}" != "--activate" ]; then
  cat <<MSG

Staged, not yet live. To activate:

    $0 --activate

MSG
  exit 0
fi

say "Activating (previous build kept as .bak)"
ssh "$HOST" "
  set -e
  rm -rf '$REMOTE_ROOT/reference.bak' '$LIVE.bak'
  [ -d '$REMOTE_ROOT/reference' ] && mv '$REMOTE_ROOT/reference' '$REMOTE_ROOT/reference.bak' || true
  [ -d '$LIVE' ] && mv '$LIVE' '$LIVE.bak' || true
  cp -a '$STAGE/reference' '$REMOTE_ROOT/reference'
  cp -a '$STAGE/app'       '$LIVE'
"

cat <<MSG

Build is in place. One step left, and it needs root:

    ssh $HOST 'sudo systemctl restart mvs'

Then verify:

    curl -s -X POST https://mesoscope.scripps.edu$BASE_PATH/api/mcp/ \\
      -H 'Content-Type: application/json' \\
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200

To roll back: move the .bak directories back and restart again.

MSG
