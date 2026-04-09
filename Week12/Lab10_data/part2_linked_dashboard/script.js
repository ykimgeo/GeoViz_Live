(function () {
  var mapDiv = document.getElementById('map-chart');
  var barDiv = document.getElementById('bar-chart');
  var scatterDiv = document.getElementById('scatter-chart');
  var panelIds = ['map-panel', 'bar-panel', 'scatter-panel', 'table-panel'];

  // ── Read pre-embedded data from Python (avoids Plotly 3.x binary array issues) ──
  var CD = window.CHART_DATA;
  var mapColors = CD.mapBaseColors.slice(); // per-city health colors for map
  var barIds = CD.barIds.slice(); // city_id per bar in sorted order
  var scBase = {
    color: CD.scatterBaseColors.slice(),
    size: CD.scatterSizes.slice()
  };
  var selectedId = null;

  function setPanelsActive(active) {
    panelIds.forEach(function (id) {
      document.getElementById(id).classList.toggle('active', active);
    });
  }

  // ── highlight helpers ─────────────────────────────────────────────────
  function highlightMap(cityId) {
    Plotly.restyle(mapDiv, {
      'marker.color': [
        mapColors.map(function (c, i) {
          return i === cityId ? '#f59e0b' : c;
        })
      ]
    });
  }

  function highlightBar(cityId) {
    Plotly.restyle(barDiv, {
      'marker.color': [
        barIds.map(function (id) {
          return id === cityId ? '#f59e0b' : '#22c55e';
        })
      ],
      'marker.line.color': [
        barIds.map(function (id) {
          return id === cityId ? '#ffffff' : 'rgba(0,0,0,0)';
        })
      ],
      'marker.line.width': [
        barIds.map(function (id) {
          return id === cityId ? 2 : 0;
        })
      ]
    });
  }

  function highlightScatter(cityId) {
    Plotly.restyle(scatterDiv, {
      'marker.color': [
        scBase.color.map(function (c, i) {
          return i === cityId ? '#f59e0b' : c;
        })
      ],
      'marker.line.color': [
        scBase.size.map(function (_, i) {
          return i === cityId ? '#ffffff' : '#334155';
        })
      ],
      'marker.line.width': [
        scBase.size.map(function (_, i) {
          return i === cityId ? 3 : 1;
        })
      ]
    });
  }

  function highlightTable(cityId) {
    document.querySelectorAll('.summary-table tbody tr').forEach(function (tr) {
      var sel = Number(tr.dataset.cityId) === cityId;
      tr.classList.toggle('selected', sel);
      if (sel) {
        tr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  // ── select / clear ────────────────────────────────────────────────────
  function selectCity(cityId) {
    if (cityId === null || cityId === undefined || isNaN(cityId)) return;
    selectedId = cityId;
    setPanelsActive(true);
    highlightMap(cityId);
    highlightBar(cityId);
    highlightScatter(cityId);
    highlightTable(cityId);
  }

  function clearSelection() {
    selectedId = null;
    setPanelsActive(false);

    Plotly.restyle(mapDiv, {
      'marker.color': [mapColors]
    });

    Plotly.restyle(barDiv, {
      'marker.color': [
        barIds.map(function () {
          return '#22c55e';
        })
      ],
      'marker.line.color': [
        barIds.map(function () {
          return 'rgba(0,0,0,0)';
        })
      ],
      'marker.line.width': [
        barIds.map(function () {
          return 0;
        })
      ]
    });

    Plotly.restyle(scatterDiv, {
      'marker.color': [scBase.color],
      'marker.line.color': [
        scBase.size.map(function () {
          return '#334155';
        })
      ],
      'marker.line.width': [
        scBase.size.map(function () {
          return 1;
        })
      ]
    });

    document.querySelectorAll('.summary-table tbody tr').forEach(function (tr) {
      tr.classList.remove('selected');
    });
  }

  // ── city_id extraction ────────────────────────────────────────────────
  function extractCityId(point) {
    if (!point) return null;

    var idx =
      point.pointIndex !== undefined
        ? point.pointIndex
        : point.pointNumber;

    var traceType = point.data && point.data.type;

    if (traceType === 'bar') return barIds[idx];
    if (traceType === 'scatter') return idx;
    if (traceType === 'scattermapbox' || traceType === 'scattermap') return idx;

    var cd = point.customdata;
    if (!cd) return null;
    if (typeof cd === 'number') return cd;
    if (Array.isArray(cd)) return Number(cd[0]);
    if (cd[0] !== undefined) return Number(cd[0]);

    return null;
  }

  // ── event wiring ─────────────────────────────────────────────────────
  function bindEvents() {
    if (!mapDiv.on || !barDiv.on || !scatterDiv.on) {
      setTimeout(bindEvents, 50);
      return;
    }

    mapDiv.on('plotly_click', function (e) {
      selectCity(extractCityId(e.points[0]));
    });

    barDiv.on('plotly_click', function (e) {
      selectCity(extractCityId(e.points[0]));
    });

    scatterDiv.on('plotly_click', function (e) {
      selectCity(extractCityId(e.points[0]));
    });

    [mapDiv, barDiv, scatterDiv].forEach(function (div) {
      div.on('plotly_doubleclick', function () {
        clearSelection();
        return false;
      });
    });
  }

  document
    .querySelectorAll('.summary-table tbody tr')
    .forEach(function (tr) {
      tr.addEventListener('click', function () {
        selectCity(Number(tr.dataset.cityId));
      });
    });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && selectedId !== null) {
      clearSelection();
    }
  });

  if (document.readyState === 'complete') {
    bindEvents();
  } else {
    window.addEventListener('load', bindEvents);
  }
})();