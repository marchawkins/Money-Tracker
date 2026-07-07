# Money — Claude Code Project Context

## What This Is
A personal household finance tracker. Budgeting and spending awareness.
Lives at `money.marchawkins.com`. Sibling to the Vitale health tracker.
Full feature spec is in `SPEC.md` — read it before starting any phase.

## Stack — Non-Negotiable
- **Frontend:** Vanilla JavaScript only. No frameworks, no build step, no npm.
- **Backend:** PHP 8+ as a lightweight JSON API
- **Database:** MySQL
- **Routing:** Hash-based SPA (`#dashboard`, `#add`, `#transactions`, etc.)
- **Module pattern:** IIFE for every view and component (same as Vitale)
- **Deployment:** Hostinger shared hosting. Web root is `public_html/`. Config and DB files live outside web root.

## Project Structure
```
public_html/
  index.html          ← single HTML shell, loads all JS/CSS
  css/app.css
  js/
    app.js            ← router and session management
    api.js            ← centralized fetch wrapper
    utils.js          ← shared helpers (escHtml, date formatting, etc.)
    views/            ← one IIFE per view, each exports { render }
    components/       ← reusable UI pieces (toast, chart, confirm-dialog)
  api/
    index.php         ← single router, dispatches to resource files
    auth.php
    dashboard.php
    transactions.php
    budgets.php
    categories.php
    merchants.php
    accounts.php
    import.php
    profile.php
    db.php
    helpers.php
config/
  db.php              ← database credentials (outside web root)
db/
  schema.sql          ← full schema, importable fresh
```

## Code Conventions

### JavaScript
- Every view is an IIFE assigned to a `const`: `const DashboardView = (() => { ... return { render }; })()`
- Every view's `render(container, signal)` method receives the `#app-main` element and an AbortSignal
- Use the AbortSignal to cancel in-flight fetches when the user navigates away
- All user-facing strings that go into innerHTML must pass through `escHtml()`
- Date math: always use `YYYY-MM-DD` strings; parse with `new Date(str + 'T00:00:00')` to avoid timezone shifts
- No `var` — use `const` and `let`

### PHP
- Every response is JSON — always set `Content-Type: application/json`
- Auth check at top of `index.php`; all non-auth routes require `$_SESSION['user_id']`
- `json_error($msg, $code)` helper for error responses
- Use prepared statements for all DB queries — no string interpolation with user input
- `CURRENT_USER_ID` constant defined once in `index.php` after session check

### CSS
- Single stylesheet: `css/app.css`
- Mobile-first. Transaction entry and quick actions are optimized for one-handed mobile use.
- Design mirrors Vitale but uses a green accent color palette instead of warm/cream

### Database
- All tables include `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- User-scoped tables include `user_id INT NOT NULL` with FK to `users`
- Soft-delete with `deleted_at` for categories and merchants (transactions with that category must still display)
- Transactions table is the core ledger — keep it clean and never hard-delete (soft-delete only)

## Key Business Rules
- Transaction types: `expense`, `income`, `transfer`
- `transfer` transactions are excluded from all budget and spending calculations
- Monthly budgets reset on the 1st — no rollover
- Budget changes apply going forward only; historical months use the budget that was set at the time (store budget snapshots or effective dates)
- Merchant memory: `merchant_categories` table maps normalized merchant name → category_id; applied on save and import
- Duplicate detection on import: same account + date + amount + merchant = likely duplicate, flag for review

## Auth Pattern (same as Vitale)
- PHP sessions with `session_start()`
- Passwords hashed with `password_hash()` / `password_verify()` (bcrypt)
- Email verification on registration
- Password reset via email token
- Session cookie: httponly, samesite=Strict, secure on HTTPS

## Error Handling
- PHP: `ob_start()` at top of index.php; `set_exception_handler` returns JSON on any uncaught exception
- JS: all `API.*` calls are try/catch; errors render as `<p class="error">` inside the view container
- 401 from any non-auth endpoint → clear session state, redirect to `#login`

## What "Done" Looks Like Per Phase
Each phase should leave the app in a working, testable state. No half-built views. If a feature isn't complete, don't add the nav link yet.
