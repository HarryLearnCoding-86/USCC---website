-- Records which side disputed a result and when, for the TD dispute queue (SRS-TD-02).
-- CreateEnum
CREATE TYPE "PlayerSide" AS ENUM ('WHITE', 'BLACK');

-- AlterTable
ALTER TABLE "results" ADD COLUMN     "disputed_at" TIMESTAMPTZ,
ADD COLUMN     "disputed_by_side" "PlayerSide";

