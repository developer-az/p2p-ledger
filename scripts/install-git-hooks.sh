#!/usr/bin/env sh
set -e
root="$(git rev-parse --show-toplevel)"
cd "$root"
git config core.hooksPath .githooks
echo "Installed: core.hooksPath = .githooks (commit-msg strips Cursor/Claude trailers)"
