-- CreateTable
CREATE TABLE "account_progress" (
    "user_id" VARCHAR(64) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_progress_pkey" PRIMARY KEY ("user_id","kind","key")
);
