-- Add modular networking fields to sites and site_templates

ALTER TABLE "sites"
  ADD COLUMN "networkGroup"     TEXT,
  ADD COLUMN "isCentralService" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "site_templates"
  ADD COLUMN "networkGroup"     TEXT,
  ADD COLUMN "isCentralService" BOOLEAN NOT NULL DEFAULT false;
