-- Login attempts for per-username lockout after repeated failures (SRS-AUTH-05).
-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "username_attempted" TEXT NOT NULL,
    "was_successful" BOOLEAN NOT NULL,
    "ip_address" TEXT,
    "attempted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_attempts_username_attempted_attempted_at_idx" ON "login_attempts"("username_attempted", "attempted_at");

-- CreateIndex
CREATE INDEX "login_attempts_attempted_at_idx" ON "login_attempts"("attempted_at");

