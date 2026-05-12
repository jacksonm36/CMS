-- AlterTable
ALTER TABLE "sites" ADD COLUMN "nodeVersion" TEXT;
ALTER TABLE "sites" ADD COLUMN "pythonVersion" TEXT;
ALTER TABLE "sites" ADD COLUMN "dbStackVersion" TEXT;
ALTER TABLE "sites" ADD COLUMN "appProxyPort" INTEGER;
