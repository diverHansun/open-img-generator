# AI Image Generator

Open-source multi-provider AI image generator backend. MVP exposes a localhost-only REST API for submitting image generation jobs across multiple providers, with unified status tracking and local image storage.

> **MVP scope**: localhost-only, no auth, no rate limit. See [docs/mvp/api/constraints.md](./docs/mvp/api/constraints.md) for runtime semantics.

---

## Tech Stack

- **Runtime / framework**: Next.js 15 (API routes)
- **Language**: TypeScript 5.6
- **ORM / database**: Drizzle ORM + better-sqlite3 (SQLite)
- **Storage**: Local filesystem (`./data/images` by default)
- **Testing**: Vitest + MSW

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and add at least one provider key:
#   FAL_KEY=...
#   ZENMUX_API_KEY=...

# 3. Initialize SQLite schema
npm run db:push

# 4. Start dev server
npm run dev
```

Health check:

```bash
curl -s http://127.0.0.1:3000/api/health | jq
```

For full API walkthroughs see [docs/mvp/api/quickstart.md](./docs/mvp/api/quickstart.md).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health + enabled providers |
| GET | `/api/providers` | List enabled providers and capabilities |
| POST | `/api/generations` | Submit a generation job |
| GET | `/api/generations/:id` | Get generation status (lazy poll for async) |
| GET | `/api/images/:id` | Download a stored image |
| POST | `/api/sessions` | Create a session |
| GET | `/api/sessions/:id` | Get session + generations (nested poll) |

---

## Testing

```bash
# All tests
npm test

# By category
npm run test:unit
npm run test:contract
npm run test:integration
npm run test:smoke

# Type check
npm run typecheck

# Pre-commit style gate
npm run preflight
```

Test rules are documented in [docs/test-blueprint.md](./docs/test-blueprint.md).

---

## Project Structure

```
src/
  app/api/           # Next.js route handlers
  lib/
    db/              # Drizzle schema + queries
    prompt/          # Prompt preprocessing (MVP: pass-through)
    providers/       # Provider adapters + registry
    storage/         # Local download + read
    job-engine/      # Validation + lifecycle + orchestration
    errors.ts        # Shared error types
docs/
  mvp/               # MVP design docs
  test-blueprint.md  # Project testing rules
tests/
  contract/          # API route contract tests
  integration/       # End-to-end module integration tests
  smoke/             # Build / migration / health smoke tests
  helpers/           # Test factories and DB/storage helpers
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FAL_KEY` | — | fal.ai API key |
| `ZENMUX_API_KEY` | — | ZenMux API key |
| `DATABASE_URL` | `file:./data/app.db` | SQLite database file |
| `LOCAL_STORAGE_DIR` | `./data/images` | Local image storage root |
| `STORAGE_PROVIDER` | `local` | Storage backend (MVP: local only) |

See `.env.example` for all provider key placeholders.

---

## Provider Support

MVP implements two providers:

- **fal** (`fal-ai/flux/schnell`) — async queue protocol
- **zenmux** (`openai/gpt-image-2`) — sync OpenAI Images-compatible protocol

Other provider IDs are reserved in the registry but not yet implemented.

---

## Design Notes

- `POST /api/generations` is the only generation entry point.
- Async jobs rely on client polling via `GET /api/generations/:id`.
- Provider CDN URLs are downloaded and persisted locally before the generation is marked `completed`.
- Generation status is derived from its jobs' statuses.

For detailed design and data flow see `docs/mvp/`.
