# USCC Referee Results Web

Internal web app for **USCC** (a chess club in Ho Chi Minh City) that lets arbiters run tournament results without printed pairing lists.

> **Status: Phase 3 (Realtime, projection, offline) complete.** Phases 1–2 (accounts, tournaments, manual pairings, the recording flow with two-player confirmation, the TD console) plus live updates over SSE, the projection screen with branding and logo, and the offline queue on recorder phones. Import/export and deployment hardening come in Phases 4–5 (see [AGENT_PROMPT.md](AGENT_PROMPT.md) §4). Sections below mark features that are not built yet as *(Phase N)*.

---

## 1. Introduction

**Who uses it**

- **Technical arbiter (TD, `TECHNICAL`)**: creates tournaments, imports pairings exported from Swiss-Manager, resolves disputes, opens the projection screen, exports results back to Swiss-Manager, and manages accounts.
- **Result recorder (`RECORDER`)**: finds a board on their phone, enters the result, then hands the phone to White and then to Black, who confirm in turn. Players have no accounts.

**Problem it solves.** At venues with no printer, players crowd the arbiter's laptop to find their board, results are relayed by voice or paper slips, and wrong results are found only after the next round is paired. The app gives arbiters a fast, verified and logged channel between the playing area and Swiss-Manager.

**Core rule.** A result becomes **OFFICIAL** only after both players confirm it, or after a TD approves an exception with a reason. Only official results appear on the projection screen and in default exports.

**Out of scope (v1).** The app does not:

- generate pairings, tiebreaks or official standings (Swiss-Manager does this),
- connect directly to the Swiss-Manager database (Excel files only),
- have a native mobile app, registration, payments or membership management,
- have player or spectator accounts, or any public page,
- resolve disputes automatically (the TD decides),
- calculate ratings or publish to Chess-Results.

## 2. Features

| Role | Feature | Status |
|---|---|---|
| Both | Login / logout; sessions end after 16 h of inactivity | ✅ Phase 1 |
| Both | Home page with tournaments and links to each round | ✅ Phase 2 |
| TD | Account management: create, deactivate, reactivate, reset password | ✅ Phase 1 |
| TD | Create tournaments; edit details, colours (contrast warning), logo and result codes | ✅ Phases 2–3 |
| TD | Manual pairing entry | ✅ Phase 2 |
| Both | Pairing list with search by board, name (diacritics ignored) or player ID | ✅ Phase 2 |
| Both | Result entry and two-player confirmation on the recorder's phone | ✅ Phase 2 |
| TD | Console: dispute queue, approve / edit / cancel / reopen with reason, audit history | ✅ Phase 2 |
| TD | Live projection screen: official results only, within 5 s (measured p95 ≈ 0.1 s locally), paging, offline banner | ✅ Phase 3 |
| Both | Round list and console update live, with a connection indicator | ✅ Phase 3 |
| Recorder | Offline queue with "Chưa đồng bộ (N)" badge; each action applied exactly once on reconnect | ✅ Phase 3 |
| TD | Excel import wizard (mapping, preview, row/column errors, diff) | Phase 4 |
| TD | Excel export (official only by default; pending/disputed separately) | Phase 4 |
| Ops | Production Docker image, Caddy HTTPS, backups, rate limiting, CSRF token, Sentry | Phase 5 |

## 3. Architecture overview

**Stack:** TypeScript (strict) · Next.js 15 App Router · React 19 · Tailwind CSS 3 · PostgreSQL 16 · Prisma 5 · Zod 3 · argon2 · ExcelJS *(Phase 4)* · Server-Sent Events over PostgreSQL LISTEN/NOTIFY *(Phase 3)* · IndexedDB via `idb` *(Phase 3)* · Vitest · Playwright · Docker Compose + Caddy.

```mermaid
flowchart LR
  subgraph Clients
    R[Recorder phone]
    T[TD laptop]
    P[Projection screen]
  end
  subgraph App[Next.js app]
    MW[Edge middleware<br/>cookie gate]
    RH[Route handlers<br/>auth · role · idempotency]
    SV[Services<br/>one transaction per use case]
    DM[Domain<br/>state machine, rules]
    RT[Realtime<br/>LISTEN/NOTIFY → SSE]
  end
  DB[(PostgreSQL)]
  FS[(File storage<br/>uploads, logos)]
  SM[Swiss-Manager<br/>on TD laptop]

  R & T -->|HTTPS JSON| MW --> RH --> SV --> DM
  SV --> DB
  SV --> FS
  DB -- NOTIFY result_changed --> RT -- SSE --> T & P
  SM -. Excel export .-> T
  T -. Excel export .-> SM
```

**Request pipeline (every authenticated API route).** Same-origin check on mutations → session lookup in the database (401) → role permission from the SRS §4.1 matrix (403) → Zod validation (400) → `Idempotency-Key` check and one transaction that holds both the change and the stored response → JSON error `{ code, messageVi }`.

**Result lifecycle** (implemented in Phase 2 in `src/server/domain/result-state-machine.ts`, the only code allowed to change a result's status):

```mermaid
stateDiagram-v2
  [*] --> NONE
  NONE --> PENDING: submitResult (recorder/TD)
  REOPENED --> PENDING: submitResult
  NONE --> OFFICIAL: submitResult by TD, code without player confirmation (bye, forfeit)
  PENDING --> PENDING: confirmBySide (first side)
  PENDING --> OFFICIAL: confirmBySide (second side)
  PENDING --> DISPUTED: rejectBySide
  PENDING --> OFFICIAL: approveException(reason) TD
  DISPUTED --> OFFICIAL: approveException(reason) TD
  OFFICIAL --> REOPENED: reopen(reason) TD
  OFFICIAL --> PENDING: editResult(code, reason) TD
  DISPUTED --> PENDING: editResult(code, reason) TD
  PENDING --> NONE: cancel(reason) TD
  DISPUTED --> NONE: cancel(reason) TD
  OFFICIAL --> NONE: cancel(reason) TD
  REOPENED --> NONE: cancel(reason) TD
```

`editResult` is also allowed from PENDING and REOPENED (back to PENDING); `editResult` and `cancel` are never allowed from NONE. Every TD reason (approve, reopen, edit, cancel) must be at least 5 characters (SRS-SM-05 to SRS-SM-08).

Every transition checks and increments `version` (409 on a stale version), writes a `result_events` row, and fires `NOTIFY result_changed`, all in one transaction. `result_events` is append-only, enforced by a database trigger.

## 4. Project structure

```
src/
  app/                  routes and route handlers only (no business logic)
    api/auth/           login, logout (the only public API route is login)
    api/users/          account management API (TD)
    api/tournaments/    tournaments, result codes, round games and manual boards
    api/games/          one game, its history, and the six result actions
    admin/users/        account management page (TD)
    tournaments/        TD list; [id]/settings, [id]/console, [id]/rounds/[n] and /manual
    record/[gameId]/    mobile result entry and two-player confirmation
    login/  forbidden/  public login page; access-denied page
  components/           presentational React components
  client/               browser-only code: API calls with Idempotency-Key, realtime/ (SSE hook), offline/ (IndexedDB queue, sync engine, offline prediction)
  i18n/vi.ts            every Vietnamese UI string
  middleware.ts         Edge gate: no session cookie → /login or 401
  server/
    auth/               password hashing, session tokens and store, cookies, permission matrix, guards
    config/             validated environment variables
    database/           shared Prisma client and transaction client type
    domain/             pure business rules (no DB, no HTTP)
    http/               ApiError, the route-handler wrapper, result-action route factory, page loaders
    services/           DB-backed use cases: auth, accounts, idempotency, tournaments, result codes,
                        manual pairings, the result lifecycle, game queries
    validation/         Zod schemas for Phase 2 request bodies and queries
    realtime/           PostgreSQL LISTEN connection (pg), in-process event hub, SSE stream builder
    storage/            FileStorage interface + local-disk implementation (logos; workbooks in Phase 4)
    import/ export/     Phase 4
prisma/                 schema.prisma, migrations/, seed.ts
tests/
  unit/                 pure modules (Vitest)
  integration/          services and route handlers against the test database (Vitest)
  e2e/                  browser flows (Playwright, mobile 390×844 and desktop 1440×900)
  helpers/              test database preparation and fixtures
docker/                 Dockerfile, Caddyfile (draft; finished in Phase 5)
docs/                   BRD, SRS, PRD, technical notes, Chess-Results sample workbook
```

## 5. Prerequisites

| Tool | Version used for development | Minimum |
|---|---|---|
| Node.js | 24.x | 20 LTS |
| pnpm | 12.x | 9 |
| Docker (with Compose v2) | Docker Desktop 4.x / Engine 29 | Compose v2 |
| PostgreSQL | 16 (via the `postgres:16-alpine` image) | 16 |

On Windows, run the commands below in Git Bash or PowerShell.

## 6. Setup, step by step

1. **Clone and install.**
   ```bash
   git clone <repository-url> uscc-referee-results
   ```
   ```bash
   cd uscc-referee-results
   ```
   ```bash
   pnpm install
   ```
   `pnpm install` also runs `prisma generate`. Native builds (argon2, Prisma engines, esbuild) are allowed in `pnpm-workspace.yaml`.

2. **Create your environment file.**
   ```bash
   cp .env.example .env
   ```
   Change `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL` and `TEST_DATABASE_URL` if you like; the defaults work locally.

3. **Start PostgreSQL.**
   ```bash
   docker compose up -d
   ```

4. **Apply migrations.**
   ```bash
   pnpm db:migrate
   ```

5. **Seed demo data**: one TD, one recorder, the tournament "Giải Demo USCC 2026" with 2 rounds × 10 boards, 20 fictional players and the default result codes. Safe to re-run.
   ```bash
   pnpm db:seed
   ```

6. **Start the dev server** and open http://localhost:3000.
   ```bash
   pnpm dev
   ```

**Demo logins (local development only):**

| Role | Username | Password |
|---|---|---|
| TECHNICAL | `td_demo` | `TdDemo-2026!` |
| RECORDER | `recorder_demo` | `RecDemo-2026!` |

Override them with the `SEED_*` variables before seeding. Never use these accounts on a deployed server.

### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL URL used by Prisma and the app. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | for docker compose | Initialise the PostgreSQL container; must match `DATABASE_URL`. |
| `TEST_DATABASE_URL` | for integration tests | Separate database; its name must contain `test`. Created and migrated automatically by `pnpm test:integration`. |
| `APP_URL` | yes in production | Public origin, e.g. `https://kq.example.org`. Mutations whose `Origin` header differs are rejected. Default `http://localhost:3000`. |
| `SESSION_IDLE_TIMEOUT_HOURS` | no | Hours of inactivity before a session ends (SRS-AUTH-04). Default `16`. |
| `SESSION_COOKIE_SECURE` | no | `true`/`false` to force the cookie's Secure flag. Default: on in production, off in development. |
| `NODE_ENV` | no | `development`, `test` or `production`. |
| `SEED_TD_USERNAME`, `SEED_TD_PASSWORD`, `SEED_RECORDER_USERNAME`, `SEED_RECORDER_PASSWORD` | no | Override the demo accounts created by `pnpm db:seed`. |
| `UPLOAD_DIRECTORY` | no | Folder for uploaded files (logos now, pairing workbooks in Phase 4). Default `./storage/uploads`. It must persist and be backed up. |
| `SENTRY_DSN` | no | Error tracking *(wired in Phase 5)*. |

Older `.env` files may still contain `SESSION_SECRET`, `SESSION_MAX_AGE_SECONDS` and `NEXT_PUBLIC_APP_URL`. Nothing reads them any more, because sessions are random tokens stored in the database. Remove them.

## 7. Usage guide

### Technical arbiter (TD)

**Create an arbiter account**
1. Sign in at `/login` with a TECHNICAL account.
2. Click **Tài khoản** in the header (`/admin/users`).
3. Under **Tạo tài khoản mới**, enter a username (3–40 characters: lowercase letters, digits, `.`, `_` or `-`), a password of at least 10 characters, and a role. Click **Tạo tài khoản**.
4. To lock someone out, click **Vô hiệu hóa**. Their sessions end immediately. You cannot deactivate yourself or the last active TD.
5. To change a password, click **Đặt lại mật khẩu**. The user's existing sessions end.

The first TD account comes from the seed script in development. For production, see §9.

**Create a tournament**
1. Click **Giải đấu** in the header (`/tournaments`).
2. Fill in **Tạo giải đấu mới**: name, dates, venue, organizer, number of rounds (1–20), timezone and colours. A yellow note warns when a colour gives white text a contrast below 4.5:1. Click **Tạo giải đấu**.
3. You land on the settings page. Rounds 1..n exist, and the nine default result codes are listed under **Mã kết quả**. **Confirm or adjust the codes before round 1** (OI-03): edit a row and click **Lưu**, **Ẩn** a code you do not use, or add one with **Thêm mã**. A code already used by a result can only be hidden, relabelled, re-ordered or given a new Swiss-Manager value.

**Enter pairings manually** (until the importer lands in Phase 4)
1. On the settings page, under **Nhập cặp đấu**, click the round.
2. For each board, enter the board number, then White's Swiss-Manager ID, name, club and points before the round, and the same for Black. Leave Black's name empty for a bye. Click **Lưu bàn**.
3. Players are matched by ID first. Without an ID, a name matches only if exactly one existing player has it. The form refuses, with a Vietnamese message:
   - an ID that belongs to a differently named player,
   - a name shared by several players,
   - a player already on another board,
   - a duplicate board number.

   Players are never merged automatically.
4. **Sửa** edits a board, and **Xóa** deletes one. A board whose result is not "Chưa có kết quả" cannot be changed: cancel the result in the console first.

**Resolve results in the console** (`/tournaments/[id]/console`)
1. Pick the round. The counters show games per status.
2. **Hàng chờ bất đồng** lists disputed results across all rounds, oldest first, with who disagreed and when.
3. Click **Xử lý** on a game. Depending on its status you can:
   - **Duyệt ngoại lệ**: approve as an exception, optionally choosing another code;
   - **Sửa kết quả**: pick a new code; the players must confirm again;
   - **Mở lại**: reopen an official result;
   - **Hủy kết quả**: cancel, back to "Chưa có kết quả".

   Every action needs a reason of at least 5 characters.
4. **Lịch sử thay đổi** lists every event for the game: time in the tournament timezone, account, action, old → new status and reason.
5. Byes and forfeits: open **Mở trang ghi kết quả** and choose the code. It becomes official at once and is never shown as confirmed by both players.

**Upload a logo**
1. On the settings page, under **Logo**, choose a PNG, JPEG or SVG file (at most 2 MB) and click **Tải lên**.
2. The file type is checked from the file's content, not its name. The logo appears on the projection screen within seconds.

**Open the projection screen**
1. Connect the laptop to the projector and sign in as a TD.
2. Click **Màn hình trình chiếu** on any tournament page. It opens in a new tab at `/tournaments/[id]/projection`. Press F11 for full screen.
3. The screen shows the latest round that has pairings. Add `?round=2` to pick a round, and `&pageSeconds=15` to change how fast pages rotate when the round does not fit one screen (5–30 s, default 10 s).
4. Only official results are shown. Pending, disputed and reopened results leave the cell empty. Byes show **Miễn đấu**. Points in brackets are provisional points from the pairing data.
5. **Cập nhật lúc HH:mm:ss** shows the last successful sync. If the connection drops, a red banner appears and the last data stays on screen. The screen reconnects by itself (1 s, 2 s, 4 s … up to 30 s) and reloads everything when it is back.

**Import Excel, export Excel** *(Phase 4)*.

### Recorder

1. Sign in at `/login` on your phone with a RECORDER account.
2. On the home page, tap the round. Search by board number, a player's ID, or a name. Diacritics are optional: "nguyen van an" finds "Nguyễn Văn Ân".
3. Tap the board, then tap the result (e.g. **1 – 0 Trắng thắng**).
4. Read the review screen back: White, Black, the score and the result in words. Tap **Gửi cho kỳ thủ xác nhận**, or **Sửa** to choose again.
5. **Check you have the right player, then hand the phone to White.** White's screen shows only White's name, the side and the result. White taps **Xác nhận** or **Không đồng ý**. The buttons lock after one tap.
6. Tap **Tiếp tục: đưa máy cho kỳ thủ Đen** and hand the phone to Black, who does the same.
7. The final screen shows the status. Two confirmations make it **Chính thức**. Any "Không đồng ý" makes it **Có bất đồng** and sends it to the TD. Tap **Về danh sách**.
8. If the page closes mid-flow, open the board again: it resumes at the first player who has not confirmed yet.
9. If another arbiter changed the board meanwhile, you see "Kết quả đã thay đổi. Vui lòng tải lại." Tap **Tải lại**.
10. Byes and forfeits are entered by the TD only.
11. **No network?** Carry on. Each action is saved on the phone, and the header shows a yellow **Chưa đồng bộ (N)** badge. The flow continues as normal: White, then Black, then the final screen.
    - Actions are sent automatically, in order, when the network returns. Tap the badge to send them immediately.
    - Each action is applied exactly once, even if it is retried.
    - The queue survives closing the page or the browser, but it is tied to your account: stay signed in until the badge disappears.
    - If another arbiter changed the board in the meantime, a red notice explains which action was not sent and why. Check that board.

## 8. Testing

| Command | What it runs | Needs |
|---|---|---|
| `pnpm lint` | ESLint (Next.js + TypeScript rules, zero warnings allowed) | — |
| `pnpm typecheck` | `tsc --noEmit` in strict mode | — |
| `pnpm test:unit` | Vitest, `tests/unit`: **every result action × status × role against the SRS §7 table**, confirmation guards, byes and TD reasons; the offline sync engine (order, same key, backoff, drop-and-report, 401 keep, owner filter) and offline prediction; retry backoff, projection paging, logo type detection, SSE/NOTIFY parsing; session tokens, argon2, the permission matrix, origin check, Zod schemas, deactivation rules, date formatting, ½ display, search, contrast, manual pairing rules, default result codes, idempotency keys | — |
| `pnpm test:integration` | Creates and migrates `TEST_DATABASE_URL`, then Vitest `tests/integration`: sessions, accounts, idempotency, real route handlers (401, 403, origin, missing key, cookie flags, recorder 403s on TD routes, idempotent retry), the append-only trigger; the result lifecycle (full flow, dispute → approval, stale version, simultaneous submits, byes, hidden codes, reopen/edit/cancel); tournament and pairing services; **a committed transition reaches an open SSE stream through LISTEN/NOTIFY and a rolled-back one does not**; streams close when the session ends; the projection carries only OFFICIAL results; logo upload (type, size, path traversal) | Docker PostgreSQL |
| `pnpm test:e2e` | Playwright on mobile (390×844), desktop (1440×900) and projection (1920×1080): auth flows; enter → White → Black → OFFICIAL; reject → DISPUTED → TD approves; TD tournament setup; **projection latency over 20 iterations (each < 5 s, p95 printed)**; disputed results never projected; offline banner and reconnect; **offline → reload → online syncs exactly once**; **a lost response is retried with the same key and applied once** | Docker PostgreSQL, `pnpm db:seed`; starts `pnpm dev` itself if not running |
| `pnpm test:all` | unit + integration + e2e | all of the above |

Run `pnpm exec playwright install chromium` once before the first e2e run. Failure traces, screenshots and videos are saved in `test-results/`, and the HTML report in `playwright-report/`. The `.docx` test-run report generator (TEST_AGENT_PROMPT.md) is not built yet.

## 9. Deployment *(Phase 5)*

The production Dockerfile, Caddy config, backup script and restore procedure are delivered and tested in Phase 5. Drafts are in `docker/`. Until then:

- Run behind HTTPS only, with `NODE_ENV=production` so the session cookie is `Secure`.
- Set `APP_URL` to the public origin.
- Create the first TD account by running the seed with `SEED_TD_*` set, then delete the demo recorder and tournament. A dedicated `create-admin` command is planned for Phase 5.

## 10. Configuration reference

**Result codes.** Each tournament has its own list (`result_codes`). New tournaments get the SRS-TOUR-06 defaults below. **The list and the Swiss-Manager values are a proposal (open question OI-03); the TD must confirm them before round 1.**

| Code | Label | White | Black | Players confirm? | Swiss-Manager value (placeholder) |
|---|---|---|---|---|---|
| `1-0` | Trắng thắng | 1 | 0 | yes | `1-0` |
| `0-1` | Đen thắng | 0 | 1 | yes | `0-1` |
| `½-½` | Hòa | ½ | ½ | yes | `½-½` |
| `+/-` | Trắng thắng do Đen bỏ cuộc | 1 | 0 | no | `+/-` |
| `-/+` | Đen thắng do Trắng bỏ cuộc | 0 | 1 | no | `-/+` |
| `-/-` | Cả hai bỏ cuộc | 0 | 0 | no | `-/-` |
| `BYE` | Miễn đấu (1 điểm) | 1 | 0 | no | `+` |
| `BYE½` | Miễn đấu (½ điểm) | ½ | 0 | no | `½` |
| `BYE0` | Miễn đấu (0 điểm) | 0 | 0 | no | `-` |

Codes with "Players confirm? = no" go straight to OFFICIAL when a TD submits them, and are never displayed as "confirmed by both players". Scores are stored as `DECIMAL` (½ = 0.5) and shown as ½.

**Timezone.** Each tournament has an IANA timezone, `Asia/Ho_Chi_Minh` by default. Timestamps are stored as `timestamptz` (UTC) and displayed as `DD/MM/YYYY HH:mm` (24-hour) in that zone. Tournament start and end dates are calendar dates (`DATE`).

**Branding.** Each tournament has a primary and secondary colour, edited on the settings page with a contrast warning below 4.5:1, plus an optional logo (PNG, JPEG or SVG, ≤ 2 MB, stored under `UPLOAD_DIRECTORY`). The projection screen applies the colours through the CSS variables `--brand-primary` and `--brand-secondary`. SVG logos are served with a sandboxing Content-Security-Policy and shown only as images.

**Realtime.** Every change sends `NOTIFY result_changed` or `NOTIFY tournament_changed` inside its transaction, so it is delivered only on commit. One `pg` connection per app process LISTENs and fans changes out to SSE streams (`GET /api/tournaments/[id]/events`). Streams send a heartbeat every 15 s and re-check the session each time. Clients reconnect with backoff (1 s → 30 s) and reload full state on every reconnect.

**Sessions.** Opaque 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only the token's SHA-256 hash is stored. Sessions slide forward on activity and end after `SESSION_IDLE_TIMEOUT_HOURS` without activity, on logout, on deactivation or on a password reset.

## 11. Known limitations and open questions

**Open questions (do not guess; owners per SRS §13):**

1. **OI-01:** The real Swiss-Manager pairing export and the Swiss-Manager version USCC uses have not been provided. The importer (Phase 4) will use user-driven column mapping; the Chess-Results sample in `docs/` is a test fixture only.
2. **OI-02:** Whether that Swiss-Manager version can re-import results from Excel, and in what layout. Until confirmed, the exporter writes a generic workbook isolated in one module.
3. **OI-03:** The final result-code list and Swiss-Manager values. The defaults in §10 are a proposal. **Assumption:** forfeits and byes do not require player confirmation, because at least one player is absent.
4. **OI-04:** The procedure when a player disputes a result or cannot confirm it personally. Not yet decided. **Phase 2 behaviour:** a rejection sends the result to the TD's dispute queue. When a player cannot confirm, the TD uses **Duyệt ngoại lệ** with a written reason.
5. **OI-05:** Hosting provider, budget and data-retention period.
6. **OI-06:** Session lifetime (16 h implemented) and login-lock thresholds (5 tries / 10 min proposed; built in Phase 5).
7. **OI-07:** Capacity figures (200 players, 10 recorders) are estimates.

**Conflicts between documents** (AGENT_PROMPT.md wins per CLAUDE.md, flagged for a decision):

- *Resolved 2026-10-30:* the SRS state-machine rules are adopted: `cancel(reason)` → NONE is added, `edit` is allowed from any state except NONE, and TD reasons need at least 5 characters. AGENT_PROMPT §3.3 has been updated to match.
- The SRS lists login rate limiting (SRS-AUTH-05) and a CSRF token (SRS §10.2) as auth requirements; AGENT_PROMPT schedules them for Phase 5. Phase 1 ships an `Origin` check plus `SameSite=Lax` as the interim CSRF defence, and **no login rate limiting yet**.

**Current limitations:**

- `/api/auth/login` and `/api/auth/logout` do not require an `Idempotency-Key`. Repeating them is harmless, and the offline queue never replays them. Every other mutating endpoint requires one.
- Idempotency records are kept until `deleteExpiredIdempotencyRecords` is scheduled (planned with the Phase 5 maintenance jobs; SRS asks for at least 48 h retention).
- Deleting a tournament or result that has audit history is blocked by the append-only trigger by design. There is no delete feature.
- **Assumptions made in Phase 2 (flag if wrong):**
  - Only a TD can submit codes that skip player confirmation (byes, forfeits), per SRS-SM-04. Recorders do not see those codes.
  - A bye game can only take such a code.
  - `editResult` to a bye/forfeit code still goes to PENDING, as SRS-SM-07 says, so the TD then approves it as an exception.
  - Editing or deleting a board whose result is not NONE is refused; the TD cancels the result first. A board with any result history cannot be deleted.
  - A result code that results ever used (now or in the audit log) cannot be deleted, and its code, scores and confirmation flag cannot change.
  - An all-digit search matches the board number or a player ID exactly. Text matches names (diacritics ignored) and IDs by substring.
- The record page is not live-updated, because it shows one game and is refreshed by each action's response. A conflicting change by another arbiter appears as the 409 "Kết quả đã thay đổi" message with **Tải lại**.
- **Realtime is per process:** the LISTEN connection and event hub live in the Next.js process. Run one app instance (the v1 deployment target). Several instances would each need their own listener, which works as is, but is untested.
- **Offline queue scope:** only the recorder actions (submit, confirm, reject) are queued. TD console actions and setup forms need a connection and show an error otherwise. Queued actions belong to the account that made them; another account signing in on the same phone does not send them. There is no offline page cache (no service worker), so the record page must be open before the network drops.
- **Phase 3 dependency added (approved):** `pg` (and `@types/pg`) for PostgreSQL LISTEN. `idb` is part of the original stack.
- Under `next dev`, routes compile on first use, so the Playwright timeouts are generous (expect 20 s, test 90 s). Playwright is also capped at 2 workers: the default of half the CPU cores overloaded the dev server, and requests stalled. The flows take about 15 s once compiled.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| `Can't reach database server at localhost:5432` | Start Docker Desktop, then `docker compose up -d`. Check with `docker compose ps`. If port 5432 is taken, set `POSTGRES_PORT` and update the port in `DATABASE_URL`. |
| `@prisma/client did not initialize yet` | Run `pnpm db:generate` (the client is stale after a schema change). |
| `Invalid server environment — …` on start | A variable in `.env` is missing or malformed. Compare with `.env.example`. |
| Migration fails with `relation already exists` | The dev database has tables from an older schema. Only on your local dev DB: `pnpm exec prisma migrate reset`. This deletes all local data. |
| `ERR_PNPM_IGNORED_BUILDS` during install | Make sure `pnpm-workspace.yaml` is present; it allows the argon2 and Prisma build scripts. |
| Login works but you are immediately sent back to `/login` | You are on plain `http://` with `NODE_ENV=production`, so the `Secure` cookie is dropped. Use HTTPS, or set `SESSION_COOKIE_SECURE=false` for local testing only. |
| Mutations return `403 CROSS_ORIGIN_REJECTED` | `APP_URL` does not match the address in the browser (scheme, host and port must all match). |
| `Refusing to use database … for tests` | `TEST_DATABASE_URL` must name a database containing `test`. |
| Live status shows "Mất kết nối trực tiếp" behind a proxy | Disable response buffering for `/api/tournaments/*/events` (the app sends `X-Accel-Buffering: no`; Caddy streams by default), and allow idle connections longer than the 15 s heartbeat. |
| Logo upload returns 500 | `UPLOAD_DIRECTORY` is not writable by the app user. Create it and give the app user write access. |
