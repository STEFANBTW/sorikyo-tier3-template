// ============================================================
// SoriKyo Tier 3 — Database Health Check
// Phase 2: Link — Verify Prisma + pgvector compilation
// Run: node tools/db-health.js
// ============================================================

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();
const PASS = '✅';
const FAIL = '❌';
const INFO = 'ℹ️';

async function checkDatabaseHealth() {
  console.log('\n══════════════════════════════════════════');
  console.log('  SoriKyo Tier 3 — DB Health Check');
  console.log('══════════════════════════════════════════\n');

  const results = [];

  // ─── Test 1: Prisma Connection ──────────────────────────
  try {
    const start = performance.now();
    await prisma.$queryRaw`SELECT 1 AS ping`;
    const latency = (performance.now() - start).toFixed(2);
    results.push({ test: 'Prisma Connection', status: PASS, detail: `${latency}ms` });
  } catch (err) {
    results.push({ test: 'Prisma Connection', status: FAIL, detail: err.message });
  }

  // ─── Test 2: pgvector Extension ─────────────────────────
  try {
    const ext = await prisma.$queryRaw`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'vector'
    `;
    if (ext.length > 0) {
      results.push({ test: 'pgvector Extension', status: PASS, detail: `v${ext[0].extversion}` });
    } else {
      results.push({ test: 'pgvector Extension', status: FAIL, detail: 'Extension not installed' });
    }
  } catch (err) {
    results.push({ test: 'pgvector Extension', status: FAIL, detail: err.message });
  }

  // ─── Test 3: Vector Insert + Cosine Search ──────────────
  try {
    // Generate a dummy 1536-dim vector
    const dummyVector = Array.from({ length: 1536 }, (_, i) => Math.sin(i * 0.01));
    const vectorStr = `[${dummyVector.join(',')}]`;

    const start = performance.now();

    // Insert a test embedding
    await prisma.$executeRaw`
      INSERT INTO knowledge_embeddings (id, content, embedding, "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        'HEALTH_CHECK_PROBE',
        ${vectorStr}::vector(1536),
        NOW(),
        NOW()
      )
    `;

    // Execute cosine distance search
    const searchResults = await prisma.$queryRaw`
      SELECT id, content, 1 - (embedding <=> ${vectorStr}::vector(1536)) AS similarity
      FROM knowledge_embeddings
      WHERE content = 'HEALTH_CHECK_PROBE'
      ORDER BY embedding <=> ${vectorStr}::vector(1536)
      LIMIT 1
    `;

    const latency = (performance.now() - start).toFixed(2);

    // Clean up probe
    await prisma.$executeRaw`
      DELETE FROM knowledge_embeddings WHERE content = 'HEALTH_CHECK_PROBE'
    `;

    if (searchResults.length > 0 && Number(searchResults[0].similarity) > 0.99) {
      results.push({ test: 'Vector Insert + Cosine Search', status: PASS, detail: `${latency}ms (similarity: ${Number(searchResults[0].similarity).toFixed(4)})` });
    } else {
      results.push({ test: 'Vector Insert + Cosine Search', status: FAIL, detail: 'Cosine similarity mismatch' });
    }
  } catch (err) {
    results.push({ test: 'Vector Insert + Cosine Search', status: FAIL, detail: err.message });
  }

  // ─── Test 4: Table Existence ────────────────────────────
  const requiredTables = [
    'enterprise_bookings',
    'spatial_commerce_inventory',
    'knowledge_embeddings',
    'dynamic_qr_analytics',
    'qr_campaigns',
  ];

  for (const table of requiredTables) {
    try {
      const exists = await prisma.$queryRaw`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ${table}
        ) AS "exists"
      `;
      results.push({
        test: `Table: ${table}`,
        status: exists[0].exists ? PASS : FAIL,
        detail: exists[0].exists ? 'Found' : 'Missing',
      });
    } catch (err) {
      results.push({ test: `Table: ${table}`, status: FAIL, detail: err.message });
    }
  }

  // ─── Report ─────────────────────────────────────────────
  console.log('Results:');
  for (const r of results) {
    console.log(`  ${r.status} ${r.test} — ${r.detail}`);
  }

  const failures = results.filter(r => r.status === FAIL);
  console.log(`\n${INFO} Total: ${results.length} tests, ${results.length - failures.length} passed, ${failures.length} failed\n`);

  if (failures.length > 0) {
    console.error(`${FAIL} HALT: Database handshake failed. Fix issues before proceeding to Phase 3.\n`);
    process.exit(1);
  } else {
    console.log(`${PASS} Database handshake verified. Proceed to Phase 3.\n`);
  }

  await prisma.$disconnect();
}

checkDatabaseHealth().catch((err) => {
  console.error(`${FAIL} Fatal error:`, err);
  process.exit(1);
});
