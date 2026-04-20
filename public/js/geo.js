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

    async reverseGeocode(lat, lng) {
        if (lat == null || lng == null) return null;
        const key = `${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;
        if (this._addrCache[key]) return this._addrCache[key];
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&accept-language=es`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return null;
            const data = await res.json();
            const a = data.address || {};
            // Build street-level address
            const streetNum = a.house_number || '';
            const street = a.road || a.pedestrian || a.footway || a.path || '';
            const streetLine = street ? (streetNum ? `${street} ${streetNum}` : street) : '';
            const locality = a.neighbourhood || a.suburb || a.quarter || a.hamlet || a.village;
            const city = a.city || a.town || a.municipality || a.village || a.county;
            const state = a.state || a.region;
            // Short: street + city + state
            const shortParts = [streetLine, locality, city, state].filter(Boolean);
            const short = shortParts.slice(0, 3).join(', ') || data.display_name || '';
            // Line without state for compact display
            const line = [streetLine, locality || city].filter(Boolean).join(', ') || city || short;
            const result = { short, line, full: data.display_name || short, city: city || state || short };
            this._addrCache[key] = result;
            return result;
        } catch (e) { return null; }
    },

    async nominatimSearch(q) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=co&limit=6&accept-language=es`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return [];
            return await res.json();
        } catch (e) { return []; }
    },

    _mapInstances: {},

    renderMap(containerId, lat, lng, opts = {}) {
        const el = document.getElementById(containerId);
        if (!el || typeof L === 'undefined') return null;
        if (lat == null || lng == null) return null;
        // Destroy existing Leaflet instance on this container
        if (Geo._mapInstances[containerId]) {
            try { Geo._mapInstances[containerId].remove(); } catch(e) {}
            delete Geo._mapInstances[containerId];
        }
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
                maxZoom: 19, attribution: '© OpenStreetMap'
            }).addTo(map);
            L.marker([+lat, +lng]).addTo(map);
            Geo._mapInstances[containerId] = map;
            setTimeout(() => { map.invalidateSize(); map.setView([+lat, +lng], opts.zoom || 15); }, 150);
            setTimeout(() => map.invalidateSize(), 400);
            return map;
        } catch (e) { console.error('Error rendering map:', e); return null; }
    },

    buildMapBlock(lat, lng, { height = '200px', notes = '' } = {}) {
        if (lat == null || lng == null) return '';
        const id = 'map-' + (++this._mapCounter);
        const addrId = id + '-addr';
        const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        setTimeout(() => {
            this.renderMap(id, lat, lng, { height });
            this.reverseGeocode(lat, lng).then(addr => {
                const el = document.getElementById(addrId);
                if (el && addr) {
                    el.innerHTML = `
                        <div class="map-addr-line"><i data-lucide="map-pin"></i> <strong>${addr.line || addr.short}</strong></div>
                        ${addr.city && addr.city !== addr.line ? `<div class="map-addr-city">${addr.city}</div>` : ''}`;
                    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [el] });
                }
            });
        }, 0);
        return `
            <div class="map-block">
                <div class="map-address" id="${addrId}">
                    <i data-lucide="loader-2" class="spin-icon"></i> Cargando dirección...
                </div>
                ${notes ? `<div class="map-notes"><i data-lucide="navigation"></i> <span>${notes}</span></div>` : ''}
                <div id="${id}" class="map-container" style="height:${height}"></div>
                <a class="map-open-btn" href="${mapsUrl}" target="_blank" rel="noopener">
                    <i data-lucide="map"></i> Abrir en Google Maps
                </a>
            </div>`;
    },

    // Full interactive location picker: GPS + click/drag map (no search)
    setupLocationPicker({ containerId, latId, lngId, addrHiddenId = null }) {
        const container = document.getElementById(containerId);
        if (!container || typeof L === 'undefined') return null;

        const uid = containerId;
        const mapId = uid + '-lmap';
        const gpsId = uid + '-lgps';
        const addrId = uid + '-laddr';

        container.innerHTML = `
            <div class="loc-picker">
                <div class="loc-gps-row">
                    <button type="button" id="${gpsId}" class="loc-gps-full-btn">
                        <i data-lucide="crosshair"></i> Usar mi ubicación actual
                    </button>
                </div>
                <button type="button" class="loc-expand-trigger" id="${uid}-expand" onclick="Geo._openFullscreenPicker('${uid}', '${latId}', '${lngId}', '${addrHiddenId || ''}')">
                    <i data-lucide="map-pin"></i> <span>Toca para elegir en el mapa</span>
                    <i data-lucide="expand" style="margin-left:auto"></i>
                </button>
                <div id="${mapId}" class="loc-map-container loc-map-preview-mini" onclick="Geo._openFullscreenPicker('${uid}', '${latId}', '${lngId}', '${addrHiddenId || ''}')" title="Toca para ampliar"></div>
                <div id="${addrId}" class="loc-addr-display" style="display:none">
                    <i data-lucide="map-pin"></i>
                    <div>
                        <span class="loc-addr-text"></span>
                        <span class="loc-addr-city"></span>
                    </div>
                </div>
            </div>`;

        lucide.createIcons({ nodes: [container] });

        // setLocation: update hidden inputs + mini map preview + address display
        const setLocation = async (lat, lng) => {
            const latEl = document.getElementById(latId);
            const lngEl = document.getElementById(lngId);
            if (latEl) latEl.value = lat;
            if (lngEl) lngEl.value = lng;

            // Hide GPS row after location chosen
            const gpsRow = document.getElementById(gpsId)?.closest('.loc-gps-row');
            if (gpsRow) gpsRow.style.display = 'none';

            // Show mini map BEFORE Leaflet init so it can measure correctly
            const miniMap = document.getElementById(mapId);
            if (miniMap) { miniMap.style.display = 'block'; miniMap.style.height = '160px'; }

            // Wait one frame for display:block to apply, then render
            await new Promise(r => setTimeout(r, 30));
            Geo.renderMap(mapId, lat, lng, { height: '160px', zoom: 14, zoomControl: false, scrollWheelZoom: false, dragging: false });

            // Update expand trigger text
            const expBtn = document.getElementById(uid + '-expand');
            if (expBtn) {
                expBtn.querySelector('span') && (expBtn.querySelector('span').textContent = 'Cambiar ubicación');
            }

            // Show address
            const addrEl = document.getElementById(addrId);
            if (addrEl) {
                addrEl.style.display = 'flex';
                const lineEl = addrEl.querySelector('.loc-addr-text');
                const cityEl = addrEl.querySelector('.loc-addr-city');
                if (lineEl) lineEl.textContent = 'Buscando dirección...';
                if (cityEl) cityEl.textContent = '';
            }
            const addr = await Geo.reverseGeocode(lat, lng);
            const addrEl2 = document.getElementById(addrId);
            if (addrEl2) {
                const lineEl = addrEl2.querySelector('.loc-addr-text');
                const cityEl = addrEl2.querySelector('.loc-addr-city');
                if (lineEl) lineEl.textContent = addr ? (addr.line || addr.short) : `${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}`;
                if (cityEl) cityEl.textContent = addr && addr.city && addr.city !== addr.line ? addr.city : '';
            }
            if (addrHiddenId) {
                const hidden = document.getElementById(addrHiddenId);
                if (hidden) hidden.value = addr ? (addr.short || addr.city || '') : '';
            }
        };

        // Always show mini map container (empty/hidden until location chosen)
        const miniMapInit = document.getElementById(mapId);
        if (miniMapInit) miniMapInit.style.display = 'none';

        // Restore initial values
        const initLat = parseFloat(document.getElementById(latId)?.value);
        const initLng = parseFloat(document.getElementById(lngId)?.value);
        if (!isNaN(initLat) && !isNaN(initLng)) {
            setTimeout(() => setLocation(initLat, initLng), 100);
        }

        // Store setLocation so fullscreen can call it on confirm
        Geo._pickerSetLocation = Geo._pickerSetLocation || {};
        Geo._pickerSetLocation[uid] = setLocation;

        // GPS button
        const gpsBtn = document.getElementById(gpsId);
        gpsBtn.addEventListener('click', async () => {
            gpsBtn.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i>';
            lucide.createIcons({ nodes: [gpsBtn] });
            gpsBtn.disabled = true;
            const pos = await Geo.getCurrentPosition();
            gpsBtn.disabled = false;
            if (pos) {
                await setLocation(pos.latitude, pos.longitude);
                gpsBtn.innerHTML = '<i data-lucide="map-pin-check"></i>';
            } else {
                gpsBtn.innerHTML = '<i data-lucide="map-pin-off"></i>';
                setTimeout(() => { gpsBtn.innerHTML = '<i data-lucide="crosshair"></i>'; lucide.createIcons({ nodes: [gpsBtn] }); }, 2000);
            }
            lucide.createIcons({ nodes: [gpsBtn] });
        });

        return { setLocation };
    },

    // Open fullscreen map picker overlay
    _openFullscreenPicker(uid, latId, lngId, addrHiddenId) {
        const existingLat = parseFloat(document.getElementById(latId)?.value) || null;
        const existingLng = parseFloat(document.getElementById(lngId)?.value) || null;

        const overlay = document.createElement('div');
        overlay.className = 'map-fullscreen-overlay';
        overlay.id = 'map-fullscreen-overlay';
        overlay.innerHTML = `
            <div class="map-fullscreen-header">
                <button type="button" class="map-fullscreen-back" onclick="document.getElementById('map-fullscreen-overlay').remove()">
                    <i data-lucide="arrow-left"></i>
                </button>
                <div class="map-fullscreen-title">
                    <h4>Elige la ubicación</h4>
                    <p>Toca el mapa o arrastra el pin</p>
                </div>
            </div>
            <div class="map-fullscreen-gps-row">
                <button type="button" id="fs-gps" class="loc-gps-full-btn" style="width:100%">
                    <i data-lucide="crosshair"></i> Usar mi ubicación actual
                </button>
            </div>
            <div id="fs-map" class="map-fullscreen-map"></div>
            <div class="map-fullscreen-footer">
                <div class="map-fullscreen-addr" id="fs-addr">Toca el mapa para elegir</div>
                <button type="button" class="btn btn-primary" id="fs-confirm" disabled>
                    <i data-lucide="check"></i> Confirmar ubicación
                </button>
            </div>`;
        document.body.appendChild(overlay);
        lucide.createIcons({ nodes: [overlay] });

        const initLat = existingLat || 4.5709;
        const initLng = existingLng || -74.2973;
        const initZoom = existingLat ? 14 : 6;

        const map = L.map('fs-map', { zoomControl: true, scrollWheelZoom: true })
            .setView([initLat, initLng], initZoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '© OpenStreetMap'
        }).addTo(map);

        let marker = null;
        let selLat = existingLat;
        let selLng = existingLng;

        const updateAddr = async (lat, lng) => {
            const el = document.getElementById('fs-addr');
            const btn = document.getElementById('fs-confirm');
            if (el) el.textContent = 'Buscando dirección...';
            const addr = await Geo.reverseGeocode(lat, lng);
            if (el) el.textContent = addr ? addr.short : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            if (btn) btn.disabled = false;
        };

        const placeMarker = (lat, lng) => {
            selLat = lat; selLng = lng;
            if (!marker) {
                marker = L.marker([lat, lng], { draggable: true }).addTo(map);
                marker.on('dragend', () => {
                    const p = marker.getLatLng();
                    selLat = p.lat; selLng = p.lng;
                    updateAddr(p.lat, p.lng);
                });
            } else {
                marker.setLatLng([lat, lng]);
            }
            updateAddr(lat, lng);
        };

        if (existingLat && existingLng) placeMarker(existingLat, existingLng);
        map.on('click', (e) => placeMarker(e.latlng.lat, e.latlng.lng));
        setTimeout(() => map.invalidateSize(), 100);

        // GPS
        document.getElementById('fs-gps').addEventListener('click', async () => {
            const btn = document.getElementById('fs-gps');
            btn.innerHTML = '<i data-lucide="loader-2" class="spin-icon"></i>';
            lucide.createIcons({ nodes: [btn] });
            const pos = await Geo.getCurrentPosition();
            if (pos) { placeMarker(pos.latitude, pos.longitude); map.setView([pos.latitude, pos.longitude], 15); }
            btn.innerHTML = '<i data-lucide="crosshair"></i>';
            lucide.createIcons({ nodes: [btn] });
        });

        // Confirm — delegate to picker's setLocation
        document.getElementById('fs-confirm').addEventListener('click', async () => {
            if (!selLat || !selLng) return;
            overlay.remove();
            const pickerSetLocation = Geo._pickerSetLocation && Geo._pickerSetLocation[uid];
            if (pickerSetLocation) {
                await pickerSetLocation(selLat, selLng);
            }
        });
    },

    // Legacy: kept for backwards compat with detail-view preview maps
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
