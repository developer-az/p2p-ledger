# 🤖 Universal Agent Instructions

## 1. Project Context
*   **Project Name:** [Insert Project Name]
*   **Source of Truth:** This AGENTS.md file and docs/ai/HANDOFF.md supersede any older memory snapshots.

## 2. Tech Stack & Commands
*   **Core Stack:** [Update with your stack]
*   **Run Dev Server:** [Insert command]

## 3. CRITICAL EXECUTION RULES
1.  **No Autonomous Loops:** Execute the user's prompt in exactly ONE single step. Do not self-correct, do not verify your own output endlessly, and do not chain tool calls. Output the final result immediately and wait for human approval.
2.  **Writing Style (Anti-Slop):** 
    *   Ban buzzwords: "spearheaded", "innovative", "dynamic", "passionate", "leveraged", "synergized".
    *   Use plain, active engineering descriptions. 

## 4. Handoff Protocol
Before ending any session, you MUST update docs/ai/HANDOFF.md with a summary of what you accomplished.
