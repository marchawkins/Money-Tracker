const InsightsView = (() => {

    const MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                         'Jul','Aug','Sep','Oct','Nov','Dec'];

    const STOP_WORDS = new Set([
        'a','an','and','at','all','any','did','do','does','for','from',
        'have','how','i','in','is','much','on','or','our','spend','spent',
        'that','the','this','to','us','was','we','were','what','with'
    ]);

    // ── NL Parser ──────────────────────────────────────────────────────────

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function parseQuery(text, categories, cleared) {
        let rem = text;
        const now = new Date();
        const result = {
            categoryId:   null,
            categoryName: null,
            monthNum:     null,
            yearNum:      null,
            merchant:     '',
        };

        // 1. Year (20xx)
        const yearM = rem.match(/\b(20\d{2})\b/);
        if (yearM) {
            result.yearNum = parseInt(yearM[1], 10);
            rem = rem.replace(yearM[0], ' ');
        }

        // 2. Relative month phrases
        if (!cleared.has('month')) {
            if (/\blast\s+month\b/i.test(rem)) {
                const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                result.monthNum = d.getMonth() + 1;
                result.yearNum  = result.yearNum || d.getFullYear();
                rem = rem.replace(/\blast\s+month\b/i, ' ');
            } else if (/\bthis\s+month\b/i.test(rem)) {
                result.monthNum = now.getMonth() + 1;
                result.yearNum  = result.yearNum || now.getFullYear();
                rem = rem.replace(/\bthis\s+month\b/i, ' ');
            } else {
                // Named months — full then short
                for (let i = 0; i < 12; i++) {
                    const re = new RegExp('\\b(' + MONTH_NAMES[i] + '|' + MONTH_SHORT[i] + ')\\b', 'i');
                    if (re.test(rem)) {
                        result.monthNum = i + 1;
                        result.yearNum  = result.yearNum || now.getFullYear();
                        rem = rem.replace(re, ' ');
                        break;
                    }
                }
            }
        }

        // 3. Category — longest name first for greedy match
        if (!cleared.has('category')) {
            const sorted = [...categories].sort((a, b) => b.name.length - a.name.length);
            for (const cat of sorted) {
                const norm = cat.name.toLowerCase();
                // Exact substring match
                if (rem.toLowerCase().includes(norm)) {
                    result.categoryId   = cat.id;
                    result.categoryName = cat.name;
                    rem = rem.replace(new RegExp(escapeRegex(norm), 'i'), ' ');
                    break;
                }
                // Fuzzy: any category word (>3 chars) found as whole word in query
                const catWords = norm.split(/\s+/).filter(w => w.length > 3);
                let matched = false;
                for (const cw of catWords) {
                    if (new RegExp('\\b' + escapeRegex(cw) + '\\b', 'i').test(rem)) {
                        result.categoryId   = cat.id;
                        result.categoryName = cat.name;
                        rem = rem.replace(new RegExp('\\b' + escapeRegex(cw) + '\\b', 'i'), ' ');
                        matched = true;
                        break;
                    }
                }
                if (matched) break;
            }
        }

        // 4. Merchant — remaining text minus stop words
        if (!cleared.has('merchant')) {
            result.merchant = rem.trim()
                .split(/\s+/)
                .filter(w => w.length > 0 && !STOP_WORDS.has(w.toLowerCase()))
                .join(' ')
                .trim();
        }

        return result;
    }

    // ── Date range helpers ─────────────────────────────────────────────────

    function monthRange(year, month) {
        const mm   = String(month).padStart(2, '0');
        const days = new Date(year, month, 0).getDate();
        return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${days}` };
    }

    function dateStr(d) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function computeDateRange(preset, customStart, customEnd) {
        const now = new Date();
        const cy  = now.getFullYear();
        const cm  = now.getMonth() + 1;
        switch (preset) {
            case 'this_month': return monthRange(cy, cm);
            case 'last_month': {
                const d = new Date(cy, cm - 2, 1);
                return monthRange(d.getFullYear(), d.getMonth() + 1);
            }
            case 'last_3mo': {
                const end   = new Date(cy, cm, 0);
                const start = new Date(cy, cm - 3, 1);
                return { start: dateStr(start), end: dateStr(end) };
            }
            case 'this_year':  return { start: `${cy}-01-01`, end: `${cy}-12-31` };
            case 'all_time':   return { start: null, end: null };
            case 'custom':     return { start: customStart || null, end: customEnd || null };
            default:           return { start: null, end: null };
        }
    }

    function presetLabel(preset, customStart, customEnd) {
        const now = new Date();
        const cy  = now.getFullYear();
        const cm  = now.getMonth() + 1;
        switch (preset) {
            case 'this_month': return MONTH_NAMES[cm - 1] + ' ' + cy;
            case 'last_month': {
                const d = new Date(cy, cm - 2, 1);
                return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
            }
            case 'last_3mo':  return 'Last 3 months';
            case 'this_year': return String(cy);
            case 'all_time':  return 'All time';
            case 'custom':    return (customStart || '?') + ' → ' + (customEnd || '?');
            default:          return '';
        }
    }

    // ── Main render ────────────────────────────────────────────────────────

    async function render(container, signal) {
        await loadYear(container, signal, new Date().getFullYear());
    }

    async function loadYear(container, signal, year) {
        container.innerHTML = `<p class="loading">Loading…</p>`;
        try {
            const [monthData, catData] = await Promise.all([
                API.reports.monthly(year, signal),
                API.categories.list(signal),
            ]);
            renderYear(container, signal, monthData, year, catData.categories || []);
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">${escHtml(e.message)}</p></div>`;
        }
    }

    function renderYear(container, signal, data, year, categories) {
        let selectedMonth = null;

        container.innerHTML = `
            <div class="card insights-search-card">
                <div class="insights-section-title">Search Spending</div>
                <div class="insights-search-wrap">
                    <input type="text" id="insights-search" class="insights-search-input"
                           placeholder="e.g. groceries in May, Wawa, restaurants last month…"
                           autocomplete="off" spellcheck="false">
                    <button class="insights-search-clear" id="search-clear" type="button"
                            aria-label="Clear search" hidden>&#10005;</button>
                </div>
                <div class="insights-chips" id="insights-chips"></div>
                <div class="insights-date-presets" id="date-presets">
                    <button class="insights-preset-btn" data-preset="this_month" type="button">This Month</button>
                    <button class="insights-preset-btn active" data-preset="last_month" type="button">Last Month</button>
                    <button class="insights-preset-btn" data-preset="last_3mo"    type="button">Last 3 Mo</button>
                    <button class="insights-preset-btn" data-preset="this_year"   type="button">This Year</button>
                    <button class="insights-preset-btn" data-preset="all_time"    type="button">All Time</button>
                    <button class="insights-preset-btn" data-preset="custom"      type="button">Custom…</button>
                </div>
                <div class="insights-custom-dates" id="custom-dates" hidden>
                    <input type="date" id="custom-start" class="insights-date-input">
                    <span class="insights-date-sep">to</span>
                    <input type="date" id="custom-end" class="insights-date-input">
                </div>
                <div id="search-results"></div>
            </div>

            <div class="insights-year-header">
                <button class="btn-icon" id="year-prev" type="button" aria-label="Previous year">&#8249;</button>
                <span class="insights-year-title">Insights for ${year}</span>
                <button class="btn-icon" id="year-next" type="button" aria-label="Next year">&#8250;</button>
            </div>

            <div class="card rpt-chart-card">
                <h2 class="label-sm">Expenses by Month</h2>
                <div id="monthly-chart"></div>
                <p class="insights-chart-hint" id="chart-hint">Click a bar to see that month&#8217;s breakdown</p>
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

            <div id="month-detail"></div>
        `;

        // Year totals
        const totals = data.months.reduce((acc, m) => {
            acc.income   += m.total_income;
            acc.expenses += m.total_expenses;
            return acc;
        }, { income: 0, expenses: 0 });
        const net    = totals.income - totals.expenses;
        const netCls = net >= 0 ? 'income' : 'expense';
        container.querySelector('#yr-income').textContent  = '+' + formatCurrency(totals.income);
        container.querySelector('#yr-expense').textContent = '−' + formatCurrency(totals.expenses);
        const netEl = container.querySelector('#yr-net');
        netEl.textContent = (net >= 0 ? '+' : '−') + formatCurrency(Math.abs(net));
        netEl.className   = 'total-value ' + netCls;

        // Chart
        function expandMonth(month) {
            selectedMonth = (selectedMonth === month) ? null : month;
            SpendingChart.render('monthly-chart', data.months, {
                highlightMonth: selectedMonth,
                onBarClick:     expandMonth,
            });
            const hint = container.querySelector('#chart-hint');
            if (hint) hint.style.display = selectedMonth ? 'none' : '';
            renderMonthDetail(container, data, year, selectedMonth);
        }

        SpendingChart.render('monthly-chart', data.months, {
            highlightMonth: null,
            onBarClick:     expandMonth,
        });

        // Year nav
        const nextBtn = container.querySelector('#year-next');
        if (year >= new Date().getFullYear()) nextBtn.hidden = true;

        container.querySelector('#year-prev').addEventListener('click', () => {
            loadYear(container, signal, year - 1);
        }, { signal });
        nextBtn.addEventListener('click', () => {
            loadYear(container, signal, year + 1);
        }, { signal });

        // Search
        setupSearch(container, signal, categories);
    }

    // ── Search ─────────────────────────────────────────────────────────────

    function setupSearch(container, signal, categories) {
        const input       = container.querySelector('#insights-search');
        const clearBtn    = container.querySelector('#search-clear');
        const chipsEl     = container.querySelector('#insights-chips');
        const resultsEl   = container.querySelector('#search-results');
        const customDates = container.querySelector('#custom-dates');
        const presetBtns  = container.querySelectorAll('.insights-preset-btn');

        let state = {
            rawQuery:    '',
            merchantQ:   '',
            categoryId:  null,
            categoryName: null,
            monthNum:    null,
            yearNum:     null,
            preset:      'last_month',
            customStart: '',
            customEnd:   '',
            cleared:     new Set(),   // slots suppressed by chip removal
        };

        let searchTimer = null;
        let searchAbort = null;

        // ── Run search ──────────────────────────────────────────────────

        function runSearch() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(async () => {
                if (searchAbort) searchAbort.abort();
                searchAbort = new AbortController();

                const params = new URLSearchParams();
                params.set('limit', '30');

                // Date: NL month wins over preset
                let range;
                if (state.monthNum) {
                    range = monthRange(state.yearNum || new Date().getFullYear(), state.monthNum);
                } else {
                    range = computeDateRange(state.preset, state.customStart, state.customEnd);
                }
                if (range.start) params.set('start', range.start);
                if (range.end)   params.set('end',   range.end);

                if (state.categoryId) params.set('category_id', String(state.categoryId));
                if (state.merchantQ)  params.set('q', state.merchantQ);

                resultsEl.innerHTML = `<p class="loading" style="padding:12px 0">Loading…</p>`;
                try {
                    const data = await API.transactions.list(params.toString(), searchAbort.signal);
                    renderSearchResults(resultsEl, data, state);
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    resultsEl.innerHTML = `<p class="error">${escHtml(e.message)}</p>`;
                }
            }, 200);
        }

        // ── Chips ───────────────────────────────────────────────────────

        function updateChips() {
            const chips = [];

            if (state.categoryName) {
                chips.push({ key: 'category', type: 'cat',
                    label: '📁 ' + state.categoryName });
            }
            if (state.monthNum) {
                const yr = state.yearNum || new Date().getFullYear();
                chips.push({ key: 'month', type: 'date',
                    label: '📅 ' + MONTH_NAMES[state.monthNum - 1] + ' ' + yr });
            } else if (chips.length > 0 || state.merchantQ) {
                // Show active date preset as a chip when query is active
                chips.push({ key: 'preset', type: 'date',
                    label: '📅 ' + presetLabel(state.preset, state.customStart, state.customEnd) });
            }
            if (state.merchantQ) {
                chips.push({ key: 'merchant', type: 'merchant',
                    label: '🔍 "' + state.merchantQ + '"' });
            }

            chipsEl.innerHTML = chips.map(c =>
                `<span class="insights-chip chip-${c.type}" data-key="${escHtml(c.key)}">
                    ${escHtml(c.label)}
                    ${c.key !== 'preset'
                        ? `<button class="chip-remove" type="button" aria-label="Remove filter">&#10005;</button>`
                        : ''}
                </span>`
            ).join('');
        }

        // ── Apply NL query ──────────────────────────────────────────────

        function applyQuery(raw) {
            state.rawQuery = raw;
            state.cleared  = new Set();   // re-enable all slots when user edits

            clearBtn.hidden = raw.length === 0;

            if (raw.trim() === '') {
                state.merchantQ    = '';
                state.categoryId   = null;
                state.categoryName = null;
                state.monthNum     = null;
                state.yearNum      = null;
            } else {
                const parsed = parseQuery(raw, categories, state.cleared);
                state.merchantQ    = parsed.merchant;
                state.categoryId   = parsed.categoryId;
                state.categoryName = parsed.categoryName;
                state.monthNum     = parsed.monthNum;
                state.yearNum      = parsed.yearNum;
            }
            updateChips();
            runSearch();
        }

        // ── Listeners ───────────────────────────────────────────────────

        input.addEventListener('input', () => applyQuery(input.value), { signal });

        clearBtn.addEventListener('click', () => {
            input.value = '';
            applyQuery('');
            input.focus();
        }, { signal });

        // Chip × removal — suppress that slot without clearing input
        chipsEl.addEventListener('click', e => {
            const btn = e.target.closest('.chip-remove');
            if (!btn) return;
            const key = btn.closest('.insights-chip').dataset.key;

            state.cleared.add(key);

            if (key === 'category') {
                state.categoryId   = null;
                state.categoryName = null;
            } else if (key === 'month') {
                state.monthNum = null;
                state.yearNum  = null;
            } else if (key === 'merchant') {
                state.merchantQ = '';
            }
            updateChips();
            runSearch();
        }, { signal });

        // Date presets — only run search if user has an active query
        function hasActiveQuery() {
            return state.rawQuery.trim().length > 0 || !!state.categoryId || !!state.merchantQ;
        }

        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.preset = btn.dataset.preset;
                presetBtns.forEach(b => b.classList.toggle('active', b === btn));
                customDates.hidden = state.preset !== 'custom';
                // If NL had parsed a month, clicking a preset overrides it
                if (state.monthNum) {
                    state.monthNum = null;
                    state.yearNum  = null;
                    state.cleared.add('month');
                    updateChips();
                }
                if (hasActiveQuery()) runSearch();
            }, { signal });
        });

        // Custom date inputs
        container.querySelector('#custom-start').addEventListener('input', e => {
            state.customStart = e.target.value;
            if (state.preset === 'custom') runSearch();
        }, { signal });
        container.querySelector('#custom-end').addEventListener('input', e => {
            state.customEnd = e.target.value;
            if (state.preset === 'custom') runSearch();
        }, { signal });

        // Results appear only when the user types or clicks a preset
    }

    // ── Search results renderer ────────────────────────────────────────────

    function renderSearchResults(container, data, state) {
        const txns   = data.transactions || [];
        const total  = parseInt(data.total, 10) || 0;
        const expAmt = parseFloat(data.expense_total) || 0;
        const incAmt = parseFloat(data.income_total)  || 0;

        if (total === 0) {
            container.innerHTML = `<p class="text-muted insights-no-results">No transactions found.</p>`;
            return;
        }

        // Prominent summary
        const amountItems = [];
        if (expAmt > 0) amountItems.push(`
            <div class="summary-item">
                <span class="summary-amount summary-expense">−${formatCurrency(expAmt)}</span>
                <span class="summary-item-label">spent</span>
            </div>`);
        if (incAmt > 0) amountItems.push(`
            <div class="summary-item">
                <span class="summary-amount summary-income">+${formatCurrency(incAmt)}</span>
                <span class="summary-item-label">received</span>
            </div>`);
        const countStr = `${total} transaction${total !== 1 ? 's' : ''}`;
        const moreNote = total > txns.length ? ` <span class="summary-more">(showing ${txns.length})</span>` : '';

        // Category breakdown — shown when a freetext q is active
        let matchBreakdownHTML = '';
        if (state.merchantQ && txns.length) {
            const q = state.merchantQ.toLowerCase();
            const catCounts  = {};
            const merchMatch = new Set();
            txns.forEach(t => {
                const cat = t.category_name || 'Uncategorized';
                catCounts[cat] = (catCounts[cat] || 0) + 1;
                if (t.merchant && t.merchant.toLowerCase().includes(q)) {
                    merchMatch.add(t.merchant);
                }
            });
            const catTags = Object.entries(catCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => `<span class="match-tag">${escHtml(name)}<span class="match-tag-count">${n}</span></span>`)
                .join('');
            matchBreakdownHTML = `<div class="match-breakdown">${catTags}</div>`;
        }

        // Collapsible transaction rows
        const rowsHTML = txns.map(t => {
            const sign = t.type === 'income' ? '+' : '−';
            const cls  = t.type === 'income' ? 'income' : t.type === 'transfer' ? 'transfer' : 'expense';
            const ret  = encodeURIComponent('#insights');
            return `<a href="#add?edit=${t.id}&return=${ret}" class="txn-row txn-row-link">
                <div class="txn-main">
                    <span class="txn-merchant">${escHtml(t.merchant || '—')}</span>
                    <span class="txn-amount ${cls}">${sign}${formatCurrency(t.amount)}</span>
                </div>
                <div class="txn-sub">
                    <span class="txn-cat">${escHtml(t.category_name || 'Uncategorized')}</span>
                    <span class="txn-date">${formatDate(t.date)}</span>
                </div>
            </a>`;
        }).join('');

        container.innerHTML = `
            <div class="insights-summary">
                <div class="summary-amounts">${amountItems.join('')}</div>
                <div class="summary-count">${countStr}${moreNote}</div>
                ${matchBreakdownHTML}
            </div>
            <button class="insights-txn-toggle" type="button" id="txn-toggle">
                Show transactions <span class="toggle-arrow">▼</span>
            </button>
            <div class="txn-list insights-txn-list" id="txn-list" hidden>
                ${rowsHTML}
            </div>
        `;

        // Wire up toggle
        const toggleBtn  = container.querySelector('#txn-toggle');
        const txnList    = container.querySelector('#txn-list');
        const arrowEl    = toggleBtn.querySelector('.toggle-arrow');
        toggleBtn.addEventListener('click', () => {
            const opening = txnList.hidden;
            txnList.hidden = !opening;
            arrowEl.textContent = opening ? '▲' : '▼';
            toggleBtn.firstChild.textContent = opening ? 'Hide transactions ' : 'Show transactions ';
        });
    }

    // ── Month detail (bar chart click) ─────────────────────────────────────

    function renderMonthDetail(container, data, year, selectedMonth) {
        const detailEl = container.querySelector('#month-detail');
        if (!detailEl) return;

        if (!selectedMonth) { detailEl.innerHTML = ''; return; }

        const monthData = data.months.find(m => m.month === selectedMonth);
        if (!monthData)  { detailEl.innerHTML = ''; return; }

        const monthIndex = parseInt(selectedMonth.split('-')[1], 10) - 1;
        const monthName  = MONTH_NAMES[monthIndex];
        const isEmpty    = monthData.total_expenses === 0 && monthData.total_income === 0;

        let catHTML = '';
        if (!isEmpty && monthData.categories && monthData.categories.length > 0) {
            const totalExp = monthData.total_expenses || 1;
            catHTML = monthData.categories.map(c => {
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
            }).join('');
            if (monthData.total_income > 0) {
                catHTML += `<div class="rpt-cat-row rpt-cat-income-row">
                    <span class="rpt-cat-name text-muted">Income</span>
                    <span></span>
                    <span class="rpt-cat-amount income">+${formatCurrency(monthData.total_income)}</span>
                    <span></span>
                </div>`;
            }
        } else if (!isEmpty) {
            catHTML = `<p class="text-muted rpt-no-cats">All transactions are uncategorized.</p>`;
        } else {
            catHTML = `<p class="text-muted rpt-no-cats">No transactions this month.</p>`;
        }

        detailEl.innerHTML = `
            <div class="card rpt-detail-card">
                <div class="rpt-detail-header">
                    <h2 class="label-sm">${escHtml(monthName)} ${year}</h2>
                    <a href="#transactions?month=${selectedMonth}" class="rpt-detail-link">View transactions &#8594;</a>
                </div>
                <div class="rpt-month-cats">${catHTML}</div>
                ${!isEmpty ? `
                <div class="rpt-detail-totals">
                    <span class="rpt-detail-expense">Expenses: ${formatCurrency(monthData.total_expenses)}</span>
                    <span class="rpt-detail-income">Income: +${formatCurrency(monthData.total_income)}</span>
                </div>` : ''}
            </div>
        `;
    }

    return { render };
})();
