const DashboardView = (() => {

    function greeting() {
        const h = new Date().getHours();
        if (h >= 5  && h < 12) return 'Good morning';
        if (h >= 12 && h < 17) return 'Good afternoon';
        return 'Good evening';
    }

    function monthLabel(year, month) {
        return new Date(year, month - 1, 1)
            .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    async function render(container, signal) {
        const now    = new Date();
        const qs     = window.location.hash.split('?')[1] || '';
        const qsMonth = new URLSearchParams(qs).get('month');
        let year  = qsMonth ? parseInt(qsMonth.slice(0, 4), 10) : now.getFullYear();
        let month = qsMonth ? parseInt(qsMonth.slice(5, 7), 10) : now.getMonth() + 1;

        async function load() {
            const mStr = `${year}-${String(month).padStart(2, '0')}`;
            history.replaceState(null, '', '#dashboard?month=' + mStr);
            container.innerHTML = `<p class="loading">Loading…</p>`;
            try {
                const data = await API.dashboard.get('month=' + mStr, signal);
                renderContent(data);
            } catch (e) {
                if (e.name === 'AbortError') return;
                container.innerHTML = `<div class="card"><p class="error">${escHtml(e.message)}</p></div>`;
            }
        }

        function renderContent(data) {
            const { summary, budget_progress, unbudgeted_total,
                    recent_transactions, monthly_trend, display_name } = data;

            const net      = summary.net;
            const netClass = net >= 0 ? 'income' : 'expense';
            const netSign  = net >= 0 ? '+' : '−';

            // vs-last-month delta on net
            const trend = monthly_trend || [];
            let deltaHTML = '';
            if (trend.length >= 2) {
                const prev      = trend[trend.length - 2];
                const prevNet   = prev.total_income - prev.total_expenses;
                const delta     = net - prevNet;
                const dSign     = delta >= 0 ? '+' : '−';
                const dClass    = delta >= 0 ? 'income' : 'expense';
                deltaHTML = `<span class="dash-delta ${dClass}">`
                          + `${dSign}${escHtml(formatCurrency(Math.abs(delta)))} vs last month`
                          + `</span>`;
            }

            // Budget progress items
            function buildBudgetItems(items) {
                return items.map(b => {
                    const pct      = b.budget_amount > 0
                        ? Math.min((b.spent / b.budget_amount) * 100, 100)
                        : 0;
                    const overCls  = b.over_budget ? ' over' : '';
                    const pctOfBudget = b.budget_amount > 0
                        ? Math.round((b.spent / b.budget_amount) * 100)
                        : 0;
                    const pctLabel = b.spent > 0
                        ? ` <span class="budget-cat-pct${pctOfBudget > 100 ? ' over' : ''}">(${pctOfBudget > 0 ? pctOfBudget + '%' : '<1%'})</span>`
                        : '';
                    const catLabel = (b.parent_category_name
                        ? `${escHtml(b.parent_category_name)}: ${escHtml(b.category_name)}`
                        : escHtml(b.category_name)) + pctLabel;
                    return `<div class="budget-item" data-cat-id="${b.category_id}">
                        <div class="budget-item-header">
                            <span class="budget-cat${overCls}">${catLabel}</span>
                            <div class="budget-item-right">
                                <span class="budget-amounts${overCls}">${escHtml(formatCurrency(b.spent))} of ${escHtml(formatCurrency(b.budget_amount))}</span>
                                <svg class="budget-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                            </div>
                        </div>
                        <div class="progress-bar-track">
                            <div class="progress-bar-fill${overCls}" style="width:${pct.toFixed(1)}%"></div>
                        </div>
                        <div class="budget-accordion" hidden></div>
                    </div>`;
                }).join('');
            }

            function sortBudgets(items, key) {
                const copy = [...items];
                if (key === 'budget') return copy.sort((a, b) => b.budget_amount - a.budget_amount);
                if (key === 'spent')  return copy.sort((a, b) => b.spent - a.spent);
                // alpha — sort by display label
                return copy.sort((a, b) => {
                    const la = (a.parent_category_name ? a.parent_category_name + ': ' : '') + a.category_name;
                    const lb = (b.parent_category_name ? b.parent_category_name + ': ' : '') + b.category_name;
                    return la.localeCompare(lb);
                });
            }

            const hasBudgets = budget_progress && budget_progress.length;
            const unbudgetedFooter = (hasBudgets && unbudgeted_total > 0)
                ? `<p class="budget-unbudgeted">+ ${escHtml(formatCurrency(unbudgeted_total))} in unbudgeted categories</p>`
                : '';

            // Recent transactions
            let recentHTML = '';
            if (recent_transactions && recent_transactions.length) {
                recentHTML = recent_transactions.map(t => {
                    const typeCls = t.type === 'income'   ? 'income'
                                  : t.type === 'transfer' ? 'transfer'
                                  : 'expense';
                    const sign    = t.type === 'income'   ? '+'
                                  : t.type === 'transfer' ? ''
                                  : '−';
                    const amtStr  = sign + formatCurrency(t.amount);
                    const meta    = [t.category_name, t.account_name]
                        .filter(Boolean).map(escHtml).join(' · ');
                    return `<div class="txn-row" data-id="${t.id}">
                        <div class="txn-info">
                            <span class="txn-merchant">${escHtml(t.merchant || '—')}</span>
                            ${meta ? `<span class="txn-meta">${meta}</span>` : ''}
                        </div>
                        <div class="txn-right">
                            <span class="txn-amount ${typeCls}">${escHtml(amtStr)}</span>
                            <span class="txn-date">${escHtml(formatDate(t.date))}</span>
                        </div>
                    </div>`;
                }).join('');
            } else {
                recentHTML = `<p class="text-muted" style="padding:12px 0 4px;">No transactions yet.</p>`;
            }

            container.innerHTML = `
                <div class="dash-month-nav">
                    <button class="btn-icon" id="dash-prev" type="button" aria-label="Previous month">&#8249;</button>
                    <span class="dash-month-label">${escHtml(monthLabel(year, month))}</span>
                    <button class="btn-icon" id="dash-next" type="button" aria-label="Next month">&#8250;</button>
                </div>

                <div class="card dash-hero">
                    <p class="dash-greeting">${escHtml(greeting())}${display_name ? ', ' + escHtml(display_name) : ''}</p>
                    <span class="dash-hero-label">Net Cash Flow</span>
                    <span class="dash-hero-amount ${netClass}">${netSign}${escHtml(formatCurrency(Math.abs(net)))}</span>
                    ${deltaHTML}
                    <div class="dash-summary-row">
                        <div class="dash-summary-item">
                            <span class="dash-summary-label">Income</span>
                            <span class="dash-summary-value income">+${escHtml(formatCurrency(summary.total_income))}</span>
                        </div>
                        <div class="dash-summary-item">
                            <span class="dash-summary-label">Spent</span>
                            <span class="dash-summary-value expense">−${escHtml(formatCurrency(summary.total_expenses))}</span>
                        </div>
                    </div>
                </div>

                <div class="card dash-budgets">
                    <div class="dash-budgets-header">
                        <h2 class="label-sm">Budget Progress</h2>
                        ${hasBudgets ? `<select id="budget-sort" class="budget-sort-select">
                            <option value="alpha">A → Z</option>
                            <option value="budget">Budget ↓</option>
                            <option value="spent">Spent ↓</option>
                        </select>` : ''}
                    </div>
                    <div id="budget-items">${hasBudgets ? buildBudgetItems(sortBudgets(budget_progress, 'alpha')) : '<p class="text-muted budget-empty">No budgets set yet. <a href="#budgets" class="link">Set up budgets →</a></p>'}</div>
                    ${unbudgetedFooter}
                </div>

                <div class="card dash-recent">
                    <h2 class="label-sm">Recent</h2>
                    <div class="txn-list">${recentHTML}</div>
                    <a href="#transactions" class="btn btn-secondary btn-block">View all transactions</a>
                </div>
            `;

            // Budget sort
            const sortSel = container.querySelector('#budget-sort');
            if (sortSel) {
                sortSel.addEventListener('change', () => {
                    container.querySelector('#budget-items').innerHTML =
                        buildBudgetItems(sortBudgets(budget_progress, sortSel.value));
                }, { signal });
            }

            // Budget accordion — lazy-load transactions per category
            const txnCache = {};
            const budgetsCard = container.querySelector('.dash-budgets');
            if (budgetsCard) {
                budgetsCard.addEventListener('click', async (e) => {
                    const item = e.target.closest('.budget-item[data-cat-id]');
                    if (!item) return;

                    const catId     = item.dataset.catId;
                    const accordion = item.querySelector('.budget-accordion');
                    const isOpen    = !accordion.hidden;

                    if (isOpen) {
                        accordion.hidden = true;
                        item.classList.remove('open');
                        return;
                    }

                    item.classList.add('open');
                    accordion.hidden = false;

                    // Serve from cache on repeat opens
                    if (txnCache[catId]) {
                        accordion.innerHTML = txnCache[catId];
                        wireAccordionRows(accordion);
                        return;
                    }

                    accordion.innerHTML = `<p class="budget-acc-msg">Loading…</p>`;

                    const mStr    = `${year}-${String(month).padStart(2, '0')}`;
                    const lastDay = new Date(year, month, 0).getDate();
                    const start   = `${mStr}-01`;
                    const end     = `${mStr}-${String(lastDay).padStart(2, '0')}`;

                    try {
                        const data = await API.transactions.list(
                            `category_id=${catId}&start=${start}&end=${end}&limit=100`, signal
                        );
                        const txns = data.transactions || [];

                        if (!txns.length) {
                            txnCache[catId] = `<p class="budget-acc-msg">No transactions this month.</p>`;
                        } else {
                            txnCache[catId] = txns.map(t => {
                                const sign   = t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '−';
                                const amtCls = t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'expense';
                                return `<div class="budget-acc-row" data-id="${t.id}">
                                    <span class="budget-acc-merchant">${escHtml(t.merchant || '—')}</span>
                                    <span class="budget-acc-right">
                                        <span class="budget-acc-amount ${amtCls}">${escHtml(sign + formatCurrency(t.amount))}</span>
                                        <span class="budget-acc-date">${escHtml(formatDate(t.date))}</span>
                                    </span>
                                </div>`;
                            }).join('');
                        }

                        accordion.innerHTML = txnCache[catId];
                        wireAccordionRows(accordion);
                    } catch (err) {
                        if (err.name === 'AbortError') return;
                        accordion.innerHTML = `<p class="budget-acc-msg error">Failed to load.</p>`;
                    }
                }, { signal });
            }

            function wireAccordionRows(accordion) {
                accordion.querySelectorAll('.budget-acc-row[data-id]').forEach(row => {
                    row.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.location.hash = '#add?edit=' + row.dataset.id + '&return=' + encodeURIComponent(window.location.hash);
                    }, { signal });
                });
            }

            // Recent transaction row → edit
            container.querySelectorAll('.txn-row[data-id]').forEach(row => {
                row.addEventListener('click', () => {
                    window.location.hash = '#add?edit=' + row.dataset.id + '&return=' + encodeURIComponent(window.location.hash);
                }, { signal });
            });

            // Month navigation
            container.querySelector('#dash-prev').addEventListener('click', () => {
                if (--month < 1) { month = 12; year--; }
                load();
            }, { signal });

            container.querySelector('#dash-next').addEventListener('click', () => {
                if (++month > 12) { month = 1; year++; }
                load();
            }, { signal });
        }

        await load();
    }

    return { render };
})();
