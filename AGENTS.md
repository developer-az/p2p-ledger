# 🤖 Universal Agent Instructions

## 1. Project Context
*   **Project Name:** p2p-ledger
*   **Source of Truth:** This AGENTS.md file and docs/ai/HANDOFF.md supersede any older memory snapshots.
*   **Layout:** Polyglot monorepo — **not** npm workspaces. Node app is `assistant/`; Java API is `ledger-service/` (Maven). Root `package.json` only forwards npm scripts into `assistant/`.

## 2. Tech Stack & Commands
*   **Core Stack:** React + Vite + Hono (`assistant/`), Spring Boot ledger (`ledger-service/`), Docker Compose for full stack.
*   **Run Dev Server:** From repo root: `npm run dev` (practice UI, port 5173). Full stack: `npm run dev:stack`. First time: `cd assistant && cp .env.example .env.local && npm install`.

## 3. CRITICAL EXECUTION RULES
1.  **No Autonomous Loops:** do not verify your own output endlessly, Output the final result immediately and wait for human approval.
2.  **Writing Style (Anti-Slop):** 
    *   Ban buzzwords: "spearheaded", "innovative", "dynamic", "passionate", "leveraged", "synergized".
    *   Use plain, active engineering descriptions. 

## 4. Handoff Protocol
Before ending any session, you MUST update docs/ai/HANDOFF.md with a summary of what you accomplished.
