const LoginView = (() => {

    async function render(container) {
        container.innerHTML = `
            <div class="card auth-card">
                <h2>Sign In</h2>
                <form id="login-form" novalidate>
                    <div class="form-row">
                        <label for="login-email">Email</label>
                        <input type="email" id="login-email" name="email"
                               autocomplete="email" inputmode="email" required>
                    </div>
                    <div class="form-row">
                        <label for="login-password">Password</label>
                        <input type="password" id="login-password" name="password"
                               autocomplete="current-password" required>
                    </div>
                    <div id="login-error" class="error" style="display:none;margin-bottom:12px;"></div>
                    <button type="submit" class="btn btn-primary btn-block">Sign In</button>
                </form>
                <div class="auth-links">
                    <a href="#forgot-password">Forgot password?</a>
                    &nbsp;&middot;&nbsp;
                    <a href="#register">Create account</a>
                </div>
            </div>
        `;

        document.getElementById('login-email').focus();

        document.getElementById('login-form').addEventListener('submit', async e => {
            e.preventDefault();
            const form = e.target;
            const btn  = form.querySelector('[type="submit"]');
            const err  = document.getElementById('login-error');
            err.style.display = 'none';
            btn.disabled    = true;
            btn.textContent = 'Signing in…';

            try {
                const user = await API.auth.login({
                    email:    form.email.value.trim(),
                    password: form.password.value,
                });
                App.setUser(user);
                window.location.hash = '#dashboard';
            } catch (ex) {
                err.textContent   = escHtml(ex.message);
                err.style.display = 'block';
                btn.disabled    = false;
                btn.textContent = 'Sign In';
            }
        });
    }

    return { render };
})();
