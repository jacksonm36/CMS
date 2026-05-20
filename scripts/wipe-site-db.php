#!/usr/bin/env php
<?php
/**
 * Reset site database content by engine (from .hostpanel-db.env).
 * Usage: wipe-site-db.php <site-root>
 */
declare(strict_types=1);

$root = $argv[1] ?? '';
if ($root === '' || !is_dir($root)) {
  fwrite(STDERR, "Usage: wipe-site-db.php <site-root>\n");
  exit(1);
}

$envFile = $root . '/.hostpanel-db.env';
if (!is_readable($envFile)) {
  fwrite(STDERR, "skip: no .hostpanel-db.env\n");
  exit(0);
}

require_once __DIR__ . '/hostpanel-load-db.php';
$hp = hostpanel_db_env($envFile);
$engine = strtolower($hp['HP_DB_ENGINE'] ?? $hp['DB_CONNECTION'] ?? 'mysql');
if ($engine === 'postgres') {
  $engine = 'postgresql';
}
if ($engine === 'mongo') {
  $engine = 'mongodb';
}
if ($engine === 'sqlserver') {
  $engine = 'mssql';
}

try {
  switch ($engine) {
    case 'mysql':
    case 'mariadb':
      hp_wipe_mysql($hp);
      break;
    case 'postgresql':
      hp_wipe_postgresql($hp);
      break;
    case 'sqlite':
      hp_wipe_sqlite($root, $hp);
      break;
    case 'mongodb':
      hp_wipe_mongodb($hp);
      break;
    case 'mssql':
      hp_wipe_mssql($hp);
      break;
    default:
      fwrite(STDERR, "error: unsupported HP_DB_ENGINE={$engine}\n");
      exit(1);
  }
} catch (Throwable $e) {
  fwrite(STDERR, 'wipe failed: ' . $e->getMessage() . "\n");
  exit(1);
}

function hp_db_creds(array $hp): array
{
  return [
    'host' => $hp['DB_HOST'] ?? $hp['HP_DB_HOST'] ?? '127.0.0.1',
    'port' => $hp['DB_PORT'] ?? $hp['HP_DB_PORT'] ?? '3306',
    'name' => $hp['DB_NAME'] ?? $hp['HP_DB_NAME'] ?? '',
    'user' => $hp['DB_USER'] ?? $hp['HP_DB_USER'] ?? '',
    'pass' => $hp['DB_PASSWORD'] ?? $hp['HP_DB_PASSWORD'] ?? '',
    'site_id' => $hp['HP_SITE_ID'] ?? '',
  ];
}

/** SQL/Mongo identifiers from HostPanel provisioning (no injection via names). */
function hp_safe_db_name(string $name): string
{
  if ($name === '' || !preg_match('/^[a-zA-Z0-9_]{1,64}$/', $name)) {
    throw new InvalidArgumentException('invalid database name in env file');
  }
  return $name;
}

function hp_stack_container_name(string $siteId): ?string
{
  if ($siteId === '' || !preg_match('/^[a-z0-9]{8,}$/i', $siteId)) {
    return null;
  }
  $name = 'hostpanel-sitedb-' . $siteId;
  exec('docker inspect -f {{.State.Running}} ' . escapeshellarg($name), $out, $code);
  if ($code !== 0 || ($out[0] ?? '') !== 'true') {
    return null;
  }
  return $name;
}

function hp_wipe_mysql(array $hp): void
{
  $c = hp_db_creds($hp);
  hp_safe_db_name($c['name']);
  $pdo = new PDO(
    "mysql:host={$c['host']};port={$c['port']};dbname={$c['name']}",
    $c['user'],
    $c['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
  );
  $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
  $tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
  $n = 0;
  foreach ($tables as $table) {
    $safe = str_replace('`', '``', (string) $table);
    $pdo->exec("DROP TABLE IF EXISTS `{$safe}`");
    $n++;
  }
  $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
  echo "wipe-site-db: mysql dropped {$n} tables from {$c['name']}\n";
}

function hp_wipe_postgresql(array $hp): void
{
  $c = hp_db_creds($hp);
  hp_safe_db_name($c['name']);
  $port = $c['port'] ?: '5432';
  $pdo = new PDO(
    "pgsql:host={$c['host']};port={$port};dbname={$c['name']}",
    $c['user'],
    $c['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
  );
  $tables = $pdo->query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  )->fetchAll(PDO::FETCH_COLUMN);
  $n = 0;
  foreach ($tables as $table) {
    $safe = preg_replace('/[^a-zA-Z0-9_]/', '', (string) $table);
    if ($safe === '') {
      continue;
    }
    $pdo->exec("DROP TABLE IF EXISTS \"{$safe}\" CASCADE");
    $n++;
  }
  echo "wipe-site-db: postgresql dropped {$n} tables from {$c['name']}\n";
}

function hp_wipe_sqlite(string $root, array $hp): void
{
  $rel = $hp['HP_DB_PATH'] ?? $hp['DB_DATABASE'] ?? $hp['DB_NAME'] ?? $hp['HP_DB_NAME'] ?? 'private/hostpanel.sqlite';
  $path = str_starts_with($rel, '/') ? $rel : $root . '/' . $rel;
  if (is_file($path)) {
    unlink($path);
  }
  $dir = dirname($path);
  if (!is_dir($dir)) {
    mkdir($dir, 0775, true);
  }
  touch($path);
  chmod($path, 0660);
  echo "wipe-site-db: sqlite recreated {$rel}\n";
}

function hp_wipe_mongodb(array $hp): void
{
  $c = hp_db_creds($hp);
  $dbName = hp_safe_db_name($c['name']);
  $container = hp_stack_container_name($c['site_id']);
  if ($container !== null) {
    hp_wipe_mongodb_docker($container, $c, $dbName);
    return;
  }
  $port = $c['port'] ?: '27017';
  $user = rawurlencode($c['user']);
  $pass = rawurlencode($c['pass']);
  $auth = $c['user'] !== '' ? "{$user}:{$pass}@" : '';
  $uri = "mongodb://{$auth}{$c['host']}:{$port}/";
  if (class_exists('MongoDB\\Driver\\Manager')) {
    $manager = new MongoDB\Driver\Manager($uri);
    $cmd = new MongoDB\Driver\Command(['dropDatabase' => 1]);
    $manager->executeCommand($dbName, $cmd);
    echo "wipe-site-db: mongodb dropped database {$dbName} (php-mongodb)\n";
    return;
  }
  hp_wipe_mongodb_shell($c, $dbName);
}

function hp_wipe_mongodb_docker(string $container, array $c, string $dbName): void
{
  $js = 'db.getSiblingDB(' . json_encode($dbName) . ').dropDatabase();';
  $cmd = sprintf(
    'docker exec %s mongosh --quiet -u %s -p %s --authenticationDatabase admin --eval %s',
    escapeshellarg($container),
    escapeshellarg($c['user']),
    escapeshellarg($c['pass']),
    escapeshellarg($js),
  );
  exec($cmd, $_, $code);
  if ($code !== 0) {
    $cmd = sprintf(
      'docker exec %s mongo --quiet -u %s -p %s --authenticationDatabase admin --eval %s',
      escapeshellarg($container),
      escapeshellarg($c['user']),
      escapeshellarg($c['pass']),
      escapeshellarg($js),
    );
    exec($cmd, $_, $code);
  }
  if ($code !== 0) {
    throw new RuntimeException('docker exec mongosh/mongo dropDatabase failed');
  }
  echo "wipe-site-db: mongodb dropped database {$dbName} (docker exec)\n";
}

function hp_wipe_mongodb_shell(array $c, string $dbName): void
{
  $port = $c['port'] ?: '27017';
  $js = 'db.getSiblingDB(' . json_encode($dbName) . ').dropDatabase();';
  $cmd = sprintf(
    'mongosh --host %s --port %s -u %s -p %s --authenticationDatabase admin --eval %s 2>/dev/null || mongo --host %s --port %s -u %s -p %s --authenticationDatabase admin --eval %s',
    escapeshellarg($c['host']),
    escapeshellarg($port),
    escapeshellarg($c['user']),
    escapeshellarg($c['pass']),
    escapeshellarg($js),
    escapeshellarg($c['host']),
    escapeshellarg($port),
    escapeshellarg($c['user']),
    escapeshellarg($c['pass']),
    escapeshellarg($js),
  );
  exec($cmd, $_, $code);
  if ($code !== 0) {
    throw new RuntimeException('mongosh/mongo dropDatabase failed (install mongosh, php-mongodb, or use stack container)');
  }
  echo "wipe-site-db: mongodb dropped database {$dbName} (host shell)\n";
}

function hp_mssql_recreate_sql(string $dbName): string
{
  $db = hp_safe_db_name($dbName);
  return "IF EXISTS (SELECT name FROM sys.databases WHERE name = N'{$db}') "
    . "BEGIN ALTER DATABASE [{$db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{$db}]; END; "
    . "CREATE DATABASE [{$db}];";
}

function hp_wipe_mssql(array $hp): void
{
  $c = hp_db_creds($hp);
  $dbName = hp_safe_db_name($c['name']);
  $q = hp_mssql_recreate_sql($dbName);
  $container = hp_stack_container_name($c['site_id']);
  if ($container !== null) {
    hp_wipe_mssql_docker($container, $c, $q, $dbName);
    return;
  }
  $port = $c['port'] ?: '1433';
  if (extension_loaded('sqlsrv') || extension_loaded('pdo_sqlsrv')) {
    $dsn = "sqlsrv:Server={$c['host']},{$port};Database=master";
    $pdo = new PDO($dsn, $c['user'], $c['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec($q);
    echo "wipe-site-db: mssql recreated database {$dbName} (pdo_sqlsrv)\n";
    return;
  }
  hp_wipe_mssql_shell($c, $q, $dbName);
}

function hp_wipe_mssql_docker(string $container, array $c, string $q, string $dbName): void
{
  $cmd = sprintf(
    'docker exec %s /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U %s -P %s -Q %s',
    escapeshellarg($container),
    escapeshellarg($c['user']),
    escapeshellarg($c['pass']),
    escapeshellarg($q),
  );
  exec($cmd, $_, $code);
  if ($code !== 0) {
    throw new RuntimeException('docker exec sqlcmd failed for stack SQL Server');
  }
  echo "wipe-site-db: mssql recreated database {$dbName} (docker exec)\n";
}

function hp_wipe_mssql_shell(array $c, string $q, string $dbName): void
{
  $port = $c['port'] ?: '1433';
  $cmd = sprintf(
    'sqlcmd -S %s,%s -U %s -P %s -C -Q %s',
    escapeshellarg($c['host']),
    escapeshellarg($port),
    escapeshellarg($c['user']),
    escapeshellarg($c['pass']),
    escapeshellarg($q),
  );
  exec($cmd, $_, $code);
  if ($code !== 0) {
    throw new RuntimeException('sqlcmd failed — use stack container (HP_SITE_ID) or install mssql-tools on host');
  }
  echo "wipe-site-db: mssql recreated database {$dbName} (host sqlcmd)\n";
}
