// Wait until the HTML document is fully loaded before accessing elements.
// This prevents errors caused by trying to use DOM nodes too early.
document.addEventListener("DOMContentLoaded", function () {
    // Get references to sidebar controls so we can connect user input later.
    const yearSelect = document.getElementById("year-select");
    const timeRange = document.getElementById("time-range");
    const showStationsCheckbox = document.getElementById("show-stations");
    const statsContainer = document.getElementById("stats");

    // Create a Leaflet map inside the <div id="map"> container.
    // The coordinates are [latitude, longitude].
    const map = L.map("map").setView([37.5665, 126.9780], 11);

    // Add the OpenStreetMap tile layer so the map has a visible basemap.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    // Add one sample marker to confirm the map is rendering correctly.
    const cityCenterMarker = L.marker([37.5665, 126.9780]).addTo(map);
    cityCenterMarker.bindPopup("Seoul City Center");

    // Write a simple status message into the stats panel.
    // This makes the lower-right box feel active even before real data is connected.
    statsContainer.innerHTML = `
        <p><strong>Map status:</strong> Leaflet map loaded successfully.</p>
        <p><strong>Current year:</strong> ${yearSelect.value}</p>
        <p><strong>Current hour:</strong> ${timeRange.value}:00</p>
        <p><strong>Stations visible:</strong> Yes</p>
    `;

    // When the year dropdown changes, log the selected value for future filtering logic.
    yearSelect.addEventListener("change", function () {
        console.log("Selected year:", yearSelect.value);
        updateStats();
    });

    // When the slider changes, log the selected hour for future temporal filtering.
    timeRange.addEventListener("input", function () {
        console.log("Selected hour:", timeRange.value);
        updateStats();
    });

    // Show or hide the marker when the checkbox is toggled.
    // This demonstrates a real interactive connection between the sidebar and the map.
    showStationsCheckbox.addEventListener("change", function () {
        if (showStationsCheckbox.checked) {
            cityCenterMarker.addTo(map);
        } else {
            map.removeLayer(cityCenterMarker);
        }

        updateStats();
    });

    // Keep the stats panel synchronized with the current control state.
    function updateStats() {
        statsContainer.innerHTML = `
            <p><strong>Map status:</strong> Leaflet map loaded successfully.</p>
            <p><strong>Current year:</strong> ${yearSelect.value}</p>
            <p><strong>Current hour:</strong> ${timeRange.value}:00</p>
            <p><strong>Stations visible:</strong> ${showStationsCheckbox.checked ? "Yes" : "No"}</p>
        `;
    }

    // Leaflet sometimes needs a resize refresh after layout calculations.
    // Calling invalidateSize helps ensure the map fills the panel correctly.
    setTimeout(function () {
        map.invalidateSize();
    }, 0);
});
