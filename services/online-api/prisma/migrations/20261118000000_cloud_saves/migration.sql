-- CreateTable
CREATE TABLE "cloud_saves" (
    "user_id" UUID NOT NULL,
    "slot" VARCHAR(8) NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "meta" JSONB NOT NULL,
    "data" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "cloud_saves_pkey" PRIMARY KEY ("user_id","slot","version")
);
