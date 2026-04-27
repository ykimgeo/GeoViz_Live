import {Deck} from '@deck.gl/core';
import {BitmapLayer, GeoJsonLayer, ScatterplotLayer} from '@deck.gl/layers';
import {TileLayer} from '@deck.gl/geo-layers';
import {FlowmapLayer} from '@flowmap.gl/layers';

(function () {
  var config = window.DASHBOARD_CONFIG;
  var state = Object.assign({}, config.defaultFilters, {
    selectedPlace: null,
    selectedRouteKey: null,
    records: [],
    filteredRecords: [],
    visibleFlowCount: 0,
    visibleFlowTotal: 0,
    placeTotals: new Map(),
    geometries: {},
    manifest: null,
    deck: null,
    tooltip: null
  });

  var CARTO_TILE_URL = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png';

  var els = {
    level: document.getElementById('level-filter'),
    month: document.getElementById('month-filter'),
    weekday: document.getElementById('weekday-filter'),
    hour: document.getElementById('hour-filter'),
    flowPercent: document.getElementById('flow-percent-filter'),
    flowPercentValue: document.getElementById('flow-percent-value'),
    reset: document.getElementById('reset-filters'),
    selectedPlace: document.getElementById('selected-place'),
    selectedDetail: document.getElementById('selected-detail'),
    mapStatus: document.getElementById('map-status'),
    chartStatus: document.getElementById('chart-status'),
    summaryStatus: document.getElementById('summary-status'),
    headerTrips: document.getElementById('header-trips'),
    headerRoutes: document.getElementById('header-routes'),
    statTrips: document.getElementById('stat-trips'),
    statRoutes: document.getElementById('stat-routes'),
    statDuration: document.getElementById('stat-duration'),
    statDistance: document.getElementById('stat-distance'),
    chart: document.getElementById('bar-chart'),
    routeList: document.getElementById('route-list'),
    legend: document.getElementById('map-legend'),
    map: document.getElementById('map')
  };

  function initDeck() {
    state.tooltip = document.createElement('div');
    state.tooltip.className = 'deck-tooltip';
    state.tooltip.style.display = 'none';
    els.map.appendChild(state.tooltip);

    state.deck = new Deck({
      parent: els.map,
      initialViewState: {
        longitude: 126.978,
        latitude: 37.5665,
        zoom: 10.6,
        pitch: 0,
        bearing: 0
      },
      controller: true,
      layers: []
    });
  }

  function fmtNumber(value) {
    return Math.round(value || 0).toLocaleString('en-US');
  }

  function fmtDecimal(value, digits) {
    if (!Number.isFinite(value)) return '--';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function getFields() {
    var levelConfig = state.manifest.levels[state.level];
    return {
      origin: levelConfig.originField,
      dest: levelConfig.destField
    };
  }

  function buildFlowPath() {
    var levelConfig = state.manifest.levels[state.level];
    if (state.month === 'all' && state.weekday_type === 'all' && state.hour === 'all') {
      return levelConfig.defaultPath;
    }
    return state.manifest.pathTemplate
      .replace('{level}', state.level)
      .replace('{month}', state.month)
      .replace('{weekday_type}', state.weekday_type)
      .replace('{hour}', state.hour);
  }

  function fetchJson(path) {
    return fetch(path).then(function (response) {
      if (!response.ok) throw new Error('Could not load ' + path);
      return response.json();
    });
  }

  function walkCoordinates(coords, points) {
    if (typeof coords[0] === 'number') {
      points.push(coords);
      return;
    }
    coords.forEach(function (child) {
      walkCoordinates(child, points);
    });
  }

  function getFeatureCenter(feature) {
    if (feature.geometry.type === 'Point') {
      return {
        lon: feature.geometry.coordinates[0],
        lat: feature.geometry.coordinates[1]
      };
    }

    var points = [];
    walkCoordinates(feature.geometry.coordinates, points);
    var bounds = points.reduce(function (acc, point) {
      return {
        minLon: Math.min(acc.minLon, point[0]),
        maxLon: Math.max(acc.maxLon, point[0]),
        minLat: Math.min(acc.minLat, point[1]),
        maxLat: Math.max(acc.maxLat, point[1])
      };
    }, {
      minLon: Infinity,
      maxLon: -Infinity,
      minLat: Infinity,
      maxLat: -Infinity
    });

    return {
      lon: (bounds.minLon + bounds.maxLon) / 2,
      lat: (bounds.minLat + bounds.maxLat) / 2
    };
  }

  function averageCenters(centers) {
    var total = centers.reduce(function (acc, center) {
      acc.lat += center.lat;
      acc.lon += center.lon;
      return acc;
    }, { lat: 0, lon: 0 });
    return {
      lat: total.lat / centers.length,
      lon: total.lon / centers.length
    };
  }

  function cacheGeojson(level, data) {
    var byId = {};
    data.features.forEach(function (feature) {
      var id = feature.properties[config.geoIdFields[level]];
      if (!id) return;
      if (!byId[id]) {
        byId[id] = {
          id: id,
          features: [],
          centers: []
        };
      }
      byId[id].features.push(feature);
      byId[id].centers.push(getFeatureCenter(feature));
    });
    Object.keys(byId).forEach(function (id) {
      byId[id].center = averageCenters(byId[id].centers);
    });
    state.geometries[level] = {
      raw: data,
      byId: byId
    };
  }

  function ensureGeojson() {
    if (state.geometries[state.level]) return Promise.resolve();
    return fetchJson(config.geojson[state.level]).then(function (geojson) {
      cacheGeojson(state.level, geojson);
    });
  }

  function ensureGuContextGeojson() {
    if (state.geometries.gu) return Promise.resolve();
    return fetchJson(config.geojson.gu).then(function (geojson) {
      cacheGeojson('gu', geojson);
    });
  }

  function selectPlace(placeId) {
    state.selectedPlace = state.selectedPlace === placeId ? null : placeId;
    state.selectedRouteKey = null;
    updateViews();
  }

  function selectRoute(record) {
    var fields = getFields();
    state.selectedRouteKey = record[fields.origin] + '|' + record[fields.dest];
    state.selectedPlace = null;
    updateViews();
  }

  function clearSelection() {
    if (!state.selectedPlace && !state.selectedRouteKey) return;
    state.selectedPlace = null;
    state.selectedRouteKey = null;
    updateViews();
  }

  function filterForSelection(records) {
    var fields = getFields();
    if (state.selectedRouteKey) {
      return records.filter(function (record) {
        return record[fields.origin] + '|' + record[fields.dest] === state.selectedRouteKey;
      });
    }
    if (!state.selectedPlace) return records;
    return records.filter(function (record) {
      return record[fields.origin] === state.selectedPlace || record[fields.dest] === state.selectedPlace;
    });
  }

  function summarize(records) {
    var totals = records.reduce(function (acc, record) {
      acc.trips += record.trip_count || 0;
      acc.minutes += record.sum_use_min || 0;
      acc.distance += record.sum_use_dst || 0;
      return acc;
    }, { trips: 0, minutes: 0, distance: 0 });

    return {
      trips: totals.trips,
      routes: records.length,
      avgDuration: totals.trips ? totals.minutes / totals.trips : 0,
      avgDistance: totals.trips ? totals.distance / totals.trips : 0
    };
  }

  function makePlaceTotals(records) {
    var fields = getFields();
    var totals = new Map();
    records.forEach(function (record) {
      var origin = record[fields.origin];
      var dest = record[fields.dest];
      var trips = record.trip_count || 0;
      totals.set(origin, (totals.get(origin) || 0) + trips);
      if (dest !== origin) totals.set(dest, (totals.get(dest) || 0) + trips);
    });
    return totals;
  }

  function colorFor(value, max) {
    if (!max) return [219, 234, 254, 155];
    var t = Math.max(0, Math.min(1, value / max));
    if (t < 0.35) return [191, 219, 254, 170];
    if (t < 0.65) return [96, 165, 250, 185];
    if (t < 0.86) return [37, 99, 235, 205];
    return [30, 64, 175, 225];
  }

  function getVisibleFlowRecords(records) {
    var sortedRecords = records.slice().sort(function (a, b) {
      return b.trip_count - a.trip_count;
    });
    var visibleCount = sortedRecords.length
      ? Math.max(1, Math.ceil(sortedRecords.length * state.flowPercent / 100))
      : 0;
    state.visibleFlowTotal = sortedRecords.length;
    state.visibleFlowCount = visibleCount;
    return sortedRecords.slice(0, visibleCount);
  }

  function makeFlowData(records) {
    var fields = getFields();
    return records.map(function (record) {
      return {
        origin: record[fields.origin],
        dest: record[fields.dest],
        count: record.trip_count || 0,
        avgMin: record.avg_use_min || 0,
        avgDistance: record.avg_use_dst || 0,
        source: record
      };
    });
  }

  function makeLocations() {
    var geos = state.geometries[state.level].byId;
    return Object.keys(geos).map(function (id) {
      var item = geos[id];
      return {
        id: id,
        name: id,
        lat: item.center.lat,
        lon: item.center.lon,
        total: state.placeTotals.get(id) || 0
      };
    });
  }

  function makeGeoFeatures() {
    return state.geometries[state.level].raw.features;
  }

  function maxPlaceTotal() {
    return Math.max.apply(null, Array.from(state.placeTotals.values()).concat([0]));
  }

  function showTooltip(info, html) {
    if (!info || !info.object || !html) {
      state.tooltip.style.display = 'none';
      return;
    }
    state.tooltip.innerHTML = html;
    state.tooltip.style.display = 'block';
    state.tooltip.style.transform = 'translate(' + (info.x + 14) + 'px, ' + (info.y + 14) + 'px)';
  }

  function hideTooltip() {
    state.tooltip.style.display = 'none';
  }

  function lonFromTileX(x, z) {
    return x / Math.pow(2, z) * 360 - 180;
  }

  function latFromTileY(y, z) {
    var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function getTileBounds(tile) {
    if (tile.boundingBox) {
      var west = tile.boundingBox[0][0];
      var south = tile.boundingBox[0][1];
      var east = tile.boundingBox[1][0];
      var north = tile.boundingBox[1][1];
      return [
        [west, south],
        [west, north],
        [east, north],
        [east, south]
      ];
    }
    if (tile.bbox) {
      if ('west' in tile.bbox) {
        return [
          [tile.bbox.west, tile.bbox.south],
          [tile.bbox.west, tile.bbox.north],
          [tile.bbox.east, tile.bbox.north],
          [tile.bbox.east, tile.bbox.south]
        ];
      }
      return [
        [tile.bbox.left, tile.bbox.bottom],
        [tile.bbox.left, tile.bbox.top],
        [tile.bbox.right, tile.bbox.top],
        [tile.bbox.right, tile.bbox.bottom]
      ];
    }
    var index = tile.index || {};
    var west = lonFromTileX(index.x, index.z);
    var east = lonFromTileX(index.x + 1, index.z);
    var north = latFromTileY(index.y, index.z);
    var south = latFromTileY(index.y + 1, index.z);
    return [
      [west, south],
      [west, north],
      [east, north],
      [east, south]
    ];
  }

  function makeTileUrl(index) {
    return CARTO_TILE_URL
      .replace('{z}', index.z)
      .replace('{x}', index.x)
      .replace('{y}', index.y);
  }

  function loadTileImage(tile) {
    var url = tile.url || makeTileUrl(tile.index);
    return fetch(url, { signal: tile.signal })
      .then(function (response) {
        if (!response.ok) throw new Error('Could not load map tile ' + url);
        return response.blob();
      })
      .then(function (blob) {
        if (window.createImageBitmap) return createImageBitmap(blob);

        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.crossOrigin = 'anonymous';
          image.onload = function () { resolve(image); };
          image.onerror = reject;
          image.src = URL.createObjectURL(blob);
        });
      });
  }

  function getPickedFlowRecord(info) {
    var object = info && info.object;
    if (!object || object.type !== 'flow') return null;
    if (object.flow && object.flow.source) return object.flow.source;

    var fields = getFields();
    var origin = object.flow && object.flow.origin !== undefined
      ? object.flow.origin
      : object.origin && (object.origin.id || object.origin.name);
    var dest = object.flow && object.flow.dest !== undefined
      ? object.flow.dest
      : object.dest && (object.dest.id || object.dest.name);

    return state.records.find(function (record) {
      return String(record[fields.origin]) === String(origin) &&
        String(record[fields.dest]) === String(dest);
    }) || null;
  }

  function getPickedLocationId(info) {
    var object = info && info.object;
    if (!object || object.type !== 'location') return null;
    if (object.id !== undefined) return object.id;
    if (object.location && object.location.id !== undefined) return object.location.id;
    if (object.location && object.location.name !== undefined) return object.location.name;
    return null;
  }

  function renderDeck(records) {
    var visibleRecords = getVisibleFlowRecords(records);
    var flowData = makeFlowData(visibleRecords);
    var locations = makeLocations();
    var placeMax = maxPlaceTotal();
    var idField = config.geoIdFields[state.level];
    var guContextLayer = new GeoJsonLayer({
      id: 'gu-context-base',
      data: state.geometries.gu ? state.geometries.gu.raw.features : [],
      pickable: false,
      stroked: true,
      filled: true,
      extruded: false,
      getFillColor: [148, 163, 184, 30],
      getLineColor: [71, 85, 105, 105],
      getLineWidth: 55,
      lineWidthUnits: 'meters'
    });

    var mapLayer = new TileLayer({
      id: 'carto-basemap',
      data: CARTO_TILE_URL,
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      pickable: false,
      opacity: 0.78,
      getTileData: loadTileImage,
      renderSubLayers: function (props) {
        return new BitmapLayer({
          ...props,
          id: props.id + '-bitmap',
          data: null,
          image: props.data,
          bounds: getTileBounds(props.tile),
          pickable: false,
          opacity: 1
        });
      }
    });

    var baseLayer = state.level === 'station'
      ? new ScatterplotLayer({
          id: 'station-base',
          data: locations.filter(function (loc) { return loc.total > 0; }),
          pickable: true,
          getPosition: function (loc) { return [loc.lon, loc.lat]; },
          getRadius: function (loc) {
            return Math.max(20, Math.min(95, Math.sqrt(loc.total) * 0.55));
          },
          radiusUnits: 'meters',
          getFillColor: function (loc) {
            return state.selectedPlace === loc.id ? [220, 38, 38, 230] : colorFor(loc.total, placeMax);
          },
          getLineColor: [255, 255, 255, 210],
          lineWidthMinPixels: 1.5,
          onClick: function (info) {
            if (info.object) selectPlace(info.object.id);
          },
          onHover: function (info) {
            if (!info.object) return hideTooltip();
            showTooltip(info, '<b>' + info.object.id + '</b><br>' + fmtNumber(info.object.total) + ' linked trips');
          }
        })
      : new GeoJsonLayer({
          id: 'area-base',
          data: makeGeoFeatures(),
          pickable: true,
          stroked: true,
          filled: true,
          extruded: false,
          getFillColor: function (feature) {
            var id = feature.properties[idField];
            return state.selectedPlace === id ? [220, 38, 38, 220] : colorFor(state.placeTotals.get(id) || 0, placeMax);
          },
          getLineColor: function (feature) {
            return state.selectedPlace === feature.properties[idField] ? [127, 29, 29, 255] : [255, 255, 255, 235];
          },
          getLineWidth: function (feature) {
            return state.selectedPlace === feature.properties[idField] ? 110 : 45;
          },
          lineWidthUnits: 'meters',
          onClick: function (info) {
            if (info.object) selectPlace(info.object.properties[idField]);
          },
          onHover: function (info) {
            if (!info.object) return hideTooltip();
            var id = info.object.properties[idField];
            showTooltip(info, '<b>' + id + '</b><br>' + fmtNumber(state.placeTotals.get(id) || 0) + ' linked trips');
          }
        });

    var flowLayer = new FlowmapLayer({
      id: 'bike-flowmap',
      data: {
        locations: locations,
        flows: flowData
      },
      pickable: true,
      darkMode: false,
      colorScheme: 'OrRd',
      highlightColor: [220, 38, 38, 255],
      flowLinesRenderingMode: 'straight',
      animationEnabled: false,
      clusteringEnabled: false,
      fadeEnabled: true,
      fadeOpacityEnabled: false,
      flowLineThicknessScale: 1.35,
      locationTotalsEnabled: false,
      locationsEnabled: false,
      maxTopFlowsDisplayNum: Math.max(flowData.length, 1),
      getLocationId: function (loc) { return loc.id; },
      getLocationLat: function (loc) { return loc.lat; },
      getLocationLon: function (loc) { return loc.lon; },
      getLocationName: function (loc) { return loc.name; },
      getFlowOriginId: function (flow) { return flow.origin; },
      getFlowDestId: function (flow) { return flow.dest; },
      getFlowMagnitude: function (flow) { return flow.count; },
      onClick: function (info) {
        var record = getPickedFlowRecord(info);
        var locationId = getPickedLocationId(info);
        if (record) {
          selectRoute(record);
        } else if (locationId) {
          selectPlace(locationId);
        }
      },
      onHover: function (info) {
        var flow = info.object && info.object.type === 'flow' ? info.object.flow : null;
        var locationId = getPickedLocationId(info);
        if (locationId) {
          showTooltip(info, '<b>' + locationId + '</b><br>' + fmtNumber(state.placeTotals.get(locationId) || 0) + ' linked trips');
          return;
        }
        if (!flow) return hideTooltip();
        showTooltip(
          info,
          '<b>' + flow.origin + ' -> ' + flow.dest + '</b><br>' +
          fmtNumber(flow.count) + ' trips<br>' +
          fmtDecimal(flow.avgMin, 1) + ' min avg<br>' +
          fmtDecimal(flow.avgDistance / 1000, 2) + ' km avg'
        );
      }
    });

    state.deck.setProps({
      layers: [mapLayer, guContextLayer, baseLayer, flowLayer]
    });
  }

  function updateStats(summary) {
    els.headerTrips.textContent = fmtNumber(summary.trips);
    els.headerRoutes.textContent = fmtNumber(summary.routes);
    els.statTrips.textContent = fmtNumber(summary.trips);
    els.statRoutes.textContent = fmtNumber(summary.routes);
    els.statDuration.textContent = fmtDecimal(summary.avgDuration, 1) + ' min';
    els.statDistance.textContent = fmtDecimal(summary.avgDistance / 1000, 2) + ' km';
  }

  function updateSelectionText(summary) {
    if (state.selectedPlace) {
      els.selectedPlace.textContent = state.selectedPlace;
      els.selectedDetail.textContent = fmtNumber(summary.trips) + ' trips connect with this place under the current filters.';
      els.summaryStatus.textContent = 'Selected place';
      return;
    }
    if (state.selectedRouteKey) {
      els.selectedPlace.textContent = state.selectedRouteKey.replace('|', ' -> ');
      els.selectedDetail.textContent = 'A single origin-destination route is highlighted on the map and route list.';
      els.summaryStatus.textContent = 'Selected route';
      return;
    }
    els.selectedPlace.textContent = 'All Seoul';
    els.selectedDetail.textContent = 'Click a place, flow, bar, or route to focus the dashboard.';
    els.summaryStatus.textContent = 'Current filter';
  }

  function updateChart(records) {
    var fields = getFields();
    var totals = new Map();
    records.forEach(function (record) {
      var origin = record[fields.origin];
      totals.set(origin, (totals.get(origin) || 0) + (record.trip_count || 0));
    });
    var rows = Array.from(totals.entries())
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 15);
    var max = Math.max.apply(null, rows.map(function (row) { return row[1]; }).concat([0]));

    els.chart.innerHTML = '';
    rows.forEach(function (row) {
      var id = row[0];
      var trips = row[1];
      var div = document.createElement('div');
      div.className = 'bar-row' + (state.selectedPlace === id ? ' active' : '');
      div.innerHTML =
        '<span class="bar-label" title="' + id + '">' + id + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + ((trips / max) * 100).toFixed(1) + '%"></span></span>' +
        '<span class="bar-value">' + fmtNumber(trips) + '</span>';
      div.addEventListener('click', function () { selectPlace(id); });
      els.chart.appendChild(div);
    });
    els.chartStatus.textContent = state.selectedPlace ? 'Linked to selection' : 'Trip volume';
  }

  function updateRouteList(records) {
    var fields = getFields();
    els.routeList.innerHTML = '';
    records
      .slice()
      .sort(function (a, b) { return b.trip_count - a.trip_count; })
      .slice(0, 10)
      .forEach(function (record) {
        var key = record[fields.origin] + '|' + record[fields.dest];
        var div = document.createElement('div');
        div.className = 'route-item' + (state.selectedRouteKey === key ? ' active' : '');
        div.innerHTML =
          '<strong title="' + key.replace('|', ' -> ') + '">' +
          record[fields.origin] + ' -> ' + record[fields.dest] +
          '</strong><span>' + fmtNumber(record.trip_count) + ' trips | ' +
          fmtDecimal(record.avg_use_min, 1) + ' min avg | ' +
          fmtDecimal(record.avg_use_dst / 1000, 2) + ' km avg</span>';
        div.addEventListener('click', function () { selectRoute(record); });
        els.routeList.appendChild(div);
      });
  }

  function updateLegend() {
    var values = Array.from(state.placeTotals.values());
    var max = Math.max.apply(null, values.concat([0]));
    els.legend.innerHTML =
      '<div class="legend-title">Linked trip volume</div>' +
      '<div class="legend-ramp"></div>' +
      '<div class="legend-row"><span>0</span><span>' + fmtNumber(max) + '</span></div>' +
      '<div class="legend-row"><span>Showing top ' + state.flowPercent + '%: ' +
      fmtNumber(state.visibleFlowCount) + ' of ' + fmtNumber(state.visibleFlowTotal) + ' flows</span></div>';
  }

  function updateViews() {
    state.filteredRecords = filterForSelection(state.records);
    state.placeTotals = makePlaceTotals(state.records);
    var summary = summarize(state.filteredRecords);
    renderDeck(state.filteredRecords);
    updateStats(summary);
    updateSelectionText(summary);
    updateChart(state.filteredRecords);
    updateRouteList(state.filteredRecords);
    updateLegend();
  }

  function loadFlows() {
    els.mapStatus.textContent = 'Loading';
    return Promise.all([ensureGuContextGeojson(), ensureGeojson()])
      .then(function () { return fetchJson(buildFlowPath()); })
      .then(function (data) {
        state.records = data.records || [];
        state.selectedPlace = null;
        state.selectedRouteKey = null;
        updateViews();
        var levelLabels = {
          gu: 'Gu view',
          dong: 'Dong view',
          station: 'Station view'
        };
        els.mapStatus.textContent = levelLabels[state.level] || 'Map view';
      })
      .catch(function (error) {
        els.mapStatus.textContent = 'Load error';
        els.chart.innerHTML = '<p class="error">' + error.message + '</p>';
        throw error;
      });
  }

  function applyFilters() {
    state.level = els.level.value;
    state.month = els.month.value;
    state.weekday_type = els.weekday.value;
    state.hour = els.hour.value;
    state.flowPercent = Number(els.flowPercent.value);
    els.flowPercentValue.textContent = 'Top ' + state.flowPercent + '% of routes';
    loadFlows();
  }

  function resetFilters() {
    els.level.value = config.defaultFilters.level;
    els.month.value = config.defaultFilters.month;
    els.weekday.value = config.defaultFilters.weekday_type;
    els.hour.value = config.defaultFilters.hour;
    els.flowPercent.value = config.defaultFilters.flowPercent;
    applyFilters();
  }

  function bindEvents() {
    [els.level, els.month, els.weekday, els.hour].forEach(function (el) {
      el.addEventListener('change', applyFilters);
    });
    els.flowPercent.addEventListener('input', function () {
      state.flowPercent = Number(els.flowPercent.value);
      els.flowPercentValue.textContent = 'Top ' + state.flowPercent + '% of routes';
      updateViews();
    });
    els.reset.addEventListener('click', resetFilters);
    function handleEscape(event) {
      if (event.key === 'Escape') {
        clearSelection();
      }
    }
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', function () {
      if (state.deck) state.deck.setProps({});
    });
  }

  initDeck();
  fetchJson(config.manifestPath)
    .then(function (manifest) {
      state.manifest = manifest;
      bindEvents();
      applyFilters();
    });
})();
