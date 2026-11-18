-- In-game bug reports (docs/systems/testing.md → Bug reports). 90-day retention (online-api).
CREATE TABLE "bug_reports" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" VARCHAR(64) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "seed" INTEGER,
    "save" TEXT,

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bug_reports_created_at_idx" ON "bug_reports"("created_at");
