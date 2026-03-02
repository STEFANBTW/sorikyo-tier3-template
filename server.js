// ============================================================
// SoriKyo Tier 3 — Server (The Brain)
// Phase 3: Architect — Fastify API Gateway
// All routes: Vibe Search, RAG Chat, QR Redirect, Intent,
//             Bookings, Inventory
// ============================================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

// ─── Bootstrap ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load client config for dynamic data
const clientConfig = JSON.parse(
    readFileSync(resolve(__dirname, 'client-config.json'), 'utf-8')
);

const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3000', 10);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || `http://localhost:${SERVER_PORT}`;

const app = Fastify({
    logger: {
        level: 'info',
        transport: {
            target: 'pino-pretty',
            options: { colorize: true },
        },
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

// ─── Standardized Error Response ────────────────────────────

function errorResponse(reply, code, message) {
    return reply.status(code).send({
        status: 'error',
        code,
        message,
    });
}

// ─── Helper: Generate Embedding ─────────────────────────────

async function generateEmbedding(text) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
    });
    return response.data[0].embedding;
}

// ============================================================
// ROUTE 1: POST /api/vibe-search
// Semantic Vibe Search — NL → Embedding → pgvector KNN → Top 5
// ============================================================

app.post('/api/vibe-search', async (request, reply) => {
    try {
        const { query } = request.body || {};

        if (!query || typeof query !== 'string') {
            return errorResponse(reply, 400, 'Missing or invalid "query" field');
        }

        // Convert natural language to 1536-dim vector
        const embedding = await generateEmbedding(query);
        const vectorStr = `[${embedding.join(',')}]`;

        // pgvector KNN search using cosine distance operator <=>
        const results = await prisma.$queryRaw`
      SELECT 
        id, name, description, price, stock, category,
        draco_glb_url, thumbnail_url,
        1 - (embedding <=> ${vectorStr}::vector(1536)) AS similarity
      FROM spatial_commerce_inventory
      WHERE is_active = true
      ORDER BY embedding <=> ${vectorStr}::vector(1536)
      LIMIT 5
    `;

        return reply.send({
            status: 'success',
            query,
            results,
        });
    } catch (err) {
        request.log.error(err);
        return errorResponse(reply, 500, 'Vector computation failed');
    }
});

// ============================================================
// ROUTE 2: POST /api/rag-chat
// Generative RAG AI Receptionist — Grounded LLM Streaming
// ============================================================

app.post('/api/rag-chat', async (request, reply) => {
    try {
        const { message, history = [] } = request.body || {};

        if (!message || typeof message !== 'string') {
            return errorResponse(reply, 400, 'Missing or invalid "message" field');
        }

        // Retrieve grounding context via cosine similarity
        const embedding = await generateEmbedding(message);
        const vectorStr = `[${embedding.join(',')}]`;

        const groundingDocs = await prisma.$queryRaw`
      SELECT content, metadata, source,
        1 - (embedding <=> ${vectorStr}::vector(1536)) AS similarity
      FROM knowledge_embeddings
      WHERE 1 - (embedding <=> ${vectorStr}::vector(1536)) > 0.7
      ORDER BY embedding <=> ${vectorStr}::vector(1536)
      LIMIT 5
    `;

        const groundingContext = groundingDocs.length > 0
            ? groundingDocs.map(d => d.content).join('\n\n---\n\n')
            : 'No specific knowledge found. Use general knowledge about the business.';

        // Build system prompt with grounded context
        const systemPrompt = `You are the AI receptionist for ${clientConfig.business_logic.company_details.name}.
Location: ${clientConfig.business_logic.company_details.physical_address}
WhatsApp: ${clientConfig.business_logic.company_details.whatsapp_number}
Email: ${clientConfig.business_logic.company_details.support_email}

${clientConfig.brand_identity.aesthetic_directive}

GROUNDING CONTEXT (use this to answer accurately):
${groundingContext}

RULES:
- Answer questions about services, pricing, policies, and booking.
- Be warm but authoritative, matching the brand voice.
- If you don't know something, say so and offer to connect them via WhatsApp.
- Never make up pricing or policies not in your grounding context.
- Keep responses concise (2-4 sentences max unless asked for detail).`;

        // Build messages array
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-10), // Keep last 10 messages for context window
            { role: 'user', content: message },
        ];

        // Stream the response
        const stream = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            max_tokens: 500,
            temperature: 0.7,
            stream: true,
        });

        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
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
// ROUTE 3: GET /qr/:id
// Dynamic QR Redirector — Log analytics → HTTP 302
// ============================================================

app.get('/qr/:id', async (request, reply) => {
    try {
        const { id } = request.params;

        // Fetch active campaign by slug
        const campaign = await prisma.qR_Campaign.findFirst({
            where: {
                slug: id,
                isActive: true,
            },
        });

        if (!campaign) {
            return errorResponse(reply, 404, `Campaign "${id}" not found or inactive`);
        }

        // Log analytics asynchronously (fire-and-forget)
        const userAgent = request.headers['user-agent'] || 'unknown';
        const ipAddress = request.ip || request.headers['x-forwarded-for'] || 'unknown';
        const deviceType = /mobile|android|iphone/i.test(userAgent) ? 'mobile' : 'desktop';

        // Non-blocking analytics write
        prisma.dynamic_QR_Analytics.create({
            data: {
                campaignId: campaign.id,
                deviceType,
                userAgent,
                ipAddress: typeof ipAddress === 'string' ? ipAddress : ipAddress[0],
                referrer: request.headers.referer || null,
            },
        }).catch(err => {
            request.log.error({ err }, 'Failed to log QR analytics');
        });

        // HTTP 302 redirect to campaign target URL
        return reply.redirect(302, campaign.targetUrl);
    } catch (err) {
        request.log.error(err);
        return errorResponse(reply, 500, 'QR redirect failed');
    }
});

// ============================================================
// ROUTE 4: POST /api/intent
// Intent Recognition Router — LLM → DOM scroll targets
// ============================================================

app.post('/api/intent', async (request, reply) => {
    try {
        const { input } = request.body || {};

        if (!input || typeof input !== 'string') {
            return errorResponse(reply, 400, 'Missing or invalid "input" field');
        }

        const intentResponse = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `You are a UI intent recognition engine for ${clientConfig.business_logic.company_details.name}.
Analyze the user's natural language input and return a JSON object with the action to perform.

Available actions:
- { "action": "scroll", "target": "#section-id" } — Scroll to a page section
- { "action": "open_modal", "target": "#modal-id" } — Open a specific modal
- { "action": "navigate", "target": "/page-path" } — Navigate to a page
- { "action": "whatsapp", "message": "pre-filled text" } — Open WhatsApp
- { "action": "call", "target": "phone-number" } — Trigger a phone call
- { "action": "unknown" } — Cannot determine intent

Common section IDs: #services, #booking, #gallery, #reviews, #about, #contact, #shop, #faq

Respond ONLY with valid JSON. No explanation.`,
                },
                { role: 'user', content: input },
            ],
            max_tokens: 100,
            temperature: 0,
            response_format: { type: 'json_object' },
        });

        const intent = JSON.parse(intentResponse.choices[0].message.content);

        return reply.send({
            status: 'success',
            input,
            intent,
        });
    } catch (err) {
        request.log.error(err);
        return errorResponse(reply, 500, 'Intent recognition failed');
    }
});

// ============================================================
// ROUTE 5: POST /api/bookings
// Enterprise Booking Engine — ACID transaction with collision check
// ============================================================

app.post('/api/bookings', async (request, reply) => {
    try {
        const { userId, serviceId, artistId, startTime, endTime, notes } = request.body || {};

        // Validate required fields
        if (!userId || !serviceId || !startTime || !endTime) {
            return errorResponse(reply, 400, 'Missing required fields: userId, serviceId, startTime, endTime');
        }

        const start = new Date(startTime);
        const end = new Date(endTime);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return errorResponse(reply, 400, 'Invalid date format for startTime or endTime');
        }

        if (start >= end) {
            return errorResponse(reply, 400, 'startTime must be before endTime');
        }

        // Find the service in the catalog to get pricing
        const service = clientConfig.business_logic.services_catalog.find(s => s.id === serviceId);
        if (!service) {
            return errorResponse(reply, 404, `Service "${serviceId}" not found in catalog`);
        }

        // Calculate duration and price
        const durationMs = end - start;
        const durationMinutes = durationMs / (1000 * 60);
        const durationHours = durationMinutes / 60;

        if (durationMinutes < service.minimum_duration_minutes) {
            return errorResponse(reply, 400, `Minimum duration for "${service.name}" is ${service.minimum_duration_minutes} minutes`);
        }

        const totalPrice = service.price_unit === 'hour'
            ? service.price_per_unit * durationHours
            : service.price_per_unit;

        // ACID Transaction: Check for collision + create booking atomically
        const booking = await prisma.$transaction(async (tx) => {
            // Check for time-slot collision on the same artist
            if (artistId) {
                const collision = await tx.enterprise_Booking.findFirst({
                    where: {
                        artistId,
                        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
                        OR: [
                            {
                                startTime: { lt: end },
                                endTime: { gt: start },
                            },
                        ],
                    },
                });

                if (collision) {
                    throw new Error(`COLLISION: Artist already booked from ${collision.startTime.toISOString()} to ${collision.endTime.toISOString()}`);
                }
            }

            // Create the booking
            return tx.enterprise_Booking.create({
                data: {
                    userId,
                    serviceId,
                    artistId: artistId || null,
                    startTime: start,
                    endTime: end,
                    totalPrice,
                    depositPaid: false,
                    notes: notes || null,
                    status: 'PENDING',
                },
            });
        });

        return reply.status(201).send({
            status: 'success',
            booking: {
                id: booking.id,
                service: service.name,
                startTime: booking.startTime,
                endTime: booking.endTime,
                totalPrice: booking.totalPrice,
                depositRequired: totalPrice * (service.deposit_percentage / 100),
                status: booking.status,
            },
        });
    } catch (err) {
        if (err.message.startsWith('COLLISION:')) {
            return errorResponse(reply, 409, err.message);
        }
        request.log.error(err);
        return errorResponse(reply, 500, 'Booking creation failed');
    }
});

// ============================================================
// ROUTE 6: GET /api/inventory
// Spatial Commerce Inventory — Public product listing
// ============================================================

app.get('/api/inventory', async (request, reply) => {
    try {
        const { category, page = 1, limit = 20 } = request.query;

        const where = { isActive: true };
        if (category) where.category = category;

        const [items, total] = await Promise.all([
            prisma.spatial_Commerce_Inventory.findMany({
                where,
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    sku: true,
                    name: true,
                    description: true,
                    price: true,
                    stock: true,
                    category: true,
                    dracoGlbUrl: true,
                    normalMapUrl: true,
                    pbrRoughnessMetadata: true,
                    thumbnailUrl: true,
                },
            }),
            prisma.spatial_Commerce_Inventory.count({ where }),
        ]);

        return reply.send({
            status: 'success',
            data: items,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (err) {
        request.log.error(err);
        return errorResponse(reply, 500, 'Inventory retrieval failed');
    }
});

// ============================================================
// ROUTE 7: GET /api/services
// Services catalog from client-config.json
// ============================================================

app.get('/api/services', async (request, reply) => {
    return reply.send({
        status: 'success',
        data: clientConfig.business_logic.services_catalog,
    });
});

// ============================================================
// ROUTE 8: GET /api/config/brand
// Public brand identity (safe to expose to frontend)
// ============================================================

app.get('/api/config/brand', async (request, reply) => {
    return reply.send({
        status: 'success',
        data: {
            name: clientConfig.business_logic.company_details.name,
            colors: clientConfig.brand_identity.colors,
            typography: clientConfig.brand_identity.typography,
            aesthetic: clientConfig.brand_identity.aesthetic_directive,
            features: clientConfig.active_features,
        },
    });
});

// ─── Graceful Shutdown ──────────────────────────────────────

const shutdown = async (signal) => {
    app.log.info(`${signal} received. Shutting down gracefully...`);
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ─── Start Server ───────────────────────────────────────────

try {
    await app.listen({ port: SERVER_PORT, host: '0.0.0.0' });
    app.log.info(`\n  ╔══════════════════════════════════════════╗`);
    app.log.info(`  ║  SoriKyo Tier 3 — ${clientConfig.business_logic.company_details.name}`);
    app.log.info(`  ║  Server running on port ${SERVER_PORT}`);
    app.log.info(`  ║  Frontend: ${FRONTEND_ORIGIN}`);
    app.log.info(`  ╚══════════════════════════════════════════╝\n`);
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
