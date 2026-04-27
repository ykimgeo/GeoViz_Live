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
    manifest: null
  });

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
    legend: document.getElementById('map-legend')
  };

  var map = L.map('map', { zoomControl: true }).setView([37.5665, 126.978], 11);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19
  }).addTo(map);

  var layers = {
    place: L.layerGroup().addTo(map),
    flow: L.layerGroup().addTo(map)
  };

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

  function getFeatureId(feature) {
    var field = config.geoIdFields[state.level];
    return feature.properties[field];
  }

  function polygonCenter(feature) {
    var bounds = L.geoJSON(feature).getBounds();
    return bounds.getCenter();
  }

  function pointCenter(feature) {
    var coords = feature.geometry.coordinates;
    return L.latLng(coords[1], coords[0]);
  }

  function getCenter(id) {
    var item = state.geometries[state.level] && state.geometries[state.level][id];
    return item ? item.center : null;
  }

  function averageCenters(centers) {
    var total = centers.reduce(function (acc, center) {
      acc.lat += center.lat;
      acc.lng += center.lng;
      return acc;
    }, { lat: 0, lng: 0 });
    return L.latLng(total.lat / centers.length, total.lng / centers.length);
  }

  function cacheGeojson(level, data) {
    var byId = {};
    data.features.forEach(function (feature) {
      var id = feature.properties[config.geoIdFields[level]];
      if (!id) return;
      if (!byId[id]) {
        byId[id] = {
          features: [],
          centers: []
        };
      }
      byId[id].features.push(feature);
      byId[id].centers.push(feature.geometry.type === 'Point' ? pointCenter(feature) : polygonCenter(feature));
    });
    Object.keys(byId).forEach(function (id) {
      byId[id].center = averageCenters(byId[id].centers);
    });
    state.geometries[level] = byId;
  }

  function ensureGeojson() {
    if (state.geometries[state.level]) return Promise.resolve();
    return fetchJson(config.geojson[state.level]).then(function (geojson) {
      cacheGeojson(state.level, geojson);
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
    if (!max) return '#dfe8d2';
    var t = Math.max(0, Math.min(1, value / max));
    if (t < 0.35) return '#dfe8d2';
    if (t < 0.65) return '#72b37f';
    if (t < 0.86) return '#2f7d5c';
    return '#10664c';
  }

  function drawPlaces() {
    layers.place.clearLayers();
    var geos = state.geometries[state.level];
    var max = Math.max.apply(null, Array.from(state.placeTotals.values()).concat([0]));
    Object.keys(geos).forEach(function (id) {
      var item = geos[id];
      var total = state.placeTotals.get(id) || 0;
      var active = state.selectedPlace === id;
      if (state.level === 'station' && total === 0) return;

      item.features.forEach(function (feature) {
        if (feature.geometry.type === 'Point') {
          var marker = L.circleMarker(pointCenter(feature), {
            radius: active ? 8 : Math.max(3, Math.min(8, Math.sqrt(total) / 18)),
            color: active ? '#c84a3f' : '#1f6fb2',
            weight: active ? 3 : 1,
            fillColor: colorFor(total, max),
            fillOpacity: active ? 0.95 : 0.72
          });
          marker.bindTooltip(id + '<br>' + fmtNumber(total) + ' linked trips', {
            direction: 'top'
          });
          marker.on('click', function () { selectPlace(id); });
          marker.addTo(layers.place);
        } else {
          var polygon = L.geoJSON(feature, {
            style: {
              color: active ? '#c84a3f' : '#ffffff',
              weight: active ? 3 : 1,
              fillColor: colorFor(total, max),
              fillOpacity: active ? 0.82 : 0.68
            }
          });
          polygon.bindTooltip(id + '<br>' + fmtNumber(total) + ' linked trips', {
            sticky: true
          });
          polygon.on('click', function () { selectPlace(id); });
          polygon.addTo(layers.place);
        }
      });
    });
  }

  function drawFlows(records) {
    layers.flow.clearLayers();
    var fields = getFields();
    var sortedRecords = records.slice().sort(function (a, b) {
      return b.trip_count - a.trip_count;
    });
    var visibleCount = sortedRecords.length
      ? Math.max(1, Math.ceil(sortedRecords.length * state.flowPercent / 100))
      : 0;
    var flowRecords = sortedRecords.slice(0, visibleCount);
    state.visibleFlowCount = flowRecords.length;
    state.visibleFlowTotal = sortedRecords.length;

    var max = Math.max.apply(null, flowRecords.map(function (record) {
      return record.trip_count || 0;
    }).concat([0]));

    flowRecords.forEach(function (record) {
      var origin = record[fields.origin];
      var dest = record[fields.dest];
      var from = getCenter(origin);
      var to = getCenter(dest);
      if (!from || !to) return;
      var routeKey = origin + '|' + dest;
      var active = state.selectedRouteKey === routeKey;
      var line = L.polyline([from, to], {
        color: active ? '#c84a3f' : '#1f6fb2',
        opacity: active ? 0.94 : 0.46,
        weight: active ? 5 : Math.max(1.2, (record.trip_count / max) * 5),
        lineCap: 'round'
      });
      line.bindTooltip(
        origin + ' -> ' + dest + '<br>' + fmtNumber(record.trip_count) + ' trips',
        { className: 'flow-tooltip', sticky: true }
      );
      line.on('click', function () { selectRoute(record); });
      line.addTo(layers.flow);
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
    els.selectedDetail.textContent = 'Click a polygon, station marker, flow line, or chart bar to focus the dashboard.';
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
    drawPlaces();
    drawFlows(state.filteredRecords);
    updateStats(summary);
    updateSelectionText(summary);
    updateChart(state.filteredRecords);
    updateRouteList(state.filteredRecords);
    updateLegend();
  }

  function loadFlows() {
    els.mapStatus.textContent = 'Loading';
    return ensureGeojson()
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
        setTimeout(function () { map.invalidateSize(); }, 80);
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
  }

  fetchJson(config.manifestPath)
    .then(function (manifest) {
      state.manifest = manifest;
      bindEvents();
      applyFilters();
    });
})();
