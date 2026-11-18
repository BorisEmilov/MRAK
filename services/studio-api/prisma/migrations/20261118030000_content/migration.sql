-- Studio content store (docs/systems/studio.md).
CREATE TABLE "content_entries" (
    "collection" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(160) NOT NULL,
    "file" VARCHAR(200) NOT NULL,
    "position" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "published_body" JSONB,
    "status" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" VARCHAR(120) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "content_entries_pkey" PRIMARY KEY ("collection","entity_id"),
    CONSTRAINT "content_entries_status_check" CHECK ("status" IN ('draft', 'reviewed', 'published'))
);

CREATE TABLE "content_revisions" (
    "id" UUID NOT NULL,
    "collection" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(160) NOT NULL,
    "version" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "author" VARCHAR(120) NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "content_revisions_collection_entity_id_version_key" ON "content_revisions"("collection", "entity_id", "version");
