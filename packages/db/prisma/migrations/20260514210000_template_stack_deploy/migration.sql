-- Template-driven stack deployment (Docker sidecar + optional per-site DB container)
ALTER TABLE "site_templates" ADD COLUMN "autoDeployIsolation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "site_templates" ADD COLUMN "stackNetworkPerSite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "site_templates" ADD COLUMN "provisionDockerDb" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sites" ADD COLUMN "stackDbContainerId" TEXT;
ALTER TABLE "sites" ADD COLUMN "stackDbHostPort" INTEGER;
