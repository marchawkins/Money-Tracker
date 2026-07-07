-- Money Tracker — Full Schema
-- Run fresh: mysql -u user -p dbname < schema.sql

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS merchant_categories;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS import_log;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email        VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL DEFAULT '',
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    name       VARCHAR(100) NOT NULL,
    type       ENUM('checking','savings','credit') NOT NULL DEFAULT 'checking',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE categories (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    name       VARCHAR(100) NOT NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE transactions (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    account_id  INT UNSIGNED NULL,
    category_id INT UNSIGNED NULL,
    merchant    VARCHAR(255) NOT NULL DEFAULT '',
    amount      DECIMAL(10,2) NOT NULL,
    type        ENUM('expense','income','transfer') NOT NULL DEFAULT 'expense',
    date        DATE NOT NULL,
    notes       TEXT NULL,
    source      ENUM('manual','import') NOT NULL DEFAULT 'manual',
    deleted_at  TIMESTAMP NULL DEFAULT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
    FOREIGN KEY (account_id)  REFERENCES accounts(id)   ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_user_date    (user_id, date),
    INDEX idx_user_deleted (user_id, deleted_at)
);

CREATE TABLE import_log (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    account_id  INT UNSIGNED NULL,
    filename    VARCHAR(255) NOT NULL DEFAULT '',
    format      VARCHAR(50)  NOT NULL DEFAULT '',
    imported    INT UNSIGNED NOT NULL DEFAULT 0,
    skipped     INT UNSIGNED NOT NULL DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    INDEX idx_user_created (user_id, created_at)
);

CREATE TABLE budgets (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL,
    category_id     INT UNSIGNED NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    effective_month DATE NOT NULL COMMENT 'First day of month this budget takes effect',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_user_month (user_id, effective_month)
);

CREATE TABLE merchant_categories (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id             INT UNSIGNED NOT NULL,
    merchant_normalized VARCHAR(255) NOT NULL,
    category_id         INT UNSIGNED NOT NULL,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_merchant (user_id, merchant_normalized)
);

CREATE TABLE email_verifications (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    token      VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE password_resets (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    token      VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Default categories are seeded per-user on registration (see api/auth.php).
