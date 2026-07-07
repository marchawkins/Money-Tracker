const SpendingChart = (() => {

    // months: [{ month: 'YYYY-MM', total_expenses, total_income }, ...]
    // options: {
    //   highlightMonth: 'YYYY-MM' | null | undefined
    //     — undefined (default): highlight the last bar (dashboard mode)
    //     — null: no bar highlighted
    //     — 'YYYY-MM': highlight that specific month
    //   onBarClick: function(month) | undefined
    // }
    function render(containerIdOrEl, months, options = {}) {
        const el = typeof containerIdOrEl === 'string'
            ? document.getElementById(containerIdOrEl)
            : containerIdOrEl;
        if (!el) return;

        el.innerHTML = buildSvg(months, options);

        if (typeof options.onBarClick === 'function') {
            el.querySelectorAll('.chart-bar').forEach(bar => {
                bar.style.cursor = 'pointer';
                bar.addEventListener('click', () => options.onBarClick(bar.dataset.month));
            });
        }
    }

    function buildSvg(months, options = {}) {
        if (!months || !months.length) {
            return '<p class="chart-empty">No data yet</p>';
        }

        const { highlightMonth, onBarClick } = options;

        const W = 360, H = 148;
        const padL = 8, padR = 8, padT = 20, padB = 28;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const n     = months.length;

        const maxVal = Math.max(...months.map(m => m.total_expenses), 1);

        const gap  = n > 6 ? 4 : 6;
        const barW = (plotW - gap * (n - 1)) / n;

        function xLeft(i) { return padL + i * (barW + gap); }
        function barH(v)   { return v > 0 ? Math.max((v / maxVal) * plotH, 2) : 0; }

        let bars   = '';
        let labels = '';

        months.forEach((m, i) => {
            const h = barH(m.total_expenses);
            const x = xLeft(i);
            const y = padT + plotH - h;

            // Highlight logic:
            //   highlightMonth === undefined → last bar (dashboard default)
            //   highlightMonth === null      → none
            //   highlightMonth === 'YYYY-MM' → matching bar
            const isHighlighted = highlightMonth === undefined
                ? i === months.length - 1
                : m.month === highlightMonth;

            const fill   = isHighlighted ? 'var(--accent)' : 'var(--line)';
            const cursor = onBarClick ? ' style="cursor:pointer"' : '';

            bars += `<rect class="chart-bar" data-month="${m.month}" `
                  + `x="${x.toFixed(1)}" y="${y.toFixed(1)}" `
                  + `width="${barW.toFixed(1)}" height="${h.toFixed(1)}" `
                  + `rx="3" fill="${fill}"${cursor}/>`;

            // Month labels: show abbreviation; for 12-month view, show every other if tight
            const showLabel = n <= 6 || i % 2 === 0 || i === n - 1;
            if (showLabel) {
                const abbr  = new Date(m.month + '-15').toLocaleDateString('en-US', { month: 'short' });
                const cx    = (x + barW / 2).toFixed(1);
                const color = isHighlighted ? 'var(--ink)' : 'var(--faint)';
                labels += `<text x="${cx}" y="${H - 5}" text-anchor="middle" `
                        + `font-size="9" fill="${color}">${abbr}</text>`;
            }
        });

        const maxLabel = formatCurrency(maxVal).replace(/\.00$/, '');

        return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" `
             + `aria-label="Spending chart" style="width:100%;display:block;">`
             + `<text x="${padL}" y="12" font-size="9" fill="var(--faint)">${maxLabel}</text>`
             + bars + labels
             + `</svg>`;
    }

    return { render };
})();
