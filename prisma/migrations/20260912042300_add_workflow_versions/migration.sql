-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "graphVersion" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_revision_key" ON "WorkflowVersion"("workflowId", "revision");

-- CreateIndex
CREATE INDEX "WorkflowVersion_workflowId_createdAt_idx" ON "WorkflowVersion"("workflowId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing workflows keep a working copy on Workflow.graph but had no history
-- row. Seed revision 1 from that blob so restore has something to read.
INSERT INTO "WorkflowVersion" ("id", "workflowId", "revision", "graph", "graphVersion", "note", "createdAt")
SELECT
    'wver_' || replace("id", '-', ''),
    "id",
    1,
    "graph",
    "graphVersion",
    'Imported',
    "createdAt"
FROM "Workflow";
