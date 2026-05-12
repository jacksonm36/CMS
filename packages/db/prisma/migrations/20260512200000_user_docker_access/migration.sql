-- Panel users may be granted access to Docker management (non-staff).
ALTER TABLE "users" ADD COLUMN "dockerAccess" BOOLEAN NOT NULL DEFAULT false;
