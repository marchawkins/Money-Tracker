function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
}

function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
    }).format(amount);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    // Append T00:00:00 to avoid timezone shift when parsing YYYY-MM-DD
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Attaches "＋ New category…" behaviour to a <select> element.
// When the user picks that option, a small modal appears to name the category.
// On save, the new category is created via the API, added to the select,
// and selected. onCreated(category) is called with { id, name }.
// Pass signal to clean up listeners on navigation.
function setupNewCategoryOption(selectEl, onCreated, signal) {
    // Add the sentinel option if not already present
    if (!selectEl.querySelector('option[value="__new__"]')) {
        const opt = document.createElement('option');
        opt.value = '__new__';
        opt.textContent = '＋ New category…';
        selectEl.appendChild(opt);
    }

    let prevValue = '';

    selectEl.addEventListener('change', () => {
        if (selectEl.value === '__new__') {
            showNewCategoryModal(selectEl, prevValue, onCreated);
        } else {
            prevValue = selectEl.value;
        }
    }, { signal });

    // Track last valid value so modal cancel can restore it
    selectEl.addEventListener('focus', () => {
        if (selectEl.value !== '__new__') prevValue = selectEl.value;
    }, { signal });
}

function showNewCategoryModal(selectEl, prevValue, onCreated) {
    // Remove any existing modal
    document.querySelector('.new-cat-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'new-cat-modal-overlay';
    overlay.innerHTML = `
        <div class="new-cat-modal">
            <h3 class="new-cat-modal-title">New Category</h3>
            <input type="text" class="new-cat-modal-input" placeholder="Category name" maxlength="100">
            <p class="new-cat-modal-error error" style="display:none"></p>
            <div class="new-cat-modal-actions">
                <button type="button" class="btn btn-secondary new-cat-cancel">Cancel</button>
                <button type="button" class="btn btn-primary new-cat-save">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input    = overlay.querySelector('.new-cat-modal-input');
    const saveBtn  = overlay.querySelector('.new-cat-save');
    const cancelBtn = overlay.querySelector('.new-cat-cancel');
    const errEl    = overlay.querySelector('.new-cat-modal-error');

    // Focus input after paint
    requestAnimationFrame(() => input.focus());

    function closeModal() {
        overlay.remove();
        selectEl.value = prevValue;
    }

    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    async function saveNewCategory() {
        const name = input.value.trim();
        if (!name) { input.focus(); return; }

        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        errEl.style.display = 'none';

        try {
            const data = await API.categories.create({ name });
            const cat  = data.category;

            // Add the new option to the select just before the __new__ sentinel
            const newOpt = document.createElement('option');
            newOpt.value       = cat.id;
            newOpt.textContent = cat.name;
            const sentinel = selectEl.querySelector('option[value="__new__"]');
            selectEl.insertBefore(newOpt, sentinel);
            selectEl.value = cat.id;

            overlay.remove();
            if (onCreated) onCreated(cat);
        } catch (e) {
            errEl.textContent   = e.message;
            errEl.style.display = '';
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save';
        }
    }

    saveBtn.addEventListener('click', saveNewCategory);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); saveNewCategory(); }
        if (e.key === 'Escape') { closeModal(); }
    });
}
