-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('superadmin', 'admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "WebServer" AS ENUM ('nginx', 'apache2', 'lighttpd', 'litespeed');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('active', 'suspended', 'pending', 'error');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('php', 'static', 'nodejs', 'python');

-- CreateEnum
CREATE TYPE "DbEngine" AS ENUM ('postgresql', 'mysql');

-- CreateEnum
CREATE TYPE "CertStatus" AS ENUM ('valid', 'expiring', 'expired', 'pending', 'error');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'viewer',
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "oauthProvider" TEXT,
    "oauthId" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "SiteStatus" NOT NULL DEFAULT 'pending',
    "type" "SiteType" NOT NULL DEFAULT 'static',
    "webServer" "WebServer" NOT NULL DEFAULT 'nginx',
    "phpVersion" TEXT,
    "dockerContainerId" TEXT,
    "rootPath" TEXT NOT NULL,
    "webConfigPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_databases" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine" "DbEngine" NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'localhost',
    "port" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_databases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_jobs" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastExitCode" INTEGER,
    "lastOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ssl_certs" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" "CertStatus" NOT NULL DEFAULT 'pending',
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'letsencrypt',
    "certPath" TEXT,
    "keyPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ssl_certs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firewall_rules" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "protocol" TEXT NOT NULL DEFAULT 'tcp',
    "port" TEXT,
    "sourceIp" TEXT,
    "action" TEXT NOT NULL DEFAULT 'allow',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firewall_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_ips" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "permanent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "blocked_ips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCalledAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "schema" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_entries" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "storagePath" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uptime_checks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 60,
    "timeout" INTEGER NOT NULL DEFAULT 10,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastCheckedAt" TIMESTAMP(3),
    "lastResponseMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uptime_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uptime_results" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseMs" INTEGER,
    "statusCode" INTEGER,
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uptime_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "operator" TEXT NOT NULL,
    "windowMinutes" INTEGER NOT NULL DEFAULT 5,
    "notifyVia" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sites_domain_key" ON "sites"("domain");

-- CreateIndex
CREATE INDEX "sites_ownerId_idx" ON "sites"("ownerId");

-- CreateIndex
CREATE INDEX "sites_domain_idx" ON "sites"("domain");

-- CreateIndex
CREATE INDEX "site_databases_siteId_idx" ON "site_databases"("siteId");

-- CreateIndex
CREATE INDEX "cron_jobs_siteId_idx" ON "cron_jobs"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ssl_certs_siteId_key" ON "ssl_certs"("siteId");

-- CreateIndex
CREATE INDEX "ssl_certs_domain_idx" ON "ssl_certs"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_ips_ip_key" ON "blocked_ips"("ip");

-- CreateIndex
CREATE INDEX "blocked_ips_ip_idx" ON "blocked_ips"("ip");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "webhooks_siteId_idx" ON "webhooks"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_provider_key" ON "integrations"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "content_types_slug_key" ON "content_types"("slug");

-- CreateIndex
CREATE INDEX "content_entries_typeId_idx" ON "content_entries"("typeId");

-- CreateIndex
CREATE INDEX "content_entries_authorId_idx" ON "content_entries"("authorId");

-- CreateIndex
CREATE INDEX "media_files_uploadedBy_idx" ON "media_files"("uploadedBy");

-- CreateIndex
CREATE INDEX "uptime_results_checkId_checkedAt_idx" ON "uptime_results"("checkId", "checkedAt");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_databases" ADD CONSTRAINT "site_databases_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ssl_certs" ADD CONSTRAINT "ssl_certs_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "content_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_entries" ADD CONSTRAINT "content_entries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uptime_results" ADD CONSTRAINT "uptime_results_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "uptime_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
