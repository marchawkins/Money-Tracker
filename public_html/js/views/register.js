const RegisterView = (() => {

    async function render(container) {
        container.innerHTML = `
            <div class="card auth-card">
                <h2>Create Account</h2>
                <form id="register-form" novalidate>
                    <div class="form-row">
                        <label for="reg-name">Your name</label>
                        <input type="text" id="reg-name" name="display_name"
                               autocomplete="name" required>
                    </div>
                    <div class="form-row">
                        <label for="reg-email">Email</label>
                        <input type="email" id="reg-email" name="email"
                               autocomplete="email" inputmode="email" required>
                    </div>
                    <div class="form-row">
                        <label for="reg-password">Password</label>
                        <input type="password" id="reg-password" name="password"
                               autocomplete="new-password" required minlength="8">
                    </div>
                    <div class="form-row">
                        <label for="reg-confirm">Confirm password</label>
                        <input type="password" id="reg-confirm" name="confirm"
                               autocomplete="new-password" required>
                    </div>
                    <div id="reg-error" class="error" style="display:none;margin-bottom:12px;"></div>
                    <button type="submit" class="btn btn-primary btn-block">Create Account</button>
                </form>
                <div class="auth-links">
                    Already have an account? <a href="#login">Sign in</a>
                </div>
            </div>
        `;

        document.getElementById('reg-name').focus();

        document.getElementById('register-form').addEventListener('submit', async e => {
            e.preventDefault();
            const form = e.target;
            const btn  = form.querySelector('[type="submit"]');
            const err  = document.getElementById('reg-error');
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
            btn.textContent = 'Creating account…';

            const email = form.email.value.trim();

            try {
                await API.auth.register({
                    email,
                    display_name: form.display_name.value.trim(),
                    password:     form.password.value,
                });

                const main = document.getElementById('app-main');
                main.innerHTML = `
                    <div class="card auth-card">
                        <h2>Check Your Email</h2>
                        <p style="text-align:center;color:var(--color-muted);margin-bottom:var(--space);">
                            We sent a verification link to <strong>${escHtml(email)}</strong>.
                            Click the link to activate your account.
                        </p>
                        <a href="#login" class="btn btn-secondary btn-block">Back to Sign In</a>
                    </div>
                `;
            } catch (ex) {
                err.textContent   = escHtml(ex.message);
                err.style.display = 'block';
                btn.disabled    = false;
                btn.textContent = 'Create Account';
            }
        });
    }

    return { render };
})();
