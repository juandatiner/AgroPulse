const Geo = {
    _addrCache: {},
    _mapCounter: 0,

    getCurrentPosition() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(null);
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 10000 }
            );
        });
    },

    // Reverse geocoding via OpenStreetMap Nominatim
    async reverseGeocode(lat, lng) {
        if (lat == null || lng == null) return null;
        const key = `${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;
        if (this._addrCache[key]) return this._addrCache[key];
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&accept-language=es`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return null;
            const data = await res.json();
            const a = data.address || {};
            // Build a compact readable line: "Vereda/Barrio, Ciudad, Departamento"
            const parts = [];
            const locality = a.neighbourhood || a.suburb || a.village || a.hamlet || a.town || a.quarter || a.road;
            if (locality) parts.push(locality);
            const city = a.city || a.town || a.municipality || a.village;
            if (city && city !== locality) parts.push(city);
            const state = a.state || a.region;
            if (state) parts.push(state);
            const short = parts.slice(0, 3).join(', ') || data.display_name || '';
            const result = { short, full: data.display_name || short };
            this._addrCache[key] = result;
            return result;
        } catch (e) {
            return null;
        }
    },

    // Render an interactive Leaflet map into an element by id
    renderMap(containerId, lat, lng, opts = {}) {
        const el = document.getElementById(containerId);
        if (!el || typeof L === 'undefined') return null;
        if (lat == null || lng == null) return null;
        el.innerHTML = '';
        el.style.minHeight = opts.height || '180px';
        try {
            const map = L.map(el, {
                zoomControl: opts.zoomControl !== false,
                scrollWheelZoom: opts.scrollWheelZoom === true,
                dragging: opts.dragging !== false,
                attributionControl: true,
            }).setView([+lat, +lng], opts.zoom || 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap'
            }).addTo(map);
            L.marker([+lat, +lng]).addTo(map);
            // Ensure the map renders correctly after being inserted
            setTimeout(() => map.invalidateSize(), 100);
            return map;
        } catch (e) {
            console.error('Error rendering map:', e);
            return null;
        }
    },

    // Build a reusable map + address block HTML (map is rendered after insertion)
    buildMapBlock(lat, lng, { height = '180px' } = {}) {
        if (lat == null || lng == null) return '';
        const id = 'map-' + (++this._mapCounter);
        const addrId = id + '-addr';
        // Hydrate async
        setTimeout(() => {
            this.renderMap(id, lat, lng, { height });
            this.reverseGeocode(lat, lng).then(addr => {
                const el = document.getElementById(addrId);
                if (el && addr && addr.short) {
                    el.innerHTML = `<i data-lucide="map-pin"></i> ${addr.short}`;
                    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
                }
            });
        }, 0);
        return `
            <div class="map-block">
                <div id="${id}" class="map-container" style="height:${height}"></div>
                <div class="map-address" id="${addrId}">
                    <i data-lucide="loader-2" class="spin-icon"></i> Cargando dirección...
                </div>
                <a class="map-open-link" href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">
                    <i data-lucide="external-link"></i> Abrir en mapa
                </a>
            </div>`;
    },

    setupGeoButton(btnId, latId, lngId, statusId) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        btn.addEventListener('click', async () => {
            btn.classList.add('loading');
            btn.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i> Detectando...';
            lucide.createIcons({ nodes: [btn] });
            const pos = await this.getCurrentPosition();
            if (pos) {
                if (latId) document.getElementById(latId).value = pos.latitude;
                if (lngId) document.getElementById(lngId).value = pos.longitude;
                btn.classList.remove('loading');
                btn.classList.add('active');
                btn.innerHTML = '<i data-lucide="map-pin-check"></i> Ubicación detectada';
                lucide.createIcons({ nodes: [btn] });
                // Try to resolve address and show preview
                const statusEl = statusId ? document.getElementById(statusId) : null;
                if (statusEl) {
                    statusEl.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i> Buscando dirección...';
                    lucide.createIcons({ nodes: [statusEl] });
                }
                const addr = await this.reverseGeocode(pos.latitude, pos.longitude);
                if (statusEl) {
                    statusEl.innerHTML = addr && addr.short
                        ? `<i data-lucide="map-pin"></i> ${addr.short}`
                        : `<i data-lucide="map-pin"></i> ${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`;
                    lucide.createIcons({ nodes: [statusEl] });
                }
                // If there's a preview container next to the button, render mini-map
                const previewId = btnId + '-map';
                const previewEl = document.getElementById(previewId);
                if (previewEl) {
                    previewEl.innerHTML = '';
                    previewEl.style.display = 'block';
                    this.renderMap(previewId, pos.latitude, pos.longitude, { height: '180px', scrollWheelZoom: false });
                }
            } else {
                btn.classList.remove('loading');
                btn.innerHTML = '<i data-lucide="map-pin-off"></i> No disponible';
                lucide.createIcons({ nodes: [btn] });
                setTimeout(() => {
                    btn.innerHTML = '<i data-lucide="crosshair"></i> Detectar ubicación';
                    lucide.createIcons({ nodes: [btn] });
                }, 2000);
            }
        });
    }
};
