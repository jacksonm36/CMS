-- CreateTable
CREATE TABLE "site_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "type" "SiteType" NOT NULL DEFAULT 'static',
    "webServer" "WebServer" NOT NULL DEFAULT 'nginx',
    "phpVersion" TEXT,
    "nodeVersion" TEXT,
    "pythonVersion" TEXT,
    "dbStackVersion" TEXT,
    "appProxyPort" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "site_templates_slug_key" ON "site_templates"("slug");

-- AlterTable
ALTER TABLE "sites" ADD COLUMN "templateId" TEXT;

CREATE INDEX "sites_templateId_idx" ON "sites"("templateId");

ALTER TABLE "sites" ADD CONSTRAINT "sites_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "site_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
