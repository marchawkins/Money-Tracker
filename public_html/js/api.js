const API = (() => {
    let _onUnauthorized = null;

    async function request(method, path, body, signal) {
        const opts = { method };
        if (body instanceof FormData) {
            opts.body = body; // browser sets Content-Type + boundary automatically
        } else {
            opts.headers = { 'Content-Type': 'application/json' };
            if (body !== undefined) opts.body = JSON.stringify(body);
        }
        if (signal) opts.signal = signal;

        const res  = await fetch('/api' + path, opts);
        const data = await res.json();

        if (res.status === 401 && !path.startsWith('/auth')) {
            if (_onUnauthorized) _onUnauthorized();
            throw new Error('Session expired. Please sign in.');
        }

        if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
        return data;
    }

    return {
        onUnauthorized: (cb) => { _onUnauthorized = cb; },

        auth: {
            me:             (signal) => request('GET',  '/auth/me', undefined, signal),
            login:          (data)   => request('POST', '/auth/login', data),
            register:       (data)   => request('POST', '/auth/register', data),
            logout:         ()       => request('POST', '/auth/logout'),
            forgotPassword: (data)   => request('POST', '/auth/forgot-password', data),
            resetPassword:  (data)   => request('POST', '/auth/reset-password', data),
            verifyEmail:    (data)   => request('POST', '/auth/verify-email', data),
        },

        dashboard: {
            get: (params, signal) => request('GET', '/dashboard' + (params ? '?' + params : ''), undefined, signal),
        },
        reports: {
            monthly: (year, signal) => request('GET', '/reports/monthly?year=' + year, undefined, signal),
            yearEnd: (year, signal) => request('GET', '/reports/year-end?year=' + year, undefined, signal),
        },
        transactions: {
            list:   (params, signal) => request('GET',    '/transactions' + (params ? '?' + params : ''), undefined, signal),
            get:    (id,     signal) => request('GET',    '/transactions/' + id, undefined, signal),
            create: (data)           => request('POST',   '/transactions', data),
            update: (id, data)       => request('PUT',    '/transactions/' + id, data),
            remove: (id)             => request('DELETE', '/transactions/' + id),
        },
        budgets: {
            list:   (params, signal) => request('GET',    '/budgets' + (params ? '?' + params : ''), undefined, signal),
            save:   (data)           => request('POST',   '/budgets', data),
            remove: (id)             => request('DELETE', '/budgets/' + id),
        },
        categories: {
            list:   (signal) => request('GET',    '/categories', undefined, signal),
            create: (data)   => request('POST',   '/categories', data),
            update: (id, data) => request('PUT',  '/categories/' + id, data),
            remove: (id)     => request('DELETE', '/categories/' + id),
        },
        accounts: {
            list:   (signal) => request('GET',    '/accounts', undefined, signal),
            create: (data)   => request('POST',   '/accounts', data),
            update: (id, data) => request('PUT',  '/accounts/' + id, data),
            remove: (id)     => request('DELETE', '/accounts/' + id),
        },
        merchants: {
            list:         (signal)    => request('GET',    '/merchants', undefined, signal),
            autocomplete: (q, signal) => request('GET',    '/merchants/autocomplete?q=' + encodeURIComponent(q), undefined, signal),
            update:       (id, data)  => request('PUT',    '/merchants/' + id, data),
            remove:       (id)        => request('DELETE', '/merchants/' + id),
        },
        import: {
            preview: (formData, signal) => request('POST', '/import/preview', formData, signal),
            confirm: (data,     signal) => request('POST', '/import/confirm', data,     signal),
            log:     (signal)           => request('GET',  '/import/log', undefined,    signal),
        },
        profile: {
            get:            (signal) => request('GET', '/profile', undefined, signal),
            save:           (data)   => request('PUT', '/profile', data),
            changePassword: (data)   => request('PUT', '/profile/password', data),
        },
    };
})();
