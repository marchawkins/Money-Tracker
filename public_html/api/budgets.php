<?php
$db = get_db();

switch ($method) {
    case 'GET':
        handleList($db);
        break;
    case 'POST':
        if ($sub) json_error('Not found', 404);
        handleSave($db);
        break;
    case 'DELETE':
        if (!$sub || !is_numeric($sub)) json_error('Not found', 404);
        handleDelete($db, (int)$sub);
        break;
    default:
        json_error('Method not allowed', 405);
}

function budget_row(array $r): array {
    return [
        'id'              => (int)$r['id'],
        'category_id'     => (int)$r['category_id'],
        'category_name'   => $r['category_name'],
        'amount'          => (float)$r['amount'],
        'effective_month' => substr($r['effective_month'], 0, 7), // YYYY-MM
    ];
}

function handleList(PDO $db): void {
    $uid        = CURRENT_USER_ID;
    $monthParam = $_GET['month'] ?? date('Y-m');
    if (!preg_match('/^\d{4}-\d{2}$/', $monthParam)) {
        json_error('Invalid month format (YYYY-MM required)');
    }
    $monthDate = $monthParam . '-01';

    $stmt = $db->prepare("
        SELECT b.id, b.category_id, c.name AS category_name, b.amount, b.effective_month
        FROM budgets b
        INNER JOIN (
            SELECT category_id, MAX(effective_month) AS max_month
            FROM budgets
            WHERE user_id = ? AND effective_month <= ?
            GROUP BY category_id
        ) latest ON latest.category_id = b.category_id
                 AND latest.max_month  = b.effective_month
        JOIN categories c ON c.id = b.category_id AND c.deleted_at IS NULL
        WHERE b.user_id = ?
        ORDER BY c.name
    ");
    $stmt->execute([$uid, $monthDate, $uid]);

    json_response(['budgets' => array_map('budget_row', $stmt->fetchAll())]);
}

function handleSave(PDO $db): void {
    $uid  = CURRENT_USER_ID;
    $data = get_json_body();
    require_fields($data, ['category_id', 'amount', 'effective_month']);

    $categoryId      = (int)$data['category_id'];
    $amount          = (float)$data['amount'];
    $effectiveMonth  = trim($data['effective_month']);

    if ($amount < 0) json_error('Amount must be non-negative');
    if (!preg_match('/^\d{4}-\d{2}$/', $effectiveMonth)) {
        json_error('Invalid effective_month format (YYYY-MM required)');
    }
    $effectiveDate = $effectiveMonth . '-01';

    $chk = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $chk->execute([$categoryId, $uid]);
    if (!$chk->fetch()) json_error('Invalid category');

    // Upsert by (user_id, category_id, effective_month)
    $existing = $db->prepare('SELECT id FROM budgets WHERE user_id = ? AND category_id = ? AND effective_month = ?');
    $existing->execute([$uid, $categoryId, $effectiveDate]);
    $row = $existing->fetch();

    if ($row) {
        $db->prepare('UPDATE budgets SET amount = ? WHERE id = ?')->execute([$amount, $row['id']]);
        $id = (int)$row['id'];
    } else {
        $db->prepare('INSERT INTO budgets (user_id, category_id, amount, effective_month) VALUES (?, ?, ?, ?)')
           ->execute([$uid, $categoryId, $amount, $effectiveDate]);
        $id = (int)$db->lastInsertId();
    }

    $stmt = $db->prepare('
        SELECT b.id, b.category_id, c.name AS category_name, b.amount, b.effective_month
        FROM budgets b JOIN categories c ON c.id = b.category_id
        WHERE b.id = ?
    ');
    $stmt->execute([$id]);
    json_response(['budget' => budget_row($stmt->fetch())], 201);
}

function handleDelete(PDO $db, int $id): void {
    $uid  = CURRENT_USER_ID;
    $stmt = $db->prepare('SELECT id FROM budgets WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $uid]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $db->prepare('DELETE FROM budgets WHERE id = ?')->execute([$id]);
    json_response(['message' => 'Budget deleted']);
}
