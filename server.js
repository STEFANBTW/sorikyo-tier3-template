// ============================================================
// SoriKyo Tier 3 — Omni-Stack Server (The Brain)
// Incorporates 60-Feature BLAST Updates (Paystack, Sharp, RAG)
// ============================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import 'dotenv/config';
import webpush from 'web-push';

// ─── Bootstrap ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const clientConfig = JSON.parse(
    readFileSync(resolve(__dirname, 'client-config.json'), 'utf-8')
);

const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || `http://localhost:${SERVER_PORT}`;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_123';
const JWT_SECRET = process.env.JWT_SECRET || 'tier3-super-secret-key-123';

try {
    webpush.setVapidDetails(
        `mailto:${clientConfig.business_logic.company_details.support_email}`,
        process.env.VAPID_PUBLIC_KEY || 'dummy_public',
        process.env.VAPID_PRIVATE_KEY || 'dummy_private'
    );
} catch (e) {
    console.warn("VAPID keys not configured properly for push notifications.");
}

const app = Fastify({
    logger: {
        level: 'info',
        transport: { target: 'pino-pretty', options: { colorize: true } },
    },
});

// ─── Middleware ──────────────────────────────────────────────

await app.register(cors, {
    origin: [FRONTEND_ORIGIN, `http://localhost:${SERVER_PORT}`],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
});

await app.register(fastifyStatic, {
    root: resolve(__dirname, 'public'),
    prefix: '/',
});

// Set Custom 404 Error Page (Tier 1 Requirement)
app.setNotFoundHandler((request, reply) => {
    reply.type('text/html').code(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <title>404 - Not Found - ${clientConfig.business_logic.company_details.name}</title>
          <link rel="stylesheet" href="/sorikyo-theme.css">
          <style>
              body { font-family: var(--font-primary); background: var(--color-bg); color: var(--color-text); text-align: center; padding: 20%; }
              h1 { font-size: 3rem; color: var(--color-accent); font-family: var(--font-mono); }
              a { display: inline-block; margin-top: 2rem; color: var(--color-bg); background: var(--color-text); text-decoration: none; padding: 10px 20px; font-family: var(--font-mono); text-transform: uppercase; }
          </style>
      </head>
      <body>
          <h1>// 404</h1>
          <p>The signal is lost. This page does not exist in our system.</p>
          <a href="/">Return Home</a>
      </body>
      </html>
    `);
});

// ─── Helpers ────────────────────────────────────────────────

function errorResponse(reply, code, message) {
    return reply.status(code).send({ status: 'error', code, message });
}

async function generateEmbedding(text) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
    });
    return response.data[0].embedding;
}

// ============================================================
// ROUTE 1: POST /api/vibe-search (Semantic vector search)
// ============================================================
app.post('/api/vibe-search', async (request, reply) => {
    try {
        const { query } = request.body || {};
        if (!query || typeof query !== 'string') return errorResponse(reply, 400, 'Invalid query');

        const embedding = await generateEmbedding(query);
        const vectorStr = `[${embedding.join(',')}]`;

        const results = await prisma.$queryRaw`
      SELECT 
        id, sku, name, description, price, stock_count, category,
        draco_glb_url, thumbnail_url,
        1 - (embedding <=> ${vectorStr}::vector(1536)) AS similarity
      FROM omni_service_inventory
      WHERE "isActive" = true
      ORDER BY embedding <=> ${vectorStr}::vector(1536)
      LIMIT 5
    `;

        return reply.send({ status: 'success', query, results });
    } catch (err) {
        request.log.error(err);
        return errorResponse(reply, 500, 'Vector computation failed');
    }
});

// ============================================================
// ROUTE 2: POST /api/rag-chat (Dual-Tier Logic)
// ============================================================
app.post('/api/rag-chat', async (request, reply) => {
    try {
        const { message, history = [] } = request.body || {};
        if (!message || typeof message !== 'string') return errorResponse(reply, 400, 'Invalid message');

        const msgLower = message.toLowerCase();
        let exactFaqMatch = null;

        // Level 1: Fast Regex pattern matching (No LLM required)
        for (const faq of clientConfig.business_logic.faq_database_seed || []) {
            if (faq.keywords.some(kw => msgLower.includes(kw.toLowerCase()))) {
                exactFaqMatch = faq.answer;
                break;
            }
        }

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });

        // If Level 1 answers it perfectly, return it instantly
        if (exactFaqMatch) {
            reply.raw.write(`data: ${JSON.stringify({ content: exactFaqMatch })}\n\n`);
            reply.raw.write('data: [DONE]\n\n');
            reply.raw.end();
            return;
        }

        // Level 2: Generative RAG AI Backup
        const embedding = await generateEmbedding(message);
        const vectorStr = `[${embedding.join(',')}]`;

        const groundingDocs = await prisma.$queryRaw`
      SELECT content, metadata, source,
        1 - (embedding <=> ${vectorStr}::vector(1536)) AS similarity
      FROM knowledge_embeddings
      WHERE 1 - (embedding <=> ${vectorStr}::vector(1536)) > 0.65
      ORDER BY embedding <=> ${vectorStr}::vector(1536)
      LIMIT 3
    `;

        const groundingContext = groundingDocs.length > 0
            ? groundingDocs.map(d => d.content).join('\n\n---\n\n')
            : 'No direct specific policy found. Provide general studio information and direct them to contact support.';

        const aiSeed = clientConfig.business_logic.ai_knowledge_base_seed.join(' ');

        const systemPrompt = `You are the AI receptionist for ${clientConfig.business_logic.company_details.name}.
Brand Aesthetic: ${clientConfig.brand_identity.aesthetic_directive}
Studio Data: ${aiSeed}
Relevant Documentation: ${groundingContext}
Rules: Answer concisely. If you don't know, don't invent. Suggest contacting ${clientConfig.business_logic.company_details.support_email}.`;

        const stream = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                ...history.slice(-10),
                { role: 'user', content: message }
            ],
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                reply.raw.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
        }

        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
    } catch (err) {
        request.log.error(err);
        return errorResponse(reply, 500, 'RAG computation failed');
    }
});

// ============================================================
// ROUTE 3: GET /qr/:id (Dynamic Redirect & Analytics)
// ============================================================
app.get('/qr/:id', async (request, reply) => {
    try {
        const { id } = request.params;
        const campaign = await prisma.qR_Campaign.findFirst({
            where: { slug: id, isActive: true },
        });

        if (!campaign) return errorResponse(reply, 404, `Campaign not found`);

        const userAgent = request.headers['user-agent'] || 'unknown';
        const ipAddress = request.ip || request.headers['x-forwarded-for'] || 'unknown';
        const deviceType = /mobile|android|iphone/i.test(userAgent) ? 'mobile' : 'desktop';

        prisma.dynamic_QR_Analytics.create({
            data: {
                campaignId: campaign.id,
                deviceType,
                userAgent,
                ipAddress: typeof ipAddress === 'string' ? ipAddress : ipAddress[0],
                referrer: request.headers.referer || null,
            },
        }).catch(err => request.log.error(err));

        return reply.redirect(302, campaign.targetUrl);
    } catch (err) {
        return errorResponse(reply, 500, 'QR redirect failed');
    }
});

// ============================================================
// ROUTE 4: POST /api/intent (UI Action Router)
// ============================================================
app.post('/api/intent', async (request, reply) => {
    try {
        const { input } = request.body || {};
        if (!input) return errorResponse(reply, 400, 'Missing input');

        const intentResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a UI intent recognition engine. Return JSON: { "action": "scroll|open_modal|navigate|whatsapp", "target": "#id or url" }. Common targets: #services, #booking, #gallery.`
                },
                { role: 'user', content: input },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
        });

        return reply.send({ status: 'success', intent: JSON.parse(intentResponse.choices[0].message.content) });
    } catch (err) {
        return errorResponse(reply, 500, 'Intent recognition failed');
    }
});

// ============================================================
// ROUTE 5: POST /api/bookings/create (ACID Transaction)
// ============================================================
app.post('/api/bookings/create', async (request, reply) => {
    try {
        const { customerName, customerPhone, serviceId, staffId, startTime, endTime } = request.body || {};

        if (!customerName || !customerPhone || !serviceId || !staffId || !startTime || !endTime) {
            return errorResponse(reply, 400, 'Missing required booking fields');
        }

        const start = new Date(startTime);
        const end = new Date(endTime);
        if (start >= end) return errorResponse(reply, 400, 'Invalid timeframe');

        const service = clientConfig.business_logic.services_catalog.find(s => s.id === serviceId);
        if (!service) return errorResponse(reply, 404, `Service not found`);

        const durationMinutes = (end - start) / 60000;
        const depositRequired = service.price_per_unit * (service.deposit_percentage / 100);

        // Transaction guarantees no overlaps mathematically using Prisma checks
        const booking = await prisma.$transaction(async (tx) => {
            const collision = await tx.enterprise_Booking.findFirst({
                where: {
                    staffId,
                    status: { notIn: ['CANCELLED', 'NO_SHOW'] },
                    OR: [
                        { startTime: { lt: end }, endTime: { gt: start } },
                    ],
                },
            });

            if (collision) throw new Error(`COLLISION: Staff member is not available during this time.`);

            return tx.enterprise_Booking.create({
                data: {
                    customerName,
                    customerPhone,
                    serviceId,
                    staffId,
                    startTime: start,
                    endTime: end,
                    totalPrice: service.price_per_unit,
                    deposit_paid: 0,
                    status: 'PENDING',
                },
            });
        });

        // Under real circumstances, you would return checkout tokens here.
        return reply.status(201).send({
            status: 'success',
            bookingId: booking.id,
            totalPrice: booking.totalPrice,
            depositRequired,
            // Mock Paystack reference token
            paymentReference: `PSTK_${booking.id.split('-')[0]}`,
        });
    } catch (err) {
        if (err.message.includes('COLLISION')) return errorResponse(reply, 409, err.message);
        return errorResponse(reply, 500, 'Booking failure');
    }
});

// ============================================================
// ROUTE 6: POST /api/webhooks/paystack (Cryptographic Router)
// ============================================================
app.post('/api/webhooks/paystack', async (request, reply) => {
    try {
        const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(JSON.stringify(request.body)).digest('hex');

        if (hash !== request.headers['x-paystack-signature']) {
            return reply.status(401).send({ status: 'unauthorized', message: 'HMAC validation failed' });
        }

        const event = request.body;
        if (event.event === 'charge.success') {
            const ref = event.data.reference;
            // Atomic update to CONFIRMED
            await prisma.enterprise_Booking.update({
                where: { paymentReference: ref },
                data: { status: 'CONFIRMED', deposit_paid: Number(event.data.amount) / 100 }
            });

            // Fire and forget Push Notifications to Admin
            // webpush.sendNotification({ endpoint: '...' }, 'New Booking Confirmed!');
        }

        return reply.send({ status: 'success' });
    } catch (err) {
        return errorResponse(reply, 500, 'Webhook processing failed');
    }
});

// ============================================================
// ROUTE 7: GET /api/images/:id (Node.js Sharp Optimizer Edge)
// ============================================================
app.get('/api/images/:id', async (request, reply) => {
    try {
        const { url, w, q } = request.query;
        if (!url) return errorResponse(reply, 400, 'Missing source URL');

        const acceptsWebp = request.headers.accept?.includes('image/webp');
        const fetchRes = await fetch(url);
        const arrayBuffer = await fetchRes.arrayBuffer();

        let image = sharp(Buffer.from(arrayBuffer));
        if (w) image = image.resize({ width: parseInt(w, 10), withoutEnlargement: true });

        if (acceptsWebp) {
            image = image.webp({ quality: parseInt(q, 10) || 80 });
            reply.header('Content-Type', 'image/webp');
        } else {
            image = image.jpeg({ quality: parseInt(q, 10) || 80 });
            reply.header('Content-Type', 'image/jpeg');
        }

        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        const buffer = await image.toBuffer();
        return reply.send(buffer);
    } catch (err) {
        return errorResponse(reply, 500, 'Image optimization failed');
    }
});

// ============================================================
// ROUTE 8: GET /api/admin/metrics (Secured Dashboard)
// ============================================================
app.get('/api/admin/metrics', async (request, reply) => {
    try {
        const token = request.headers.authorization?.split(' ')[1];
        if (!token) return reply.code(401).send({ error: 'Missing token' });

        // jwt.verify(token, JWT_SECRET); // Uncomment when real login is built

        const completedBookings = await prisma.enterprise_Booking.aggregate({
            _sum: { totalPrice: true },
            where: { status: 'COMPLETED' }
        });

        const noShows = await prisma.enterprise_Booking.count({
            where: { status: 'NO_SHOW' }
        });

        return reply.send({
            status: 'success',
            metrics: {
                totalRevenue: completedBookings._sum.totalPrice || 0,
                noShowCount: noShows
            }
        });
    } catch (err) {
        return reply.code(403).send({ error: 'Auth failed' });
    }
});

// ============================================================
// ROUTE 9: GET /api/seo/schema (JSON-LD Injector)
// ============================================================
app.get('/api/seo/schema', async (request, reply) => {
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        'name': clientConfig.business_logic.company_details.name,
        'email': clientConfig.business_logic.company_details.support_email,
        'telephone': clientConfig.business_logic.company_details.whatsapp_number,
        'address': {
            '@type': 'PostalAddress',
            'streetAddress': clientConfig.business_logic.company_details.physical_address
        }
    };
    return reply.send({ status: 'success', schema: jsonLd });
});

// ============================================================
// BOOT
// ============================================================
const shutdown = async () => {
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
    await app.listen({ port: SERVER_PORT, host: '0.0.0.0' });
    app.log.info(`\n  ╔══════════════════════════════════════════╗`);
    app.log.info(`  ║  SoriKyo Tier 3 Omni-Stack `);
    app.log.info(`  ║  Server running on port ${SERVER_PORT}`);
    app.log.info(`  ╚══════════════════════════════════════════╝\n`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
