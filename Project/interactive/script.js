// Build the map only after the HTML structure is ready.
document.addEventListener("DOMContentLoaded", function () {
    // Read the Python-compiled dashboard payload.
    const CD = window.CHART_DATA;

    if (!CD) {
        console.error("window.CHART_DATA is missing. Run the compile step first.");
        return;
    }

    // Use Python-provided map settings, but keep safe fallbacks
    // so the dashboard still works during early prototyping.
    const mapConfig = CD.map || {};
    const mapCenter = mapConfig.center || [37.5665, 126.9780];
    const mapZoom = mapConfig.zoom || 11;

    // This LOD configuration controls which GeoJSON layer appears
    // at each zoom level.
    const lodConfig = mapConfig.lod || {
        seoul: {
            minZoom: 0,
            maxZoom: 10,
            path: "data/seoul.geojson",
            label: "Seoul",
            featureLabelKey: "SIDO_NM"
        },
        gu: {
            minZoom: 11,
            maxZoom: 13,
            path: "data/seoul_gu.geojson",
            label: "Gu",
            featureLabelKey: "ADM_NM"
        },
        dong: {
            minZoom: 14,
            maxZoom: 16,
            path: "data/seoul_dong.geojson",
            label: "Dong",
            featureLabelKey: "ADM_NM"
        },
        station: {
            minZoom: 17,
            maxZoom: 22,
            path: "data/station.geojson",
            label: "Station",
            featureLabelKey: "stationID"
        }
    };

    // Keep a small registry so each GeoJSON file is fetched only once.
    const layerRegistry = {
        seoul: { layer: null, loaded: false },
        gu: { layer: null, loaded: false },
        dong: { layer: null, loaded: false },
        station: { layer: null, loaded: false }
    };

    // Create the Leaflet map and add a light basemap from CARTO.
    const map = L.map("map").setView(mapCenter, mapZoom);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 20
    }).addTo(map);

    // Load the outer Seoul boundary first so the initial extent feels correct.
    initializeMap().then(function () {
        updateVisibleLayer();
        setTimeout(function () {
            map.invalidateSize();
        }, 0);
    });

    // Re-evaluate the visible layer whenever the user changes zoom.
    map.on("zoomend", updateVisibleLayer);

    async function initializeMap() {
        await ensureLayerLoaded("seoul");

        const seoulLayer = layerRegistry.seoul.layer;
        if (seoulLayer && seoulLayer.getBounds && seoulLayer.getBounds().isValid()) {
            map.fitBounds(seoulLayer.getBounds());
        }
    }

    // Resolve the active detail level from the current Leaflet zoom.
    function getActiveLevelName() {
        const zoom = map.getZoom();

        if (zoom <= lodConfig.seoul.maxZoom) {
            return "seoul";
        }
        if (zoom <= lodConfig.gu.maxZoom) {
            return "gu";
        }
        if (zoom <= lodConfig.dong.maxZoom) {
            return "dong";
        }
        return "station";
    }

    // Fetch and build a GeoJSON layer only once.
    async function ensureLayerLoaded(levelName) {
        const registryEntry = layerRegistry[levelName];
        const levelConfig = lodConfig[levelName];

        if (!registryEntry || registryEntry.loaded) {
            return;
        }

        const response = await fetch(levelConfig.path);
        const geojsonData = await response.json();

        if (levelName === "station") {
            registryEntry.layer = L.geoJSON(geojsonData, {
                pointToLayer: function (feature, latlng) {
                    return L.circleMarker(latlng, {
                        radius: 4,
                        color: "#14532d",
                        weight: 1,
                        fillColor: "#22c55e",
                        fillOpacity: 0.85
                    });
                },
                onEachFeature: function (feature, layer) {
                    const props = feature.properties || {};
                    const label = props[levelConfig.featureLabelKey] || "Station";
                    layer.bindTooltip(String(label));
                }
            });
        } else {
            registryEntry.layer = L.geoJSON(geojsonData, {
                style: function () {
                    return getPolygonStyle(levelName);
                },
                onEachFeature: function (feature, layer) {
                    const props = feature.properties || {};
                    const label = props[levelConfig.featureLabelKey] || levelConfig.label;
                    layer.bindTooltip(String(label), {
                        sticky: true
                    });
                }
            });
        }

        registryEntry.loaded = true;
    }

    // Give each administrative level a different visual style.
    function getPolygonStyle(levelName) {
        if (levelName === "seoul") {
            return {
                color: "#ef4444",
                weight: 2,
                fillColor: "#ef4444",
                fillOpacity: 0.05
            };
        }

        if (levelName === "gu") {
            return {
                color: "#1d4ed8",
                weight: 1.3,
                fillColor: "#60a5fa",
                fillOpacity: 0.05
            };
        }

        return {
            color: "#0f766e",
            weight: 1,
            fillColor: "#2dd4bf",
            fillOpacity: 0.05
        };
    }

    // Remove every LOD layer from the map before adding the active one.
    function clearLodLayers() {
        Object.keys(layerRegistry).forEach(function (levelName) {
            const entry = layerRegistry[levelName];
            if (entry.layer && map.hasLayer(entry.layer)) {
                map.removeLayer(entry.layer);
            }
        });
    }

    // Show only the GeoJSON layer that matches the current zoom level.
    async function updateVisibleLayer() {
        const activeLevelName = getActiveLevelName();

        try {
            await ensureLayerLoaded(activeLevelName);
        } catch (error) {
            console.error("Failed to load LOD layer:", activeLevelName, error);
            return;
        }

        clearLodLayers();

        const activeLayer = layerRegistry[activeLevelName].layer;
        if (activeLayer) {
            activeLayer.addTo(map);
            if (activeLayer.bringToFront) {
                activeLayer.bringToFront();
            }
        }
    }
});
