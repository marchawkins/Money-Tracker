const BudgetsView = (() => {

    async function render(container, signal) {
        container.innerHTML = `<p class="loading">Loading…</p>`;

        const now          = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const displayMonth = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

        try {
            const [catData, budgetData] = await Promise.all([
                API.categories.list(signal),
                API.budgets.list('month=' + currentMonth, signal),
            ]);

            const categories = catData.categories   || [];
            const budgets    = budgetData.budgets    || [];

            const budgetMap = {};
            budgets.forEach(b => { budgetMap[b.category_id] = b; });

            renderForm(container, signal, categories, budgetMap, currentMonth, displayMonth);
        } catch (e) {
            if (e.name === 'AbortError') return;
            container.innerHTML = `<div class="card"><p class="error">${escHtml(e.message)}</p></div>`;
        }
    }

    function renderForm(container, signal, categories, budgetMap, currentMonth, displayMonth) {
        const originals = {};
        categories.forEach(c => {
            originals[c.id] = budgetMap[c.id] ? String(budgetMap[c.id].amount) : '';
        });

        container.innerHTML = `
            <div class="view-narrow">
            <div class="card bgt-header-card">
                <h2 class="section-title">Budget Manager</h2>
                <p class="bgt-note">
                    Changes apply from <strong>${escHtml(displayMonth)}</strong> forward.
                    Historical months are unaffected.
                </p>
            </div>

            <div class="card">
                <div class="bgt-list" id="budget-list">
                    ${categories.map(c => {
                        const budget = budgetMap[c.id];
                        const val    = budget ? budget.amount : '';
                        return `<div class="bgt-row" data-id="${c.id}" data-budget-id="${budget ? budget.id : ''}">
                            <span class="bgt-cat-name">${escHtml(c.name)}</span>
                            <div class="bgt-input-wrap">
                                <span class="bgt-currency">$</span>
                                <input type="number" class="bgt-input" min="0" step="0.01"
                                    value="${escHtml(String(val))}"
                                    placeholder="No budget"
                                    aria-label="Monthly budget for ${escHtml(c.name)}">
                                ${budget
                                    ? `<button class="bgt-remove" type="button" data-id="${c.id}" aria-label="Remove budget for ${escHtml(c.name)}">&#10005;</button>`
                                    : ''}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>

            <div class="bgt-footer">
                <p id="bgt-feedback" class="bgt-feedback" aria-live="polite"></p>
                <button class="btn btn-primary" id="bgt-save" type="button">Save Changes</button>
            </div>
            </div>
        `;

        const saveBtn    = container.querySelector('#bgt-save');
        const feedbackEl = container.querySelector('#bgt-feedback');

        // Per-row remove (×) button — removes the effective budget entry
        container.querySelector('#budget-list').addEventListener('click', async (e) => {
            const removeBtn = e.target.closest('.bgt-remove');
            if (!removeBtn) return;

            const catId = parseInt(removeBtn.dataset.id, 10);
            const row   = container.querySelector(`.bgt-row[data-id="${catId}"]`);
            const budgetId = parseInt(row.dataset.budgetId, 10);
            if (!budgetId) return;

            removeBtn.disabled = true;
            try {
                await API.budgets.remove(budgetId);
                delete budgetMap[catId];
                row.dataset.budgetId = '';
                originals[catId]     = '';
                row.querySelector('.bgt-input').value = '';
                removeBtn.remove();
                showFeedback(feedbackEl, 'Budget removed.', false);
            } catch (err) {
                showFeedback(feedbackEl, err.message, true);
                removeBtn.disabled = false;
            }
        }, { signal });

        saveBtn.addEventListener('click', async () => {
            saveBtn.disabled    = true;
            saveBtn.textContent = 'Saving…';
            feedbackEl.textContent = '';
            feedbackEl.className   = 'bgt-feedback';

            const rows  = container.querySelectorAll('.bgt-row');
            const tasks = [];

            rows.forEach(row => {
                const catId    = parseInt(row.dataset.id, 10);
                const input    = row.querySelector('.bgt-input');
                const rawVal   = input.value.trim();
                const origVal  = originals[catId];

                if (rawVal === origVal) return;

                const amount = parseFloat(rawVal);
                if (!rawVal || isNaN(amount) || amount <= 0) return; // blank = skip

                tasks.push(
                    API.budgets.save({
                        category_id:     catId,
                        amount:          amount,
                        effective_month: currentMonth,
                    }).then(data => {
                        const b = data.budget;
                        budgetMap[catId]     = b;
                        row.dataset.budgetId = b.id;
                        originals[catId]     = String(b.amount);

                        // Add remove button if not already present
                        const wrap = row.querySelector('.bgt-input-wrap');
                        if (!wrap.querySelector('.bgt-remove')) {
                            const btn = document.createElement('button');
                            btn.className   = 'bgt-remove';
                            btn.type        = 'button';
                            btn.dataset.id  = catId;
                            btn.setAttribute('aria-label', `Remove budget for ${row.querySelector('.bgt-cat-name').textContent}`);
                            btn.innerHTML   = '&#10005;';
                            wrap.appendChild(btn);
                        }
                    })
                );
            });

            if (tasks.length === 0) {
                showFeedback(feedbackEl, 'No changes to save.', false);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save Changes';
                return;
            }

            try {
                await Promise.all(tasks);
                showFeedback(feedbackEl, `Saved ${tasks.length} budget${tasks.length !== 1 ? 's' : ''}.`, false);
            } catch (err) {
                showFeedback(feedbackEl, err.message, true);
            }

            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save Changes';
        }, { signal });
    }

    function showFeedback(el, msg, isError) {
        el.textContent = msg;
        el.className   = 'bgt-feedback' + (isError ? ' error' : ' success');
    }

    return { render };
})();
