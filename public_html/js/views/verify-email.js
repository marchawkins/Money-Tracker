const VerifyEmailView = (() => {

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
                        This verification link is invalid or has expired.
                    </p>
                    <a href="#login" class="btn btn-secondary btn-block">Back to Sign In</a>
                </div>
            `;
            return;
        }

        container.innerHTML = `<div class="card auth-card"><p class="loading">Verifying&hellip;</p></div>`;

        try {
            await API.auth.verifyEmail({ token });
            container.innerHTML = `
                <div class="card auth-card">
                    <h2>Email Verified</h2>
                    <p style="text-align:center;color:var(--color-muted);margin-bottom:var(--space);">
                        Your email has been verified. You can now sign in.
                    </p>
                    <a href="#login" class="btn btn-primary btn-block">Sign In</a>
                </div>
            `;
        } catch (ex) {
            container.innerHTML = `
                <div class="card auth-card">
                    <h2>Verification Failed</h2>
                    <p style="color:var(--color-muted);text-align:center;margin-bottom:var(--space);">
                        ${escHtml(ex.message)}
                    </p>
                    <a href="#login" class="btn btn-secondary btn-block">Back to Sign In</a>
                </div>
            `;
        }
    }

    return { render };
})();
