-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "dryRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "output" JSONB;
