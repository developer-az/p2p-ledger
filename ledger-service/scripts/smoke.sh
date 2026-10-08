#!/usr/bin/env bash
# End-to-end smoke test against a running ledger. Used by CI on the native binary, where
# missing reflection/resource metadata only shows up at runtime.
#   scripts/smoke.sh http://localhost:8080
set -euo pipefail
U=${1:-http://localhost:8080}
H=(-H 'Content-Type: application/json')
fail() { echo "FAIL: $*" >&2; exit 1; }
expect() { [[ "$2" == "$3" ]] || fail "$1: expected '$3', got '$2'"; echo "ok  $1"; }

A=$(curl -fsS "${H[@]}" -d '{"ownerId":"smoke-a","currency":"USD"}' "$U/v1/accounts" | jq -r .id)
B=$(curl -fsS "${H[@]}" -d '{"ownerId":"smoke-b","currency":"USD"}' "$U/v1/accounts" | jq -r .id)

s=$(curl -fsS "${H[@]}" -H "Idempotency-Key: dep-$A" -d '{"amountMinor":500000}' "$U/v1/accounts/$A/deposits" | jq -r .status)
expect deposit "$s" COMPLETED

T="{\"sourceAccountId\":\"$A\",\"destinationAccountId\":\"$B\",\"amountMinor\":2500,\"currency\":\"USD\"}"
expect transfer "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H "Idempotency-Key: t-$A" -d "$T" "$U/v1/transfers")" 201
expect replay "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H "Idempotency-Key: t-$A" -d "$T" "$U/v1/transfers")" 200

T2="{\"sourceAccountId\":\"$A\",\"destinationAccountId\":\"$B\",\"amountMinor\":9999,\"currency\":\"USD\"}"
expect key-reuse "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H "Idempotency-Key: t-$A" -d "$T2" "$U/v1/transfers")" 422

r=$(curl -fsS "${H[@]}" -H "Idempotency-Key: big-$A" \
  -d "{\"sourceAccountId\":\"$A\",\"destinationAccountId\":\"$B\",\"amountMinor\":200000,\"currency\":\"USD\"}" \
  "$U/v1/transfers" | jq -r .rejectionReason)
expect fraud-rule "$r" NEW_ACCOUNT_LARGE_TRANSFER

expect validation "$(curl -s "${H[@]}" -d '{"ownerId":"","currency":"USD"}' "$U/v1/accounts" | jq -r .status)" 400
expect balance "$(curl -fsS "$U/v1/accounts/$B" | jq -r .balanceMinor)" 2500
expect statement "$(curl -fsS "$U/v1/accounts/$A/entries" | jq -c '[.[].amountMinor]')" '[-2500,500000]'
curl -fsS "$U/actuator/prometheus" | grep -q '^ledger_transfers_total' || fail "prometheus metrics missing"
echo "ok  prometheus"
