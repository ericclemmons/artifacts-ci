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

curl -ksSf "https://ci.localhost/repos/$repo.sh" | bash
git push cloudflare
