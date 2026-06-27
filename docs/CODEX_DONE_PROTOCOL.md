# Codex Done Protocol

Use this checklist before finishing any task.

## Before finishing

1. Update `docs/PROJECT_MASTER_PLAN.md` Project Execution Checklist if task status changed.
2. Mark `[x]` only after the change is implemented and verified.
3. Update `docs/DECISIONS.md` only if an architecture/product decision changed.
4. Update `docs/OPERATIONS.md` only if operator behavior, runbook, env, queue, upload, cron, scheduling, or UI workflow changed.
5. Do not create new roadmap/planning docs unless explicitly requested.
6. If no docs update is needed, explicitly say why.
7. Do not upload, publish, schedule, mutate queue, modify DB, or delete media unless the task explicitly asked for it.
8. If DB/queue/upload/media was touched, report exactly what changed.
9. Run relevant verification when possible:
   - typecheck
   - eslint changed files
   - route/action/script verification
10. If any verification was skipped, explain why.

## Final report must include

- Files changed
- Docs/checklist updates, or why none
- DB / queue / upload / media impact
- Verification performed
- Remaining risks / next manual check

Do not change code.
Do not mutate DB, queue, upload, or media.
