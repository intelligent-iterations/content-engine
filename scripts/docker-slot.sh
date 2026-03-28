#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "Usage: scripts/docker-slot.sh <instagram|x|tiktok> <slot>" >&2
  exit 1
fi

PLATFORM="$1"
SLOT="$2"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DOCKER_BIN="${DOCKER_BIN:-docker}"

case "$PLATFORM" in
  instagram)
    SCRIPT="code/posting/run-instagram-slot.js"
    SERVICE="autopost"
    ;;
  x)
    SCRIPT="code/posting/run-x-slot.js"
    SERVICE="autopost"
    ;;
  tiktok)
    SCRIPT="code/posting/run-tiktok-slot.js"
    SERVICE="autopost"
    ;;
  *)
    echo "Unknown platform: $PLATFORM" >&2
    exit 1
    ;;
esac

cd "$ROOT_DIR"
exec "$DOCKER_BIN" compose run --rm --no-deps "$SERVICE" node "$SCRIPT" "$SLOT"
