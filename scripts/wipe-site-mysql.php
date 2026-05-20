#!/usr/bin/env php
<?php
/** @deprecated Use wipe-site-db.php — kept for sudoers compatibility. */
declare(strict_types=1);
$root = $argv[1] ?? '';
if ($root === '') {
  fwrite(STDERR, "Usage: wipe-site-mysql.php <site-root>\n");
  exit(1);
}
passthru('exec /usr/bin/php ' . escapeshellarg(__DIR__ . '/wipe-site-db.php') . ' ' . escapeshellarg($root), $code);
exit($code);
