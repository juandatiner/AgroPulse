const Chat = {
    currentAgreementId: null,
    currentAgreement: null,
    pollInterval: null,
    lastTimestamp: null,
    globalPollInterval: null,
    lastGlobalPoll: null,
    pendingImage: null,

    openChat(agreementId, title, subtitle, agreement) {
        this.currentAgreementId = agreementId;
        this.currentAgreement = agreement || null;
        this.lastTimestamp = null;
        this.clearImage();
        const overlay = document.getElementById('chat-overlay');
        overlay.style.display = 'flex';
        document.getElementById('chat-title').textContent = title || 'Chat';
        document.getElementById('chat-subtitle').textContent = subtitle || '';
        document.getElementById('chat-messages').innerHTML = '<div class="empty-state"><i data-lucide="message-circle"></i><p>Cargando mensajes...</p></div>';
        this.renderStatusBar(agreement);
        lucide.createIcons({ nodes: [overlay] });
        this.loadMessages();
        this.startPolling();
    },

    renderStatusBar(a) {
        const bar = document.getElementById('chat-status-bar');
        if (!bar || !a) { if (bar) bar.style.display = 'none'; return; }
        const isProvider = a.provider_id === API.user.id;
        const otherFirst = isProvider ? a.req_nombre : a.prov_nombre;
        let html = '';
        if (a.status === 'pending' && isProvider) {
            html = `<div class="csb-info"><i data-lucide="bell"></i> <span>${otherFirst} quiere conectar contigo</span></div>
                    <div class="csb-actions">
                        <button class="btn btn-success btn-xs" onclick="App.updateAgreement('${a.id}','active')"><i data-lucide="check"></i> Aceptar e iniciar</button>
                        <button class="btn btn-danger btn-xs" onclick="App.updateAgreement('${a.id}','rejected')"><i data-lucide="x"></i> Rechazar</button>
                    </div>`;
        } else if (a.status === 'pending' && !isProvider) {
            html = `<div class="csb-info"><i data-lucide="clock"></i> <span>Esperando que ${otherFirst} acepte tu solicitud</span></div>`;
        } else if (a.status === 'active') {
            if (isProvider) {
                html = `<div class="csb-info"><i data-lucide="handshake"></i> <span>Servicio en curso</span></div>
                        <div class="csb-actions">
                            <button class="btn btn-success btn-xs" onclick="App.markComplete('${a.id}')"><i data-lucide="check-circle"></i> Completar</button>
                            <button class="btn btn-cancel btn-xs" onclick="App.updateAgreement('${a.id}','cancelled')"><i data-lucide="x"></i> Cancelar</button>
                        </div>`;
            } else {
                html = `<div class="csb-info"><i data-lucide="handshake"></i> <span>Servicio en curso — el dueño confirmará al terminar</span></div>`;
            }
        } else if (a.status === 'completed') {
            const rated = isProvider ? a.rating_provider : a.rating_requester;
            const rateBtn = rated
                ? `<span style="font-size:0.78rem;color:var(--text-muted)"><i data-lucide="star"></i> Calificado ${rated}/5</span>`
                : `<button class="btn btn-earth btn-xs" onclick="Chat.closeChat();App.showRating('${a.id}')"><i data-lucide="star"></i> Calificar</button>`;
            html = `<div class="csb-info csb-done"><i data-lucide="check-circle"></i> <span>¡Servicio completado!</span></div>
                    <div class="csb-actions">${rateBtn}</div>`;
        } else if (a.status === 'cancelled' || a.status === 'rejected') {
            const label = a.status === 'cancelled' ? 'Servicio cancelado' : 'Solicitud rechazada';
            const reasonBlock = a.cancel_reason
                ? `<div class="csb-reason" style="display:block;font-size:0.8rem;margin-top:4px;opacity:0.9">
                       <strong>Motivo${a.cancelled_by_nombre ? ' (' + this._esc(a.cancelled_by_nombre) + ')' : ''}:</strong>
                       ${this._esc(a.cancel_reason)}
                   </div>` : '';
            html = `<div class="csb-info csb-cancelled" style="flex-direction:column;align-items:flex-start">
                      <div><i data-lucide="circle-slash-2"></i> <span>${label}</span></div>
                      ${reasonBlock}
                    </div>`;
        }
        if (html) {
            bar.innerHTML = html;
            bar.style.display = 'flex';
            lucide.createIcons({ nodes: [bar] });
        } else {
            bar.style.display = 'none';
        }
        // Block/unblock chat input based on status
        this.setChatInputLocked(['completed','cancelled','rejected'].includes(a.status));
    },

    setChatInputLocked(locked) {
        const inputBar = document.getElementById('chat-input-bar');
        if (!inputBar) return;
        const input = document.getElementById('chat-msg-input');
        const sendBtn = inputBar.querySelector('.chat-send-btn');
        const actionBtns = inputBar.querySelectorAll('.chat-action-btn');
        if (locked) {
            inputBar.classList.add('chat-input-locked');
            if (input) { input.disabled = true; input.placeholder = 'Esta conversación está cerrada'; }
            if (sendBtn) sendBtn.disabled = true;
            actionBtns.forEach(b => b.disabled = true);
        } else {
            inputBar.classList.remove('chat-input-locked');
            if (input) { input.disabled = false; input.placeholder = 'Escribe un mensaje...'; }
            if (sendBtn) sendBtn.disabled = false;
            actionBtns.forEach(b => b.disabled = false);
        }
    },

    async refreshStatusBar(agreementId) {
        if (!this.currentAgreementId || this.currentAgreementId !== agreementId) return;
        try {
            const a = await API.getAgreement(agreementId);
            this.currentAgreement = a;
            this.renderStatusBar(a);
        } catch (e) { /* ignore */ }
    },

    closeChat() {
        this.currentAgreementId = null;
        this.currentAgreement = null;
        this.setChatInputLocked(false);
        this.clearImage();
        this.stopPolling();
        document.getElementById('chat-overlay').style.display = 'none';
    },

    async loadMessages() {
        if (!this.currentAgreementId) return;
        try {
            const msgs = await API.getMessages(this.currentAgreementId);
            const container = document.getElementById('chat-messages');
            if (msgs.length === 0) {
                container.innerHTML = '<div class="empty-state"><i data-lucide="message-circle"></i><h3>Sin mensajes</h3><p>Inicia la conversacion escribiendo un mensaje</p></div>';
                lucide.createIcons({ nodes: [container] });
                return;
            }
            container.innerHTML = '';
            msgs.forEach(m => this.appendMessage(m));
            if (msgs.length > 0) this.lastTimestamp = msgs[msgs.length - 1].created_at;
            container.scrollTop = container.scrollHeight;
        } catch (e) {
            console.error('Error loading messages:', e);
        }
    },

    appendMessage(msg) {
        const container = document.getElementById('chat-messages');
        const empty = container.querySelector('.empty-state');
        if (empty) empty.remove();
        const isOut = msg.sender_id === API.user.id;
        const div = document.createElement('div');
        div.className = 'chat-msg ' + (isOut ? 'out' : 'in');
        const time = new Date(msg.created_at + 'Z').toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        let content = this.renderMessageContent(msg.content);
        div.innerHTML = `<div>${content}</div><div class="chat-msg-time">${isOut ? '' : msg.sender_nombre + ' · '}${time}</div>`;
        container.appendChild(div);
        lucide.createIcons({ nodes: [div] });
        container.scrollTop = container.scrollHeight;
    },

    renderMessageContent(content) {
        // Check for image
        if (content.startsWith('[img]') && content.endsWith('[/img]')) {
            const src = content.slice(5, -6);
            return `<img src="${src}" alt="Imagen" onclick="window.open(this.src)">`;
        }
        // Check for location
        if (content.startsWith('[ubicacion]') && content.endsWith('[/ubicacion]')) {
            const coords = content.slice(11, -12);
            const [lat, lng] = coords.split(',');
            const addrId = 'chat-addr-' + Math.random().toString(36).slice(2, 9);
            // Async-load the address into the placeholder
            if (typeof Geo !== 'undefined' && Geo.reverseGeocode) {
                setTimeout(() => {
                    Geo.reverseGeocode(lat, lng).then(addr => {
                        const el = document.getElementById(addrId);
                        if (el && addr && addr.short) el.textContent = addr.short;
                    });
                }, 0);
            }
            return `<a class="location-link" href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">
                        <i data-lucide="map-pin"></i>
                        <span class="location-link-body">
                            <strong>Ubicación compartida</strong>
                            <span class="location-addr" id="${addrId}">Cargando dirección…</span>
                            <small>${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}</small>
                        </span>
                    </a>`;
        }
        return this.escapeHtml(content);
    },

    async sendMessage() {
        const input = document.getElementById('chat-msg-input');
        const text = input.value.trim();
        if (!this.currentAgreementId) return;

        // Send image if pending
        if (this.pendingImage) {
            const imgContent = '[img]' + this.pendingImage + '[/img]';
            try {
                const msg = await API.sendMessage(this.currentAgreementId, imgContent);
                this.appendMessage(msg);
                this.lastTimestamp = msg.created_at;
            } catch (e) {
                App.showToast('Error al enviar imagen', 'error');
            }
            this.clearImage();
        }

        // Send text if any
        if (text) {
            input.value = '';
            try {
                const msg = await API.sendMessage(this.currentAgreementId, text);
                this.appendMessage(msg);
                this.lastTimestamp = msg.created_at;
            } catch (e) {
                App.showToast('Error al enviar mensaje', 'error');
            }
        }
    },

    // Image handling
    previewImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            App.showToast('Imagen muy grande (máx 5MB)', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            this.pendingImage = e.target.result;
            document.getElementById('chat-preview-img').src = e.target.result;
            document.getElementById('chat-image-preview').style.display = 'flex';
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    },

    clearImage() {
        this.pendingImage = null;
        const preview = document.getElementById('chat-image-preview');
        if (preview) preview.style.display = 'none';
        const input = document.getElementById('chat-file-input');
        if (input) input.value = '';
    },

    // Location sharing — chooser: GPS or map
    sendLocation() {
        if (!this.currentAgreementId) return;
        this._openLocationChooser();
    },

    _openLocationChooser() {
        const existing = document.getElementById('chat-loc-chooser');
        if (existing) existing.remove();
        const sheet = document.createElement('div');
        sheet.id = 'chat-loc-chooser';
        sheet.className = 'chat-loc-chooser';
        sheet.innerHTML = `
            <div class="chat-loc-chooser-backdrop" onclick="Chat._closeLocationChooser()"></div>
            <div class="chat-loc-chooser-card">
                <h4>Compartir ubicación</h4>
                <button class="chat-loc-opt" onclick="Chat._chooseLocCurrent()">
                    <i data-lucide="crosshair"></i>
                    <div>
                        <strong>Usar mi ubicación actual</strong>
                        <span>Detecta tu posición por GPS</span>
                    </div>
                </button>
                <button class="chat-loc-opt" onclick="Chat._chooseLocMap()">
                    <i data-lucide="map-pin"></i>
                    <div>
                        <strong>Seleccionar en el mapa</strong>
                        <span>Toca o busca el lugar exacto</span>
                    </div>
                </button>
                <button class="btn btn-cancel btn-full" onclick="Chat._closeLocationChooser()">Cancelar</button>
            </div>
        `;
        document.body.appendChild(sheet);
        if (window.lucide) lucide.createIcons({ nodes: [sheet] });
    },

    _closeLocationChooser() {
        const el = document.getElementById('chat-loc-chooser');
        if (el) el.remove();
    },

    async _chooseLocCurrent() {
        this._closeLocationChooser();
        App.showToast('Detectando ubicación...');
        const pos = await Geo.getCurrentPosition();
        if (!pos) { App.showToast('No se pudo obtener la ubicación', 'error'); return; }
        await this._sendLocationCoords(pos.latitude, pos.longitude);
    },

    _chooseLocMap() {
        this._closeLocationChooser();
        const uid = 'chat-loc-pick-' + Date.now();
        Geo._pickerSetLocation = Geo._pickerSetLocation || {};
        Geo._pickerSetLocation[uid] = async (lat, lng) => {
            delete Geo._pickerSetLocation[uid];
            await this._sendLocationCoords(lat, lng);
        };
        Geo._openFullscreenPicker(uid, '__chat_lat_dummy__', '__chat_lng_dummy__', '');
    },

    async _sendLocationCoords(lat, lng) {
        const content = `[ubicacion]${lat},${lng}[/ubicacion]`;
        try {
            const msg = await API.sendMessage(this.currentAgreementId, content);
            this.appendMessage(msg);
            this.lastTimestamp = msg.created_at;
            App.showToast('Ubicación compartida');
        } catch (e) {
            App.showToast('Error al compartir ubicación', 'error');
        }
    },

    startPolling() {
        this.stopPolling();
        this.pollInterval = setInterval(() => this.pollNewMessages(), 2000);
    },

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    },

    async pollNewMessages() {
        if (!this.currentAgreementId || !this.lastTimestamp) return;
        try {
            const msgs = await API.getMessages(this.currentAgreementId);
            const newMsgs = msgs.filter(m => m.created_at > this.lastTimestamp && m.sender_id !== API.user.id);
            newMsgs.forEach(m => this.appendMessage(m));
            if (newMsgs.length > 0) this.lastTimestamp = newMsgs[newMsgs.length - 1].created_at;
            // Refresh status bar if agreement status may have changed
            const a = await API.getAgreement(this.currentAgreementId);
            if (this.currentAgreement && a.status !== this.currentAgreement.status
                || a.complete_requester !== this.currentAgreement?.complete_requester
                || a.complete_provider !== this.currentAgreement?.complete_provider) {
                this.currentAgreement = a;
                this.renderStatusBar(a);
            }
        } catch (e) { /* ignore */ }
    },

    startGlobalPolling() {
        this.lastGlobalPoll = new Date().toISOString().replace('T', ' ').slice(0, 19);
        this.globalPollInterval = setInterval(() => this.globalPoll(), 5000);
    },

    stopGlobalPolling() {
        if (this.globalPollInterval) {
            clearInterval(this.globalPollInterval);
            this.globalPollInterval = null;
        }
    },

    async globalPoll() {
        if (!API.token) return;
        try {
            const data = await API.poll(this.lastGlobalPoll);
            const alertTotal = (data.unread_messages || 0) + (data.pending_agreements || 0);
            const badge = document.getElementById('agreements-badge');
            if (badge) {
                badge.textContent = alertTotal > 0 ? alertTotal : '';
                badge.classList.toggle('hidden', alertTotal === 0);
            }
            const navBadge = document.getElementById('nav-badge');
            if (navBadge) {
                const navCount = data.total_agreements || 0;
                navBadge.textContent = navCount > 0 ? navCount : '';
                navBadge.classList.toggle('hidden', navCount === 0);
            }
            // Keep agreement tab counts fresh in background
            if (typeof App !== 'undefined') App.refreshAgreementCounts();
        } catch (e) { /* ignore */ }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    _esc(s) { return this.escapeHtml(String(s == null ? '' : s)); }
};
