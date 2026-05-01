#!/usr/bin/env bash
set -euo pipefail

example=${1:-}

if [[ -z "$example" ]]; then
  echo "Usage: pnpm smoke examples/vite-plus" >&2
  exit 2
fi

tmp=$(mktemp -d)
cp -R "$example" "$tmp"
cd "$tmp/$(basename "$example")"

repo="$(basename "$example")-$(date +%s)"
git init -b main
git add .
git commit -m "Initial smoke test fixture"

ready=0
for _ in {1..30}; do
  if curl -ksSf "https://ci.localhost/repos/$repo.sh" >/dev/null 2>&1; then
    ready=1
    break
  fi

  sleep 1
done

if [[ "$ready" != 1 ]]; then
  echo "Timed out waiting for https://ci.localhost/repos/$repo.sh" >&2
  exit 1
fi

curl -ksSf "https://ci.localhost/repos/$repo.sh" | bash
git push cloudflare
