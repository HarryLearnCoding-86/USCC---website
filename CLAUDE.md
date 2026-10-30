CLAUDE.md — USCC Referee Results Web

This file is loaded at the start of every session. Keep it short and current. Detailed specs live in the files it points to.

What is this project?

An internal web app for USCC (a chess club in Ho Chi Minh City) that lets arbiters run tournament results without printed pairing lists.

Technical arbiter (TD): creates tournaments, imports pairings exported from Swiss-Manager, resolves disputes, opens the projection screen, and exports results back to Swiss-Manager.
Recorder: finds a board on their phone, enters the result, then hands the phone to both players, who confirm in turn. Players have no accounts.
A result becomes OFFICIAL only after both confirmations or a TD exception approval. Only official results appear on the projection screen (within 5 s) and in exports.

Swiss-Manager remains the source of truth for pairings and standings. This app records results; it does not pair players or calculate standings.

Authoritative documents:

File	Purpose
AGENT_PROMPT.md	Full build spec: stack, data model, state machine, pages, phases, coding rules
TEST_AGENT_PROMPT.md	Test strategy, severity levels, .docx report format
README.md	Setup, usage, deployment

If this file conflicts with AGENT_PROMPT.md, AGENT_PROMPT.md wins. Flag the conflict.

1. How should Claude behave?
Plan before coding. For any change touching more than one file, post a short plan first: the files to change and the tests to add.
Work phase by phase (Phases 1–5 in AGENT_PROMPT.md). Stop at the end of each phase and report what was built, how to run it, test output, and open issues.
Ask when a requirement is unclear. Do not guess. This matters most for the open questions in AGENT_PROMPT.md section 6 (Swiss-Manager formats, result codes, dispute procedure). Implement behind an interface, document the assumption in README.md, and flag it.
Comment every file and every exported function (TSDoc). Comments explain why and cite requirement IDs, e.g. // FR-06: only OFFICIAL results reach the projection screen. Do not restate the code.
Use full, descriptive names for variables, functions and files: confirmPlayerResult(), swiss-manager-pairing-importer.ts, isWhiteConfirmed.
Update README.md whenever setup steps, env vars, commands, or behavior change.
Verify before claiming done. Run lint, type-check and tests, and paste the summary. "Should work" is not done.
Report bluntly. State failures, skipped work, and known defects plainly.
Code, comments, identifiers, commits and docs are in English. The user-facing UI is in Vietnamese, with strings kept in src/i18n/vi.ts only.
2. What should Claude never do?
Never let a result reach OFFICIAL by any path other than the state machine in src/server/domain/result-state-machine.ts. No direct status updates in services, routes or scripts.
Never update or delete rows in result_events. The audit log is append-only.
Never show PENDING or DISPUTED results on the projection screen or include them in a default export.
Never auto-merge players matched only by name. Report the conflict to the TD.
Never overwrite a round that has results without a diff and explicit TD confirmation.
Never add public routes. Every page and API requires a logged-in arbiter with the right role. No public signup.
Never commit secrets or real credentials. Keep .env.example updated instead.
Never use real player personal data in seeds, fixtures or tests.
Never hard-code the Chess-Results sample layout as the importer format. It is a test fixture only.
Never weaken, skip or delete a failing test to make a run green.
Never edit application code while acting as the test agent. Under TEST_AGENT_PROMPT.md, write tests and findings only.
Never substitute the stack (Next.js, TypeScript, PostgreSQL, Prisma, Zod, ExcelJS, SSE) or add dependencies without stating why and getting approval.
Never run destructive DB commands (prisma migrate reset, DROP, TRUNCATE) against anything except the local dev/test database.
Never hard-code Vietnamese strings in components, and never use any without a justifying comment.
3. What does Claude need to know about the codebase?
Stack

TypeScript (strict) · Next.js App Router · React · Tailwind · PostgreSQL · Prisma · Zod · ExcelJS · SSE over Postgres LISTEN/NOTIFY · IndexedDB offline queue (idb) · Vitest · Playwright · Docker Compose + Caddy.

Layout
src/app/              routes and route handlers ONLY (no business logic)
src/components/       presentational React components
src/i18n/vi.ts        all Vietnamese UI strings
src/server/domain/    pure business logic (state machine, result rules) — no DB, no HTTP
src/server/services/  DB-backed use cases: domain + Prisma, one transaction per use case
src/server/import/    PairingImporter interface + implementations
src/server/export/    ResultExporter interface + implementations
src/server/realtime/  LISTEN/NOTIFY listener, SSE broadcaster
src/server/auth/      sessions, argon2 hashing, role guards
src/client/offline/   IndexedDB action queue + retry
prisma/               schema, migrations, seed
tests/                unit/ integration/ e2e/ nonfunctional/ fixtures/ helpers/ reporting/
docker/               Dockerfile, Caddyfile, backup scripts
reports/              .docx and .json test-run reports
Core rules encoded in the code
Result states: NONE → PENDING → OFFICIAL, with PENDING → DISPUTED, OFFICIAL → REOPENED → PENDING, and TD approveException from PENDING or DISPUTED. The full transition table is in AGENT_PROMPT.md §3.3.
Every state transition runs in one DB transaction. It checks version (optimistic lock, 409 on conflict), increments it, writes a ResultEvent, and fires NOTIFY result_changed.
Every mutating endpoint honors the Idempotency-Key header. The offline queue depends on it.
Result codes with requiresPlayerConfirmation = false (byes) go straight to OFFICIAL when the TD submits them. They are never displayed as confirmed by both players.
Roles: TECHNICAL can do everything. RECORDER can look up games, submit results and run confirmations. Check the role on the server for every route, not only in the UI.
Time: store timestamptz; display in the tournament's timezone (default Asia/Ho_Chi_Minh).
Scores: store ½ as 0.5; render it as ½.
Players are identified by swissManagerPlayerId first, name second.
4. What workflows and tools does Claude use here?
Commands
bash
docker compose up -d          # start PostgreSQL (and Caddy in prod profile)
pnpm install
pnpm db:migrate               # apply Prisma migrations
pnpm db:seed                  # demo TD, recorder, tournament (2 rounds × 10 boards)
pnpm dev                      # dev server
pnpm lint && pnpm typecheck   # must pass before any commit
pnpm test:unit                # Vitest unit
pnpm test:integration         # Vitest against the test DB
pnpm test:e2e                 # Playwright (mobile 390×844, desktop 1440×900, projection 1920×1080)
pnpm test:all                 # everything + generates the .docx test report

If a command above does not exist yet, create it in package.json and document it in README.md.

Build workflow (coding agent)
Read the relevant section of AGENT_PROMPT.md.
Post a plan: the files to create or change, and the tests to add.
Implement domain logic first (src/server/domain/) with unit tests, then services, then routes and UI.
Run lint, type-check and the affected tests. Fix everything before moving on.
Update README.md and .env.example if anything changed.
Commit with Conventional Commits (feat:, fix:, test:, docs:, chore:), one logical change per commit.
At the end of a phase, report and wait for approval.
Test workflow (test agent)
Follow TEST_AGENT_PROMPT.md. Define test cases in tests/test-cases.md with IDs TC-<AREA>-<NNN> mapped to FR/AC/NFR IDs.
Run all levels against a clean stack.
Diagnose every failure: symptom, evidence, root cause (confirmed or suspected), the violated requirement, and a suggested fix.
Generate reports/test-run-<YYYYMMDD-HHmm>-<sha>.docx with tests/reporting/generate-test-run-report.ts. Render it to images and check it before finishing.
Hand the Fatal/Critical findings to the coding agent as the fix list. Re-run the failing tests after the fixes.
Skills and tools
Use the docx skill and the docx npm package for test reports. Never hand-edit a generated .docx.
Use the xlsx skill when inspecting or producing Excel fixtures and exports.
Use Playwright traces, screenshots and videos as evidence for failures.
Use Context7 or official docs for current Next.js, Prisma and Playwright APIs. Do not rely on memory for version-specific details.
Definition of done (any task)
Lint and type-check are clean, and all related tests pass.
New code is commented, with requirement IDs where applicable.
README.md is updated if behavior, setup or commands changed.
No secrets and no hard-coded UI strings.
Open questions are recorded in README.md → "Known limitations and open questions".