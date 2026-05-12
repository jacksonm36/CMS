-- AlterEnum: additional WebServer values for site assignment
ALTER TYPE "WebServer" ADD VALUE 'caddy';
ALTER TYPE "WebServer" ADD VALUE 'openresty';
ALTER TYPE "WebServer" ADD VALUE 'traefik';
