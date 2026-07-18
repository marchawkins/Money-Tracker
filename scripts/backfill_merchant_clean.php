<?php
/**
 * Backfill transactions.merchant_clean
 *
 * Run this from the project root (one level above public_html):
 *
 *   php scripts/backfill_merchant_clean.php            # dry-run: compare only, write nothing
 *   php scripts/backfill_merchant_clean.php --fill     # fill NULL rows (compare step runs first)
 *   php scripts/backfill_merchant_clean.php --compare  # explicit dry-run alias
 *
 * What it does
 * ────────────
 *  Step 1 (always): For every row that already has merchant_clean set, apply
 *  clean_merchant() to the raw merchant and diff against the stored value.
 *  Any divergence is printed so you can decide whether the PHP logic needs
 *  adjusting before touching the DB.
 *
 *  Step 2 (--fill only): For every row where merchant_clean IS NULL, compute
 *  clean_merchant(merchant) and write it. Runs in batches of 500.
 *  Skips step 2 if step 1 found any mismatches (safety gate).
 */

declare(strict_types=1);

// ── Bootstrap ────────────────────────────────────────────────────────────────
// Reuse public_html/api/db.php directly — it already contains the candidate-
// path search for config/db.php and defines get_db(), so there's no reason
// to duplicate that logic here.

$apiDb = __DIR__ . '/../public_html/api/db.php';
if (!file_exists($apiDb)) {
    fwrite(STDERR, "Error: cannot find public_html/api/db.php.\n");
    fwrite(STDERR, "Expected: " . realpath(__DIR__ . '/..') . "/public_html/api/db.php\n");
    fwrite(STDERR, "Run this script from the project root, e.g.:\n");
    fwrite(STDERR, "  php scripts/backfill_merchant_clean.php\n");
    exit(1);
}

require_once $apiDb;   // defines get_db()
$pdo = get_db();

$doFill    = in_array('--fill',    $argv ?? [], true);
$doCompare = in_array('--compare', $argv ?? [], true) || !$doFill;

// ── clean_merchant() — exact PHP port of merchant_normalize.py ───────────────
//
// Ported from the Python reference validated against ~3,700 real transactions.
// Cross-verified: 12/12 test cases produce identical output.

function clean_merchant(string $raw): string {
    if (trim($raw) === '') return $raw;

    $m = $raw;

    // Rule 1: Strip "DEBIT CARD PURCHASE xxxxxxxxxxxxxxxx0036" and
    //         "POS PURCHASE POSxxxx6705 xxx2931" / "POS PURCHASE POS001 xxx6417"
    $m = preg_replace(
        '/\s+(DEBIT CARD PURCHASE|POS PURCHASE)\s*(POS[x0-9]+\s*)?xxx+\d+.*$/i',
        '',
        $m
    );

    // Rule 2: Strip "ACH WEB xxxxxxxxxxx6637" — note "PURCHASE" before ACH WEB stays
    $m = preg_replace('/\s+ACH WEB\s+x+\d+\s*$/i', '', $m);

    // Rule 3: Strip dangling trailing state abbreviation (PA/DE/NJ only)
    $m = preg_replace('/\s+(PA|DE|NJ)$/', '', $m);

    return trim($m);
}

// ── Step 1: Compare against already-backfilled rows ──────────────────────────

echo "Step 1: Comparing PHP clean_merchant() against existing merchant_clean values...\n\n";

$rows = $pdo->query('
    SELECT id, merchant, merchant_clean
    FROM transactions
    WHERE merchant_clean IS NOT NULL
    AND merchant_clean != ""
    ORDER BY id
')->fetchAll();

$total      = count($rows);
$mismatches = 0;
$mismatchDetails = [];

foreach ($rows as $r) {
    $php = clean_merchant($r['merchant']);
    if ($php !== $r['merchant_clean']) {
        $mismatches++;
        $mismatchDetails[] = [
            'id'      => $r['id'],
            'raw'     => $r['merchant'],
            'db'      => $r['merchant_clean'],
            'php'     => $php,
        ];
    }
}

echo "  Rows with merchant_clean already set: {$total}\n";
echo "  Mismatches (PHP vs DB): {$mismatches}\n";

if ($mismatches > 0) {
    echo "\n  ── Mismatch detail (" . min($mismatches, 50) . " of {$mismatches} shown) ──\n";
    foreach (array_slice($mismatchDetails, 0, 50) as $d) {
        echo "\n  id={$d['id']}\n";
        echo "    raw: {$d['raw']}\n";
        echo "    DB:  {$d['db']}\n";
        echo "    PHP: {$d['php']}\n";
    }
    if ($mismatches > 50) {
        echo "\n  ... and " . ($mismatches - 50) . " more.\n";
    }
    echo "\n  ⚠  Mismatches found. Review the diff above before running --fill.\n";
    echo "     The --fill step will NOT run until mismatches reach zero.\n\n";
} else {
    echo "  ✓  PHP output matches all existing values. Safe to fill NULL rows.\n\n";
}

// ── Step 2: Fill NULL rows (--fill only, and only if step 1 is clean) ────────

if (!$doFill) {
    echo "Dry-run complete. Re-run with --fill to write NULL rows.\n";
    exit($mismatches > 0 ? 1 : 0);
}

if ($mismatches > 0) {
    echo "Skipping --fill due to mismatches above. Fix clean_merchant() first.\n";
    exit(1);
}

echo "Step 2: Filling NULL merchant_clean rows...\n\n";

$nullRows = $pdo->query('
    SELECT id, merchant
    FROM transactions
    WHERE merchant_clean IS NULL
    ORDER BY id
')->fetchAll();

$nullCount = count($nullRows);
echo "  Rows with merchant_clean = NULL: {$nullCount}\n";

if ($nullCount === 0) {
    echo "  Nothing to do — all rows already have merchant_clean set.\n";
    exit(0);
}

$updateStmt = $pdo->prepare('UPDATE transactions SET merchant_clean = ? WHERE id = ?');

$batchSize = 500;
$updated   = 0;
$pdo->beginTransaction();

try {
    foreach ($nullRows as $r) {
        $clean = clean_merchant($r['merchant']);
        // Store NULL rather than empty string to match the column's nullable definition
        $updateStmt->execute([$clean !== '' ? $clean : null, $r['id']]);
        $updated++;

        if ($updated % $batchSize === 0) {
            $pdo->commit();
            $pdo->beginTransaction();
            echo "  ... {$updated}/{$nullCount}\n";
        }
    }
    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
    fwrite(STDERR, "\nError during update: " . $e->getMessage() . "\n");
    exit(1);
}

echo "\n  ✓  Filled {$updated} rows.\n";
echo "\nDone.\n";
exit(0);
