#!/usr/bin/env bash
# End-to-end smoke test against a running ledger. Used by CI on the native binary, where
# missing reflection/resource metadata only shows up at runtime.
#   scripts/smoke.sh http://localhost:8080
set -euo pipefail
U=${1:-http://localhost:8080}
H=(-H 'Content-Type: application/json')
if [[ -n "${LEDGER_API_KEY:-}" ]]; then H+=(-H "X-Ledger-Key: $LEDGER_API_KEY"); fi
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
expect balance "$(curl -fsS "${H[@]}" "$U/v1/accounts/$B" | jq -r .balanceMinor)" 2500
expect statement "$(curl -fsS "${H[@]}" "$U/v1/accounts/$A/entries" | jq -c '[.[].amountMinor]')" '[-2500,500000]'
curl -fsS "${H[@]}" "$U/actuator/prometheus" | grep -q '^ledger_transfers_total' || fail "prometheus metrics missing"
echo "ok  prometheus"


# Exercise internal-record serialization in the actual native executable.
[[ -n "${LEDGER_API_KEY:-}" ]] || fail "LEDGER_API_KEY is required for native workflow smoke tests"
expect workflow-version "$(curl -fsS "${H[@]}" "$U/v1/capabilities" | jq -r .workflows)" 2
SPEND='{"amountMinor":1250,"category":"groceries","note":"Native smoke"}'
SID=$(curl -fsS "${H[@]}" -H "Idempotency-Key: spend-$A" -d "$SPEND" "$U/v1/accounts/$A/spends" | jq -r .id)
[[ -n "$SID" && "$SID" != null ]] || fail "native spend returned no id"
expect native-spend-replay "$(curl -fsS "${H[@]}" -H "Idempotency-Key: spend-$A" -d "$SPEND" "$U/v1/accounts/$A/spends" | jq -r .id)" "$SID"
expect native-spend-read "$(curl -fsS "${H[@]}" "$U/v1/accounts/$A/spends" | jq -r '.[0].id')" "$SID"
expect native-spend-undo "$(curl -fsS -X DELETE "${H[@]}" "$U/v1/accounts/$A/spends/$SID" | jq -r .removed)" true
SPLIT=$(jq -cn --arg a "$A" --arg b "$B" '{requesterAccountId:$a,payers:[{accountId:$b,amountMinor:100}],memo:"Native smoke"}')
RID=$(curl -fsS "${H[@]}" -H "Idempotency-Key: split-$A" -d "$SPLIT" "$U/v1/requests" | jq -r '.requests[0].id')
[[ -n "$RID" && "$RID" != null ]] || fail "native split returned no request"
expect native-split-replay "$(curl -fsS "${H[@]}" -H "Idempotency-Key: split-$A" -d "$SPLIT" "$U/v1/requests" | jq -r '.requests[0].id')" "$RID"
ACTOR=$(jq -cn --arg a "$A" '{accountId:$a}')
expect native-split-cancel "$(curl -fsS "${H[@]}" -d "$ACTOR" "$U/v1/requests/$RID/cancel" | jq -r .request.status)" CANCELLED
