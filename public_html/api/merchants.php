<?php
$db = get_db();

switch ($method) {
    case 'GET':
        if ($sub === 'autocomplete') { handleAutocomplete($db); break; }
        if (!$sub)                   { handleList($db);         break; }
        json_error('Not found', 404);
        break;
    case 'POST':
        if (!$sub) { handleCreate($db); break; }
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
        SELECT mc.id, mc.merchant_normalized, mc.match_type, mc.match_pattern,
               mc.category_id, c.name AS category_name
        FROM merchant_categories mc
        LEFT JOIN categories c ON c.id = mc.category_id AND c.deleted_at IS NULL
        WHERE mc.user_id = ?
        ORDER BY mc.match_type ASC, mc.merchant_normalized ASC
    ');
    $stmt->execute([CURRENT_USER_ID]);
    $rows = $stmt->fetchAll();
    json_response([
        'merchants' => array_map(fn($r) => [
            'id'            => (int)$r['id'],
            'merchant'      => $r['merchant_normalized'],
            'match_type'    => $r['match_type'],
            'match_pattern' => $r['match_pattern'],
            'category_id'   => $r['category_id'] !== null ? (int)$r['category_id'] : null,
            'category_name' => $r['category_name'],
        ], $rows),
    ]);
}

/**
 * Create a prefix or regex pattern rule.
 *
 * Exact-match rules are created automatically by the import pipeline (handleConfirm)
 * whenever the user confirms a categorization. This endpoint is only for pattern rules
 * that require human intent — "starts with" or regex.
 *
 * Request body:
 *   {
 *     "label":         "bmw bank - car payment",   // human-readable name, becomes merchant_normalized
 *     "match_type":    "prefix" | "regex",
 *     "match_pattern": "bmw bank bmwfs",            // prefix string or PCRE pattern (no delimiters)
 *     "category_id":   42
 *   }
 */
function handleCreate(PDO $db): void {
    $uid  = CURRENT_USER_ID;
    $data = get_json_body();
    require_fields($data, ['label', 'match_type', 'match_pattern', 'category_id']);

    $label      = trim($data['label'] ?? '');
    $matchType  = trim($data['match_type'] ?? '');
    $pattern    = strtolower(trim($data['match_pattern'] ?? ''));
    $categoryId = (int)($data['category_id'] ?? 0);

    if (!in_array($matchType, ['prefix', 'regex'], true)) {
        json_error('match_type must be "prefix" or "regex"');
    }
    if ($label === '') json_error('label is required');
    if ($pattern === '') json_error('match_pattern is required');

    // Validate regex pattern before storing
    if ($matchType === 'regex' && @preg_match('/' . $pattern . '/i', '') === false) {
        json_error('Invalid regex pattern — check syntax (do not include delimiters)');
    }

    // Validate category ownership
    $chk = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $chk->execute([$categoryId, $uid]);
    if (!$chk->fetch()) json_error('Invalid category');

    // Normalize label to use as the unique merchant_normalized key
    $labelNorm = strtolower(trim(preg_replace('/\s+/', ' ', $label)));
    if ($labelNorm === '') json_error('label cannot be blank after normalization');

    $stmt = $db->prepare('
        INSERT INTO merchant_categories (user_id, merchant_normalized, match_type, match_pattern, category_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            match_type    = VALUES(match_type),
            match_pattern = VALUES(match_pattern),
            category_id   = VALUES(category_id),
            updated_at    = NOW()
    ');
    $stmt->execute([$uid, $labelNorm, $matchType, $pattern, $categoryId]);

    json_response([
        'message' => 'Pattern rule created',
        'id'      => (int)$db->lastInsertId(),
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
        SELECT mc.id, mc.merchant_normalized, mc.match_type, mc.match_pattern,
               mc.category_id, c.name AS category_name
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
            'match_type'    => $r['match_type'],
            'match_pattern' => $r['match_pattern'],
            'category_id'   => $r['category_id'] !== null ? (int)$r['category_id'] : null,
            'category_name' => $r['category_name'],
        ], $rows),
    ]);
}

/**
 * Update the category (and optionally the pattern) for an existing rule.
 *
 * For exact rules, only category_id can be changed.
 * For prefix/regex rules, match_pattern can also be updated.
 *
 * Request body:
 *   { "category_id": 42 }                              -- any rule type
 *   { "category_id": 42, "match_pattern": "new pat" }  -- prefix/regex only
 */
function handleUpdate(PDO $db, int $id): void {
    $uid  = CURRENT_USER_ID;
    $data = get_json_body();
    require_fields($data, ['category_id']);

    $stmt = $db->prepare('SELECT id, match_type FROM merchant_categories WHERE id = ? AND user_id = ?');
    $stmt->execute([$id, $uid]);
    $existing = $stmt->fetch();
    if (!$existing) json_error('Not found', 404);

    $categoryId = (int)$data['category_id'];
    $chk = $db->prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    $chk->execute([$categoryId, $uid]);
    if (!$chk->fetch()) json_error('Invalid category');

    // Allow updating match_pattern for prefix/regex rules
    $newPattern = null;
    if (isset($data['match_pattern']) && in_array($existing['match_type'], ['prefix', 'regex'], true)) {
        $newPattern = strtolower(trim($data['match_pattern']));
        if ($newPattern === '') json_error('match_pattern cannot be empty');
        if ($existing['match_type'] === 'regex' && @preg_match('/' . $newPattern . '/i', '') === false) {
            json_error('Invalid regex pattern — check syntax (do not include delimiters)');
        }
    }

    if ($newPattern !== null) {
        $db->prepare('UPDATE merchant_categories SET category_id = ?, match_pattern = ?, updated_at = NOW() WHERE id = ?')
           ->execute([$categoryId, $newPattern, $id]);
    } else {
        $db->prepare('UPDATE merchant_categories SET category_id = ?, updated_at = NOW() WHERE id = ?')
           ->execute([$categoryId, $id]);
    }

    json_response(['message' => 'Merchant mapping updated']);
}
