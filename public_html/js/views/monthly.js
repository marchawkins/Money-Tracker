const MonthlyView = (() => {

    const MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                         'Jul','Aug','Sep','Oct','Nov','Dec'];

    async function render(container, signal) {
        await loadYear(container, signal, new Date().getFullYear());
    }

    async function loadYear(container, signal, year) {
        container.innerHTML = `<p class="loading">Loading…</p>`;
        try {
            const data = await API.reports.monthly(year, signal);
            renderYear(container, signal, data, year);
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">${escHtml(e.message)}</p></div>`;
        }
    }

    function renderYear(container, signal, data, year) {
        let selectedMonth = null;

        container.innerHTML = `
            <div class="dash-month-nav">
                <button class="btn-icon" id="year-prev" type="button" aria-label="Previous year">&#8249;</button>
                <span class="dash-month-label">${year}</span>
                <button class="btn-icon" id="year-next" type="button" aria-label="Next year">&#8250;</button>
            </div>

            <div class="card rpt-chart-card">
                <h2 class="label-sm">Expenses by Month</h2>
                <div id="monthly-chart"></div>
            </div>

            <div class="card rpt-totals-card">
                <div class="totals-row">
                    <div class="total-item">
                        <span class="total-label">Income</span>
                        <span class="total-value income" id="yr-income">—</span>
                    </div>
                    <div class="total-item">
                        <span class="total-label">Expenses</span>
                        <span class="total-value expense" id="yr-expense">—</span>
                    </div>
                    <div class="total-item">
                        <span class="total-label">Net</span>
                        <span class="total-value" id="yr-net">—</span>
                    </div>
                </div>
            </div>

            <div class="card rpt-ye-link">
                <a href="#year-end" class="link">Year-End Summary for ${year} &#8594;</a>
            </div>

            <div id="months-list"></div>
        `;

        // Compute year totals
        const totals = data.months.reduce(
            (acc, m) => {
                acc.income   += m.total_income;
                acc.expenses += m.total_expenses;
                return acc;
            },
            { income: 0, expenses: 0 }
        );
        const net    = totals.income - totals.expenses;
        const netCls = net >= 0 ? 'income' : 'expense';
        container.querySelector('#yr-income').textContent  = '+' + formatCurrency(totals.income);
        container.querySelector('#yr-expense').textContent = '−' + formatCurrency(totals.expenses);
        const netEl = container.querySelector('#yr-net');
        netEl.textContent = (net >= 0 ? '+' : '−') + formatCurrency(Math.abs(net));
        netEl.className = 'total-value ' + netCls;

        function expandMonth(month) {
            selectedMonth = (selectedMonth === month) ? null : month;
            SpendingChart.render('monthly-chart', data.months, {
                highlightMonth: selectedMonth,
                onBarClick:     expandMonth,
            });
            renderMonthList(container, signal, data, year, selectedMonth, expandMonth);
        }

        SpendingChart.render('monthly-chart', data.months, {
            highlightMonth: null,
            onBarClick:     expandMonth,
        });

        renderMonthList(container, signal, data, year, selectedMonth, expandMonth);

        container.querySelector('#year-prev').addEventListener('click', () => {
            loadYear(container, signal, year - 1);
        }, { signal });

        container.querySelector('#year-next').addEventListener('click', () => {
            loadYear(container, signal, year + 1);
        }, { signal });
    }

    function renderMonthList(container, signal, data, year, selectedMonth, onExpand) {
        const list = container.querySelector('#months-list');
        if (!list) return;

        const now             = new Date();
        const isCurrentYear   = year === now.getFullYear();
        const currentMonthNum = now.getMonth() + 1;

        list.innerHTML = data.months.map((m, i) => {
            const monthNum  = i + 1;
            const isFuture  = isCurrentYear && monthNum > currentMonthNum;
            const isEmpty   = m.total_expenses === 0 && m.total_income === 0;
            const isExpanded = selectedMonth === m.month;

            const netCls  = m.net >= 0 ? 'income' : 'expense';
            const netSign = m.net >= 0 ? '+' : '−';

            let catHTML = '';
            if (isExpanded) {
                if (m.categories.length > 0) {
                    const totalExp = m.total_expenses || 1;
                    catHTML = `<div class="rpt-month-cats">` +
                        m.categories.map(c => {
                            const pct        = ((c.amount / totalExp) * 100).toFixed(0);
                            const overBudget = c.budget_amount != null && c.amount > c.budget_amount;
                            const budgetNote = c.budget_amount != null
                                ? `<span class="rpt-cat-budget${overBudget ? ' over' : ''}">of ${formatCurrency(c.budget_amount)}</span>`
                                : '';
                            return `<div class="rpt-cat-row">
                                <span class="rpt-cat-name">${escHtml(c.category_name)}</span>
                                <span class="rpt-cat-pct">${pct}%</span>
                                <span class="rpt-cat-amount${overBudget ? ' over' : ''}">${formatCurrency(c.amount)}</span>
                                ${budgetNote}
                            </div>`;
                        }).join('') +
                        (m.total_income > 0 ? `<div class="rpt-cat-income-row">
                            <span class="rpt-cat-name text-muted">Income</span>
                            <span></span>
                            <span class="rpt-cat-amount income">+${formatCurrency(m.total_income)}</span>
                            <span></span>
                        </div>` : '') +
                        `</div>`;
                } else if (!isEmpty) {
                    catHTML = `<div class="rpt-month-cats"><p class="text-muted rpt-no-cats">All transactions are uncategorized.</p></div>`;
                }
            }

            return `<div class="card rpt-month-row${isExpanded ? ' expanded' : ''}${isFuture ? ' future' : ''}" data-month="${m.month}">
                <div class="rpt-month-header">
                    <span class="rpt-month-name">${MONTH_SHORT[i]}</span>
                    <span class="rpt-month-figures">
                        <span class="rpt-figure-expense">${isEmpty || isFuture ? '' : '−' + formatCurrency(m.total_expenses)}</span>
                        <span class="rpt-figure-income">${isEmpty || isFuture ? '' : '+' + formatCurrency(m.total_income)}</span>
                    </span>
                    <span class="rpt-month-net ${isEmpty || isFuture ? 'empty' : netCls}">
                        ${isFuture ? '—' : isEmpty ? '—' : netSign + formatCurrency(Math.abs(m.net))}
                    </span>
                    <span class="rpt-chevron">${isExpanded ? '▲' : '▼'}</span>
                </div>
                ${catHTML}
            </div>`;
        }).join('');

        list.querySelectorAll('.rpt-month-row').forEach(row => {
            row.addEventListener('click', () => onExpand(row.dataset.month), { signal });
        });
    }

    return { render };
})();
