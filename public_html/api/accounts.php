<?php
$db = get_db();

switch ($method) {
    case 'GET':
        handleList($db);
        break;
    case 'POST':
        if ($sub) json_error('Not found', 404);
        handleCreate($db);
        break;
    case 'PUT':
        if (!$sub || !is_numeric($sub)) json_error('Not found', 404);
        handleUpdate($db, (int)$sub);
        break;
    default:
        json_error('Method not allowed', 405);
}

function handleList(PDO $db): void {
    $stmt = $db->prepare('SELECT id, name, type FROM accounts WHERE user_id = ? ORDER BY name ASC');
    $stmt->execute([CURRENT_USER_ID]);
    $rows = $stmt->fetchAll();
    json_response([
        'accounts' => array_map(fn($r) => [
            'id'   => (int)$r['id'],
            'name' => $r['name'],
            'type' => $r['type'],
        ], $rows),
    ]);
}

function handleCreate(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['name', 'type']);
    $name = trim($data['name']);
    $type = $data['type'];
    if ($name === '' || strlen($name) > 100) json_error('Invalid name');
    if (!in_array($type, ['checking','savings','credit'], true)) json_error('Invalid type');

    $db->prepare('INSERT INTO accounts (user_id, name, type) VALUES (?, ?, ?)')->execute([CURRENT_USER_ID, $name, $type]);
    $id = (int)$db->lastInsertId();
    json_response(['account' => ['id' => $id, 'name' => $name, 'type' => $type]], 201);
}

function handleUpdate(PDO $db, int $id): void {
    $data = get_json_body();
    $stmt = $db->prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, CURRENT_USER_ID]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $fields = [];
    $values = [];
    if (array_key_exists('name', $data)) {
        $name = trim($data['name']);
        if ($name === '' || strlen($name) > 100) json_error('Invalid name');
        $fields[] = 'name = ?'; $values[] = $name;
    }
    if (array_key_exists('type', $data)) {
        if (!in_array($data['type'], ['checking','savings','credit'], true)) json_error('Invalid type');
        $fields[] = 'type = ?'; $values[] = $data['type'];
    }
    if (empty($fields)) json_error('No fields to update');

    $values[] = $id;
    $db->prepare('UPDATE accounts SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);

    $stmt = $db->prepare('SELECT id, name, type FROM accounts WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    json_response(['account' => ['id' => (int)$row['id'], 'name' => $row['name'], 'type' => $row['type']]]);
}
