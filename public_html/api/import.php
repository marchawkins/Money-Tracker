<?php
$db = get_db();

switch ($method) {
    case 'GET':
        if ($sub === 'log') { handleLog($db); break; }
        json_error('Not found', 404);
        break;
    case 'POST':
        if ($sub === 'preview') { handlePreview($db); break; }
        if ($sub === 'confirm') { handleConfirm($db); break; }
        json_error('Not found', 404);
        break;
    default:
        json_error('Method not allowed', 405);
}

/* ── preview ──────────────────────────────────────────────── */

function handlePreview(PDO $db): void {
    $uid = CURRENT_USER_ID;

    // Validate file upload
    $file = $_FILES['file'] ?? null;
    if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
        $errMsg = match($file['error'] ?? -1) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'File is too large',
            UPLOAD_ERR_NO_FILE  => 'No file was uploaded',
            default             => 'File upload failed (error ' . ($file['error'] ?? 'unknown') . ')',
        };
        json_error($errMsg);
    }
    if (!is_uploaded_file($file['tmp_name'])) {
        json_error('Invalid file upload');
    }

    // Validate account ownership
    $accountId = (int)($_POST['account_id'] ?? 0);
    if ($accountId <= 0) json_error('Account is required');
    $chk = $db->prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?');
    $chk->execute([$accountId, $uid]);
    if (!$chk->fetch()) json_error('Invalid account');

    // Load merchant→category lookup once (returns ['exact'=>..., 'patterns'=>...])
    $map = load_merchant_map($db, $uid);

    // Load categories by name for CSV category matching
    $categoryByName = load_categories_by_name($db, $uid);

    // Load existing transactions for duplicate detection
    $existingSet = load_existing_set($db, $uid, $accountId);

    // Parse CSV
    $handle = fopen($file['tmp_name'], 'r');
    if (!$handle) json_error('Could not read uploaded file');

    $rawHeaders = fgetcsv($handle);
    if (!$rawHeaders) {
        fclose($handle);
        json_error('File appears empty or is not a valid CSV');
    }

    // Strip UTF-8 BOM from first header if present
    $rawHeaders[0] = ltrim($rawHeaders[0], "\xEF\xBB\xBF");

    $format = detect_format($rawHeaders);

    if ($format === 'unknown') {
        fclose($handle);
        json_response([
            'format'           => 'unknown',
            'detected_columns' => array_map('trim', $rawHeaders),
            'rows'             => [],
            'total_rows'       => 0,
        ]);
        return;
    }

    $rows = [];
    $idx  = 0;
    while (($cols = fgetcsv($handle)) !== false) {
        // Skip rows that are all empty
        if (count(array_filter($cols, fn($v) => trim($v) !== '')) === 0) {
            $idx++;
            continue;
        }
        // Build associative map: lowercase header → value
        $colMap = [];
        foreach ($rawHeaders as $i => $h) {
            $colMap[strtolower(trim($h))] = trim($cols[$i] ?? '');
        }

        $normalized = normalize_row($colMap, $format);
        if (!$normalized) { $idx++; continue; }

        ['date' => $date, 'merchant' => $merchant, 'amount' => $amount, 'suggested_type' => $suggestedType, 'csv_category' => $csvCategory] = $normalized + ['csv_category' => null];

        // Transfer/income keyword overrides
        $isTransferFlag = ($suggestedType === 'transfer') || is_transfer_keyword($merchant);
        if ($isTransferFlag) {
            $suggestedType = 'transfer';
        } elseif ($suggestedType !== 'income' && is_income_keyword($merchant)) {
            $suggestedType = 'income';
        }

        // Clean the merchant name (strip bank-feed noise)
        $merchantClean     = clean_merchant($merchant);
        $merchantCleanNorm = strtolower(trim(preg_replace('/\s+/', ' ', $merchantClean)));

        // ── Categorization: three-pass lookup ──────────────────────────────

        $suggestedCategoryId   = null;
        $suggestedCategoryName = null;

        // Pass 1: exact match on cleaned, normalized merchant
        if (isset($map['exact'][$merchantCleanNorm])) {
            $suggestedCategoryId   = $map['exact'][$merchantCleanNorm]['category_id'];
            $suggestedCategoryName = $map['exact'][$merchantCleanNorm]['category_name'];
        }

        // Pass 2: prefix / regex pattern rules
        if ($suggestedCategoryId === null) {
            foreach ($map['patterns'] as $rule) {
                $hit = false;
                if ($rule['type'] === 'prefix') {
                    $hit = str_starts_with($merchantCleanNorm, $rule['pattern']);
                } elseif ($rule['type'] === 'regex') {
                    // Suppress error on malformed pattern; treat as no-match
                    $hit = @preg_match('/' . $rule['pattern'] . '/i', $merchantCleanNorm) === 1;
                }
                if ($hit) {
                    $suggestedCategoryId   = $rule['category_id'];
                    $suggestedCategoryName = $rule['category_name'];
                    break;
                }
            }
        }

        // Pass 3: fuzzy substring / shared-prefix fallback (exact map only)
        if ($suggestedCategoryId === null) {
            $bestLen   = 0;
            $bestMatch = null;
            foreach ($map['exact'] as $stored => $cat) {
                $storedLen  = strlen($stored);
                $currentLen = strlen($merchantCleanNorm);
                if ($storedLen < 5) continue;

                // 3a. Stored name is a substring of the current merchant
                if (str_contains($merchantCleanNorm, $stored) && $storedLen > $bestLen) {
                    $bestLen   = $storedLen;
                    $bestMatch = $cat;
                    continue;
                }

                // 3b. Current merchant is a substring of the stored name
                if ($currentLen >= 5 && str_contains($stored, $merchantCleanNorm) && $currentLen > $bestLen) {
                    $bestLen   = $currentLen;
                    $bestMatch = $cat;
                    continue;
                }

                // 3c. Shared prefix of at least 10 chars (catches "STARBUCKS #1234" vs "STARBUCKS #5678")
                $prefixLen = 10;
                if ($storedLen >= $prefixLen && $currentLen >= $prefixLen &&
                    substr($stored, 0, $prefixLen) === substr($merchantCleanNorm, 0, $prefixLen) &&
                    $prefixLen > $bestLen) {
                    $bestLen   = $prefixLen;
                    $bestMatch = $cat;
                }
            }
            if ($bestMatch) {
                $suggestedCategoryId   = $bestMatch['category_id'];
                $suggestedCategoryName = $bestMatch['category_name'];
            }
        }

        // Pass 4: fall back to CSV category column
        if ($suggestedCategoryId === null && $csvCategory !== null) {
            $csvCatNorm = strtolower(trim($csvCategory));
            if (isset($categoryByName[$csvCatNorm])) {
                $suggestedCategoryId   = $categoryByName[$csvCatNorm]['id'];
                $suggestedCategoryName = $categoryByName[$csvCatNorm]['name'];
            }
        }

        // Duplicate detection — keyed on cleaned merchant so "same merchant,
        // different card-number suffix" doesn't slip through as two separate rows
        $dupKey      = $date . '|' . number_format($amount, 2) . '|' . $merchantCleanNorm;
        $isDuplicate = isset($existingSet[$dupKey]);

        $rawStr = implode(',', array_map(fn($v) => '"' . str_replace('"', '""', $v) . '"', $cols));

        $rows[] = [
            'row_index'               => $idx,
            'date'                    => $date,
            'merchant'                => $merchant,
            'merchant_clean'          => $merchantClean,
            'amount'                  => $amount,
            'suggested_type'          => $suggestedType,
            'suggested_category_id'   => $suggestedCategoryId,
            'suggested_category_name' => $suggestedCategoryName,
            'is_transfer_flag'        => $isTransferFlag,
            'is_duplicate_flag'       => $isDuplicate,
            'raw_row'                 => $rawStr,
        ];
        $idx++;
    }
    fclose($handle);

    json_response([
        'format'     => $format,
        'account_id' => $accountId,
        'total_rows' => count($rows),
        'rows'       => $rows,
    ]);
}

/* ── confirm ──────────────────────────────────────────────── */

function handleConfirm(PDO $db): void {
    $uid  = CURRENT_USER_ID;
    $data = get_json_body();

    if (!is_array($data) || empty($data)) {
        json_error('No transactions to import');
    }

    // Batch-validate account IDs
    $acctIds = array_values(array_unique(array_filter(array_map(
        fn($r) => isset($r['account_id']) ? (int)$r['account_id'] : 0,
        $data
    ))));
    if (!empty($acctIds)) {
        $ph   = implode(',', array_fill(0, count($acctIds), '?'));
        $stmt = $db->prepare("SELECT id FROM accounts WHERE id IN ($ph) AND user_id = ?");
        $stmt->execute(array_merge($acctIds, [$uid]));
        $validAccts = array_fill_keys(array_column($stmt->fetchAll(), 'id'), true);
        foreach ($acctIds as $id) {
            if (!isset($validAccts[$id])) json_error('Invalid account in import data');
        }
    }

    // Batch-validate category IDs
    $catIds = array_values(array_unique(array_filter(array_map(
        fn($r) => isset($r['category_id']) && $r['category_id'] ? (int)$r['category_id'] : 0,
        $data
    ))));
    if (!empty($catIds)) {
        $ph   = implode(',', array_fill(0, count($catIds), '?'));
        $stmt = $db->prepare("SELECT id FROM categories WHERE id IN ($ph) AND user_id = ? AND deleted_at IS NULL");
        $stmt->execute(array_merge($catIds, [$uid]));
        $validCats = array_fill_keys(array_column($stmt->fetchAll(), 'id'), true);
        foreach ($catIds as $id) {
            if (!isset($validCats[$id])) json_error('Invalid category in import data');
        }
    }

    $insertStmt = $db->prepare('
        INSERT INTO transactions (user_id, account_id, category_id, merchant, merchant_clean, amount, type, date, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, "import")
    ');
    // Upsert key is the *cleaned* normalized merchant so the exact-match table
    // stays clean and future imports match correctly
    $merchantUpsert = $db->prepare('
        INSERT INTO merchant_categories (user_id, merchant_normalized, match_type, match_pattern, category_id)
        VALUES (?, ?, "exact", NULL, ?)
        ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), updated_at = NOW()
    ');

    $imported = 0;
    $errors   = 0;

    $db->beginTransaction();
    try {
        foreach ($data as $row) {
            $accountId  = isset($row['account_id'])  && $row['account_id']  ? (int)$row['account_id']  : null;
            $categoryId = isset($row['category_id']) && $row['category_id'] ? (int)$row['category_id'] : null;
            $merchant   = trim($row['merchant'] ?? '');
            $amount     = (float)($row['amount'] ?? 0);
            $type       = $row['type'] ?? 'expense';
            $date       = trim($row['date'] ?? '');

            if (!in_array($type, ['expense', 'income', 'transfer'], true)) { $errors++; continue; }
            if ($amount <= 0)                                                { $errors++; continue; }
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date))               { $errors++; continue; }

            // Always recompute merchant_clean server-side (don't trust the
            // client payload, and the preview value may have been user-edited).
            // Store NULL rather than empty string when merchant is blank —
            // the column is nullable (no DEFAULT) in the live schema.
            $merchantClean = ($merchant !== '') ? clean_merchant($merchant) : null;

            $insertStmt->execute([$uid, $accountId, $categoryId, $merchant, $merchantClean, $amount, $type, $date]);

            // Upsert exact-match rule using cleaned key (only when user confirmed a category)
            if ($merchant && $categoryId && $merchantClean !== null) {
                $cleanNorm = strtolower(trim(preg_replace('/\s+/', ' ', $merchantClean)));
                if ($cleanNorm !== '') {
                    $merchantUpsert->execute([$uid, $cleanNorm, $categoryId]);
                }
            }

            $imported++;
        }
        $db->commit();
    } catch (\Exception $e) {
        $db->rollBack();
        throw $e;
    }

    // Write import log entry — pull metadata from first row of payload
    $firstRow  = $data[0] ?? [];
    $filename  = trim($firstRow['filename'] ?? '');
    $format    = trim($firstRow['format']   ?? '');
    $accountId = isset($firstRow['account_id']) ? (int)$firstRow['account_id'] : null;
    $db->prepare('INSERT INTO import_log (user_id, account_id, filename, format, imported, skipped) VALUES (?, ?, ?, ?, ?, ?)')
       ->execute([$uid, $accountId, $filename, $format, $imported, $errors]);

    json_response(['imported' => $imported, 'skipped' => 0, 'errors' => $errors]);
}

/* ── log ──────────────────────────────────────────────────── */

function handleLog(PDO $db): void {
    $uid  = CURRENT_USER_ID;
    $stmt = $db->prepare('
        SELECT il.id, il.filename, il.format, il.imported, il.skipped, il.created_at,
               a.name AS account_name
        FROM import_log il
        LEFT JOIN accounts a ON a.id = il.account_id
        WHERE il.user_id = ?
        ORDER BY il.created_at DESC
        LIMIT 50
    ');
    $stmt->execute([$uid]);
    json_response(['log' => $stmt->fetchAll()]);
}

/* ── helpers ──────────────────────────────────────────────── */

/**
 * Strip bank-feed noise from a raw merchant string.
 *
 * Ported directly from the Python reference implementation validated against
 * ~3,700 real transactions (PNC checking/savings, Chase CC, Apple Card).
 *
 * Examples:
 *   "TST* TWO STONES PUB - KENNETT SQU PA DEBIT CARD PURCHASE xxxxxxxxxxxxxxxx0036"
 *     -> "TST* TWO STONES PUB - KENNETT SQU"
 *   "GIANT 6516 KENNETT SQUA PA POS PURCHASE POS001 xxx6417"
 *     -> "GIANT 6516 KENNETT SQUA"
 *   "GIANT 6516 PURCHASE ACH WEB xxxxxxxxxxx6637"
 *     -> "GIANT 6516 PURCHASE"   <-- "PURCHASE" stays; only "ACH WEB x+digits" stripped
 *   "WAWA 25 WEST CHESTER PA POS PURCHASE POSxxxx6705 xxx2931"
 *     -> "WAWA 25 WEST CHESTER"
 *
 * Known limitation: merchants with a unique reference number embedded mid-string
 * (AMZ*9kzwordq7, ONEQUINCE* Q20275053, BMW BANK BMWFS PYMT ACH DEBIT xxx0650)
 * pass through unchanged. Use prefix/regex rules in merchant_categories for those.
 */
function clean_merchant(string $raw): string {
    if (trim($raw) === '') return $raw;

    $m = $raw;

    // Rule 1: Strip "DEBIT CARD PURCHASE xxxxxxxxxxxxxxxx0036" and
    //         "POS PURCHASE POSxxxx6705 xxx2931" / "POS PURCHASE POS001 xxx6417"
    //         Requires a masked card number (xxx+digits) to be present — avoids
    //         over-stripping merchants that legitimately contain these words.
    $m = preg_replace(
        '/\s+(DEBIT CARD PURCHASE|POS PURCHASE)\s*(POS[x0-9]+\s*)?xxx+\d+.*$/i',
        '',
        $m
    );

    // Rule 2: Strip "ACH WEB xxxxxxxxxxx6637" style suffixes.
    //         Note: only the "ACH WEB x+digits" portion is stripped, so a merchant
    //         like "GIANT 6516 PURCHASE ACH WEB xxx6637" becomes "GIANT 6516 PURCHASE".
    $m = preg_replace('/\s+ACH WEB\s+x+\d+\s*$/i', '', $m);

    // Rule 3: Strip a dangling trailing state abbreviation left over after the above.
    //         Hardcoded to PA/DE/NJ (local states in the source data) rather than
    //         any two-letter sequence, to avoid false positives like "COCA CA" -> "COCA".
    $m = preg_replace('/\s+(PA|DE|NJ)$/', '', $m);

    return trim($m);
}

/**
 * Load the merchant→category map, split into exact-match entries and
 * pattern rules (prefix / regex).
 *
 * Returns:
 *   [
 *     'exact'    => [ 'merchant_norm' => ['category_id'=>int, 'category_name'=>str], ... ],
 *     'patterns' => [ ['type'=>str, 'pattern'=>str, 'category_id'=>int, 'category_name'=>str], ... ]
 *   ]
 *
 * Pattern rules are sorted prefix-first (faster to evaluate), then regex.
 * Within each type they're ordered by most-recently-updated first, giving
 * recently-added rules a higher priority than older ones.
 */
function load_merchant_map(PDO $db, int $uid): array {
    $stmt = $db->prepare('
        SELECT mc.merchant_normalized, mc.match_type, mc.match_pattern,
               mc.category_id, c.name AS category_name
        FROM merchant_categories mc
        JOIN categories c ON c.id = mc.category_id
        WHERE mc.user_id = ?
        ORDER BY mc.updated_at DESC
    ');
    $stmt->execute([$uid]);

    $exact    = [];
    $patterns = [];

    foreach ($stmt->fetchAll() as $r) {
        $cat = [
            'category_id'   => (int)$r['category_id'],
            'category_name' => $r['category_name'],
        ];
        if ($r['match_type'] === 'exact') {
            $exact[$r['merchant_normalized']] = $cat;
        } else {
            $patterns[] = array_merge($cat, [
                'type'    => $r['match_type'],
                // Patterns are stored lowercase; normalise here for safety
                'pattern' => strtolower(trim($r['match_pattern'] ?? '')),
            ]);
        }
    }

    // Prefix rules first (cheap string op), then regex (more expensive)
    usort($patterns, fn($a, $b) =>
        ($a['type'] === 'prefix' ? 0 : 1) <=> ($b['type'] === 'prefix' ? 0 : 1)
    );

    return ['exact' => $exact, 'patterns' => $patterns];
}

function load_categories_by_name(PDO $db, int $uid): array {
    $stmt = $db->prepare('SELECT id, name FROM categories WHERE user_id = ? AND deleted_at IS NULL');
    $stmt->execute([$uid]);
    $map = [];
    foreach ($stmt->fetchAll() as $r) {
        $map[strtolower(trim($r['name']))] = ['id' => (int)$r['id'], 'name' => $r['name']];
    }
    return $map;
}

/**
 * Build the set of existing transactions for duplicate detection.
 *
 * The key is built from the cleaned merchant so that two raw strings that clean
 * to the same merchant (e.g. same Giant store, different POS terminal ID) are
 * correctly identified as duplicates.
 *
 * During the transition period before the merchant_clean backfill is run,
 * rows with an empty merchant_clean fall back to running clean_merchant() on
 * the raw merchant column, so duplicate detection is accurate either way.
 */
function load_existing_set(PDO $db, int $uid, int $accountId): array {
    $stmt = $db->prepare('
        SELECT date, amount, merchant, merchant_clean
        FROM transactions
        WHERE user_id = ? AND account_id = ? AND deleted_at IS NULL
    ');
    $stmt->execute([$uid, $accountId]);
    $set = [];
    foreach ($stmt->fetchAll() as $r) {
        // Use merchant_clean if populated (column is nullable); otherwise derive on the fly.
        // Explicit null check required: null !== '' is true in PHP, so without it we'd
        // pass null into preg_replace and get a deprecation + wrong key.
        $cleanSrc = ($r['merchant_clean'] !== null && $r['merchant_clean'] !== '')
            ? $r['merchant_clean']
            : clean_merchant($r['merchant']);
        $norm     = strtolower(trim(preg_replace('/\s+/', ' ', $cleanSrc)));
        $key      = $r['date'] . '|' . number_format((float)$r['amount'], 2) . '|' . $norm;
        $set[$key] = true;
    }
    return $set;
}

function detect_format(array $headers): string {
    $h = array_map(fn($x) => strtolower(trim($x)), $headers);

    // Apple Card has "merchant" AND "clearing date"
    if (in_array('merchant', $h) && in_array('clearing date', $h)) return 'apple_card';

    // Chase has "post date" and "description" but no deposits/withdrawals split
    if (in_array('post date', $h) && in_array('description', $h)) return 'chase';

    // PNC actual export: "transaction date", "transaction description", "amount" (balance column optional)
    if (in_array('transaction description', $h) && in_array('amount', $h)) return 'pnc';

    // PNC older format with separate withdrawals/deposits columns
    if (in_array('withdrawals', $h) || in_array('deposits', $h)) return 'pnc';

    return 'unknown';
}

function parse_date(string $raw): ?string {
    $raw = trim($raw);
    if (!$raw) return null;

    // Already YYYY-MM-DD
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw)) return $raw;

    // M/D/YYYY or MM/DD/YYYY
    if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})$#', $raw, $m)) {
        return sprintf('%04d-%02d-%02d', (int)$m[3], (int)$m[1], (int)$m[2]);
    }

    return null;
}

function parse_amount(string $raw): float {
    // Handle PNC format: "+ $135.82" or "- $135.82"
    $raw = trim($raw);
    $sign = 1;
    if (str_starts_with($raw, '-') || str_starts_with($raw, '- ')) $sign = -1;
    return $sign * abs((float)str_replace([',', '$', '+', '-', ' '], '', $raw));
}

function normalize_row(array $map, string $format): ?array {
    return match($format) {
        'apple_card' => normalize_apple_card($map),
        'chase'      => normalize_chase($map),
        'pnc'        => normalize_pnc($map),
        default      => null,
    };
}

function normalize_apple_card(array $map): ?array {
    $date        = parse_date($map['transaction date'] ?? '');
    $merchant    = trim($map['merchant'] ?? $map['description'] ?? '');
    $amount      = parse_amount($map['amount (usd)'] ?? $map['amount'] ?? '0');
    $typeHint    = strtolower($map['type'] ?? '');
    $csvCategory = trim($map['category'] ?? '') ?: null;

    if (!$date || $merchant === '' || $amount == 0) return null;

    // Use the Type column as the primary signal — Apple Card uses "Purchase" and "Payment"
    if ($typeHint === 'payment') {
        $suggestedType = 'transfer';
    } elseif ($typeHint === 'purchase' || $typeHint === '') {
        $suggestedType = 'expense';
    } else {
        // Positive amount with unknown type = likely a credit or refund
        $suggestedType = $amount > 0 ? 'income' : 'expense';
    }

    return ['date' => $date, 'merchant' => $merchant, 'amount' => abs($amount), 'suggested_type' => $suggestedType, 'csv_category' => $csvCategory];
}

function normalize_chase(array $map): ?array {
    $date        = parse_date($map['transaction date'] ?? '');
    $merchant    = trim($map['description'] ?? '');
    $amount      = parse_amount($map['amount'] ?? '0');
    $typeHint    = strtolower($map['type'] ?? '');
    $csvCategory = trim($map['category'] ?? '') ?: null;

    if (!$date || $merchant === '' || $amount == 0) return null;

    if ($typeHint === 'payment') {
        $suggestedType = 'transfer';
    } elseif ($amount > 0) {
        // Positive non-payment = refund/credit; treat as income and let user reclassify
        $suggestedType = 'income';
    } else {
        $suggestedType = 'expense';
    }

    return ['date' => $date, 'merchant' => $merchant, 'amount' => abs($amount), 'suggested_type' => $suggestedType, 'csv_category' => $csvCategory];
}

function normalize_pnc(array $map): ?array {
    // Support both PNC export formats
    $rawDate  = $map['transaction date'] ?? $map['date'] ?? '';
    $merchant = trim($map['transaction description'] ?? $map['description'] ?? '');

    // Skip pending transactions — date starts with "PENDING"
    if (stripos(trim($rawDate), 'PENDING') === 0) return null;

    $date = parse_date($rawDate);
    if (!$date || $merchant === '') return null;

    // New format: single signed "amount" column ("- $135.82" / "+ $0.46")
    if (isset($map['amount'])) {
        $amount = parse_amount($map['amount']);
        if ($amount == 0) return null;
        $suggestedType = $amount < 0 ? 'expense' : 'income';
        return ['date' => $date, 'merchant' => $merchant, 'amount' => abs($amount), 'suggested_type' => $suggestedType, 'csv_category' => null];
    }

    // Old format: separate withdrawals/deposits columns
    $withdrawal = abs(parse_amount($map['withdrawals'] ?? ''));
    $deposit    = abs(parse_amount($map['deposits']    ?? ''));
    if ($withdrawal > 0) {
        return ['date' => $date, 'merchant' => $merchant, 'amount' => $withdrawal, 'suggested_type' => 'expense', 'csv_category' => null];
    }
    if ($deposit > 0) {
        return ['date' => $date, 'merchant' => $merchant, 'amount' => $deposit, 'suggested_type' => 'income', 'csv_category' => null];
    }
    return null;
}

function is_transfer_keyword(string $merchant): bool {
    static $keywords = [
        'online payment', 'automatic payment', 'autopay',
        'online transfer', 'mobile transfer', 'account transfer',
        'wire transfer', 'bank transfer', 'internal transfer',
        'transfer from', 'transfer to ',
        'credit card payment', 'chase credit', 'apple card payment',
        'pnc online', 'pnc xfer',
        'payment thank you',
        'venmo', 'zelle',
        'savings transfer',
    ];
    $norm = strtolower(trim($merchant));
    foreach ($keywords as $kw) {
        if (str_contains($norm, $kw)) return true;
    }
    return false;
}

function is_income_keyword(string $merchant): bool {
    static $keywords = [
        'direct deposit', 'payroll', 'salary deposit',
        'interest payment', 'interest earned', 'interest credit',
        'dividend', 'tax refund', 'irs treas',
    ];
    $norm = strtolower(trim($merchant));
    foreach ($keywords as $kw) {
        if (str_contains($norm, $kw)) return true;
    }
    return false;
}
