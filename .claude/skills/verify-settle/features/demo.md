# Guided demo

The demo seeds a household (Anthony, Sam, Jordan) with a believable spend history and opens Anthony's Today screen with a five-step "Your quest" guide card.

## Sub-features

- `demo-start` starts the demo from Welcome and lands on Anthony's Today.
- `demo-guide` shows the quest card with step progress and a next action.
- `demo-reopen` reopens the guide from the `Demo` pill after hiding it.

## How to get to it (user POV)

- Welcome text button `Preview a sample household`.
- `Demo` pill in the top bar, once inside the demo.

## Driving it with playwright-cli

Preconditions:

- Baseline from the README; Welcome page visible.

- **Start.** `$V pw click "getByRole('button', { name: 'Preview a sample household' })"`. Within a few seconds `$V pw --raw snapshot | grep 'heading "Hi, Anthony."'` matches and the top bar has `button "Anthony"`.
- **Guide card.** Snapshot contains `Your quest`, `N / 5 done`, and the list `generic "N of 5 demo steps complete"`.
- **Hide and reopen.** `$V pw click "getByRole('button', { name: 'Hide demo guide' })"`, then `$V pw click "getByRole('button', { name: 'Demo', exact: true })"`. The guide reappears.
- **Side effect.** `curl -s http://127.0.0.1:5199/api/accounts/01111111-1111-7111-8111-111111111101` returns owner `anthony` with transfers; localStorage `settle:session` has `"demo":true`.
- **Proof.** `$V pw snapshot --filename=demo-start-after.yml` and `$V pw screenshot --filename=demo-start.png`.

## Gotchas

- There is one button named `Preview a sample household`.
- Quest progress is stored per account in localStorage (`settle:demo-progress:<id>`), so the count depends on what earlier steps in the same browser did. It typically starts at `1 / 5 done`.
- The `Demo` pill name collides with nothing else, but use `exact: true` to avoid matching `Hide demo guide`.
