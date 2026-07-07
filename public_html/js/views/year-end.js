const YearEndView = (() => {

    async function render(container, signal) {
        await loadYear(container, signal, new Date().getFullYear());
    }

    async function loadYear(container, signal, year) {
        container.innerHTML = `<p class="loading">Loading…</p>`;
        try {
            const data = await API.reports.yearEnd(year, signal);
            renderReport(container, signal, data, year);
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">${escHtml(e.message)}</p></div>`;
        }
    }

    function renderReport(container, signal, data, year) {
        const cur  = data.current;
        const prev = data.previous;

        const incDelta = cur.total_income   - prev.total_income;
        const expDelta = cur.total_expenses - prev.total_expenses;
        const netDelta = cur.net            - prev.net;

        // Income up = good, expenses down = good
        const incClass = incDelta  >= 0 ? 'better' : 'worse';
        const expClass = expDelta  <= 0 ? 'better' : 'worse';
        const netClass = netDelta  >= 0 ? 'better' : 'worse';

        const savRate  = (cur.savings_rate * 100).toFixed(1);
        const prevRate = (prev.savings_rate * 100).toFixed(1);
        const rateDelta = cur.savings_rate - prev.savings_rate;
        const rateClass = rateDelta >= 0 ? 'better' : 'worse';

        const prevCatMap = {};
        prev.categories.forEach(c => { prevCatMap[c.category_name] = c.amount; });

        const notable = [];
        cur.categories.forEach(c => {
            const prevAmt = prevCatMap[c.category_name] ?? 0;
            const delta   = c.amount - prevAmt;
            const pct     = prevAmt > 0 ? delta / prevAmt : (c.amount > 0 ? 1 : 0);
            if (Math.abs(delta) >= 200 || Math.abs(pct) >= 0.2) {
                notable.push({ name: c.category_name, delta, pct, better: delta <= 0 });
            }
        });
        notable.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        const notableTop = notable.slice(0, 3);

        container.innerHTML = `
            <div class="dash-month-nav">
                <button class="btn-icon" id="ye-prev" type="button" aria-label="Previous year">&#8249;</button>
                <span class="dash-month-label">${year} Year-End</span>
                <button class="btn-icon" id="ye-next" type="button" aria-label="Next year">&#8250;</button>
            </div>

            <div class="card rpt-hero">
                <h2 class="label-sm">vs. ${year - 1}</h2>
                <div class="rpt-hero-row">
                    <div class="rpt-hero-item">
                        <span class="rpt-hero-label">Income</span>
                        <span class="rpt-hero-amount income">+${formatCurrency(cur.total_income)}</span>
                        <span class="rpt-hero-delta ${incClass}">${fmtDelta(incDelta)}</span>
                    </div>
                    <div class="rpt-hero-item">
                        <span class="rpt-hero-label">Expenses</span>
                        <span class="rpt-hero-amount expense">&#8722;${formatCurrency(cur.total_expenses)}</span>
                        <span class="rpt-hero-delta ${expClass}">${fmtDeltaExp(expDelta)}</span>
                    </div>
                    <div class="rpt-hero-item">
                        <span class="rpt-hero-label">Net</span>
                        <span class="rpt-hero-amount ${cur.net >= 0 ? 'income' : 'expense'}">${cur.net >= 0 ? '+' : '&#8722;'}${formatCurrency(Math.abs(cur.net))}</span>
                        <span class="rpt-hero-delta ${netClass}">${fmtDelta(netDelta)}</span>
                    </div>
                </div>
                <div class="rpt-savings-rate">
                    Savings rate: <strong>${savRate}%</strong>
                    <span class="rpt-hero-delta ${rateClass}">${rateDelta >= 0 ? '+' : ''}${(rateDelta * 100).toFixed(1)}pp vs ${prevRate}%</span>
                </div>
            </div>

            ${notableTop.length > 0 ? `
            <div class="card">
                <h2 class="label-sm">Notable Changes</h2>
                <ul class="rpt-notable-list">
                    ${notableTop.map(n => `<li class="${n.better ? 'better' : 'worse'}">
                        <strong>${escHtml(n.name)}</strong>
                        ${n.delta >= 0 ? '+' : ''}${formatCurrency(n.delta)}
                        (${n.pct >= 0 ? '+' : ''}${(n.pct * 100).toFixed(0)}%)
                    </li>`).join('')}
                </ul>
            </div>` : ''}

            <div class="card">
                <h2 class="label-sm">Spending by Category</h2>
                <table class="rpt-table">
                    <thead>
                        <tr>
                            <th>Category</th>
                            <th>${year}</th>
                            <th>${year - 1}</th>
                            <th>Change</th>
                        </tr>
                    </thead>
                    <tbody>${buildCategoryRows(cur.categories, prevCatMap)}</tbody>
                </table>
            </div>

            <div class="card">
                <h2 class="label-sm">Top Merchants</h2>
                ${cur.top_merchants.length === 0
                    ? '<p class="text-muted">No data.</p>'
                    : `<ol class="rpt-merchant-list">
                        ${cur.top_merchants.map(m =>
                            `<li class="rpt-merchant-row">
                                <span class="rpt-merchant-name">${escHtml(m.merchant)}</span>
                                <span class="rpt-merchant-count">${m.txn_count} txn${m.txn_count !== 1 ? 's' : ''}</span>
                                <span class="rpt-merchant-amount">${formatCurrency(m.amount)}</span>
                            </li>`
                        ).join('')}
                    </ol>`
                }
            </div>

            <div class="card rpt-monthly-link">
                <a href="#insights" class="link">&#8592; Insights for ${year}</a>
            </div>
        `;

        container.querySelector('#ye-prev').addEventListener('click', () => {
            loadYear(container, signal, year - 1);
        }, { signal });

        container.querySelector('#ye-next').addEventListener('click', () => {
            loadYear(container, signal, year + 1);
        }, { signal });
    }

    function buildCategoryRows(cats, prevMap) {
        if (!cats.length) return `<tr><td colspan="4" class="text-muted">No expenses.</td></tr>`;

        const seen = new Set();
        const rows = [];

        cats.forEach(c => {
            seen.add(c.category_name);
            const prevAmt = prevMap[c.category_name] ?? 0;
            const delta   = c.amount - prevAmt;
            rows.push({ name: c.category_name, cur: c.amount, prev: prevAmt, delta });
        });

        Object.entries(prevMap).forEach(([name, amt]) => {
            if (!seen.has(name) && amt > 0) {
                rows.push({ name, cur: 0, prev: amt, delta: -amt });
            }
        });

        return rows.map(r => {
            const cls = r.delta === 0 ? '' : (r.delta <= 0 ? 'better' : 'worse');
            return `<tr>
                <td>${escHtml(r.name)}</td>
                <td>${r.cur  > 0 ? formatCurrency(r.cur)  : '&#8212;'}</td>
                <td>${r.prev > 0 ? formatCurrency(r.prev) : '&#8212;'}</td>
                <td class="${cls}">${r.delta === 0 ? '&#8212;' : (r.delta > 0 ? '+' : '') + formatCurrency(r.delta)}</td>
            </tr>`;
        }).join('');
    }

    function fmtDelta(delta) {
        if (delta === 0) return '&#8212;';
        return (delta > 0 ? '+' : '&#8722;') + formatCurrency(Math.abs(delta));
    }

    function fmtDeltaExp(delta) {
        // For expenses: show raw delta direction, but caller applies correct CSS class
        return fmtDelta(delta);
    }

    return { render };
})();
