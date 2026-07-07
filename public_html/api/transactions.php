<?php
$db = get_db();

switch ($method) {
    case 'GET':
        if ($sub && is_numeric($sub)) { handleGetOne($db, (int)$sub); break; }
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

function normalize_merchant(string $name): string {
    return strtolower(trim(preg_replace('/\s+/', ' ', $name)));
}

function upsert_merchant_category(PDO $db, int $user_id, string $merchant, int $category_id): void {
    $norm = normalize_merchant($merchant);
    if ($norm === '') return;
    $db->prepare(
        'INSERT INTO merchant_categories (user_id, merchant_normalized, category_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), updated_at = NOW()'
    )->execute([$user_id, $norm, $category_id]);
}

function transaction_row(array $r): array {
    return [
        'id'            => (int)$r['id'],
        'account_id'    => isset($r['account_id'])  && $r['account_id']  !== null ? (int)$r['account_id']  : null,
        'account_name'  => $r['account_name']  ?? null,
        'category_id'   => isset($r['category_id']) && $r['category_id'] !== null ? (int)$r['category_id'] : null,
        'category_name' => $r['category_name'] ?? null,
        'merchant'      => $r['merchant'],
        'amount'        => (float)$r['amount'],
        'type'          => $r['type'],
        'date'          => $r['date'],
        'notes'         => $r['notes'],
        'source'        => $r['source'],
        'created_at'    => $r['created_at'],
    ];
}

function fetch_with_joins(PDO $db, int $id): ?array {
    $stmt = $db->prepare('
        SELECT t.*, a.name AS account_name, c.name AS category_name
        FROM transactions t
        LEFT JOIN accounts    a ON a.id = t.account_id
        LEFT JOIN categories  c ON c.id = t.category_id
        WHERE t.id = ?
    ');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

function build_where(array &$values): string {
    $uid    = CURRENT_USER_ID;
    $where  = ['t.user_id = ?', 't.deleted_at IS NULL'];
    $values = [$uid];

    if (!empty($_GET['account_id']) && is_numeric($_GET['account_id'])) {
        $where[] = 't.account_id = ?';
        $values[] = (int)$_GET['account_id'];
    }
    if (!empty($_GET['category_id']) && is_numeric($_GET['category_id'])) {
        $where[] = 't.category_id = ?';
        $values[] = (int)$_GET['category_id'];
    }
    if (!empty($_GET['type']) && in_array($_GET['type'], ['expense','income','transfer'], true)) {
        $where[] = 't.type = ?';
        $values[] = $_GET['type'];
    }
    if (!empty($_GET['start'])) {
        $where[] = 't.date >= ?';
        $values[] = $_GET['start'];
    }
    if (!empty($_GET['end'])) {
        $where[] = 't.date <= ?';
        $values[] = $_GET['end'];
    }
    if (!empty($_GET['q'])) {
        $where[] = 't.merchant LIKE ?';
        $values[] = '%' . $_GET['q'] . '%';
    }
    return implode(' AND ', $where);
}

function handleList(PDO $db): void {
    $values      = [];
    $where_clause = build_where($values);
    $limit        = min(max((int)($_GET['limit']  ?? 25), 1), 200);
    $offset       = max((int)($_GET['offset'] ?? 0), 0);

    // Totals + count in one query (no LIMIT)
    $agg = $db->prepare("
        SELECT COUNT(*) AS total_count,
               COALESCE(SUM(CASE WHEN t.type='income'   THEN t.amount ELSE 0 END), 0) AS income_total,
               COALESCE(SUM(CASE WHEN t.type='expense'  THEN t.amount ELSE 0 END), 0) AS expense_total,
               COALESCE(SUM(CASE WHEN t.type='transfer' THEN t.amount ELSE 0 END), 0) AS transfer_total
        FROM transactions t
        WHERE $where_clause
    ");
    $agg->execute($values);
    $agg_row = $agg->fetch();

    // Paged rows
    $stmt = $db->prepare("
        SELECT t.*, a.name AS account_name, c.name AS category_name
        FROM transactions t
        LEFT JOIN accounts    a ON a.id = t.account_id
        LEFT JOIN categories  c ON c.id = t.category_id
        WHERE $where_clause
        ORDER BY t.date DESC, t.created_at DESC
        LIMIT ? OFFSET ?
    ");
    $stmt->execute(array_merge($values, [$limit, $offset]));
    $rows = $stmt->fetchAll();

    json_response([
        'transactions'   => array_map('transaction_row', $rows),
        'total'          => (int)$agg_row['total_count'],
        'limit'          => $limit,
        'offset'         => $offset,
        'income_total'   => (float)$agg_row['income_total'],
        'expense_total'  => (float)$agg_row['expense_total'],
        'transfer_total' => (float)$agg_row['transfer_total'],
    ]);
}

function handleGetOne(PDO $db, int $id): void {
    $uid  = CURRENT_USER_ID;
    $stmt = $db->prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $stmt->execute([$id, $uid]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $row = fetch_with_joins($db, $id);
    json_response(['transaction' => transaction_row($row)]);
}

function handleCreate(PDO $db): void {
    $uid  = CURRENT_USER_ID;
    $data = get_json_body();
    require_fields($data, ['amount', 'type', 'date']);

    $type   = $data['type'];
    $amount = (float)$data['amount'];
    $date   = trim($data['date'] ?? '');

    if (!in_array($type, ['expense','income','transfer'], true)) json_error('Invalid type');
    if ($amount <= 0) json_error('Amount must be greater than zero');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) json_error('Invalid date format (YYYY-MM-DD required)');

    $account_id  = isset($data['account_id'])  && $data['account_id']  !== null ? (int)$data['account_id']  : null;
    $category_id = isset($data['category_id']) && $data['category_id'] !== null ? (int)$data['category_id'] : null;
    $merchant    = trim($data['merchant'] ?? '');
    $notes       = trim($data['notes'] ?? '') ?: null;

    if ($account_id) {
        $chk = $db->prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?');
        $chk->execute([$account_id, $uid]);
        if (!$chk->fetch()) json_error('Invalid account');
    }
    if ($category_id) {
        $chk = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
        $chk->execute([$category_id, $uid]);
        if (!$chk->fetch()) json_error('Invalid category');
    }

    $db->prepare('
        INSERT INTO transactions (user_id, account_id, category_id, merchant, amount, type, date, notes, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, "manual")
    ')->execute([$uid, $account_id, $category_id, $merchant, $amount, $type, $date, $notes]);
    $id = (int)$db->lastInsertId();

    if ($merchant && $category_id) {
        upsert_merchant_category($db, $uid, $merchant, $category_id);
    }

    $row = fetch_with_joins($db, $id);
    json_response(['transaction' => transaction_row($row)], 201);
}

function handleUpdate(PDO $db, int $id): void {
    $uid  = CURRENT_USER_ID;
    $data = get_json_body();

    $stmt = $db->prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $stmt->execute([$id, $uid]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $fields = [];
    $values = [];

    if (array_key_exists('amount', $data)) {
        $amount = (float)$data['amount'];
        if ($amount <= 0) json_error('Amount must be greater than zero');
        $fields[] = 'amount = ?'; $values[] = $amount;
    }
    if (array_key_exists('type', $data)) {
        if (!in_array($data['type'], ['expense','income','transfer'], true)) json_error('Invalid type');
        $fields[] = 'type = ?'; $values[] = $data['type'];
    }
    if (array_key_exists('date', $data)) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $data['date'])) json_error('Invalid date format');
        $fields[] = 'date = ?'; $values[] = $data['date'];
    }
    if (array_key_exists('merchant', $data)) {
        $fields[] = 'merchant = ?'; $values[] = trim($data['merchant']);
    }
    if (array_key_exists('account_id', $data)) {
        $account_id = $data['account_id'] !== null ? (int)$data['account_id'] : null;
        if ($account_id) {
            $chk = $db->prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?');
            $chk->execute([$account_id, $uid]);
            if (!$chk->fetch()) json_error('Invalid account');
        }
        $fields[] = 'account_id = ?'; $values[] = $account_id;
    }
    if (array_key_exists('category_id', $data)) {
        $category_id = $data['category_id'] !== null ? (int)$data['category_id'] : null;
        if ($category_id) {
            $chk = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
            $chk->execute([$category_id, $uid]);
            if (!$chk->fetch()) json_error('Invalid category');
        }
        $fields[] = 'category_id = ?'; $values[] = $category_id;
    }
    if (array_key_exists('notes', $data)) {
        $fields[] = 'notes = ?'; $values[] = isset($data['notes']) ? (trim($data['notes']) ?: null) : null;
    }

    if (empty($fields)) json_error('No fields to update');

    $values[] = $id;
    $db->prepare('UPDATE transactions SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);

    // Upsert merchant memory from final state
    $cur = $db->prepare('SELECT merchant, category_id FROM transactions WHERE id = ?');
    $cur->execute([$id]);
    $final = $cur->fetch();
    if ($final['merchant'] && $final['category_id']) {
        upsert_merchant_category($db, $uid, $final['merchant'], (int)$final['category_id']);
    }

    $row = fetch_with_joins($db, $id);
    json_response(['transaction' => transaction_row($row)]);
}

function handleDelete(PDO $db, int $id): void {
    $uid  = CURRENT_USER_ID;
    $stmt = $db->prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $stmt->execute([$id, $uid]);
    if (!$stmt->fetch()) json_error('Not found', 404);

    $db->prepare('UPDATE transactions SET deleted_at = NOW() WHERE id = ?')->execute([$id]);
    json_response(['message' => 'Transaction deleted']);
}
