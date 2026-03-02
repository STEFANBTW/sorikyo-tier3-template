// ============================================================
// SoriKyo Tier 3 — AI Health Check
// Phase 2: Link — Verify OpenAI API endpoints
// Run: node tools/ai-health.js
// ============================================================

import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import 'dotenv/config';

const PASS = '✅';
const FAIL = '❌';
const INFO = 'ℹ️';

async function checkAIHealth() {
    console.log('\n══════════════════════════════════════════');
    console.log('  SoriKyo Tier 3 — AI Health Check');
    console.log('══════════════════════════════════════════\n');

    const results = [];

    // Load sample text from client-config.json
    let sampleText;
    try {
        const config = JSON.parse(readFileSync('./client-config.json', 'utf-8'));
        sampleText = config.business_logic.ai_knowledge_base_seed[0] || 'Hello, this is a health check probe.';
        results.push({ test: 'Config Parse', status: PASS, detail: `Loaded ${config.business_logic.company_details.name}` });
    } catch (err) {
        sampleText = 'Hello, this is a health check probe.';
        results.push({ test: 'Config Parse', status: FAIL, detail: err.message });
    }

    // Validate API key presence
    if (!process.env.OPENAI_API_KEY) {
        results.push({ test: 'API Key', status: FAIL, detail: 'OPENAI_API_KEY not set in .env' });
        printResults(results);
        process.exit(1);
    }
    results.push({ test: 'API Key', status: PASS, detail: `Key starts with ${process.env.OPENAI_API_KEY.substring(0, 7)}...` });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ─── Test 1: Text Embedding Endpoint ────────────────────
    try {
        const start = performance.now();
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: sampleText,
        });
        const latency = (performance.now() - start).toFixed(2);
        const dims = embeddingResponse.data[0].embedding.length;
        results.push({
            test: 'Embedding Endpoint (text-embedding-3-small)',
            status: dims === 1536 ? PASS : FAIL,
            detail: `${latency}ms, ${dims} dimensions, ${embeddingResponse.usage.total_tokens} tokens`,
        });
    } catch (err) {
        results.push({ test: 'Embedding Endpoint', status: FAIL, detail: err.message });
    }

    // ─── Test 2: Chat Completion Endpoint ───────────────────
    try {
        const start = performance.now();
        const chatResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'You are a health check probe. Respond with exactly: PONG' },
                { role: 'user', content: 'PING' },
            ],
            max_tokens: 10,
            temperature: 0,
        });
        const latency = (performance.now() - start).toFixed(2);
        const response = chatResponse.choices[0].message.content.trim();
        results.push({
            test: 'Chat Completion (gpt-4o-mini)',
            status: response.includes('PONG') ? PASS : FAIL,
            detail: `${latency}ms, response: "${response}"`,
        });
    } catch (err) {
        results.push({ test: 'Chat Completion', status: FAIL, detail: err.message });
    }

    printResults(results);
}

function printResults(results) {
    console.log('Results:');
    for (const r of results) {
        console.log(`  ${r.status} ${r.test} — ${r.detail}`);
    }

    const failures = results.filter(r => r.status === FAIL);
    console.log(`\n${INFO} Total: ${results.length} tests, ${results.length - failures.length} passed, ${failures.length} failed\n`);

    if (failures.length > 0) {
        console.error(`${FAIL} HALT: AI handshake failed. Fix issues before proceeding to Phase 3.\n`);
        process.exit(1);
    } else {
        console.log(`${PASS} AI handshake verified. Proceed to Phase 3.\n`);
    }
}

checkAIHealth().catch((err) => {
    console.error(`${FAIL} Fatal error:`, err);
    process.exit(1);
});
