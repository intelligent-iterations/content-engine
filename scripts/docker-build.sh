#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DOCKER_BIN="${DOCKER_BIN:-}"

if [ -z "$DOCKER_BIN" ]; then
  for candidate in /opt/homebrew/bin/docker /usr/local/bin/docker docker; do
    if command -v "$candidate" >/dev/null 2>&1; then
      DOCKER_BIN="$(command -v "$candidate")"
      break
    fi
  done
fi

if [ -z "$DOCKER_BIN" ]; then
  echo "docker not found. Set DOCKER_BIN or install Docker in a launchd-visible path." >&2
  exit 127
fi

SERVICES="${*:-autopost generate}"

cd "$ROOT_DIR"

if "$DOCKER_BIN" buildx version >/dev/null 2>&1; then
  echo "Using docker compose build for: $SERVICES"
  exec "$DOCKER_BIN" compose build $SERVICES
fi

echo "docker buildx is unavailable. Falling back to direct docker build."

for service in $SERVICES; do
  case "$service" in
    autopost)
      echo "Building content-engine-autopost:local"
      "$DOCKER_BIN" build -t content-engine-autopost:local -f Dockerfile.autopost .
      ;;
    generate)
      echo "Building content-engine-generate:local"
      "$DOCKER_BIN" build -t content-engine-generate:local -f Dockerfile.generate .
      ;;
    *)
      echo "Unknown service: $service" >&2
      exit 1
      ;;
  esac
done
