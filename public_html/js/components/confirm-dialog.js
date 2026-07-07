const ConfirmDialog = (() => {

    // Accepts either a string shorthand or an options object.
    // Always returns a Promise<boolean> and also calls onConfirm/onCancel if provided.
    function show(opts = {}) {
        if (typeof opts === 'string') opts = { title: opts };

        const {
            title       = '',
            message     = '',
            confirmText = 'Confirm',
            cancelText  = 'Cancel',
            onConfirm,
            onCancel,
        } = opts;

        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'dialog-overlay';
            overlay.innerHTML = `
                <div class="dialog" role="dialog" aria-modal="true">
                    <h3 class="dialog-title">${escHtml(title)}</h3>
                    ${message ? `<p class="dialog-message">${escHtml(message)}</p>` : ''}
                    <div class="dialog-actions">
                        <button class="btn btn-secondary" id="dlg-cancel">${escHtml(cancelText)}</button>
                        <button class="btn btn-danger"    id="dlg-confirm">${escHtml(confirmText)}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            function close(confirmed) {
                overlay.remove();
                if (confirmed && onConfirm) onConfirm();
                if (!confirmed && onCancel) onCancel();
                resolve(confirmed);
            }

            overlay.querySelector('#dlg-cancel').addEventListener('click',  () => close(false));
            overlay.querySelector('#dlg-confirm').addEventListener('click', () => close(true));
            overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
            overlay.querySelector('#dlg-confirm').focus();
        });
    }

    return { show };
})();
