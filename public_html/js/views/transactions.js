const TransactionsView = (() => {

    async function render(container, signal) {
        // Load filter options
        let categories = [], accounts = [];
        try {
            const [cData, aData] = await Promise.all([
                API.categories.list(signal),
                API.accounts.list(signal),
            ]);
            categories = cData.categories || [];
            accounts   = aData.accounts   || [];
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">Failed to load: ${escHtml(e.message)}</p></div>`;
            return;
        }

        // Default to current month, but restore from URL if present (?month=YYYY-MM)
        const now     = new Date();
        const qs      = window.location.hash.split('?')[1] || '';
        const qsMonth = new URLSearchParams(qs).get('month');
        let year  = qsMonth ? parseInt(qsMonth.slice(0, 4), 10) : now.getFullYear();
        let month = qsMonth ? parseInt(qsMonth.slice(5, 7), 10) : now.getMonth() + 1;

        function updateHashMonth() {
            const m = `${year}-${String(month).padStart(2, '0')}`;
            const newHash = '#transactions?month=' + m;
            history.replaceState(null, '', newHash);
        }

        const catOpts  = `<option value="">All categories</option>` +
            categories.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
        const acctOpts = `<option value="">All accounts</option>` +
            accounts.map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join('');

        container.innerHTML = `
            <div class="card filter-card">
                <div class="month-nav">
                    <button class="btn-icon" id="month-prev" type="button" aria-label="Previous month">&#8249;</button>
                    <span class="month-label" id="month-label"></span>
                    <button class="btn-icon" id="month-next" type="button" aria-label="Next month">&#8250;</button>
                </div>
                <div class="filter-row">
                    <select id="filter-type" class="filter-select">
                        <option value="">All types</option>
                        <option value="expense">Expenses</option>
                        <option value="income">Income</option>
                        <option value="transfer">Transfers</option>
                    </select>
                    <select id="filter-category" class="filter-select">${catOpts}</select>
                    <select id="filter-account"  class="filter-select">${acctOpts}</select>
                </div>
            </div>
            <div id="txn-body"></div>
        `;

        const LIMIT = 25;
        let offset    = 0;
        let total     = 0;
        let busy      = false;

        function getStart() {
            return `${year}-${String(month).padStart(2,'0')}-01`;
        }
        function getEnd() {
            const lastDay = new Date(year, month, 0).getDate();
            return `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
        }
        function getMonthLabel() {
            return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }

        function buildParams() {
            const p = new URLSearchParams({
                start:  getStart(),
                end:    getEnd(),
                limit:  String(LIMIT),
                offset: String(offset),
            });
            const type = container.querySelector('#filter-type').value;
            const cat  = container.querySelector('#filter-category').value;
            const acct = container.querySelector('#filter-account').value;
            if (type) p.set('type', type);
            if (cat)  p.set('category_id', cat);
            if (acct) p.set('account_id', acct);
            return p.toString();
        }

        async function loadTxns(reset) {
            if (busy) return;
            busy = true;
            if (reset) {
                offset = 0;
                container.querySelector('#txn-body').innerHTML = `<p class="loading">Loading…</p>`;
            }
            try {
                const data = await API.transactions.list(buildParams(), signal);
                const txns = data.transactions || [];
                total = data.total || 0;

                if (reset) {
                    renderBody(txns, data);
                } else {
                    appendRows(txns);
                }
                offset += txns.length;
                updateLoadMore();
            } catch (e) {
                if (e.name === 'AbortError') return;
                container.querySelector('#txn-body').innerHTML =
                    `<p class="error" style="padding:16px 0;">${escHtml(e.message)}</p>`;
            } finally {
                busy = false;
            }
        }

        function renderBody(txns, data) {
            const body = container.querySelector('#txn-body');
            if (!txns.length) {
                body.innerHTML = `<div class="card"><p class="text-muted" style="text-align:center;padding:32px 0;">No transactions this month.</p></div>`;
                return;
            }
            body.innerHTML = `
                ${buildTotalsHTML(data)}
                <div class="card txn-list" id="txn-rows"></div>
                <div id="load-more-wrap"></div>
            `;
            const rowsEl = body.querySelector('#txn-rows');
            txns.forEach(t => rowsEl.appendChild(makeRow(t)));
        }

        function appendRows(txns) {
            const rowsEl = container.querySelector('#txn-rows');
            if (!rowsEl) return;
            txns.forEach(t => rowsEl.appendChild(makeRow(t)));
        }

        function makeRow(t) {
            const div = document.createElement('div');
            div.className = 'txn-row';
            div.dataset.id = t.id;

            const typeClass = t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'expense';
            const sign      = t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '−';
            const amtStr    = sign + formatCurrency(t.amount);

            div.innerHTML = `
                <div class="txn-info">
                    <span class="txn-merchant">${escHtml(t.merchant || '—')}</span>
                    <span class="txn-meta">${buildMeta(t)}</span>
                </div>
                <div class="txn-right">
                    <span class="txn-amount ${typeClass}">${escHtml(amtStr)}</span>
                    <span class="txn-date">${escHtml(formatDate(t.date))}</span>
                </div>
            `;
            div.addEventListener('click', () => {
                window.location.hash = '#add?edit=' + t.id + '&return=' + encodeURIComponent(window.location.hash);
            });
            return div;
        }

        function buildMeta(t) {
            const parts = [];
            if (t.category_name) parts.push(escHtml(t.category_name));
            if (t.account_name)  parts.push(escHtml(t.account_name));
            return parts.join(' · ') || '';
        }

        function buildTotalsHTML(data) {
            const income   = data.income_total   || 0;
            const expense  = data.expense_total  || 0;
            const net      = income - expense;
            const netClass = net >= 0 ? 'income' : 'expense';
            const netSign  = net >= 0 ? '+' : '−';
            return `
                <div class="card txn-totals">
                    <div class="totals-row">
                        <div class="total-item">
                            <span class="total-label">Income</span>
                            <span class="total-value income">+${escHtml(formatCurrency(income))}</span>
                        </div>
                        <div class="total-item">
                            <span class="total-label">Expenses</span>
                            <span class="total-value expense">−${escHtml(formatCurrency(expense))}</span>
                        </div>
                        <div class="total-item">
                            <span class="total-label">Net</span>
                            <span class="total-value ${netClass}">${netSign}${escHtml(formatCurrency(Math.abs(net)))}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        function updateLoadMore() {
            const wrap = container.querySelector('#load-more-wrap');
            if (!wrap) return;
            if (offset >= total) {
                wrap.innerHTML = '';
                return;
            }
            wrap.innerHTML = `<button class="btn btn-secondary btn-block" id="load-more-btn">Load more</button>`;
            wrap.querySelector('#load-more-btn').addEventListener('click', () => loadTxns(false));
        }

        // Wire up controls
        container.querySelector('#month-prev').addEventListener('click', () => {
            if (--month < 1) { month = 12; year--; }
            container.querySelector('#month-label').textContent = getMonthLabel();
            updateHashMonth();
            loadTxns(true);
        }, { signal });

        container.querySelector('#month-next').addEventListener('click', () => {
            if (++month > 12) { month = 1; year++; }
            container.querySelector('#month-label').textContent = getMonthLabel();
            updateHashMonth();
            loadTxns(true);
        }, { signal });

        ['#filter-type', '#filter-category', '#filter-account'].forEach(sel => {
            container.querySelector(sel).addEventListener('change', () => loadTxns(true), { signal });
        });

        container.querySelector('#month-label').textContent = getMonthLabel();
        updateHashMonth();
        loadTxns(true);
    }

    return { render };
})();
