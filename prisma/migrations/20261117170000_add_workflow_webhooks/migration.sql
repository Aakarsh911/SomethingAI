-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN "webhookSecret" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_webhookSecret_key" ON "Workflow"("webhookSecret");

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN "input" JSONB;
