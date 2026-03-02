# SoriKyo Tier 3 — Enterprise Template

> **Headless Backend Monolith with Vanilla Data-Attribute SDK**
> Built on the BLAST Protocol v3.1.0

---

## What Is This?

This is a reusable, production-ready template for SoriKyo Tier 3 clients. It implements 30+ enterprise features through a decoupled architecture:

- **Backend:** Node.js (Fastify) + Prisma ORM + Supabase (PostgreSQL + pgvector)
- **Frontend:** 100% Vanilla HTML5, CSS3, ES6+ JavaScript
- **Bridge:** A Data-Attribute SDK (`sorikyo-tier3.js`) that passively binds backend functionality to HTML elements via `data-sorikyo-*` attributes.

**No React. No Next.js. No Vue. No Angular.** The UI is an agnostic canvas owned by the human developer.

---

## Quick Start

### 1. Clone & Configure

```bash
cp .env.example .env
# Fill in your Supabase, OpenAI, and server values
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Setup Database

```bash
# Generate Prisma client
pnpm db:generate

# Push schema to Supabase
pnpm db:push

# Run pgvector + RLS migration
# (Copy contents of supabase/migrations/00_init_pgvector_and_rls.sql
#  into Supabase Dashboard → SQL Editor → Run)
```

### 4. Verify Infrastructure

```bash
pnpm health:db      # Prisma + pgvector handshake
pnpm health:ai      # OpenAI embedding + chat endpoints
pnpm health:cache   # Service Worker + IndexedDB manifests
pnpm health:all     # Run all three
```

### 5. Start Development Server

```bash
pnpm dev
# Server runs on http://localhost:3000
```

---

## Architecture

```
┌─────────────────────────────────────┐
│           HUMAN-AUTHORED            │
│        Vanilla HTML + CSS           │
│    (data-sorikyo-* attributes)      │
├─────────────────────────────────────┤
│        sorikyo-tier3.js             │
│      Data-Attribute SDK             │
│   (passively binds to DOM)          │
├─────────────────────────────────────┤
│          server.js                  │
│      Fastify API Gateway            │
│  (Vibe Search, RAG Chat, QR, etc)  │
├─────────────────────────────────────┤
│     Prisma ORM + Supabase           │
│   PostgreSQL + pgvector (1536)      │
│         + Row-Level Security        │
└─────────────────────────────────────┘
```

---

## Data-Attribute SDK Reference

Place these attributes on your HTML elements and the SDK auto-binds complex functionality:

| Attribute | Purpose |
|-----------|---------|
| `data-sorikyo-action="rag-chat"` | AI Receptionist chat interface |
| `data-sorikyo-action="vibe-search"` | Semantic vector search input |
| `data-sorikyo-action="whatsapp-deep"` | Context-aware WhatsApp deep-link |
| `data-sorikyo-haptic="light\|heavy\|success\|error"` | Haptic vibration feedback |
| `data-sorikyo-3d-model="[url]"` | WebGL/Three.js 3D model viewer |
| `data-sorikyo-offline-morph="true"` | UI state swap when offline |
| `data-sorikyo-glass-edit="[target-id]"` | Glassmorphism inline content editor |
| `data-sorikyo-track="[item-id]"` | LRU recency tracking (last 5 items) |
| `data-sorikyo-intent-nav="true"` | AI-powered intent navigation |

---

## API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/vibe-search` | Semantic vector search |
| `POST` | `/api/rag-chat` | RAG AI receptionist (SSE streaming) |
| `GET` | `/qr/:id` | QR redirect with analytics logging |
| `POST` | `/api/intent` | Intent recognition → DOM targets |
| `POST` | `/api/bookings` | ACID booking with collision detection |
| `GET` | `/api/inventory` | Spatial commerce product listing |
| `GET` | `/api/services` | Services catalog from config |
| `GET` | `/api/config/brand` | Public brand identity |

---

## Customizing for a New Client

1. **Edit `client-config.json`** — Update brand colors, company details, services, and AI knowledge base.
2. **Author HTML** — Build your pages using vanilla HTML with `data-sorikyo-*` attributes.
3. **Deploy** — Follow `DEPLOYMENT.md` for Coolify/VPS setup.

The backend fortress remains immutable. The config and HTML are the only things that change per client.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ (ES Modules) |
| Server | Fastify 5 |
| ORM | Prisma 6 |
| Database | Supabase PostgreSQL + pgvector |
| AI | OpenAI (text-embedding-3-small + gpt-4o-mini) |
| 3D | Three.js r170 (lazy-loaded CDN) |
| Frontend | Vanilla HTML5 / CSS3 / ES6+ |
| Deployment | Docker → Coolify on VPS |

---

> **SoriKyo Tier 3** — Engineered with clinical precision.
