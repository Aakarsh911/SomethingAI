-- AlterEnum
ALTER TYPE "WorkflowTrigger" ADD VALUE 'ONCE';

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "runAt" TIMESTAMP(3);
