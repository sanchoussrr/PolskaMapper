// =====================================================
// PolskaMapper — Main Application (MapLibre GL v5)
// Light mode only — 360° rotation, FPS boost, building highlights
// =====================================================

(function () {
    'use strict';

    // ─── Конфигурация с оптимизациями ─────────────────
    var CONFIG = {
        MAX_TILE_CACHE_SIZE: 200,
        TILE_CACHE_CLEAN_INTERVAL: 60000,
        FPS_THROTTLE: 60,
        BUILDINGS_MIN_ZOOM: 14,
        MAX_BUILDING_HEIGHT: 100,
        BUILDING_OPACITY: 0.85,
        ROTATION_SPEED: 0.3,
        ANIMATION_DURATION: 800,
        ENABLE_360_ROTATION: true,
        ENABLE_PERFORMANCE_MODE: true
    };

    // ─── OpenFreeMap vector styles (только светлые) ───
    var OFM_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';
    var TERRAIN_URL = 'https://demotiles.maplibre.org/terrain-tiles/tiles.json';

    // Спутниковый стиль
    function buildSatelliteStyle() {
        return {
            version: 8,
            name: 'satellite',
            glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
            sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
            sources: {
                'satellite-tiles': {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    attribution: '&copy; Esri',
                    maxzoom: 18
                },
                'terrainSource': {
                    type: 'raster-dem',
                    url: TERRAIN_URL,
                    tileSize: 256
                },
                'hillshadeSource': {
                    type: 'raster-dem',
                    url: TERRAIN_URL,
                    tileSize: 256
                },
                'openmaptiles': {
                    type: 'vector',
                    url: OFM_LIBERTY.replace('/styles/liberty', '/planet')
                }
            },
            layers: [
                { id: 'background', type: 'background', paint: { 'background-color': '#f0f0f0' } },
                { id: 'satellite-tiles', type: 'raster', source: 'satellite-tiles' },
                {
                    id: 'hillshade', type: 'hillshade', source: 'hillshadeSource',
                    paint: {
                        'hillshade-shadow-color': '#473B24',
                        'hillshade-highlight-color': '#ffffff',
                        'hillshade-accent-color': '#5a5a5a',
                        'hillshade-exaggeration': 0.5
                    }
                }
            ],
            terrain: { source: 'terrainSource', exaggeration: 1.5 },
            sky: {
                'sky-color': '#87CEEB',
                'sky-horizon-blend': 0.4,
                'horizon-color': '#b0d4f8',
                'horizon-fog-blend': 0.6,
                'fog-color': '#d4e8f8',
                'fog-ground-blend': 0.05
            }
        };
    }

    var POLAND_CENTER = [19.4, 51.9];
    var INITIAL_ZOOM  = 6.2;
    var INITIAL_PITCH = 55;
    var INITIAL_BEARING = -15;

    // ─── State ───────────────────────────────────────
    var map = null;
    var markers = [];
    var activeCity = null;
    var currentFilter = 'all';
    var currentSort = 'population';
    var currentStyle = 'light';
    var is3D = true;
    var currentLang = 'ru';
    var currentNav = 'map';
    var isRotating = false;
    var rotationFrameId = null;

    // ─── Helpers ─────────────────────────────────────
    function qs(sel) { return document.querySelector(sel); }
    function qsa(sel) { return document.querySelectorAll(sel); }
    
    function fmt(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
        return String(n);
    }
    
    function fmtFull(n) { return n.toLocaleString('ru-RU'); }

    function throttleRAF(callback) {
        var lastTime = 0;
        var throttleTime = 1000 / CONFIG.FPS_THROTTLE;
        return function() {
            var now = performance.now();
            if (now - lastTime >= throttleTime) {
                lastTime = now;
                callback.apply(this, arguments);
            }
        };
    }

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

    function setLoading(pct) { 
        var bar = qs('#loadingBar');
        if (bar) bar.style.width = pct + '%'; 
    }
    
    function hideLoading() {
        setLoading(100);
        setTimeout(function () { 
            var screen = qs('#loadingScreen');
            if (screen) screen.classList.add('loading-screen--hidden'); 
        }, 400);
    }

    // ─── Filtering ───────────────────────────────────
    function getFilteredCities() {
        var cities = window.CITIES_DATA ? window.CITIES_DATA.slice() : [];
        if (currentFilter !== 'all') {
            cities = cities.filter(function (c) { return c.category === currentFilter; });
        }
        var q = (qs('#searchInput')?.value || '').toLowerCase().trim();
        if (q) {
            cities = cities.filter(function (c) {
                return (c.name?.toLowerCase().indexOf(q) !== -1) ||
                       (c.nameLocal?.toLowerCase().indexOf(q) !== -1) ||
                       (c.voivodeship?.toLowerCase().indexOf(q) !== -1);
            });
        }
        if (currentSort === 'population') cities.sort(function (a, b) { return b.population - a.population; });
        else if (currentSort === 'name') cities.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
        else if (currentSort === 'area') cities.sort(function (a, b) { return b.area - a.area; });
        return cities;
    }

    function getStyleForMode(mode) {
        if (mode === 'light') return OFM_LIBERTY;
        if (mode === 'satellite') return buildSatelliteStyle();
        return OFM_LIBERTY;
    }

    // ─── 360° Rotation Implementation ─────────────────
    function enableFullRotation() {
        if (!CONFIG.ENABLE_360_ROTATION) return;
        
        var isDragging = false;
        var lastX = 0;
        
        map.on('mousedown', function(e) {
            if (e.originalEvent.button === 1 || e.originalEvent.button === 2) {
                e.preventDefault();
                isDragging = true;
                lastX = e.point.x;
                if (rotationFrameId) {
                    cancelAnimationFrame(rotationFrameId);
                    rotationFrameId = null;
                    isRotating = false;
                }
            }
        });

        map.on('mousemove', throttleRAF(function(e) {
            if (isDragging) {
                var delta = e.point.x - lastX;
                var newBearing = (map.getBearing() + delta * CONFIG.ROTATION_SPEED) % 360;
                map.setBearing(newBearing);
                lastX = e.point.x;
            }
        }));

        map.on('mouseup', function() {
            isDragging = false;
        });

        // Auto-rotation on Space key
        document.addEventListener('keydown', function(e) {
            if (e.code === 'Space' && document.activeElement !== qs('#searchInput')) {
                e.preventDefault();
                toggleAutoRotation();
            }
        });
    }

    function toggleAutoRotation() {
        if (rotationFrameId) {
            cancelAnimationFrame(rotationFrameId);
            rotationFrameId = null;
            isRotating = false;
            return;
        }
        
        isRotating = true;
        var rotationSpeed = 0.15;
        var lastTimestamp = null;
        
        function rotateFrame(timestamp) {
            if (!isRotating) return;
            if (lastTimestamp) {
                var delta = Math.min(timestamp - lastTimestamp, 100) / 1000;
                var newBearing = (map.getBearing() + rotationSpeed * delta * 30) % 360;
                map.setBearing(newBearing);
            }
            lastTimestamp = timestamp;
            rotationFrameId = requestAnimationFrame(rotateFrame);
        }
        
        rotationFrameId = requestAnimationFrame(rotateFrame);
    }

    // ─── Optimized 3D Buildings ──────────────────────
    function addOptimized3DBuildings() {
        if (map.getLayer('3d-buildings-optimized')) return;
        
        var srcName = getVectorSourceName();
        
        var checkBuildings = function() {
            try {
                map.addLayer({
                    id: '3d-buildings-optimized',
                    source: srcName,
                    'source-layer': 'building',
                    type: 'fill-extrusion',
                    minzoom: CONFIG.BUILDINGS_MIN_ZOOM,
                    maxzoom: 18,
                    filter: [
                        'all',
                        ['!=', ['get', 'hide_3d'], true],
                        ['<=', ['get', 'render_height'], CONFIG.MAX_BUILDING_HEIGHT]
                    ],
                    paint: {
                        'fill-extrusion-color': [
                            'interpolate', ['linear'], ['get', 'render_height'],
                            0, '#d4cfc4',
                            30, '#ddd8cc',
                            60, '#e6e0d4',
                            100, '#efe8dc'
                        ],
                        'fill-extrusion-height': [
                            'interpolate', ['linear'], ['zoom'],
                            14, ['min', ['get', 'render_height'], 15],
                            15, ['min', ['get', 'render_height'], 30],
                            16, ['min', ['get', 'render_height'], 60],
                            17, ['get', 'render_height']
                        ],
                        'fill-extrusion-base': ['get', 'render_min_height'],
                        'fill-extrusion-opacity': CONFIG.BUILDING_OPACITY,
                        'fill-extrusion-vertical-gradient': false
                    }
                }, getFirstSymbolLayer());
            } catch(e) {
                console.warn('3D buildings not available:', e);
            }
        };
        
        if (map.loaded()) {
            checkBuildings();
        } else {
            map.once('load', checkBuildings);
        }
    }

    // ─── Building Highlights (like Luna) ─────────────
    function addBuildingHighlights() {
        if (!window.CITIES_DATA) return;
        if (map.getSource('city-areas')) return;
        
        var cityPoints = window.CITIES_DATA.map(function(city) {
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: city.coordinates },
                properties: { name: city.name, radius: 3500 }
            };
        });
        
        try {
            map.addSource('city-areas', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: cityPoints
                }
            });
            
            map.addLayer({
                id: 'city-glow',
                type: 'circle',
                source: 'city-areas',
                paint: {
                    'circle-radius': ['get', 'radius'],
                    'circle-color': '#FFAA44',
                    'circle-opacity': 0.15,
                    'circle-blur': 0.9
                },
                minzoom: 11
            });
        } catch(e) {
            console.warn('Building highlights not available:', e);
        }
    }

    // ─── Performance Optimizations ───────────────────
    function optimizeTileCache() {
        if (!map || !CONFIG.ENABLE_PERFORMANCE_MODE) return;
        
        setInterval(function() {
            if (map && map.style && map.style._tiles) {
                var tiles = map.style._tiles;
                var tilesCount = Object.keys(tiles || {}).length;
                if (tilesCount > CONFIG.MAX_TILE_CACHE_SIZE) {
                    var toRemove = [];
                    for (var id in tiles) {
                        if (tiles[id] && tiles[id].timeAdded && 
                            (Date.now() - tiles[id].timeAdded > CONFIG.TILE_CACHE_CLEAN_INTERVAL)) {
                            toRemove.push(id);
                        }
                    }
                    toRemove.forEach(function(id) {
                        if (map.style._tiles[id]) {
                            delete map.style._tiles[id];
                        }
                    });
                }
            }
        }, CONFIG.TILE_CACHE_CLEAN_INTERVAL);
    }

    // ─── Virtualized Markers ─────────────────────────
    function syncMarkers() {
        clearMarkers();
        var cities = getFilteredCities();
        var currentZoom = map.getZoom();
        
        if (currentZoom < 7) return;
        
        var maxMarkers = currentZoom < 9 ? 10 : (currentZoom < 11 ? 20 : 40);
        var citiesToShow = cities.slice(0, maxMarkers);
        
        citiesToShow.forEach(function (city) {
            var el = document.createElement('div');
            el.className = 'marker';
            el.style.willChange = 'transform';
            
            var isCapital = city.category === 'capital';
            var dot = document.createElement('div');
            dot.className = 'marker__dot' + (isCapital ? ' marker__dot--capital' : '');
            dot.style.backgroundColor = city.color;
            dot.style.border = '2px solid white';
            dot.style.boxShadow = '0 0 8px ' + city.color;

            var label = document.createElement('span');
            label.className = 'marker__label' + (isCapital ? ' marker__label--capital' : '');
            label.textContent = currentLang === 'pl' ? city.nameLocal : city.name;
            if (isCapital) { 
                label.style.background = city.color; 
                label.style.color = 'white';
                label.style.borderColor = city.color; 
            } else {
                label.style.backgroundColor = 'white';
                label.style.color = '#333';
            }

            el.appendChild(dot);
            el.appendChild(label);
            el.addEventListener('click', function (e) { 
                e.stopPropagation(); 
                selectCity(city); 
            });

            var m = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat(city.coordinates).addTo(map);
            markers.push(m);
        });
    }
    
    function clearMarkers() { 
        markers.forEach(function (m) { m.remove(); }); 
        markers.length = 0; 
    }

    // ─── Map Initialization ──────────────────────────
    function initMap() {
        setLoading(20);
        
        var mapOptions = {
            container: 'map',
            style: OFM_LIBERTY,
            center: POLAND_CENTER,
            zoom: INITIAL_ZOOM,
            pitch: INITIAL_PITCH,
            bearing: INITIAL_BEARING,
            antialias: !CONFIG.ENABLE_PERFORMANCE_MODE,
            maxBounds: [[10, 47], [28, 57]],
            minZoom: 4,
            maxZoom: CONFIG.ENABLE_PERFORMANCE_MODE ? 17 : 18,
            maxPitch: 75,
            fadeDuration: 0,
            trackResize: true
        };
        
        if (CONFIG.ENABLE_PERFORMANCE_MODE) {
            mapOptions.preserveDrawingBuffer = false;
            mapOptions.failIfMajorPerformanceCaveat = false;
            mapOptions.pixelRatio = window.devicePixelRatio > 1 ? 1 : 1;
        } else {
            mapOptions.canvasContextAttributes = { antialias: true };
        }
        
        map = new maplibregl.Map(mapOptions);
        setLoading(40);

        map.on('load', function () {
            setLoading(60);
            onStyleReady();
            setLoading(95);
            hideLoading();
            animateStats();
            startRotateAnimation();
            optimizeTileCache();
        });

        map.on('error', function (e) {
            console.warn('Map error:', e.error || e);
            hideLoading();
        });
    }

    function onStyleReady() {
        ensureTerrain();
        addBorder();
        addOptimized3DBuildings();
        addHeatCircles();
        addBuildingHighlights();
        syncMarkers();
        enableFullRotation();
        fixCrookedModels();
        
        // Update markers on zoom/move
        map.on('moveend', throttleRAF(function() {
            syncMarkers();
        }));
        
        // Performance mode: reduce opacity during movement
        if (CONFIG.ENABLE_PERFORMANCE_MODE) {
            var moveTimeout;
            map.on('movestart', function() {
                if (map.getLayer('3d-buildings-optimized')) {
                    map.setPaintProperty('3d-buildings-optimized', 'fill-extrusion-opacity', 0.3);
                }
                if (moveTimeout) clearTimeout(moveTimeout);
            });
            
            map.on('moveend', function() {
                moveTimeout = setTimeout(function() {
                    if (map.getLayer('3d-buildings-optimized')) {
                        map.setPaintProperty('3d-buildings-optimized', 'fill-extrusion-opacity', CONFIG.BUILDING_OPACITY);
                    }
                }, 500);
            });
        }
    }

    function ensureTerrain() {
        if (!map.getSource('terrainSource')) {
            map.addSource('terrainSource', {
                type: 'raster-dem', url: TERRAIN_URL, tileSize: 256
            });
        }
        if (!map.getSource('hillshadeSource')) {
            map.addSource('hillshadeSource', {
                type: 'raster-dem', url: TERRAIN_URL, tileSize: 256
            });
        }
        if (!map.getLayer('custom-hillshade')) {
            var before = getFirstSymbolLayer();
            map.addLayer({
                id: 'custom-hillshade', type: 'hillshade', source: 'hillshadeSource',
                paint: {
                    'hillshade-shadow-color': '#473B24',
                    'hillshade-highlight-color': '#ffffff',
                    'hillshade-accent-color': '#5a5a5a',
                    'hillshade-exaggeration': 0.4
                }
            }, before);
        }
        if (is3D) {
            try { map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 }); } catch (e) {}
        }
        
        var isSat = (currentStyle === 'satellite');
        try {
            map.setSky(isSat ? {
                'sky-color': '#87CEEB',
                'sky-horizon-blend': 0.4,
                'horizon-color': '#b0d4f8',
                'horizon-fog-blend': 0.6,
                'fog-color': '#d4e8f8',
                'fog-ground-blend': 0.05
            } : {
                'sky-color': '#9fc8e8',
                'sky-horizon-blend': 0.4,
                'horizon-color': '#d0e4f4',
                'horizon-fog-blend': 0.5,
                'fog-color': '#e8f0f8',
                'fog-ground-blend': 0.05
            });
        } catch (e) {}
    }

    function addBorder() {
        if (!window.POLAND_BORDER) return;
        if (map.getSource('pl-border')) return;
        map.addSource('pl-border', { type: 'geojson', data: window.POLAND_BORDER });
        map.addLayer({
            id: 'pl-fill', type: 'fill', source: 'pl-border',
            paint: { 'fill-color': '#E63946', 'fill-opacity': 0.05 }
        });
        map.addLayer({
            id: 'pl-line', type: 'line', source: 'pl-border',
            paint: { 'line-color': '#E63946', 'line-width': 2.5, 'line-opacity': 0.7 }
        });
    }

    function getFirstSymbolLayer() {
        var layers = map.getStyle().layers || [];
        for (var i = 0; i < layers.length; i++) {
            if (layers[i].type === 'symbol') return layers[i].id;
        }
        return undefined;
    }

    function getVectorSourceName() {
        var sources = map.getStyle().sources;
        if (sources['openmaptiles'] && sources['openmaptiles'].type === 'vector') return 'openmaptiles';
        if (sources['openfreemap'] && sources['openfreemap'].type === 'vector') return 'openfreemap';
        var keys = Object.keys(sources);
        for (var i = 0; i < keys.length; i++) {
            if (sources[keys[i]].type === 'vector') return keys[i];
        }
        return 'openmaptiles';
    }

    function addHeatCircles() {
        if (!window.CITIES_DATA) return;
        if (map.getSource('heat')) return;
        var fc = {
            type: 'FeatureCollection',
            features: window.CITIES_DATA.map(function (c) {
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: c.coordinates },
                    properties: { population: c.population }
                };
            })
        };
        map.addSource('heat', { type: 'geojson', data: fc });
        map.addLayer({
            id: 'heat-glow', type: 'circle', source: 'heat',
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['get', 'population'],
                    100000, 18, 500000, 32, 1000000, 45, 2000000, 65],
                'circle-color': '#E63946',
                'circle-opacity': 0.08,
                'circle-blur': 1
            }
        });
    }

    function fixCrookedModels() {
        map.on('sourcedata', throttleRAF(function(e) {
            if (e.sourceId === getVectorSourceName() && e.sourceLayer === 'building') {
                try {
                    if (map.style && map.style._tiles) {
                        Object.keys(map.style._tiles).forEach(function(tileId) {
                            var tile = map.style._tiles[tileId];
                            if (tile && tile.data && (!tile.data.layers || tile.data.layers.length === 0)) {
                                delete map.style._tiles[tileId];
                            }
                        });
                    }
                } catch(err) {
                    console.warn('Error fixing models:', err);
                }
            }
        }));
    }

    var rotateAnimId = null;
    function startRotateAnimation() {
        var startBearing = map.getBearing();
        var startTime = performance.now();
        var duration = 6000;
        var targetBearing = startBearing + 25;
        function animate(now) {
            var p = Math.min((now - startTime) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            map.setBearing(startBearing + (targetBearing - startBearing) * eased);
            if (p < 1) { rotateAnimId = requestAnimationFrame(animate); }
            else { rotateAnimId = null; }
        }
        rotateAnimId = requestAnimationFrame(animate);
        map.once('mousedown', function () { if (rotateAnimId) { cancelAnimationFrame(rotateAnimId); rotateAnimId = null; } });
        map.once('touchstart', function () { if (rotateAnimId) { cancelAnimationFrame(rotateAnimId); rotateAnimId = null; } });
    }

    function removeCustomLayers() {
        ['3d-buildings-optimized', '3d-buildings', 'custom-hillshade', 'heat-glow', 'pl-line', 'pl-fill', 'city-glow', 'building-highlight'].forEach(function (id) {
            try { if (map.getLayer(id)) map.removeLayer(id); } catch (e) {}
        });
        ['heat', 'pl-border', 'terrainSource', 'hillshadeSource', 'city-areas'].forEach(function (id) {
            try { if (map.getSource(id)) map.removeSource(id); } catch (e) {}
        });
    }

    function selectCity(city) {
        if (!city) return;
        activeCity = city;
        if (rotateAnimId) { cancelAnimationFrame(rotateAnimId); rotateAnimId = null; }

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

        var popup = qs('#cityPopup');
        if (popup) popup.classList.add('city-popup--visible');

        var cards = qsa('.city-card');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            if (+card.dataset.id === city.id) {
                card.classList.add('city-card--active');
            } else {
                card.classList.remove('city-card--active');
            }
        }
        
        var ac = qs('.city-card[data-id="' + city.id + '"]');
        if (ac) ac.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        flyToOptimized(city);
    }

    function flyToOptimized(city) {
        if (!map || !city) return;
        var zoom = city.category === 'capital' ? 12.5 : 11.5;
        map.flyTo({
            center: city.coordinates,
            zoom: zoom,
            pitch: is3D ? 55 : 0,
            bearing: is3D ? 25 : 0,
            duration: 1500,
            essential: true
        });
    }

    function closePopup() {
        var popup = qs('#cityPopup');
        if (popup) popup.classList.remove('city-popup--visible');
        activeCity = null;
        var cards = qsa('.city-card');
        for (var i = 0; i < cards.length; i++) {
            cards[i].classList.remove('city-card--active');
        }
    }

    function renderCityList() {
        var $list = qs('#cityList');
        if (!$list) return;
        
        var cities = getFilteredCities();

        if (!cities.length) {
            $list.innerHTML = '<div class="empty-state"><p class="empty-state__title">Ничего не найдено</p><p class="empty-state__sub">Попробуйте изменить запрос</p></div>';
            var totalEl = qs('#totalCities');
            if (totalEl) totalEl.textContent = '0';
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
        var totalEl = qs('#totalCities');
        if (totalEl) totalEl.textContent = cities.length;
    }

    function animateStats() {
        if (!window.CITIES_DATA) return;
        var tp = window.CITIES_DATA.reduce(function (s, c) { return s + c.population; }, 0);
        var totalEl = qs('#totalCities');
        var popEl = qs('#totalPopulation');
        if (totalEl) animateValue(totalEl, window.CITIES_DATA.length, 600);
        if (popEl) animateValue(popEl, tp, 1000);
    }

    // ─── All Button Handlers ─────────────────────────
    function initAllHandlers() {
        var cityList = qs('#cityList');
        if (cityList) {
            cityList.addEventListener('click', function (e) {
                var card = e.target.closest('.city-card');
                if (!card) return;
                if (!window.CITIES_DATA) return;
                var city = window.CITIES_DATA.find(function (c) { return c.id === +card.dataset.id; });
                if (city) selectCity(city);
            });
        }

        var filterBtns = qsa('.filter-btn');
        for (var i = 0; i < filterBtns.length; i++) {
            filterBtns[i].addEventListener('click', function (btn) {
                return function() {
                    var btns = qsa('.filter-btn');
                    for (var j = 0; j < btns.length; j++) {
                        btns[j].classList.remove('filter-btn--active');
                    }
                    btn.classList.add('filter-btn--active');
                    currentFilter = btn.dataset.filter;
                    renderCityList();
                    syncMarkers();
                };
            }(filterBtns[i]));
        }

        var sortSelect = qs('#sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', function () {
                currentSort = this.value;
                renderCityList();
            });
        }

        var searchInput = qs('#searchInput');
        var searchTimer;
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(function () { renderCityList(); syncMarkers(); }, 300);
            });
        }

        var zoomIn = qs('#zoomIn');
        if (zoomIn) zoomIn.addEventListener('click', function () { map.zoomIn({ duration: 400 }); });
        
        var zoomOut = qs('#zoomOut');
        if (zoomOut) zoomOut.addEventListener('click', function () { map.zoomOut({ duration: 400 }); });

        var rotateBtn = qs('#rotateBtn');
        if (rotateBtn) {
            rotateBtn.addEventListener('click', function () {
                is3D = !is3D;
                if (is3D) {
                    map.easeTo({ pitch: 55, bearing: map.getBearing() - 15, duration: 1200 });
                    try { map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 }); } catch (e) {}
                } else {
                    map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
                    try { map.setTerrain(null); } catch (e) {}
                }
                this.style.color = is3D ? '#E63946' : '';
            });
        }

        var resetBtn = qs('#resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                closePopup();
                is3D = true;
                var rotate = qs('#rotateBtn');
                if (rotate) rotate.style.color = '';
                try { map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 }); } catch (e) {}
                map.flyTo({ center: POLAND_CENTER, zoom: INITIAL_ZOOM, pitch: INITIAL_PITCH, bearing: INITIAL_BEARING, duration: 2000 });
                renderCityList();
                syncMarkers();
            });
        }

        var styleBtns = qsa('.style-btn');
        for (var i = 0; i < styleBtns.length; i++) {
            styleBtns[i].addEventListener('click', function (btn) {
                return function() {
                    var s = btn.dataset.style;
                    if (s === currentStyle) return;
                    var btns = qsa('.style-btn');
                    for (var j = 0; j < btns.length; j++) {
                        btns[j].classList.remove('style-btn--active');
                    }
                    btn.classList.add('style-btn--active');
                    currentStyle = s;

                    var cam = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
                    removeCustomLayers();
                    clearMarkers();
                    map.setStyle(getStyleForMode(s));

                    map.once('style.load', function () {
                        map.jumpTo(cam);
                        onStyleReady();
                    });
                };
            }(styleBtns[i]));
        }

        var closePopupBtn = qs('#closePopup');
        if (closePopupBtn) closePopupBtn.addEventListener('click', function () { closePopup(); });
        
        var flyToCity = qs('#flyToCity');
        if (flyToCity) flyToCity.addEventListener('click', function () { if (activeCity) flyToOptimized(activeCity); });

        var langBtn = qs('#langBtn');
        if (langBtn) {
            langBtn.addEventListener('click', function () {
                currentLang = currentLang === 'ru' ? 'pl' : 'ru';
                var span = this.querySelector('span');
                if (span) span.textContent = currentLang.toUpperCase();
                renderCityList();
                syncMarkers();
            });
        }

        var navLinks = qsa('.nav__link');
        var navSections = ['map', 'cities', 'realty', 'analytics'];
        for (var i = 0; i < navLinks.length; i++) {
            navLinks[i].addEventListener('click', function(idx) {
                return function(e) {
                    e.preventDefault();
                    var links = qsa('.nav__link');
                    for (var j = 0; j < links.length; j++) {
                        links[j].classList.remove('nav__link--active');
                    }
                    navLinks[idx].classList.add('nav__link--active');
                    currentNav = navSections[idx] || 'map';
                    handleNavChange(currentNav);
                };
            }(i));
        }

        var logo = qs('.logo');
        if (logo) {
            logo.addEventListener('click', function (e) {
                e.preventDefault();
                var links = qsa('.nav__link');
                for (var i = 0; i < links.length; i++) {
                    links[i].classList.remove('nav__link--active');
                }
                var first = qs('.nav__link');
                if (first) first.classList.add('nav__link--active');
                currentNav = 'map';
                currentFilter = 'all';
                var filterBtns = qsa('.filter-btn');
                for (var i = 0; i < filterBtns.length; i++) {
                    filterBtns[i].classList.remove('filter-btn--active');
                }
                var allBtn = qs('.filter-btn[data-filter="all"]');
                if (allBtn) allBtn.classList.add('filter-btn--active');
                var search = qs('#searchInput');
                if (search) search.value = '';
                var sort = qs('#sortSelect');
                if (sort) sort.value = 'population';
                currentSort = 'population';
                closePopup();
                is3D = true;
                var rotate = qs('#rotateBtn');
                if (rotate) rotate.style.color = '';
                try { map.setTerrain({ source: 'terrainSource', exaggeration: 1.5 }); } catch (e) {}
                renderCityList();
                syncMarkers();
                map.flyTo({ center: POLAND_CENTER, zoom: INITIAL_ZOOM, pitch: INITIAL_PITCH, bearing: INITIAL_BEARING, duration: 2000 });
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closePopup(); if (searchInput) searchInput.blur(); }
            if (e.key === '/' && document.activeElement !== searchInput) { e.preventDefault(); if (searchInput) searchInput.focus(); }
        });

        if (map) map.on('click', function () { if (activeCity) closePopup(); });
    }

    function handleNavChange(section) {
        var filtersEl = qs('.sidebar__filters');
        var sortEl = qs('.sidebar__sort');
        var titleEl = qs('.sidebar__title');
        var subtitleEl = qs('.sidebar__subtitle');
        var cityList = qs('#cityList');

        if (!cityList) return;

        switch (section) {
            case 'map':
                if (titleEl) titleEl.textContent = 'Крупные города Польши';
                if (subtitleEl) subtitleEl.textContent = '3D карта — выберите город';
                if (filtersEl) filtersEl.style.display = '';
                if (sortEl) sortEl.style.display = '';
                currentFilter = 'all';
                var filterBtns = qsa('.filter-btn');
                for (var i = 0; i < filterBtns.length; i++) {
                    filterBtns[i].classList.remove('filter-btn--active');
                }
                var allBtn = qs('.filter-btn[data-filter="all"]');
                if (allBtn) allBtn.classList.add('filter-btn--active');
                renderCityList();
                syncMarkers();
                map.flyTo({ center: POLAND_CENTER, zoom: INITIAL_ZOOM, pitch: INITIAL_PITCH, bearing: INITIAL_BEARING, duration: 2000 });
                break;

            case 'cities':
                if (titleEl) titleEl.textContent = 'Все города';
                if (subtitleEl) subtitleEl.textContent = 'Список всех городов Польши';
                if (filtersEl) filtersEl.style.display = '';
                if (sortEl) sortEl.style.display = '';
                currentFilter = 'all';
                var filterBtns2 = qsa('.filter-btn');
                for (var i = 0; i < filterBtns2.length; i++) {
                    filterBtns2[i].classList.remove('filter-btn--active');
                }
                var allBtn2 = qs('.filter-btn[data-filter="all"]');
                if (allBtn2) allBtn2.classList.add('filter-btn--active');
                renderCityList();
                syncMarkers();
                break;

            case 'realty':
                if (titleEl) titleEl.textContent = 'Недвижимость';
                if (subtitleEl) subtitleEl.textContent = 'Обзор рынка недвижимости Польши';
                if (filtersEl) filtersEl.style.display = 'none';
                if (sortEl) sortEl.style.display = 'none';
                cityList.innerHTML = '<div class="empty-state"><p class="empty-state__title">🏠 Раздел в разработке</p><p class="empty-state__sub">Данные о недвижимости скоро появятся</p></div>';
                break;

            case 'analytics':
                if (!window.CITIES_DATA) break;
                if (titleEl) titleEl.textContent = 'Аналитика';
                if (subtitleEl) subtitleEl.textContent = 'Статистика и данные';
                if (filtersEl) filtersEl.style.display = 'none';
                if (sortEl) sortEl.style.display = 'none';
                var totalPop = window.CITIES_DATA.reduce(function (s, c) { return s + c.population; }, 0);
                var avgPop = Math.round(totalPop / window.CITIES_DATA.length);
                var biggest = window.CITIES_DATA.slice().sort(function (a, b) { return b.population - a.population; })[0];
                var smallest = window.CITIES_DATA.slice().sort(function (a, b) { return a.population - b.population; })[0];
                var totalArea = window.CITIES_DATA.reduce(function (s, c) { return s + c.area; }, 0);
                cityList.innerHTML = '<div style="padding:16px 8px;">' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;"><div class="stat-card__label">Общее население</div><div class="stat-card__value">' + fmtFull(totalPop) + '</div></div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;"><div class="stat-card__label">Среднее население города</div><div class="stat-card__value">' + fmtFull(avgPop) + '</div></div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;"><div class="stat-card__label">Крупнейший город</div><div class="stat-card__value" style="font-size:15px;">' + biggest.name + ' (' + fmtFull(biggest.population) + ')</div></div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;"><div class="stat-card__label">Наименьший город</div><div class="stat-card__value" style="font-size:15px;">' + smallest.name + ' (' + fmtFull(smallest.population) + ')</div></div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;"><div class="stat-card__label">Общая площадь городов</div><div class="stat-card__value">' + fmtFull(Math.round(totalArea)) + ' км²</div></div>' +
                    '<div class="stat-card" style="margin-bottom:10px;padding:16px;text-align:left;"><div class="stat-card__label">Количество городов</div><div class="stat-card__value">' + window.CITIES_DATA.length + '</div></div>' +
                    '</div>';
                break;
        }
    }

    // ─── Boot ────────────────────────────────────────
    function boot() {
        if (typeof maplibregl === 'undefined') {
            console.error('MapLibre GL not loaded');
            return;
        }
        setLoading(10);
        initMap();
        renderCityList();
        if (map) map.on('load', function () { initAllHandlers(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
