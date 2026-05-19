import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * cPanel-style stack presets: HostPanel provisions vhost + runtime + optional DB stack metadata.
 * Operators still install app files (WordPress core, Joomla, etc.) via SFTP, WP-CLI, or their own pipeline.
 */
async function seedSiteTemplates(): Promise<void> {
  const templates: Prisma.SiteTemplateCreateManyInput[] = [
    {
      name: "Blank static site",
      slug: "static-blank",
      description:
        "Empty static site (index.html). Use the file manager or editor to add HTML/CSS/JS assets.",
      type: "static",
      webServer: "nginx",
      defaultDocument: "index.html",
    },
    {
      name: "PHP (generic)",
      slug: "php-generic",
      description:
        "PHP-FPM behind nginx with MySQL-compatible stack metadata. Add your own PHP code or framework source.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.3",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "WordPress",
      slug: "wordpress",
      description:
        "PHP 8.2 + MySQL stack preset for WordPress. After creating the site, upload WordPress core or run wp-cli from the site terminal; create a MySQL database from Databases.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "Joomla",
      slug: "joomla",
      description:
        "PHP + MySQL preset aligned with Joomla 4/5. Install Joomla files into the document root and complete the web installer.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "Drupal",
      slug: "drupal",
      description:
        "PHP + MySQL preset for Drupal. Place Composer-based or tarball Drupal under the site root; use Drush or the browser installer.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.3",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "Laravel",
      slug: "laravel",
      description:
        "PHP + MySQL with public/index.php entry. Point the web root to /public in the file manager or deploy a Laravel app and adjust nginx docroot if needed.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "public/index.php",
    },
    {
      name: "Symfony",
      slug: "symfony",
      description:
        "PHP + MySQL preset for Symfony (public/index.php). Deploy your project and configure .env for DATABASE_URL.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "public/index.php",
    },
    {
      name: "Moodle",
      slug: "moodle",
      description:
        "PHP + MariaDB-friendly preset for Moodle LMS. Upload Moodle and run the installer; create MariaDB/MySQL from Databases.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.1",
      dbStackVersion: "mariadb-10.11",
      defaultDocument: "index.php",
    },
    {
      name: "phpBB",
      slug: "phpbb",
      description:
        "PHP + MySQL preset for phpBB forums. Extract phpBB into the document root and use the install wizard.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "MediaWiki",
      slug: "mediawiki",
      description:
        "PHP + MySQL preset for MediaWiki. Download MediaWiki, run maintenance/install.php or the web installer.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "PrestaShop",
      slug: "prestashop",
      description:
        "PHP + MySQL preset for PrestaShop e-commerce. Upload release files and follow the browser installer.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.1",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "OpenCart",
      slug: "opencart",
      description:
        "PHP + MySQL preset for OpenCart. Upload catalog/ and admin/ from the distribution; run install via browser.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "Magento / Adobe Commerce (Open Source)",
      slug: "magento-opensource",
      description:
        "PHP + MySQL stack hint for Magento 2.x. Requires Composer-based deploy and Elasticsearch/OpenSearch in production — use this as a starting preset only.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.2",
      dbStackVersion: "mysql-8.0",
      defaultDocument: "index.php",
    },
    {
      name: "Ghost (Node.js)",
      slug: "ghost-node",
      description:
        "Node.js + PostgreSQL-oriented preset for Ghost CMS. Deploy Ghost (e.g. ghost-cli) behind the allocated reverse-proxy port.",
      type: "nodejs",
      webServer: "nginx",
      nodeVersion: "20",
      dbStackVersion: "postgresql-16",
    },
    {
      name: "Node.js API",
      slug: "nodejs-api",
      description:
        "Express/Fastify-style Node service on an auto-allocated port with nginx reverse proxy. Add your package.json and start command.",
      type: "nodejs",
      webServer: "nginx",
      nodeVersion: "20",
      dbStackVersion: "postgresql-16",
    },
    {
      name: "Django",
      slug: "django",
      description:
        "Python + PostgreSQL preset for Django. Use gunicorn/uvicorn on the app port; set DJANGO_SETTINGS_MODULE and database env vars.",
      type: "python",
      webServer: "nginx",
      pythonVersion: "3.12",
      dbStackVersion: "postgresql-16",
    },
    {
      name: "FastAPI",
      slug: "fastapi",
      description:
        "Python + PostgreSQL preset for FastAPI/Starlette. Bind uvicorn to the allocated app port behind nginx.",
      type: "python",
      webServer: "nginx",
      pythonVersion: "3.12",
      dbStackVersion: "postgresql-16",
    },
    {
      name: "Flask",
      slug: "flask",
      description:
        "Python + PostgreSQL preset for Flask or Quart. Run gunicorn on the app port; nginx terminates TLS and proxies.",
      type: "python",
      webServer: "nginx",
      pythonVersion: "3.12",
      dbStackVersion: "postgresql-16",
    },
    {
      name: "PHP + PostgreSQL (generic)",
      slug: "php-postgresql",
      description:
        "PHP with PostgreSQL stack metadata — useful for apps that prefer Postgres over MySQL.",
      type: "php",
      webServer: "nginx",
      phpVersion: "8.3",
      dbStackVersion: "postgresql-16",
      defaultDocument: "index.php",
    },
  ];

  const result = await prisma.siteTemplate.createMany({
    data: templates,
    skipDuplicates: true,
  });
  console.log(`Site templates: ${result.count} new preset(s) inserted (existing slugs skipped).`);

  const phpMysqlStacks = [
    "wordpress",
    "joomla",
    "drupal",
    "laravel",
    "symfony",
    "moodle",
    "phpbb",
    "mediawiki",
    "prestashop",
    "opencart",
    "magento-opensource",
    "php-generic",
  ];
  const stackPhp = await prisma.siteTemplate.updateMany({
    where: { slug: { in: phpMysqlStacks } },
    data: {
      autoDeployIsolation: true,
      stackNetworkPerSite: true,
      provisionDockerDb: true,
    },
  });
  const stackPg = await prisma.siteTemplate.updateMany({
    where: { slug: "php-postgresql" },
    data: {
      autoDeployIsolation: true,
      stackNetworkPerSite: true,
      provisionDockerDb: false,
    },
  });
  const stackRuntime = await prisma.siteTemplate.updateMany({
    where: { slug: { in: ["ghost-node", "nodejs-api", "django", "fastapi", "flask"] } },
    data: {
      autoDeployIsolation: true,
      stackNetworkPerSite: true,
      provisionDockerDb: false,
    },
  });
  console.log(
    `Site template deploy flags updated (php/mysql: ${stackPhp.count}, php/pg: ${stackPg.count}, node/python: ${stackRuntime.count}).`,
  );
}

async function main() {
  await seedSiteTemplates();

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@localhost";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "changeme";

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log("Admin user already exists, skipping admin + firewall seed.");
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.create({
    data: {
      email: adminEmail,
      name: "Administrator",
      passwordHash,
      role: "superadmin",
    },
  });

  // Default firewall rules
  await prisma.firewallRule.createMany({
    data: [
      { direction: "inbound", protocol: "tcp", port: "22", action: "allow", priority: 1, description: "SSH" },
      { direction: "inbound", protocol: "tcp", port: "80", action: "allow", priority: 2, description: "HTTP" },
      { direction: "inbound", protocol: "tcp", port: "443", action: "allow", priority: 3, description: "HTTPS" },
      { direction: "inbound", protocol: "tcp", port: "3000", action: "allow", priority: 4, description: "Dashboard" },
      { direction: "inbound", protocol: "tcp", port: "4000", action: "allow", priority: 5, description: "API" },
      { direction: "inbound", protocol: "all", sourceIp: "0.0.0.0/0", action: "deny", priority: 999, description: "Default deny" },
    ],
  });

  console.log(`Seeded admin user: ${adminEmail}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
