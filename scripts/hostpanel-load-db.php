<?php
/**
 * HostPanel — read-only loader for .hostpanel-db.env (site root, outside public docroot when possible).
 * Included by CMS configs; dotfiles are denied by nginx `location ~ /\.`.
 */
declare(strict_types=1);

if (!function_exists('hostpanel_db_env')) {
  function hostpanel_db_env(?string $envFile = null): array
  {
    static $cache = [];
    $file = $envFile ?? (__DIR__ . '/.hostpanel-db.env');
    if (isset($cache[$file])) {
      return $cache[$file];
    }
    $parsed = [];
    if (!is_readable($file)) {
      return $cache[$file] = $parsed;
    }
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) {
      return $cache[$file] = $parsed;
    }
    foreach ($lines as $line) {
      $line = trim($line);
      if ($line === '' || $line[0] === '#') {
        continue;
      }
      if (!str_contains($line, '=')) {
        continue;
      }
      [$k, $v] = explode('=', $line, 2);
      $k = trim($k);
      if (!preg_match('/^[A-Z0-9_]+$/', $k)) {
        continue;
      }
      $v = trim($v);
      if (str_contains($v, "\0") || preg_match('/[\r\n]/', $v)) {
        continue;
      }
      $parsed[$k] = $v;
    }
    $host = $parsed['DB_HOST'] ?? $parsed['HP_DB_HOST'] ?? '';
    if (strcasecmp($host, 'localhost') === 0) {
      $host = '127.0.0.1';
      $parsed['DB_HOST'] = $host;
      $parsed['HP_DB_HOST'] = $host;
    }
    return $cache[$file] = $parsed;
  }
}
