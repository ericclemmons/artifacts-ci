#!/usr/bin/env bash
set -euo pipefail

example=${1:-}

if [[ -z "$example" ]]; then
  echo "Usage: pnpm smoke examples/vite-plus" >&2
  exit 2
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
example_path="$root/$example"

if [[ ! -d "$example_path" ]]; then
  echo "Example not found: $example" >&2
  exit 2
fi

if [[ ! -f "$example_path/package.json" ]]; then
  echo "Example is missing package.json: $example" >&2
  exit 2
fi

for command in curl git jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 2
  fi
done

repo=$(jq -r '.name // empty' "$example_path/package.json")

if [[ -z "$repo" || "$repo" == "null" ]]; then
  echo "Example package.json must have a name" >&2
  exit 2
fi

if [[ "$repo" == *"/"* ]]; then
  echo "Package name must not contain '/': $repo" >&2
  exit 2
fi

tmp=$(mktemp -d)

cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

workdir="$tmp/$(basename "$example_path")"

cp -R "$example_path" "$workdir"
cd "$workdir"

if [[ -z "${GIT_SSL_CAINFO:-}" && -f "$HOME/.portless/ca.pem" ]]; then
  export GIT_SSL_CAINFO="$HOME/.portless/ca.pem"
fi

git init -b main
git config user.name "Smoke Test"
git config user.email "smoke-test@example.local"
git add .
git commit -m "Initial smoke test fixture"

curl -ksSf "https://ci.localhost/repos/$repo.sh" | bash
git push --force cloudflare
