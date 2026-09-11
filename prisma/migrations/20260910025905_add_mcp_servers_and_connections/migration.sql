-- CreateEnum
CREATE TYPE "McpTransport" AS ENUM ('HTTP', 'SSE', 'STDIO');

-- CreateEnum
CREATE TYPE "McpAuthType" AS ENUM ('NONE', 'API_KEY', 'COMPOSIO');

-- CreateEnum
CREATE TYPE "McpConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'REVOKED');

-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "docsUrl" TEXT,
    "url" TEXT,
    "transport" "McpTransport" NOT NULL DEFAULT 'HTTP',
    "authType" "McpAuthType" NOT NULL DEFAULT 'COMPOSIO',
    "composioToolkit" TEXT,
    "composioAuthConfigId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMcpConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "status" "McpConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "credential" TEXT,
    "externalAccountId" TEXT,
    "accountLabel" TEXT,
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMcpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpConnectAttempt" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "returnTo" TEXT,
    "externalRequestId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpConnectAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_slug_key" ON "McpServer"("slug");

-- CreateIndex
CREATE INDEX "McpServer_ownerId_idx" ON "McpServer"("ownerId");

-- CreateIndex
CREATE INDEX "UserMcpConnection_userId_idx" ON "UserMcpConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMcpConnection_userId_serverId_key" ON "UserMcpConnection"("userId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "McpConnectAttempt_state_key" ON "McpConnectAttempt"("state");

-- CreateIndex
CREATE INDEX "McpConnectAttempt_expiresAt_idx" ON "McpConnectAttempt"("expiresAt");

-- AddForeignKey
ALTER TABLE "McpServer" ADD CONSTRAINT "McpServer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMcpConnection" ADD CONSTRAINT "UserMcpConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMcpConnection" ADD CONSTRAINT "UserMcpConnection_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "McpServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpConnectAttempt" ADD CONSTRAINT "McpConnectAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
