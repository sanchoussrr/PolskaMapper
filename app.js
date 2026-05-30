// =====================================================
// PolskaMapper — White Map (3D Buildings + 360°)
// =====================================================

(function () {
    'use strict';

    var CONFIG = {
        MAX_TILE_CACHE_SIZE: 200,
        TILE_CACHE_CLEAN_INTERVAL: 60000,
        FPS_THROTTLE: 60,
        BUILDINGS_MIN_ZOOM: 14,
        MAX_BUILDING_HEIGHT: 100,
        BUILDING_OPACITY: 0.9,
        ROTATION_SPEED: 0.3,
        ENABLE_360_ROTATION: true,
        ENABLE_PERFORMANCE_MODE: true
    };

    var OFM_LIBERTY = 'https://tiles.openfreemap.org/styles/liberty';
    var TERRAIN_URL = 'https://demotiles.maplibre.org/terrain-tiles/tiles.json';

    var POLAND_CENTER = [19.4, 51.9];
    var INITIAL_ZOOM  = 6.2;
    var INITIAL_PITCH = 55;
    var INITIAL_BEARING = -15;

    var map = null;
    var isRotating = false;
    var rotationFrameId = null;

    function qs(sel) { return document.querySelector(sel); }

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

    // ─── 360° Rotation ─────────────────
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

        document.addEventListener('keydown', function(e) {
            if (e.code === 'Space') {
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

    // ─── High-Quality 3D Buildings ─────────────────
    function add3DBuildings() {
        if (map.getLayer('3d-buildings')) return;
        
        var srcName = getVectorSourceName();
        
        var checkBuildings = function() {
            try {
                map.addLayer({
                    id: '3d-buildings',
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
                            0, '#e8e4d8',
                            30, '#ddd8cc',
                            60, '#d4cec0',
                            100, '#c8c2b4'
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
                        'fill-extrusion-vertical-gradient': true
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

    // ─── Map Initialization ─────────────────────────
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
            mapOptions.pixelRatio = Math.min(window.devicePixelRatio, 2);
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
            optimizeTileCache();
        });

        map.on('error', function (e) {
            console.warn('Map error:', e.error || e);
            hideLoading();
        });
    }

    function onStyleReady() {
        add3DBuildings();
        enableFullRotation();
        fixCrookedModels();
        
        if (CONFIG.ENABLE_PERFORMANCE_MODE) {
            var moveTimeout;
            map.on('movestart', function() {
                if (map.getLayer('3d-buildings')) {
                    map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', 0.4);
                }
                if (moveTimeout) clearTimeout(moveTimeout);
            });
            
            map.on('moveend', function() {
                moveTimeout = setTimeout(function() {
                    if (map.getLayer('3d-buildings')) {
                        map.setPaintProperty('3d-buildings', 'fill-extrusion-opacity', CONFIG.BUILDING_OPACITY);
                    }
                }, 500);
            });
        }
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

    // ─── Boot ────────────────────────────────────────
    function boot() {
        if (typeof maplibregl === 'undefined') {
            console.error('MapLibre GL not loaded');
            return;
        }
        setLoading(10);
        initMap();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
