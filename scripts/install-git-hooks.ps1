# Point this clone at tracked hooks under .githooks/ (commit-msg strips AI trailers).
$ErrorActionPreference = "Stop"
$root = git rev-parse --show-toplevel
if (-not $root) { throw "Not inside a git repository." }
Set-Location $root
git config core.hooksPath .githooks
Write-Host "Installed: core.hooksPath = .githooks (commit-msg strips Cursor/Claude trailers)"
