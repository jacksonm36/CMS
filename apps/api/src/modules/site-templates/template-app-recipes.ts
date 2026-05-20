/** CMS / framework auto-install recipes (run in site Alpine sidecar at /srv). */

export type AppInstallStep = { id: string; title: string; cmd: string };

export type AppInstallRecipe = {
  steps: AppInstallStep[];
  /** Override site.defaultDocument after install (relative to site root; may include a doc subdir, e.g. `web/index.php`). */
  defaultDocument?: string;
  extraAlpinePackages?: string[];
};

const SRV = "cd /srv";

/** Composer + common PHP extensions for PHP 8.3 on Alpine (matches template `phpVersion: "8.3"`). */
const COMPOSER_PHP83 = [
  "composer",
  "php83",
  "php83-dom",
  "php83-xml",
  "php83-tokenizer",
  "php83-mbstring",
  "php83-openssl",
  "php83-phar",
  "php83-zip",
  "php83-intl",
  "php83-fileinfo",
  "php83-bcmath",
  "php83-session",
  "php83-pdo_mysql",
  "php83-mysqli",
  "bash",
] as const;

function recipe(steps: AppInstallStep[], defaultDocument?: string, extraAlpinePackages?: string[]): AppInstallRecipe {
  return { steps, defaultDocument, extraAlpinePackages };
}

const RECIPES: Record<string, AppInstallRecipe> = {
  wordpress: recipe(
    [
      {
        id: "wp-download",
        title: "Download WordPress latest",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/wp.tgz https://wordpress.org/latest.tar.gz && tar -xzf /tmp/wp.tgz -C /srv --strip-components=1 && rm -f /tmp/wp.tgz`,
      },
    ],
    "index.php",
  ),

  drupal: recipe(
    [
      {
        id: "drupal-composer",
        title: "Composer: Drupal recommended project",
        cmd: `${SRV} && rm -f index.html 2>/dev/null; mkdir -p /srv/.composer-cache /srv/.build && export TMPDIR=/srv/.build COMPOSER_HOME=/srv/.composer-cache COMPOSER_CACHE_DIR=/srv/.composer-cache/cache COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_MEMORY_LIMIT=-1 && composer create-project drupal/recommended-project:^10 /srv/.build/drupal --no-interaction --no-dev --ignore-platform-reqs && cp -a /srv/.build/drupal/. /srv/ && rm -rf /srv/.build /srv/.composer-cache`,
      },
      {
        id: "drupal-files",
        title: "Prepare Drupal files dir and settings.php",
        cmd: `${SRV} && mkdir -p web/sites/default/files/translations web/sites/default/files/tmp private`,
      },
    ],
    "web/index.php",
    [
      "composer",
      "php83",
      "php83-cli",
      "php83-phar",
      "php83-curl",
      "php83-dom",
      "php83-xml",
      "php83-gd",
      "php83-zip",
      "php83-intl",
      "php83-opcache",
      "php83-tokenizer",
      "php83-session",
      "php83-pdo_mysql",
      "php83-simplexml",
      "php83-mbstring",
      "php83-openssl",
      "php83-fileinfo",
      "bash",
    ],
  ),

  joomla: recipe(
    [
      {
        id: "joomla-download",
        title: "Download Joomla 5",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/joomla.zip https://downloads.joomla.org/cms/joomla5/5-2-3/Joomla_5-2-3-Stable-Full_Package.zip && unzip -q /tmp/joomla.zip -d /tmp/joomla && ONE=$(find /tmp/joomla -mindepth 1 -maxdepth 1 -type d | head -1) && if test -f /tmp/joomla/index.php; then cp -a /tmp/joomla/. /srv/; elif test -n "$ONE" && test -f "$ONE/index.php"; then cp -a "$ONE"/. /srv/; else exit 1; fi && rm -rf /tmp/joomla /tmp/joomla.zip`,
      },
    ],
    "index.php",
    ["unzip", "findutils", "php83-gd", "php83-intl", "php83-zip", "php83-xml", "php83-mysqli", "php83-pdo_mysql", "php83-simplexml"],
  ),

  laravel: recipe(
    [
      {
        id: "laravel-composer",
        title: "Composer: Laravel",
        cmd: `${SRV} && rm -f index.html 2>/dev/null; mkdir -p /srv/.composer-cache /srv/.build && export TMPDIR=/srv/.build COMPOSER_HOME=/srv/.composer-cache COMPOSER_CACHE_DIR=/srv/.composer-cache/cache COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_MEMORY_LIMIT=-1 && composer create-project laravel/laravel /srv/.build/laravel --no-interaction --ignore-platform-reqs && cp -a /srv/.build/laravel/. /srv/ && rm -rf /srv/.build /srv/.composer-cache`,
      },
    ],
    "public/index.php",
    [...COMPOSER_PHP83],
  ),

  symfony: recipe(
    [
      {
        id: "symfony-composer",
        title: "Composer: Symfony skeleton",
        cmd: `${SRV} && rm -f index.html 2>/dev/null; mkdir -p /srv/.composer-cache /srv/.build && export TMPDIR=/srv/.build COMPOSER_HOME=/srv/.composer-cache COMPOSER_CACHE_DIR=/srv/.composer-cache/cache COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_MEMORY_LIMIT=-1 && composer create-project symfony/skeleton /srv/.build/sf --no-interaction --ignore-platform-reqs && cp -a /srv/.build/sf/. /srv/ && rm -rf /srv/.build /srv/.composer-cache`,
      },
    ],
    "public/index.php",
    [...COMPOSER_PHP83],
  ),

  flarum: recipe(
    [
      {
        id: "flarum-composer",
        title: "Composer: Flarum",
        cmd: `${SRV} && rm -f index.html 2>/dev/null; mkdir -p /srv/.composer-cache /srv/.build && export TMPDIR=/srv/.build COMPOSER_HOME=/srv/.composer-cache COMPOSER_CACHE_DIR=/srv/.composer-cache/cache COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_MEMORY_LIMIT=-1 && composer create-project flarum/flarum /srv/.build/flarum --no-interaction --ignore-platform-reqs && cp -a /srv/.build/flarum/. /srv/ && rm -rf /srv/.build /srv/.composer-cache`,
      },
    ],
    "public/index.php",
    [...COMPOSER_PHP83],
  ),

  mediawiki: recipe(
    [
      {
        id: "mw-download",
        title: "Download MediaWiki",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/mw.tgz https://releases.wikimedia.org/mediawiki/1.42/mediawiki-1.42.3.tar.gz && tar -xzf /tmp/mw.tgz -C /srv --strip-components=1 && rm -f /tmp/mw.tgz`,
      },
    ],
    "index.php",
    ["php83-intl", "php83-xml", "php83-gd", "php83-zip", "php83-mysqli", "php83-pdo_mysql", "php83-fileinfo", "php83-iconv"],
  ),

  phpbb: recipe(
    [
      {
        id: "phpbb-download",
        title: "Download phpBB",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/phpbb.zip https://download.phpbb.com/pub/release/3.3/3.3.14/phpBB-3.3.14.zip && unzip -q /tmp/phpbb.zip -d /tmp/phpbb && cp -a /tmp/phpbb/phpBB3/. /srv/ && rm -rf /tmp/phpbb /tmp/phpbb.zip`,
      },
    ],
    "index.php",
    ["unzip", "php83-xml", "php83-mysqli", "php83-pdo_mysql", "php83-gd", "php83-zip"],
  ),

  opencart: recipe(
    [
      {
        id: "oc-download",
        title: "Download OpenCart",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/oc.zip https://github.com/opencart/opencart/releases/download/4.0.2.3/opencart-4.0.2.3.zip && unzip -q /tmp/oc.zip -d /tmp/oc && cp -a /tmp/oc/upload/. /srv/ && rm -rf /tmp/oc /tmp/oc.zip`,
      },
    ],
    "index.php",
    ["unzip", "php83-curl", "php83-zip", "php83-gd", "php83-mysqli", "php83-pdo_mysql", "php83-xml", "php83-mbstring"],
  ),

  prestashop: recipe(
    [
      {
        id: "ps-download",
        title: "Download PrestaShop",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/ps.zip https://github.com/PrestaShop/PrestaShop/releases/download/8.2.0/prestashop_8.2.0.zip && unzip -q /tmp/ps.zip -d /tmp/ps && if test -f /tmp/ps/index.php; then cp -a /tmp/ps/. /srv/; elif test -f /tmp/ps/prestashop/index.php; then cp -a /tmp/ps/prestashop/. /srv/; else ONE=$(find /tmp/ps -mindepth 1 -maxdepth 1 -type d | head -1) && test -n "$ONE" && cp -a "$ONE"/. /srv/; fi && rm -rf /tmp/ps /tmp/ps.zip`,
      },
    ],
    "index.php",
    ["unzip", "findutils", "php83-curl", "php83-zip", "php83-gd", "php83-intl", "php83-mysqli", "php83-pdo_mysql", "php83-xml", "php83-simplexml", "php83-mbstring", "php83-iconv"],
  ),

  moodle: recipe(
    [
      {
        id: "moodle-download",
        title: "Download Moodle 4.5 LTS",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/moodle.tgz https://download.moodle.org/download.php/direct/stable405/moodle-latest-405.tgz && tar -xzf /tmp/moodle.tgz -C /srv --strip-components=1 && rm -f /tmp/moodle.tgz`,
      },
    ],
    "index.php",
    [
      "php83-iconv",
      "php83-intl",
      "php83-xml",
      "php83-zip",
      "php83-gd",
      "php83-soap",
      "php83-simplexml",
      "php83-xmlreader",
      "php83-mysqli",
      "php83-pdo_mysql",
      "php83-opcache",
      "php83-session",
      "php83-fileinfo",
      "php83-openssl",
    ],
  ),

  grav: recipe(
    [
      {
        id: "grav-download",
        title: "Download Grav CMS + Admin",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/grav.zip https://github.com/getgrav/grav/releases/download/1.7.52/grav-admin-v1.7.52.zip && unzip -q /tmp/grav.zip -d /tmp/grav && ONE=$(find /tmp/grav -mindepth 1 -maxdepth 1 -type d | head -1) && test -n "$ONE" && cp -a "$ONE"/. /srv/ && rm -rf /tmp/grav /tmp/grav.zip`,
      },
    ],
    "index.php",
    ["unzip", "findutils", "php83-dom", "php83-xml", "php83-zip", "php83-gd", "php83-curl", "php83-mbstring", "php83-session", "php83-openssl", "php83-simplexml"],
  ),

  dokuwiki: recipe(
    [
      {
        id: "dw-download",
        title: "Download DokuWiki stable",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/dw.tgz https://download.dokuwiki.org/src/dokuwiki/dokuwiki-stable.tgz && mkdir -p /tmp/dw && tar -xzf /tmp/dw.tgz -C /tmp/dw && ONE=$(find /tmp/dw -mindepth 1 -maxdepth 1 -type d | head -1) && test -n "$ONE" && cp -a "$ONE"/. /srv/ && rm -rf /tmp/dw /tmp/dw.tgz`,
      },
    ],
    "index.php",
    ["php83-xml", "php83-mbstring", "php83-session", "php83-openssl", "php83-zlib"],
  ),

  matomo: recipe(
    [
      {
        id: "matomo-download",
        title: "Download Matomo",
        cmd: `${SRV} && rm -f index.html && wget -qO /tmp/matomo.zip https://builds.matomo.org/matomo.zip && unzip -q /tmp/matomo.zip -d /tmp/matomo && mkdir -p /srv/matomo && if test -f /tmp/matomo/index.php; then cp -a /tmp/matomo/. /srv/matomo/; else ONE=$(find /tmp/matomo -mindepth 1 -maxdepth 1 -type d | head -1) && test -n "$ONE" && cp -a "$ONE"/. /srv/matomo/; fi && rm -rf /tmp/matomo /tmp/matomo.zip`,
      },
    ],
    "matomo/index.php",
    ["unzip", "findutils", "php83-curl", "php83-zip", "php83-gd", "php83-intl", "php83-mysqli", "php83-pdo_mysql", "php83-xml", "php83-mbstring", "php83-simplexml", "php83-iconv", "php83-fileinfo"],
  ),
};

/**
 * Template slugs that reuse another recipe (e.g. legacy `php-mysql-wp` → WordPress).
 * Target must exist as a key in `RECIPES`.
 */
export const RECIPE_ALIASES: Record<string, string> = {
  "php-mysql-wp": "wordpress",
  "php-mariadb": "wordpress",
  "wordpress-mariadb": "wordpress",
  "drupal-mariadb": "drupal",
  "laravel-mariadb": "laravel",
  "laravel-postgresql": "laravel",
  "laravel-sqlite": "laravel",
  "symfony-mariadb": "symfony",
  "flarum-mariadb": "flarum",
  "grav-mariadb": "grav",
  "matomo-mariadb": "matomo",
  "opencart-mariadb": "opencart",
  "prestashop-mariadb": "prestashop",
  "phpbb-mariadb": "phpbb",
  "joomla-mariadb": "joomla",
  "mediawiki-mariadb": "mediawiki",
  "moodle-mariadb": "moodle",
  "dokuwiki-mariadb": "dokuwiki",
};

export function getAppInstallRecipe(templateSlug: string): AppInstallRecipe | null {
  const key = RECIPE_ALIASES[templateSlug] ?? templateSlug;
  return RECIPES[key] ?? null;
}

export function templateSlugHasAppInstall(slug: string): boolean {
  const key = RECIPE_ALIASES[slug] ?? slug;
  return key in RECIPES;
}
