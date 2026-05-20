#!/usr/bin/env php
<?php
/**
 * Inject HostPanel database config + installer writables per CMS profile.
 * Credentials in .hostpanel-db.env (640, hostpanel:www-data). Root reads env at provision time
 * and writes profile-specific sidecar configs included last so installer stubs cannot override.
 */
declare(strict_types=1);

$root = $argv[1] ?? '';
$profile = $argv[2] ?? '';
if ($root === '' || $profile === '' || !is_dir($root)) {
  fwrite(STDERR, "Usage: cms-db-inject.php <site-root> <profile>\n");
  exit(1);
}

$envFile = $root . '/.hostpanel-db.env';
if (!is_readable($envFile)) {
  fwrite(STDERR, "skip: no .hostpanel-db.env\n");
  exit(0);
}

require_once __DIR__ . '/hostpanel-load-db.php';

function hp_www_dir(string $path): void
{
  if (!is_dir($path)) {
    mkdir($path, 0775, true);
  }
  exec('chown -R hostpanel:www-data ' . escapeshellarg($path), $_, $code);
  if ($code !== 0) {
    return;
  }
  exec('chmod -R g+rwX ' . escapeshellarg($path));
  exec('find ' . escapeshellarg($path) . ' -type d -exec chmod g+s {} +');
}

function hp_www_config_file(string $path): void
{
  if (!is_file($path)) {
    return;
  }
  exec('chown hostpanel:www-data ' . escapeshellarg($path));
  exec('chmod 660 ' . escapeshellarg($path));
}

function hp_php_sq(string $value): string
{
  return str_replace(['\\', "'"], ['\\\\', "\\'"], $value);
}

/** @return array{host: string, port: string, name: string, user: string, pass: string} */
function hp_db_creds(array $hp): array
{
  return [
    'host' => $hp['DB_HOST'] ?? $hp['HP_DB_HOST'] ?? '127.0.0.1',
    'port' => (string) ($hp['DB_PORT'] ?? $hp['HP_DB_PORT'] ?? '3306'),
    'name' => $hp['DB_NAME'] ?? $hp['HP_DB_NAME'] ?? '',
    'user' => $hp['DB_USER'] ?? $hp['HP_DB_USER'] ?? '',
    'pass' => $hp['DB_PASSWORD'] ?? $hp['HP_DB_PASSWORD'] ?? '',
  ];
}

function hp_write_sidecar(string $path, string $body): void
{
  file_put_contents($path, $body);
  hp_www_config_file($path);
}

function hp_strip_include_block(string $content, string $marker): string
{
  return (string) preg_replace(
    '/\n\/\/ HostPanel ' . preg_quote($marker, '/') . '.*?\n\}\n/s',
    "\n",
    $content,
  );
}

function hp_strip_php_define_keys(string $content, array $keys): string
{
  foreach ($keys as $key) {
    $content = (string) preg_replace(
      '/\n?define\s*\(\s*[\'"]' . preg_quote($key, '/') . '[\'"]\s*,[^)]*\)\s*;\s*/',
      "\n",
      $content,
    );
  }
  return $content;
}

/** Append a require of a sidecar PHP file as the last executable block. */
function hp_sync_php_include_last(string $configFile, string $sidecarBasename, string $marker): void
{
  if (!is_readable($configFile)) {
    return;
  }
  $content = file_get_contents($configFile);
  if ($content === false) {
    return;
  }
  $content = hp_strip_include_block($content, $marker);
  if (!str_contains($content, 'HostPanel ' . $marker)) {
    $content = rtrim($content) . <<<PHP


// HostPanel {$marker} — must stay last (installer stubs cannot override).
if (is_readable(__DIR__ . '/{$sidecarBasename}')) {
  require __DIR__ . '/{$sidecarBasename}';
}

PHP;
  }
  file_put_contents($configFile, $content . "\n");
  hp_www_config_file($configFile);
}

/** Remove legacy runtime-only HostPanel DB block (www-data could not read mode-600 env). */
function hp_strip_hostpanel_runtime_db_block(string $content): string
{
  return (string) preg_replace(
    '/\n\/\/ HostPanel auto database.*?(?=\n\/\/|\n\$|\n#|\z)/s',
    "\n",
    $content,
    1,
  );
}

function hp_strip_drupal_installer_array_blocks(string $content): string
{
  return (string) preg_replace(
    '/\n\$databases\[\'default\'\]\[\'default\'\] = array\s*\([^;]*\);\s*/s',
    "\n",
    $content,
  );
}

function hp_strip_drupal_inline_and_installer_db(string $content): string
{
  $content = (string) preg_replace(
    '/\n\/\/ HostPanel materialized database.*?\n\];\n/s',
    "\n",
    $content,
  );
  $content = hp_strip_drupal_installer_array_blocks($content);
  return hp_strip_include_block($content, 'database include');
}

/** Truncate dead installer appendages after `return;` in the settings.php wrapper. */
function hp_strip_settings_after_return(string $content): string
{
  if (preg_match('/\nreturn\s*;\s*/s', $content)) {
    return (string) preg_replace('/\nreturn\s*;\s*.*/s', "\nreturn;\n", $content);
  }
  return $content;
}

function hp_drupal_settings_wrapper(): string
{
  return <<<'PHP'
<?php

/**
 * HostPanel settings bootstrap. Drupal installer may append below the return;
 * that appended code is never executed (settings.php is included by Drupal).
 */
require __DIR__ . '/settings.drupal.php';
if (is_readable(__DIR__ . '/settings.hostpanel.php')) {
  require __DIR__ . '/settings.hostpanel.php';
}
return;

PHP;
}

function hp_drupal_databases_array(array $hp): string
{
  $c = hp_db_creds($hp);
  $host = hp_php_sq($c['host']);
  $port = hp_php_sq($c['port']);
  $name = hp_php_sq($c['name']);
  $user = hp_php_sq($c['user']);
  $pass = hp_php_sq($c['pass']);

  return <<<PHP
\$databases['default']['default'] = [
  'database' => '{$name}',
  'username' => '{$user}',
  'password' => '{$pass}',
  'host' => '{$host}',
  'port' => '{$port}',
  'driver' => 'mysql',
  'prefix' => '',
  'collation' => 'utf8mb4_general_ci',
];
PHP;
}

function hp_provision_drupal(string $root, array $hp): void
{
  $defaultDir = $root . '/web/sites/default';
  $files = $defaultDir . '/files';
  foreach (['/translations', '/tmp'] as $sub) {
    $p = $files . $sub;
    if (!is_dir($p)) {
      mkdir($p, 0775, true);
    }
  }
  $settings = $defaultDir . '/settings.php';
  $defaultSettings = $defaultDir . '/default.settings.php';
  if (is_readable($defaultSettings) && !is_file($settings)) {
    copy($defaultSettings, $settings);
  }
  hp_www_dir($files);
  hp_www_dir($root . '/private');
  exec('chown hostpanel:www-data ' . escapeshellarg($defaultDir));
  exec('chmod g+w ' . escapeshellarg($defaultDir));

  $c = hp_db_creds($hp);
  hp_write_sidecar(
    $defaultDir . '/settings.hostpanel.php',
    "<?php\n\n/** HostPanel — TCP {$c['host']}:{$c['port']}. Regenerated by provision-cms-install.sh */\n"
      . hp_drupal_databases_array($hp) . "\n",
  );

  $drupalSettings = $defaultDir . '/settings.drupal.php';
  $wrapperMarker = 'HostPanel settings bootstrap';
  $content = file_get_contents($settings);
  if ($content === false) {
    return;
  }

  if (!str_contains($content, $wrapperMarker)) {
    $bulk = hp_strip_hostpanel_runtime_db_block($content);
    $bulk = hp_strip_drupal_inline_and_installer_db($bulk);
    $bulk = (string) preg_replace(
      '/\n\$settings\[\'config_sync_directory\'\]\s*=.*?;\s*/s',
      "\n",
      $bulk,
    );
    file_put_contents($drupalSettings, rtrim($bulk) . "\n");
    hp_www_config_file($drupalSettings);
  } else {
    $wrapper = hp_strip_settings_after_return($content);
    file_put_contents($settings, $wrapper);
  }

  file_put_contents($settings, hp_drupal_settings_wrapper());
  hp_www_config_file($settings);
}

function hp_wordpress_sidecar(array $hp): string
{
  $c = hp_db_creds($hp);
  $host = hp_php_sq($c['host']);
  $port = hp_php_sq($c['port']);
  $name = hp_php_sq($c['name']);
  $user = hp_php_sq($c['user']);
  $pass = hp_php_sq($c['pass']);

  return <<<PHP
<?php

/** HostPanel — TCP {$host}:{$port}. Regenerated by provision-cms-install.sh */
define('DB_NAME', '{$name}');
define('DB_USER', '{$user}');
define('DB_PASSWORD', '{$pass}');
define('DB_HOST', '{$host}:{$port}');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', 'utf8mb4_unicode_ci');

PHP;
}

function hp_wordpress_config_wrapper(): string
{
  return <<<'PHP'
<?php

/**
 * HostPanel wp-config bootstrap. Installer appendages below return are never executed.
 */
require __DIR__ . '/wp-config.wordpress.php';
if (is_readable(__DIR__ . '/wp-config.hostpanel.php')) {
  require __DIR__ . '/wp-config.hostpanel.php';
}
return;

PHP;
}

function hp_provision_wordpress(string $root, array $hp): void
{
  $sample = $root . '/wp-config-sample.php';
  $config = $root . '/wp-config.php';
  $bulk = $root . '/wp-config.wordpress.php';
  if (is_readable($sample) && !is_file($config)) {
    copy($sample, $config);
  }
  hp_www_dir($root . '/wp-content/uploads');
  hp_write_sidecar($root . '/wp-config.hostpanel.php', hp_wordpress_sidecar($hp));

  if (!is_readable($config)) {
    return;
  }
  $content = file_get_contents($config);
  if ($content === false) {
    return;
  }
  if (!str_contains($content, 'HostPanel wp-config bootstrap')) {
    $body = (string) preg_replace('/\n\/\/ HostPanel materialized database.*?\n/s', "\n", $content);
    $body = hp_strip_php_define_keys($body, [
      'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_CHARSET', 'DB_COLLATE',
    ]);
    $body = hp_strip_include_block($body, 'database include');
    file_put_contents($bulk, rtrim($body) . "\n");
    hp_www_config_file($bulk);
  } else {
    file_put_contents($config, hp_strip_settings_after_return($content));
  }
  file_put_contents($config, hp_wordpress_config_wrapper());
  hp_www_config_file($config);
}

function hp_moodle_sidecar(array $hp): string
{
  $c = hp_db_creds($hp);
  $host = hp_php_sq($c['host']);
  $port = (int) $c['port'];
  $name = hp_php_sq($c['name']);
  $user = hp_php_sq($c['user']);
  $pass = hp_php_sq($c['pass']);

  return <<<PHP
<?php

/** HostPanel — TCP {$host}:{$port}. Regenerated by provision-cms-install.sh */
\$CFG->dbtype    = 'mysqli';
\$CFG->dblibrary = 'native';
\$CFG->dbhost    = '{$host}';
\$CFG->dbname    = '{$name}';
\$CFG->dbuser    = '{$user}';
\$CFG->dbpass    = '{$pass}';
\$CFG->prefix    = 'mdl_';
\$CFG->dboptions = ['dbpersist' => 0, 'dbport' => {$port}, 'dbsocket' => ''];

PHP;
}

function hp_moodle_config_wrapper(): string
{
  return <<<'PHP'
<?php

/**
 * HostPanel Moodle config bootstrap. Installer appendages below return are never executed.
 */
require __DIR__ . '/config.moodle.php';
if (is_readable(__DIR__ . '/config.hostpanel.php')) {
  require __DIR__ . '/config.hostpanel.php';
}
return;

PHP;
}

function hp_provision_moodle(string $root, array $hp): void
{
  $dist = $root . '/config-dist.php';
  $config = $root . '/config.php';
  $bulk = $root . '/config.moodle.php';
  if (is_readable($dist) && !is_file($config)) {
    copy($dist, $config);
  }
  $datadir = dirname($root) . '/moodledata-' . basename($root);
  hp_www_dir($datadir);
  hp_write_sidecar($root . '/config.hostpanel.php', hp_moodle_sidecar($hp));

  if (!is_readable($config)) {
    return;
  }
  $content = file_get_contents($config);
  if ($content === false) {
    return;
  }
  if (!str_contains($content, 'HostPanel Moodle config bootstrap')) {
    $body = (string) preg_replace(
      '/\n\/\/ HostPanel Moodle database bootstrap.*?\n\}\n/s',
      "\n",
      $content,
    );
    $body = (string) preg_replace(
      '/\n\/\/ HostPanel auto database.*?(?=\n\/\/|\n\$|\z)/s',
      "\n",
      $body,
    );
    $body = hp_strip_include_block($body, 'database include');
    file_put_contents($bulk, rtrim($body) . "\n");
    hp_www_config_file($bulk);
  } else {
    file_put_contents($config, hp_strip_settings_after_return($content));
  }
  file_put_contents($config, hp_moodle_config_wrapper());
  hp_www_config_file($config);
}

function hp_opencart_sidecar(array $hp): string
{
  $c = hp_db_creds($hp);
  $host = hp_php_sq($c['host']);
  $port = hp_php_sq($c['port']);
  $name = hp_php_sq($c['name']);
  $user = hp_php_sq($c['user']);
  $pass = hp_php_sq($c['pass']);

  return <<<PHP
<?php

/** HostPanel — TCP {$host}:{$port}. Regenerated by provision-cms-install.sh */
define('DB_HOSTNAME', '{$host}');
define('DB_USERNAME', '{$user}');
define('DB_PASSWORD', '{$pass}');
define('DB_DATABASE', '{$name}');
define('DB_PORT', '{$port}');

PHP;
}

function hp_provision_opencart_config(string $config, array $hp): void
{
  if (!is_readable($config)) {
    return;
  }
  $dir = dirname($config);
  $sidecar = $dir . '/config.hostpanel.php';
  hp_write_sidecar($sidecar, hp_opencart_sidecar($hp));
  $content = file_get_contents($config);
  if ($content === false) {
    return;
  }
  $content = hp_strip_php_define_keys($content, [
    'DB_HOSTNAME', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE', 'DB_PORT',
  ]);
  $content = hp_strip_include_block($content, 'database include');
  if (!str_contains($content, 'HostPanel database include')) {
    $content = rtrim($content) . "\n\n// HostPanel database include — must stay last.\n"
      . "if (is_readable(__DIR__ . '/config.hostpanel.php')) {\n"
      . "  require __DIR__ . '/config.hostpanel.php';\n"
      . "}\n";
  }
  file_put_contents($config, $content);
  hp_www_config_file($config);
}

function hp_phpbb_sidecar(array $hp): string
{
  $c = hp_db_creds($hp);
  $host = hp_php_sq($c['host']);
  $port = hp_php_sq($c['port']);
  $name = hp_php_sq($c['name']);
  $user = hp_php_sq($c['user']);
  $pass = hp_php_sq($c['pass']);

  return <<<PHP
<?php

/** HostPanel — TCP {$host}:{$port}. Regenerated by provision-cms-install.sh */
\$dbms = 'phpbb\\db\\driver\\mysqli';
\$dbhost = '{$host}:{$port}';
\$dbport = '{$port}';
\$dbname = '{$name}';
\$dbuser = '{$user}';
\$dbpasswd = '{$pass}';

PHP;
}

function hp_provision_phpbb(string $root, array $hp): void
{
  $config = $root . '/config.php';
  if (!is_readable($config)) {
    return;
  }
  hp_write_sidecar($root . '/config.hostpanel.php', hp_phpbb_sidecar($hp));
  $content = file_get_contents($config);
  if ($content === false) {
    return;
  }
  foreach (['$dbms', '$dbhost', '$dbport', '$dbname', '$dbuser', '$dbpasswd'] as $var) {
    $content = (string) preg_replace(
      '/\n' . preg_quote($var, '/') . '\s*=[^;]*;/',
      "\n",
      $content,
    );
  }
  hp_sync_php_include_last($config, 'config.hostpanel.php', 'database include');
}

function hp_joomla_sidecar(array $hp): string
{
  $c = hp_db_creds($hp);
  $host = hp_php_sq($c['host']);
  $port = hp_php_sq($c['port']);
  $name = hp_php_sq($c['name']);
  $user = hp_php_sq($c['user']);
  $pass = hp_php_sq($c['pass']);

  return <<<PHP
<?php

/** HostPanel — TCP {$host}:{$port}. Regenerated by provision-cms-install.sh */
class JConfigHostpanel {
  public \$host = '{$host}';
  public \$user = '{$user}';
  public \$password = '{$pass}';
  public \$db = '{$name}';
  public \$dbprefix = 'jos_';
  public \$dbtype = 'mysqli';
}

PHP;
}

function hp_provision_joomla(string $root, array $hp): void
{
  hp_www_dir($root . '/tmp');
  hp_www_dir($root . '/cache');
  hp_www_dir($root . '/administrator/logs');
  hp_write_sidecar($root . '/configuration.hostpanel.php', hp_joomla_sidecar($hp));
  hp_write_install_db_json($root, $hp);

  $config = $root . '/configuration.php';
  if (!is_readable($config)) {
    return;
  }
  hp_sync_php_include_last($config, 'configuration.hostpanel.php', 'database include');
  // Map sidecar into $config if JConfig already exists (post-partial-install).
  $content = file_get_contents($config);
  if ($content === false || !str_contains($content, 'class JConfig')) {
    return;
  }
  $c = hp_db_creds($hp);
  $replacements = [
    'public $host' => "public \$host = '" . hp_php_sq($c['host']) . "'",
    'public $user' => "public \$user = '" . hp_php_sq($c['user']) . "'",
    'public $password' => "public \$password = '" . hp_php_sq($c['pass']) . "'",
    'public $db' => "public \$db = '" . hp_php_sq($c['name']) . "'",
  ];
  foreach ($replacements as $prop => $line) {
    $content = (string) preg_replace(
      '/\s*' . preg_quote($prop, '/') . '\s*=\s*[^;]+;/',
      "\n    " . $line . ';',
      $content,
      1,
    );
  }
  file_put_contents($config, $content);
  hp_www_config_file($config);
}

function hp_merge_dotenv(string $envPath, array $hp): bool
{
  $c = hp_db_creds($hp);
  if ($c['name'] === '') {
    return false;
  }
  $keys = [
    'DB_CONNECTION' => 'mysql',
    'DB_HOST' => $c['host'],
    'DB_PORT' => $c['port'],
    'DB_DATABASE' => $c['name'],
    'DB_USERNAME' => $c['user'],
    'DB_PASSWORD' => $c['pass'],
    'DATABASE_URL' => sprintf(
      'mysql://%s:%s@%s:%s/%s',
      rawurlencode($c['user']),
      rawurlencode($c['pass']),
      $c['host'],
      $c['port'],
      $c['name'],
    ),
  ];
  $lines = is_readable($envPath) ? (file($envPath, FILE_IGNORE_NEW_LINES) ?: []) : [];
  $out = [];
  $hostpanelSection = false;
  foreach ($lines as $line) {
    if (str_contains($line, 'HostPanel database')) {
      $hostpanelSection = true;
      continue;
    }
    if ($hostpanelSection && str_contains($line, '=')) {
      [$k] = explode('=', $line, 2);
      if (isset($keys[trim($k)])) {
        continue;
      }
      $hostpanelSection = false;
    }
    $skip = false;
    if (str_contains($line, '=')) {
      [$k] = explode('=', $line, 2);
      $k = trim($k);
      if (isset($keys[$k])) {
        $skip = true;
      }
    }
    if (!$skip) {
      $out[] = $line;
    }
  }
  $out[] = '';
  $out[] = '# HostPanel database (from .hostpanel-db.env — overwritten on each provision)';
  foreach ($keys as $k => $v) {
    $out[] = $k . '=' . $v;
  }
  file_put_contents($envPath, implode("\n", $out) . "\n");
  hp_www_config_file($envPath);
  return true;
}

function hp_merge_matomo_ini(string $iniPath, array $hp): bool
{
  $c = hp_db_creds($hp);
  if ($c['name'] === '' || !is_readable($iniPath)) {
    return false;
  }
  $content = file_get_contents($iniPath);
  if ($content === false) {
    return false;
  }
  $section = "[database]\n"
    . 'host = "' . $c['host'] . "\"\n"
    . 'username = "' . $c['user'] . "\"\n"
    . 'password = "' . str_replace('"', '\\"', $c['pass']) . "\"\n"
    . 'dbname = "' . $c['name'] . "\"\n"
    . 'port = ' . $c['port'] . "\n"
    . "adapter = \"PDO\\MYSQL\"\n"
    . "tables_prefix = \"matomo_\"\n"
    . "charset = \"utf8mb4\"\n";
  if (preg_match('/\[database\][^\[]*/s', $content)) {
    $content = (string) preg_replace('/\[database\][^\[]*/s', $section, $content, 1);
  } else {
    $content .= "\n\n; HostPanel database\n" . $section;
  }
  file_put_contents($iniPath, $content);
  hp_www_config_file($iniPath);
  return true;
}

function hp_write_install_db_json(string $root, array $hp): void
{
  $c = hp_db_creds($hp);
  $ref = $root . '/.hostpanel-install-db.json';
  file_put_contents($ref, json_encode([
    'host' => $c['host'],
    'port' => (int) $c['port'],
    'database' => $c['name'],
    'username' => $c['user'],
    'password' => $c['pass'],
    'note' => 'Use 127.0.0.1 and port for Docker MySQL, not localhost',
  ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
  exec('chown hostpanel:www-data ' . escapeshellarg($ref));
  exec('chmod 640 ' . escapeshellarg($ref));
}

function hp_provision_installer_php(string $root, array $hp): void
{
  hp_www_dir($root . '/tmp');
  hp_www_dir($root . '/cache');
  hp_write_install_db_json($root, $hp);
}

$hpEnv = hostpanel_db_env($envFile);

switch ($profile) {
  case 'drupal':
    hp_provision_drupal($root, $hpEnv);
    break;

  case 'wordpress':
    hp_provision_wordpress($root, $hpEnv);
    break;

  case 'moodle':
    hp_provision_moodle($root, $hpEnv);
    break;

  case 'laravel':
  case 'symfony':
  case 'flarum':
    $dotenv = $root . '/.env';
    $example = $root . '/.env.example';
    if (!is_file($dotenv) && is_readable($example)) {
      copy($example, $dotenv);
    }
    hp_merge_dotenv($dotenv, $hpEnv);
    $local = $root . '/.env.local';
    if (is_file($local)) {
      hp_merge_dotenv($local, $hpEnv);
    }
    hp_www_dir($root . '/storage');
    hp_www_dir($root . '/bootstrap/cache');
    break;

  case 'opencart':
    hp_www_dir($root . '/image/cache');
    hp_www_dir($root . '/system/storage/cache');
    hp_provision_opencart_config($root . '/config.php', $hpEnv);
    hp_provision_opencart_config($root . '/admin/config.php', $hpEnv);
    break;

  case 'phpbb':
    hp_www_dir($root . '/cache');
    hp_www_dir($root . '/files');
    hp_www_dir($root . '/store');
    hp_provision_phpbb($root, $hpEnv);
    break;

  case 'joomla':
    hp_provision_joomla($root, $hpEnv);
    break;

  case 'prestashop':
    hp_www_dir($root . '/var/cache');
    hp_www_dir($root . '/img');
    hp_www_dir($root . '/upload');
    $dotenv = $root . '/.env';
    if (is_file($dotenv) || is_readable($root . '/.env.dist')) {
      if (!is_file($dotenv) && is_readable($root . '/.env.dist')) {
        copy($root . '/.env.dist', $dotenv);
      }
      hp_merge_dotenv($dotenv, $hpEnv);
    }
    break;

  case 'matomo':
    hp_www_dir($root . '/tmp');
    hp_www_dir($root . '/config');
    $ini = $root . '/config/config.ini.php';
    if (is_file($ini)) {
      hp_merge_matomo_ini($ini, $hpEnv);
    }
    break;

  case 'mediawiki':
    hp_www_dir($root . '/images');
    hp_www_dir($root . '/cache');
    hp_write_install_db_json($root, $hpEnv);
    $local = $root . '/LocalSettings.php';
    if (is_file($local)) {
      $c = hp_db_creds($hpEnv);
      hp_write_sidecar(
        $root . '/LocalSettings.hostpanel.php',
        "<?php\n\n/** HostPanel — TCP {$c['host']}:{$c['port']}. Regenerated by provision-cms-install.sh */\n"
          . '$wgDBserver = "' . $c['host'] . ':' . $c['port'] . "\";\n"
          . '$wgDBname = "' . $c['name'] . "\";\n"
          . '$wgDBuser = "' . $c['user'] . "\";\n"
          . '$wgDBpassword = "' . str_replace('"', '\\"', $c['pass']) . "\";\n"
          . "\$wgDBtype = \"mysql\";\n",
      );
      hp_sync_php_include_last($local, 'LocalSettings.hostpanel.php', 'database include');
    }
    break;

  case 'installer-php':
  default:
    hp_provision_installer_php($root, $hpEnv);
    break;
}

echo "cms-db-inject: ok profile={$profile}\n";
