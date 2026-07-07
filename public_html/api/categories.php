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
    case 'DELETE':
        if (!$sub || !is_numeric($sub)) json_error('Not found', 404);
        handleDelete($db, (int)$sub);
        break;
    default:
        json_error('Method not allowed', 405);
}

function handleList(PDO $db): void {
    $stmt = $db->prepare(
        'SELECT c.id, c.name,
                COUNT(t.id) AS transaction_count
         FROM categories c
         LEFT JOIN transactions t ON t.category_id = c.id AND t.deleted_at IS NULL
         WHERE c.user_id = ? AND c.deleted_at IS NULL
         GROUP BY c.id, c.name
         ORDER BY c.name ASC'
    );
    $stmt->execute([CURRENT_USER_ID]);
    $rows = $stmt->fetchAll();
    json_response([
        'categories' => array_map(fn($r) => [
            'id'                => (int)$r['id'],
            'name'              => $r['name'],
            'transaction_count' => (int)$r['transaction_count'],
        ], $rows),
    ]);
}

function handleCreate(PDO $db): void {
    $data = get_json_body();
    require_fields($data, ['name']);
    $name = trim($data['name']);
    if ($name === '')       json_error('Name cannot be empty');
    if (strlen($name) > 100) json_error('Name is too long');

    $db->prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)')->execute([CURRENT_USER_ID, $name]);
    $id = (int)$db->lastInsertId();
    json_response(['category' => ['id' => $id, 'name' => $name]], 201);
}

function handleUpdate(PDO $db, int $id): void {
    $data = get_json_body();
    require_fields($data, ['name']);
    $name = trim($data['name']);
    if ($name === '') json_error('Name cannot be empty');

    $stmt = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $stmt->execute([$id, CURRENT_USER_ID]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $db->prepare('UPDATE categories SET name = ? WHERE id = ?')->execute([$name, $id]);
    json_response(['category' => ['id' => $id, 'name' => $name]]);
}

function handleDelete(PDO $db, int $id): void {
    $stmt = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $stmt->execute([$id, CURRENT_USER_ID]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $count = $db->prepare('SELECT COUNT(*) FROM transactions WHERE category_id = ? AND deleted_at IS NULL');
    $count->execute([$id]);
    if ((int)$count->fetchColumn() > 0) {
        json_error('Cannot delete a category that has transactions', 409);
    }

    $db->prepare('UPDATE categories SET deleted_at = NOW() WHERE id = ?')->execute([$id]);
    json_response(['message' => 'Category deleted']);
}
