# Activity feed

Activity ("Every move, in one place.") lists logged spends, income and ledger transfers grouped by day, with filter pills and a receipt sheet per row.

## Sub-features

- `activity-list` shows every entry kind newest first.
- `activity-filter` narrows by `Everything`, `Spending`, `Money in`, `Ledger`, `Declined`.
- `activity-receipt` opens a row's detail sheet.

## How to get to it (user POV)

- Dock tab `Activity`.
- Today → Recent → `See all`.

## Driving it with playwright-cli

Preconditions:

- Inside the demo as Anthony. Demo seed includes declined transfers (`Concert tickets — team offsite`, `Rent share - October`).

- **Open.** `$V pw click "getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Activity' })"`. Heading `Every move, in one place.` and pill `Everything [pressed]`.
- **Filter declined.** `$V pw click "getByRole('button', { name: 'Declined', exact: true })"`. Rows all read `Declined · To ...`; `Logged by you` rows are gone.
- **Filter spending.** `$V pw click "getByRole('button', { name: 'Spending', exact: true })"`. Rows all read `Logged by you · <category>`.
- **Receipt.** `$V pw click "getByRole('button', { name: /^Concert tickets/ })"` under `Declined`. A `dialog` opens with the transfer detail.
- **Side effect check.** Declined transfers appear in `curl -s .../api/accounts/<anthony-id>` under `transfers` with a declined status.
- **Proof.** `$V pw snapshot --filename=activity-filter-after.yml`, `$V pw screenshot --filename=activity.png`.

## Gotchas

- Not yet driven end to end; the filter and receipt steps were mapped from a snapshot, not executed. Run them before trusting this file and fix any drift.
- The list is keyed by filter and rows animate in; wait for the expected row text before snapshotting.
