Agent Prompt — USCC Referee Results Web (v1)
You are a senior full-stack engineer. Build the web application specified below, from an empty repository to a working v1 that a technical arbiter (TD) and result recorders can use at a live chess tournament. Work in phases. Stop at the end of each phase and report. Do not skip ahead.

0. Context
USCC (a chess club in Ho Chi Minh City, Vietnam) runs tournaments where pairings are generated in Swiss-Manager. When no printer is available, arbiters need a web app to:
look up pairings by round, board, name or player ID,
record game results on the recorder's phone right after the game,
let both players confirm the result in turn on the recorder's phone (players have no accounts),
publish only confirmed or TD-approved results to a projection screen,
export results to Excel so the TD can enter them back into Swiss-Manager.
Only arbiters with accounts can access the site. Players and spectators never open it. The UI language is Vietnamese. Code, comments, identifiers and the README are in English.
Out of scope for v1
Generating pairings, calculating tiebreaks or official standings (Swiss-Manager does this).
A direct connection to the Swiss-Manager database.
A native mobile app, registration, payments, or membership management.
Automatic dispute resolution. The TD decides.

1. Mandatory coding rules
Apply these rules to every file you write. Code that breaks them is not done.
1.1 Comments
Start every source file with a header comment of 2–5 lines stating the file's purpose and its main responsibilities.
Give every exported function, component, class, type and API route handler a JSDoc/TSDoc block with: 
oa one-sentence summary,
o@param for each parameter, including units and allowed values,
o@returns,
o@throws, where applicable.
Comment non-obvious logic inline: state transitions, locking, retries, timezone handling, Excel parsing edge cases.
Comments explain why and what the business rule is. Do not restate the code (// increment i is forbidden).
Reference the requirement ID when code implements one, for example // FR-06: result becomes OFFICIAL only after both confirmations or TD approval.
Leave no commented-out dead code and no unresolved TODOs. If something must be deferred, record it in README.md under "Known limitations".
1.2 Naming
Variables and functions use full, descriptive English names: pendingResultConfirmation, confirmPlayerResult(), buildRoundExportWorkbook(). Never use x, tmp, data2, handle(), or doStuff().
Booleans start with is, has, can or should: isWhiteConfirmed, hasUnsyncedActions.
Function names start with a verb: importPairingsFromWorkbook, approveDisputedResult.
Files use kebab-case and name their single responsibility: result-state-machine.ts, swiss-manager-pairing-importer.ts, projection-screen.tsx. Never use names like utils.ts, helpers.ts or misc.ts.
Database tables and columns use snake_case. TypeScript uses camelCase. Types and components use PascalCase. Constants use UPPER_SNAKE_CASE.
Enum values are explicit and stable: NONE, PENDING, DISPUTED, OFFICIAL, REOPENED.
1.3 General quality
TypeScript strict: true. No any unless it is justified in a comment.
Validate every external input (HTTP body, query params, Excel rows) with Zod.
Keep functions short. If one exceeds ~50 lines, split it.
Keep business logic in src/server/domain/, separate from route handlers and UI. Domain modules must be unit-testable without a database or HTTP layer.
Every UI string shown to users comes from src/i18n/vi.ts. No hard-coded Vietnamese text in components.
Use Conventional Commits (feat:, fix:, test:, docs:, chore:). Make one logical change per commit.
1.4 README.md
Write README.md in Phase 1 and update it at the end of every phase. It must contain:
1.Introduction: what the app is, who uses it (TD, recorder), the problem it solves, and what it does not do (out-of-scope list).
2.Features: grouped by role.
3.Architecture overview: the tech stack, a text or Mermaid diagram of the components (browser clients, Next.js app, PostgreSQL, object storage, SSE channel), and the result lifecycle state diagram.
4.Project structure: a directory tree with one line per important folder.
5.Prerequisites: exact versions of Node.js, pnpm/npm, Docker and PostgreSQL.
6.Setup, step by step: clone, install, copy .env.example to .env, the meaning of every environment variable, starting the database with docker compose, running migrations, seeding demo data, and starting the dev server. A newcomer must reach a running app by following it literally.
7.Usage guide: how to create a TD account, create a tournament, import or enter pairings, record a result, run the two-player confirmation, open the projection screen, and export Excel. Write it as numbered steps per role.
8.Testing: how to run unit tests and end-to-end tests, and what each suite covers.
9.Deployment: building the production image, running docker compose on a VPS, Caddy/HTTPS, the backup schedule and restore procedure.
10.Configuration reference: result codes, timezone, and branding.
11.Known limitations and open questions: include the blockers in section 6 of this prompt.
12.Troubleshooting: common errors (DB connection, migrations, SSE behind a proxy) and their fixes.

2. Tech stack (fixed — do not substitute without asking)
Layer	Choice
Language	TypeScript (strict)
Framework	Next.js (App Router, route handlers), React
Database	PostgreSQL
ORM / migrations	Prisma
Validation	Zod
Auth	Session-based, credentials only, argon2 password hashing, HttpOnly + Secure + SameSite cookies. No public signup.
Realtime	Server-Sent Events, fed by PostgreSQL LISTEN/NOTIFY
Excel	ExcelJS
Styling	Tailwind CSS. Theme colors per tournament through CSS variables.
Client offline queue	IndexedDB (via idb)
Tests	Vitest (unit), Playwright (end-to-end, mobile viewport for recorder flows)
Packaging	Docker + docker compose (app, postgres, caddy)
Error tracking	Sentry, optional and enabled by env var

3. Domain specification
3.1 Roles
TECHNICAL (TD): configures tournaments, imports pairings, approves or overrides results, reopens results, opens the projection screen, exports Excel, manages accounts.
RECORDER: looks up games, enters results, runs the two-player confirmation. Cannot approve exceptions or edit official results.
3.2 Data model (Prisma)
Model	Key fields
User	id, username (unique), passwordHash, role, isActive, createdAt
Tournament	id, name, startDate, endDate, venue, organizer, roundsCount, timezone (default Asia/Ho_Chi_Minh), logoStorageKey, primaryColor, secondaryColor
ResultCode	id, tournamentId, code, labelVi, whiteScore, blackScore, requiresPlayerConfirmation, swissManagerValue, sortOrder
Player	id, tournamentId, swissManagerPlayerId, fullName, clubOrFederation, rating; unique (tournamentId, swissManagerPlayerId)
Round	id, tournamentId, roundNumber, status; unique (tournamentId, roundNumber)
Game	id, roundId, boardNumber, whitePlayerId, blackPlayerId (nullable for a bye), whitePointsBefore, blackPointsBefore; unique (roundId, boardNumber)
Result	id, gameId (unique), resultCodeId, status, whiteConfirmedAt, blackConfirmedAt, enteredByUserId, approvedByUserId, approvalReason, version
ResultEvent	id, resultId, actorUserId, action, oldValue (Json), newValue (Json), reason, createdAt. Append-only.
PairingImport	id, tournamentId, roundId, originalFilename, fileSha256, storageKey, uploadedByUserId, createdAt, rowErrors (Json)
ColumnMapping	id, tournamentId, mapping (Json)
Session	standard session fields
Store all timestamps as timestamptz. Display them in the tournament's timezone.
3.3 Result state machine (implement in src/server/domain/result-state-machine.ts)
States: NONE, PENDING, DISPUTED, OFFICIAL, REOPENED.
From	Action	Actor	To	Notes
NONE / REOPENED	submitResult	RECORDER or TECHNICAL	PENDING	Clears both confirmations.
PENDING	confirmBySide(WHITE or BLACK)	player on recorder's phone	PENDING, or OFFICIAL when both sides have confirmed	Each side can confirm once.
PENDING	rejectBySide	player on recorder's phone	DISPUTED	Never published.
PENDING / DISPUTED	approveException(code?, reason)	TECHNICAL	OFFICIAL	Reason is mandatory (≥ 5 characters). Logs actor and time.
OFFICIAL	reopen(reason)	TECHNICAL	REOPENED	Reason is mandatory (≥ 5 characters).
any except NONE	editResult(newCode, reason)	TECHNICAL	PENDING	Reason ≥ 5 characters; clears both confirmations. Requires reconfirmation or approveException.
any except NONE	cancel(reason)	TECHNICAL	NONE	Reason ≥ 5 characters; clears result code and confirmations.
Decision 2026-10-30 (product owner): the SRS §7 rules SRS-SM-05, 07 and 08 are adopted. Cancel is added, edit is not allowed from NONE, and every TD reason must be at least 5 characters.
Rules:
Result codes with requiresPlayerConfirmation = false (for example, a bye) go straight to OFFICIAL on submit by a TD. They must never be displayed as "confirmed by both players".
Every transition runs in one DB transaction. It checks version (optimistic lock), increments it, writes a ResultEvent, and fires NOTIFY result_changed.
A stale version returns HTTP 409 with a clear Vietnamese message telling the user to reload.
Every mutating endpoint accepts an Idempotency-Key header. Repeated keys return the original response without reapplying the action.
Write exhaustive unit tests for every allowed and every forbidden transition.
3.4 Pages
Route	Role	Purpose
/login	public	Credentials login
/tournaments	TD	List and create tournaments
/tournaments/[id]/settings	TD	Details, branding, result codes
/tournaments/[id]/import	TD	Import wizard: upload, choose sheet, map columns, preview with errors per row/column, diff against existing round data, confirm
/tournaments/[id]/rounds/[n]	TD, RECORDER	Pairing list with search by board, name or player ID, plus status per game
/tournaments/[id]/rounds/[n]/manual	TD	Manual pairing entry (needed before the importer is final)
/record/[gameId]	RECORDER, TD	Mobile: choose result, review screen, submit, then the confirmation flow
/tournaments/[id]/console	TD	Live statuses, disputed queue, approve/reopen/edit with reason, per-game audit history
/tournaments/[id]/projection	TD (logged in)	Full-screen read-only display: official results only, last sync time, offline banner
/tournaments/[id]/export	TD	Excel export for a round or the whole tournament. Official only by default; optional pending/disputed export.
/admin/users	TD	Create and deactivate accounts
3.5 Player confirmation UX (mobile)
1.The review screen shows White name, Black name, board number and the result in large text. The recorder taps "Gửi cho kỳ thủ xác nhận".
2.Step 1 screen: shows only the White player's name, the label "Trắng", the result, and two buttons, "Xác nhận" and "Không đồng ý". Minimum button height is 56 px.
3.After a tap, the step locks (it cannot be tapped again) and shows the outcome.
4.Step 2 screen: the same for Black.
5.Final screen: the resulting status.
The recorder is responsible for handing the phone to the correct player. Show a reminder line on each step.
3.6 Realtime and offline
The SSE endpoint /api/tournaments/[id]/events sends a heartbeat every 15 s and result-change events.
The client reconnects with exponential backoff (1 s up to 30 s) and shows the last successful sync time.
Target: an official result appears on the projection screen within 5 s on a normal connection. Write a Playwright test that asserts this.
Recorder actions that fail because the network is down go into an IndexedDB queue with their idempotency key, retry automatically, and show a visible "Chưa đồng bộ (N)" badge.
3.7 Excel import/export
Put the importer behind an interface, PairingImporter, in src/server/import/pairing-importer.ts. Implement it with user-driven column mapping: the TD picks which column holds board, white name, white ID, black name, black ID, and points.
Identify players by Swiss-Manager ID first. If only names are present, report duplicate or unknown names to the TD. Never auto-merge players.
Do not overwrite rounds that already have results without an explicit diff and TD confirmation.
Error messages name the sheet, row and column.
Use the Chess-Results sample (one sheet; rows 1–5 metadata, row 6 headers, then one board per row, columns Bàn, White, LĐ, Điểm, Kết quả, Điểm, Black, LĐ) only as a test fixture. Do not hard-code its layout.
Put the exporter behind an interface, ResultExporter. v1 writes a generic workbook with: tournament name, scope, generation time, and per game: round, board, white ID and name, black ID and name, result, status. Keep the format isolated in one module so it can be changed once the Swiss-Manager re-import format is known.

4. Phases
Report at the end of each phase with: what was built, how to run it, test results, and open issues. Then wait for approval.
Phase 1 — Foundation
Repository scaffold, strict TypeScript, ESLint + Prettier, Tailwind, docker compose (postgres), Prisma schema and first migration, seed script (one TD, one recorder, one demo tournament with 2 rounds of 10 boards and default result codes).
Auth: login, logout, sessions, role guards, /admin/users.
src/i18n/vi.ts.
First full README.md.
Done when: docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev works from a clean clone by following the README, and the auth unit tests pass.
Phase 2 — Result lifecycle
result-state-machine.ts with full unit tests.
Tournament settings, manual pairing entry, pairing list and search.
Recorder flow with the two-player confirmation.
TD console: approve, reopen, edit, audit history.
Done when: a Playwright test on a mobile viewport runs the flow enter result → White confirms → Black confirms → OFFICIAL, and a second test runs reject → DISPUTED → TD approves with reason.
Phase 3 — Realtime, projection, offline
SSE endpoint with LISTEN/NOTIFY, the projection screen, branding applied, the offline queue.
Done when: the 5-second projection test passes and an offline-then-online test shows the queued action syncing exactly once.
Phase 4 — Import and export
Import wizard with mapping, preview, errors and diff. Exporter.
Done when: importing the Chess-Results fixture works through manual mapping, malformed fixtures produce row/column errors, and an export of the seeded tournament contains only official results by default.
Phase 5 — Deployment and hardening
Production Dockerfile, Caddy config, pg_dump backup script with a cron example and a documented restore, login rate limiting, CSRF protection, optional Sentry.
Done when: the README deployment section is followed end to end on a clean Linux VM (document the commands you ran), and a backup is restored successfully.

5. Directory layout (target)
src/
  app/                      # Next.js routes (pages + route handlers only, no business logic)
  components/               # Presentational React components
  i18n/vi.ts                # All Vietnamese UI strings
  server/
    domain/                 # Pure business logic (state machine, result rules)
    services/               # DB-backed use cases calling domain + Prisma
    import/                 # PairingImporter interface + implementations
    export/                 # ResultExporter interface + implementations
    realtime/               # LISTEN/NOTIFY listener, SSE broadcaster
    auth/                   # Sessions, password hashing, role guards
  client/offline/           # IndexedDB action queue and retry logic
prisma/                     # schema.prisma, migrations, seed
tests/
  unit/
  e2e/
  fixtures/                 # Excel fixtures (Chess-Results sample, malformed files)
docker/                     # Dockerfile, Caddyfile, backup scripts

6. Open questions — do not guess, ask
If a task depends on one of these, implement it behind the interface, document the assumption in the README, and flag it in your phase report.
1.The real Swiss-Manager export file and the Swiss-Manager version USCC uses (not yet provided).
2.Whether that Swiss-Manager version can import results from Excel, and the exact format it needs.
3.The final result-code list per the tournament rules (forfeits, double forfeit, half-point and zero-point byes) and their Swiss-Manager values.
4.The procedure when a player disputes a result or cannot confirm it personally.
5.The hosting provider and data-retention period.

7. Working rules for you, the agent
Before writing code in each phase, post a short plan: files to create, tests to write.
Run the linter, type-check and all tests before you report a phase as done. Paste the summary output.
Do not add dependencies outside the stack without stating why.
Do not change requirements silently. If something in this prompt is contradictory or impossible, stop and ask.
Never commit secrets. Maintain .env.example with every variable documented.
