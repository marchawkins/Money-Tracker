<?php
function json_response(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function json_success(array $data = [], int $status = 200): void {
    json_response(array_merge(['success' => true], $data), $status);
}

function json_error(string $message, int $status = 400): void {
    json_response(['success' => false, 'error' => $message], $status);
}

function require_auth(): void {
    if (empty($_SESSION['user_id'])) {
        json_error('Unauthenticated', 401);
    }
}

function get_json_body(): array {
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function require_fields(array $data, array $fields): void {
    foreach ($fields as $field) {
        if (!array_key_exists($field, $data) || $data[$field] === '' || $data[$field] === null) {
            json_error("Missing required field: {$field}");
        }
    }
}
