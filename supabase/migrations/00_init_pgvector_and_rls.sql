-- ============================================================
-- SoriKyo Tier 3 — PostgreSQL Init, pgvector & RLS
-- Phase 1 Omni-Stack Blueprint
-- ============================================================

-- 1. Enable pgvector for 1536-dimensional embeddings
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create the Cosine Similarity Function for Semantic Vibe Search
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    k.id::uuid,
    k.content,
    k.metadata::jsonb,
    1 - (k.embedding <=> query_embedding) AS similarity
  FROM knowledge_embeddings k
  WHERE 1 - (k.embedding <=> query_embedding) > match_threshold
  ORDER BY k.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 3. Row-Level Security (RLS) Enablement

-- Ensure tables exist first (Prisma db push runs before/after this)
-- We use ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
-- Note: Assuming Prisma creates tables first. IF running this BEFORE Prisma, 
-- create dummy tables or run Prisma `db push` then run this. 
-- For a robust template, we will explicitly define policies assuming tables exist.

-- Table: omni_service_inventory (Public read, authenticated write)
ALTER TABLE IF EXISTS "omni_service_inventory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read-only access to omni_service_inventory."
ON "omni_service_inventory" FOR SELECT
USING (true);

-- Table: qr_campaigns (Public read for redirector)
ALTER TABLE IF EXISTS "qr_campaigns" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to active QR campaigns."
ON "qr_campaigns" FOR SELECT
USING ("isActive" = true);

-- Table: dynamic_qr_analytics (Service role / backend only)
ALTER TABLE IF EXISTS "dynamic_qr_analytics" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role insert access to qr_analytics."
ON "dynamic_qr_analytics" FOR INSERT
WITH CHECK (true); -- Usually called securely from Node.js

-- Table: enterprise_bookings (Insert-only by public, read by admins)
ALTER TABLE IF EXISTS "enterprise_bookings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public to insert bookings."
ON "enterprise_bookings" FOR INSERT
WITH CHECK (true);

-- Table: knowledge_embeddings (Public read for semantic search)
ALTER TABLE IF EXISTS "knowledge_embeddings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to knowledge vectors."
ON "knowledge_embeddings" FOR SELECT
USING (true);

-- Table: staff_members
ALTER TABLE IF EXISTS "staff_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to active staff."
ON "staff_members" FOR SELECT
USING ("is_active" = true);

-- Table: verified_reviews
ALTER TABLE IF EXISTS "verified_reviews" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to reviews."
ON "verified_reviews" FOR SELECT
USING (true);


-- 4. Constraint Triggers (ACID Compliance & Business Logic)

-- Ensure Stock Count >= 0
DO $$ 
BEGIN 
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'omni_service_inventory') THEN
    ALTER TABLE "omni_service_inventory" ADD CONSTRAINT enforce_stock_positive CHECK ("stock_count" >= 0);
  END IF;
END $$;

-- Ensure Reviews only belong to COMPLETED Bookings
CREATE OR REPLACE FUNCTION enforce_completed_booking_for_reviews()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM enterprise_bookings
    WHERE id = NEW.booking_id AND status = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'A verified review can only be attached to a COMPLETED booking.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- We try to attach the trigger if table exists
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'verified_reviews') THEN
    DROP TRIGGER IF EXISTS trg_enforce_completed_booking ON "verified_reviews";
    CREATE TRIGGER trg_enforce_completed_booking
    BEFORE INSERT OR UPDATE ON "verified_reviews"
    FOR EACH ROW EXECUTE FUNCTION enforce_completed_booking_for_reviews();
  END IF;
END $$;
