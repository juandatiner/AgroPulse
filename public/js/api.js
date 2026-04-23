const API = {
    token: localStorage.getItem('agropulse_token'),
    user: JSON.parse(localStorage.getItem('agropulse_user') || 'null'),

    setSession(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('agropulse_token', token);
        localStorage.setItem('agropulse_user', JSON.stringify(user));
    },

    clearSession() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('agropulse_token');
        localStorage.removeItem('agropulse_user');
    },

    async request(method, path, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (this.token) opts.headers['Authorization'] = 'Bearer ' + this.token;
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch('/api' + path, opts);
        let data;
        try { data = await res.json(); } catch { throw new Error('Error del servidor — revisa la conexión'); }
        if (res.status === 401 && this.token && path !== '/login' && path !== '/register' && path !== '/logout') {
            this.handleSessionInvalidated();
            const err = new Error('Tu sesión fue cerrada');
            err.status = 401;
            err.code = 'session_invalid';
            throw err;
        }
        if (!res.ok) {
            const err = new Error(data?.message || data?.error || 'Error del servidor');
            err.status = res.status;
            err.code = data?.error || '';
            err.data = data;
            throw err;
        }
        return data;
    },

    handleSessionInvalidated() {
        if (this._sessionKilled) return;
        this._sessionKilled = true;
        this.clearSession();
        try { if (typeof Chat !== 'undefined' && Chat.stopGlobalPolling) Chat.stopGlobalPolling(); } catch {}
        try { if (typeof Chat !== 'undefined' && Chat.stopPolling) Chat.stopPolling(); } catch {}
        try { if (typeof Subscription !== 'undefined') Subscription.state = null; } catch {}
        document.querySelectorAll('.sub-overlay').forEach(el => el.classList.remove('visible'));
        document.body.classList.remove('no-scroll');
        const overlay = document.getElementById('detail-overlay');
        if (overlay) overlay.style.display = 'none';
        const chatO = document.getElementById('chat-overlay');
        if (chatO) chatO.style.display = 'none';
        if (typeof App !== 'undefined' && App.showScreen) {
            App.showScreen('screen-login');
            if (App.showToast) App.showToast('Tu sesión finalizó. Inicia sesión de nuevo.', 'error');
        } else {
            location.reload();
        }
        setTimeout(() => { this._sessionKilled = false; }, 5000);
    },

    // Auth
    register(data) { return this.request('POST', '/register', data).then(r => { this.setSession(r.token, r.user); return r; }); },
    login(data) { return this.request('POST', '/login', data).then(r => { this.setSession(r.token, r.user); return r; }); },
    logout() { return this.request('POST', '/logout').then(() => this.clearSession()); },

    // Resources
    getResources(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.request('GET', '/resources' + (qs ? '?' + qs : ''));
    },
    getResource(id) { return this.request('GET', '/resources/' + id); },
    createResource(data) { return this.request('POST', '/resources', data); },
    updateResource(id, data) { return this.request('PUT', '/resources/' + id, data); },
    deleteResource(id) { return this.request('DELETE', '/resources/' + id); },

    // Agreements
    getAgreements(params = {}) {
        const qs = new URLSearchParams(params).toString();
        return this.request('GET', '/agreements' + (qs ? '?' + qs : ''));
    },
    getAgreement(id) { return this.request('GET', '/agreements/' + id); },
    createAgreement(data) { return this.request('POST', '/agreements', data); },
    updateAgreement(id, data) { return this.request('PUT', '/agreements/' + id, data); },
    rateAgreement(id, rating, comment = '') { return this.request('POST', '/agreements/' + id + '/rate', { rating, comment }); },

    // Messages
    getMessages(agreementId) { return this.request('GET', '/agreements/' + agreementId + '/messages'); },
    sendMessage(agreementId, content) { return this.request('POST', '/agreements/' + agreementId + '/messages', { content }); },

    // Poll
    poll(since) { return this.request('GET', '/poll?since=' + encodeURIComponent(since || '2000-01-01')); },

    // Users
    getProfile() { return this.request('GET', '/users/me'); },
    updateProfile(data) { return this.request('PUT', '/users/me', data).then(u => { this.user = u; localStorage.setItem('agropulse_user', JSON.stringify(u)); return u; }); },
    getUser(id) { return this.request('GET', '/users/' + id); },

    // Subscription & billing
    getSubscription() { return this.request('GET', '/subscription'); },
    checkout(data) { return this.request('POST', '/billing/checkout', data); },
    getInvoices() { return this.request('GET', '/billing/invoices'); },

    // Matches (pro)
    getMatches() { return this.request('GET', '/matches'); },

    // Support
    getSupportTickets() { return this.request('GET', '/support'); },
    getSupportTicket(id) { return this.request('GET', '/support/' + id); },
    createSupportTicket(data) { return this.request('POST', '/support', data); },
    replySupport(id, message) { return this.request('POST', '/support/' + id, { message }); },
};
