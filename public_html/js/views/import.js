const ImportView = (() => {

    async function render(container, signal) {
        container.innerHTML = `<p class="loading">Loading…</p>`;

        let categories = [], accounts = [], importLog = [];
        try {
            const [cData, aData, lData] = await Promise.all([
                API.categories.list(signal),
                API.accounts.list(signal),
                API.import.log(signal),
            ]);
            categories = cData.categories || [];
            accounts   = aData.accounts   || [];
            importLog  = lData.log        || [];
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">${escHtml(e.message)}</p></div>`;
            return;
        }

        showStep1(container, signal, categories, accounts, importLog);
    }

    /* ── Step 1: upload form ──────────────────────────────── */

    function showStep1(container, signal, categories, accounts, importLog) {
        const acctOptions = accounts.length
            ? accounts.map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join('')
            : '<option value="" disabled>No accounts — add one first</option>';

        container.innerHTML = `
            <div class="card">
                <h2 class="label-sm">Import Transactions</h2>
                <p class="import-intro">Upload a CSV export from Apple Card, Chase, or PNC. Transactions will be previewed before saving.</p>
                <div class="form-row">
                    <label for="import-account">Account</label>
                    <select id="import-account">${acctOptions}</select>
                </div>
                <div class="form-row">
                    <label for="import-file">CSV File</label>
                    <input type="file" id="import-file" accept=".csv,text/csv">
                </div>
                <p id="import-step1-error" class="error" style="display:none"></p>
                <button class="btn btn-primary btn-block" id="import-preview-btn" ${!accounts.length ? 'disabled' : ''}>
                    Upload &amp; Preview
                </button>
            </div>
            <div class="card">
                <h2 class="label-sm">Import History</h2>
                <div id="import-log-section"><p class="loading">Loading…</p></div>
            </div>
        `;

        // Render import history log
        const logSection = container.querySelector('#import-log-section');
        if (logSection) {
            if (!importLog.length) {
                logSection.innerHTML = '<p class="text-muted">No imports yet.</p>';
            } else {
                const formatLabels = { apple_card: 'Apple Card', chase: 'Chase', pnc: 'PNC' };
                logSection.innerHTML = `
                    <table class="import-log-table">
                        <thead>
                            <tr>
                                <th class="col-log-date">Date</th>
                                <th class="col-log-file">File</th>
                                <th class="col-log-count">Imported</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${importLog.map(r => `
                                <tr>
                                    <td class="col-log-date">${escHtml(formatDate(r.created_at.slice(0, 10)))}</td>
                                    <td class="col-log-file">
                                        <span class="log-filename">${escHtml(r.filename || '—')}</span>
                                        ${r.account_name ? `<span class="log-account">${escHtml(r.account_name)}</span>` : ''}
                                    </td>
                                    <td class="col-log-count">${r.imported} txn${r.imported !== 1 ? 's' : ''}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }
        }

        container.querySelector('#import-preview-btn').addEventListener('click', async () => {
            const accountId = container.querySelector('#import-account').value;
            const fileInput = container.querySelector('#import-file');
            const errEl     = container.querySelector('#import-step1-error');
            errEl.style.display = 'none';

            if (!accountId) { showErr(errEl, 'Select an account.'); return; }
            if (!fileInput.files.length) { showErr(errEl, 'Choose a CSV file.'); return; }

            const formData = new FormData();
            formData.append('account_id', accountId);
            formData.append('file', fileInput.files[0]);

            const btn = container.querySelector('#import-preview-btn');
            btn.disabled = true;
            btn.textContent = 'Parsing…';

            try {
                const data = await API.import.preview(formData, signal);
                if (data.format === 'unknown') {
                    const cols = (data.detected_columns || []).join(', ');
                    showErr(errEl, `Unrecognized CSV format. Detected columns: ${cols || '(none)'}. Expected Apple Card, Chase, or PNC format.`);
                    btn.disabled = false;
                    btn.textContent = 'Upload & Preview';
                    return;
                }
                if (!data.rows || data.rows.length === 0) {
                    showErr(errEl, 'No transactions found in this file.');
                    btn.disabled = false;
                    btn.textContent = 'Upload & Preview';
                    return;
                }
                showStep2(container, signal, categories, parseInt(accountId, 10), data, fileInput.files[0].name);
            } catch (e) {
                if (e.name === 'AbortError') return;
                btn.disabled = false;
                btn.textContent = 'Upload & Preview';
                showErr(errEl, e.message);
            }
        }, { signal });
    }

    /* ── Step 2: review table ─────────────────────────────── */

    function showStep2(container, signal, categories, accountId, previewData, filename) {
        const rows = previewData.rows;

        // Per-row mutable state
        const rowStates = rows.map(r => ({
            included:    !r.is_duplicate_flag,
            type:        r.suggested_type,
            category_id: r.suggested_category_id || null,
        }));

        // Build category options string once (no selected attr — set via .value after insert)
        const catOptsHTML = '<option value="">Uncategorized</option>'
            + categories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');

        const formatLabel = { apple_card: 'Apple Card', chase: 'Chase', pnc: 'PNC' }[previewData.format] || previewData.format;

        container.innerHTML = `
            <div class="card import-step2-header">
                <div class="import-step2-title-row">
                    <span class="import-format-badge">${escHtml(formatLabel)}</span>
                    <span id="import-counter" class="import-counter"></span>
                </div>
                <div class="import-bulk-actions">
                    <button class="btn btn-secondary import-bulk-btn" id="import-select-all">Select all</button>
                    <button class="btn btn-secondary import-bulk-btn" id="import-deselect-all">Deselect all</button>
                </div>
            </div>

            <div class="import-table-wrap">
                <table class="import-table">
                    <thead>
                        <tr>
                            <th class="col-check"></th>
                            <th class="col-date">Date</th>
                            <th class="col-merchant">Merchant</th>
                            <th class="col-category">Category</th>
                            <th class="col-amount">Amount</th>
                            <th class="col-type">Type</th>
                            <th class="col-flags"></th>
                        </tr>
                    </thead>
                    <tbody id="import-tbody"></tbody>
                </table>
            </div>

            <div class="card import-confirm-card">
                <p id="import-confirm-error" class="error" style="display:none"></p>
                <button class="btn btn-primary btn-block" id="import-confirm-btn">Import</button>
                <button class="btn btn-secondary btn-block" id="import-back-btn" style="margin-top:10px;">← Back</button>
            </div>
        `;

        const tbody = container.querySelector('#import-tbody');

        // Build all rows as one HTML string, then set values in a second pass
        tbody.innerHTML = rows.map((r, i) => {
            const state   = rowStates[i];
            const rowCls  = r.is_duplicate_flag ? ' row-dup' : r.is_transfer_flag ? ' row-xfer' : '';
            const exclCls = state.included ? '' : ' excluded';
            const dupBadge  = r.is_duplicate_flag ? '<span class="import-badge badge-dup">Duplicate</span>' : '';
            const xferBadge = r.is_transfer_flag   ? '<span class="import-badge badge-xfer">Transfer</span>' : '';

            return `<tr data-idx="${i}" class="import-row${rowCls}${exclCls}">
                <td class="col-check">
                    <input type="checkbox" class="import-include" data-idx="${i}"${state.included ? ' checked' : ''}>
                </td>
                <td class="col-date">${escHtml(formatDate(r.date))}</td>
                <td class="col-merchant" title="${escHtml(r.merchant)}">
                    <span class="import-merchant">${escHtml(r.merchant_clean || r.merchant)}</span>
                    ${r.merchant_clean && r.merchant_clean !== r.merchant
                        ? `<span class="merchant-raw">${escHtml(r.merchant)}</span>`
                        : ''}
                </td>
                <td class="col-category">
                    <select class="import-cat filter-select" data-idx="${i}">
                        ${catOptsHTML}
                    </select>
                </td>
                <td class="col-amount">${escHtml(formatCurrency(r.amount))}</td>
                <td class="col-type">
                    <select class="import-type filter-select" data-idx="${i}">
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="transfer">Transfer</option>
                    </select>
                </td>
                <td class="col-flags">${dupBadge}${xferBadge}</td>
            </tr>`;
        }).join('');

        // Second pass: set select values and wire up new-category option
        tbody.querySelectorAll('tr[data-idx]').forEach(tr => {
            const i     = parseInt(tr.dataset.idx, 10);
            const state = rowStates[i];
            const catSel  = tr.querySelector('.import-cat');
            const typeSel = tr.querySelector('.import-type');
            if (catSel  && state.category_id) catSel.value  = String(state.category_id);
            if (typeSel)                      typeSel.value = state.type;
            if (catSel) {
                setupNewCategoryOption(catSel, (cat) => {
                    // Also add the new category to all other rows' selects
                    tbody.querySelectorAll('.import-cat').forEach(sel => {
                        if (sel === catSel) return;
                        if (!sel.querySelector(`option[value="${cat.id}"]`)) {
                            const opt = document.createElement('option');
                            opt.value       = cat.id;
                            opt.textContent = cat.name;
                            const sentinel = sel.querySelector('option[value="__new__"]');
                            sel.insertBefore(opt, sentinel);
                        }
                    });
                    // Update row state
                    rowStates[i].category_id = cat.id;
                }, signal);
            }
        });

        function countIncluded() {
            return rowStates.filter(s => s.included).length;
        }

        function updateCounter() {
            const inc   = countIncluded();
            const excl  = rowStates.length - inc;
            const cEl   = container.querySelector('#import-counter');
            const cBtn  = container.querySelector('#import-confirm-btn');
            if (cEl)  cEl.textContent  = `${inc} to import · ${excl} excluded`;
            if (cBtn) cBtn.textContent = inc > 0 ? `Import ${inc} transactions` : 'Nothing to import';
        }

        updateCounter();

        // Event delegation: handle checkbox, category, and type changes for all rows
        tbody.addEventListener('change', e => {
            const tr = e.target.closest('tr[data-idx]');
            if (!tr) return;
            const i = parseInt(tr.dataset.idx, 10);

            if (e.target.classList.contains('import-include')) {
                rowStates[i].included = e.target.checked;
                tr.classList.toggle('excluded', !e.target.checked);
                updateCounter();
            } else if (e.target.classList.contains('import-cat')) {
                rowStates[i].category_id = e.target.value ? parseInt(e.target.value, 10) : null;
            } else if (e.target.classList.contains('import-type')) {
                rowStates[i].type = e.target.value;
            }
        }, { signal });

        // Select all / deselect all
        container.querySelector('#import-select-all').addEventListener('click', () => {
            rowStates.forEach(s => { s.included = true; });
            tbody.querySelectorAll('.import-include').forEach(cb => { cb.checked = true; });
            tbody.querySelectorAll('.import-row').forEach(tr => tr.classList.remove('excluded'));
            updateCounter();
        }, { signal });

        container.querySelector('#import-deselect-all').addEventListener('click', () => {
            rowStates.forEach(s => { s.included = false; });
            tbody.querySelectorAll('.import-include').forEach(cb => { cb.checked = false; });
            tbody.querySelectorAll('.import-row').forEach(tr => tr.classList.add('excluded'));
            updateCounter();
        }, { signal });

        // Back button
        container.querySelector('#import-back-btn').addEventListener('click', () => {
            render(container, signal);
        }, { signal });

        // Confirm button
        container.querySelector('#import-confirm-btn').addEventListener('click', async () => {
            const toImport = rowStates
                .map((s, i) => ({ ...s, ...rows[i] }))
                .filter(s => s.included);

            if (!toImport.length) {
                showErr(container.querySelector('#import-confirm-error'), 'No transactions selected.');
                return;
            }

            const payload = toImport.map(s => ({
                account_id:  accountId,
                category_id: s.category_id || null,
                merchant:    s.merchant,
                amount:      s.amount,
                type:        s.type,
                date:        s.date,
                filename:    filename || '',
                format:      previewData.format || '',
            }));

            const btn = container.querySelector('#import-confirm-btn');
            btn.disabled = true;
            btn.textContent = 'Importing…';

            try {
                const result = await API.import.confirm(payload, signal);
                showStep3(container, signal, result);
            } catch (e) {
                if (e.name === 'AbortError') return;
                btn.disabled = false;
                btn.textContent = `Import ${countIncluded()} transactions`;
                showErr(container.querySelector('#import-confirm-error'), e.message);
            }
        }, { signal });
    }

    /* ── Step 3: result ───────────────────────────────────── */

    function showStep3(container, signal, result) {
        const { imported, errors } = result;
        const errNote = errors > 0
            ? `<p class="import-result-note error">${errors} row${errors !== 1 ? 's' : ''} failed validation and were skipped.</p>`
            : '';

        container.innerHTML = `
            <div class="card import-result">
                <div class="import-result-icon">✓</div>
                <h2 class="import-result-heading">Import complete</h2>
                <p class="import-result-count">${imported} transaction${imported !== 1 ? 's' : ''} imported</p>
                ${errNote}
                <a href="#transactions" class="btn btn-primary btn-block" style="margin-top:24px;">View transactions</a>
                <button class="btn btn-secondary btn-block" id="import-another-btn" style="margin-top:10px;">Import another file</button>
            </div>
        `;

        container.querySelector('#import-another-btn').addEventListener('click', () => {
            render(container, signal);
        }, { signal });
    }

    /* ── util ─────────────────────────────────────────────── */

    function showErr(el, msg) {
        el.textContent = msg;
        el.style.display = '';
    }

    return { render };
})();
