<?php
require_once __DIR__ . '/helpers/mailer.php';

$db = get_db();

switch ($method) {
    case 'GET':
        if (!$sub) { handleGet($db); break; }
        json_error('Not found', 404);
        break;
    case 'PUT':
        if ($sub === 'password') { handleChangePassword($db); break; }
        if (!$sub)               { handleUpdate($db);         break; }
        json_error('Not found', 404);
        break;
    default:
        json_error('Method not allowed', 405);
}

function handleGet(PDO $db): void {
    $stmt = $db->prepare('SELECT id, email, display_name, email_verified FROM users WHERE id = ?');
    $stmt->execute([CURRENT_USER_ID]);
    $user = $stmt->fetch();
    json_response([
        'id'             => (int)$user['id'],
        'email'          => $user['email'],
        'display_name'   => $user['display_name'],
        'email_verified' => (bool)$user['email_verified'],
    ]);
}

function handleUpdate(PDO $db): void {
    $data   = get_json_body();
    $uid    = CURRENT_USER_ID;
    $fields = [];
    $values = [];

    if (array_key_exists('display_name', $data)) {
        $name = trim($data['display_name']);
        if (strlen($name) > 100) json_error('Display name is too long');
        $fields[] = 'display_name = ?';
        $values[] = $name;
    }

    $emailChanged = false;
    if (array_key_exists('email', $data)) {
        $email = strtolower(trim($data['email']));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json_error('Invalid email address');

        $chk = $db->prepare('SELECT id FROM users WHERE email = ? AND id != ?');
        $chk->execute([$email, $uid]);
        if ($chk->fetch()) json_error('An account with this email already exists');

        $fields[]     = 'email = ?';
        $fields[]     = 'email_verified = 0';
        $values[]     = $email;
        $emailChanged = true;
    }

    if (empty($fields)) json_error('No fields to update');

    $values[] = $uid;
    $db->prepare('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);

    if ($emailChanged) {
        $db->prepare('DELETE FROM email_verifications WHERE user_id = ?')->execute([$uid]);
        $token   = bin2hex(random_bytes(32));
        $expires = date('Y-m-d H:i:s', strtotime('+24 hours'));
        $db->prepare('INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)')
           ->execute([$uid, $token, $expires]);

        $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $link   = $scheme . '://' . $host . '/#verify-email?token=' . $token;

        Mailer::send($email, 'Verify your new email address', implode("\n\n", [
            'Your Money account email address was changed.',
            'Please verify your new address by clicking the link below:',
            $link,
            'This link expires in 24 hours.',
            'If you did not make this change, please reset your password immediately.',
        ]));
    }

    $stmt = $db->prepare('SELECT id, email, display_name, email_verified FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $user = $stmt->fetch();

    json_response([
        'user' => [
            'id'             => (int)$user['id'],
            'email'          => $user['email'],
            'display_name'   => $user['display_name'],
            'email_verified' => (bool)$user['email_verified'],
        ],
        'email_verification_sent' => $emailChanged,
    ]);
}

function handleChangePassword(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['current_password', 'new_password']);

    $uid  = CURRENT_USER_ID;
    $stmt = $db->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $user = $stmt->fetch();

    if (!password_verify($data['current_password'], $user['password_hash'])) {
        json_error('Current password is incorrect', 403);
    }
    if (strlen($data['new_password']) < 8) {
        json_error('New password must be at least 8 characters');
    }

    $hash = password_hash($data['new_password'], PASSWORD_BCRYPT);
    $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$hash, $uid]);

    json_response(['message' => 'Password updated successfully']);
}
