# Ask

Ask ("A conversation with your records.") answers questions about the current wallet using read-only tools. With no LLM key (the harness default) it answers from the ledger fallback and says so.

## Sub-features

- `ask-starter` sends a starter question chip.
- `ask-typed` sends a typed question.
- `ask-from-today` opens Ask with a question from the Today ask bar.

## How to get to it (user POV)

- Dock tab `Ask`.
- Top bar `Ask` button.
- Today ask bar (`search` landmark): textbox `Ask about your money`, chips `Where did it go?`, `Can I afford it?`.
- Wallet → `Open Ask`.

## Driving it with playwright-cli

Preconditions:

- Inside the demo as Alex. `verify.sh doctor` shows `chat uses ledger fallback`.

- **Open.** `$V pw click "getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Ask' })"`. Region `Conversation` with heading `What do you want to know?`.
- **Starter.** `$V pw click "getByRole('button', { name: 'How much did I spend this week?' })"`. Within a few seconds the region shows the question, the notice `The language model is not connected on this server...`, and an answer starting `Balance $` plus `Looked at: ...`.
- **Typed.** `$V pw fill "getByRole('textbox', { name: 'Your question' })" "Why was my payment declined?"`, then `$V pw click "getByRole('button', { name: 'Send question' })"`. A second turn appears.
- **Proof.** `$V pw snapshot "getByRole('region', { name: 'Conversation' })" --filename=ask-starter-after.yml`, `$V pw screenshot --filename=ask.png`.

## Gotchas

- `Ask` is the name of three buttons; always scope the dock tab to `navigation "Main"`.
- With an LLM key set, answers vary per run; assert only on structure (a question turn and an answer turn), not wording.
- `Send question` is disabled until the textbox has text.
- The ask-bar chips on Today switch tabs and send immediately.
