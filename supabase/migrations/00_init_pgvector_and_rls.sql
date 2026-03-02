-- ============================================================
-- SoriKyo Tier 3 — Initial Migration
-- pgvector Extension + Row-Level Security Policies
-- ============================================================

-- Enable pgvector for 1536-dimensional embedding storage
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Row-Level Security ─────────────────────────────────────
-- Enforce data privacy at the database layer, independent of
-- the Node.js server. Defense-in-depth architecture.

-- 1. Spatial Commerce Inventory: PUBLIC READ, AUTH-ONLY WRITE
ALTER TABLE spatial_commerce_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_public_read"
  ON spatial_commerce_inventory
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "inventory_auth_insert"
  ON spatial_commerce_inventory
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "inventory_auth_update"
  ON spatial_commerce_inventory
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "inventory_auth_delete"
  ON spatial_commerce_inventory
  FOR DELETE
  TO authenticated
  USING (true);

-- 2. Enterprise Bookings: AUTH-ONLY READ/WRITE (own records)
ALTER TABLE enterprise_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings_user_read_own"
  ON enterprise_bookings
  FOR SELECT
  TO authenticated
  USING (
    "userId" = auth.uid()::text
  );

CREATE POLICY "bookings_user_insert"
  ON enterprise_bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "userId" = auth.uid()::text
  );

CREATE POLICY "bookings_user_update_own"
  ON enterprise_bookings
  FOR UPDATE
  TO authenticated
  USING (
    "userId" = auth.uid()::text
  )
  WITH CHECK (
    "userId" = auth.uid()::text
  );

-- 3. Knowledge Embeddings: PUBLIC READ (for vibe search), AUTH-ONLY WRITE
ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "embeddings_public_read"
  ON knowledge_embeddings
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "embeddings_auth_write"
  ON knowledge_embeddings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "embeddings_auth_update"
  ON knowledge_embeddings
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. QR Campaigns: PUBLIC READ (for redirect), AUTH-ONLY WRITE
ALTER TABLE qr_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaigns_public_read"
  ON qr_campaigns
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "campaigns_auth_write"
  ON qr_campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "campaigns_auth_update"
  ON qr_campaigns
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. QR Analytics: AUTH-ONLY (server writes via service role)
ALTER TABLE dynamic_qr_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_service_insert"
  ON dynamic_qr_analytics
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "analytics_auth_read"
  ON dynamic_qr_analytics
  FOR SELECT
  TO authenticated
  USING (true);

-- ─── pgvector Cosine Similarity Function ────────────────────
-- Used by Semantic Vibe Search and RAG AI Receptionist
-- to find the K nearest knowledge embeddings.

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.78,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  source text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ke.id::uuid,
    ke.content,
    ke.metadata::jsonb,
    ke.source,
    1 - (ke.embedding <=> query_embedding) AS similarity
  FROM knowledge_embeddings ke
  WHERE 1 - (ke.embedding <=> query_embedding) > match_threshold
  ORDER BY ke.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─── Vector Index ───────────────────────────────────────────
-- IVFFlat index for sub-50ms retrieval on embedding columns.

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_vector
  ON knowledge_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
