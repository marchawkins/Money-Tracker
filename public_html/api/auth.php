<?php
require_once __DIR__ . '/helpers/mailer.php';

$db = get_db();

switch ($method) {
    case 'GET':
        if ($sub === 'me') { handleMe($db); break; }
        json_error('Not found', 404);
        break;
    case 'POST':
        switch ($sub) {
            case 'register':       handleRegister($db);       break;
            case 'login':          handleLogin($db);          break;
            case 'logout':         handleLogout();            break;
            case 'forgot-password': handleForgotPassword($db); break;
            case 'reset-password':  handleResetPassword($db);  break;
            case 'verify-email':    handleVerifyEmail($db);    break;
            default: json_error('Not found', 404);
        }
        break;
    default:
        json_error('Method not allowed', 405);
}

// ── Default categories seeded for every new user ──────────────────────────────
function seed_default_categories(PDO $db, int $user_id): void {
    $categories = [
        'Groceries', 'Restaurants & Dining', 'Coffee & Drinks', 'Gas & Fuel',
        'Auto & Transport', 'Shopping', 'Entertainment', 'Travel',
        'Health & Medical', 'Home & Garden', 'Utilities', 'Subscriptions & Services',
        'Insurance', 'Education', 'Personal Care', 'Gifts & Donations',
        'Pet', 'Income', 'Savings Transfer', 'Other',
    ];
    $stmt = $db->prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)');
    foreach ($categories as $name) {
        $stmt->execute([$user_id, $name]);
    }
}

function handleMe(PDO $db): void {
    if (empty($_SESSION['user_id'])) {
        json_error('Unauthenticated', 401);
    }
    $stmt = $db->prepare('SELECT id, email, display_name, email_verified FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user) {
        session_destroy();
        json_error('Unauthenticated', 401);
    }
    json_response([
        'id'             => (int)$user['id'],
        'email'          => $user['email'],
        'display_name'   => $user['display_name'],
        'email_verified' => (bool)$user['email_verified'],
    ]);
}

function handleLogin(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['email', 'password']);

    $email    = strtolower(trim($data['email']));
    $password = $data['password'];

    $stmt = $db->prepare('SELECT id, email, display_name, password_hash, email_verified FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        json_error('Invalid email or password', 401);
    }

    if (!$user['email_verified']) {
        json_error('Please verify your email address before signing in', 403);
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    $_SESSION['email']   = $user['email'];

    json_response([
        'id'             => (int)$user['id'],
        'email'          => $user['email'],
        'display_name'   => $user['display_name'],
        'email_verified' => true,
    ]);
}

function handleRegister(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['email', 'password']);

    $email        = strtolower(trim($data['email']));
    $password     = $data['password'];
    $display_name = trim($data['display_name'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_error('Invalid email address');
    }
    if (strlen($password) < 8) {
        json_error('Password must be at least 8 characters');
    }

    $check = $db->prepare('SELECT id FROM users WHERE email = ?');
    $check->execute([$email]);
    if ($check->fetch()) {
        json_error('An account with this email already exists');
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);

    $stmt = $db->prepare('INSERT INTO users (email, password_hash, display_name, email_verified) VALUES (?, ?, ?, 0)');
    $stmt->execute([$email, $hash, $display_name]);
    $user_id = (int)$db->lastInsertId();

    seed_default_categories($db, $user_id);

    $token   = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', strtotime('+24 hours'));
    $db->prepare('INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)')
       ->execute([$user_id, $token, $expires]);

    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $link = $scheme . '://' . $host . '/#verify-email?token=' . $token;

    Mailer::send($email, 'Verify your Money account', implode("\n\n", [
        'Welcome to Money' . ($display_name ? ', ' . $display_name : '') . '!',
        'Please verify your email address by clicking the link below:',
        $link,
        'This link expires in 24 hours.',
        'If you did not create this account, you can ignore this email.',
    ]));

    json_response(['message' => 'Account created. Check your email to verify your address.', 'needs_verification' => true], 201);
}

function handleLogout(): void {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    json_response(['message' => 'Logged out']);
}

function handleForgotPassword(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['email']);

    $email = strtolower(trim($data['email']));

    $stmt = $db->prepare('SELECT id FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if ($user) {
        // Clear any old tokens for this user first
        $db->prepare('DELETE FROM password_resets WHERE user_id = ?')->execute([$user['id']]);

        $token   = bin2hex(random_bytes(32));
        $expires = date('Y-m-d H:i:s', strtotime('+1 hour'));
        $db->prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)')
           ->execute([$user['id'], $token, $expires]);

        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $link = $scheme . '://' . $host . '/#reset-password?token=' . $token;

        Mailer::send($email, 'Reset your Money password', implode("\n\n", [
            'You requested a password reset for your Money account.',
            'Click the link below to set a new password:',
            $link,
            'This link expires in 1 hour.',
            'If you did not request this, you can safely ignore this email.',
        ]));
    }

    // Always return success to prevent user enumeration
    json_response(['message' => 'If that email is registered, you will receive a reset link shortly.']);
}

function handleResetPassword(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['token', 'password']);

    $token    = trim($data['token']);
    $password = $data['password'];

    if (strlen($password) < 8) {
        json_error('Password must be at least 8 characters');
    }

    $stmt = $db->prepare(
        'SELECT pr.user_id FROM password_resets pr
         WHERE pr.token = ? AND pr.expires_at > NOW()'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();

    if (!$row) {
        json_error('Invalid or expired reset link', 400);
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
       ->execute([$hash, $row['user_id']]);
    $db->prepare('DELETE FROM password_resets WHERE user_id = ?')
       ->execute([$row['user_id']]);

    json_response(['message' => 'Password updated. You can now sign in.']);
}

function handleVerifyEmail(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['token']);

    $token = trim($data['token']);

    $stmt = $db->prepare(
        'SELECT ev.user_id FROM email_verifications ev
         WHERE ev.token = ? AND ev.expires_at > NOW()'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch();

    if (!$row) {
        json_error('Invalid or expired verification link', 400);
    }

    $db->prepare('UPDATE users SET email_verified = 1 WHERE id = ?')
       ->execute([$row['user_id']]);
    $db->prepare('DELETE FROM email_verifications WHERE user_id = ?')
       ->execute([$row['user_id']]);

    json_response(['message' => 'Email verified. You can now sign in.']);
}
