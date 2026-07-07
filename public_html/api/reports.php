<?php
$db = get_db();

switch ($method) {
    case 'GET':
        if ($sub === 'monthly')  { handleMonthly($db);  break; }
        if ($sub === 'year-end') { handleYearEnd($db);  break; }
        json_error('Not found', 404);
        break;
    default:
        json_error('Method not allowed', 405);
}

/* ── Monthly report ───────────────────────────────────────── */

function handleMonthly(PDO $db): void {
    $uid  = CURRENT_USER_ID;
    $year = (int)($_GET['year'] ?? date('Y'));
    if ($year < 2000 || $year > 2099) json_error('Invalid year');

    $yearStart = "$year-01-01";
    $yearEnd   = "$year-12-31";

    // All monthly expense/income rows by category in one query
    $stmt = $db->prepare("
        SELECT DATE_FORMAT(t.date, '%Y-%m') AS month,
               t.type,
               t.category_id,
               c.name AS category_name,
               SUM(t.amount) AS total
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL
          AND t.type IN ('expense','income')
          AND t.date >= ? AND t.date <= ?
        GROUP BY month, t.type, t.category_id, c.name
        ORDER BY month, t.type, total DESC
    ");
    $stmt->execute([$uid, $yearStart, $yearEnd]);

    // Bucket into [month][income|expense[categories[]]]
    $raw = [];
    foreach ($stmt->fetchAll() as $r) {
        $m = $r['month'];
        if (!isset($raw[$m])) $raw[$m] = ['income' => 0.0, 'expense' => 0.0, 'cats' => []];

        if ($r['type'] === 'income') {
            $raw[$m]['income'] += (float)$r['total'];
        } else {
            $raw[$m]['expense'] += (float)$r['total'];
            $raw[$m]['cats'][] = [
                'category_id'   => $r['category_id'] !== null ? (int)$r['category_id'] : null,
                'category_name' => $r['category_name'] ?? 'Uncategorized',
                'amount'        => (float)$r['total'],
            ];
        }
    }

    // Load all budget history for user once, indexed by category_id
    $stmt = $db->prepare("
        SELECT category_id, amount,
               DATE_FORMAT(effective_month, '%Y-%m') AS eff_month
        FROM budgets
        WHERE user_id = ?
        ORDER BY effective_month ASC
    ");
    $stmt->execute([$uid]);
    $budgetHistory = []; // [category_id => [[eff_month, amount], ...]]
    foreach ($stmt->fetchAll() as $r) {
        $budgetHistory[(int)$r['category_id']][] = [$r['eff_month'], (float)$r['amount']];
    }

    $getBudget = function (int $cid, string $month) use ($budgetHistory): ?float {
        if (!isset($budgetHistory[$cid])) return null;
        $best = null;
        foreach ($budgetHistory[$cid] as [$effMonth, $amount]) {
            if ($effMonth <= $month) $best = $amount;
            else break;
        }
        return $best;
    };

    // Build 12-month array (future months get zeros)
    $months = [];
    for ($m = 1; $m <= 12; $m++) {
        $mStr = sprintf('%04d-%02d', $year, $m);
        $d    = $raw[$mStr] ?? ['income' => 0.0, 'expense' => 0.0, 'cats' => []];

        $categories = $d['cats'];
        foreach ($categories as &$cat) {
            $cat['budget_amount'] = $cat['category_id'] !== null
                ? $getBudget((int)$cat['category_id'], $mStr)
                : null;
        }
        unset($cat);

        $months[] = [
            'month'          => $mStr,
            'total_income'   => $d['income'],
            'total_expenses' => $d['expense'],
            'net'            => $d['income'] - $d['expense'],
            'categories'     => $categories,
        ];
    }

    json_response(['year' => $year, 'months' => $months]);
}

/* ── Year-end report ──────────────────────────────────────── */

function handleYearEnd(PDO $db): void {
    $uid  = CURRENT_USER_ID;
    $year = (int)($_GET['year'] ?? date('Y'));
    if ($year < 2000 || $year > 2099) json_error('Invalid year');

    json_response([
        'year'     => $year,
        'current'  => get_year_data($db, $uid, $year),
        'previous' => get_year_data($db, $uid, $year - 1),
    ]);
}

function get_year_data(PDO $db, int $uid, int $year): array {
    $start = "$year-01-01";
    $end   = "$year-12-31";

    // Totals
    $stmt = $db->prepare("
        SELECT
            COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS total_income,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expenses
        FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL
          AND type IN ('income','expense')
          AND date >= ? AND date <= ?
    ");
    $stmt->execute([$uid, $start, $end]);
    $totals   = $stmt->fetch();
    $income   = (float)$totals['total_income'];
    $expenses = (float)$totals['total_expenses'];

    // Category breakdown (expenses only), sorted by spend desc
    $stmt = $db->prepare("
        SELECT t.category_id, c.name AS category_name, SUM(t.amount) AS total
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL
          AND t.type = 'expense'
          AND t.date >= ? AND t.date <= ?
        GROUP BY t.category_id, c.name
        ORDER BY total DESC
    ");
    $stmt->execute([$uid, $start, $end]);
    $categories = array_map(fn($r) => [
        'category_id'   => $r['category_id'] !== null ? (int)$r['category_id'] : null,
        'category_name' => $r['category_name'] ?? 'Uncategorized',
        'amount'        => (float)$r['total'],
    ], $stmt->fetchAll());

    // Top 5 merchants by spend
    $stmt = $db->prepare("
        SELECT merchant, SUM(amount) AS total, COUNT(*) AS txn_count
        FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL
          AND type = 'expense' AND merchant != ''
          AND date >= ? AND date <= ?
        GROUP BY merchant
        ORDER BY total DESC
        LIMIT 5
    ");
    $stmt->execute([$uid, $start, $end]);
    $topMerchants = array_map(fn($r) => [
        'merchant'  => $r['merchant'],
        'amount'    => (float)$r['total'],
        'txn_count' => (int)$r['txn_count'],
    ], $stmt->fetchAll());

    return [
        'total_income'   => $income,
        'total_expenses' => $expenses,
        'net'            => $income - $expenses,
        'savings_rate'   => $income > 0 ? round(($income - $expenses) / $income, 4) : 0.0,
        'categories'     => $categories,
        'top_merchants'  => $topMerchants,
    ];
}
