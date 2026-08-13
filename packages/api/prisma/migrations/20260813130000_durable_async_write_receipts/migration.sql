-- Durable idempotency receipts for RabbitMQ event-day writes. Redis is only a
-- cache; this PostgreSQL record survives broker redelivery and cache expiry.
CREATE TABLE "AsyncWriteReceipt" (
  "id" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AsyncWriteReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AsyncWriteReceipt_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AsyncWriteReceipt_status_check"
    CHECK ("status" IN ('processing', 'completed', 'failed_permanent'))
);

CREATE UNIQUE INDEX "AsyncWriteReceipt_venueId_kind_idempotencyKey_key"
  ON "AsyncWriteReceipt"("venueId", "kind", "idempotencyKey");
CREATE INDEX "AsyncWriteReceipt_venueId_status_createdAt_idx"
  ON "AsyncWriteReceipt"("venueId", "status", "createdAt");

ALTER TABLE "BarInventoryMovement" ADD COLUMN "requestedQuantity" DOUBLE PRECISION;
ALTER TABLE "BarInventoryMovement" ADD COLUMN "appliedQuantity" DOUBLE PRECISION;
UPDATE "BarInventoryMovement"
  SET "requestedQuantity" = "quantity", "appliedQuantity" = "quantity"
  WHERE "requestedQuantity" IS NULL OR "appliedQuantity" IS NULL;

GRANT SELECT, INSERT, UPDATE ON "AsyncWriteReceipt" TO stadium_api;
ALTER TABLE "AsyncWriteReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AsyncWriteReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY async_write_receipt_scope ON "AsyncWriteReceipt" FOR ALL TO stadium_api
  USING (EXISTS (
    SELECT 1 FROM "Venue" v
    WHERE v."id" = "AsyncWriteReceipt"."venueId"
      AND (SELECT app_private.scope_matches(v."organizationId", v."id", NULL))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Venue" v
    WHERE v."id" = "AsyncWriteReceipt"."venueId"
      AND (SELECT app_private.scope_matches(v."organizationId", v."id", NULL))
  ));

-- Do not allow a retry to be repointed at a different tenant/request after it
-- was claimed. Completion state/result remain intentionally mutable.
CREATE OR REPLACE FUNCTION app_private.protect_async_write_receipt_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW."venueId" IS DISTINCT FROM OLD."venueId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" THEN
    RAISE EXCEPTION 'Async write receipt identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_async_write_receipt_identity
  BEFORE UPDATE ON "AsyncWriteReceipt"
  FOR EACH ROW EXECUTE FUNCTION app_private.protect_async_write_receipt_identity();
