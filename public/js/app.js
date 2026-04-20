const App = {
    currentTab: 'inicio',
    currentFilter: 'todos',
    currentCatFilter: '',
    currentMunFilter: '',
    currentSortFilter: 'recent',
    currentAgreementFilter: 'todos',
    currentPublishType: 'oferta',

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
        }
        this.bindEvents();
    },

    // ===== NAVIGATION =====
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    },

    showApp() {
        this.showScreen('screen-app');
        this.switchTab('inicio');
        Chat.startGlobalPolling();
        this.updateNavAvatar();
        this.refreshAgreementCounts();
    },

    switchTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById('panel-' + tab).classList.add('active');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
        if (tab === 'inicio') this.loadHome();
        if (tab === 'mercado') this.loadMarket();
        if (tab === 'publicar') this.initPublishForm();
        if (tab === 'intercambios') this.loadAgreements();
        if (tab === 'perfil') this.loadProfile();
    },

    updateNavAvatar() {
        const u = API.user;
        if (!u) return;
        const initials = (u.nombre[0] + u.apellido[0]).toUpperCase();
        document.getElementById('nav-avatar').textContent = initials;
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
                municipio: document.getElementById('reg-municipio').value,
                tipo: document.getElementById('reg-tipo').value,
                telefono: document.getElementById('reg-telefono').value.trim(),
                latitude: parseFloat(document.getElementById('reg-lat').value) || null,
                longitude: parseFloat(document.getElementById('reg-lng').value) || null,
            };
            if (!data.nombre || !data.apellido || !data.email || !data.password || !data.municipio || !data.tipo) {
                throw new Error('Completa todos los campos obligatorios');
            }
            await API.register(data);
            this.showToast('Cuenta creada exitosamente');
            this.showApp();
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
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
            this.showToast('Bienvenido de vuelta');
            this.showApp();
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
    },

    // ===== HOME =====
    async loadHome() {
        const u = API.user;
        if (!u) return;
        document.getElementById('home-greeting').textContent = this.getGreeting();
        document.getElementById('home-name').innerHTML = `${u.nombre} ${u.apellido}`;

        try {
            const [otherResources, myResources, profile] = await Promise.all([
                API.getResources({ exclude_user: u.id }),
                API.getResources({ owner: u.id }),
                API.getProfile()
            ]);

            this.renderResourceScroll('recent-resources', otherResources.slice(0, 8));
            this.renderMyResources('my-resources', myResources);
        } catch (e) {
            console.error('Error loading home:', e);
        }
    },

    renderMyResources(containerId, resources) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (resources.length === 0) {
            container.innerHTML = `<div class="empty-state" style="padding:24px">
                <i data-lucide="sprout"></i>
                <h3>Tu espacio está listo</h3>
                <p>Publica tu primer recurso y empieza a conectar con otros agricultores de la región</p>
                <button class="btn btn-secondary" onclick="App.switchTab('publicar')" style="margin-top:12px;padding:8px 18px;font-size:0.8rem">
                    <i data-lucide="plus"></i> Crear publicación
                </button>
            </div>`;
            lucide.createIcons({ nodes: [container] });
            return;
        }
        container.innerHTML = resources.map(r => {
            let statusChip = '';
            let itemClass = 'my-resource-item';
            if (r.agr_status === 'pending') {
                statusChip = `<span class="my-res-agr-badge pending"><i data-lucide="bell"></i> Solicitud de ${this.esc(r.agr_req_nombre)}</span>`;
                itemClass += ' has-request';
            } else if (r.agr_status === 'active') {
                statusChip = `<span class="my-res-agr-badge active"><i data-lucide="handshake"></i> En curso con ${this.esc(r.agr_req_nombre)}</span>`;
                itemClass += ' in-progress';
            } else if (r.status === 'active') {
                statusChip = `<span class="my-res-agr-badge open"><i data-lucide="circle-dot"></i> Disponible</span>`;
            }
            return `
            <div class="${itemClass}" onclick="${r.agr_id ? `App.openAgreementChat(${r.agr_id})` : `App.showResourceDetail(${r.id})`}">
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
            container.innerHTML = `<div class="empty-state">
                <i data-lucide="users"></i>
                <h3>La comunidad te espera</h3>
                <p>Cuando otros agricultores publiquen recursos, aparecerán aquí</p>
            </div>`;
            lucide.createIcons({ nodes: [container] });
            return;
        }
        container.innerHTML = resources.map(r => `
            <div class="resource-card" onclick="App.showResourceDetail(${r.id})">
                <div class="resource-card-header">
                    <div class="resource-card-icon ${r.tipo}">
                        <i data-lucide="${this.ICONS[r.categoria] || 'package'}"></i>
                    </div>
                    <span class="type-badge ${r.tipo}">${this.TYPE_LABELS[r.tipo]}</span>
                </div>
                <h4>${this.esc(r.titulo)}</h4>
                <p>${this.esc(r.descripcion)}</p>
                <div class="resource-card-meta">
                    <span><i data-lucide="user"></i> ${this.esc(r.user_nombre)}</span>
                    <span><i data-lucide="map-pin"></i> ${this.esc(r.municipio)}</span>
                </div>
            </div>
        `).join('');
        lucide.createIcons({ nodes: [container] });
    },

    // ===== MARKETPLACE =====
    async loadMarket() {
        const container = document.getElementById('market-list');
        container.innerHTML = '<div class="skeleton-card skeleton"></div><div class="skeleton-card skeleton"></div><div class="skeleton-card skeleton"></div>';
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
            container.innerHTML = resources.map(r => `
                <div class="market-item" onclick="App.showResourceDetail(${r.id})">
                    <div class="market-item-top">
                        <div class="market-item-icon resource-card-icon ${r.tipo}">
                            <i data-lucide="${this.ICONS[r.categoria] || 'package'}"></i>
                        </div>
                        <div class="market-item-info">
                            <h4>${this.esc(r.titulo)}</h4>
                            <p>${this.esc(r.descripcion)}</p>
                        </div>
                    </div>
                    <div class="market-item-footer">
                        <div class="market-item-meta">
                            <span><i data-lucide="user"></i> ${this.esc(r.user_nombre)} ${this.esc(r.user_apellido)}</span>
                            <span><i data-lucide="map-pin"></i> ${this.esc(r.municipio)}</span>
                        </div>
                        <span class="type-badge ${r.tipo}">${this.TYPE_LABELS[r.tipo]}</span>
                    </div>
                </div>
            `).join('');
            lucide.createIcons({ nodes: [container] });
        } catch (e) {
            container.innerHTML = '<div class="empty-state"><p>Error al cargar</p></div>';
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
            const cantidadStr = r.cantidad ? (r.unidad && r.unidad !== 'No aplica' ? `${r.cantidad} ${r.unidad}` : r.cantidad) : '';
            addInfo('hash', 'Cantidad', cantidadStr);
            addInfo('check-circle', 'Condición', r.condicion);
            addInfo('clock', 'Disponibilidad', r.disponibilidad);
            addInfo('banknote', 'Precio ref.', r.precio_referencia);
            addInfo('timer', 'Duración préstamo', r.duracion_prestamo);
            addInfo('shield', 'Garantía', r.garantia);
            addInfo('arrow-up-right', 'Ofrece', r.ofrece);
            addInfo('arrow-down-left', 'Recibe', r.recibe);
            addInfo('map-pin', 'Municipio', r.municipio);
            const locationBlock = (r.latitude != null && r.longitude != null)
                ? `<div class="detail-location-section">
                        <div class="detail-info-label" style="margin-bottom:8px"><i data-lucide="map"></i> Ubicación en el mapa</div>
                        ${Geo.buildMapBlock(r.latitude, r.longitude, { height: '200px' })}
                   </div>`
                : '';

            const html = `
                <div class="detail-header">
                    <button class="detail-back" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i></button>
                    <h3>Detalle</h3>
                </div>
                <div class="detail-body">
                    <div class="detail-type-badge"><span class="type-badge ${r.tipo}">${this.TYPE_LABELS[r.tipo]}</span></div>
                    <h2 class="detail-title">${this.esc(r.titulo)}</h2>
                    ${r.image_data ? `<div style="margin-bottom:16px;cursor:zoom-in;border-radius:var(--radius-sm);overflow:hidden" onclick="App.openLightbox('${r.image_data}')">
                        <img src="${r.image_data}" alt="" style="width:100%;max-height:280px;object-fit:cover;display:block;transition:transform 0.2s" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                        <div style="text-align:center;font-size:0.72rem;color:var(--text-muted);padding:4px 0;background:var(--cream)"><i data-lucide="zoom-in" style="width:12px;height:12px;vertical-align:middle"></i> Toca para ver en grande</div>
                    </div>` : ''}
                    <p class="detail-desc">${this.esc(r.descripcion)}</p>
                    <div class="detail-info-grid">${infoItems}</div>
                    ${locationBlock}
                    <div class="detail-owner">
                        <div class="detail-owner-avatar">${initials}</div>
                        <div class="detail-owner-info">
                            <h4>${this.esc(r.user_nombre)} ${this.esc(r.user_apellido)}</h4>
                            <p>${this.esc(r.user_tipo || '')} · ${this.esc(r.user_municipio)}</p>
                        </div>
                        <div class="detail-owner-rating"><i data-lucide="star"></i> ${(r.user_reputation || 5).toFixed(1)}</div>
                    </div>
                </div>
                <div class="detail-actions">
                    ${isOwner
                        ? `<button class="btn btn-outline btn-full btn-sm" onclick="App.toggleResource(${r.id}, '${r.status}')"><i data-lucide="${r.status === 'active' ? 'eye-off' : 'eye'}"></i> ${r.status === 'active' ? 'Desactivar' : 'Activar'}</button>
                           <button class="btn btn-danger btn-full btn-sm" onclick="App.deleteResource(${r.id})"><i data-lucide="trash-2"></i> Eliminar</button>`
                        : `<button class="btn btn-outline btn-full btn-sm" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i> Volver</button>
                           ${this.getActionButton(r)}`
                    }
                </div>`;
            const overlay = document.getElementById('detail-overlay');
            overlay.innerHTML = html;
            overlay.style.display = 'block';
            lucide.createIcons({ nodes: [overlay] });
        } catch (e) {
            this.showToast('Error al cargar detalle', 'error');
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
        return `<button class="btn btn-primary btn-full" onclick="App.requestService(${r.id}, '${r.tipo}')"><i data-lucide="${a.icon}"></i> ${a.label}</button>`;
    },

    closeDetail() {
        document.getElementById('detail-overlay').style.display = 'none';
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
                        <span class="form-hint">Describe brevemente lo que ofreces</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Incluye detalles: estado, condiciones, horarios disponibles..."></textarea>
                        <span class="form-hint">Entre más detallada, más confianza genera en la comunidad</span>
                    </div>
                </div>
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="box"></i> Detalles del recurso</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Cantidad</label>
                            <input type="text" id="pub-cantidad" class="form-input" placeholder="Ej: 50">
                            <span class="form-hint">Cuánto ofreces</span>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Unidad</label>
                            <input type="text" id="pub-unidad" class="form-input" placeholder="Ej: kg, unidades">
                            <span class="form-hint">Medida o unidad</span>
                        </div>
                    </div>
                    ${this.unidadToggleBlock()}
                    <div class="form-group">
                        <label class="form-label">Condición</label>
                        <select id="pub-condicion" class="form-select">${this.conditionOptions('oferta')}</select>
                        <span class="form-hint">Estado actual del recurso</span>
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
                            <input type="text" id="pub-precio" class="form-input" placeholder="Ej: $50.000/día, Negociable">
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
                        <span class="form-hint">Describe brevemente lo que necesitas</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción detallada *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Especifica: cantidad necesaria, calidad esperada, para qué lo necesitas..."></textarea>
                        <span class="form-hint">Detalla las especificaciones para que te ofrezcan exactamente lo que buscas</span>
                    </div>
                </div>
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="target"></i> Especificaciones</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Cantidad requerida</label>
                            <input type="text" id="pub-cantidad" class="form-input" placeholder="Ej: 100">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Unidad</label>
                            <input type="text" id="pub-unidad" class="form-input" placeholder="Ej: kg, bultos">
                        </div>
                    </div>
                    ${this.unidadToggleBlock()}
                    <div class="form-group">
                        <label class="form-label">Disponibilidad / Urgencia</label>
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
                        <span class="form-hint">Nombre de la herramienta o equipo</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Marca, modelo, capacidad, accesorios incluidos..."></textarea>
                        <span class="form-hint">Detalla las características y lo que incluye el préstamo</span>
                    </div>
                </div>
                <div class="publish-form-section">
                    <div class="publish-form-section-title"><i data-lucide="clock"></i> Condiciones del préstamo</div>
                    <div class="form-group">
                        <label class="form-label">Condición del equipo</label>
                        <select id="pub-condicion" class="form-select">${this.conditionOptions('prestamo')}</select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Duración máxima del préstamo</label>
                        <input type="text" id="pub-duracion" class="form-input" placeholder="Ej: Máximo 3 días, 1 semana">
                        <span class="form-hint">¿Por cuánto tiempo puedes prestarlo?</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Garantía o condiciones de devolución</label>
                        <textarea id="pub-garantia" class="form-input" rows="2" placeholder="Ej: Se devuelve limpio y funcional, cualquier daño se repara"></textarea>
                        <span class="form-hint">¿Qué esperas al recibirlo de vuelta?</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Disponibilidad</label>
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
                            <input type="text" id="pub-precio" class="form-input" placeholder="Ej: $30.000/día">
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
                        <span class="form-hint">Resume qué das y qué recibes</span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Descripción *</label>
                        <textarea id="pub-desc" class="form-input" placeholder="Describe detalladamente lo que ofreces y lo que buscas a cambio"></textarea>
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
                        <label class="form-label">Condición de lo que ofreces</label>
                        <select id="pub-condicion" class="form-select">${this.conditionOptions('trueque')}</select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">¿Qué deseas recibir? *</label>
                        <input type="text" id="pub-recibe" class="form-input" placeholder="Ej: Semillas de hortalizas o abono orgánico">
                        <span class="form-hint">Describe lo que te gustaría recibir a cambio</span>
                    </div>
                    <div class="form-group">
                        <div class="toggle-label" style="margin-bottom:8px">¿Qué tipo de intercambio buscas?</div>
                        <div class="segmented-control" id="trueque-tipo">
                            <button type="button" class="seg-opt active" data-val="Bien o producto">Bien o producto</button>
                            <button type="button" class="seg-opt" data-val="Servicio">Servicio</button>
                            <button type="button" class="seg-opt" data-val="Monetario">Monetario</button>
                        </div>
                        <span class="form-hint">¿Recibirías un objeto, un servicio o dinero a cambio?</span>
                    </div>
                    <input type="hidden" id="pub-modalidad" value="Bien o producto">
                </div>`
        };
        const formContainer = document.getElementById('publish-form-fields');
        formContainer.innerHTML = (sections[tipo] || sections.oferta) + `
            <div class="publish-form-section">
                <div class="publish-form-section-title"><i data-lucide="camera"></i> Imagen</div>
                <div class="form-group">
                    <div class="image-upload-area" id="pub-image-area" onclick="document.getElementById('pub-image-input').click()">
                        <i data-lucide="image-plus"></i>
                        <p>Toca para agregar una foto</p>
                        <span class="form-hint">Opcional. Ayuda a que otros vean el recurso (máx 500KB)</span>
                    </div>
                    <input type="file" id="pub-image-input" accept="image/*" style="display:none" onchange="App.previewPublishImage(event)">
                    <input type="hidden" id="pub-image-data">
                </div>
            </div>
            <div class="publish-form-section">
                <div class="publish-form-section-title"><i data-lucide="map-pin"></i> Ubicación</div>
                <div class="form-group">
                    <label class="form-label">Municipio *</label>
                    <select id="pub-municipio" class="form-select">
                        <option value="">Seleccionar municipio...</option>
                        <option>Duitama</option><option>Sogamoso</option>
                    </select>
                    <span class="form-hint">¿Dónde está disponible el recurso?</span>
                </div>
                <input type="hidden" id="pub-lat"><input type="hidden" id="pub-lng">
                <button type="button" id="geo-pub" class="geo-btn"><i data-lucide="crosshair"></i> Detectar mi ubicación</button>
                <span id="geo-pub-status" class="form-hint" style="display:block;margin-top:6px"></span>
                <div id="geo-pub-map" class="geo-map-preview"></div>
            </div>
            <button class="btn btn-primary btn-full" onclick="App.doPublish()" id="btn-publish">
                <i data-lucide="send"></i> Publicar en la comunidad
            </button>`;
        lucide.createIcons({ nodes: [formContainer] });
        this.initCharCounters();
        this.bindExchangeOptions();
        Geo.setupGeoButton('geo-pub', 'pub-lat', 'pub-lng', 'geo-pub-status');
        if (API.user) {
            const munSelect = document.getElementById('pub-municipio');
            if (munSelect) munSelect.value = API.user.municipio || '';
        }
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

    conditionOptions(tipo) {
        const common = [
            'Nuevo', 'Sellado / Empacado', 'Seminuevo',
            'Excelente', 'Buen estado', 'Usado', 'Regular',
            'Requiere mantenimiento'
        ];
        const produce = [
            'Recién cosechado', 'Fresco', 'Orgánico certificado',
            'Convencional', 'Procesado', 'Deshidratado'
        ];
        const prestamo = [
            'Nuevo', 'Excelente', 'Buen estado', 'Funcional',
            'Seminuevo', 'Requiere mantenimiento menor'
        ];
        let list;
        if (tipo === 'prestamo') list = prestamo;
        else list = [...common, ...produce];
        return '<option value="">Seleccionar...</option>' +
               list.map(c => `<option>${c}</option>`).join('');
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
                    if (modalidad) {
                        // For solicitud, modalidad reflects payment type (default Monetario)
                        if (tipo === 'solicitud') modalidad.value = 'Monetario';
                        else modalidad.value = 'Con precio';
                    }
                }
            });
        }
        // Unit "no aplica" toggle
        const unidadNa = document.getElementById('toggle-unidad-na');
        if (unidadNa) {
            unidadNa.addEventListener('change', () => {
                const unidad = document.getElementById('pub-unidad');
                if (!unidad) return;
                if (unidadNa.checked) {
                    unidad.dataset.prev = unidad.value;
                    unidad.value = 'No aplica';
                    unidad.disabled = true;
                    unidad.classList.add('input-disabled');
                } else {
                    unidad.value = unidad.dataset.prev || '';
                    unidad.disabled = false;
                    unidad.classList.remove('input-disabled');
                }
            });
        }
        // Segmented control for trueque tipo
        document.querySelectorAll('#trueque-tipo .seg-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#trueque-tipo .seg-opt').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const modalidad = document.getElementById('pub-modalidad');
                if (modalidad) modalidad.value = btn.dataset.val;
            });
        });
        // Segmented control for solicitud payment type (monetario / bien / servicio)
        const pagoHints = {
            'Monetario': 'Monto aproximado que estás dispuesto a pagar',
            'Bien o producto': 'Describe el bien o producto que ofreces a cambio',
            'Servicio': 'Describe el servicio que ofreces a cambio',
        };
        const pagoPlaceholders = {
            'Monetario': 'Ej: Hasta $200.000',
            'Bien o producto': 'Ej: 2 bultos de papa criolla',
            'Servicio': 'Ej: 1 jornada de arada',
        };
        document.querySelectorAll('#solicitud-pago-tipo .seg-opt').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#solicitud-pago-tipo .seg-opt').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const modalidad = document.getElementById('pub-modalidad');
                if (modalidad) modalidad.value = btn.dataset.val;
                const precioInp = document.getElementById('pub-precio');
                const hint = document.getElementById('pub-precio-hint');
                if (precioInp) precioInp.placeholder = pagoPlaceholders[btn.dataset.val] || '';
                if (hint) hint.textContent = pagoHints[btn.dataset.val] || '';
            });
        });
    },

    previewPublishImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 500000) {
            this.showToast('Imagen muy grande (máx 500KB)', 'error');
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

    async doPublish() {
        const btn = document.getElementById('btn-publish');
        btn.classList.add('loading');
        try {
            const tipo = this.currentPublishType;
            const unidadNa = document.getElementById('toggle-unidad-na')?.checked;
            const data = {
                tipo,
                titulo: document.getElementById('pub-titulo')?.value?.trim() || '',
                descripcion: document.getElementById('pub-desc')?.value?.trim() || '',
                categoria: document.getElementById('pub-cat')?.value || '',
                municipio: document.getElementById('pub-municipio')?.value || '',
                cantidad: document.getElementById('pub-cantidad')?.value?.trim() || '',
                unidad: unidadNa ? 'No aplica' : (document.getElementById('pub-unidad')?.value?.trim() || ''),
                condicion: document.getElementById('pub-condicion')?.value || '',
                disponibilidad: document.getElementById('pub-disponibilidad')?.value || '',
                precio_referencia: document.getElementById('pub-precio')?.value?.trim() || '',
                duracion_prestamo: document.getElementById('pub-duracion')?.value?.trim() || '',
                garantia: document.getElementById('pub-garantia')?.value?.trim() || '',
                ofrece: document.getElementById('pub-ofrece')?.value?.trim() || '',
                recibe: document.getElementById('pub-recibe')?.value?.trim() || '',
                image_data: document.getElementById('pub-image-data')?.value || '',
                latitude: parseFloat(document.getElementById('pub-lat')?.value) || null,
                longitude: parseFloat(document.getElementById('pub-lng')?.value) || null,
            };
            const modalidadEl = document.getElementById('pub-modalidad');
            if (modalidadEl) data.modalidad = modalidadEl.value;
            if (!data.titulo || !data.descripcion || !data.categoria || !data.municipio) {
                throw new Error('Completa los campos obligatorios (*)');
            }
            await API.createResource(data);
            this.showToast('Publicación creada exitosamente');
            this.switchTab('mercado');
        } catch (e) {
            this.showToast(e.message, 'error');
        } finally {
            btn.classList.remove('loading');
        }
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
            container.innerHTML = filtered.map(a => this.renderAgreementCard(a)).join('');
            lucide.createIcons({ nodes: [container] });
        } catch (e) {
            console.error('Error loading agreements:', e);
            container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>Error al cargar servicios</p></div>';
        }
    },

    updateAgreementTabs(all) {
        const counts = { pending: 0, active: 0, completed: 0, cancelled: 0 };
        all.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });
        document.querySelectorAll('.status-tab .count').forEach(el => {
            const status = el.parentElement.dataset.status;
            if (status === 'todos') el.textContent = all.length;
            else el.textContent = counts[status] || 0;
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
        const statusLabels = { pending: 'Pendiente', active: 'En curso', completed: 'Completado', rejected: 'Rechazado', cancelled: 'Cancelado' };
        const catIcon = this.ICONS[a.resource_cat] || 'package';
        const roleText = isProvider
            ? `<strong>${this.esc(otherName)}</strong> te solicitó`
            : `Solicitaste a <strong>${this.esc(otherName)}</strong>`;

        // Bottom action buttons
        let btns = '';
        const chatLabel = a.unread_count > 0 ? `Chat (${a.unread_count})` : 'Chat';
        if (a.status === 'completed') {
            const rated = isProvider ? a.rating_provider : a.rating_requester;
            btns = rated
                ? `<span class="agr-btn-done"><i data-lucide="star"></i> Calificado ${rated}/5</span>`
                : `<button class="btn btn-earth btn-xs" onclick="event.stopPropagation();App.showRating(${a.id})"><i data-lucide="star"></i> Calificar</button>`;
        } else if (a.status === 'cancelled' || a.status === 'rejected') {
            btns = `<button class="btn btn-outline btn-xs" onclick="event.stopPropagation();App.openAgreementChat(${a.id})"><i data-lucide="message-circle"></i> Ver chat</button>`;
        } else {
            btns = `<button class="btn btn-outline btn-xs" onclick="event.stopPropagation();App.openAgreementChat(${a.id})"><i data-lucide="message-circle"></i> ${chatLabel}</button>`;
            if (isProvider && a.status === 'pending') {
                btns += `<button class="btn btn-success btn-xs" onclick="event.stopPropagation();App.updateAgreement(${a.id},'active')"><i data-lucide="check"></i> Aceptar</button>
                         <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();App.updateAgreement(${a.id},'rejected')"><i data-lucide="x"></i></button>`;
            } else if (isProvider && a.status === 'active') {
                btns += `<button class="btn btn-success btn-xs" onclick="event.stopPropagation();App.markComplete(${a.id})"><i data-lucide="check-circle"></i> Completar</button>`;
            } else if (!isProvider && a.status === 'pending') {
                btns += `<span class="agreement-waiting"><i data-lucide="clock"></i> Esperando</span>`;
            }
        }

        return `
            <div class="agreement-card ${a.status}" onclick="App.showAgreementDetail(${a.id})">
                <div class="agr-card-top">
                    <div class="agr-card-cat-icon"><i data-lucide="${catIcon}"></i></div>
                    <div class="agr-card-info">
                        <h4>${this.esc(a.resource_titulo || 'Servicio')}</h4>
                        <span class="agr-card-sub">${roleText}</span>
                    </div>
                    <div class="agreement-badges">
                        ${a.resource_tipo ? `<span class="tipo-badge ${a.resource_tipo}">${this.TYPE_LABELS[a.resource_tipo] || a.resource_tipo}</span>` : ''}
                        ${a.resource_cat ? `<span class="agr-cat-badge">${this.esc(a.resource_cat)}</span>` : ''}
                        <span class="status-badge ${a.status}">${statusLabels[a.status] || a.status}</span>
                    </div>
                </div>
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
            await API.updateAgreement(id, { status });
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
            addInfo('calendar', 'Fecha', this.formatDate(a.created_at));

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
                    <div class="detail-owner">
                        <div class="detail-owner-avatar">${otherInitials.toUpperCase()}</div>
                        <div class="detail-owner-info">
                            <h4>${this.esc(otherName)}</h4>
                            <p>${isProvider ? 'Solicitante' : 'Publicador'}</p>
                        </div>
                    </div>
                </div>
                <div class="detail-actions">
                    <button class="btn btn-outline btn-full btn-sm" onclick="App.closeDetail()"><i data-lucide="arrow-left"></i> Volver</button>
                    <button class="btn btn-primary btn-full btn-sm" onclick="App.closeDetail();App.openAgreementChat(${a.id})"><i data-lucide="message-circle"></i> Abrir chat</button>
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
        } catch (e) {
            this.showToast('Error al abrir chat', 'error');
        }
    },

    showRating(agreementId) {
        let selected = 0;
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog">
                <h3>Califica el intercambio</h3>
                <p>¿Cómo fue tu experiencia?</p>
                <div class="rating-stars" style="justify-content:center;margin-bottom:20px">
                    ${[1,2,3,4,5].map(i => `<button class="rating-star" data-val="${i}"><i data-lucide="star"></i></button>`).join('')}
                </div>
                <div class="confirm-actions">
                    <button class="btn btn-outline btn-sm" onclick="this.closest('.confirm-overlay').remove()">Cancelar</button>
                    <button class="btn btn-primary btn-sm" id="btn-rate">Enviar</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        lucide.createIcons({ nodes: [overlay] });
        overlay.querySelectorAll('.rating-star').forEach(star => {
            star.addEventListener('click', () => {
                selected = parseInt(star.dataset.val);
                overlay.querySelectorAll('.rating-star').forEach((s, i) => {
                    s.classList.toggle('active', i < selected);
                });
            });
        });
        overlay.querySelector('#btn-rate').addEventListener('click', async () => {
            if (selected === 0) return;
            try {
                await API.rateAgreement(agreementId, selected);
                overlay.remove();
                this.showToast('Calificación enviada');
                this.loadAgreements();
            } catch (e) {
                this.showToast(e.message, 'error');
            }
        });
    },

    // ===== PROFILE =====
    async loadProfile() {
        try {
            const profile = await API.getProfile();
            const u = profile;
            const initials = (u.nombre[0] + u.apellido[0]).toUpperCase();
            document.getElementById('profile-avatar').textContent = initials;
            document.getElementById('profile-name').textContent = `${u.nombre} ${u.apellido}`;
            document.getElementById('profile-role').textContent = u.tipo;
            document.getElementById('profile-location').innerHTML = `<i data-lucide="map-pin"></i> ${this.esc(u.municipio)}`;
            document.getElementById('profile-stat-intercambios').textContent = u.stats.total_agreements;
            document.getElementById('profile-stat-reputacion').textContent = (u.reputation_score || 5).toFixed(1);
            document.getElementById('profile-stat-publicaciones').textContent = u.stats.total_resources;
            const repPercent = ((u.reputation_score || 5) / 5) * 100;
            document.getElementById('reputation-fill').style.width = repPercent + '%';
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
        document.getElementById('set-municipio').value = u.municipio;
        document.getElementById('set-tipo').value = u.tipo;
        document.getElementById('set-telefono').value = u.telefono || '';
        document.getElementById('set-bio').value = u.bio || '';
    },

    async saveSettings() {
        const btn = document.getElementById('btn-save-settings');
        btn.classList.add('loading');
        try {
            const data = {
                nombre: document.getElementById('set-nombre').value.trim(),
                apellido: document.getElementById('set-apellido').value.trim(),
                municipio: document.getElementById('set-municipio').value,
                tipo: document.getElementById('set-tipo').value,
                telefono: document.getElementById('set-telefono').value.trim(),
                bio: document.getElementById('set-bio').value.trim(),
            };
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
            document.getElementById('stats-content').innerHTML = `
                <div class="detail-info-grid">
                    <div class="detail-info-item"><div class="detail-info-label"><i data-lucide="package"></i> Publicaciones</div><div class="detail-info-value">${profile.stats.total_resources}</div></div>
                    <div class="detail-info-item"><div class="detail-info-label"><i data-lucide="check-circle"></i> Activas</div><div class="detail-info-value">${profile.stats.active_resources}</div></div>
                    <div class="detail-info-item"><div class="detail-info-label"><i data-lucide="handshake"></i> Total acuerdos</div><div class="detail-info-value">${profile.stats.total_agreements}</div></div>
                    <div class="detail-info-item"><div class="detail-info-label"><i data-lucide="trophy"></i> Completados</div><div class="detail-info-value">${profile.stats.completed_agreements}</div></div>
                    <div class="detail-info-item"><div class="detail-info-label"><i data-lucide="star"></i> Reputación</div><div class="detail-info-value">${(profile.reputation_score || 5).toFixed(1)} / 5.0</div></div>
                    <div class="detail-info-item"><div class="detail-info-label"><i data-lucide="users"></i> Calificaciones</div><div class="detail-info-value">${profile.total_ratings}</div></div>
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
            let d;
            if (dateStr.includes('T')) {
                d = new Date(dateStr);
            } else {
                d = new Date(dateStr.replace(' ', 'T') + 'Z');
            }
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        } catch { return dateStr; }
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

    bindEvents() {
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
    },

    // Quick actions
    quickPublish(type) {
        this.switchTab('publicar');
        this.setPublishType(type);
    }
};

// Init on load
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
