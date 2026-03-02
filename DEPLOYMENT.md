# SoriKyo Tier 3 — Deployment Checklist

## Pre-Flight Checks

### 1. Environment Variables (Coolify Dashboard)

Set these in `Environment Variables` section of your Coolify service:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Supabase pooling connection (Transaction mode) | `postgresql://postgres.xxx:pwd@aws-0-region.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | Supabase direct connection (for Prisma migrations) | `postgresql://postgres.xxx:pwd@aws-0-region.pooler.supabase.com:5432/postgres` |
| `OPENAI_API_KEY` | OpenAI API key for embeddings + chat | `sk-...` |
| `SERVER_PORT` | Internal container port | `3000` |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon/public key | `eyJ...` |
| `FRONTEND_ORIGIN` | Allowed CORS origin (your domain) | `https://noirink.com` |

### 2. Database Setup

```bash
# Run Prisma migrations against production
npx prisma db push

# Verify database health
node tools/db-health.js

# Verify AI connectivity
node tools/ai-health.js

# Verify cache infrastructure
node tools/cache-health.js
```

### 3. Supabase Configuration

- [ ] Enable **pgvector** extension in Supabase Dashboard → Database → Extensions
- [ ] Run `supabase/migrations/00_init_pgvector_and_rls.sql` in the SQL Editor
- [ ] Enable **Point-in-Time Recovery (PITR)** in Database → Backups
  - This guarantees disaster immunity with 7-day recovery window
  - Available on Pro plan and above
- [ ] Verify RLS policies are active on all tables

### 4. DNS Configuration

- [ ] Point your domain A/CNAME record to the Coolify VPS IP
- [ ] Configure SSL/TLS in Coolify (Let's Encrypt auto-cert)
- [ ] Update `FRONTEND_ORIGIN` env var to match production domain

---

## Deployment Protocol

### Immutable Deploy (Zero-Downtime)

1. **Never deploy directly to production.** Use Coolify's staging branch workflow:

```
main (production) ← PR from staging ← your changes
```

2. **Steps:**
   - Push code to `staging` branch in your Git repo
   - Coolify auto-builds the staging container
   - Verify staging at `staging.yourdomain.com`
   - Run health checks against staging
   - Merge `staging → main` via Pull Request
   - Coolify auto-deploys production with zero-downtime swap

3. **Rollback:** Coolify maintains the previous container image. Use the Coolify dashboard to instantly revert to the last working deployment.

---

## Post-Deploy Verification

```bash
# Verify the API is responding
curl https://yourdomain.com/api/config/brand

# Verify embedding pipeline
curl -X POST https://yourdomain.com/api/vibe-search \
  -H "Content-Type: application/json" \
  -d '{"query": "minimal geometric design"}'

# Verify QR redirect
curl -I https://yourdomain.com/qr/test-campaign
```

---

## Monitoring

- **Container health:** Coolify Dashboard → Service → Health tab
- **API logs:** Coolify Dashboard → Service → Logs tab
- **Database:** Supabase Dashboard → Database → Query Performance
- **Error tracking:** Check Fastify structured logs via `docker logs sorikyo-tier3-api`

---

## Backup & Recovery

| Layer | Strategy | Frequency |
|-------|----------|-----------|
| Database | Supabase PITR | Continuous (every 2 min) |
| Code | Git repository | On every merge |
| Embeddings | Re-seed from `client-config.json` | On demand |
| Container | Coolify image retention | Last 3 deploys |

---

> **Template Version:** 1.0.0 | **Architecture:** SoriKyo Tier 3 BLAST Protocol v3.1.0
