const App = {
    currentTab: 'inicio',
    currentFilter: 'todos',
    currentCatFilter: '',
    currentMunFilter: '',
    currentSortFilter: 'recent',
    currentAgreementFilter: 'todos',
    currentPublishType: 'oferta',
    currentMyPubFilter: 'todos',
    _myResourcesCache: [],

    ICONS: {
        'Herramientas y maquinaria': 'wrench',
        'Semillas e insumos': 'wheat',
        'Fertilizantes y abonos': 'flask-conical',
        'Mano de obra': 'hard-hat',
        'Ganadería': 'beef',
        'Excedentes de producción': 'package',
        'Otros recursos': 'boxes',
    },
    TYPE_ICONS: { oferta: 'package-check', solicitud: 'hand', prestamo: 'key', trueque: 'repeat' },
    TYPE_LABELS: { oferta: 'Oferta', solicitud: 'Solicitud', prestamo: 'Préstamo', trueque: 'Trueque' },

    // ===== INIT =====
    init() {
        if (API.token && API.user) {
            this.showApp();
        } else {
            this.showScreen('screen-landing');
            this.loadLandingTrialInfo();
        }
        this.bindEvents();
    },

    async loadLandingTrialInfo() {
        const box = document.getElementById('landing-stat-trial');
        if (!box) return;
        try {
            const r = await fetch('/api/subscription');
            const d = await r.json();
            const valEl = box.querySelector('.stat-value');
            const lblEl = box.querySelector('.stat-label');
            if (d && typeof d.trial_days === 'number' && d.trial_days > 0) {
                valEl.textContent = d.trial_days;
                lblEl.textContent = d.trial_days === 1 ? 'Día Pro gratis' : 'Días Pro gratis';
            } else if (d && typeof d.free_posts_per_month === 'number' && d.free_posts_per_month > 0) {
                valEl.textContent = d.free_posts_per_month;
                lblEl.textContent = d.free_posts_per_month === 1 ? 'Publicación gratis al mes' : 'Publicaciones gratis al mes';
            } else {
                valEl.textContent = '0%';
                lblEl.textContent = 'Comisiones';
            }
        } catch (_) {
            const valEl = box.querySelector('.stat-value');
            const lblEl = box.querySelector('.stat-label');
            valEl.textContent = '0%';
            lblEl.textContent = 'Comisiones';
        }
    },

    // ===== NAVIGATION =====
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    },

    showApp(opts = {}) {
        this.showScreen('screen-app');
        const validTabs = ['inicio', 'mercado', 'publicar', 'intercambios', 'perfil'];
        let initialTab = 'inicio';
        try {
            const saved = localStorage.getItem('agropulse_current_tab');
            if (saved && validTabs.includes(saved)) initialTab = saved;
        } catch {}
        history.replaceState({ type: 'tab', tab: initialTab }, '');
        window.addEventListener('popstate', e => this.handlePopState(e));
        let _resizeT;
        window.addEventListener('resize', () => {
            clearTimeout(_resizeT);
            _resizeT = setTimeout(() => {
                if (this._recentResourcesCache) {
                    this.renderResourceScroll('recent-resources', this._recentResourcesCache);
                }
            }, 150);
        });
        this.switchTab(initialTab);
        Chat.startGlobalPolling();
        this.updateNavAvatar();
        this.refreshAgreementCounts();
        if (typeof Subscription !== 'undefined') Subscription.refresh();
        if (!opts.skipTour && typeof Tour !== 'undefined') Tour.maybeStart();
    },

    handlePopState(e) {
        const state = e.state;
        if (!state) return;
        this._skipHistory = true;
        document.getElementById('detail-overlay').style.display = 'none';
        const chatO = document.getElementById('chat-overlay');
        if (chatO && chatO.style.display !== 'none') { chatO.style.display = 'none'; Chat.stopPolling && Chat.stopPolling(); }
        if (state.type === 'tab') {
            this.switchTab(state.tab);
        } else if (state.type === 'detail' || state.type === 'userProfile') {
            this.switchTab(state.tab);
        } else if (state.type === 'chat') {
            this.switchTab(state.tab);
        }
        this._skipHistory = false;
    },

    switchTab(tab) {
        // Bloqueo publicar si usuario free agotó sus publicaciones
        if (tab === 'publicar' && typeof Subscription !== 'undefined' && Subscription.state
            && !Subscription.state.is_premium && Subscription.state.posts_remaining <= 0) {
            Subscription.openPaywall(`Alcanzaste el límite de ${Subscription.state.free_posts_per_month} publicaciones gratis este mes. Suscríbete para publicar sin límite.`);
            return;
        }
        if (this.currentTab === 'publicar' && tab !== 'publicar' && this._editingResourceId) {
            this._editingResourceId = null;
        }
        this.currentTab = tab;
        try { localStorage.setItem('agropulse_current_tab', tab); } catch {}
        if (!this._skipHistory) history.pushState({ type: 'tab', tab }, '');
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById('panel-' + tab).classList.add('active');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        if (tab === 'inicio') this.loadHome();
        if (tab === 'mercado') { this.updateMapLockUI(); this.loadMarket(); }
        if (tab === 'publicar' && !this._editingResourceId) this.initPublishForm();
        if (tab === 'intercambios') this.loadAgreements();
        if (tab === 'perfil') this.loadProfile();
        if (typeof Subscription !== 'undefined') Subscription.refresh();
    },

    updateNavAvatar() {
        const u = API.user;
        if (!u) return;
        const initials = (u.nombre[0] + u.apellido[0]).toUpperCase();
        document.getElementById('nav-avatar').textContent = initials;
    },

    // ===== PASSWORD STRENGTH =====
    _PW_RULES: {
        len:   pw => pw.length >= 8,
        upper: pw => /[A-Z]/.test(pw),
        lower: pw => /[a-z]/.test(pw),
        num:   pw => /[0-9]/.test(pw),
        sym:   pw => /[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]/.test(pw),
    },
    isStrongPassword(pw) {
        return Object.values(this._PW_RULES).every(fn => fn(pw));
    },
    bindPasswordChecklist(inputId, checklistId) {
        const input = document.getElementById(inputId);
        const list = document.getElementById(checklistId);
        if (!input || !list) return;
        input.addEventListener('input', () => {
            const pw = input.value;
            list.querySelectorAll('.pw-check').forEach(el => {
                const rule = el.dataset.rule;
                el.classList.toggle('ok', !!(this._PW_RULES[rule] && this._PW_RULES[rule](pw)));
            });
        });
    },
    bindPasswordConfirm(passId, confirmId, hintId) {
        const confirm = document.getElementById(confirmId);
        const hint = document.getElementById(hintId);
        if (!confirm || !hint) return;
        const check = () => {
            const pw = document.getElementById(passId)?.value || '';
            const c = confirm.value;
            if (!c) { hint.textContent = ''; hint.className = 'form-hint pw-match-hint'; return; }
            if (pw === c) { hint.textContent = '✓ Las contraseñas coinciden'; hint.className = 'form-hint pw-match-hint ok'; }
            else { hint.textContent = '✗ No coinciden'; hint.className = 'form-hint pw-match-hint err'; }
        };
        confirm.addEventListener('input', check);
        document.getElementById(passId)?.addEventListener('input', check);
    },

    // ===== VALIDATION HELPERS =====
    isValidEmail(email) {
        if (!email || typeof email !== 'string') return false;
        const e = email.trim().toLowerCase();
        if (e.length < 6 || e.length > 254) return false;
        // Strict format: local@domain.tld
        const re = /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
        if (!re.test(e)) return false;
        // No consecutive dots, no starting/ending dot in local
        const [local, domain] = e.split('@');
        if (local.includes('..') || domain.includes('..')) return false;
        if (/^\.|\.$/.test(local)) return false;
        // TLD at least 2 chars
        const tld = domain.split('.').pop();
        if (!tld || tld.length < 2) return false;
        // Block common disposable domains
        const disposable = ['mailinator.com','tempmail.com','10minutemail.com','guerrillamail.com','yopmail.com','trashmail.com','throwaway.email','fakemail.net'];
        if (disposable.includes(domain)) return false;
        return true;
    },
    isValidPhoneCo(tel) {
        const digits = String(tel || '').replace(/\D/g, '');
        return digits.length === 10 && /^3\d{9}$/.test(digits);
    },

    // ===== AUTH =====
    async doRegister() {
        const btn = document.getElementById('btn-register');
        btn.classList.add('loading');
        try {
            const data = {
                nombre: document.getElementById('reg-nombre').value.trim(),
                apellido: document.getElementById('reg-apellido').value.trim(),
                email: document.getElementById('reg-email').value.trim(),
                password: document.getElementById('reg-pass').value,
                municipio: document.getElementById('reg-addr')?.value || '',
                tipo: document.getElementById('reg-tipo').value,
                telefono: document.getElementById('reg-telefono').value.trim(),
                latitude: parseFloat(document.getElementById('reg-lat').value) || null,
                longitude: parseFloat(document.getElementById('reg-lng').value) || null,
            };
            if (!data.nombre || !data.apellido || !data.email || !data.password || !data.tipo) {
                throw new Error('Completa todos los campos obligatorios');
            }
            if (!this.isValidEmail(data.email)) {
                throw new Error('Ingresa un correo electrónico válido (ej: tu@correo.com)');
            }
            if (!data.telefono) {
                throw new Error('El teléfono es obligatorio');
            }
            if (!this.isValidPhoneCo(data.telefono)) {
                throw new Error('El teléfono debe tener 10 dígitos y empezar con 3 (ej: 3001234567)');
            }
            if (!data.latitude || !data.longitude) {
                throw new Error('La ubicación es obligatoria — usa el GPS o elige en el mapa');
            }
            if (!this.isStrongPassword(data.password)) {
                throw new Error('La contraseña no cumple los requisitos de seguridad');
            }
            const confirm = document.getElementById('reg-pass-confirm')?.value || '';
            if (data.password !== confirm) {
                throw new Error('Las contraseñas no coinciden');
            }
            if (data.telefono) data.telefono = data.telefono.replace(/\D/g, '');
            await API.register(data);
            this.showApp({ skipTour: true });
            setTimeout(() => this.showWelcomeTrial(), 200);
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    showWelcomeTrial() {
        try { localStorage.setItem('agropulse_tour_completed_v2', '1'); } catch {}
        const sub = (typeof Subscription !== 'undefined' && Subscription.state) || null;
        const days = sub && sub.trial_days_left ? sub.trial_days_left : 60;
        const html = `
            <div class="welcome-overlay-inner">
                <button class="plans-close" onclick="Subscription._closeOverlay('welcome-overlay')"><i data-lucide="x"></i></button>
                <div class="welcome-gift"><i data-lucide="gift"></i></div>
                <h2>¡Iniciaste tu prueba gratuita!</h2>
                <p class="welcome-sub">Tienes <strong>${days} días</strong> de acceso completo a AgroPulse Pro sin pagar nada.</p>
                <ul class="welcome-features">
                    <li><i data-lucide="check-circle-2"></i> Publicaciones ilimitadas</li>
                    <li><i data-lucide="check-circle-2"></i> Alertas de match inteligente</li>
                    <li><i data-lucide="check-circle-2"></i> Chat con fotos y ubicación</li>
                    <li><i data-lucide="check-circle-2"></i> Soporte prioritario</li>
                    <li><i data-lucide="check-circle-2"></i> Sin anuncios</li>
                </ul>
                <button class="btn btn-primary btn-full" onclick="Subscription._closeOverlay('welcome-overlay'); Tour.start();">
                    <i data-lucide="play"></i> Iniciar tutorial
                </button>
                <button class="btn btn-cancel btn-full" style="margin-top:8px" onclick="Subscription._closeOverlay('welcome-overlay')">
                    Explorar solo
                </button>
            </div>
        `;
        Subscription._openOverlay('welcome-overlay', html);
        if (Subscription._launchFireworks) {
            setTimeout(() => Subscription._launchFireworks(), 200);
            setTimeout(() => Subscription._launchFireworks(), 850);
        }
    },

    async doLogin() {
        const btn = document.getElementById('btn-login');
        btn.classList.add('loading');
        try {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-pass').value;
            if (!email || !password) throw new Error('Ingresa correo y contraseña');
            await API.login({ email, password });
            try { sessionStorage.removeItem('agropulse_promo_banner_closed'); } catch {}
            this.showToast('Bienvenido de vuelta');
            this.showApp();
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    _forgotToken: null,
    _forgotEmail: null,

    resetForgotFlow() {
        this._forgotToken = null;
        this._forgotEmail = null;
        document.getElementById('forgot-step-1').style.display = '';
        document.getElementById('forgot-step-2').style.display = 'none';
        document.getElementById('forgot-step-3').style.display = 'none';
        document.getElementById('forgot-email').value = '';
        document.getElementById('forgot-nombre').value = '';
        document.getElementById('forgot-apellido').value = '';
        document.getElementById('forgot-pass').value = '';
        document.getElementById('forgot-pass-confirm').value = '';
        this.showScreen('screen-login');
    },

    async forgotStep1() {
        const btn = document.getElementById('btn-forgot-1');
        btn.classList.add('loading');
        try {
            const email = document.getElementById('forgot-email').value.trim();
            if (!email) throw new Error('Ingresa tu correo electrónico');
            await API.request('POST', '/forgot-password', { email });
            this._forgotEmail = email;
            document.getElementById('forgot-step-1').style.display = 'none';
            document.getElementById('forgot-step-2').style.display = '';
            lucide.createIcons({ nodes: [document.getElementById('forgot-step-2')] });
            document.getElementById('forgot-nombre').focus();
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    async forgotStep2() {
        const btn = document.getElementById('btn-forgot-2');
        btn.classList.add('loading');
        try {
            const nombre = document.getElementById('forgot-nombre').value.trim();
            const apellido = document.getElementById('forgot-apellido').value.trim();
            if (!nombre || !apellido) throw new Error('Ingresa tu nombre y apellido');
            const res = await API.request('POST', '/forgot-password', {
                email: this._forgotEmail, nombre, apellido
            });
            this._forgotToken = res.token;
            document.getElementById('forgot-step-2').style.display = 'none';
            document.getElementById('forgot-step-3').style.display = '';
            lucide.createIcons({ nodes: [document.getElementById('forgot-step-3')] });
            this.bindPasswordChecklist('forgot-pass', 'forgot-pw-checklist');
            this.bindPasswordConfirm('forgot-pass', 'forgot-pass-confirm', 'forgot-match-hint');
            document.getElementById('forgot-pass').focus();
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    async forgotStep3() {
        const btn = document.getElementById('btn-forgot-3');
        btn.classList.add('loading');
        try {
            const pw = document.getElementById('forgot-pass').value;
            const confirm = document.getElementById('forgot-pass-confirm').value;
            if (!this.isStrongPassword(pw)) throw new Error('La contraseña no cumple los requisitos de seguridad');
            if (pw !== confirm) throw new Error('Las contraseñas no coinciden');
            await API.request('PUT', '/forgot-password', { token: this._forgotToken, password: pw });
            this.showToast('¡Contraseña cambiada! Inicia sesión');
            this.resetForgotFlow();
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    async changePassword() {
        const btn = document.getElementById('btn-change-pass');
        btn.classList.add('loading');
        try {
            const current = document.getElementById('set-pass-current')?.value || '';
            const newPw = document.getElementById('set-pass-new')?.value || '';
            const confirm = document.getElementById('set-pass-confirm')?.value || '';
            if (!current || !newPw || !confirm) throw new Error('Completa todos los campos de contraseña');
            if (!this.isStrongPassword(newPw)) throw new Error('La nueva contraseña no cumple los requisitos de seguridad');
            if (newPw !== confirm) throw new Error('Las contraseñas nuevas no coinciden');
            await API.request('PUT', '/users/me/password', { current_password: current, new_password: newPw });
            this.showToast('Contraseña cambiada exitosamente');
            document.getElementById('set-pass-current').value = '';
            document.getElementById('set-pass-new').value = '';
            document.getElementById('set-pass-confirm').value = '';
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    fillDemo(email) {
        document.getElementById('login-email').value = email;
        document.getElementById('login-pass').value = 'demo1234';
    },

    doLogout() {
        Chat.stopGlobalPolling();
        API.logout().catch(() => {});
        API.clearSession();
        this.showScreen('screen-landing');
        this.loadLandingTrialInfo();
    },

    // ===== HOME =====
    async loadHome() {
        const u = API.user;
        if (!u) return;
        const nameEl = document.getElementById('home-name');
        if (nameEl) nameEl.textContent = u.nombre;

        try {
            const [otherResources, myResources, profile] = await Promise.all([
                API.getResources({ exclude_user: u.id }),
                API.getResources({ owner: u.id }),
                API.getProfile()
            ]);

            this._recentResourcesCache = otherResources || [];
            this.renderResourceScroll('recent-resources', this._recentResourcesCache);
            this._myResourcesCache = myResources || [];
            this.renderMyResources('my-resources', this._myResourcesCache);
        } catch (e) {
            console.error('Error loading home:', e);
        }
    },

    setMyPubFilter(f) {
        this.currentMyPubFilter = f;
        document.querySelectorAll('#my-pub-filters .my-pub-chip').forEach(c => c.classList.remove('active'));
        document.querySelector(`#my-pub-filters [data-mfilter="${f}"]`)?.classList.add('active');
        this.renderMyResources('my-resources', this._myResourcesCache);
    },

    renderMyResources(containerId, resources) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const filter = this.currentMyPubFilter || 'todos';
        const filtered = filter === 'todos' ? resources : resources.filter(r => r.tipo === filter);
        if (filtered.length === 0 && filter !== 'todos') {
            container.innerHTML = `<div class="empty-state-compact" style="grid-column:1/-1">
                <i data-lucide="filter"></i>
                <h3>Sin publicaciones de este tipo</h3>
                <p>Cambia el filtro o publica algo nuevo</p>
            </div>`;
            lucide.createIcons({ nodes: [container] });
            return;
        }
        if (filtered.length === 0) {
            container.innerHTML = `<div class="empty-state-compact">
                <i data-lucide="sprout"></i>
                <h3>Tu espacio está listo</h3>
                <p>Publica tu primer recurso y empieza a conectar con otros agricultores de la región</p>
            </div>`;
            lucide.createIcons({ nodes: [container] });
            return;
        }
        container.innerHTML = filtered.map(r => {
            const now = new Date();
            const scheduledAt = r.scheduled_at ? new Date(r.scheduled_at.replace(' ', 'T') + 'Z') : null;
            const deactivAt = r.deactivation_scheduled_at ? new Date(r.deactivation_scheduled_at.replace(' ', 'T') + 'Z') : null;
            const isScheduled = scheduledAt && scheduledAt > now;
            const hasDeactivSched = deactivAt && deactivAt > now;

            let statusChip = '';
            let itemClass = 'my-resource-item';

            if (isScheduled) {
                const daysUntil = Math.ceil((scheduledAt - now) / 86400000);
                const daysTxt = daysUntil <= 0 ? 'hoy' : daysUntil === 1 ? 'mañana' : `en ${daysUntil} días`;
                statusChip = `<span class="my-res-agr-badge scheduled">⏰ Se publicará ${daysTxt}</span>`;
                itemClass += ' scheduled';
            } else if (r.agr_status === 'pending') {
                statusChip = `<span class="my-res-agr-badge pending"><i data-lucide="bell"></i> Solicitud de ${this.esc(r.agr_req_nombre)}</span>`;
                itemClass += ' has-request';
            } else if (r.agr_status === 'active') {
                statusChip = `<span class="my-res-agr-badge active"><i data-lucide="handshake"></i> En curso con ${this.esc(r.agr_req_nombre)}</span>`;
                itemClass += ' in-progress';
            } else if (r.status === 'active') {
                if (hasDeactivSched) {
                    statusChip = `<span class="my-res-agr-badge scheduled">⏰ Se desactivará el ${this.formatDate(r.deactivation_scheduled_at)}</span>`;
                } else {
                    statusChip = `<span class="my-res-agr-badge open"><i data-lucide="circle-dot"></i> Disponible</span>`;
                }
            } else if (r.status === 'closed') {
                statusChip = `<span class="my-res-agr-badge inactive"><i data-lucide="eye-off"></i> Desactivada</span>`;
                itemClass += ' inactive';
            }

            const clickFn = isScheduled
                ? `App.showResourceDetail('${r.id}')`
                : (r.agr_id ? `App.openAgreementChat('${r.agr_id}')` : `App.showResourceDetail('${r.id}')`);

            return `
            <div class="${itemClass}" onclick="${clickFn}">
                <div class="resource-card-icon ${r.tipo}" style="width:36px;height:36px;border-radius:10px;flex-shrink:0">
                    <i data-lucide="${this.ICONS[r.categoria] || 'package'}"></i>
                </div>
                <div style="flex:1;min-width:0">
                    <h4 style="font-family:'DM Sans',sans-serif;font-size:0.9rem;font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(r.titulo)}</h4>
                    <div style="display:flex;align-items:center;gap:6px;font-size:0.75rem;flex-wrap:wrap">
                        <span class="type-badge ${r.tipo}" style="font-size:0.6rem;padding:2px 8px">${this.TYPE_LABELS[r.tipo]}</span>
                        ${statusChip}
                    </div>
                </div>
                <div style="color:var(--text-muted)"><i data-lucide="chevron-right" style="width:16px;height:16px"></i></div>
            </div>`;
        }).join('');
        lucide.createIcons({ nodes: [container] });
    },

    renderResourceScroll(containerId, resources) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (resources.length === 0) {
            container.innerHTML = `<div class="empty-state-compact">
                <i data-lucide="users"></i>
                <h3>La comunidad te espera</h3>
                <p>Cuando otros agricultores publiquen recursos, aparecerán aquí</p>
            </div>`;
            lucide.createIcons({ nodes: [container] });
            return;
        }
        const cs = getComputedStyle(container);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const gap = parseFloat(cs.columnGap || cs.gap) || 12;
        const innerW = container.clientWidth - padL - padR;
        const isMobile = window.matchMedia('(max-width: 520px)').matches;
        let fit;
        if (isMobile) {
            fit = 4;
        } else {
            const isDesktop = window.matchMedia('(min-width: 768px)').matches;
            const cardW = isDesktop ? 180 : 260;
            fit = Math.max(1, Math.floor((innerW + gap) / (cardW + gap)));
        }
        const visible = resources.slice(0, fit);
        container.innerHTML = visible.map(r => `
            <div class="resource-card" onclick="App.showResourceDetail('${r.id}')">
                <div class="resource-card-header">
                    <div class="resource-card-icon ${r.tipo}">
                        <i data-lucide="${this.ICONS[r.categoria] || 'package'}"></i>
                    </div>
                    <span class="type-badge ${r.tipo}">${this.TYPE_LABELS[r.tipo]}</span>
                </div>
                <h4>${this.esc(r.titulo)}</h4>
                <p>${this.esc(r.descripcion)}</p>
                <div class="resource-card-meta">
                    ${r.municipio ? `<span><i data-lucide="map-pin"></i> ${this.esc(r.municipio)}</span>` : ''}
                </div>
            </div>
        `).join('');
        lucide.createIcons({ nodes: [container] });
    },

    // ===== MARKETPLACE =====
    currentMarketView: 'list',

    _canUseMap() {
        const s = (typeof Subscription !== 'undefined') ? Subscription.state : null;
        if (!s) return false;
        // Solo planes pagados (basic o pro). Trial / expired / cancelled / none → bloqueado.
        return s.status === 'active' && (s.plan_tier === 'basic' || s.plan_tier === 'pro');
    },

    updateMapLockUI() {
        const btn = document.getElementById('view-toggle-map');
        if (!btn) return;
        const locked = !this._canUseMap();
        btn.classList.toggle('view-toggle-locked', locked);
        btn.title = locked ? 'Vista mapa — requiere suscripción Básico o Pro' : 'Vista mapa';
    },

    setMarketView(v) {
        if (v !== 'list' && v !== 'map') v = 'list';
        if (v === 'map' && !this._canUseMap()) {
            if (typeof Subscription !== 'undefined' && Subscription.openPlans) {
                Subscription.openPlans();
            }
            return;
        }
        this.currentMarketView = v;
        document.getElementById('view-toggle-list')?.classList.toggle('active', v === 'list');
        document.getElementById('view-toggle-map')?.classList.toggle('active', v === 'map');
        const list = document.getElementById('market-list');
        const mapWrap = document.getElementById('market-map-wrap');
        if (list) list.style.display = v === 'list' ? '' : 'none';
        if (mapWrap) mapWrap.style.display = v === 'map' ? '' : 'none';
        // Sort no aplica en mapa — ocultarlo
        const sortEl = document.getElementById('filter-sort');
        if (sortEl) sortEl.style.display = v === 'map' ? 'none' : '';
        this.loadMarket();
    },

    async loadMarket() {
        const isMap = this.currentMarketView === 'map';
        const container = document.getElementById('market-list');
        if (!isMap) {
            container.innerHTML = '<div class="skeleton-card skeleton"></div><div class="skeleton-card skeleton"></div><div class="skeleton-card skeleton"></div>';
        }
        try {
            const params = { exclude_user: API.user?.id };
            if (this.currentFilter !== 'todos') {
                if (['oferta', 'solicitud', 'prestamo', 'trueque'].includes(this.currentFilter)) {
                    params.tipo = this.currentFilter;
                } else {
                    params.categoria = this.currentFilter;
                }
            }
            if (this.currentCatFilter) params.categoria = this.currentCatFilter;
            if (this.currentMunFilter) params.municipio = this.currentMunFilter;
            if (this.currentSortFilter) params.sort = this.currentSortFilter;
            const q = document.getElementById('market-search-input')?.value?.trim();
            if (q) params.q = q;

            const resources = await API.getResources(params);
            document.getElementById('results-count').textContent = `${resources.length} publicacion${resources.length !== 1 ? 'es' : ''}`;

            if (isMap) {
                this.renderMarketMap(resources);
                return;
            }

            if (resources.length === 0) {
                container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
                    <i data-lucide="compass"></i>
                    <h3>Nada por aquí... todavía</h3>
                    <p>Sé el primero en publicar algo o intenta con otros filtros</p>
                    <button class="btn btn-secondary" onclick="App.switchTab('publicar')" style="margin-top:10px;padding:7px 16px;font-size:0.78rem">
                        <i data-lucide="plus"></i> Publicar recurso
                    </button>
                </div>`;
                lucide.createIcons({ nodes: [container] });
                return;
            }
            const marketItems = resources.map(r => `
                <div class="my-resource-item" onclick="App.showResourceDetail('${r.id}')">
                    <div class="resource-card-icon ${r.tipo}" style="width:36px;height:36px;border-radius:10px;flex-shrink:0">
                        <i data-lucide="${this.ICONS[r.categoria] || 'package'}"></i>
                    </div>
                    <div style="flex:1;min-width:0">
                        <h4 style="font-family:'DM Sans',sans-serif;font-size:0.9rem;font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this.esc(r.titulo)}</h4>
                        <div class="market-item-meta-row" style="display:flex;align-items:center;gap:6px;font-size:0.7rem;flex-wrap:wrap;color:var(--text-muted);min-width:0">
                            <span class="type-badge ${r.tipo}" style="font-size:0.6rem;padding:2px 8px">${this.TYPE_LABELS[r.tipo]}</span>
                            <span class="card-author-link" onclick="event.stopPropagation();App.showUserProfile('${r.user_id}')" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%">
                                <i data-lucide="user"></i> ${this.esc(r.user_nombre)}${r.user_verified ? ' <i data-lucide="badge-check" class="verified-inline" title="Cuenta verificada"></i>' : ''}
                            </span>
                            ${r.municipio ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%"><i data-lucide="map-pin"></i> ${this.esc(r.municipio)}</span>` : ''}
                        </div>
                    </div>
                    <div style="color:var(--text-muted)"><i data-lucide="chevron-right" style="width:16px;height:16px"></i></div>
                </div>
            `);
            container.innerHTML = (window.Subscription && Subscription.injectInFeed)
                ? Subscription.injectInFeed(marketItems, 5)
                : marketItems.join('');
            lucide.createIcons({ nodes: [container] });
        } catch (e) {
            if (!isMap) container.innerHTML = '<div class="empty-state"><p>Error al cargar</p></div>';
        }
    },

    _marketMap: null,
    _marketMarkersLayer: null,
    _marketUserMarker: null,

    _openFromMapPopup(id) {
        if (this._marketMap) {
            try { this._marketMap.closePopup(); } catch {}
        }
        this.showResourceDetail(id);
    },

    async _centerMarketOnUser() {
        if (!this._marketMap) return;
        const btn = document.querySelector('.market-locate-btn');
        if (btn) btn.classList.add('locating');
        try {
            const pos = await Geo.getCurrentPosition();
            if (!pos) {
                this.showToast('No se pudo obtener tu ubicación. Activa el GPS.', 'error');
                return;
            }
            const latlng = [pos.latitude, pos.longitude];
            const map = this._marketMap;
            const targetZoom = 14;
            const currentZoom = map.getZoom();
            const currentCenter = map.getCenter();
            const dist = map.distance(currentCenter, latlng); // metros

            if (this._marketUserMarker) {
                try { this._marketUserMarker.remove(); } catch {}
            }
            const userIcon = L.divIcon({
                className: 'market-user-pin-wrap',
                html: '<div class="market-user-pin"><div class="market-user-pin-inner"></div><div class="market-user-pin-pulse"></div></div>',
                iconSize: [22, 22],
                iconAnchor: [11, 11],
            });
            this._marketUserMarker = L.marker(latlng, { icon: userIcon, interactive: false }).addTo(map);

            // Distancia muy corta → un solo flyTo. Lejos → zoom out primero, luego zoom in (efecto Google Maps).
            if (dist < 2000) {
                map.flyTo(latlng, targetZoom, { duration: 1.1, easeLinearity: 0.25 });
            } else {
                const outZoom = Math.max(map.getMinZoom() || 3, Math.min(currentZoom, targetZoom) - 3);
                const midPoint = [
                    (currentCenter.lat + latlng[0]) / 2,
                    (currentCenter.lng + latlng[1]) / 2,
                ];
                map.flyTo(midPoint, outZoom, { duration: 0.9, easeLinearity: 0.3 });
                setTimeout(() => {
                    if (this._marketMap === map) {
                        map.flyTo(latlng, targetZoom, { duration: 1.4, easeLinearity: 0.2 });
                    }
                }, 950);
            }
        } catch (e) {
            this.showToast('Error obteniendo ubicación', 'error');
        } finally {
            if (btn) btn.classList.remove('locating');
        }
    },

    renderMarketMap(resources) {
        const wrap = document.getElementById('market-map-wrap');
        const mapEl = document.getElementById('market-map');
        const hint = document.getElementById('market-map-hint');
        if (!wrap || !mapEl || typeof L === 'undefined') return;

        const withCoords = (resources || []).filter(r => r.latitude != null && r.longitude != null);

        if (!this._marketMap) {
            // Default to Boyacá centroid (~5.45, -73.36)
            this._marketMap = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true }).setView([5.45, -73.36], 9);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19, attribution: '© OpenStreetMap',
            }).addTo(this._marketMap);

            // Locate-me control
            const LocateBtn = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: () => {
                    const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control market-locate-btn');
                    btn.type = 'button';
                    btn.title = 'Centrar en mi ubicación';
                    btn.setAttribute('aria-label', 'Centrar en mi ubicación');
                    btn.innerHTML = '<i data-lucide="locate-fixed"></i>';
                    L.DomEvent.disableClickPropagation(btn);
                    L.DomEvent.on(btn, 'click', (e) => {
                        L.DomEvent.stop(e);
                        App._centerMarketOnUser();
                    });
                    setTimeout(() => { if (window.lucide) lucide.createIcons({ nodes: [btn] }); }, 0);
                    return btn;
                },
            });
            new LocateBtn().addTo(this._marketMap);
            const useCluster = typeof L.markerClusterGroup === 'function';
            this._marketMarkersLayer = useCluster
                ? L.markerClusterGroup({
                    showCoverageOnHover: false,
                    spiderfyOnMaxZoom: true,
                    zoomToBoundsOnClick: true,
                    maxClusterRadius: 50,
                    spiderLegPolylineOptions: { weight: 1.5, color: '#5a4a3a', opacity: 0.6 },
                    iconCreateFunction: (cluster) => {
                        const markers = cluster.getAllChildMarkers();
                        const counts = { oferta: 0, solicitud: 0, prestamo: 0, trueque: 0 };
                        markers.forEach(m => { const t = m.options._tipo; if (t) counts[t] = (counts[t] || 0) + 1; });
                        const total = cluster.getChildCount();
                        const dominant = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
                        const colorMap = { oferta: '#27ae60', solicitud: '#2980b9', prestamo: '#c8962a', trueque: '#7a9a3c' };
                        const color = colorMap[dominant] || '#5a4a3a';
                        const size = total < 10 ? 36 : total < 50 ? 42 : total < 100 ? 48 : 54;
                        return L.divIcon({
                            className: 'market-cluster-wrap',
                            html: `<div class="market-cluster" style="background:${color};width:${size}px;height:${size}px"><span class="market-cluster-count">${total}</span></div>`,
                            iconSize: [size, size],
                            iconAnchor: [size / 2, size / 2],
                        });
                    },
                })
                : L.layerGroup();
            this._marketMarkersLayer.addTo(this._marketMap);
            setTimeout(() => this._marketMap && this._marketMap.invalidateSize(), 150);
        } else {
            this._marketMarkersLayer.clearLayers();
            setTimeout(() => this._marketMap && this._marketMap.invalidateSize(), 50);
        }

        if (hint) hint.style.display = withCoords.length === 0 ? 'flex' : 'none';

        if (!withCoords.length) {
            if (hint && window.lucide) lucide.createIcons({ nodes: [hint] });
            return;
        }

        const colorMap = { oferta: '#27ae60', solicitud: '#2980b9', prestamo: '#c8962a', trueque: '#7a9a3c' };
        const iconHtml = (tipo) => {
            const color = colorMap[tipo] || '#5a4a3a';
            return `<div class="market-pin" style="background:${color}"><span class="market-pin-inner"></span></div>`;
        };

        const bounds = [];
        withCoords.forEach(r => {
            const lat = +r.latitude;
            const lng = +r.longitude;
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            const icon = L.divIcon({
                className: 'market-pin-wrap',
                html: iconHtml(r.tipo),
                iconSize: [22, 22],
                iconAnchor: [11, 11],
            });
            const marker = L.marker([lat, lng], { icon, _tipo: r.tipo });
            const popupHtml = `
                <div class="market-popup">
                    <div class="market-popup-tipo market-popup-tipo-${r.tipo}">${this.TYPE_LABELS[r.tipo] || r.tipo}</div>
                    <strong class="market-popup-title">${this.esc(r.titulo)}</strong>
                    ${r.municipio ? `<div class="market-popup-muni">📍 ${this.esc(r.municipio)}</div>` : ''}
                    <button class="market-popup-cta" onclick="App._openFromMapPopup('${r.id}')">Ver publicación →</button>
                </div>`;
            marker.bindPopup(popupHtml, { maxWidth: 240, className: 'market-popup-wrap' });
            this._marketMarkersLayer.addLayer(marker);
            bounds.push([lat, lng]);
        });

        if (bounds.length === 1) {
            this._marketMap.setView(bounds[0], 13);
        } else if (bounds.length > 1) {
            this._marketMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        }
    },

    setFilter(filter) {
        this.currentFilter = filter;
        document.querySelectorAll('#type-filters .chip').forEach(c => c.classList.remove('active'));
        document.querySelector(`[data-filter="${filter}"]`)?.classList.add('active');
        this.loadMarket();
    },

    setCatFilter(val) { this.currentCatFilter = val; this.loadMarket(); },
    setMunFilter(val) { this.currentMunFilter = val; this.loadMarket(); },
    setSortFilter(val) { this.currentSortFilter = val; this.loadMarket(); },
    clearFilters() {
        this.currentFilter = 'todos';
        this.currentCatFilter = '';
        this.currentMunFilter = '';
        this.currentSortFilter = 'recent';
        document.querySelectorAll('#type-filters .chip').forEach(c => c.classList.remove('active'));
        document.querySelector('[data-filter="todos"]')?.classList.add('active');
        document.getElementById('filter-cat').value = '';
        document.getElementById('filter-mun').value = '';
        document.getElementById('filter-sort').value = 'recent';
        document.getElementById('market-search-input').value = '';
        this.loadMarket();
    },

    // ===== RESOURCE DETAIL =====
    async showResourceDetail(id) {
        try {
            const r = await API.getResource(id);
            const isOwner = API.user && r.owner_id === API.user.id;
            const initials = (r.user_nombre[0] + r.user_apellido[0]).toUpperCase();
            let infoItems = '';
            const addInfo = (icon, label, value) => {
                if (value) infoItems += `<div class="detail-info-item"><div class="detail-info-label"><i data-lucide="${icon}"></i> ${label}</div><div class="detail-info-value">${this.esc(value)}</div></div>`;
            };
            addInfo('tag', 'Categoría', r.categoria);
            addInfo('repeat', 'Modalidad', r.modalidad);
            // Cantidad + Unidad lado a lado (mitad y mitad). Si no aplica unidad, mostrarlo en gris.
            if (r.cantidad) {
                const isNA = !r.unidad || r.unidad === 'No aplica';
                infoItems += `<div class="detail-info-pair">
                    <div class="detail-info-item"><div class="detail-info-label"><i data-lucide="hash"></i> Cantidad</div><div class="detail-info-value">${this.esc(String(r.cantidad))}</div></div>
                    <div class="detail-info-item ${isNA ? 'detail-info-na' : ''}"><div class="detail-info-label"><i data-lucide="ruler"></i> Unidad</div><div class="detail-info-value">${isNA ? 'No aplica' : this.esc(r.unidad)}</div></div>
                </div>`;
            }
            addInfo('check-circle', 'Condición', r.condicion);
            addInfo('clock', 'Disponibilidad', r.disponibilidad);
            addInfo('banknote', 'Precio orientativo', r.precio_referencia);
            addInfo('timer', 'Duración préstamo', r.duracion_prestamo);
            addInfo('shield', 'Garantía', r.garantia);
            addInfo('arrow-up-right', 'Ofrece', r.ofrece);
            addInfo('arrow-down-left', 'Recibe', r.recibe);
            if (r.scheduled_at) {
                const sd = new Date(r.scheduled_at.replace(' ', 'T') + 'Z');
                if (sd > new Date()) addInfo('calendar-clock', 'Se publicará el', this.formatDate(r.scheduled_at));
            }
            if (r.deactivation_scheduled_at) {
                const dd = new Date(r.deactivation_scheduled_at.replace(' ', 'T') + 'Z');
                if (dd > new Date()) addInfo('calendar-x', 'Se desactivará el', this.formatDate(r.deactivation_scheduled_at));
            }
            const indicacionesBlock = r.location_notes ? `
                <div class="detail-info-item detail-indicaciones-item" style="margin-top:10px">
                    <div class="detail-info-label"><i data-lucide="navigation"></i> Cómo llegar</div>
                    <div class="detail-info-value" style="white-space:pre-wrap;line-height:1.5">${this.esc(r.location_notes)}</div>
                </div>` : '';
            const hasMap = r.latitude != null && r.longitude != null;
            const hasImg = !!r.image_data;
            const imageFieldHtml = hasImg
                ? `<div class="detail-image-field-wrap">
                        <div class="detail-info-label" style="margin-bottom:8px"><i data-lucide="image"></i> Foto</div>
                        <div class="detail-image-field" onclick="App.openLightbox('${r.image_data}')">
                            <img src="${r.image_data}" alt="">
                            <div class="detail-image-zoom-hint"><i data-lucide="zoom-in"></i> Toca para ver en grande</div>
                        </div>
                   </div>`
                : '';
            const mapHtml = hasMap
                ? `<div class="detail-map-field">
                        <div class="detail-info-label" style="margin-bottom:8px"><i data-lucide="map-pin"></i> Ubicación</div>
                        ${Geo.buildMapBlock(r.latitude, r.longitude, { height: '100%' })}
                        ${indicacionesBlock}
                   </div>`
                : '';
            const mediaRowHtml = (hasImg && hasMap)
                ? `<div class="detail-media-row">${imageFieldHtml}${mapHtml}</div>`
                : (hasImg ? imageFieldHtml : '') + (hasMap
                    ? `<div class="detail-location-section">${mapHtml}</div>`
                    : (r.location_notes ? `<div class="detail-location-section">${indicacionesBlock}</div>` : ''));

            const html = `
                <div class="detail-header">
                    <button class="detail-back" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i></button>
                    <h3>Detalle</h3>
                </div>
                <div class="detail-body">
                    <div class="detail-title-row">
                        <span class="type-badge ${r.tipo} detail-title-badge">${this.TYPE_LABELS[r.tipo]}</span>
                        <h2 class="detail-title detail-title-big">${this.esc(r.titulo)}</h2>
                    </div>
                    ${mediaRowHtml}
                    ${infoItems ? `<div class="detail-section">
                        <div class="detail-section-heading"><i data-lucide="list"></i> Detalles</div>
                        <div class="detail-info-grid">${infoItems}</div>
                    </div>` : ''}
                    ${r.descripcion ? `<div class="detail-section">
                        <div class="detail-section-heading"><i data-lucide="file-text"></i> Descripción</div>
                        <div class="detail-section-body">${this.esc(r.descripcion)}</div>
                    </div>` : ''}
                    ${isOwner ? '' : `<div class="detail-owner" onclick="App.showUserProfile('${r.owner_id}')" style="cursor:pointer">
                        <div class="detail-owner-avatar">${initials}</div>
                        <div class="detail-owner-info">
                            <h4>${this.esc(r.user_nombre)} ${this.esc(r.user_apellido)}${r.user_verified ? ' <i data-lucide="badge-check" class="verified-inline" title="Cuenta verificada"></i>' : ''}</h4>
                            <p>${this.esc(r.user_tipo || '')}${r.user_municipio ? ' · ' + this.esc(r.user_municipio) : ''}</p>
                        </div>
                        <div class="detail-owner-rating"><i data-lucide="star"></i> ${(r.user_reputation || 5).toFixed(1)}</div>
                    </div>`}
                </div>
                <div class="detail-actions">
                    ${isOwner
                        ? this.renderOwnerDetailActions(r)
                        : `<button class="btn btn-outline btn-full btn-sm" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i> Volver</button>
                           ${this.getActionButton(r)}`
                    }
                </div>`;
            const overlay = document.getElementById('detail-overlay');
            overlay.innerHTML = html;
            overlay.style.display = 'block';
            lucide.createIcons({ nodes: [overlay] });
            if (!this._skipHistory) history.pushState({ type: 'detail', tab: this.currentTab, id }, '');
        } catch (e) {
            console.error('showResourceDetail error:', e);
            this.showToast(e.message || 'Error al cargar detalle', 'error');
        }
    },

    getActionButton(r) {
        const actions = {
            oferta: { icon: 'shopping-bag', label: 'Me interesa', msg: '¿Qué mensaje quieres enviarle al oferente?' },
            solicitud: { icon: 'heart-handshake', label: 'Puedo ayudar', msg: '¿Qué mensaje quieres enviarle? Cuéntale cómo puedes ayudar.' },
            prestamo: { icon: 'key', label: 'Prestar', msg: '¿Para qué necesitas el préstamo? Escribe un mensaje.' },
            trueque: { icon: 'repeat', label: 'Proponer trueque', msg: '¿Qué ofreces a cambio? Escribe tu propuesta.' },
        };
        const a = actions[r.tipo] || actions.oferta;
        return `<button class="btn btn-primary btn-full" onclick="App.requestService('${r.id}', '${r.tipo}')"><i data-lucide="${a.icon}"></i> ${a.label}</button>`;
    },

    closeDetail() {
        const overlay = document.getElementById('detail-overlay');
        const wasOpen = overlay.style.display !== 'none';
        overlay.style.display = 'none';
        if (!this._skipHistory && wasOpen && history.state?.type !== 'tab') history.back();
    },

    // Custom confirm dialog (replaces browser confirm())
    _confirmResolve: null,
    showConfirm({ icon = 'help-circle', title, msg, okLabel = 'Confirmar', danger = false }) {
        return new Promise(resolve => {
            this._confirmResolve = resolve;
            const iconEl = document.getElementById('confirm-modal-icon');
            iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;
            lucide.createIcons({ nodes: [iconEl] });
            document.getElementById('confirm-modal-title').textContent = title;
            document.getElementById('confirm-modal-msg').textContent = msg;
            const ok = document.getElementById('confirm-modal-ok');
            ok.textContent = okLabel;
            ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
            document.getElementById('confirm-modal').style.display = 'flex';
        });
    },
    confirmResolve(val) {
        document.getElementById('confirm-modal').style.display = 'none';
        if (this._confirmResolve) { this._confirmResolve(val); this._confirmResolve = null; }
    },
    confirmCancel(e) {
        if (e.target === document.getElementById('confirm-modal')) this.confirmResolve(false);
    },

    // Input modal (replaces browser prompt())
    _inputResolve: null,
    showInputModal({ icon = 'message-circle', title, subtitle, placeholder = '', okLabel = 'Enviar' }) {
        return new Promise(resolve => {
            this._inputResolve = resolve;
            const iconEl = document.getElementById('input-modal-icon');
            iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;
            lucide.createIcons({ nodes: [iconEl] });
            document.getElementById('input-modal-title').textContent = title;
            document.getElementById('input-modal-subtitle').textContent = subtitle;
            document.getElementById('input-modal-text').value = '';
            document.getElementById('input-modal-text').placeholder = placeholder;
            document.getElementById('input-modal-ok').textContent = okLabel;
            document.getElementById('input-modal').style.display = 'flex';
            setTimeout(() => document.getElementById('input-modal-text').focus(), 100);
        });
    },
    inputModalResolve(val) {
        document.getElementById('input-modal').style.display = 'none';
        if (this._inputResolve) { this._inputResolve(val); this._inputResolve = null; }
    },
    inputModalCancel(e) {
        if (e.target === document.getElementById('input-modal')) this.inputModalResolve(null);
    },

    // Image lightbox
    openLightbox(src) {
        document.getElementById('img-lightbox-src').src = src;
        const lb = document.getElementById('img-lightbox');
        lb.style.display = 'flex';
        lucide.createIcons({ nodes: [lb] });
    },
    closeLightbox() {
        document.getElementById('img-lightbox').style.display = 'none';
    },

    async toggleResource(id, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'closed' : 'active';
        const ok = await this.showConfirm(newStatus === 'closed'
            ? { icon: 'eye-off', title: 'Desactivar publicación', msg: 'No será visible en la comunidad, pero podrás reactivarla cuando quieras.', okLabel: 'Desactivar' }
            : { icon: 'eye', title: 'Activar publicación', msg: 'La publicación volverá a ser visible para toda la comunidad.', okLabel: 'Activar' }
        );
        if (!ok) return;
        try {
            await API.updateResource(id, { status: newStatus });
            this.closeDetail();
            this.showToast(newStatus === 'closed' ? 'Publicación desactivada' : 'Publicación activada');
            this.refreshCurrentTab();
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    },

    async deleteResource(id) {
        const ok = await this.showConfirm({
            icon: 'trash-2', title: 'Eliminar publicación',
            msg: 'Esta acción es permanente y no se puede deshacer.',
            okLabel: 'Eliminar', danger: true
        });
        if (!ok) return;
        try {
            await API.request('DELETE', '/resources/' + id);
            this.closeDetail();
            this.showToast('Publicación eliminada');
            this.refreshCurrentTab();
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    },

    renderOwnerDetailActions(r) {
        const now = new Date();
        const scheduledAt = r.scheduled_at ? new Date(r.scheduled_at.replace(' ', 'T') + 'Z') : null;
        const deactivAt = r.deactivation_scheduled_at ? new Date(r.deactivation_scheduled_at.replace(' ', 'T') + 'Z') : null;
        const isScheduled = scheduledAt && scheduledAt > now;
        const hasDeactivSched = deactivAt && deactivAt > now;

        const editBtn = `<button class="btn btn-outline btn-full btn-sm" onclick="App.editResource('${r.id}')"><i data-lucide="edit-3"></i> Editar publicación</button>`;

        if (isScheduled) {
            return `${editBtn}
                    <button class="btn btn-outline btn-full btn-sm" onclick="App.changeScheduleDate('${r.id}')"><i data-lucide="calendar"></i> Cambiar fecha de publicación</button>
                    <button class="btn btn-primary btn-full btn-sm" onclick="App.publishNow('${r.id}')"><i data-lucide="send"></i> Publicar ya</button>
                    <button class="btn btn-danger btn-full btn-sm" onclick="App.deleteResource('${r.id}')"><i data-lucide="trash-2"></i> Eliminar</button>`;
        }

        let deactivBtns = '';
        if (hasDeactivSched) {
            const date = this.formatDate(r.deactivation_scheduled_at);
            deactivBtns = `<button class="btn btn-outline btn-full btn-sm" onclick="App.editDeactivationDate('${r.id}')"><i data-lucide="calendar-x"></i> Editar desactivación (${date})</button>
                           <button class="btn btn-outline btn-full btn-sm" onclick="App.cancelDeactivationSchedule('${r.id}')"><i data-lucide="x-circle"></i> Cancelar desactivación</button>`;
        } else if (r.status === 'active') {
            deactivBtns = `<button class="btn btn-outline btn-full btn-sm" onclick="App.scheduleDeactivation('${r.id}')"><i data-lucide="calendar-x"></i> Programar desactivación</button>`;
        }

        if (r.status === 'active') {
            return `${editBtn}
                    <button class="btn btn-outline btn-full btn-sm" onclick="App.toggleResource('${r.id}', 'active')"><i data-lucide="eye-off"></i> Desactivar ahora</button>
                    ${deactivBtns}
                    <button class="btn btn-danger btn-full btn-sm" onclick="App.deleteResource('${r.id}')"><i data-lucide="trash-2"></i> Eliminar</button>`;
        }

        // Closed resource — activation options
        const hasActivSched = r.scheduled_at && new Date(r.scheduled_at.replace(' ', 'T') + 'Z') > now;
        if (hasActivSched) {
            const date = this.formatDate(r.scheduled_at);
            return `${editBtn}
                    <button class="btn btn-outline btn-full btn-sm" onclick="App.editActivationDate('${r.id}')"><i data-lucide="calendar"></i> Editar activación (${date})</button>
                    <button class="btn btn-primary btn-full btn-sm" onclick="App.activateNow('${r.id}')"><i data-lucide="eye"></i> Activar ya</button>
                    <button class="btn btn-outline btn-full btn-sm" onclick="App.cancelActivationSchedule('${r.id}')"><i data-lucide="x-circle"></i> Cancelar activación programada</button>
                    <button class="btn btn-danger btn-full btn-sm" onclick="App.deleteResource('${r.id}')"><i data-lucide="trash-2"></i> Eliminar</button>`;
        }
        return `${editBtn}
                <button class="btn btn-primary btn-full btn-sm" onclick="App.activateNow('${r.id}')"><i data-lucide="eye"></i> Activar ahora</button>
                <button class="btn btn-outline btn-full btn-sm" onclick="App.scheduleActivation('${r.id}')"><i data-lucide="calendar"></i> Programar activación</button>
                <button class="btn btn-danger btn-full btn-sm" onclick="App.deleteResource('${r.id}')"><i data-lucide="trash-2"></i> Eliminar</button>`;
    },

    async changeScheduleDate(id) {
        const r = await API.getResource(id);
        const now = new Date();
        now.setMinutes(now.getMinutes() + 1);
        const min = now.toISOString().slice(0, 16);
        const current = r.scheduled_at ? r.scheduled_at.replace(' ', 'T').slice(0, 16) : '';
        const date = await this.showDatepicker({
            icon: 'calendar',
            title: 'Cambiar fecha de publicación',
            subtitle: 'Nueva fecha en que se publicará el recurso',
            okLabel: 'Guardar',
            minDate: min,
            defaultDate: current
        });
        if (!date) return;
        try {
            const isoDate = new Date(date).toISOString().replace('T', ' ').slice(0, 19);
            await API.updateResource(id, { scheduled_at: isoDate });
            this.closeDetail();
            this.showToast('Fecha de publicación actualizada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async publishNow(id) {
        const ok = await this.showConfirm({
            icon: 'send', title: 'Publicar ahora',
            msg: 'El recurso será visible en la comunidad de inmediato.',
            okLabel: 'Publicar'
        });
        if (!ok) return;
        try {
            await API.updateResource(id, { scheduled_at: null });
            this.closeDetail();
            this.showToast('Publicación activa');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async activateNow(id) {
        const ok = await this.showConfirm({
            icon: 'eye', title: 'Activar publicación',
            msg: 'La publicación volverá a ser visible para toda la comunidad.',
            okLabel: 'Activar'
        });
        if (!ok) return;
        try {
            await API.updateResource(id, { status: 'active', scheduled_at: null });
            this.closeDetail();
            this.showToast('Publicación activada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async scheduleActivation(id) {
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
        const min = new Date().toISOString().slice(0, 16);
        const date = await this.showDatepicker({
            icon: 'calendar',
            title: 'Programar activación',
            subtitle: 'La publicación se hará visible en esa fecha',
            okLabel: 'Programar',
            minDate: min,
            defaultDate: tomorrow
        });
        if (!date) return;
        try {
            const isoDate = new Date(date).toISOString().replace('T', ' ').slice(0, 19);
            await API.updateResource(id, { status: 'active', scheduled_at: isoDate });
            this.closeDetail();
            this.showToast('Activación programada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async editActivationDate(id) {
        const r = await API.getResource(id);
        const min = new Date().toISOString().slice(0, 16);
        const current = r.scheduled_at ? r.scheduled_at.replace(' ', 'T').slice(0, 16) : '';
        const date = await this.showDatepicker({
            icon: 'calendar',
            title: 'Editar fecha de activación',
            subtitle: 'Nueva fecha en que se publicará el recurso',
            okLabel: 'Guardar',
            minDate: min,
            defaultDate: current
        });
        if (!date) return;
        try {
            const isoDate = new Date(date).toISOString().replace('T', ' ').slice(0, 19);
            await API.updateResource(id, { scheduled_at: isoDate });
            this.closeDetail();
            this.showToast('Fecha de activación actualizada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async cancelActivationSchedule(id) {
        const ok = await this.showConfirm({
            icon: 'x-circle', title: 'Cancelar activación programada',
            msg: 'La publicación permanecerá desactivada.',
            okLabel: 'Cancelar activación'
        });
        if (!ok) return;
        try {
            await API.updateResource(id, { scheduled_at: null });
            this.closeDetail();
            this.showToast('Activación cancelada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async scheduleDeactivation(id) {
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
        const min = new Date().toISOString().slice(0, 16);
        const date = await this.showDatepicker({
            icon: 'calendar-x',
            title: 'Programar desactivación',
            subtitle: 'La publicación se ocultará automáticamente en esa fecha',
            okLabel: 'Programar',
            minDate: min,
            defaultDate: tomorrow
        });
        if (!date) return;
        try {
            const isoDate = new Date(date).toISOString().replace('T', ' ').slice(0, 19);
            await API.updateResource(id, { deactivation_scheduled_at: isoDate });
            this.closeDetail();
            this.showToast('Desactivación programada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async editDeactivationDate(id) {
        const r = await API.getResource(id);
        const min = new Date().toISOString().slice(0, 16);
        const current = r.deactivation_scheduled_at ? r.deactivation_scheduled_at.replace(' ', 'T').slice(0, 16) : '';
        const date = await this.showDatepicker({
            icon: 'calendar-x',
            title: 'Editar fecha de desactivación',
            subtitle: 'Nueva fecha en que se desactivará el recurso',
            okLabel: 'Guardar',
            minDate: min,
            defaultDate: current
        });
        if (!date) return;
        try {
            const isoDate = new Date(date).toISOString().replace('T', ' ').slice(0, 19);
            await API.updateResource(id, { deactivation_scheduled_at: isoDate });
            this.closeDetail();
            this.showToast('Fecha de desactivación actualizada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async cancelDeactivationSchedule(id) {
        const ok = await this.showConfirm({
            icon: 'x-circle', title: 'Cancelar desactivación',
            msg: 'La publicación permanecerá activa indefinidamente.',
            okLabel: 'Cancelar desactivación'
        });
        if (!ok) return;
        try {
            await API.updateResource(id, { deactivation_scheduled_at: null });
            this.closeDetail();
            this.showToast('Desactivación cancelada');
            this.loadHome();
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    _datepickerResolve: null,
    showDatepicker({ icon = 'calendar', title, subtitle = '', okLabel = 'Confirmar', minDate = null, defaultDate = null }) {
        return new Promise(resolve => {
            this._datepickerResolve = resolve;
            const iconEl = document.getElementById('datepicker-icon');
            iconEl.innerHTML = `<i data-lucide="${icon}"></i>`;
            lucide.createIcons({ nodes: [iconEl] });
            document.getElementById('datepicker-title').textContent = title;
            document.getElementById('datepicker-subtitle').textContent = subtitle;
            document.getElementById('datepicker-ok').textContent = okLabel;
            const input = document.getElementById('datepicker-input');
            input.min = minDate || '';
            input.value = defaultDate || '';
            document.getElementById('datepicker-modal').style.display = 'flex';
            setTimeout(() => input.focus(), 100);
        });
    },
    datepickerResolve(val) {
        document.getElementById('datepicker-modal').style.display = 'none';
        if (this._datepickerResolve) { this._datepickerResolve(val); this._datepickerResolve = null; }
    },
    datepickerCancel(e) {
        if (e.target === document.getElementById('datepicker-modal')) this.datepickerResolve(null);
    },

    refreshCurrentTab() {
        if (this.currentTab === 'inicio') this.loadHome();
        if (this.currentTab === 'mercado') this.loadMarket();
        if (this.currentTab === 'perfil') this.loadProfile();
    },

    async requestService(resourceId, tipo) {
        const modalConfig = {
            oferta:   { icon: 'shopping-bag',    title: 'Me interesa',        subtitle: 'Escríbele un mensaje a la persona para presentarte.', placeholder: 'Hola, estoy interesado en tu oferta...' },
            solicitud:{ icon: 'heart-handshake', title: 'Puedo ayudarte',     subtitle: 'Cuéntale cómo puedes cubrir su necesidad.',          placeholder: 'Hola, creo que puedo ayudarte con eso...' },
            prestamo: { icon: 'key',             title: 'Solicitar préstamo', subtitle: 'Explica para qué necesitas el recurso y por cuánto tiempo.', placeholder: 'Hola, necesito el préstamo para...' },
            trueque:  { icon: 'repeat',          title: 'Proponer trueque',   subtitle: 'Describe qué ofreces a cambio.',                     placeholder: 'Hola, te propongo cambiar...' },
        };
        const toasts = {
            oferta: 'Interés enviado', solicitud: 'Oferta de ayuda enviada',
            prestamo: 'Solicitud enviada', trueque: 'Propuesta enviada',
        };
        const cfg = modalConfig[tipo] || modalConfig.oferta;
        const message = await this.showInputModal({ ...cfg, okLabel: cfg.title });
        if (message === null) return; // user cancelled
        try {
            const result = await API.createAgreement({ resource_id: resourceId, message: message || '' });
            this.closeDetail();
            this.showToast(toasts[tipo] || 'Solicitud enviada');
            this.openAgreementChat(result.id);
        } catch (e) {
            if (e.message.includes('Ya tienes')) {
                this.closeDetail();
                this.showToast('Ya tienes un chat activo para este recurso');
                // Open existing chat
                try {
                    const agreements = await API.getAgreements({});
                    const existing = agreements.find(a => a.resource_id === resourceId);
                    if (existing) this.openAgreementChat(existing.id);
                    else this.switchTab('intercambios');
                } catch { this.switchTab('intercambios'); }
            } else {
                this.showToast(e.message, 'error');
            }
        }
    },

    // ===== PUBLISH =====
    initPublishForm() {
        this.setPublishType('oferta');
    },

    setPublishType(tipo) {
        this.currentPublishType = tipo;
        document.querySelectorAll('.type-opt').forEach(o => o.classList.remove('active'));
        document.querySelector(`[data-type="${tipo}"]`)?.classList.add('active');
        this.updatePublishFormFields(tipo);
    },

    updatePublishFormFields(tipo) {
        const sections = {
            oferta: `
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="info"></i> Información básica</div>
                    <div class="form-group">
                        <label class="form-label">Categoría *</label>
                        <select id="pub-cat" class="form-select">${this.categoryOptions()}</select>
                        <span class="form-hint">Tipo de recurso que ofreces</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Asunto *</label>
                        <input type="text" id="pub-titulo" class="form-input" placeholder="Ej: Tractor disponible fines de semana">
                        <span class="form-hint">Mínimo 2, máximo 20 palabras. Describe brevemente lo que ofreces</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Cuenta qué ofreces, su estado, cómo se entrega, horarios disponibles, formas de pago, garantías... Cualquier detalle que ayude a la otra persona a decidir."></textarea>
                        <span class="form-hint">Mínimo 10 palabras, máximo 200. Entre más clara, más confianza genera</span>
                    </div>
                </div>
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="box"></i> Detalles del recurso</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Cantidad *</label>
                            <input type="text" id="pub-cantidad" class="form-input" placeholder="Ej: 50" inputmode="numeric" pattern="[0-9]*">
                            <span class="form-hint">Solo números (las unidades van en el campo de al lado)</span>
                        </div>
                        <div class="form-group">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                                <label class="form-label" style="margin-bottom:0">Unidad <span id="unidad-req-star">*</span></label>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="toggle-unidad-active" checked>
                                    <span class="toggle-thumb"></span>
                                </label>
                            </div>
                            <input type="text" id="pub-unidad" class="form-input" placeholder="Ej: kg, unidades">
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Condición de lo que ofreces *</label>
                        <select id="pub-condicion" class="form-select"><option value="">Selecciona una categoría primero...</option></select>
                        <span class="form-hint">Estado actual del recurso que vas a ofrecer</span>
                    </div>
                    <div class="form-group">
                        <div class="toggle-row">
                            <div>
                                <div class="toggle-label">¿Tiene precio?</div>
                                <div class="form-hint">Desactiva si lo ofreces gratis a la comunidad</div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="toggle-precio">
                                <span class="toggle-thumb"></span>
                            </label>
                        </div>
                        <div id="pub-precio-group" style="display:none; margin-top:10px">
                            <div class="toggle-label" style="margin-bottom:8px;font-size:0.8rem">¿Cómo recibes el pago?</div>
                            <div class="segmented-control" id="oferta-pago-tipo">
                                <button type="button" class="seg-opt active" data-val="Monetario">Monetario</button>
                                <button type="button" class="seg-opt" data-val="Bien o producto">Bien o producto</button>
                                <button type="button" class="seg-opt" data-val="Servicio">Servicio</button>
                            </div>
                            <input type="text" id="pub-precio" class="form-input" style="margin-top:8px" placeholder="Ej: $50.000/día">
                            <span class="form-hint" id="pub-precio-hint">Monto o descripción del pago</span>
                        </div>
                    </div>
                    <input type="hidden" id="pub-modalidad" value="Gratis">
                </div>`,
            solicitud: `
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="info"></i> ¿Qué necesitas?</div>
                    <div class="form-group">
                        <label class="form-label">Categoría *</label>
                        <select id="pub-cat" class="form-select">${this.categoryOptions()}</select>
                        <span class="form-hint">Tipo de recurso que necesitas</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Asunto *</label>
                        <input type="text" id="pub-titulo" class="form-input" placeholder="Ej: Necesito semillas de papa criolla">
                        <span class="form-hint">Mínimo 2, máximo 20 palabras. Describe brevemente lo que necesitas</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción detallada *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Especifica qué necesitas, para qué lo usarás, calidad esperada, presupuesto referencial, dónde y cuándo recibirlo... Cualquier detalle ayuda a recibir mejores ofertas."></textarea>
                        <span class="form-hint">Mínimo 10 palabras, máximo 200. Sé específico para recibir respuestas más útiles</span>
                    </div>
                </div>
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="target"></i> Especificaciones</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Cantidad *</label>
                            <input type="text" id="pub-cantidad" class="form-input" placeholder="Ej: 100" inputmode="numeric" pattern="[0-9]*">
                            <span class="form-hint">Solo números (la unidad va al lado)</span>
                        </div>
                        <div class="form-group">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                                <label class="form-label" style="margin-bottom:0">Unidad <span id="unidad-req-star">*</span></label>
                                <label class="toggle-switch">
                                    <input type="checkbox" id="toggle-unidad-active" checked>
                                    <span class="toggle-thumb"></span>
                                </label>
                            </div>
                            <input type="text" id="pub-unidad" class="form-input" placeholder="Ej: kg, bultos">
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Disponibilidad / Urgencia *</label>
                        <select id="pub-disponibilidad" class="form-select">
                            <option value="">Seleccionar...</option>
                            <option>Urgente - esta semana</option><option>Próximas 2 semanas</option>
                            <option>Este mes</option><option>Sin prisa</option>
                        </select>
                        <span class="form-hint">¿Cuándo necesitas el recurso?</span>
                    </div>
                    <div class="form-group">
                        <div class="toggle-row">
                            <div>
                                <div class="toggle-label">¿Ofrece pago?</div>
                                <div class="form-hint">Activa si estás dispuesto a pagar por el recurso</div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="toggle-precio">
                                <span class="toggle-thumb"></span>
                            </label>
                        </div>
                        <div id="pub-precio-group" style="display:none; margin-top:10px">
                            <div class="toggle-label" style="margin-bottom:8px;font-size:0.8rem">¿Qué tipo de pago ofreces?</div>
                            <div class="segmented-control" id="solicitud-pago-tipo">
                                <button type="button" class="seg-opt active" data-val="Monetario">Monetario</button>
                                <button type="button" class="seg-opt" data-val="Bien o producto">Bien o producto</button>
                                <button type="button" class="seg-opt" data-val="Servicio">Servicio</button>
                            </div>
                            <input type="text" id="pub-precio" class="form-input" placeholder="Ej: Hasta $200.000" style="margin-top:10px">
                            <span class="form-hint" id="pub-precio-hint">Monto aproximado que estás dispuesto a pagar</span>
                        </div>
                    </div>
                    <input type="hidden" id="pub-modalidad" value="Gratis">
                </div>`,
            prestamo: `
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="info"></i> ¿Qué prestas?</div>
                    <div class="form-group">
                        <label class="form-label">Categoría *</label>
                        <select id="pub-cat" class="form-select">${this.categoryOptions()}</select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Asunto *</label>
                        <input type="text" id="pub-titulo" class="form-input" placeholder="Ej: Fumigadora eléctrica disponible">
                        <span class="form-hint">Mínimo 2, máximo 20 palabras. Nombre de la herramienta o equipo</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Marca, modelo, capacidad, accesorios incluidos, qué tipo de cultivos sirve, requisitos para el préstamo, lugar de recogida... Mientras más claro, mejor."></textarea>
                        <span class="form-hint">Mínimo 10 palabras, máximo 200. Incluye todo lo relevante para quien recibe el préstamo</span>
                    </div>
                </div>
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="clock"></i> Condiciones del préstamo</div>
                    <div class="form-group">
                        <label class="form-label">Condición de lo que ofreces *</label>
                        <select id="pub-condicion" class="form-select"><option value="">Selecciona una categoría primero...</option></select>
                        <span class="form-hint">Estado actual del equipo o herramienta</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Duración máxima del préstamo *</label>
                        <div class="form-row" style="grid-template-columns:1fr 1fr;gap:8px">
                            <input type="text" id="pub-duracion-num" class="form-input" placeholder="Ej: 3" inputmode="numeric" pattern="[0-9]*">
                            <select id="pub-duracion-unidad" class="form-select">
                                <option value="">Unidad...</option>
                                <option value="horas">horas</option>
                                <option value="días">días</option>
                                <option value="semanas">semanas</option>
                                <option value="meses">meses</option>
                            </select>
                        </div>
                        <span class="form-hint">¿Por cuánto tiempo máximo puedes prestarlo?</span>
                        <input type="hidden" id="pub-duracion">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Garantía o condiciones de devolución</label>
                        <textarea id="pub-garantia" class="form-input" rows="2" placeholder="Ej: Se devuelve limpio y funcional, cualquier daño se repara"></textarea>
                        <span class="form-hint">Opcional — ¿Qué esperas al recibirlo de vuelta?</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Disponibilidad *</label>
                        <select id="pub-disponibilidad" class="form-select">
                            <option value="">Seleccionar...</option>
                            <option>Inmediata</option><option>Fines de semana</option>
                            <option>Entre semana</option><option>Coordinar por chat</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <div class="toggle-row">
                            <div>
                                <div class="toggle-label">¿Cobra por el préstamo?</div>
                                <div class="form-hint">Desactiva si lo prestas sin costo</div>
                            </div>
                            <label class="toggle-switch">
                                <input type="checkbox" id="toggle-precio">
                                <span class="toggle-thumb"></span>
                            </label>
                        </div>
                        <div id="pub-precio-group" style="display:none; margin-top:10px">
                            <div class="toggle-label" style="margin-bottom:8px;font-size:0.8rem">¿Cómo cobra el préstamo?</div>
                            <div class="segmented-control" id="prestamo-pago-tipo">
                                <button type="button" class="seg-opt active" data-val="Monetario">Monetario</button>
                                <button type="button" class="seg-opt" data-val="Bien o producto">Bien o producto</button>
                                <button type="button" class="seg-opt" data-val="Servicio">Servicio</button>
                            </div>
                            <input type="text" id="pub-precio" class="form-input" placeholder="Ej: $30.000/día" style="margin-top:10px">
                            <span class="form-hint" id="pub-precio-hint">Monto o descripción del cobro</span>
                        </div>
                    </div>
                    <input type="hidden" id="pub-modalidad" value="Gratis">
                </div>`,
            trueque: `
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="info"></i> Información del trueque</div>
                    <div class="form-group">
                        <label class="form-label">Categoría *</label>
                        <select id="pub-cat" class="form-select">${this.categoryOptions()}</select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Asunto *</label>
                        <input type="text" id="pub-titulo" class="form-input" placeholder="Ej: Cambio guadaña por semillas">
                        <span class="form-hint">Mínimo 2, máximo 20 palabras. Resume qué das y qué recibes</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Describe lo que ofreces, su estado y lo que quieres a cambio. Incluye condiciones, lugar y forma de entrega, posibles flexibilidades..."></textarea>
                        <span class="form-hint">Mínimo 10 palabras, máximo 200. Sé claro para llegar a un acuerdo más rápido</span>
                    </div>
                </div>
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="arrow-left-right"></i> Detalles del intercambio</div>
                    <div class="form-group">
                        <label class="form-label">¿Qué ofreces? *</label>
                        <input type="text" id="pub-ofrece" class="form-input" placeholder="Ej: Guadaña Stihl a gasolina en buen estado">
                        <span class="form-hint">Describe el recurso que darás a cambio</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Condición de lo que ofreces *</label>
                        <select id="pub-condicion" class="form-select"><option value="">Selecciona una categoría primero...</option></select>
                    </div>
                    <div class="form-group">
                        <div class="toggle-label" style="margin-bottom:8px">¿Qué tipo de intercambio buscas? *</div>
                        <div class="segmented-control" id="trueque-tipo">
                            <button type="button" class="seg-opt active" data-val="Bien o producto">Bien o producto</button>
                            <button type="button" class="seg-opt" data-val="Servicio">Servicio</button>
                            <button type="button" class="seg-opt" data-val="Monetario">Monetario</button>
                        </div>
                        <span class="form-hint">Elige primero — el campo siguiente se ajusta a tu elección</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">¿Qué deseas recibir? *</label>
                        <input type="text" id="pub-recibe" class="form-input" placeholder="Ej: Semillas de hortalizas o abono orgánico">
                        <span class="form-hint" id="pub-recibe-hint">Describe lo que te gustaría recibir a cambio</span>
                    </div>
                    <input type="hidden" id="pub-modalidad" value="Bien o producto">
                </div>`
        };
        const formContainer = document.getElementById('publish-form-fields');
        formContainer.innerHTML = (sections[tipo] || sections.oferta) + `
            <div class="publish-form-section">
                <div class="publish-form-section-title"><i data-lucide="camera"></i> Imagen *</div>
                <div class="form-group">
                    <div class="image-upload-area" id="pub-image-area" onclick="document.getElementById('pub-image-input').click()">
                        <i data-lucide="image-plus"></i>
                        <p>Toca para agregar una foto</p>
                        <span class="form-hint">Ayuda a que otros vean el recurso (máx 5MB)</span>
                    </div>
                    <input type="file" id="pub-image-input" accept="image/*" style="display:none" onchange="App.previewPublishImage(event)">
                    <input type="hidden" id="pub-image-data">
                </div>
            </div>
            <div class="publish-form-section">
                <div class="publish-form-section-title"><i data-lucide="map-pin"></i> Ubicación *</div>
                <p class="form-hint" style="margin-bottom:8px">¿Dónde está el recurso o se presta el servicio? No necesariamente donde vives</p>
                <div id="loc-pub"></div>
                <input type="hidden" id="pub-lat">
                <input type="hidden" id="pub-lng">
                <input type="hidden" id="pub-addr">
                <div class="form-group" style="margin-top:10px">
                    <label class="form-label">Indicaciones de llegada</label>
                    <input type="text" id="pub-loc-notes" class="form-input" placeholder="Casa azul, 200m después del parque, portón negro...">
                    <span class="form-hint">Opcional — ayuda a que te encuentren fácilmente</span>
                </div>
            </div>
            <div class="publish-action-row">
                <button class="btn btn-primary" onclick="App.doPublish()" id="btn-publish">
                    <i data-lucide="send"></i> Publicar
                </button>
                <button class="btn btn-outline" onclick="App.doPublishScheduled()" id="btn-publish-schedule">
                    <i data-lucide="calendar-clock"></i> Programar
                </button>
            </div>`;
        lucide.createIcons({ nodes: [formContainer] });
        this.initCharCounters();
        this.bindExchangeOptions();
        Geo.setupLocationPicker({
            containerId: 'loc-pub',
            latId: 'pub-lat',
            lngId: 'pub-lng',
            addrHiddenId: 'pub-addr',
            placeholder: 'Buscar municipio, vereda, corregimiento...'
        });
    },

    initCharCounters() {
        [{ id: 'pub-titulo', max: 80 }, { id: 'pub-desc', max: 500 }].forEach(({ id, max }) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.setAttribute('maxlength', max);
            const counter = document.createElement('span');
            counter.className = 'char-counter';
            counter.textContent = `0 / ${max}`;
            el.parentNode.insertBefore(counter, el.nextSibling);
            el.addEventListener('input', () => {
                const len = el.value.length;
                counter.textContent = `${len} / ${max}`;
                counter.classList.toggle('char-counter-warn', len >= Math.floor(max * 0.9));
            });
        });
    },

    categoryOptions() {
        return `<option value="">Seleccionar categoría...</option>
                <optgroup label="Herramientas y equipos">
                    <option>Herramientas y maquinaria</option>
                    <option>Riego y sistemas de agua</option>
                    <option>Energía (solar, generadores)</option>
                    <option>Transporte y logística</option>
                    <option>Empaque y almacenamiento</option>
                </optgroup>
                <optgroup label="Insumos agrícolas">
                    <option>Semillas e insumos</option>
                    <option>Fertilizantes y abonos</option>
                    <option>Compost y abono orgánico</option>
                    <option>Control de plagas</option>
                    <option>Viveros y plántulas</option>
                </optgroup>
                <optgroup label="Producción">
                    <option>Frutas y verduras</option>
                    <option>Granos y cereales</option>
                    <option>Hortalizas</option>
                    <option>Tubérculos</option>
                    <option>Ganadería</option>
                    <option>Aves de corral</option>
                    <option>Productos lácteos</option>
                    <option>Miel y apicultura</option>
                    <option>Excedentes de producción</option>
                    <option>Cosecha y postcosecha</option>
                </optgroup>
                <optgroup label="Servicios y conocimiento">
                    <option>Mano de obra</option>
                    <option>Asesoría técnica</option>
                    <option>Capacitación y cursos</option>
                    <option>Tierra en arriendo</option>
                </optgroup>
                <option>Otros recursos</option>`;
    },

    CONDITIONS_BY_CAT: {
        'Herramientas y maquinaria':    ['Nuevo','Sellado / Empacado','Seminuevo','Excelente','Buen estado','Usado','Regular','Requiere mantenimiento menor','Requiere reparación','Para repuestos / piezas'],
        'Riego y sistemas de agua':     ['Nuevo','Sellado','Excelente','Buen estado','Funcional','Usado','Regular','Requiere mantenimiento','Requiere reparación'],
        'Energía (solar, generadores)': ['Nuevo','Sellado','Excelente','Buen estado','Usado','Regular','Requiere revisión técnica','Incompleto / Piezas'],
        'Transporte y logística':       ['Nuevo','Excelente','Buen estado','Usado','Regular','Requiere mantenimiento','Solo para carga liviana'],
        'Empaque y almacenamiento':     ['Nuevo','Sellado / Sin uso','Buen estado','Reparado','Usado','Regular'],

        'Semillas e insumos':           ['Certificada','Tratada','Orgánica','Convencional','Fresca / Reciente','Próxima a vencer','Sellada / Empaque original','Granel'],
        'Fertilizantes y abonos':       ['Sellado / Empaque original','Abierto - buen estado','Próximo a vencer','Certificado orgánico','Convencional','Granel'],
        'Compost y abono orgánico':     ['Fresco / Reciente','Maduro','Semi-maduro','Seco','Granel','Empacado'],
        'Control de plagas':            ['Sellado / Empaque original','Abierto - buen estado','Próximo a vencer','Registrado ICA','Biológico / Orgánico'],
        'Viveros y plántulas':          ['Germinado','En semillero','Plántula joven','Saludable','En crecimiento','Listo para trasplantar'],

        'Frutas y verduras':            ['Recién cosechado','Fresco','Orgánico certificado','Convencional','Segunda calidad','Procesado','Deshidratado'],
        'Granos y cereales':            ['Recién cosechado','Seco','Limpio y clasificado','Orgánico','Convencional','En bulto / Empacado','Trillado'],
        'Hortalizas':                   ['Recién cosechado','Fresco','Orgánico','Convencional','Segunda calidad','Lavado y clasificado'],
        'Tubérculos':                   ['Recién cosechado','Fresco','Clasificado','Orgánico','Convencional','Para semilla','Segunda calidad'],
        'Ganadería':                    ['Sano / Vacunado','En producción','En destete','Adulto','Joven / Cría','Con registros sanitarios ICA','Para levante','Para ceba'],
        'Aves de corral':               ['Sano / Vacunado','En postura','Para engorde','Pollito / Joven','Con historial sanitario','Ponedora descartada'],
        'Productos lácteos':            ['Fresco / Del día','Pasteurizado','Crudo','Artesanal','Refrigerado','Con fecha de vencimiento vigente'],
        'Miel y apicultura':            ['Cruda / Sin procesar','Filtrada','Orgánica','Convencional','Cristalizada','Líquida','Subproducto (cera / propóleo)'],
        'Excedentes de producción':     ['Fresco','Buen estado','Segunda calidad','Próximo a vencer','Procesado'],
        'Cosecha y postcosecha':        ['Para cosechar de inmediato','Listo para cosechar','En campo','Postcosecha procesado','Enfriado / Refrigerado'],

        'Mano de obra':                 ['Con experiencia','Semi-experimentado','En aprendizaje','Con certificación SENA','Disponible de inmediato','Por jornada','Por proyecto','Por contrato'],
        'Asesoría técnica':             ['Presencial','Virtual / Remota','Con certificación profesional','Con experiencia práctica','Especializado en la zona','Por visita','Por proyecto'],
        'Capacitación y cursos':        ['Teórico','Práctico','Curso certificado SENA','Taller en campo','Virtual','Presencial','Con materiales incluidos'],
        'Tierra en arriendo':           ['Con riego','Sin riego','Preparada / Lista para siembra','Sin preparar','Terreno plano','Ladera','Con invernadero','Con galpón','Con bodega','Área cercada'],

        'Otros recursos':               ['Nuevo','Buen estado','Usado','Regular','Otro'],
    },

    getConditionsForCategory(cat) {
        const list = this.CONDITIONS_BY_CAT[cat];
        if (!cat) return '<option value="">Selecciona una categoría primero...</option>';
        if (!list) return '<option value="">Seleccionar condición...</option><option>Buen estado</option><option>Regular</option><option>Otro</option>';
        return '<option value="">Seleccionar condición...</option>' + list.map(c => `<option>${c}</option>`).join('');
    },

    refreshCondicionOptions() {
        const cat = document.getElementById('pub-cat')?.value || '';
        const el = document.getElementById('pub-condicion');
        if (!el) return;
        const prev = el.value;
        el.innerHTML = this.getConditionsForCategory(cat);
        if (prev) el.value = prev;
    },

    unidadToggleBlock() {
        return `
            <div class="form-group" style="margin-top:-6px">
                <div class="toggle-row">
                    <div>
                        <div class="toggle-label">Unidad no aplica</div>
                        <div class="form-hint">Actívalo si el recurso no se mide en una unidad</div>
                    </div>
                    <label class="toggle-switch">
                        <input type="checkbox" id="toggle-unidad-na">
                        <span class="toggle-thumb"></span>
                    </label>
                </div>
            </div>`;
    },

    bindExchangeOptions() {
        const tipo = this.currentPublishType;
        // Category → dynamic condition options
        const catEl = document.getElementById('pub-cat');
        if (catEl) {
            catEl.addEventListener('change', () => this.refreshCondicionOptions());
            this.refreshCondicionOptions();
        }
        // Toggle precio on/off
        const toggle = document.getElementById('toggle-precio');
        if (toggle) {
            toggle.addEventListener('change', () => {
                const group = document.getElementById('pub-precio-group');
                const modalidad = document.getElementById('pub-modalidad');
                if (group) group.style.display = toggle.checked ? '' : 'none';
                if (!toggle.checked) {
                    const inp = document.getElementById('pub-precio');
                    if (inp) inp.value = '';
                    if (modalidad) modalidad.value = 'Gratis';
                } else {
                    if (modalidad) modalidad.value = 'Monetario';
                    const periodo = document.getElementById('pub-precio-periodo');
                    if (periodo) periodo.style.display = (tipo === 'solicitud' || tipo === 'prestamo') ? '' : 'none';
                }
            });
        }
        // Inject periodo select inside pub-precio-group (Monetario only)
        const precioGroup = document.getElementById('pub-precio-group');
        if (precioGroup && !document.getElementById('pub-precio-periodo')) {
            const periodoSel = document.createElement('select');
            periodoSel.id = 'pub-precio-periodo';
            periodoSel.className = 'form-select';
            periodoSel.style.cssText = `margin-top:8px;display:${(tipo === 'solicitud' || tipo === 'prestamo') ? 'block' : 'none'}`;
            periodoSel.innerHTML = `
                <option value="">Sin período específico</option>
                <option value="por hora">por hora</option>
                <option value="por día">por día</option>
                <option value="por semana">por semana</option>
                <option value="por quincena">por quincena</option>
                <option value="por mes">por mes</option>
                <option value="por temporada">por temporada</option>
                <option value="por cosecha">por cosecha</option>
                <option value="por jornal">por jornal</option>
                <option value="por kg">por kg</option>
                <option value="por libra">por libra</option>
                <option value="por arroba">por arroba</option>
                <option value="por bulto">por bulto</option>
                <option value="por hectárea">por hectárea</option>
                <option value="por fanegada">por fanegada</option>
                <option value="por lote">por lote</option>
                <option value="en total">en total</option>
                <option value="a convenir">a convenir</option>`;
            precioGroup.appendChild(periodoSel);
        }
        // Cantidad: solo dígitos (texto descriptivo va en Unidad)
        const cantidadInput = document.getElementById('pub-cantidad');
        if (cantidadInput) {
            cantidadInput.setAttribute('inputmode', 'numeric');
            cantidadInput.addEventListener('input', () => {
                const cleaned = cantidadInput.value.replace(/\D/g, '');
                if (cleaned !== cantidadInput.value) cantidadInput.value = cleaned;
            });
        }
        // Préstamo: combinar número + unidad en pub-duracion (hidden)
        const durNum = document.getElementById('pub-duracion-num');
        const durUni = document.getElementById('pub-duracion-unidad');
        const durHidden = document.getElementById('pub-duracion');
        const syncDuracion = () => {
            if (!durHidden) return;
            const n = (durNum?.value || '').replace(/\D/g, '');
            const u = durUni?.value || '';
            durHidden.value = (n && u) ? `${n} ${u}` : '';
        };
        if (durNum) {
            durNum.addEventListener('input', () => {
                const cleaned = durNum.value.replace(/\D/g, '');
                if (cleaned !== durNum.value) durNum.value = cleaned;
                syncDuracion();
            });
        }
        if (durUni) durUni.addEventListener('change', syncDuracion);
        // Monetary formatting for pub-precio
        const precioInput = document.getElementById('pub-precio');
        if (precioInput) {
            precioInput.addEventListener('input', () => {
                const modalidad = document.getElementById('pub-modalidad');
                if (!modalidad || modalidad.value !== 'Monetario') return;
                const pos = precioInput.selectionStart;
                const prevLen = precioInput.value.length;
                const raw = precioInput.value.replace(/\D/g, '');
                if (!raw) { precioInput.value = ''; return; }
                const formatted = parseInt(raw, 10).toLocaleString('es-CO');
                precioInput.value = formatted;
                const diff = formatted.length - prevLen;
                try { precioInput.setSelectionRange(pos + diff, pos + diff); } catch(_) {}
            });
            precioInput.setAttribute('inputmode', 'numeric');
        }
        // Unit toggle (checked = unit active, unchecked = No aplica)
        const unidadActive = document.getElementById('toggle-unidad-active');
        if (unidadActive) {
            unidadActive.addEventListener('change', () => {
                const unidad = document.getElementById('pub-unidad');
                const star = document.getElementById('unidad-req-star');
                if (!unidad) return;
                if (!unidadActive.checked) {
                    unidad.dataset.prev = unidad.value;
                    unidad.value = 'No aplica';
                    unidad.disabled = true;
                    unidad.classList.add('input-disabled');
                    if (star) star.style.display = 'none';
                } else {
                    unidad.value = unidad.dataset.prev || '';
                    unidad.disabled = false;
                    unidad.classList.remove('input-disabled');
                    if (star) star.style.display = '';
                }
            });
        }
        // Segmented controls: trueque tipo, and all payment-type controls
        const pagoHints = {
            'Monetario':       { hint: 'Monto o valor acordado', placeholder: 'Ej: $50.000/día' },
            'Bien o producto': { hint: 'Describe qué bien o producto', placeholder: 'Ej: 2 bultos de papa criolla' },
            'Servicio':        { hint: 'Describe el servicio', placeholder: 'Ej: 1 jornada de trabajo' },
        };
        const recibeHints = {
            'Bien o producto': { hint: 'Describe el bien o producto que esperas recibir', placeholder: 'Ej: Semillas de hortalizas o abono orgánico' },
            'Servicio':        { hint: 'Describe el servicio que esperas a cambio', placeholder: 'Ej: 2 jornadas de mano de obra' },
            'Monetario':       { hint: 'Indica el monto que esperas recibir', placeholder: 'Ej: $150.000' },
        };
        ['#trueque-tipo', '#oferta-pago-tipo', '#prestamo-pago-tipo', '#solicitud-pago-tipo'].forEach(sel => {
            const isTrueque = sel === '#trueque-tipo';
            document.querySelectorAll(`${sel} .seg-opt`).forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll(`${sel} .seg-opt`).forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const modalidad = document.getElementById('pub-modalidad');
                    if (modalidad) modalidad.value = btn.dataset.val;
                    if (isTrueque) {
                        const r = recibeHints[btn.dataset.val];
                        const inp = document.getElementById('pub-recibe');
                        const hint = document.getElementById('pub-recibe-hint');
                        if (r && inp) { inp.placeholder = r.placeholder; }
                        if (r && hint) hint.textContent = r.hint;
                        if (btn.dataset.val === 'Monetario' && inp) {
                            inp.setAttribute('inputmode', 'numeric');
                        } else if (inp) {
                            inp.removeAttribute('inputmode');
                        }
                        return;
                    }
                    const d = pagoHints[btn.dataset.val];
                    if (d) {
                        const inp = document.getElementById('pub-precio');
                        const hint = document.getElementById('pub-precio-hint');
                        if (inp) { inp.placeholder = d.placeholder; inp.value = ''; }
                        if (hint) hint.textContent = d.hint;
                    }
                    const periodo = document.getElementById('pub-precio-periodo');
                    if (periodo) periodo.style.display = (tipo === 'solicitud' || tipo === 'prestamo') && btn.dataset.val === 'Monetario' ? '' : 'none';
                });
            });
        });
    },

    previewPublishImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            this.showToast('Imagen muy grande (máx 5MB)', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('pub-image-data').value = e.target.result;
            const area = document.getElementById('pub-image-area');
            area.innerHTML = `<img src="${e.target.result}" alt="Preview"><p style="margin-top:8px">Toca para cambiar la foto</p>`;
        };
        reader.readAsDataURL(file);
    },

    fieldError(id, msg) {
        const el = document.getElementById(id);
        if (el) {
            const isField = el.matches('input,select,textarea');
            const target = isField ? el : (el.querySelector('input') || el);
            target.classList.add('input-error');
            if (id === 'loc-pub') el.classList.add('loc-error');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (isField) setTimeout(() => target.focus(), 320);
            const clear = () => {
                target.classList.remove('input-error');
                el.classList.remove('loc-error');
                target.removeEventListener('input', clear);
                target.removeEventListener('change', clear);
                el.removeEventListener('click', clear);
            };
            target.addEventListener('input', clear);
            target.addEventListener('change', clear);
            el.addEventListener('click', clear);
        }
        this.showToast(msg, 'error');
    },

    _editingResourceId: null,

    async editResource(id) {
        try {
            const r = await API.getResource(id);
            this.closeDetail();
            this._editingResourceId = id;
            this.switchTab('publicar');
            // Render form for the resource's tipo, then populate
            this.setPublishType(r.tipo);
            setTimeout(() => this._populatePublishForm(r), 80);
        } catch (e) {
            this.showToast('Error al cargar publicación', 'error');
        }
    },

    cancelEditResource() {
        this._editingResourceId = null;
        this.initPublishForm();
        this.showToast('Edición cancelada');
    },

    _setVal(id, val) {
        const el = document.getElementById(id);
        if (!el || val == null) return;
        el.value = val;
    },

    _populatePublishForm(r) {
        // Set tipo selector tab if exists
        document.querySelectorAll('.type-selector .type-opt').forEach(b => {
            b.classList.toggle('active', b.dataset.tipo === r.tipo);
        });

        this._setVal('pub-titulo', r.titulo);
        this._setVal('pub-desc', r.descripcion);
        this._setVal('pub-cat', r.categoria);
        this.refreshCondicionOptions();
        this._setVal('pub-condicion', r.condicion);
        this._setVal('pub-cantidad', String(r.cantidad || '').replace(/\D/g, ''));
        this._setVal('pub-disponibilidad', r.disponibilidad);
        this._setVal('pub-duracion', r.duracion_prestamo);
        // Split duracion back into number + unidad
        if (r.duracion_prestamo) {
            const m = String(r.duracion_prestamo).match(/^(\d+)\s+(horas|días|dias|semanas|meses)$/i);
            if (m) {
                let unit = m[2].toLowerCase();
                if (unit === 'dias') unit = 'días';
                this._setVal('pub-duracion-num', m[1]);
                this._setVal('pub-duracion-unidad', unit);
            }
        }
        this._setVal('pub-garantia', r.garantia);
        this._setVal('pub-ofrece', r.ofrece);
        this._setVal('pub-recibe', r.recibe);
        this._setVal('pub-loc-notes', r.location_notes);

        // Unidad: handle "No aplica"
        const unidadActive = document.getElementById('toggle-unidad-active');
        const unidadInput = document.getElementById('pub-unidad');
        if (unidadActive && unidadInput) {
            if (r.unidad === 'No aplica') {
                unidadActive.checked = false;
                unidadActive.dispatchEvent(new Event('change'));
            } else {
                unidadActive.checked = true;
                unidadInput.value = r.unidad || '';
            }
        }

        // Precio: parse value and periodo
        const precioToggle = document.getElementById('toggle-precio');
        const modalidadEl = document.getElementById('pub-modalidad');
        if (r.precio_referencia && precioToggle) {
            precioToggle.checked = true;
            precioToggle.dispatchEvent(new Event('change'));
            const periodoMatch = (r.precio_referencia || '').match(/^(.*?)\s+(por\s+\w+|por\s+\w+\s+\w+|en\s+total|a\s+convenir)$/i);
            const precioVal = periodoMatch ? periodoMatch[1].trim() : r.precio_referencia;
            const precioPer = periodoMatch ? periodoMatch[2].toLowerCase() : '';
            this._setVal('pub-precio', precioVal);
            this._setVal('pub-precio-periodo', precioPer);
        }
        if (modalidadEl && r.modalidad) {
            modalidadEl.value = r.modalidad;
            ['#oferta-pago-tipo', '#prestamo-pago-tipo', '#solicitud-pago-tipo', '#trueque-tipo'].forEach(sel => {
                document.querySelectorAll(`${sel} .seg-opt`).forEach(b => {
                    b.classList.toggle('active', b.dataset.val === r.modalidad);
                });
            });
        }

        // Image preview
        if (r.image_data) {
            const area = document.getElementById('pub-image-area');
            const hidden = document.getElementById('pub-image-data');
            if (hidden) hidden.value = r.image_data;
            if (area) area.innerHTML = `<img src="${r.image_data}" alt="Preview"><p style="margin-top:8px">Toca para cambiar la foto</p>`;
        }

        // Location
        this._setVal('pub-lat', r.latitude);
        this._setVal('pub-lng', r.longitude);
        this._setVal('pub-addr', r.municipio);
        if (r.latitude != null && r.longitude != null && Geo._pickerSetLocation && Geo._pickerSetLocation['loc-pub']) {
            try { Geo._pickerSetLocation['loc-pub'](r.latitude, r.longitude); } catch (_) {}
        }

        // Replace publish/schedule buttons with save/cancel
        const actionRow = document.querySelector('.publish-action-row');
        if (actionRow) {
            actionRow.innerHTML = `
                <button class="btn btn-primary" onclick="App.doPublish()" id="btn-publish">
                    <i data-lucide="save"></i> Guardar cambios
                </button>
                <button class="btn btn-outline" onclick="App.cancelEditResource()">
                    <i data-lucide="x"></i> Cancelar
                </button>`;
            lucide.createIcons({ nodes: [actionRow] });
        }

        // Banner indicating edit mode
        const formContainer = document.getElementById('publish-form-fields');
        if (formContainer && !document.getElementById('edit-banner')) {
            const banner = document.createElement('div');
            banner.id = 'edit-banner';
            banner.className = 'publish-form-section';
            banner.style.cssText = 'background:var(--cream);border-left:4px solid var(--field);padding:10px 14px;margin-bottom:12px';
            banner.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:0.88rem;color:var(--earth)"><i data-lucide="edit-3" style="width:16px;height:16px"></i> <strong>Editando publicación</strong></div>`;
            formContainer.insertBefore(banner, formContainer.firstChild);
            lucide.createIcons({ nodes: [banner] });
        }

        this.showToast('Editando publicación');
    },

    async doPublish(scheduledAt = null) {
        const btn = document.getElementById('btn-publish');
        if (btn) btn.classList.add('loading');
        const schedBtn = document.getElementById('btn-publish-schedule');
        if (schedBtn) schedBtn.disabled = true;
        try {
            const tipo = this.currentPublishType;
            const unidadActiveEl = document.getElementById('toggle-unidad-active');
            const unidadActiva = !unidadActiveEl || unidadActiveEl.checked;
            const cantidadEl = document.getElementById('pub-cantidad');
            const condicionEl = document.getElementById('pub-condicion');
            const data = {
                tipo,
                titulo: document.getElementById('pub-titulo')?.value?.trim() || '',
                descripcion: document.getElementById('pub-desc')?.value?.trim() || '',
                categoria: document.getElementById('pub-cat')?.value || '',
                municipio: document.getElementById('pub-addr')?.value || '',
                cantidad: cantidadEl?.value?.trim() || '',
                unidad: unidadActiva ? (document.getElementById('pub-unidad')?.value?.trim() || '') : 'No aplica',
                condicion: condicionEl?.value || '',
                disponibilidad: document.getElementById('pub-disponibilidad')?.value || '',
                precio_referencia: document.getElementById('pub-precio')?.value?.trim() || '',
                duracion_prestamo: document.getElementById('pub-duracion')?.value?.trim() || '',
                garantia: document.getElementById('pub-garantia')?.value?.trim() || '',
                ofrece: document.getElementById('pub-ofrece')?.value?.trim() || '',
                recibe: document.getElementById('pub-recibe')?.value?.trim() || '',
                image_data: document.getElementById('pub-image-data')?.value || '',
                latitude: parseFloat(document.getElementById('pub-lat')?.value) || null,
                longitude: parseFloat(document.getElementById('pub-lng')?.value) || null,
                scheduled_at: scheduledAt || null,
                location_notes: document.getElementById('pub-loc-notes')?.value?.trim() || '',
            };
            const modalidadEl = document.getElementById('pub-modalidad');
            if (modalidadEl) data.modalidad = modalidadEl.value;
            const precioToggleEl = document.getElementById('toggle-precio');
            const precioActivo = precioToggleEl && precioToggleEl.checked;
            const precioPeriodo = document.getElementById('pub-precio-periodo')?.value || '';
            const precioVal = data.precio_referencia;
            if (precioActivo && precioVal && precioPeriodo) data.precio_referencia = `${precioVal} ${precioPeriodo}`;
            const disponibilidadEl = document.getElementById('pub-disponibilidad');
            const duracionEl = document.getElementById('pub-duracion');
            const ofreceEl = document.getElementById('pub-ofrece');
            const recibeEl = document.getElementById('pub-recibe');
            if (!data.titulo) return this.fieldError('pub-titulo', 'El asunto es obligatorio');
            const tituloWords = data.titulo.split(/\s+/).filter(Boolean).length;
            if (tituloWords < 2) return this.fieldError('pub-titulo', 'El asunto debe tener al menos 2 palabras');
            if (tituloWords > 20) return this.fieldError('pub-titulo', 'El asunto no puede tener más de 20 palabras');
            if (!data.descripcion) return this.fieldError('pub-desc', 'La descripción es obligatoria');
            const descWords = data.descripcion.split(/\s+/).filter(Boolean).length;
            if (descWords < 10) return this.fieldError('pub-desc', `La descripción debe tener al menos 10 palabras (lleva ${descWords})`);
            if (descWords > 200) return this.fieldError('pub-desc', `La descripción no puede tener más de 200 palabras (lleva ${descWords})`);
            if (!data.categoria) return this.fieldError('pub-cat', 'Selecciona una categoría');
            if (cantidadEl && !data.cantidad) return this.fieldError('pub-cantidad', 'La cantidad es obligatoria');
            if (cantidadEl && data.cantidad && !/^\d+$/.test(data.cantidad)) return this.fieldError('pub-cantidad', 'La cantidad solo puede tener números');
            if (unidadActiva && unidadActiveEl && !document.getElementById('pub-unidad')?.value?.trim()) return this.fieldError('pub-unidad', 'Ingresa la unidad o desactiva el campo');
            if (condicionEl && !data.condicion) return this.fieldError('pub-condicion', 'Selecciona la condición del recurso');
            if (precioActivo && !precioVal) return this.fieldError('pub-precio', 'Ingresa el precio o desactiva el campo');
            if (disponibilidadEl && !data.disponibilidad) return this.fieldError('pub-disponibilidad', 'Selecciona la disponibilidad');
            if (duracionEl) {
                const durNum = (document.getElementById('pub-duracion-num')?.value || '').trim();
                const durUni = document.getElementById('pub-duracion-unidad')?.value || '';
                const existing = (duracionEl.value || '').trim();
                if (durNum && durUni) {
                    data.duracion_prestamo = `${durNum} ${durUni}`;
                } else if (existing && !durNum && !durUni) {
                    data.duracion_prestamo = existing;
                } else if (!durNum) {
                    return this.fieldError('pub-duracion-num', 'Indica la cantidad de tiempo del préstamo');
                } else if (!durUni) {
                    return this.fieldError('pub-duracion-unidad', 'Selecciona la unidad de tiempo (horas, días...)');
                }
            }
            if (ofreceEl && !data.ofrece) return this.fieldError('pub-ofrece', 'Describe lo que ofreces en el trueque');
            if (recibeEl && !data.recibe) return this.fieldError('pub-recibe', 'Describe lo que deseas recibir a cambio');
            if (!data.image_data) return this.fieldError('pub-image-area', 'Agrega una foto del recurso');
            if (!data.municipio) return this.fieldError('loc-pub', 'La ubicación es obligatoria');
            if (this._editingResourceId) {
                const editId = this._editingResourceId;
                this._editingResourceId = null;
                await API.updateResource(editId, data);
                this.showToast('Publicación actualizada');
            } else {
                await API.createResource(data);
                this.showToast(scheduledAt ? 'Publicación programada exitosamente' : 'Publicación creada exitosamente');
            }
            this.switchTab('inicio');
            Subscription.refresh();
        } catch (e) {
            if (e.code === 'subscription_required') {
                if (e.data && e.data.subscription) Subscription.lastState = e.data.subscription;
                Subscription.openPaywall(e.data && e.data.message);
            } else {
                this.showToast(e.message, 'error');
            }
        } finally {
            if (btn) btn.classList.remove('loading');
            if (schedBtn) schedBtn.disabled = false;
        }
    },

    async doPublishScheduled() {
        const now = new Date();
        now.setMinutes(now.getMinutes() + 5);
        const min = now.toISOString().slice(0, 16);
        const def = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
        const date = await this.showDatepicker({
            icon: 'calendar-clock',
            title: 'Programar publicación',
            subtitle: 'Elige cuándo quieres que sea visible en la comunidad',
            okLabel: 'Programar',
            minDate: min,
            defaultDate: def
        });
        if (!date) return;
        const isoDate = new Date(date).toISOString().replace('T', ' ').slice(0, 19);
        await this.doPublish(isoDate);
    },

    // ===== AGREEMENTS =====
    async loadAgreements() {
        const container = document.getElementById('agreements-list');
        container.innerHTML = '<div class="skeleton-card skeleton"></div><div class="skeleton-card skeleton"></div>';
        try {
            // Always fetch all to get correct tab counts, then filter locally
            const allAgreements = await API.getAgreements({});
            this.updateAgreementTabs(allAgreements);
            const filtered = this.currentAgreementFilter === 'todos' ? allAgreements
                : allAgreements.filter(a => a.status === this.currentAgreementFilter);
            if (filtered.length === 0) {
                container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
                    <i data-lucide="briefcase"></i>
                    <h3>Sin servicios aún</h3>
                    <p>Cuando solicites o te soliciten un recurso, tus servicios aparecerán aquí</p>
                    <button class="btn btn-secondary" onclick="App.switchTab('mercado')" style="margin-top:10px;padding:7px 16px;font-size:0.78rem">
                        <i data-lucide="search"></i> Explorar recursos
                    </button>
                </div>`;
                lucide.createIcons({ nodes: [container] });
                return;
            }
            const agItems = filtered.map(a => this.renderAgreementCard(a));
            container.innerHTML = (window.Subscription && Subscription.injectInFeed)
                ? Subscription.injectInFeed(agItems, 5)
                : agItems.join('');
            lucide.createIcons({ nodes: [container] });
        } catch (e) {
            console.error('Error loading agreements:', e);
            container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Error al cargar servicios</p></div>';
        }
    },

    updateAgreementTabs(all) {
        const counts = { todos: all.length, pending: 0, active: 0, completed: 0, cancelled: 0 };
        all.forEach(a => {
            // 'rejected' agrupa con 'cancelled' visualmente
            const key = a.status === 'rejected' ? 'cancelled' : a.status;
            if (counts[key] !== undefined) counts[key]++;
        });
        document.querySelectorAll('.status-tab .count').forEach(el => {
            const status = el.parentElement.dataset.status;
            const n = counts[status] || 0;
            el.textContent = n;
            el.style.display = '';
            el.parentElement.classList.toggle('status-tab-empty', n === 0 && status !== 'todos');
        });
    },

    async refreshAgreementCounts() {
        try {
            const all = await API.getAgreements({});
            if (all && all.length >= 0) {
                this.updateAgreementTabs(all);
            }
        } catch (e) {
            console.debug('Could not refresh agreement counts:', e.message);
        }
    },

    renderAgreementCard(a) {
        const isProvider = a.provider_id === API.user.id;
        const otherName = isProvider ? `${a.req_nombre} ${a.req_apellido}` : `${a.prov_nombre} ${a.prov_apellido}`;
        const nameParts = otherName.trim().split(' ');
        const shortName = nameParts[0] + (nameParts[1] ? ' ' + nameParts[1][0] + '.' : '');
        const statusLabels = { pending: 'Pendiente', active: 'En curso', completed: 'Completado', rejected: 'Rechazado', cancelled: 'Cancelado' };
        const catIcon = this.ICONS[a.resource_cat] || 'package';
        const catShort = (a.resource_cat || '').split(/[\(,]/)[0].trim();
        const catDisplay = catShort.length > 16 ? catShort.slice(0, 14) + '…' : catShort;
        const roleText = isProvider ? `${this.esc(shortName)} te solicitó` : `Solicitaste a ${this.esc(shortName)}`;
        const dateStr = this.formatDateShort(a.created_at);
        const updStr = a.updated_at && a.updated_at !== a.created_at ? this.formatDateShort(a.updated_at) : null;

        let btns = '';
        const chatLabel = a.unread_count > 0 ? `Chat (${a.unread_count})` : 'Chat';
        if (a.status === 'completed') {
            const rated = isProvider ? a.rating_provider : a.rating_requester;
            btns = rated
                ? `<span class="agr-btn-done"><i data-lucide="star"></i> Calificado ${rated}/5</span>`
                : `<button class="btn btn-earth btn-xs" onclick="event.stopPropagation();App.showRating('${a.id}')"><i data-lucide="star"></i> Calificar</button>`;
        } else if (a.status === 'cancelled' || a.status === 'rejected') {
            btns = `<button class="btn btn-outline btn-xs" onclick="event.stopPropagation();App.openAgreementChat('${a.id}')"><i data-lucide="message-circle"></i> Ver chat</button>`;
        } else {
            btns = `<button class="btn btn-outline btn-xs" onclick="event.stopPropagation();App.openAgreementChat('${a.id}')"><i data-lucide="message-circle"></i> ${chatLabel}</button>`;
            if (isProvider && a.status === 'pending') {
                btns += `<button class="btn btn-success btn-xs" onclick="event.stopPropagation();App.updateAgreement('${a.id}','active')"><i data-lucide="check"></i> Aceptar</button>
                         <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();App.updateAgreement('${a.id}','rejected')"><i data-lucide="x"></i></button>`;
            } else if (isProvider && a.status === 'active') {
                btns += `<button class="btn btn-success btn-xs" onclick="event.stopPropagation();App.markComplete('${a.id}')"><i data-lucide="check-circle"></i> Completar</button>`;
            } else if (!isProvider && a.status === 'pending') {
                btns += `<span class="agreement-waiting"><i data-lucide="clock"></i> Esperando</span>`;
            }
        }

        const cancelBlock = (a.status === 'cancelled' || a.status === 'rejected') && a.cancel_reason
            ? `<div class="agr-card-cancel-reason" style="margin-top:4px;padding:6px 8px;background:#fbeaea;border-left:2px solid #c0392b;font-size:0.76rem;border-radius:6px;color:#7a1a1a"><strong>Motivo${a.cancelled_by_nombre ? ' (' + this.esc(a.cancelled_by_nombre) + ')' : ''}:</strong> ${this.esc(a.cancel_reason)}</div>`
            : '';

        return `
            <div class="agreement-card ${a.status}" onclick="App.showAgreementDetail('${a.id}')">
                <div class="agr-card-row1">
                    <div class="agr-card-cat-icon"><i data-lucide="${catIcon}"></i></div>
                    <h4 class="agr-card-title">${this.esc(a.resource_titulo || 'Servicio')}</h4>
                    <span class="agr-card-date-top">${dateStr}</span>
                </div>
                <div class="agr-card-row2">
                    ${a.resource_tipo ? `<span class="tipo-badge ${a.resource_tipo}">${this.TYPE_LABELS[a.resource_tipo] || a.resource_tipo}</span>` : ''}
                    <span class="status-badge ${a.status}">${statusLabels[a.status] || a.status}</span>
                    ${catDisplay ? `<span class="agr-cat-badge">${this.esc(catDisplay)}</span>` : ''}
                </div>
                <div class="agr-card-role-row">
                    <span class="agr-card-sub">${roleText}</span>
                    ${updStr ? `<span class="agr-card-upd"><i data-lucide="clock" style="width:10px;height:10px;vertical-align:middle"></i> ${updStr}</span>` : ''}
                </div>
                ${cancelBlock}
                <div class="agr-card-btns">${btns}</div>
            </div>`;
    },

    setAgreementFilter(status) {
        this.currentAgreementFilter = status;
        document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-status="${status}"]`)?.classList.add('active');
        this.loadAgreements();
    },

    async updateAgreement(id, status) {
        try {
            const payload = { status };
            if (status === 'cancelled' || status === 'rejected') {
                const promptTitle = status === 'cancelled' ? '¿Por qué cancelas?' : '¿Por qué rechazas?';
                const reason = await this.showInputModal({
                    icon: 'alert-circle',
                    title: promptTitle,
                    subtitle: 'Cuéntale a la otra parte el motivo. Quedará registrado.',
                    placeholder: 'Ej: ya no necesito el recurso / cambié de planes...',
                    okLabel: 'Enviar motivo',
                });
                if (reason === null) return;
                const trimmed = (reason || '').trim();
                if (!trimmed) { this.showToast('Debes indicar un motivo', 'error'); return; }
                payload.cancel_reason = trimmed;
            }
            await API.updateAgreement(id, payload);
            const labels = { active: 'Aceptado — servicio iniciado', rejected: 'Solicitud rechazada', cancelled: 'Cancelado', completed: '¡Servicio completado!' };
            this.showToast(labels[status] || 'Actualizado');
            this.loadAgreements();
            this.loadHome();
            Chat.refreshStatusBar(id);
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    },

    async markComplete(id) {
        const confirmed = await this.showConfirm({
            icon: 'check-circle',
            title: '¿Completar servicio?',
            msg: 'Confirma que el servicio fue realizado satisfactoriamente.',
            okLabel: 'Sí, completar'
        });
        if (!confirmed) return;
        try {
            await API.updateAgreement(id, { status: 'completed' });
            this.showToast('¡Servicio completado!');
            this.loadAgreements();
            this.loadHome();
            Chat.refreshStatusBar(id);
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    },

    async showAgreementDetail(id) {
        try {
            const a = await API.getAgreement(id);
            const isProvider = a.provider_id === API.user.id;
            const otherName = isProvider ? `${a.req_nombre} ${a.req_apellido}` : `${a.prov_nombre} ${a.prov_apellido}`;
            const otherInitials = isProvider ? `${a.req_nombre[0]}${a.req_apellido[0]}` : `${a.prov_nombre[0]}${a.prov_apellido[0]}`;
            const statusLabels = { pending: 'Pendiente', active: 'En curso', completed: 'Completado', rejected: 'Rechazado', cancelled: 'Cancelado' };
            const tipoLabels = { oferta: 'Oferta', solicitud: 'Solicitud', prestamo: 'Préstamo', trueque: 'Trueque' };
            const tipoIcon = this.TYPE_ICONS[a.resource_tipo] || 'package';
            const catIcon = this.ICONS[a.resource_cat] || 'package';

            let infoItems = '';
            const addInfo = (icon, label, value) => {
                if (value) infoItems += `<div class="detail-info-item"><div class="detail-info-label"><i data-lucide="${icon}"></i> ${label}</div><div class="detail-info-value">${this.esc(value)}</div></div>`;
            };
            addInfo('tag', 'Categoría', a.resource_cat);
            addInfo('package', 'Tipo', tipoLabels[a.resource_tipo] || a.resource_tipo);
            addInfo('activity', 'Estado', statusLabels[a.status]);
            addInfo('calendar-plus', 'Solicitado', this.formatDate(a.created_at));
            if (a.status === 'active' || a.status === 'completed') addInfo('calendar-check', 'Asignado', this.formatDate(a.updated_at));
            if (a.status === 'completed') addInfo('calendar-x2', 'Terminado', this.formatDate(a.updated_at));

            const html = `
                <div class="detail-header">
                    <button class="detail-back" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i></button>
                    <h3>Detalle del servicio</h3>
                </div>
                <div class="detail-body">
                    <div class="detail-type-badge">
                        <span class="type-badge ${a.resource_tipo}"><i data-lucide="${tipoIcon}" style="width:13px;height:13px;vertical-align:middle"></i> ${tipoLabels[a.resource_tipo] || a.resource_tipo}</span>
                    </div>
                    <h2 class="detail-title">${this.esc(a.resource_titulo || 'Servicio')}</h2>
                    ${a.image_data ? `<div style="margin:16px 0;cursor:zoom-in;border-radius:var(--radius-sm);overflow:hidden" onclick="App.openLightbox('${a.image_data}')">
                        <img src="${a.image_data}" alt="" style="width:100%;max-height:300px;object-fit:cover;display:block;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                        <div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:4px 0;background:var(--cream)"><i data-lucide="zoom-in" style="width:12px;height:12px;vertical-align:middle"></i> Toca para ver en grande</div>
                    </div>` : ''}
                    ${a.descripcion ? `<p class="detail-desc">${this.esc(a.descripcion)}</p>` : ''}
                    <div class="detail-info-grid">${infoItems}</div>
                    <div class="detail-owner" onclick="App.showUserProfile('${isProvider ? a.requester_id : a.provider_id}')" style="cursor:pointer">
                        <div class="detail-owner-avatar">${otherInitials.toUpperCase()}</div>
                        <div class="detail-owner-info">
                            <h4>${this.esc(otherName)}</h4>
                            <p>${isProvider ? 'Solicitante' : 'Publicador'} <i data-lucide="external-link" style="width:11px;height:11px;vertical-align:middle;margin-left:2px"></i></p>
                        </div>
                    </div>
                </div>
                <div class="detail-actions">
                    <button class="btn btn-primary btn-full btn-sm" onclick="App.closeDetail();App.openAgreementChat('${a.id}')"><i data-lucide="message-circle"></i> Abrir chat</button>
                </div>`;
            const overlay = document.getElementById('detail-overlay');
            overlay.innerHTML = html;
            overlay.style.display = 'block';
            lucide.createIcons({ nodes: [overlay] });
        } catch (e) {
            this.showToast('Error al cargar detalle', 'error');
        }
    },

    async openAgreementChat(id) {
        try {
            const a = await API.getAgreement(id);
            const isProvider = a.provider_id === API.user.id;
            const otherName = isProvider ? `${a.req_nombre} ${a.req_apellido}` : `${a.prov_nombre} ${a.prov_apellido}`;
            Chat.openChat(id, a.resource_titulo || 'Chat', `Con ${otherName}`, a);
            if (!this._skipHistory) history.pushState({ type: 'chat', tab: this.currentTab, id }, '');
        } catch (e) {
            this.showToast('Error al abrir chat', 'error');
        }
    },

    _RATING_DATA: {
        1: { emoji: '😢', label: 'No funcionó',        msg: 'Algo salió muy mal en este intercambio.',      commentLabel: '¿Qué salió mal? Cuéntanos qué pasó' },
        2: { emoji: '😕', label: 'No fue lo esperado', msg: 'El intercambio no cumplió las expectativas.',   commentLabel: '¿Qué no estuvo a la altura?' },
        3: { emoji: '🤝', label: 'Regular',             msg: 'Estuvo bien pero hay cosas por mejorar.',     commentLabel: '¿Qué crees que podría mejorar?' },
        4: { emoji: '😊', label: 'Buena experiencia',   msg: 'El intercambio fue positivo.',               commentLabel: '¿Qué fue lo que más te gustó?' },
        5: { emoji: '🌟', label: '¡Excelente!',         msg: 'Todo salió perfecto. ¡Gracias por compartir!', commentLabel: '¿Qué destacarías de esta persona y del intercambio?' },
    },
    _RATING_TAGS: {
        1: [
            { emoji: '🚫', label: 'No apareció' },
            { emoji: '😤', label: 'Mala actitud' },
            { emoji: '❌', label: 'No cumplió lo acordado' },
            { emoji: '📦', label: 'Producto en mal estado' },
            { emoji: '🤥', label: 'Descripción engañosa' },
        ],
        2: [
            { emoji: '📵', label: 'Mala comunicación' },
            { emoji: '⏰', label: 'Tardó demasiado' },
            { emoji: '🔄', label: 'Cambió condiciones' },
            { emoji: '📉', label: 'Calidad diferente a la descrita' },
            { emoji: '😕', label: 'Actitud difícil' },
        ],
        3: [
            { emoji: '⏱️', label: 'Puntualidad mejorable' },
            { emoji: '💬', label: 'Comunicación regular' },
            { emoji: '📝', label: 'Podría ser más claro' },
            { emoji: '🌿', label: 'Calidad aceptable' },
            { emoji: '🔧', label: 'Necesita mejorar detalles' },
        ],
        4: [
            { emoji: '✅', label: 'Cumplió lo prometido' },
            { emoji: '😊', label: 'Buen trato' },
            { emoji: '⚡', label: 'Respuesta rápida' },
            { emoji: '🌿', label: 'Buena calidad' },
            { emoji: '🤝', label: 'Flexible y abierto' },
        ],
        5: [
            { emoji: '⭐', label: 'Muy recomendado' },
            { emoji: '⚡', label: 'Súper puntual' },
            { emoji: '💎', label: 'Calidad excepcional' },
            { emoji: '💬', label: 'Comunicación excelente' },
            { emoji: '🌱', label: 'Volvería a intercambiar' },
        ],
    },
    _currentRating: 0,
    _selectedTags: [],

    showRating(agreementId) {
        this._currentRating = 0;
        const overlay = document.getElementById('detail-overlay');
        overlay.innerHTML = `
            <div class="detail-header">
                <button class="detail-back" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i></button>
                <h3>Calificar intercambio</h3>
            </div>
            <div class="detail-body">
                <p class="rating-prompt" id="rating-msg">Toca las estrellas para calificar</p>
                <div class="rating-stars-row" id="rating-stars-row">
                    ${[1,2,3,4,5].map(i => `
                        <button class="rating-star-btn" data-val="${i}" onclick="App._selectRating(${i})">
                            <i data-lucide="star"></i>
                        </button>`).join('')}
                </div>
                <div class="rating-emoji-big" id="rating-emoji-big"></div>
                <div id="rating-label-badge"></div>
                <div id="rating-tags-row" class="rating-tags-row"></div>
                <div id="rating-comment-block" style="display:none">
                    <hr class="rating-divider">
                    <p class="rating-question" id="rating-question"></p>
                    <textarea id="rating-comment" class="form-input" rows="3" placeholder="Tu reseña ayuda a la comunidad..." style="margin-top:4px"></textarea>
                </div>
            </div>
            <div class="detail-actions" id="rating-submit-row" style="display:none">
                <button class="btn btn-outline btn-full btn-sm" onclick="App.closeDetail()">Cancelar</button>
                <button class="btn btn-primary btn-full btn-sm" onclick="App._submitRating('${agreementId}')">
                    <i data-lucide="send"></i> Enviar calificación
                </button>
            </div>`;
        overlay.style.display = 'block';
        lucide.createIcons({ nodes: [overlay] });
    },

    _selectRating(val) {
        this._currentRating = val;
        this._selectedTags = [];
        const d = this._RATING_DATA[val];
        const tags = this._RATING_TAGS[val] || [];
        const tone = val <= 3 ? 'bad' : 'good';

        document.getElementById('rating-msg').textContent = d.msg;
        document.getElementById('rating-msg').className = `rating-prompt ${tone}`;
        document.getElementById('rating-emoji-big').textContent = d.emoji;
        document.getElementById('rating-label-badge').innerHTML =
            `<span class="rating-label-chip ${tone}">${d.label}</span>`;
        document.getElementById('rating-question').textContent = d.commentLabel;
        document.getElementById('rating-comment-block').style.display = 'block';
        document.getElementById('rating-submit-row').style.display = 'flex';

        // Render tag chips
        const tagsEl = document.getElementById('rating-tags-row');
        if (tagsEl) {
            tagsEl.innerHTML = tags.map((t, i) =>
                `<button type="button" class="rating-tag-chip ${tone}" data-idx="${i}" onclick="App._toggleTag(${i}, '${t.emoji} ${t.label.replace(/'/g, '\\\'')}')" >
                    ${t.emoji} ${t.label}
                </button>`
            ).join('');
        }

        document.querySelectorAll('.rating-star-btn').forEach((btn, i) => {
            btn.classList.toggle('active', i < val);
        });
    },

    _toggleTag(idx, label) {
        const btn = document.querySelector(`.rating-tag-chip[data-idx="${idx}"]`);
        if (!btn) return;
        const pos = this._selectedTags.indexOf(label);
        if (pos === -1) {
            this._selectedTags.push(label);
            btn.classList.add('selected');
        } else {
            this._selectedTags.splice(pos, 1);
            btn.classList.remove('selected');
        }
    },

    async _submitRating(agreementId) {
        const rating = this._currentRating;
        if (!rating) return;
        const written = document.getElementById('rating-comment')?.value?.trim() || '';
        const tagsPart = this._selectedTags.join(' · ');
        const comment = [tagsPart, written].filter(Boolean).join('\n') || '';
        try {
            await API.rateAgreement(agreementId, rating, comment);
            this.closeDetail();
            this._selectedTags = [];
            this.showToast('Calificación enviada ✓');
            this.loadAgreements();
            // Si el chat está abierto con este acuerdo, refrescar barra de estado
            if (typeof Chat !== 'undefined' && Chat.currentAgreementId === agreementId) {
                Chat.refreshStatusBar(agreementId);
            }
        } catch (e) { this.showToast(e.message, 'error'); }
    },

    async showUserProfile(userId) {
        const overlay = document.getElementById('detail-overlay');
        overlay.innerHTML = `<div class="detail-body" style="padding:32px 16px;text-align:center">
            <div class="skeleton-card skeleton" style="height:80px;border-radius:50%;width:80px;margin:0 auto 12px"></div>
            <div class="skeleton-card skeleton" style="height:20px;max-width:200px;margin:0 auto 8px"></div>
            <div class="skeleton-card skeleton" style="height:14px;max-width:140px;margin:0 auto"></div>
        </div>`;
        overlay.style.display = 'block';
        try {
            const u = await API.getUser(userId);
            const initials = (u.nombre[0] + u.apellido[0]).toUpperCase();
            const rep = (u.reputation_score || 5).toFixed(1);

            const resourcesHtml = (u.resources || []).length === 0
                ? `<p class="empty-mini">Sin publicaciones activas</p>`
                : (u.resources || []).map(r => `
                    <div class="market-item profile-resource-item" onclick="App.closeDetail();setTimeout(()=>App.showResourceDetail('${r.id}'),120)">
                        <div class="market-item-top">
                            <div class="market-item-icon resource-card-icon ${r.tipo}">
                                <i data-lucide="${this.ICONS[r.categoria] || 'package'}"></i>
                            </div>
                            <div class="market-item-info">
                                <h4>${this.esc(r.titulo)}</h4>
                                <span class="type-badge ${r.tipo}" style="font-size:0.65rem">${this.TYPE_LABELS[r.tipo]}</span>
                            </div>
                        </div>
                    </div>`).join('');

            const reviewsHtml = (u.reviews || []).length === 0
                ? `<p class="empty-mini">Sin reseñas aún</p>`
                : (u.reviews || []).map(r => {
                    const rInt = Math.min(5, Math.max(1, Math.round(r.rating)));
                    const d = this._RATING_DATA[rInt];
                    const parts = (r.comment || '').split('\n');
                    const tagsLine = parts[0] || '';
                    const writtenLine = parts.slice(1).join('\n').trim();
                    const tagsHtml = tagsLine
                        ? tagsLine.split(' · ').map(t => `<span class="review-tag-pill">${this.esc(t)}</span>`).join('')
                        : '';
                    return `<div class="review-card">
                        <div class="review-header">
                            <span class="review-emoji">${d.emoji}</span>
                            <div class="review-stars">${this._renderStarsHtml(r.rating)}</div>
                            <span class="review-author-name">${this.esc(r.reviewer_nombre)}</span>
                        </div>
                        ${tagsHtml ? `<div class="review-tags-row">${tagsHtml}</div>` : ''}
                        ${writtenLine ? `<p class="review-comment-text">${this.esc(writtenLine)}</p>` : ''}
                    </div>`;
                }).join('');

            overlay.innerHTML = `
                <div class="detail-header">
                    <button class="detail-back" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i></button>
                    <h3>Perfil de usuario</h3>
                </div>
                <div class="detail-body">
                    <div class="user-profile-hero">
                        <div class="user-profile-avatar">${initials}${u.verified ? '<span class="avatar-verified-tick" title="Cuenta verificada"><i data-lucide="badge-check"></i></span>' : ''}</div>
                        <div class="user-profile-info">
                            <h2 class="user-profile-name">${this.esc(u.nombre)} ${this.esc(u.apellido)}${u.verified ? ' <i data-lucide="badge-check" class="verified-inline" title="Cuenta verificada"></i>' : ''}</h2>
                            <p class="user-profile-tipo">${this.esc(u.tipo || '')}</p>
                            ${u.municipio ? `<p class="user-profile-loc"><i data-lucide="map-pin"></i> ${this.esc(u.municipio)}</p>` : ''}
                        </div>
                    </div>
                    <div class="user-reputation-block">
                        <div class="user-rep-score">${rep}</div>
                        <div>
                            <div class="user-rep-stars">${this._renderStarsHtml(u.reputation_score || 5)}</div>
                            <p class="user-rep-count">${u.total_ratings || 0} calificaciones</p>
                        </div>
                    </div>
                    ${u.bio ? `<p class="user-bio-text">"${this.esc(u.bio)}"</p>` : ''}

                    <div class="profile-section-label"><i data-lucide="package"></i> Publicaciones activas</div>
                    ${resourcesHtml}

                    <div class="profile-section-label" style="margin-top:20px"><i data-lucide="star"></i> Opiniones de la comunidad</div>
                    ${reviewsHtml}
                </div>`;
            lucide.createIcons({ nodes: [overlay] });
            if (!this._skipHistory) history.pushState({ type: 'userProfile', tab: this.currentTab, id: userId }, '');
        } catch (e) {
            this.showToast('Error al cargar perfil', 'error');
            this.closeDetail();
        }
    },

    _renderStarsHtml(score) {
        const val = Math.round(score || 5);
        return [1,2,3,4,5].map(i =>
            `<i data-lucide="star" class="rep-star ${i <= val ? 'filled' : ''}"></i>`
        ).join('');
    },

    // ===== PROFILE =====
    async loadProfile() {
        try {
            const profile = await API.getProfile();
            const u = profile;
            const initials = (u.nombre[0] + u.apellido[0]).toUpperCase();
            const avatarEl = document.getElementById('profile-avatar');
            avatarEl.textContent = initials;
            const oldAvatarTick = avatarEl.querySelector('.avatar-verified-tick');
            if (oldAvatarTick) oldAvatarTick.remove();
            if (u.verified) {
                avatarEl.insertAdjacentHTML('beforeend', '<span class="avatar-verified-tick" title="Cuenta verificada"><i data-lucide="badge-check"></i></span>');
            }
            document.getElementById('profile-name').textContent = `${u.nombre} ${u.apellido}`;
            document.getElementById('profile-role').textContent = u.tipo;
            document.getElementById('profile-location').innerHTML = `<i data-lucide="map-pin"></i> ${this.esc(u.municipio)}`;
            document.getElementById('profile-stat-intercambios').textContent = u.stats.total_agreements;
            document.getElementById('profile-stat-publicaciones').textContent = u.stats.total_resources;
            const ratingEl = document.getElementById('profile-stat-rating');
            if (ratingEl) ratingEl.textContent = (u.reputation_score || 5).toFixed(1);

            // Export acuerdos: gris si no hay acuerdos
            const exportBtn = document.getElementById('export-csv-btn');
            const exportSub = document.getElementById('export-csv-sub');
            if (exportBtn) {
                if ((u.stats.total_agreements || 0) === 0) {
                    exportBtn.classList.add('profile-menu-disabled');
                    if (exportSub) exportSub.innerHTML = 'Aún no tienes acuerdos para exportar <span class="pro-chip">Pro</span>';
                } else {
                    exportBtn.classList.remove('profile-menu-disabled');
                    if (exportSub) exportSub.innerHTML = 'Descarga tu historial en CSV <span class="pro-chip">Pro</span>';
                }
            }

            const nameEl = document.getElementById('profile-name');
            const oldTick = nameEl.querySelector('.verified-inline');
            if (oldTick) oldTick.remove();
            if (u.verified) {
                nameEl.insertAdjacentHTML('beforeend', ' <i data-lucide="badge-check" class="verified-inline" title="Cuenta verificada"></i>');
            }

            if (typeof Subscription !== 'undefined') {
                const sub = Subscription.state || await Subscription.refresh();
                const planTitle = document.getElementById('profile-plan-title');
                const planSub = document.getElementById('profile-plan-sub');
                if (sub && planTitle && planSub) {
                    const fmtFecha = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
                    if (sub.is_premium) {
                        const tier = sub.plan_tier === 'pro' ? 'Pro' : (sub.plan_tier === 'basic' ? 'Básico' : 'Pro');
                        planTitle.textContent = `Plan ${tier} activo`;
                        planSub.textContent = sub.subscription_end ? `Vence el ${fmtFecha(sub.subscription_end)}` : 'Renueva cuando quieras';
                    } else if (sub.status === 'trial' && sub.trial_days_left > 0) {
                        planTitle.textContent = `Prueba gratuita (${sub.trial_days_left} ${sub.trial_days_left === 1 ? 'día' : 'días'})`;
                        planSub.textContent = sub.trial_end ? `Vence el ${fmtFecha(sub.trial_end)} · Ver planes` : 'Ver planes y mejorar';
                    } else {
                        planTitle.textContent = 'Mejorar a Pro';
                        planSub.textContent = 'Publicaciones ilimitadas + matches';
                    }
                }

                // Stat + barra de suscripción
                const statEl = document.getElementById('profile-stat-suscripcion');
                const fillEl = document.getElementById('subscription-fill');
                const hintEl = document.getElementById('subscription-hint');
                if (sub && statEl && fillEl && hintEl) {
                    const fmtDays = (d) => {
                        if (d == null) return 'Sin sub';
                        if (d <= 0) return '<1 día';
                        if (d === 1) return '1 día';
                        return `${d} días`;
                    };
                    let daysLeft = 0, total = 0, label = 'Sin sub', hint = 'Sin suscripción activa';
                    if (sub.status === 'active') {
                        daysLeft = sub.subscription_days_left || 0;
                        total = 30;
                        label = fmtDays(daysLeft);
                        hint = daysLeft <= 0
                            ? 'Tu suscripción termina hoy'
                            : `Quedan ${label} de tu suscripción`;
                    } else if (sub.status === 'trial' && sub.trial_days_left > 0) {
                        daysLeft = sub.trial_days_left;
                        total = Math.max(daysLeft, sub.trial_days_granted || daysLeft);
                        label = fmtDays(daysLeft);
                        hint = `Quedan ${label} de tu prueba gratuita`;
                    } else if (sub.status === 'expired' || (sub.status === 'trial' && sub.trial_days_left === 0)) {
                        label = 'Sin sub';
                        hint = 'Se acabó tu suscripción';
                    } else {
                        label = 'Sin sub';
                        hint = 'No hay suscripción activa';
                    }
                    statEl.textContent = label;
                    const pct = total > 0 ? Math.max(2, Math.min(100, Math.round((daysLeft / total) * 100))) : 0;
                    fillEl.style.width = pct + '%';
                    hintEl.textContent = hint;
                }
            }

            lucide.createIcons({ nodes: [document.getElementById('panel-perfil')] });
        } catch (e) {
            console.error('Error loading profile:', e);
        }
    },

    // ===== SETTINGS PANELS =====
    openSettings(panel) {
        document.getElementById('settings-' + panel).style.display = 'block';
        if (panel === 'cuenta') this.loadAccountSettings();
        if (panel === 'stats') this.loadStats();
    },

    closeSettings(panel) {
        document.getElementById('settings-' + panel).style.display = 'none';
    },

    async loadAccountSettings() {
        const u = API.user;
        if (!u) return;
        document.getElementById('set-nombre').value = u.nombre;
        document.getElementById('set-apellido').value = u.apellido;
        document.getElementById('set-email').value = u.email;
        document.getElementById('set-tipo').value = u.tipo;
        document.getElementById('set-telefono').value = u.telefono || '';
        document.getElementById('set-bio').value = u.bio || '';
        // Pre-fill lat/lng for the location picker
        if (u.latitude) document.getElementById('set-lat').value = u.latitude;
        if (u.longitude) document.getElementById('set-lng').value = u.longitude;
        if (u.municipio) document.getElementById('set-addr').value = u.municipio;
        this.bindPasswordChecklist('set-pass-new', 'set-pw-checklist');
        this.bindPasswordConfirm('set-pass-new', 'set-pass-confirm', 'set-match-hint');
        // Init picker (may already exist if settings opened before)
        Geo.setupLocationPicker({
            containerId: 'loc-settings',
            latId: 'set-lat',
            lngId: 'set-lng',
            addrHiddenId: 'set-addr',
            placeholder: 'Buscar tu municipio o vereda...'
        });
    },

    async saveSettings() {
        const btn = document.getElementById('btn-save-settings');
        btn.classList.add('loading');
        try {
            const data = {
                nombre: document.getElementById('set-nombre').value.trim(),
                apellido: document.getElementById('set-apellido').value.trim(),
                municipio: document.getElementById('set-addr')?.value || '',
                tipo: document.getElementById('set-tipo').value,
                telefono: document.getElementById('set-telefono').value.trim(),
                bio: document.getElementById('set-bio').value.trim(),
                latitude: parseFloat(document.getElementById('set-lat')?.value) || null,
                longitude: parseFloat(document.getElementById('set-lng')?.value) || null,
            };
            if (data.telefono && !this.isValidPhoneCo(data.telefono)) {
                throw new Error('El teléfono debe tener 10 dígitos (ej: 3001234567)');
            }
            if (data.telefono) data.telefono = data.telefono.replace(/\D/g, '');
            await API.updateProfile(data);
            this.showToast('Perfil actualizado');
            this.closeSettings('cuenta');
            this.loadProfile();
            this.updateNavAvatar();
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
    },

    async loadStats() {
        try {
            const profile = await API.getProfile();
            const cards = [
                { icon: 'package', color: 'green', value: profile.stats.total_resources, label: 'Publicaciones' },
                { icon: 'circle-dot', color: 'blue', value: profile.stats.active_resources, label: 'Activas' },
                { icon: 'handshake', color: 'gold', value: profile.stats.total_agreements, label: 'Acuerdos' },
                { icon: 'trophy', color: 'gold', value: profile.stats.completed_agreements, label: 'Completados' },
                { icon: 'star', color: 'gold', value: (profile.reputation_score || 5).toFixed(1), suffix: ' / 5', label: 'Reputación' },
                { icon: 'users', color: 'blue', value: profile.total_ratings || 0, label: 'Calificaciones' },
            ];
            document.getElementById('stats-content').innerHTML = `
                <div class="stats-grid">
                    ${cards.map((s, i) => `
                        <div class="stat-card stat-card-${s.color}" style="animation-delay:${i * 60}ms">
                            <div class="stat-card-icon"><i data-lucide="${s.icon}"></i></div>
                            <div class="stat-card-value">${s.value}${s.suffix || ''}</div>
                            <div class="stat-card-label">${s.label}</div>
                            <div class="stat-card-deco"></div>
                        </div>
                    `).join('')}
                </div>`;
            lucide.createIcons({ nodes: [document.getElementById('stats-content')] });
        } catch (e) {
            document.getElementById('stats-content').innerHTML = '<p>Error al cargar estadísticas</p>';
        }
    },

    // ===== UTILS =====
    getGreeting() {
        const h = new Date().getHours();
        if (h < 12) return 'Buenos días';
        if (h < 18) return 'Buenas tardes';
        return 'Buenas noches';
    },

    formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr.replace(' ', 'T') + 'Z');
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        } catch { return dateStr; }
    },

    formatDateShort(dateStr) {
        if (!dateStr) return '';
        try {
            const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr.replace(' ', 'T') + 'Z');
            if (isNaN(d.getTime())) return '';
            const now = new Date();
            const diff = Math.floor((now - d) / 86400000);
            if (diff === 0) return 'hoy';
            if (diff === 1) return 'ayer';
            if (diff < 7) return `hace ${diff}d`;
            return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        } catch { return ''; }
    },

    showToast(msg, type = 'success') {
        const toast = document.getElementById('toast');
        const icon = type === 'error' ? 'alert-circle' : 'check-circle';
        toast.innerHTML = `<i data-lucide="${icon}"></i> ${this.esc(msg)}`;
        lucide.createIcons({ nodes: [toast] });
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    },

    esc(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    initPasswordEyes() {
        const inputs = document.querySelectorAll('input[type="password"]:not([data-eye-bound])');
        inputs.forEach(input => {
            input.setAttribute('data-eye-bound', '1');
            const wrap = document.createElement('div');
            wrap.className = 'pw-wrap';
            input.parentNode.insertBefore(wrap, input);
            wrap.appendChild(input);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pw-eye';
            btn.setAttribute('aria-label', 'Mostrar contraseña');
            btn.innerHTML = '<i data-lucide="eye"></i>';
            btn.onclick = () => {
                const showing = input.type === 'text';
                input.type = showing ? 'password' : 'text';
                btn.innerHTML = showing ? '<i data-lucide="eye"></i>' : '<i data-lucide="eye-off"></i>';
                btn.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
                if (window.lucide) lucide.createIcons({ nodes: [btn] });
            };
            wrap.appendChild(btn);
        });
        if (inputs.length && window.lucide) lucide.createIcons();
    },

    bindEvents() {
        this.initPasswordEyes();
        // Search debounce
        let searchTimeout;
        const searchInput = document.getElementById('market-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => this.loadMarket(), 300);
            });
        }

        // Chat send
        const chatInput = document.getElementById('chat-msg-input');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') Chat.sendMessage();
            });
        }

        // Enter submits login
        ['login-email', 'login-pass'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); App.doLogin(); }
            });
        });

        // Enter submits register (any input/select within the register screen)
        const regScreen = document.getElementById('screen-register');
        if (regScreen) {
            regScreen.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                const tag = (e.target.tagName || '').toLowerCase();
                if (tag === 'textarea') return;
                e.preventDefault();
                App.doRegister();
            });
        }

        // Enter submits forgot-password steps
        const forgotScreen = document.getElementById('screen-forgot');
        if (forgotScreen) {
            forgotScreen.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                const tag = (e.target.tagName || '').toLowerCase();
                if (tag === 'textarea') return;
                e.preventDefault();
                if (document.getElementById('forgot-step-1').style.display !== 'none') App.forgotStep1();
                else if (document.getElementById('forgot-step-2').style.display !== 'none') App.forgotStep2();
                else if (document.getElementById('forgot-step-3').style.display !== 'none') App.forgotStep3();
            });
        }
    },

    // Quick actions
    quickPublish(type) {
        this.switchTab('publicar');
        if (this.currentTab !== 'publicar') return; // bloqueado por paywall
        this.setPublishType(type);
    }
};

// Init on load
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
