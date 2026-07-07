const App = (() => {
    let currentUser  = null;
    let navController = null;

    const AUTH_VIEWS = new Set(['login', 'register', 'forgot-password', 'reset-password', 'verify-email']);

    const views = {
        'dashboard':    DashboardView,
        'add':          AddTransactionView,
        'transactions': TransactionsView,
        'insights':     InsightsView,
        'year-end':     YearEndView,
        'budgets':      BudgetsView,
        'import':       ImportView,
        'profile':      ProfileView,
        'login':           LoginView,
        'register':        RegisterView,
        'forgot-password': ForgotPasswordView,
        'reset-password':  ResetPasswordView,
        'verify-email':    VerifyEmailView,
    };

    function currentViewName() {
        const hash = window.location.hash.replace('#', '').split('?')[0];
        return views[hash] ? hash : 'dashboard';
    }

    function setNavVisible(visible) {
        const nav  = document.getElementById('app-nav');
        const main = document.getElementById('app-main');
        if (nav)  nav.style.display = visible ? '' : 'none';
        if (main) main.classList.toggle('no-nav', !visible);
    }

    async function navigate() {
        const name   = currentViewName();
        const isAuth = AUTH_VIEWS.has(name);
        const view   = views[name];

        if (!currentUser && !isAuth) {
            window.location.hash = '#login';
            return;
        }

        if (currentUser && isAuth && name !== 'verify-email') {
            window.location.hash = '#dashboard';
            return;
        }

        setNavVisible(!!currentUser);

        document.querySelectorAll('.nav-item, .header-icon-btn').forEach(el => {
            el.classList.toggle('active', el.dataset.view === name);
        });

        if (navController) navController.abort();
        navController = new AbortController();
        const signal = navController.signal;

        const main = document.getElementById('app-main');
        main.innerHTML = '';
        main.scrollTop = 0;

        try {
            await view.render(main, signal);
        } catch (err) {
            if (err.name === 'AbortError') return;
            main.innerHTML = `<div class="card"><p class="error">Failed to load: ${escHtml(err.message)}</p></div>`;
        }
    }

    function setUser(user) {
        currentUser = user;
    }

    async function init() {
        API.onUnauthorized(() => {
            currentUser = null;
            window.location.hash = '#login';
        });

        window.addEventListener('hashchange', navigate);

        document.getElementById('page-title').addEventListener('click', () => {
            window.location.hash = currentUser ? '#dashboard' : '#login';
        });

        try {
            currentUser = await API.auth.me();
        } catch (_) {
            currentUser = null;
        }

        navigate();
    }

    return { init, setUser, getUser: () => currentUser };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
