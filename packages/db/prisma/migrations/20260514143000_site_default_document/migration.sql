-- Optional homepage filename for static / PHP sites (nginx index / root try_files).
ALTER TABLE "sites" ADD COLUMN "defaultDocument" TEXT;

ALTER TABLE "site_templates" ADD COLUMN "defaultDocument" TEXT;
