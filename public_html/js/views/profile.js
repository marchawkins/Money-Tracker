const ProfileView = (() => {

    async function render(container, signal) {
        container.innerHTML = `<p class="loading">Loading…</p>`;

        try {
            const [profileData, catData, accountData, merchantData] = await Promise.all([
                API.profile.get(signal),
                API.categories.list(signal),
                API.accounts.list(signal),
                API.merchants.list(signal),
            ]);

            renderAll(container, signal, {
                user:      profileData,
                cats:      catData.categories  || [],
                accounts:  accountData.accounts || [],
                merchants: merchantData.merchants || [],
            });
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">${escHtml(e.message)}</p></div>`;
        }
    }

    function renderAll(container, signal, data) {
        container.innerHTML = `
            <div class="view-narrow">
            ${buildProfileCard(data.user)}
            ${buildPasswordCard()}
            ${buildCategoriesCard(data.cats)}
            ${buildAccountsCard(data.accounts)}
            ${buildMerchantsCard(data.merchants, data.cats)}
            ${buildDangerCard()}
            </div>
        `;

        wireProfile(container, signal, data.user);
        wirePassword(container, signal);
        wireCategories(container, signal, data.cats);
        wireAccounts(container, signal, data.accounts);
        wireMerchants(container, signal, data.cats);
    }

    /* ── Profile card ──────────────────────────────────────── */

    function buildProfileCard(user) {
        const verifiedBadge = user.email_verified
            ? ''
            : `<span class="prf-unverified">unverified</span>`;
        return `
        <div class="card" id="prf-profile-card">
            <h2 class="section-title">Profile</h2>

            <div class="prf-field" id="prf-name-field">
                <span class="prf-label">Display name</span>
                <div class="prf-value-row">
                    <span class="prf-value" id="prf-name-val">${escHtml(user.display_name || 'Not set')}</span>
                    <button class="btn-link prf-edit-btn" type="button" data-field="name">Edit</button>
                </div>
                <div class="prf-edit-row" id="prf-name-edit" hidden>
                    <input type="text" class="prf-input" id="prf-name-input"
                        value="${escHtml(user.display_name || '')}" maxlength="100" placeholder="Your name">
                    <div class="prf-edit-actions">
                        <button class="btn btn-primary btn-sm" type="button" id="prf-name-save">Save</button>
                        <button class="btn btn-secondary btn-sm" type="button" data-cancel="name">Cancel</button>
                    </div>
                    <p class="error prf-field-error" id="prf-name-error"></p>
                </div>
            </div>

            <div class="prf-field" id="prf-email-field">
                <span class="prf-label">Email ${verifiedBadge}</span>
                <div class="prf-value-row">
                    <span class="prf-value" id="prf-email-val">${escHtml(user.email)}</span>
                    <button class="btn-link prf-edit-btn" type="button" data-field="email">Edit</button>
                </div>
                <div class="prf-edit-row" id="prf-email-edit" hidden>
                    <input type="email" class="prf-input" id="prf-email-input"
                        value="${escHtml(user.email)}" maxlength="255">
                    <div class="prf-edit-actions">
                        <button class="btn btn-primary btn-sm" type="button" id="prf-email-save">Save</button>
                        <button class="btn btn-secondary btn-sm" type="button" data-cancel="email">Cancel</button>
                    </div>
                    <p class="error prf-field-error" id="prf-email-error"></p>
                </div>
                <p class="prf-hint" id="prf-email-hint" hidden>
                    A verification link will be sent to your new address.
                </p>
            </div>
        </div>`;
    }

    function wireProfile(container, signal, user) {
        // Toggle edit rows
        container.querySelectorAll('.prf-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const field = btn.dataset.field;
                container.querySelector(`#prf-${field}-edit`).hidden = false;
                container.querySelector(`#prf-${field}-input`).focus();
                btn.closest('.prf-value-row').querySelector('.prf-edit-btn').hidden = true;
            }, { signal });
        });

        container.querySelectorAll('[data-cancel]').forEach(btn => {
            btn.addEventListener('click', () => {
                const field = btn.dataset.cancel;
                container.querySelector(`#prf-${field}-edit`).hidden = true;
                container.querySelector(`#prf-${field}-error`).textContent = '';
                container.querySelector(`#prf-${field}-input`).value =
                    field === 'name' ? (user.display_name || '') : user.email;
                container.querySelector(`.prf-edit-btn[data-field="${field}"]`).hidden = false;
            }, { signal });
        });

        // Save name
        container.querySelector('#prf-name-save').addEventListener('click', async () => {
            const input = container.querySelector('#prf-name-input');
            const err   = container.querySelector('#prf-name-error');
            err.textContent = '';
            try {
                const res = await API.profile.save({ display_name: input.value.trim() });
                user.display_name = res.user.display_name;
                container.querySelector('#prf-name-val').textContent =
                    res.user.display_name || 'Not set';
                container.querySelector('#prf-name-edit').hidden = true;
                container.querySelector('.prf-edit-btn[data-field="name"]').hidden = false;
            } catch (e) {
                err.textContent = e.message;
            }
        }, { signal });

        // Save email
        container.querySelector('#prf-email-save').addEventListener('click', async () => {
            const input   = container.querySelector('#prf-email-input');
            const err     = container.querySelector('#prf-email-error');
            const hint    = container.querySelector('#prf-email-hint');
            err.textContent = '';
            try {
                const res = await API.profile.save({ email: input.value.trim() });
                user.email = res.user.email;
                container.querySelector('#prf-email-val').textContent = res.user.email;
                container.querySelector('#prf-email-edit').hidden = true;
                container.querySelector('.prf-edit-btn[data-field="email"]').hidden = false;
                if (res.email_verification_sent) hint.hidden = false;
            } catch (e) {
                err.textContent = e.message;
            }
        }, { signal });
    }

    /* ── Password card ─────────────────────────────────────── */

    function buildPasswordCard() {
        return `
        <div class="card" id="prf-password-card">
            <h2 class="section-title">Change Password</h2>
            <div class="prf-pw-form">
                <div class="form-row">
                    <label for="prf-pw-current">Current password</label>
                    <input type="password" id="prf-pw-current" autocomplete="current-password">
                </div>
                <div class="form-row">
                    <label for="prf-pw-new">New password</label>
                    <input type="password" id="prf-pw-new" autocomplete="new-password"
                        placeholder="At least 8 characters">
                </div>
                <div class="form-row">
                    <label for="prf-pw-confirm">Confirm new password</label>
                    <input type="password" id="prf-pw-confirm" autocomplete="new-password">
                </div>
                <p class="prf-field-error error" id="prf-pw-error"></p>
                <p class="prf-field-success success" id="prf-pw-success"></p>
                <button class="btn btn-primary" type="button" id="prf-pw-save">Update Password</button>
            </div>
        </div>`;
    }

    function wirePassword(container, signal) {
        container.querySelector('#prf-pw-save').addEventListener('click', async () => {
            const current  = container.querySelector('#prf-pw-current').value;
            const next     = container.querySelector('#prf-pw-new').value;
            const confirm  = container.querySelector('#prf-pw-confirm').value;
            const errEl    = container.querySelector('#prf-pw-error');
            const successEl= container.querySelector('#prf-pw-success');

            errEl.textContent     = '';
            successEl.textContent = '';

            if (next !== confirm) {
                errEl.textContent = 'New passwords do not match.';
                return;
            }
            if (next.length < 8) {
                errEl.textContent = 'New password must be at least 8 characters.';
                return;
            }

            const btn = container.querySelector('#prf-pw-save');
            btn.disabled = true;
            try {
                await API.profile.changePassword({ current_password: current, new_password: next });
                successEl.textContent = 'Password updated.';
                container.querySelector('#prf-pw-current').value = '';
                container.querySelector('#prf-pw-new').value     = '';
                container.querySelector('#prf-pw-confirm').value = '';
            } catch (e) {
                errEl.textContent = e.message;
            }
            btn.disabled = false;
        }, { signal });
    }

    /* ── Categories card ───────────────────────────────────── */

    function buildCategoriesCard(cats) {
        return `
        <div class="card" id="prf-cats-card">
            <h2 class="section-title">Categories</h2>
            <ul class="prf-list" id="prf-cats-list">
                ${cats.map(c => buildCategoryRow(c)).join('')}
            </ul>
            <div class="prf-add-row">
                <input type="text" class="prf-add-input" id="prf-cats-input"
                    placeholder="New category name" maxlength="100">
                <button class="btn btn-secondary btn-sm" type="button" id="prf-cats-add">Add</button>
            </div>
            <p class="prf-field-error error" id="prf-cats-error"></p>
        </div>`;
    }

    function buildCategoryRow(c) {
        const canDelete  = c.transaction_count === 0;
        const countLabel = c.transaction_count > 0
            ? `<span class="prf-txn-count">${c.transaction_count} txn${c.transaction_count !== 1 ? 's' : ''}</span>`
            : '';
        return `<li class="prf-list-item" data-id="${c.id}" data-type="category">
            <span class="prf-item-name" data-name="${escHtml(c.name)}">${escHtml(c.name)}</span>
            ${countLabel}
            <div class="prf-item-actions">
                <button class="btn-link prf-item-edit" type="button" aria-label="Rename ${escHtml(c.name)}">Rename</button>
                ${canDelete
                    ? `<button class="btn-link prf-item-delete danger-link" type="button"
                          aria-label="Delete ${escHtml(c.name)}">Delete</button>`
                    : ''}
            </div>
        </li>`;
    }

    function wireCategories(container, signal, cats) {
        const list    = container.querySelector('#prf-cats-list');
        const errEl   = container.querySelector('#prf-cats-error');

        // Rename / Delete via event delegation
        list.addEventListener('click', async (e) => {
            const item = e.target.closest('.prf-list-item');
            if (!item) return;
            const id = parseInt(item.dataset.id, 10);

            if (e.target.classList.contains('prf-item-edit')) {
                startInlineEdit(item, async (newName) => {
                    const res = await API.categories.update(id, { name: newName });
                    item.querySelector('.prf-item-name').textContent = res.category.name;
                    item.querySelector('.prf-item-name').dataset.name = res.category.name;
                    const cat = cats.find(c => c.id === id);
                    if (cat) cat.name = res.category.name;
                });
                return;
            }

            if (e.target.classList.contains('prf-item-delete')) {
                if (!await ConfirmDialog.show(`Delete category "${item.querySelector('.prf-item-name').textContent}"?`)) return;
                try {
                    await API.categories.remove(id);
                    item.remove();
                    cats.splice(cats.findIndex(c => c.id === id), 1);
                } catch (err) {
                    errEl.textContent = err.message;
                }
            }
        }, { signal });

        // Add new category
        container.querySelector('#prf-cats-add').addEventListener('click', async () => {
            const input = container.querySelector('#prf-cats-input');
            const name  = input.value.trim();
            errEl.textContent = '';
            if (!name) return;

            try {
                const res = await API.categories.create({ name });
                const newCat = res.category;
                newCat.transaction_count = 0;
                cats.push(newCat);
                list.insertAdjacentHTML('beforeend', buildCategoryRow(newCat));
                input.value = '';
            } catch (err) {
                errEl.textContent = err.message;
            }
        }, { signal });

        container.querySelector('#prf-cats-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') container.querySelector('#prf-cats-add').click();
        }, { signal });
    }

    /* ── Accounts card ─────────────────────────────────────── */

    function buildAccountsCard(accounts) {
        return `
        <div class="card" id="prf-accounts-card">
            <h2 class="section-title">Accounts</h2>
            <ul class="prf-list" id="prf-accounts-list">
                ${accounts.map(a => buildAccountRow(a)).join('')}
            </ul>
            <div class="prf-add-row">
                <input type="text" class="prf-add-input" id="prf-accounts-input"
                    placeholder="New account name" maxlength="100">
                <select class="prf-add-select" id="prf-accounts-type">
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="credit">Credit</option>
                </select>
                <button class="btn btn-secondary btn-sm" type="button" id="prf-accounts-add">Add</button>
            </div>
            <p class="prf-field-error error" id="prf-accounts-error"></p>
        </div>`;
    }

    function buildAccountRow(a) {
        const typeLabel = { checking: 'Checking', savings: 'Savings', credit: 'Credit' }[a.type] || a.type;
        return `<li class="prf-list-item" data-id="${a.id}" data-type="account">
            <span class="prf-item-name">${escHtml(a.name)}</span>
            <span class="prf-type-badge">${escHtml(typeLabel)}</span>
            <div class="prf-item-actions">
                <button class="btn-link prf-item-edit" type="button" aria-label="Rename ${escHtml(a.name)}">Rename</button>
            </div>
        </li>`;
    }

    function wireAccounts(container, signal, accounts) {
        const list  = container.querySelector('#prf-accounts-list');
        const errEl = container.querySelector('#prf-accounts-error');

        list.addEventListener('click', async (e) => {
            const item = e.target.closest('.prf-list-item');
            if (!item || !e.target.classList.contains('prf-item-edit')) return;
            const id = parseInt(item.dataset.id, 10);
            startInlineEdit(item, async (newName) => {
                const res = await API.accounts.update(id, { name: newName });
                item.querySelector('.prf-item-name').textContent = res.account.name;
                const acct = accounts.find(a => a.id === id);
                if (acct) acct.name = res.account.name;
            });
        }, { signal });

        container.querySelector('#prf-accounts-add').addEventListener('click', async () => {
            const input    = container.querySelector('#prf-accounts-input');
            const typeEl   = container.querySelector('#prf-accounts-type');
            const name     = input.value.trim();
            errEl.textContent = '';
            if (!name) return;

            try {
                const res = await API.accounts.create({ name, type: typeEl.value });
                accounts.push(res.account);
                list.insertAdjacentHTML('beforeend', buildAccountRow(res.account));
                input.value  = '';
                typeEl.value = 'checking';
            } catch (err) {
                errEl.textContent = err.message;
            }
        }, { signal });

        container.querySelector('#prf-accounts-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') container.querySelector('#prf-accounts-add').click();
        }, { signal });
    }

    /* ── Merchant Memory card ──────────────────────────────── */

    function buildMerchantsCard(merchants, cats) {
        if (!merchants.length) {
            return `
            <div class="card" id="prf-merchants-card">
                <h2 class="section-title">Merchant Memory</h2>
                <p class="text-muted">No merchant mappings yet. They are created automatically when you categorize transactions.</p>
            </div>`;
        }

        return `
        <div class="card" id="prf-merchants-card">
            <h2 class="section-title">Merchant Memory</h2>
            <p class="prf-hint">Auto-applied when entering or importing transactions. Edit or delete incorrect mappings.</p>
            <div class="prf-merchant-filter-row">
                <input type="search" class="prf-merchant-filter" id="prf-merchant-filter"
                    placeholder="Filter merchants…">
            </div>
            <div class="prf-merchant-wrap">
                <table class="prf-merchant-table">
                    <thead>
                        <tr>
                            <th>Merchant</th>
                            <th>Category</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="prf-merchants-tbody">
                        ${merchants.map(m => buildMerchantRow(m, cats)).join('')}
                    </tbody>
                </table>
            </div>
            <p class="prf-field-error error" id="prf-merchants-error"></p>
        </div>`;
    }

    function buildMerchantRow(m, cats) {
        const selectedOptions = buildCategoryOptions(cats, { selected: m.category_id });
        return `<tr data-id="${m.id}">
            <td class="prf-merchant-name">${escHtml(m.merchant)}</td>
            <td>
                <select class="prf-merchant-select" aria-label="Category for ${escHtml(m.merchant)}">
                    ${selectedOptions}
                </select>
            </td>
            <td>
                <button class="btn-link danger-link prf-merchant-delete" type="button"
                    aria-label="Remove mapping for ${escHtml(m.merchant)}">Remove</button>
            </td>
        </tr>`;
    }

    function wireMerchants(container, signal, cats) {
        const tbody = container.querySelector('#prf-merchants-tbody');
        if (!tbody) return;
        const errEl = container.querySelector('#prf-merchants-error');

        // Filter input
        const filterInput = container.querySelector('#prf-merchant-filter');
        if (filterInput) {
            filterInput.addEventListener('input', () => {
                const q = filterInput.value.trim().toLowerCase();
                tbody.querySelectorAll('tr').forEach(row => {
                    const name = row.querySelector('.prf-merchant-name')?.textContent.toLowerCase() || '';
                    row.hidden = q.length > 0 && !name.includes(q);
                });
            }, { signal });
        }

        // Change select → auto-save
        tbody.addEventListener('change', async (e) => {
            const select = e.target.closest('.prf-merchant-select');
            if (!select) return;
            const row    = select.closest('tr');
            const id     = parseInt(row.dataset.id, 10);
            const catId  = parseInt(select.value, 10);
            errEl.textContent = '';
            try {
                await API.merchants.update(id, { category_id: catId });
            } catch (err) {
                errEl.textContent = err.message;
            }
        }, { signal });

        // Delete merchant mapping
        tbody.addEventListener('click', async (e) => {
            const btn = e.target.closest('.prf-merchant-delete');
            if (!btn) return;
            const row      = btn.closest('tr');
            const merchant = row.querySelector('.prf-merchant-name')?.textContent || 'this merchant';
            if (!await ConfirmDialog.show(`Remove mapping for "${merchant}"?`)) return;
            const id = parseInt(row.dataset.id, 10);
            errEl.textContent = '';
            try {
                await API.merchants.remove(id);
                row.remove();
            } catch (err) {
                errEl.textContent = err.message;
            }
        }, { signal });
    }

    /* ── Danger Zone card ──────────────────────────────────── */

    function buildDangerCard() {
        return `
        <div class="card prf-danger-card">
            <h2 class="section-title">Import Data</h2>
            <p class="prf-hint">Upload CSV files from Apple Card, Chase, or PNC to bulk-import transactions.</p>
            <a href="#import" class="btn btn-secondary">Go to Import</a>
        </div>`;
    }

    /* ── Shared: inline rename helper ─────────────────────── */

    function startInlineEdit(item, onSave) {
        const nameEl    = item.querySelector('.prf-item-name');
        const actionsEl = item.querySelector('.prf-item-actions');
        const origName  = nameEl.dataset.name || nameEl.textContent.trim();

        nameEl.hidden    = true;
        actionsEl.hidden = true;

        const wrap = document.createElement('div');
        wrap.className = 'prf-inline-edit';
        wrap.innerHTML = `
            <input type="text" class="prf-input" value="${escHtml(origName)}" maxlength="100">
            <button class="btn btn-primary btn-sm" type="button">Save</button>
            <button class="btn btn-secondary btn-sm" type="button">Cancel</button>
            <span class="error prf-inline-error"></span>
        `;

        item.appendChild(wrap);
        const input    = wrap.querySelector('input');
        const saveBtn  = wrap.querySelectorAll('button')[0];
        const cancelBtn= wrap.querySelectorAll('button')[1];
        const errEl    = wrap.querySelector('.prf-inline-error');
        input.focus();
        input.select();

        async function doSave() {
            const newName = input.value.trim();
            if (!newName) { errEl.textContent = 'Name cannot be empty.'; return; }
            saveBtn.disabled = true;
            try {
                await onSave(newName);
                wrap.remove();
                nameEl.hidden    = false;
                actionsEl.hidden = false;
            } catch (e) {
                errEl.textContent = e.message;
                saveBtn.disabled = false;
            }
        }

        saveBtn.addEventListener('click', doSave);
        cancelBtn.addEventListener('click', () => {
            wrap.remove();
            nameEl.hidden    = false;
            actionsEl.hidden = false;
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter')  doSave();
            if (e.key === 'Escape') cancelBtn.click();
        });
    }

    return { render };
})();
