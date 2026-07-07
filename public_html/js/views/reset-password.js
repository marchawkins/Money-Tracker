const ResetPasswordView = (() => {

    function getToken() {
        const qs = window.location.hash.split('?')[1] || '';
        return new URLSearchParams(qs).get('token') || '';
    }

    async function render(container) {
        const token = getToken();

        if (!token) {
            container.innerHTML = `
                <div class="card auth-card">
                    <h2>Invalid Link</h2>
                    <p style="color:var(--color-muted);text-align:center;margin-bottom:var(--space);">
                        This password reset link is invalid or has expired.
                    </p>
                    <a href="#forgot-password" class="btn btn-secondary btn-block">Request a new link</a>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="card auth-card">
                <h2>Set New Password</h2>
                <form id="reset-form" novalidate>
                    <div class="form-row">
                        <label for="reset-password">New password</label>
                        <input type="password" id="reset-password" name="password"
                               autocomplete="new-password" required minlength="8">
                    </div>
                    <div class="form-row">
                        <label for="reset-confirm">Confirm password</label>
                        <input type="password" id="reset-confirm" name="confirm"
                               autocomplete="new-password" required>
                    </div>
                    <div id="reset-error" class="error" style="display:none;margin-bottom:12px;"></div>
                    <button type="submit" class="btn btn-primary btn-block">Set Password</button>
                </form>
            </div>
        `;

        document.getElementById('reset-password').focus();

        document.getElementById('reset-form').addEventListener('submit', async e => {
            e.preventDefault();
            const form = e.target;
            const btn  = form.querySelector('[type="submit"]');
            const err  = document.getElementById('reset-error');
            err.style.display = 'none';

            if (form.password.value !== form.confirm.value) {
                err.textContent   = 'Passwords do not match';
                err.style.display = 'block';
                return;
            }
            if (form.password.value.length < 8) {
                err.textContent   = 'Password must be at least 8 characters';
                err.style.display = 'block';
                return;
            }

            btn.disabled    = true;
            btn.textContent = 'Saving…';

            try {
                await API.auth.resetPassword({ token, password: form.password.value });
                const main = document.getElementById('app-main');
                main.innerHTML = `
                    <div class="card auth-card">
                        <h2>Password Updated</h2>
                        <p style="text-align:center;color:var(--color-muted);margin-bottom:var(--space);">
                            Your password has been set. You can now sign in.
                        </p>
                        <a href="#login" class="btn btn-primary btn-block">Sign In</a>
                    </div>
                `;
            } catch (ex) {
                err.textContent   = escHtml(ex.message);
                err.style.display = 'block';
                btn.disabled    = false;
                btn.textContent = 'Set Password';
            }
        });
    }

    return { render };
})();
