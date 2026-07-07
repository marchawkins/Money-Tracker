<?php
$db = get_db();

switch ($method) {
    case 'GET':
        handleGet($db);
        break;
    default:
        json_error('Method not allowed', 405);
}

function handleGet(PDO $db): void {
    $uid = CURRENT_USER_ID;

    $monthParam = $_GET['month'] ?? date('Y-m');
    if (!preg_match('/^\d{4}-\d{2}$/', $monthParam)) {
        json_error('Invalid month format (YYYY-MM required)');
    }

    $monthStart = $monthParam . '-01';
    $monthEnd   = date('Y-m-t', strtotime($monthStart));

    // display_name
    $stmt = $db->prepare('SELECT display_name FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $userRow     = $stmt->fetch();
    $displayName = $userRow['display_name'] ?? '';

    // Summary: income + expense totals for this month
    $stmt = $db->prepare("
        SELECT
            COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS total_income,
            COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expenses
        FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL
          AND date >= ? AND date <= ?
          AND type IN ('income', 'expense')
    ");
    $stmt->execute([$uid, $monthStart, $monthEnd]);
    $sumRow = $stmt->fetch();
    $totalIncome   = (float)$sumRow['total_income'];
    $totalExpenses = (float)$sumRow['total_expenses'];

    // Budget progress: latest effective budget per category for this month
    $stmt = $db->prepare("
        SELECT b.id, b.category_id, c.name AS category_name, b.amount AS budget_amount,
               COALESCE(SUM(t.amount), 0) AS spent
        FROM budgets b
        INNER JOIN (
            SELECT category_id, MAX(effective_month) AS max_month
            FROM budgets
            WHERE user_id = ? AND effective_month <= ?
            GROUP BY category_id
        ) latest ON latest.category_id = b.category_id
                 AND latest.max_month  = b.effective_month
        JOIN categories c ON c.id = b.category_id AND c.deleted_at IS NULL
        LEFT JOIN transactions t ON t.category_id = b.category_id
            AND t.user_id = ?
            AND t.type = 'expense'
            AND t.date >= ? AND t.date <= ?
            AND t.deleted_at IS NULL
        WHERE b.user_id = ?
        GROUP BY b.id, b.category_id, c.name, b.amount
        ORDER BY c.name
    ");
    $stmt->execute([$uid, $monthStart, $uid, $monthStart, $monthEnd, $uid]);
    $budgetRows = $stmt->fetchAll();

    $budgetProgress      = [];
    $budgetedCategoryIds = [];
    foreach ($budgetRows as $r) {
        $spent   = (float)$r['spent'];
        $budget  = (float)$r['budget_amount'];
        $budgetProgress[] = [
            'category_id'   => (int)$r['category_id'],
            'category_name' => $r['category_name'],
            'budget_amount' => $budget,
            'spent'         => $spent,
            'remaining'     => $budget - $spent,
            'over_budget'   => $spent > $budget,
        ];
        $budgetedCategoryIds[] = (int)$r['category_id'];
    }

    // Unbudgeted expense spending this month
    if (!empty($budgetedCategoryIds)) {
        $ph   = implode(',', array_fill(0, count($budgetedCategoryIds), '?'));
        $stmt = $db->prepare("
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE user_id = ? AND deleted_at IS NULL AND type = 'expense'
              AND date >= ? AND date <= ?
              AND (category_id IS NULL OR category_id NOT IN ($ph))
        ");
        $stmt->execute(array_merge([$uid, $monthStart, $monthEnd], $budgetedCategoryIds));
    } else {
        $stmt = $db->prepare("
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE user_id = ? AND deleted_at IS NULL AND type = 'expense'
              AND date >= ? AND date <= ?
        ");
        $stmt->execute([$uid, $monthStart, $monthEnd]);
    }
    $unbudgetedTotal = (float)$stmt->fetch()['total'];

    // Recent transactions (last 10, any type, not filtered by month)
    $stmt = $db->prepare("
        SELECT t.id, t.merchant, t.amount, t.type, t.date,
               c.name AS category_name, a.name AS account_name
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts   a ON a.id = t.account_id
        WHERE t.user_id = ? AND t.deleted_at IS NULL
        ORDER BY t.date DESC, t.created_at DESC
        LIMIT 10
    ");
    $stmt->execute([$uid]);
    $recentTransactions = array_map(fn($r) => [
        'id'            => (int)$r['id'],
        'merchant'      => $r['merchant'],
        'amount'        => (float)$r['amount'],
        'type'          => $r['type'],
        'date'          => $r['date'],
        'category_name' => $r['category_name'],
        'account_name'  => $r['account_name'],
    ], $stmt->fetchAll());

    // Monthly trend: one query covering 6 months, fill gaps with 0
    $trendStart = date('Y-m-01', strtotime("$monthStart -5 months"));
    $stmt = $db->prepare("
        SELECT DATE_FORMAT(date, '%Y-%m') AS month,
               COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) AS total_expenses,
               COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END), 0) AS total_income
        FROM transactions
        WHERE user_id = ? AND deleted_at IS NULL
          AND type IN ('income', 'expense')
          AND date >= ? AND date <= ?
        GROUP BY DATE_FORMAT(date, '%Y-%m')
        ORDER BY month
    ");
    $stmt->execute([$uid, $trendStart, $monthEnd]);
    $trendData = [];
    foreach ($stmt->fetchAll() as $r) {
        $trendData[$r['month']] = [
            'total_expenses' => (float)$r['total_expenses'],
            'total_income'   => (float)$r['total_income'],
        ];
    }

    $monthlyTrend = [];
    for ($i = 5; $i >= 0; $i--) {
        $label = date('Y-m', strtotime("$monthStart -$i months"));
        $monthlyTrend[] = [
            'month'          => $label,
            'total_expenses' => $trendData[$label]['total_expenses'] ?? 0.0,
            'total_income'   => $trendData[$label]['total_income']   ?? 0.0,
        ];
    }

    json_response([
        'month'               => $monthParam,
        'display_name'        => $displayName,
        'summary'             => [
            'total_income'   => $totalIncome,
            'total_expenses' => $totalExpenses,
            'net'            => $totalIncome - $totalExpenses,
        ],
        'budget_progress'     => $budgetProgress,
        'unbudgeted_total'    => $unbudgetedTotal,
        'recent_transactions' => $recentTransactions,
        'monthly_trend'       => $monthlyTrend,
    ]);
}
