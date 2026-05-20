import type { Prisma } from "@prisma/client";
import { prisma } from "@hostpanel/db";

/** Shared stack: nginx, PHP 8.2 (matches common Debian `php8.2-fpm.sock`), Docker MySQL 8 on a per-site bridge + Alpine sidecar. */
function phpMysqlStack(
  row: Pick<Prisma.SiteTemplateCreateInput, "name" | "slug" | "description" | "defaultDocument">,
): Prisma.SiteTemplateCreateInput {
  return {
    type: "php",
    webServer: "nginx",
    phpVersion: "8.2",
    dbStackVersion: "mysql-8.0",
    defaultDocument: row.defaultDocument ?? "index.php",
    autoDeployIsolation: true,
    stackNetworkPerSite: true,
    provisionDockerDb: true,
    name: row.name,
    slug: row.slug,
    description: row.description,
  };
}

/** Same as `phpMysqlStack` but MariaDB 11 in Docker. */
function phpMariadbStack(
  row: Pick<Prisma.SiteTemplateCreateInput, "name" | "slug" | "description" | "defaultDocument">,
): Prisma.SiteTemplateCreateInput {
  return {
    ...phpMysqlStack(row),
    dbStackVersion: "mariadb-11",
  };
}

const BUILTIN: Prisma.SiteTemplateCreateInput[] = [
  {
    name: "Static site",
    slug: "static-nginx",
    description: "Simple static HTML/CSS site behind nginx.",
    type: "static",
    webServer: "nginx",
    defaultDocument: "index.html",
    autoDeployIsolation: false,
    stackNetworkPerSite: false,
    provisionDockerDb: false,
  },
  {
    name: "Node.js app",
    slug: "nodejs-nginx",
    description: "Reverse proxy to a Node app on an auto-assigned loopback port.",
    type: "nodejs",
    webServer: "nginx",
    nodeVersion: "20",
    autoDeployIsolation: true,
    stackNetworkPerSite: true,
    provisionDockerDb: false,
  },
  {
    name: "Python app",
    slug: "python-nginx",
    description: "Reverse proxy to a Python (uvicorn/gunicorn) app on a loopback port.",
    type: "python",
    webServer: "nginx",
    pythonVersion: "3.12",
    autoDeployIsolation: true,
    stackNetworkPerSite: true,
    provisionDockerDb: false,
  },
  phpMysqlStack({
    name: "PHP + MySQL (WordPress-ready)",
    slug: "php-mysql-wp",
    description: "Nginx, PHP 8.3, Docker MySQL 8, per-site network, Alpine sidecar — auto-installs WordPress from template stream.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "PHP + MariaDB (WordPress-ready)",
    slug: "php-mariadb",
    description: "Same as PHP + MySQL but MariaDB 11 in Docker.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "WordPress (latest)",
    slug: "wordpress",
    description: "Latest WordPress tarball, MySQL in Docker, nginx docroot at site root.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "WordPress + MariaDB",
    slug: "wordpress-mariadb",
    description: "WordPress with MariaDB 11 instead of MySQL.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "Drupal 10 (Composer)",
    slug: "drupal",
    description: "drupal/recommended-project (Drupal 10), nginx docroot `web/`, MySQL in Docker.",
    defaultDocument: "web/index.php",
  }),
  phpMariadbStack({
    name: "Drupal 10 + MariaDB",
    slug: "drupal-mariadb",
    description: "Drupal 10 recommended project with MariaDB 11.",
    defaultDocument: "web/index.php",
  }),

  phpMysqlStack({
    name: "Joomla 5",
    slug: "joomla",
    description: "Joomla 5 stable full package, MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({ name: "Joomla 5 + MariaDB", slug: "joomla-mariadb", description: "Joomla 5 with MariaDB.", defaultDocument: "index.php" }),

  phpMysqlStack({
    name: "Laravel (latest)",
    slug: "laravel",
    description: "composer create-project laravel/laravel, docroot `public/`, MySQL in Docker.",
    defaultDocument: "public/index.php",
  }),
  phpMariadbStack({
    name: "Laravel + MariaDB",
    slug: "laravel-mariadb",
    description: "Laravel skeleton with MariaDB 11.",
    defaultDocument: "public/index.php",
  }),

  phpMysqlStack({
    name: "Symfony (skeleton)",
    slug: "symfony",
    description: "composer create-project symfony/skeleton, docroot `public/`, MySQL in Docker.",
    defaultDocument: "public/index.php",
  }),
  phpMariadbStack({
    name: "Symfony + MariaDB",
    slug: "symfony-mariadb",
    description: "Symfony skeleton with MariaDB 11.",
    defaultDocument: "public/index.php",
  }),

  phpMysqlStack({
    name: "Flarum (forum)",
    slug: "flarum",
    description: "composer create-project flarum/flarum, docroot `public/`, MySQL in Docker.",
    defaultDocument: "public/index.php",
  }),
  phpMariadbStack({
    name: "Flarum + MariaDB",
    slug: "flarum-mariadb",
    description: "Flarum with MariaDB 11.",
    defaultDocument: "public/index.php",
  }),

  phpMysqlStack({
    name: "MediaWiki",
    slug: "mediawiki",
    description: "MediaWiki 1.42 LTS tarball, MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "MediaWiki + MariaDB",
    slug: "mediawiki-mariadb",
    description: "MediaWiki with MariaDB 11.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "Moodle 4.5 LTS",
    slug: "moodle",
    description: "Moodle stable405 branch download, MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "Moodle + MariaDB",
    slug: "moodle-mariadb",
    description: "Moodle with MariaDB 11.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "phpBB 3.3",
    slug: "phpbb",
    description: "phpBB 3.3 community forum, MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({ name: "phpBB + MariaDB", slug: "phpbb-mariadb", description: "phpBB with MariaDB.", defaultDocument: "index.php" }),

  phpMysqlStack({
    name: "OpenCart 4",
    slug: "opencart",
    description: "OpenCart 4.0.2.3 (upload tree → docroot), MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "OpenCart + MariaDB",
    slug: "opencart-mariadb",
    description: "OpenCart with MariaDB 11.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "PrestaShop 8.2",
    slug: "prestashop",
    description: "PrestaShop 8.2 retail package (handles nested zip layout), MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "PrestaShop + MariaDB",
    slug: "prestashop-mariadb",
    description: "PrestaShop with MariaDB 11.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "Grav CMS + Admin",
    slug: "grav",
    description: "Grav flat-file CMS with admin (latest 1.7.x admin bundle), MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "Grav + MariaDB",
    slug: "grav-mariadb",
    description: "Grav with MariaDB 11.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "DokuWiki",
    slug: "dokuwiki",
    description: "DokuWiki stable tarball, MySQL in Docker.",
    defaultDocument: "index.php",
  }),
  phpMariadbStack({
    name: "DokuWiki + MariaDB",
    slug: "dokuwiki-mariadb",
    description: "DokuWiki with MariaDB 11.",
    defaultDocument: "index.php",
  }),

  phpMysqlStack({
    name: "Matomo Analytics",
    slug: "matomo",
    description: "Matomo web analytics (installed under `matomo/` docroot), MySQL in Docker.",
    defaultDocument: "matomo/index.php",
  }),
  phpMariadbStack({
    name: "Matomo + MariaDB",
    slug: "matomo-mariadb",
    description: "Matomo with MariaDB 11.",
    defaultDocument: "matomo/index.php",
  }),
];

export async function ensureBuiltinSiteTemplates(): Promise<number> {
  let created = 0;
  for (const row of BUILTIN) {
    const exists = await prisma.siteTemplate.findUnique({ where: { slug: row.slug } });
    if (exists) continue;
    await prisma.siteTemplate.create({ data: row });
    created++;
  }
  return created;
}
