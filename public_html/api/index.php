<?php
ob_start();

ini_set('display_errors', '0');
error_reporting(E_ALL);

set_error_handler(function(int $errno, string $errstr, string $errfile, int $errline): bool {
    throw new ErrorException($errstr, 0, $errno, $errfile, $errline);
});

set_exception_handler(function(Throwable $e): void {
    ob_clean();
    error_log('Uncaught exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['success' => false, 'error' => 'Internal server error']);
    exit;
});

register_shutdown_function(function(): void {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        ob_clean();
        error_log('Fatal error: ' . $err['message'] . ' in ' . $err['file'] . ':' . $err['line']);
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Internal server error']);
    }
});

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/db.php';

$isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
         || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'secure'   => $isSecure,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

// Parse /api/<resource>[/<sub>] from REQUEST_URI
$uri      = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$uri      = preg_replace('#^/api#', '', $uri);
$parts    = array_values(array_filter(explode('/', trim($uri, '/'))));
$resource = $parts[0] ?? '';
$sub      = $parts[1] ?? null;
$method   = $_SERVER['REQUEST_METHOD'];

// Auth endpoints — no session required
if ($resource === 'auth') {
    require __DIR__ . '/auth.php';
    exit;
}

// All other endpoints require a valid session
if (empty($_SESSION['user_id'])) {
    json_error('Unauthenticated', 401);
}
define('CURRENT_USER_ID', (int)$_SESSION['user_id']);

switch ($resource) {
    case 'dashboard':    require __DIR__ . '/dashboard.php';    break;
    case 'transactions': require __DIR__ . '/transactions.php'; break;
    case 'budgets':      require __DIR__ . '/budgets.php';      break;
    case 'categories':   require __DIR__ . '/categories.php';   break;
    case 'merchants':    require __DIR__ . '/merchants.php';    break;
    case 'accounts':     require __DIR__ . '/accounts.php';     break;
    case 'reports':      require __DIR__ . '/reports.php';      break;
    case 'import':       require __DIR__ . '/import.php';       break;
    case 'profile':      require __DIR__ . '/profile.php';      break;
    default:             json_error('Not found', 404);
}
