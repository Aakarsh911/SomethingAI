-- AlterTable
ALTER TABLE "McpServer" ADD COLUMN     "categories" TEXT[],
ADD COLUMN     "composioAuthScheme" TEXT,
ADD COLUMN     "composioManagedAuth" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "popularity" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "McpServer_isEnabled_popularity_idx" ON "McpServer"("isEnabled", "popularity" DESC);

-- CreateIndex
CREATE INDEX "McpServer_categories_idx" ON "McpServer" USING GIN ("categories");
