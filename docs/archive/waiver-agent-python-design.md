> **ARCHIVED — abandoned alternative direction.**
>
> A Phase 0/1 design (2026-08-31, never merged) for a Python/FastAPI + SQLAlchemy +
> docker-compose backend with an LLM-driven recommendation engine. The project went
> a different way: a TypeScript Next.js + pnpm monorepo with deterministic
> simulation (see [`CLAUDE.md`](../../CLAUDE.md), [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)).
> Kept for its Sleeper data-model and sync-flow detail, which is stack-independent.

---

# Waiver Agent — Phase 0 + Phase 1 Design

**Date:** 2026-08-31
**Status:** Approved for implementation planning
**Source of truth:** `REQUIREMENTS.md` (root of repo)
**Scope of this document:** Phase 0 (Foundation) and Phase 1 (Sleeper connection & roster). Later phases get their own specs.

---

## 1. Overview

Build a web application that connects to a user's Sleeper fantasy football league and answers *"What moves should I make this week to improve my fantasy team?"* — grounded in the user's actual roster and waiver wire, not generic advice.

The full system is broken into phases (see `REQUIREMENTS.md` §28). The first implementation push runs **through Phase 3** (personalized LLM waiver recommendations), then stops to reassess. This document specifies only the first two phases, which establish the substrate everything else builds on.

### Confirmed product decisions

| Decision | Choice |
|---|---|
| Usage model | **Single-tenant personal tool.** No accounts/passwords. Connect by Sleeper username. DB schema is multi-tenant-ready (every row FKs to a user/league) so accounts can be added later without a rewrite. |
| Non-Sleeper data | **Free nflverse-first stack** (Phase 2+): `nflreadpy`/nflverse for stats, schedule, depth charts, injuries; The Odds API free tier for Vegas lines; Open-Meteo for weather. Expert-ranking ingestion deferred to Phase 5. |
| LLM provider | **Anthropic now, fully swappable.** The `LLMProvider` abstraction is a first-class frozen interface. DeepSeek/others addable by config. |
| First milestone target | Through Phase 3, then reassess. |

---

## 2. Scope

### In scope (Phase 0)

- Monorepo scaffold (`api/` + `web/`), `docker-compose` dev environment, CI.
- FastAPI app factory, health endpoint with real DB round-trip.
- Config/secrets loading (env only).
- PostgreSQL with `raw` and `ai` schemas; Alembic baseline migration.
- Next.js App Router shell with Tailwind.
- **Sleeper API client** (typed, retrying, fixture-tested — no network in tests).
- **All frozen interfaces** listed in §5 (as importable modules with tests; real implementations land in their own phases).

### In scope (Phase 1)

- Connect a Sleeper user by username; resolve to Sleeper user id; signed session cookie.
- List the user's NFL leagues for the current season.
- Select a league → sync league settings, all rosters, league users; refresh player metadata cache.
- Player-metadata cache with a 24h full-refresh guard (Sleeper's stated limit).
- Roster dashboard: starting lineup by slot, bench, IR, taxi — each player enriched with position, NFL team, injury status.

### Explicit non-goals (deferred to later phases)

nflverse / external ingestion, team analyzer, waiver candidate filtering, positional-need model, projections, any LLM call, `ai.*` tables populated, expert rankings, odds, weather, bye-week display, opportunity/injury detection, K/DST streaming, notifications, background jobs, weekly report generation, the agent refactor.

---

## 3. Architecture

### 3.1 Core principle (from `REQUIREMENTS.md` §29)

> Separate **data retrieval**, **deterministic analysis**, **AI reasoning**, and **presentation**. The LLM is never the source of truth for structured fantasy data. Recommendations are structured objects traceable to the data and sources that produced them.

Enforced structurally:

- **Database:** `raw.*` schema holds retrieved facts; `ai.*` schema holds model-generated analysis. Separate schemas, not just naming.
- **Code:** `analysis/` services are pure functions over DB rows returning typed results + evidence; they never call the LLM. The `llm/` layer is only invoked by the recommendation engine (Phase 3), which validates every response against a Pydantic schema before persistence.
- **Provenance:** every retrieved fact links to a `raw.source` row (name, endpoint, `fetched_at`). Every recommendation (Phase 3) links to `Evidence` records that reference those sources.

### 3.2 Monorepo layout

```
Waiver-Agent/
├── docker-compose.yml            # postgres:16 + api + web
├── .env.example                  # every config key, documented; no secrets
├── .github/workflows/ci.yml
├── docs/superpowers/specs/       # this document and future phase specs
├── api/
│   ├── pyproject.toml            # uv-managed; ruff + mypy + pytest
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── src/waiver/
│   │   ├── config.py             # pydantic-settings
│   │   ├── main.py               # FastAPI app factory
│   │   ├── db.py                 # async engine + session dependency
│   │   ├── logging.py
│   │   ├── api_envelope.py       # response/error envelope helpers
│   │   ├── rate_limit.py         # basic per-IP limiter
│   │   ├── models/               # SQLAlchemy 2.0 — raw.* tables
│   │   │   ├── base.py           # RawBase (MetaData schema="raw"), AiBase
│   │   │   ├── app_user.py
│   │   │   ├── league.py
│   │   │   ├── player.py
│   │   │   ├── roster.py
│   │   │   └── source.py
│   │   ├── schemas/              # Pydantic API contracts
│   │   ├── sleeper/
│   │   │   ├── client.py         # async httpx wrapper, typed errors
│   │   │   ├── models.py         # Pydantic models for Sleeper payloads
│   │   │   ├── player_cache.py   # ensure_fresh + bulk upsert
│   │   │   └── league_sync.py    # SleeperLeagueSync (adapter-shaped)
│   │   ├── ingestion/
│   │   │   └── base.py           # IngestionAdapter ABC (FROZEN)
│   │   ├── llm/
│   │   │   ├── base.py           # LLMProvider ABC, ModelTier, StructuredResult (FROZEN)
│   │   │   └── mock.py           # MockLLMProvider
│   │   ├── recommendation/
│   │   │   └── schema.py         # Recommendation, RecAction, Confidence (FROZEN)
│   │   ├── evidence.py           # Evidence model (FROZEN)
│   │   ├── season.py             # season resolver
│   │   └── routers/
│   │       ├── health.py
│   │       ├── connect.py
│   │       ├── leagues.py
│   │       └── roster.py
│   └── tests/
│       ├── conftest.py           # test DB, transactional rollback per test
│       └── fixtures/sleeper/     # recorded JSON payloads
└── web/
    ├── package.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx              # connect screen
    │   ├── leagues/page.tsx
    │   └── roster/page.tsx
    ├── lib/api.ts               # typed fetch client (envelope-aware)
    ├── lib/types.ts             # mirrors API contracts
    └── components/
        ├── ConnectForm.tsx
        ├── LeagueRow.tsx
        └── RosterView.tsx
```

Two deployables (`api`, `web`) plus Postgres. `jobs/` is added in Phase 7.

### 3.3 Technology decisions

| Area | Choice | Rationale |
|---|---|---|
| Python deps | **uv** + `pyproject.toml` | Fast, lockfile, standard layout. Fallback: pip-tools. |
| Python version | 3.12 | Current stable; `StrEnum`, modern typing. |
| ORM | **SQLAlchemy 2.0 async + asyncpg** | FastAPI-native; every later phase is I/O-heavy. Alembic runs sync as normal. |
| Migrations | Alembic | `alembic_version` in `public`; baseline migration creates `raw` + `ai` schemas. |
| API models | Pydantic v2 | Required by `REQUIREMENTS.md` §23; used for Sleeper payload validation and API contracts. |
| Frontend | Next.js App Router + TS + Tailwind | Required by §23. Server components fetch from the API server-side; client components only for forms. |
| Session | Signed HTTP-only cookie holding `app_user.id` | Single-tenant, no OAuth (Sleeper has none). `itsdangerous` or Starlette `SignedCookie`. |
| Lint/type | ruff + mypy (api); eslint + tsc (web) | Enforced in CI. |
| Tests | pytest + httpx ASGITransport (api); Playwright (web smoke) | TDD per superpowers skill. |
| Test DB | Postgres via `DATABASE_URL_TEST`; migrations once per session; `SAVEPOINT` rollback per test | Compose provides a `waiver_test` database locally; CI uses a service container. |

---

## 4. Data model (`raw.*`)

All tables live in the `raw` schema. UUID (v4) primary keys for our entities; Sleeper ids stored as text with unique constraints. `created_at` / `updated_at` (`timestamptz`) on every table.

### `raw.app_user`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| sleeper_user_id | text unique not null | |
| sleeper_username | text not null | as entered / as returned |
| display_name | text | |

Single row in practice; table supports many.

### `raw.league`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| app_user_id | uuid fk → app_user | |
| sleeper_league_id | text not null | |
| name | text | |
| season | text not null | e.g. "2026" |
| sport | text | default "nfl" |
| total_rosters | int | |
| status | text | Sleeper league status |
| scoring_settings | jsonb | raw blob |
| roster_positions | jsonb | ordered array incl. BN / IR / TAXI |
| league_settings | jsonb | raw `settings` blob (waiver_type, waiver_budget, …) |
| previous_league_id | text | |
| synced_at | timestamptz | |
| | | unique (app_user_id, sleeper_league_id) |

Derived (not stored): `scoring_type` (PPR / half / standard from `scoring_settings.rec`), `superflex` (`"SUPER_FLEX"` in `roster_positions`), `te_premium` (`rec_te > rec`), `waiver_type` + `faab_budget` (from `league_settings`).

### `raw.player` (metadata cache)
| column | type | notes |
|---|---|---|
| sleeper_player_id | text pk | numeric string for players; team abbr for DST |
| first_name / last_name / full_name | text | |
| position | text | |
| team | text | nullable (free agents) |
| status | text | Active / Inactive / … |
| injury_status | text | Questionable / Out / IR / … (nullable) |
| injury_body_part | text | nullable |
| injury_start_date | date | nullable |
| depth_chart_position | text | nullable |
| depth_chart_order | int | nullable |
| fantasy_positions | jsonb | |
| age | int | nullable |
| years_exp | int | nullable |
| number | int | nullable |
| news_updated | bigint | epoch ms from Sleeper (nullable) |
| raw | jsonb | full original record |
| updated_at | timestamptz | |

### `raw.player_sync` (cache metadata)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| source | text | default "sleeper_players" |
| last_full_refresh_at | timestamptz | |
| player_count | int | |

### `raw.roster`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| league_id | uuid fk → league | |
| sleeper_roster_id | int not null | |
| sleeper_owner_id | text | nullable (empty teams) |
| owner_display_name | text | from league users |
| team_name | text | from user metadata (nullable) |
| is_current_user | boolean | default false |
| players | jsonb | array of player ids |
| starters | jsonb | ordered, positionally aligned to starting slots |
| reserve | jsonb | IR |
| taxi | jsonb | |
| settings | jsonb | wins, losses, ties, fpts, waiver_position, waiver_budget_used |
| synced_at | timestamptz | |
| | | unique (league_id, sleeper_roster_id) |

Bench is derived: `players − starters − reserve − taxi`.

### `raw.source` (provenance — created now, used everywhere later)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text not null | e.g. "sleeper" |
| endpoint | text | URL or logical name |
| fetched_at | timestamptz not null | |
| status | text | "ok" / "error" |
| detail | jsonb | counts, error message |

One row per sync run in Phase 1.

### `ai.*`

Phase 0 baseline migration creates the empty `ai` schema. Planned tables (**not created yet**): `ai.player_analysis`, `ai.recommendation`, `ai.alert`, `ai.evidence`. Documented in future specs.

---

## 5. Frozen interfaces (Phase 0)

These modules are written in Phase 0 with tests, and **must not change shape** without a coordinated update, because later phases (and parallel Orca workspaces) build against them. Real implementations land in their named phases.

### 5.1 `ingestion/base.py` — `IngestionAdapter` ABC

```python
class IngestionContext(BaseModel):
    season: str
    week: int | None = None
    as_of: datetime
    # http client + session are passed separately, not on the model

class RawPayload(BaseModel):
    source: str
    endpoint: str
    fetched_at: datetime
    data: Any

class NormalizedRecord(BaseModel):
    """Adapter-specific subclasses."""

class UpsertResult(BaseModel):
    inserted: int
    updated: int
    skipped: int
    source_id: str

class IngestionAdapter(ABC):
    source_name: str

    @abstractmethod
    async def fetch(self, client: httpx.AsyncClient, ctx: IngestionContext) -> RawPayload: ...

    @abstractmethod
    def normalize(self, payload: RawPayload) -> list[NormalizedRecord]: ...

    @abstractmethod
    async def upsert(self, session: AsyncSession, records: list[NormalizedRecord]) -> UpsertResult: ...

    async def run(self, session: AsyncSession, client: httpx.AsyncClient, ctx: IngestionContext) -> UpsertResult:
        """Template method: fetch → normalize → upsert → write raw.source row."""
```

**Fixture format:** `api/tests/fixtures/<source>/<name>.json` = `{"request": {...}, "response": {...}}`.

Phase 1's `SleeperLeagueSync` is the first real consumer and validates the interface end to end.

### 5.2 `llm/base.py` — `LLMProvider` ABC

```python
class ModelTier(StrEnum):
    CHEAP = "cheap"    # high-volume extraction / candidate analysis
    STRONG = "strong"  # final roster decisions

class TokenUsage(BaseModel):
    input_tokens: int
    output_tokens: int

class StructuredResult(BaseModel):
    parsed: BaseModel
    raw_text: str
    model: str
    usage: TokenUsage
    latency_ms: int

class Prompt(BaseModel):
    system: str
    user: str

class LLMProvider(ABC):
    @abstractmethod
    async def complete_structured(
        self, *, prompt: Prompt, schema: type[BaseModel], tier: ModelTier
    ) -> StructuredResult: ...
```

Phase 0 ships the ABC + `llm/mock.py::MockLLMProvider` (returns canned schema-valid responses) so downstream code and tests compile. `AnthropicProvider` lands in Phase 3.

Config keys: `LLM_PROVIDER` (default `mock`), `LLM_MODEL_CHEAP`, `LLM_MODEL_STRONG`, `ANTHROPIC_API_KEY`.

### 5.3 `recommendation/schema.py` — `Recommendation` (matches `REQUIREMENTS.md` §14)

```python
class RecAction(StrEnum):
    ADD = "ADD"; HOLD = "HOLD"; DROP = "DROP"
    STREAM = "STREAM"; MONITOR = "MONITOR"; PRIORITY_ADD = "PRIORITY_ADD"

class Confidence(StrEnum):
    LOW = "LOW"; MEDIUM = "MEDIUM"; HIGH = "HIGH"

class Recommendation(BaseModel):
    action: RecAction
    player_id: str
    priority: float                 # 0.0 – 10.0
    confidence: Confidence
    suggested_drop: str | None = None
    faab_min: int | None = None
    faab_max: int | None = None
    time_horizon: str               # "1 week" | "4 weeks" | "rest of season"
    reasons: list[str]
    risks: list[str] = []
    evidence_ids: list[str] = []
```

### 5.4 `evidence.py` — `Evidence`

```python
class Evidence(BaseModel):
    id: str
    type: str            # "injury" | "snap_share_trend" | "expert_ranking_delta" | ...
    detail: str
    source_id: str       # FK to raw.source
    as_of: datetime
    data: dict = {}
```

### 5.5 HTTP API envelope

Success: `{ "data": <payload>, "meta": { "synced_at": <iso8601|null>, "sources": [{ "name": str, "fetched_at": <iso8601> }] } }`

Error: `{ "error": { "code": str, "message": str, "detail": <any|null> } }`

`web/lib/types.ts` mirrors these. FastAPI still emits a full OpenAPI schema.

### 5.6 Config surface (`.env.example`)

```
DATABASE_URL=postgresql+asyncpg://waiver:waiver@localhost:5432/waiver
DATABASE_URL_TEST=postgresql+asyncpg://waiver:waiver@localhost:5432/waiver_test
API_URL=http://localhost:8000
SLEEPER_BASE_URL=https://api.sleeper.app/v1
SLEEPER_SEASON=                      # optional override; blank = auto-resolve
SLEEPER_PLAYER_CACHE_TTL_HOURS=24
SESSION_SECRET=change-me
LLM_PROVIDER=mock
LLM_MODEL_CHEAP=
LLM_MODEL_STRONG=
ANTHROPIC_API_KEY=
LOG_LEVEL=INFO
RATE_LIMIT_PER_MINUTE=60
```

---

## 6. Phase 0 — Foundation

### Deliverables

1. **Monorepo + compose.** `docker-compose up` starts `postgres:16` (named volume), `api` (uvicorn `--reload`), `web` (`next dev`). `api` waits for Postgres health.
2. **FastAPI app factory** (`main.py`) with CORS for `API_URL`/web origin, the rate-limit middleware, the envelope exception handlers, and routers mounted under `/api`.
3. **`GET /api/health`** → `{ status: "ok", db: "ok" | "error", version }` — performs `SELECT 1` through the async session.
4. **`config.py`** — `pydantic-settings` `Settings` loaded from env; imported everywhere; no literals elsewhere.
5. **DB layer** (`db.py`) — async engine, `async_sessionmaker`, `get_session` FastAPI dependency.
6. **Alembic baseline migration** — creates `raw` and `ai` schemas and all `raw.*` tables from §4. (Phase 1 needs no further migration; if any field is added during Phase 1 it is a second revision.)
7. **Next.js shell** — Tailwind configured, root layout, a page that calls `/api/health` and renders status. `lib/api.ts` typed fetch wrapper (reads `API_URL`, unwraps the envelope, throws typed errors).
8. **Sleeper client** (`sleeper/client.py` + `sleeper/models.py`) covering: resolve user, list user leagues, get league, get league rosters, get league users, get all players, get trending. 10s timeout, 3 retries with exponential backoff on 5xx/timeout, typed errors (`SleeperNotFound`, `SleeperRateLimited`, `SleeperUnavailable`). Every method returns a Pydantic model. Fully unit-tested against `tests/fixtures/sleeper/` via `httpx.MockTransport` — **no network in the test suite**.
9. **Frozen-interface modules** from §5 — each importable, type-checked, with a minimal test (ABC instantiation guard, `MockLLMProvider` returns schema-valid output, `Recommendation` round-trips the §14 example JSON, envelope helpers).
10. **CI** (`.github/workflows/ci.yml`) — job `api`: Postgres service, `uv sync`, `ruff check`, `mypy`, `alembic upgrade head`, `pytest`. job `web`: `npm ci`, `eslint`, `tsc --noEmit`, `next build`, `playwright test`.
11. **`.gitignore`** — `.env`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `node_modules`, `.next`, `coverage`, `*.pyc`.

### Milestone

`docker-compose up` serves the web shell at `:3000`, which shows a green health status fetched from `:8000/api/health` (which itself confirms a DB round-trip). CI is green. Every frozen-interface module imports and passes its test.

---

## 7. Phase 1 — Sleeper connection & roster

### 7.1 Season resolver (`season.py`)

```
resolved_season =
    SLEEPER_SEASON if set
    else str(current_year) if current_month >= 3
    else str(current_year - 1)
```

`/api/connect` fetches leagues for `resolved_season`; if the result is empty, it also fetches `resolved_season - 1` and returns both sets (each league already carries its own `season`). Table-tested across months.

### 7.2 Player cache (`sleeper/player_cache.py`)

`ensure_fresh(session)`:
1. Read `raw.player_sync` (source `"sleeper_players"`).
2. If missing or `last_full_refresh_at` older than `SLEEPER_PLAYER_CACHE_TTL_HOURS`, call `client.get_all_players()`, bulk-upsert `raw.player` in chunks of ~1000 via `INSERT … ON CONFLICT (sleeper_player_id) DO UPDATE`, then update `raw.player_sync` with `last_full_refresh_at = now()` and `player_count`.
3. Otherwise no-op.

Tested: stale → refresh; fresh → skip; upsert idempotent; partial payload tolerated.

### 7.3 League sync (`sleeper/league_sync.py`)

`SleeperLeagueSync` follows the `IngestionAdapter` shape (validating §5.1):

- **fetch:** league detail + rosters + league users for a `sleeper_league_id`.
- **normalize:** one league record + N roster records. Resolve `owner_display_name` / `team_name` from the users payload. Mark `is_current_user` where `roster.owner_id == app_user.sleeper_user_id`.
- **upsert:** upsert `raw.league` (unique on `app_user_id, sleeper_league_id`), upsert all `raw.roster` rows (unique on `league_id, sleeper_roster_id`), write a `raw.source` row (`name="sleeper"`, endpoint, `fetched_at`, `status`, `detail` = counts).
- Calls `player_cache.ensure_fresh` before returning.

Tested: fixtures → correct `raw.league` + `raw.roster` rows, `is_current_user` correct, bench derivation correct, `raw.source` row written.

### 7.4 Endpoints (all under `/api`, all return the §5.5 envelope)

**`POST /api/connect`** — body `{ "username": string }`
- Resolve Sleeper user (`client.get_user`). 404 → `{ error: { code: "sleeper_user_not_found" } }`.
- Upsert `raw.app_user`. Set signed HTTP-only cookie `waiver_session = app_user.id` (`SameSite=Lax`, `Secure` when not local).
- Fetch leagues for the resolved season (§7.1).
- `data`: `{ user: { sleeper_user_id, sleeper_username, display_name }, leagues: [ { sleeper_league_id, name, season, total_rosters, scoring_type, superflex } ] }`.
- Leagues are **not** persisted here — only on select.

**`GET /api/leagues`** — session required (401 otherwise)
- Re-fetch the live league list from Sleeper for the session user, annotate each with `selected: bool` (present in `raw.league`).
- `data`: `{ leagues: [ { …, selected } ] }`.

**`POST /api/leagues/{sleeper_league_id}/select`** — session required
- Run `SleeperLeagueSync` for that league + the session user.
- `data`: `{ league: { id, name, season, scoring_type, superflex, te_premium, waiver_type, faab_budget }, roster_summary: { roster_id, team_name, record: {w,l,t}, players: int, starters: int } }`.

**`GET /api/leagues/{sleeper_league_id}/roster`** — session required
- Requires the league to have been selected (else 409 `{ code: "league_not_selected" }`).
- Build the current user's structured roster:
  - `starters`: for each starting slot in `roster_positions` (excluding `BN`, `IR`, `TAXI`), pair the slot label with the positionally-aligned entry from the roster's `starters` array, enriched from `raw.player`; `null` player when the slot is empty (`"0"`).
  - `bench`: `players − starters − reserve − taxi`, enriched, sorted by position then name.
  - `ir`, `taxi`: enriched (omitted from response when empty).
  - player shape: `{ player_id, name, position, team, injury_status, injury_body_part, news_recent: bool }` (`news_recent` = `news_updated` within 72h).
- `data`: `{ league: {...}, team: { roster_id, team_name, owner_display_name, record, points_for, waiver_position, faab_remaining }, lineup: { starters, bench, ir, taxi } }`.
- `meta.synced_at` = roster `synced_at`; `meta.sources` = latest `raw.source` for this league.

**`GET /api/health`** — from Phase 0.

### 7.5 Frontend

- **`/` (connect)** — `ConnectForm` client component: username input → `POST /api/connect` → on success `router.push("/leagues")`; renders the error message on failure.
- **`/leagues`** — server component fetches `GET /api/leagues` server-side (forwarding the cookie). Renders a list; each `LeagueRow` (client) shows name / season / size / scoring type / SF badge and a "Select" button → `POST …/select` → `router.push("/roster?league=<id>")`. Already-selected leagues show "View".
- **`/roster`** — server component reads `?league=<sleeper_league_id>`, fetches `GET /api/leagues/{id}/roster` server-side. `RosterView` renders:
  - Header: team name, W-L(-T), points for, scoring type, waiver type / FAAB remaining, `synced_at`.
  - **Starters** — one row per slot: slot label + player card, or "Empty".
  - **Bench** — player cards.
  - **IR** / **Taxi** — only when non-empty.
  - Player card: name, `POS · TEAM`, injury badge (grey Q / orange Doubtful / red Out·IR), a news dot when `news_recent`.
  - Loading and error states.
- Tailwind, responsive: single column on mobile, roomier rows on desktop. Dark theme acceptable.

### 7.6 Security (subset active now — `REQUIREMENTS.md` §26)

- Secrets only via `config.py` / env. `.env` gitignored; `.env.example` committed.
- Session cookie: signed (`SESSION_SECRET`), HTTP-only, `SameSite=Lax`. Frontend never sees API keys (all Sleeper calls are server-side; no keys involved yet anyway).
- Every Sleeper response validated through Pydantic before persistence; unexpected shapes are logged and the offending record skipped, not fatal.
- Basic per-IP rate-limit middleware (`RATE_LIMIT_PER_MINUTE`, token bucket) on `/api/*`.
- No `eval`/`exec` of any external content (not applicable yet; noted).

### Milestone (Phase 1)

Connect a real Sleeper username → see the real league list → select a league → see the real roster, correctly split into starters (labeled by slot), bench, IR, and taxi, each player showing position, NFL team, and injury status. The Sleeper player database is fetched at most once per 24h. → Satisfies `REQUIREMENTS.md` §27 criteria **1** and **2**.

---

## 8. Testing strategy

TDD throughout (superpowers `test-driven-development`). Write the test, watch it fail, implement.

### api (`pytest`)

- `conftest.py` — create `waiver_test` DB if absent, run `alembic upgrade head` once per session, wrap each test in a transaction + `SAVEPOINT`, roll back after. An `async_client` fixture using `httpx.ASGITransport`.
- `test_sleeper_client.py` — fixtures for: user found, user not found (404), leagues, league detail, rosters, league users, players (small curated subset), trending. Assert Pydantic parsing and typed-error mapping. `httpx.MockTransport`.
- `test_player_cache.py` — stale → refresh; fresh → skip; idempotent upsert; partial payload tolerated.
- `test_league_sync.py` — fixtures → `raw.league` + `raw.roster` rows; `is_current_user`; bench derivation; `raw.source` written.
- `test_season.py` — month/override/fallback table.
- `test_api_flow.py` — `connect → leagues → select → roster` happy path; 401 unauthenticated; 404 unknown user; 409 roster-before-select.
- `test_frozen_interfaces.py` — `MockLLMProvider` output validates; `Recommendation` round-trips the §14 example; envelope helpers; `IngestionAdapter` cannot be instantiated directly.

### web

- CI: `eslint`, `tsc --noEmit`, `next build`.
- One Playwright test: intercept `/api/*`, drive connect form → league list → roster; assert slot labels, a bench player, an injury badge render.

### CI gate

Both jobs green required. Lint + types + tests + build.

---

## 9. Parallelization plan (Orca workspaces)

The frozen interfaces (§5) exist so that later phases fan out across independent Orca workspaces (separate worktrees / branches / PRs) without collisions.

| Phase | Concurrency | Notes |
|---|---|---|
| **0 — Foundation** | 1 workspace, sequential | Produces `main` with every frozen interface + the Sleeper client + CI. Nothing forks until this merges. |
| **1 — Sleeper + roster** | 1 workspace (optionally split `p1-backend` ‖ `p1-frontend` once §5.5 + §7.4 contracts are committed) | Small enough that one workspace is fine. |
| **2 — Ingestion + analyzers** | High. Batch A: 4 parallel workspaces (stats / schedule / depth-chart / injury adapters, each with fixtures). Batch B: projection model first, then team-scorer / need-model / candidate-filter / SOS-ranker in parallel against seeded fixtures. Batch C: dashboard enrichment UI. | Integration workspace rebases on `main` and reconciles after each batch. |
| **3 — LLM + engine** | Sequential spine (recommendation engine) + parallel edges (`AnthropicProvider`, eval-harness scaffold, explanation UI shell). | Rec JSON schema (§5.3) is already frozen, so the UI shell can start immediately. |

**Migration discipline:** one workspace owns the Alembic chain per phase. Parallel workspaces add SQLAlchemy models but the integration step writes/linearizes the migration to avoid `down_revision` collisions.

**Rule:** serialize on Phase 0, any DB migration, and the Phase 3 recommendation-engine core. Parallelize adapters, independent analysis services, API-vs-UI, and the eval harness.

Subagents (in-process `Agent` tool) remain available inside any workspace for scoped research/implementation; Orca workspaces are for modules that warrant their own review cycle.

---

## 10. Open questions / deferred decisions

1. **Test DB provisioning** — external `DATABASE_URL_TEST` (compose provides `waiver_test`) vs testcontainers. Leaning external for simplicity; revisit if CI Docker-in-Docker is painful.
2. **`uv` availability** on CI runner — assumed; fallback is pip-tools + `requirements.txt`.
3. **Multi-league UX** — schema supports many leagues per user; Phase 1 UI lists them but the roster page shows one at a time via `?league=`. Good enough until later phases.
4. **Sleeper `waiver_type` enum mapping** — store the raw `league_settings` blob and derive labels; confirm the exact integer→label mapping against a real FAAB league and a real rolling-waiver league during Phase 1.
5. **Empty/co-owned rosters** — `owner_id` can be null or a co-owner list; Phase 1 handles null owner (unowned team) and matches the session user against the primary `owner_id` only.

---

## 11. Success criteria (Phase 0 + Phase 1)

- [ ] `docker-compose up` → web at `:3000`, api at `:8000`; `/api/health` reports `db: ok`.
- [ ] CI green: ruff, mypy, alembic upgrade, pytest, eslint, tsc, next build, playwright.
- [ ] Every frozen-interface module (§5) imports and passes its test.
- [ ] Sleeper client fully covered by fixture-based tests; no network in the suite.
- [ ] Connect a real Sleeper username → real league list returned.
- [ ] Select a league → `raw.league` + all `raw.roster` rows persisted; `is_current_user` correct; `raw.source` row written.
- [ ] Roster page shows the real lineup split into starters (by slot) / bench / IR / taxi, each player with position, NFL team, injury status.
- [ ] Player DB fetched at most once per 24h (`raw.player_sync` guard).
- [ ] `REQUIREMENTS.md` §27 criteria 1 and 2 met.
