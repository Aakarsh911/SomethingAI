
-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "cron" TEXT,
ADD COLUMN     "lastRunAt" TIMESTAMP(3),
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT;

-- CreateIndex
CREATE INDEX "Workflow_isEnabled_nextRunAt_idx" ON "Workflow"("isEnabled", "nextRunAt");

