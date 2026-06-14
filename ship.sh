#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: ./ship.sh <commit message>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
message="$*"

cd "$ROOT_DIR"

npm run verify
./scripts/install.sh

git add .

if git diff --cached --quiet; then
  echo "No staged changes to commit."
else
  git commit -m "$message"
fi

branch="$(git rev-parse --abbrev-ref HEAD)"

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "No origin remote configured." >&2
  exit 1
fi

if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
  git push
else
  git push -u origin "$branch"
fi
