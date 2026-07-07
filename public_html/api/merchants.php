<?php
$db = get_db();

switch ($method) {
    case 'GET':
        if ($sub === 'autocomplete') { handleAutocomplete($db); break; }
        if (!$sub)                   { handleList($db);         break; }
        json_error('Not found', 404);
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
    $stmt = $db->prepare('
        SELECT mc.id, mc.merchant_normalized, mc.category_id, c.name AS category_name
        FROM merchant_categories mc
        LEFT JOIN categories c ON c.id = mc.category_id AND c.deleted_at IS NULL
        WHERE mc.user_id = ?
        ORDER BY mc.merchant_normalized ASC
    ');
    $stmt->execute([CURRENT_USER_ID]);
    $rows = $stmt->fetchAll();
    json_response([
        'merchants' => array_map(fn($r) => [
            'id'            => (int)$r['id'],
            'merchant'      => $r['merchant_normalized'],
            'category_id'   => $r['category_id'] !== null ? (int)$r['category_id'] : null,
            'category_name' => $r['category_name'],
        ], $rows),
    ]);
}

function handleDelete(PDO $db, int $id): void {
    $stmt = $db->prepare('SELECT id FROM merchant_categories WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, CURRENT_USER_ID]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $db->prepare('DELETE FROM merchant_categories WHERE id = ?')->execute([$id]);
    json_response(['message' => 'Merchant mapping deleted']);
}

function handleAutocomplete(PDO $db): void {
    $q = trim($_GET['q'] ?? '');
    if ($q === '') {
        json_response(['suggestions' => []]);
        return;
    }
    $like = '%' . strtolower($q) . '%';
    $stmt = $db->prepare('
        SELECT mc.id, mc.merchant_normalized, mc.category_id, c.name AS category_name
        FROM merchant_categories mc
        LEFT JOIN categories c ON c.id = mc.category_id AND c.deleted_at IS NULL
        WHERE mc.user_id = ? AND mc.merchant_normalized LIKE ?
        ORDER BY mc.updated_at DESC
        LIMIT 10
    ');
    $stmt->execute([CURRENT_USER_ID, $like]);
    $rows = $stmt->fetchAll();
    json_response([
        'suggestions' => array_map(fn($r) => [
            'id'            => (int)$r['id'],
            'merchant'      => $r['merchant_normalized'],
            'category_id'   => $r['category_id'] !== null ? (int)$r['category_id'] : null,
            'category_name' => $r['category_name'],
        ], $rows),
    ]);
}

function handleUpdate(PDO $db, int $id): void {
    $data = get_json_body();
    require_fields($data, ['category_id']);

    $stmt = $db->prepare('SELECT id FROM merchant_categories WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, CURRENT_USER_ID]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $category_id = (int)$data['category_id'];
    $chk = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $chk->execute([$category_id, CURRENT_USER_ID]);
    if (!$chk->fetch()) json_error('Invalid category');

    $db->prepare('UPDATE merchant_categories SET category_id = ?, updated_at = NOW() WHERE id = ?')
       ->execute([$category_id, $id]);
    json_response(['message' => 'Merchant mapping updated']);
}
