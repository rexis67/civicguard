#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
repo_name="$(basename "$repo_root")"
description="Municipal incident intelligence: citizen reports, asynchronous AI triage and an authority operations dashboard."

cd "$repo_root"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This directory is not a Git repository." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "Check out a branch before publishing." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes detected. Commit or stash them before publishing:" >&2
  git status --short
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "Pushing to existing origin: $(git remote get-url origin)"
  git push --set-upstream origin "$branch"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  cat >&2 <<EOF
No Git remote exists and GitHub CLI (gh) is not installed.
Install gh, run 'gh auth login', then run this script again; or create an empty
repository and add it as origin before rerunning.
EOF
  exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "No GitHub session found. Starting GitHub CLI sign-in..."
  gh auth login --hostname github.com --git-protocol https --web
fi

login="$(gh api user --jq '.login')"
user_id="$(gh api user --jq '.id')"
current_email="$(git config user.email || true)"
if [[ -z "$current_email" || "$current_email" == "codew@users.noreply.github.com" ]]; then
  git config user.name "$login"
  git config user.email "${user_id}+${login}@users.noreply.github.com"
  echo "Configured Git identity for future commits as $login."
fi

echo "Creating github.com/${login}/${repo_name} and pushing '${branch}'..."
gh repo create "$repo_name" \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "$description"
gh repo edit --add-topic civictech --add-topic hackathon --add-topic react --add-topic express --add-topic ai

echo
echo "Published: https://github.com/${login}/${repo_name}"
echo "Deploy from the blueprint:"
echo "  https://dashboard.render.com/blueprint/new?repo=https://github.com/${login}/${repo_name}"
