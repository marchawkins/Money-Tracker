# Money

A personal household finance tracker for budgeting and spending awareness. Built to run on a standard shared PHP/MySQL host with no build tools or dependencies required.

## Overview

Money lets you track spending across multiple accounts, assign transactions to categories, set monthly budgets, and import bank statements from CSV. An Insights view lets you search and filter your spending by category, merchant, or date range. A year-end summary compares income and expenses month by month across the full year.

The app supports multiple user accounts — each user has fully separate, scoped data. Authentication uses bcrypt password hashing with email verification and password reset flows.

## Features

- **Transaction entry** — quickly log expenses, income, and transfers with merchant autocomplete based on your history
- **Merchant memory** — the app remembers which category a merchant belongs to and auto-fills it next time, including on CSV import
- **CSV import** — imports bank exports from Apple Card, Chase, and PNC (both checking and savings). Detects duplicates automatically before confirming
- **Budgeting** — set monthly budgets per category; changes apply going forward only and don't affect historical data
- **Insights** — search your spending with natural language ("groceries in May", "Wawa", "restaurants last month"). Filter by date preset or custom range. Results show a prominent summary total with a collapsible transaction list
- **Monthly chart** — a full-year bar chart with clickable months to drill into category breakdowns
- **Year-end summary** — income vs. expenses across all 12 months with category totals

## Technical Notes

- **Frontend:** Vanilla JavaScript SPA with hash-based routing. No frameworks, no build step. Views are IIFE modules; all JS is organized into views, components, and a shared API client.
- **Backend:** PHP 8+, structured as a lightweight JSON API routed through `api/index.php`.
- **Database:** MySQL with a single schema file covering all tables.
- **Email:** Password reset and email verification use PHP's `mail()`. On shared hosts, SMTP configuration may be required depending on the host.
- **Hosting:** Tested on Hostinger shared hosting. Should work on any host running PHP 8+ and MySQL 5.7+.

## Project Structure

```
public_html/
  index.html          ← single HTML shell
  css/app.css
  js/
    app.js            ← router and session management
    api.js            ← centralized fetch wrapper
    utils.js          ← shared helpers
    views/            ← one IIFE per view
    components/       ← toast, chart, confirm dialog
  api/
    index.php         ← single router
    auth.php, dashboard.php, transactions.php
    budgets.php, categories.php, merchants.php
    accounts.php, import.php, profile.php
    db.php, helpers.php
config/
  db.php              ← database credentials (outside web root)
db/
  schema.sql          ← full schema, importable fresh
```

## Installation

- **Clone the repo** to your local machine or directly to your server.

- **Set up the database** — create a MySQL database, then import `db/schema.sql`. This creates all tables and a default set of categories.

- **Configure the database connection** — copy `config/db.sample.php` to `config/db.php` and fill in your database host, name, username, password, and app URL. `config/db.php` is gitignored and will never be committed.

- **Point your web root to `public_html/`** — the `config/` and `db/` directories sit outside the web root and are never served over HTTP.

- **Register your account** — visit the app, register with your email, and verify your address. Default spending categories are seeded automatically on first registration.

- **Add your accounts** — go to Profile & Settings to add your bank accounts (e.g. Apple Card, Chase, PNC Checking) before importing or logging transactions.

- **Configure PHP mail (if needed)** — on some shared hosts, email delivery requires configuring SMTP. Check your host's documentation for the recommended approach.

## CSV Import

The importer supports three bank formats detected automatically by column headers:

| Bank | Export format |
|---|---|
| Apple Card | CSV from Wallet app |
| Chase | CSV from account activity |
| PNC | CSV from account activity (with or without Balance column) |

On preview, unrecognized merchants can be assigned a category inline. Merchant-to-category mappings are saved and applied automatically on future imports. Transactions that match an existing entry by date, amount, and merchant are flagged as likely duplicates before you confirm.
