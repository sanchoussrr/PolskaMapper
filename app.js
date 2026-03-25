// =====================================================
// PolskaMapper — Main Application (MapLibre GL)
// =====================================================

(function () {
    'use strict';

    // ─── Tile styles ─────────────────────────────────
    var MAP_STYLES = {
        dark: {
            version: 8, name: 'Dark',
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: { 'tiles': { type: 'raster', tiles: [
                'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
                'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
            ], tileSize: 256, attribution: '© CARTO, © OpenStreetMap' }},
            layers: [{ id: 'tiles', type: 'raster', source: 'tiles', minzoom: 0, maxzoom: 19 }]
        },
        light: {
            version: 8, name: 'Light',
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: { 'tiles': { type: 'raster', tiles: [
                'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
            ], tileSize: 256, attribution: '© CARTO, © OpenStreetMap' }},
            layers: [{ id: 'tiles', type: 'raster', source: 'tiles', minzoom: 0, maxzoom: 19 }]
        },
        satellite: {
            version: 8, name: 'Satellite',
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
            sources: { 'tiles': { type: 'raster', tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            ], tileSize: 256, attribution: '© Esri' }},
            layers: [{ id: 'tiles', type: 'raster', source: 'tiles', minzoom: 0, maxzoom: 18 }]
        }
    };

    var POLAND_CENTER = [19.4, 51.9];
    var INITIAL_ZOOM = 5.8;
    var INITIAL_PITCH = 45;
    var INITIAL_BEARING = -10;

    // ─── State ───────────────────────────────────────
    var map = null;
    var markers = [];
    var activeCity = null;
    var currentFilter = 'all';
    var currentSort = 'population';
    var currentStyle = 'dark';
    var is3D = true;
    var currentLang = 'ru'; // ru | pl
    var currentNav = 'map'; // map | cities | realty | analytics

    // ─── Helpers ─────────────────────────────────────
    function qs(sel) { return document.querySelector(sel); }
    function qsa(sel) { return document.querySelectorAll(sel); }

    function fmt(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
        return String(n);
    }
    function fmtFull(n) { return n.toLocaleString('ru-RU'); }

    function animateValue(el, end, dur) {
        var t0 = performance.now();
        function tick(now) {
            var p = Math.min((now - t0) / dur, 1);
            var v = Math.floor((1 - Math.pow(1 - p, 3)) * end);
            el.textContent = end >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : fmtFull(v);
            if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    // ─── Loading ─────────────────────────────────────
    function setLoading(pct) { qs('#loadingBar').style.width = pct + '%'; }
    function hideLoading() {
        setLoading(100);
        setTimeout(function () { qs('#loadingScreen').classList.add('loading-screen--hidden'); }, 300);
    }

    // ─── Filtering ───────────────────────────────────
    function getFilteredCities() {
        var cities = CITIES_DATA.slice();
        if (currentFilter !== 'all') {
            cities = cities.filter(function (c) { return c.category === currentFilter; });
        }
        var q = (qs('#searchInput').value || '').toLowerCase().trim();
        if (q) {
            cities = cities.filter(function (c) {
                return c.name.toLowerCase().indexOf(q) !== -1 ||
                       c.nameLocal.toLowerCase().indexOf(q) !== -1 ||
                       c.voivodeship.toLowerCase().indexOf(q) !== -1;
            });
        }
        if (currentSort === 'population') cities.sort(function (a, b) { return b.population - a.population; });
        else if (currentSort === 'name') cities.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
        else if (currentSort === 'area') cities.sort(function (a, b) { return b.area - a.area; });
        return cities;
    }

    // ═════════════════════════════════════════════════
    // MAP
    // ═════════════════════════════════════════════════
    function initMap() {
        setLoading(20);
        map = new maplibregl.Map({
            container: 'map',
            style: MAP_STYLES.dark,
            center: POLAND_CENTER,
            zoom: INITIAL_ZOOM,
            pitch: INITIAL_PITCH,
            bearing: INITIAL_BEARING,
            antialias: false,
            maxBounds: [[10, 47], [28, 57]],
            minZoom: 4, maxZoom: 16,
            fadeDuration: 0,
            trackResize: true
        });

        setLoading(40);

        map.on('load', function () {
            setLoading(60);
            addBorder();
            setLoading(70);
            addHeatCircles();
            setLoading(85);
            syncMarkers();
            setLoading(95);
            hideLoading();
            animateStats();
        });

        map.on('error', function (e) {
            console.warn('Map error:', e.error || e);
            hideLoading();
        });
    }

    // ─── Border ──────────────────────────────────────
    function addBorder() {
        if (map.getSource('pl-border')) return;
        map.addSource('pl-border', { type: 'geojson', data: POLAND_BORDER });
        map.addLayer({ id: 'pl-fill', type: 'fill', source: 'pl-border',
            paint: { 'fill-color': '#E63946', 'fill-opacity': 0.04 } });
        map.addLayer({ id: 'pl-line', type: 'line', source: 'pl-border',
            paint: { 'line-color': '#E63946', 'line-width': 2, 'line-opacity': 0.6 } });
    }

    // ─── Heat circles ────────────────────────────────
    function addHeatCircles() {
        if (map.getSource('heat')) return;
        var fc = { type: 'FeatureCollection', features: CITIES_DATA.map(function (c) {
            return { type: 'Feature', geometry: { type: 'Point', coordinates: c.coordinates },
                     properties: { population: c.population } };
        })};
        map.addSource('heat', { type: 'geojson', data: fc });
        map.addLayer({ id: 'heat-glow', type: 'circle', source: 'heat', paint: {
            'circle-radius': ['interpolate',['linear'],['get','population'],100000,18,500000,32,1000000,45,2000000,60],
            'circle-color': '#E63946', 'circle-opacity': 0.07, 'circle-blur': 1
        }});
    }

    // ─── Remove custom layers before style change ────
    function removeCustomLayers() {
        ['heat-glow','pl-line','pl-fill'].forEach(function (id) { try { if (map.getLayer(id)) map.removeLayer(id); } catch(e){} });
        ['heat','pl-border'].forEach(function (id) { try { if (map.getSource(id)) map.removeSource(id); } catch(e){} });
    }

    // ─── Markers ─────────────────────────────────────
    function syncMarkers() {
        clearMarkers();
        var cities = getFilteredCities();
        cities.forEach(function (city) {
            var el = document.createElement('div');
            el.className = 'marker';
            var isCapital = city.category === 'capital';

            var dot = document.createElement('div');
            dot.className = 'marker__dot' + (isCapital ? ' marker__dot--capital' : '');
            dot.style.borderColor = city.color;
            dot.style.boxShadow = '0 0 6px ' + city.color + '80';

            var label = document.createElement('span');
            label.className = 'marker__label' + (isCapital ? ' marker__label--capital' : '');
            label.textContent = currentLang === 'pl' ? city.nameLocal : city.name;
            if (isCapital) { label.style.background = city.color; label.style.borderColor = city.color; }

            el.appendChild(dot);
            el.appendChild(label);
            el.addEventListener('click', function (e) { e.stopPropagation(); selectCity(city); });

            var m = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat(city.coordinates).addTo(map);
            markers.push(m);
        });
    }
    function clearMarkers() { markers.forEach(function (m) { m.remove(); }); markers.length = 0; }

    // ─── City selection ──────────────────────────────
    function selectCity(city) {
        activeCity = city;

        var img = qs('#popupImage');
        if (img) { img.style.display = ''; img.src = city.image; img.onerror = function () { this.style.display = 'none'; }; }

        var set = function (id, txt) { var el = qs('#' + id); if (el) el.textContent = txt; };
        set('popupName', city.name);
        set('popupVoivodeship', city.voivodeship);
        set('popupPopulation', fmtFull(city.population));
        set('popupArea', city.area + ' км²');
        set('popupDensity', fmtFull(city.density) + '/км²');
        set('popupDescription', city.description);

        var lm = qs('#popupLandmarks');
        if (lm) lm.innerHTML = city.landmarks.map(function (l) { return '<span class="landmark-tag">' + l + '</span>'; }).join('');

        qs('#cityPopup').classList.add('city-popup--visible');

        // highlight card in sidebar
        qsa('.city-card').forEach(function (c) { c.classList.toggle('city-card--active', +c.dataset.id === city.id); });
        var ac = qs('.city-card[data-id="' + city.id + '"]');
        if (ac) ac.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        flyTo(city);
    }

    function flyTo(city) {
        if (!map) return;
        map.flyTo({
            center: city.coordinates,
            zoom: city.category === 'capital' ? 10.5 : 10,
            pitch: is3D ? 50 : 0,
            bearing: 0, duration: 1800, essential: true
        });
    }

    function closePopup() {
        qs('#cityPopup').classList.remove('city-popup--visible');
        activeCity = null;
        qsa('.city-card').forEach(function (c) { c.classList.remove('city-card--active'); });
    }

    // ─── City list render ────────────────────────────
    function renderCityList() {
        var $list = qs('#cityList');
        var cities = getFilteredCities();

        if (!cities.length) {
            $list.innerHTML = '<div class="empty-state"><p class="empty-state__title">Ничего не найдено</p><p class="empty-state__sub">Попробуйте изменить запрос</p></div>';
            qs('#totalCities').textContent = '0';
            return;
        }

        var h = '';
        for (var i = 0; i < cities.length; i++) {
            var c = cities[i];
            var active = activeCity && activeCity.id === c.id;
            h += '<div class="city-card' + (active ? ' city-card--active' : '') + '" data-id="' + c.id + '">' +
                '<div class="city-card__avatar" style="color:' + c.color + ';border-color:' + c.color + '30;background:' + c.color + '12">' + c.name[0] + '</div>' +
                '<div class="city-card__info">' +
                    '<div class="city-card__name">' + c.name +
                        (c.category === 'capital' ? ' <span class="city-card__badge city-card__badge--capital">Столица</span>' : '') +
                        (c.category === 'large' ? ' <span class="city-card__badge city-card__badge--large">Крупный</span>' : '') +
                    '</div>' +
                    '<div class="city-card__voivodeship">' + c.voivodeship + '</div>' +
                    '<div class="city-card__meta"><span>' + fmt(c.population) + ' чел.</span><span>' + c.area + ' км²</span></div>' +
                '</div>' +
                '<svg class="city-card__arrow" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
            '</div>';
        }
        $list.innerHTML = h;
        qs('#totalCities').textContent = cities.length;
    }

    function animateStats() {
        var tp = CITIES_DATA.reduce(function (s, c) { return s + c.population; }, 0);
        animateValue(qs('#totalCities'), CITIES_DATA.length, 600);
        animateValue(qs('#totalPopulation'), tp, 1000);
    }

    // ═════════════════════════════════════════════════
    // ALL BUTTON HANDLERS
    // ═════════════════════════════════════════════════

    function initAllHandlers() {

        // ── City list click (delegated) ──────────────
        qs('#cityList').addEventListener('click', function (e) {
            var card = e.target.closest('.city-card');
            if (!card) return;
            var city = CITIES_DATA.find(function (c) { return c.id === +card.dataset.id; });
            if (city) selectCity(city);
        });

        // ── Filter buttons ───────────────────────────
        qsa('.filter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                qsa('.filter-btn').forEach(function (b) { b.classList.remove('filter-btn--active'); });
                btn.classList.add('filter-btn--active');
                currentFilter = btn.dataset.filter;
                renderCityList();
                syncMarkers();
            });
        });

        // ── Sort select ──────────────────────────────
        qs('#sortSelect').addEventListener('change', function () {
            currentSort = this.value;
            renderCityList();
        });

        // ── Search input ─────────────────────────────
        var searchTimer;
        qs('#searchInput').addEventListener('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function () {
                renderCityList();
                syncMarkers();
            }, 300);
        });

        // ── Zoom In ──────────────────────────────────
        qs('#zoomIn').addEventListener('click', function () {
            map.zoomIn({ duration: 400 });
        });

        // ── Zoom Out ─────────────────────────────────
        qs('#zoomOut').addEventListener('click', function () {
            map.zoomOut({ duration: 400 });
        });

        // ── 3D / Rotate toggle ───────────────────────
        qs('#rotateBtn').addEventListener('click', function () {
            is3D = !is3D;
            map.easeTo({ pitch: is3D ? 50 : 0, bearing: is3D ? -10 : 0, duration: 800 });
            // Visual feedback
            this.style.color = is3D ? '#E63946' : '';
        });

        // ── Reset view ───────────────────────────────
        qs('#resetBtn').addEventListener('click', function () {
            closePopup();
            is3D = true;
            qs('#rotateBtn').style.color = '';
            map.flyTo({
                center: POLAND_CENTER, zoom: INITIAL_ZOOM,
                pitch: INITIAL_PITCH, bearing: INITIAL_BEARING,
                duration: 1500
            });
        });

        // ── Style switcher (dark / light / satellite) ─
        qsa('.style-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var s = btn.dataset.style;
                if (s === currentStyle) return;
                qsa('.style-btn').forEach(function (b) { b.classList.remove('style-btn--active'); });
                btn.classList.add('style-btn--active');
                currentStyle = s;

                // save camera position
                var cam = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };

                // clean custom layers
                removeCustomLayers();
                // clear DOM markers before style change
                clearMarkers();

                map.setStyle(MAP_STYLES[s]);

                // re-add everything after new style loads
                map.once('load', function () {
                    map.jumpTo(cam);
                    addBorder();
                    addHeatCircles();
                    syncMarkers();
                });
            });
        });

        // ── Close popup button ───────────────────────
        qs('#closePopup').addEventListener('click', function () {
            closePopup();
        });

        // ── Fly to city button (in popup) ────────────
        qs('#flyToCity').addEventListener('click', function () {
            if (activeCity) flyTo(activeCity);
        });

        // ── Language toggle (RU / PL) ────────────────
        qs('#langBtn').addEventListener('click', function () {
            currentLang = currentLang === 'ru' ? 'pl' : 'ru';
            this.querySelector('span').textContent = currentLang.toUpperCase();
            // re-render labels
            renderCityList();
            syncMarkers();
        });

        // ── Nav links (Карта, Города, etc.) ──────────
        var navSections = ['map', 'cities', 'realty', 'analytics'];
        qsa('.nav__link').forEach(function (link, idx) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                qsa('.nav__link').forEach(function (l) { l.classList.remove('nav__link--active'); });
                link.classList.add('nav__link--active');
                currentNav = navSections[idx] || 'map';
                handleNavChange(currentNav);
            });
        });

        // ── Logo click — reset everything ────────────
        qs('.logo').addEventListener('click', function (e) {
            e.preventDefault();
            // reset nav
            qsa('.nav__link').forEach(function (l) { l.classList.remove('nav__link--active'); });
            var first = qs('.nav__link');
            if (first) first.classList.add('nav__link--active');
            currentNav = 'map';

            // reset filters
            currentFilter = 'all';
            qsa('.filter-btn').forEach(function (b) { b.classList.remove('filter-btn--active'); });
            var allBtn = qs('.filter-btn[data-filter="all"]');
            if (allBtn) allBtn.classList.add('filter-btn--active');

            // reset search
            qs('#searchInput').value = '';

            // reset sort
            qs('#sortSelect').value = 'population';
            currentSort = 'population';

            // close popup, reset view
            closePopup();
            is3D = true;
            qs('#rotateBtn').style.color = '';
            renderCityList();
            syncMarkers();
            map.flyTo({
                center: POLAND_CENTER, zoom: INITIAL_ZOOM,
                pitch: INITIAL_PITCH, bearing: INITIAL_BEARING,
                duration: 1500
            });
        });

        // ── Keyboard shortcuts ───────────────────────
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closePopup();
                qs('#searchInput').blur();
            }
            if (e.key === '/' && document.activeElement !== qs('#searchInput')) {
                e.preventDefault();
                qs('#searchInput').focus();
            }
        });

        // ── Click on map to close popup ──────────────
        map.on('click', function () {
            if (activeCity) closePopup();
        });
    }

    // ─── Nav section handler ─────────────────────────
    function handleNavChange(section) {
        var sidebar = qs('#sidebar');
        // Show/hide sidebar sections based on nav
        var filtersEl = qs('.sidebar__filters');
        var sortEl = qs('.sidebar__sort');

        switch (section) {
            case 'map':
                qs('.sidebar__title').textContent = 'Крупные города Польши';
                qs('.sidebar__subtitle').textContent = 'Выберите город для просмотра';
                if (filtersEl) filtersEl.style.display = '';
                if (sortEl) sortEl.style.display = '';
                currentFilter = 'all';
                qsa('.filter-btn').forEach(function (b) { b.classList.remove('filter-btn--active'); });
                var ab = qs('.filter-btn[data-filter="all"]'); if (ab) ab.classList.add('filter-btn--active');
                renderCityList();
                syncMarkers();
                map.flyTo({ center: POLAND_CENTER, zoom: INITIAL_ZOOM, pitch: INITIAL_PITCH, bearing: INITIAL_BEARING, duration: 1500 });
                break;

            case 'cities':
                qs('.sidebar__title').textContent = 'Все города';
                qs('.sidebar__subtitle').textContent = 'Список всех городов Польши';
                if (filtersEl) filtersEl.style.display = '';
                if (sortEl) sortEl.style.display = '';
                currentFilter = 'all';
                qsa('.filter-btn').forEach(function (b) { b.classList.remove('filter-btn--active'); });
                var ab2 = qs('.filter-btn[data-filter="all"]'); if (ab2) ab2.classList.add('filter-btn--active');
                renderCityList();
                syncMarkers();
                break;

            case 'realty':
                qs('.sidebar__title').textContent = 'Недвижимость';
                qs('.sidebar__subtitle').textContent = 'Обзор рынка недвижимости Польши';
                if (filtersEl) filtersEl.style.display = 'none';
                if (sortEl) sortEl.style.display = 'none';
                qs('#cityList').innerHTML =
                    '<div class="empty-state">' +
                    '<p class="empty-state__title">🏠 Раздел в разработке</p>' +
                    '<p class="empty-state__sub">Данные о недвижимости скоро появятся</p>' +
                    '</div>';
                break;

            case 'analytics':
                qs('.sidebar__title').textContent = 'Аналитика';
                qs('.sidebar__subtitle').textContent = 'Статистика и данные';
                if (filtersEl) filtersEl.style.display = 'none';
                if (sortEl) sortEl.style.display = 'none';
                // Show analytics summary
                var totalPop = CITIES_DATA.reduce(function (s, c) { return s + c.population; }, 0);
                var avgPop = Math.round(totalPop / CITIES_DATA.length);
                var biggest = CITIES_DATA.slice().sort(function (a, b) { return b.population - a.population; })[0];
                var smallest = CITIES_DATA.slice().sort(function (a, b) { return a.population - b.population; })[0];
                var totalArea = CITIES_DATA.reduce(function (s, c) { return s + c.area; }, 0);
                qs('#cityList').innerHTML =
                    '<div style="padding:16px 8px;">' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;">' +
                        '<div class="stat-card__label">Общее население</div>' +
                        '<div class="stat-card__value">' + fmtFull(totalPop) + '</div>' +
                    '</div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;">' +
                        '<div class="stat-card__label">Среднее население города</div>' +
                        '<div class="stat-card__value">' + fmtFull(avgPop) + '</div>' +
                    '</div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;">' +
                        '<div class="stat-card__label">Крупнейший город</div>' +
                        '<div class="stat-card__value" style="font-size:15px;">' + biggest.name + ' (' + fmtFull(biggest.population) + ')</div>' +
                    '</div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;">' +
                        '<div class="stat-card__label">Наименьший город</div>' +
                        '<div class="stat-card__value" style="font-size:15px;">' + smallest.name + ' (' + fmtFull(smallest.population) + ')</div>' +
                    '</div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;">' +
                        '<div class="stat-card__label">Общая площадь городов</div>' +
                        '<div class="stat-card__value">' + fmtFull(Math.round(totalArea)) + ' км²</div>' +
                    '</div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;">' +
                        '<div class="stat-card__label">Количество городов</div>' +
                        '<div class="stat-card__value">' + CITIES_DATA.length + '</div>' +
                    '</div>' +
                    '</div>';
                break;
        }
    }

    // ═════════════════════════════════════════════════
    // BOOT
    // ═════════════════════════════════════════════════
    function boot() {
        setLoading(10);
        initMap();
        renderCityList();

        // Wait for map to be ready, then attach all handlers
        map.on('load', function () {
            initAllHandlers();
        });
    }

    // Safe DOM-ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
