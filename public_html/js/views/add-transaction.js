const AddTransactionView = (() => {

    function getEditId() {
        const qs = window.location.hash.split('?')[1] || '';
        const id = new URLSearchParams(qs).get('edit');
        return id ? parseInt(id, 10) : null;
    }

    function getReturnHash() {
        const qs = window.location.hash.split('?')[1] || '';
        return new URLSearchParams(qs).get('return') || '#transactions';
    }

    async function render(container, signal) {
        const editId = getEditId();

        // Load categories, accounts, and (if editing) the existing transaction in parallel
        let categories = [], accounts = [], existing = null;
        try {
            const fetches = [
                API.categories.list(signal),
                API.accounts.list(signal),
            ];
            if (editId) fetches.push(API.transactions.get(editId, signal));

            const results = await Promise.all(fetches);
            categories = results[0].categories || [];
            accounts   = results[1].accounts   || [];
            if (editId) existing = results[2].transaction || null;
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">Failed to load: ${escHtml(e.message)}</p></div>`;
            return;
        }

        if (editId && !existing) {
            container.innerHTML = `<div class="card"><p class="error">Transaction not found.</p></div>`;
            return;
        }

        const currentType = existing?.type || 'expense';
        const isEdit = !!editId;

        const catOptions = `<option value="">— Select category —</option>` +
            categories.map(c =>
                `<option value="${c.id}"${existing?.category_id === c.id ? ' selected' : ''}>${escHtml(c.name)}</option>`
            ).join('');

        const acctOptions = `<option value="">— No account —</option>` +
            accounts.map(a =>
                `<option value="${a.id}"${existing?.account_id === a.id ? ' selected' : ''}>${escHtml(a.name)}</option>`
            ).join('');

        const noAccountsHint = accounts.length === 0
            ? `<p class="field-hint">No accounts yet — add them in Profile &amp; Settings.</p>`
            : '';

        container.innerHTML = `
            <div class="view-narrow">
            <div class="card add-txn-card">
                <h2>${isEdit ? 'Edit Transaction' : 'Add Transaction'}</h2>

                <div class="type-toggle" id="type-toggle">
                    <button class="type-btn${currentType === 'expense'  ? ' active' : ''}" data-type="expense"  type="button">Expense</button>
                    <button class="type-btn${currentType === 'income'   ? ' active' : ''}" data-type="income"   type="button">Income</button>
                    <button class="type-btn${currentType === 'transfer' ? ' active' : ''}" data-type="transfer" type="button">Transfer</button>
                </div>

                <form id="add-form" novalidate>
                    <div class="form-row autocomplete-wrapper">
                        <label for="txn-merchant">Merchant / Description</label>
                        <input type="text" id="txn-merchant" name="merchant"
                               value="${existing ? escHtml(existing.merchant) : ''}"
                               autocomplete="off" placeholder="e.g. Whole Foods">
                        <ul class="autocomplete-list" id="merchant-suggestions" hidden></ul>
                    </div>

                    <div class="form-row">
                        <label for="txn-category">Category</label>
                        <select id="txn-category" name="category_id">${catOptions}</select>
                    </div>

                    <div class="form-row-inline">
                        <div class="form-col">
                            <label for="txn-amount">Amount</label>
                            <input type="number" id="txn-amount" name="amount"
                                   value="${existing ? existing.amount : ''}"
                                   min="0.01" step="0.01" inputmode="decimal" placeholder="0.00">
                        </div>
                        <div class="form-col">
                            <label for="txn-date">Date</label>
                            <input type="date" id="txn-date" name="date"
                                   value="${existing ? existing.date : todayStr()}">
                        </div>
                    </div>

                    <div class="form-row">
                        <label for="txn-account">Account</label>
                        <select id="txn-account" name="account_id">${acctOptions}</select>
                        ${noAccountsHint}
                    </div>

                    <div class="form-row">
                        <label for="txn-notes">Notes (optional)</label>
                        <textarea id="txn-notes" name="notes" rows="2"
                                  placeholder="Any additional details…">${existing ? escHtml(existing.notes || '') : ''}</textarea>
                    </div>

                    <div id="form-error" class="error" style="display:none;margin-bottom:8px;"></div>

                    <button type="submit" class="btn btn-primary btn-block" id="save-btn">
                        ${isEdit ? 'Save Changes' : 'Save Transaction'}
                    </button>

                    ${isEdit ? `
                        <button type="button" class="btn btn-secondary btn-block" id="delete-btn"
                                style="margin-top:10px;color:var(--color-danger);">
                            Delete Transaction
                        </button>
                    ` : ''}
                </form>
            </div>
            </div>
        `;

        // Track selected type without a hidden input (avoids form.type name collision)
        let selectedType = currentType;

        // Type toggle
        const toggle = container.querySelector('#type-toggle');
        toggle.addEventListener('click', e => {
            const btn = e.target.closest('.type-btn');
            if (!btn) return;
            toggle.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedType = btn.dataset.type;
        }, { signal });

        // Merchant autocomplete
        setupAutocomplete(container, signal);

        // New category inline
        const catSel = container.querySelector('#txn-category');
        setupNewCategoryOption(catSel, null, signal);

        // Form submit
        const form    = container.querySelector('#add-form');
        const errorEl = container.querySelector('#form-error');
        const saveBtn = container.querySelector('#save-btn');

        form.addEventListener('submit', async e => {
            e.preventDefault();
            errorEl.style.display = 'none';

            const amount = parseFloat(form.amount.value);
            if (isNaN(amount) || amount <= 0) {
                errorEl.textContent = 'Please enter a valid amount greater than zero.';
                errorEl.style.display = 'block';
                return;
            }
            if (!form.date.value) {
                errorEl.textContent = 'Please select a date.';
                errorEl.style.display = 'block';
                return;
            }

            const payload = {
                type:        selectedType,
                merchant:    form.merchant.value.trim(),
                category_id: form.category_id.value ? parseInt(form.category_id.value, 10) : null,
                amount,
                date:        form.date.value,
                account_id:  form.account_id.value ? parseInt(form.account_id.value, 10) : null,
                notes:       form.notes.value.trim() || null,
            };

            saveBtn.disabled    = true;
            saveBtn.textContent = 'Saving…';

            try {
                if (isEdit) {
                    await API.transactions.update(editId, payload);
                    Toast.success('Transaction updated');
                    window.location.hash = getReturnHash();
                } else {
                    await API.transactions.create(payload);
                    Toast.success('Transaction saved');
                    // Reset for quick next entry, keep date and account
                    const savedDate    = form.date.value;
                    const savedAccount = form.account_id.value;
                    form.reset();
                    form.date.value       = savedDate;
                    form.account_id.value = savedAccount;
                    // Reset type toggle to expense
                    selectedType = 'expense';
                    toggle.querySelectorAll('.type-btn').forEach(b =>
                        b.classList.toggle('active', b.dataset.type === 'expense')
                    );
                    form.merchant.focus();
                }
            } catch (ex) {
                if (ex.name === 'AbortError') return;
                errorEl.textContent   = escHtml(ex.message);
                errorEl.style.display = 'block';
            } finally {
                saveBtn.disabled    = false;
                saveBtn.textContent = isEdit ? 'Save Changes' : 'Save Transaction';
            }
        }, { signal });

        // Delete button (edit mode only)
        const deleteBtn = container.querySelector('#delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                ConfirmDialog.show({
                    title:       'Delete Transaction',
                    message:     'This will permanently remove this transaction.',
                    confirmText: 'Delete',
                    onConfirm:   async () => {
                        try {
                            await API.transactions.remove(editId);
                            Toast.success('Transaction deleted');
                            window.location.hash = getReturnHash();
                        } catch (ex) {
                            Toast.error(ex.message);
                        }
                    },
                });
            }, { signal });
        }

        // Focus merchant on new entry
        if (!isEdit) container.querySelector('#txn-merchant').focus();
    }

    function setupAutocomplete(container, signal) {
        const input    = container.querySelector('#txn-merchant');
        const list     = container.querySelector('#merchant-suggestions');
        const catSel   = container.querySelector('#txn-category');

        let timer = null;
        let abort = null;

        input.addEventListener('input', () => {
            clearTimeout(timer);
            const q = input.value.trim();
            if (q.length < 1) { closeList(); return; }

            timer = setTimeout(async () => {
                if (abort) abort.abort();
                abort = new AbortController();
                try {
                    const data = await API.merchants.autocomplete(q, abort.signal);
                    renderList(data.suggestions || []);
                } catch (e) {
                    if (e.name !== 'AbortError') closeList();
                }
            }, 250);
        }, { signal });

        // Close on blur with a small delay so click on item fires first
        input.addEventListener('blur', () => setTimeout(closeList, 150), { signal });

        function renderList(items) {
            if (!items.length) { closeList(); return; }
            list.innerHTML = items.map(s => `
                <li class="autocomplete-item"
                    data-merchant="${escHtml(s.merchant)}"
                    data-category-id="${s.category_id || ''}">
                    <span class="ac-name">${escHtml(s.merchant)}</span>
                    ${s.category_name ? `<span class="ac-meta">${escHtml(s.category_name)}</span>` : ''}
                </li>
            `).join('');
            list.hidden = false;
        }

        function closeList() {
            list.hidden = true;
            list.innerHTML = '';
        }

        list.addEventListener('mousedown', e => {
            const item = e.target.closest('.autocomplete-item');
            if (!item) return;
            e.preventDefault(); // prevent blur firing before click
            input.value = item.dataset.merchant;
            if (item.dataset.categoryId) catSel.value = item.dataset.categoryId;
            closeList();
        }, { signal });
    }

    return { render };
})();
