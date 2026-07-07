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
        const now = new Date();
        let year  = now.getFullYear();
        let month = now.getMonth() + 1;

        async function load() {
            const mStr = `${year}-${String(month).padStart(2, '0')}`;
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
            let budgetHTML = '';
            if (budget_progress && budget_progress.length) {
                budgetHTML = budget_progress.map(b => {
                    const pct      = b.budget_amount > 0
                        ? Math.min((b.spent / b.budget_amount) * 100, 100)
                        : 0;
                    const overCls  = b.over_budget ? ' over' : '';
                    return `<div class="budget-item">
                        <div class="budget-item-header">
                            <span class="budget-cat${overCls}">${escHtml(b.category_name)}</span>
                            <span class="budget-amounts${overCls}">${escHtml(formatCurrency(b.spent))} of ${escHtml(formatCurrency(b.budget_amount))}</span>
                        </div>
                        <div class="progress-bar-track">
                            <div class="progress-bar-fill${overCls}" style="width:${pct.toFixed(1)}%"></div>
                        </div>
                    </div>`;
                }).join('');
                if (unbudgeted_total > 0) {
                    budgetHTML += `<p class="budget-unbudgeted">+ ${escHtml(formatCurrency(unbudgeted_total))} in unbudgeted categories</p>`;
                }
            } else {
                budgetHTML = `<p class="text-muted budget-empty">No budgets set yet. <a href="#budgets" class="link">Set up budgets →</a></p>`;
            }

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
                    <a href="#add" class="btn btn-primary btn-block dash-add-btn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                        Add Transaction
                    </a>
                </div>

                <div class="card dash-budgets">
                    <h2 class="label-sm">Budget Progress</h2>
                    ${budgetHTML}
                </div>

                <div class="card dash-trend">
                    <h2 class="label-sm">6-Month Spending</h2>
                    <div id="dash-chart"></div>
                </div>

                <div class="card dash-recent">
                    <h2 class="label-sm">Recent</h2>
                    <div class="txn-list">${recentHTML}</div>
                    <a href="#transactions" class="btn btn-secondary btn-block">View all transactions</a>
                </div>
            `;

            // Draw chart
            if (trend.length) {
                SpendingChart.render('dash-chart', trend);
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
