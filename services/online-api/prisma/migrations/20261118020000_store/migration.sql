-- Store: entitlements, idempotent payment events, purchase blocks, collector names.
CREATE TABLE "entitlements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sku" VARCHAR(32) NOT NULL,
    "source" VARCHAR(8) NOT NULL,
    "status" VARCHAR(8) NOT NULL,
    "order_id" VARCHAR(64) NOT NULL,
    "purchased_at" TIMESTAMP(3) NOT NULL,
    "refunded_at" TIMESTAMP(3),
    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entitlements_source_check" CHECK ("source" IN ('web', 'steam', 'ios', 'android')),
    CONSTRAINT "entitlements_status_check" CHECK ("status" IN ('active', 'revoked'))
);
CREATE UNIQUE INDEX "entitlements_source_order_id_sku_key" ON "entitlements"("source", "order_id", "sku");
CREATE INDEX "entitlements_user_id_idx" ON "entitlements"("user_id");

CREATE TABLE "payment_events" (
    "id" VARCHAR(64) NOT NULL,
    "type" VARCHAR(48) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_blocks" (
    "user_id" UUID NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_blocks_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "collector_names" (
    "user_id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collector_names_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "collector_names_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);
