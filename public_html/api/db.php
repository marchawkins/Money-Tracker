<?php
// config/ lives two levels up from public_html/api/ on local dev (MAMP)
// and four levels up on Hostinger shared hosting.
$candidates = [
    __DIR__ . '/../../config/db.php',
    __DIR__ . '/../../../../config/db.php',
];

$config_path = null;
foreach ($candidates as $path) {
    if (file_exists($path)) { $config_path = $path; break; }
}

if ($config_path === null) {
    throw new RuntimeException('Database configuration file not found.');
}

require_once $config_path;

function get_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $charset = defined('DB_CHARSET') ? DB_CHARSET : 'utf8mb4';
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, $charset);
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            throw new RuntimeException('Database connection failed: ' . $e->getMessage());
        }
    }
    return $pdo;
}
