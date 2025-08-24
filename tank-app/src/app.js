import Chart from 'chart.js/auto';
import zoomPlugin from 'chartjs-plugin-zoom';
import Fuse from 'fuse.js';

Chart.register(zoomPlugin);

const API_BASE_URL = "https://datasette.familie-bell.com"; // Deine datasette URL
const DB_NAME = "tankentanken"; // Der Name deiner Datenbankdatei ohne .db
const PAGE_SIZE = 1000; // Anzahl der Ergebnisse pro API-Aufruf für die Paginierung

const state = {
    priceChart: undefined,
    fuse: undefined,
    allStations: [],
    selectedStations: [],
    selectedFuelTypes: [],
    selectedTimeRange: 'all',
};

// Eine Farbpalette, um die verschiedenen Tankstellen im Diagramm zu unterscheiden
const CHART_COLORS = [
    'rgba(255, 99, 132, 1)', 'rgba(54, 162, 235, 1)', 'rgba(75, 192, 192, 1)',
    'rgba(255, 159, 64, 1)', 'rgba(153, 102, 255, 1)', 'rgba(255, 205, 86, 1)',
];

// Konfiguration für die Treibstoffarten
const FUEL_TYPE_CONFIG = [
    { key: 'price_diesel', name: 'Diesel', style: 'solid' },
    { key: 'price_super', name: 'Super E5', style: 'dashed' },
    { key: 'price_super_e10', name: 'Super E10', style: 'dotted' }
];

/**
 * Formatiert eine Zahl als deutschen Währungspreis.
 * @param {number} price - Der zu formatierende Preis.
 * @returns {string} Der formatierte Preisstring (z.B. "1,899 €").
 */
function formatPrice(price) {
    if (typeof price !== 'number') {
        return '';
    }
    return price.toLocaleString('de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 3
    });
}

/**
 * Aktualisiert die Browser-URL mit dem aktuellen Anwendungszustand.
 */
function updateUrlWithState() {
    const params = new URLSearchParams();

    if (state.selectedStations.length > 0) {
        params.set('stations', state.selectedStations.map(s => s.station_id).join(','));
    }

    // Speichere immer alle Parameter für eine eindeutige URL
    params.set('fuels', state.selectedFuelTypes.join(','));
    // Handle custom time range object or string
    if (typeof state.selectedTimeRange === 'object') {
        const { start, end } = state.selectedTimeRange;
        params.set('time', `${start.toISOString()};${end.toISOString()}`);
    } else {
        params.set('time', state.selectedTimeRange);
    }

    // benutze replaceState, um die Browser-History nicht mit jeder kleinen Änderung zu füllen
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
}

/**
 * Liest den Zustand aus den URL-Parametern.
 * @returns {object|null} Ein Objekt mit dem Zustand oder null, wenn keine Parameter vorhanden sind.
 */
function loadStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const stationIdsParam = params.get('stations');
    const fuelTypesParam = params.get('fuels');
    const timeRangeParam = params.get('time');

    // Nur fortfahren, wenn mindestens ein relevanter Parameter vorhanden ist.
    if (!stationIdsParam && !fuelTypesParam && !timeRangeParam) {
        return null;
    }

    let timeRange = timeRangeParam;
    if (timeRangeParam && timeRangeParam.includes(';')) {
        const [start, end] = timeRangeParam.split(';');
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (!isNaN(startDate) && !isNaN(endDate)) {
            timeRange = { start: startDate, end: endDate };
        }
    }

    return {
        stationIds: stationIdsParam ? stationIdsParam.split(',') : [],
        // Gibt null zurück, wenn der Parameter fehlt, ansonsten das Array (kann leer sein)
        fuelTypes: fuelTypesParam !== null ? (fuelTypesParam ? fuelTypesParam.split(',') : []) : null,
        timeRange: timeRange
    };
}

/**
 * Richtet die Event-Listener für die UI-Elemente ein.
 */
function setupEventListeners() {
    const searchInput = document.getElementById('stationSearch');
    searchInput.addEventListener('input', handleSearchInput);
    document.querySelectorAll('#fuelTypeSelector input[name="fuel"]').forEach(checkbox => {
        checkbox.addEventListener('change', handleFuelTypeChange);
    });
    document.querySelectorAll('#timeRangeSelector input[name="timeRange"]').forEach(radio => {
        radio.addEventListener('change', handleTimeRangeChange);
    });
    // HINWEIS: Füge einen Button mit id="resetZoomBtn" zu deiner HTML-Datei hinzu, z.B. bei der Zeitraumauswahl.
    document.getElementById('resetZoomBtn')?.addEventListener('click', handleResetZoom);
}

/**
 * Initialisiert die Anwendungslogik, lädt Daten und den Zustand aus dem LocalStorage.
 */
async function initializeApp() {
    try {
        state.allStations = await fetchStations();

        // Fuse.js für die Fuzzy-Suche initialisieren
        const options = {
            keys: ['name', 'address'],
            includeScore: true,
            threshold: 0.4
        };
        state.fuse = new Fuse(state.allStations, options);

        const urlState = loadStateFromUrl();
        if (urlState) {
            // Lade Zustand aus der URL
            state.selectedStations = urlState.stationIds
                .map(id => state.allStations.find(s => s.station_id === id))
                .filter(Boolean); // Entferne null-Werte, falls eine ID ungültig ist
            // Wenn der 'fuels'-Parameter fehlt, nimm den Standard. Wenn er da ist (auch leer), nimm ihn.
            state.selectedFuelTypes = urlState.fuelTypes !== null ? urlState.fuelTypes : FUEL_TYPE_CONFIG.map(ft => ft.key);
            state.selectedTimeRange = urlState.timeRange || 'all'; // `timeRange` kann ein Objekt sein
        } else {
            // Lade gespeicherte Tankstellen aus dem LocalStorage als Fallback
            state.selectedStations = loadSelectedStations(state.allStations);
            state.selectedFuelTypes = loadSelectedFuelTypes();
            state.selectedTimeRange = loadSelectedTimeRange();
        }

        // UI-Zustand basierend auf geladenen Daten aktualisieren
        updateFuelTypeCheckboxes();
        updateTimeRangeRadios();
        renderSelectedStations();

        if (state.selectedStations.length > 0) {
            updateChartAndAnalysis();
        }
    } catch (error) {
        console.error("Fehler beim Laden der Tankstellen:", error);
        document.getElementById('recommendation').textContent = "Fehler: Konnte die Tankstellen nicht laden.";
    }
}


/**
 * Behandelt die Änderung der Treibstoffauswahl.
 */
function handleFuelTypeChange() {
    state.selectedFuelTypes = Array.from(document.querySelectorAll('#fuelTypeSelector input[name="fuel"]:checked')).map(cb => cb.value);
    saveSelectedFuelTypes();
    updateUrlWithState();
    updateChartAndAnalysis();
}

/**
 * Behandelt die Änderung der Zeitraums-Auswahl.
 */
function handleTimeRangeChange(event) {
    state.selectedTimeRange = event.target.value;
    saveSelectedTimeRange();

    // Verstecke den "Zoom zurücksetzen"-Button und setze den Chart-Zoom zurück
    const resetBtn = document.getElementById('resetZoomBtn');
    if (resetBtn) resetBtn.style.display = 'none';
    if (state.priceChart && (state.priceChart.isZoomedOrPanned && state.priceChart.isZoomedOrPanned())) {
        state.priceChart.resetZoom('none');
    }

    updateChartAndAnalysis();
    updateUrlWithState(); // URL nach der Analyse aktualisieren
}

/**
 * Ruft Daten von der Datasette API ab und behandelt die Paginierung mit LIMIT/OFFSET.
 * @param {string} baseQuery - Die SQL-Abfrage ohne LIMIT/OFFSET.
 * @param {object} params - Ein Objekt mit Parametern für die SQL-Abfrage.
 * @returns {Promise<Array>} Ein Promise, das zu einem Array mit allen Zeilen auflöst.
 */
async function fetchPaginatedData(baseQuery, params = {}) {
    let allRows = [];
    let offset = 0;
    let hasMore = true;

    const paramString = Object.entries(params)
        .map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('');

    while (hasMore) {
        const query = `${baseQuery} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
        const url = `${API_BASE_URL}/${DB_NAME}.json?sql=${encodeURIComponent(query)}${paramString}&_shape=objects`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
        }
        const data = await response.json();
        const fetchedRows = data.rows || [];

        if (fetchedRows.length > 0) {
            allRows = allRows.concat(fetchedRows);
        }

        if (fetchedRows.length < PAGE_SIZE) {
            hasMore = false;
        } else {
            offset += PAGE_SIZE;
        }
    }
    return allRows;
}

/**
 * Ruft die Liste aller Tankstellen von der datasette API ab.
 */
async function fetchStations() {
    // Diese Abfrage holt alle eindeutigen Tankstellen
    const sqlQuery = `select station_id, name, address from gas_stations order by name`;
    return await fetchPaginatedData(sqlQuery);
}

/**
 * Behandelt die Eingabe im Suchfeld.
 */
function handleSearchInput(event) {
    const searchTerm = event.target.value;
    if (!searchTerm) {
        clearSearchResults();
        return;
    }
    const results = state.fuse.search(searchTerm);
    renderSearchResults(results);
}

/**
 * Rendert die Suchergebnisse unter dem Eingabefeld.
 * @param {Array} results - Die Ergebnisse von Fuse.js
 */
function renderSearchResults(results) {
    const resultsContainer = document.getElementById('searchResults');
    clearSearchResults();

    // Zeige nur die Top 5 Ergebnisse
    results.slice(0, 5).forEach(result => {
        const station = result.item;
        const resultEl = document.createElement('div');
        resultEl.classList.add('search-result-item');
        resultEl.textContent = `${station.name} (${station.address})`;
        resultEl.addEventListener('click', () => handleResultClick(station));
        resultsContainer.appendChild(resultEl);
    });
}

/**
 * Behandelt den Klick auf ein Suchergebnis.
 * @param {object} station - Das ausgewählte Tankstellen-Objekt.
 */
function handleResultClick(station) {
    // Füge die Station nur hinzu, wenn sie nicht bereits ausgewählt ist
    if (state.selectedStations.find(s => s.station_id === station.station_id)) {
        clearSearchResults();
        document.getElementById('stationSearch').value = '';
        return;
    }

    state.selectedStations.push(station);
    saveSelectedStations();
    updateUrlWithState();
    renderSelectedStations();
    updateChartAndAnalysis();

    const searchInput = document.getElementById('stationSearch');
    searchInput.value = ''; // Leere das Suchfeld nach der Auswahl
    clearSearchResults();
}

/**
 * Leert die Liste der Suchergebnisse.
 */
function clearSearchResults() {
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '';
}

/**
 * Rendert die ausgewählten Tankstellen als Tags auf der Seite.
 */
function renderSelectedStations() {
    const container = document.getElementById('selectedStationsContainer');
    container.innerHTML = '';
    state.selectedStations.forEach(station => {
        const tag = document.createElement('div');
        tag.className = 'station-tag';
        tag.innerHTML = `
            <span>${station.name}</span>
            <span class="remove-station" data-id="${station.station_id}">&times;</span>
        `;
        container.appendChild(tag);
    });

    // Füge Event-Listener zu den "Entfernen"-Buttons hinzu
    container.querySelectorAll('.remove-station').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stationIdToRemove = e.target.dataset.id;
            removeStation(stationIdToRemove);
        });
    });
}

/**
 * Entfernt eine Tankstelle aus der Auswahl.
 * @param {string} stationId - Die ID der zu entfernenden Tankstelle.
 */
function removeStation(stationId) {
    state.selectedStations = state.selectedStations.filter(s => s.station_id !== stationId);
    saveSelectedStations();
    updateUrlWithState();
    renderSelectedStations();
    updateChartAndAnalysis();
}

/**
 * Speichert die IDs der ausgewählten Tankstellen im LocalStorage.
 */
function saveSelectedStations() {
    const stationIds = state.selectedStations.map(s => s.station_id);
    localStorage.setItem('selectedStationIds', JSON.stringify(stationIds));
}

/**
 * Lädt die IDs aus dem LocalStorage und gibt die passenden Tankstellen-Objekte zurück.
 * @param {Array} allStations - Die vollständige Liste aller Tankstellen.
 * @returns {Array} Die Liste der ausgewählten Tankstellen-Objekte.
 */
function loadSelectedStations(allStations) {
    const savedIds = JSON.parse(localStorage.getItem('selectedStationIds') || '[]');
    if (savedIds.length > 0 && allStations.length > 0) {
        // Finde die vollständigen Tankstellen-Objekte anhand der gespeicherten IDs
        return savedIds.map(id => allStations.find(s => s.station_id === id)).filter(Boolean);
    }
    return [];
}

/**
 * Speichert die Auswahl der Treibstoffe im LocalStorage.
 */
function saveSelectedFuelTypes() {
    localStorage.setItem('selectedFuelTypes', JSON.stringify(state.selectedFuelTypes));
}

/**
 * Lädt die Treibstoffauswahl aus dem LocalStorage oder gibt einen Standardwert zurück.
 * @returns {Array} Die Liste der ausgewählten Treibstoff-Schlüssel.
 */
function loadSelectedFuelTypes() {
    const savedTypes = JSON.parse(localStorage.getItem('selectedFuelTypes'));
    // Standardmäßig alle anzeigen, wenn nichts gespeichert ist.
    return savedTypes !== null ? savedTypes : FUEL_TYPE_CONFIG.map(ft => ft.key);
}

/** Aktualisiert die Checkboxen, um den in `state.selectedFuelTypes` gespeicherten Zustand widerzuspiegeln. */
function updateFuelTypeCheckboxes() {
    document.querySelectorAll('#fuelTypeSelector input[name="fuel"]').forEach(checkbox => {
        checkbox.checked = state.selectedFuelTypes.includes(checkbox.value);
    });
}

/**
 * Speichert den ausgewählten Zeitraum im LocalStorage.
 */
function saveSelectedTimeRange() {
    let valueToSave;
    if (typeof state.selectedTimeRange === 'object' && state.selectedTimeRange.start) {
        // Serialisiere das Objekt in einen String, den wir wieder parsen können
        const { start, end } = state.selectedTimeRange;
        valueToSave = `${start.toISOString()};${end.toISOString()}`;
    } else {
        valueToSave = state.selectedTimeRange;
    }
    localStorage.setItem('selectedTimeRange', valueToSave);
}

/**
 * Lädt den Zeitraum aus dem LocalStorage oder gibt einen Standardwert zurück.
 * @returns {string} Der ausgewählte Zeitraum.
 */
function loadSelectedTimeRange() {
    const saved = localStorage.getItem('selectedTimeRange') || 'all';
    if (saved.includes(';')) {
        const [start, end] = saved.split(';');
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (!isNaN(startDate) && !isNaN(endDate)) {
            return { start: startDate, end: endDate };
        }
    }
    return saved;
}

/** Aktualisiert die Radio-Buttons, um den in `state.selectedTimeRange` gespeicherten Zustand widerzuspiegeln. */
function updateTimeRangeRadios() {
    const resetBtn = document.getElementById('resetZoomBtn');
    if (typeof state.selectedTimeRange === 'object') {
        // Benutzerdefinierter (Zoom-)Bereich, deaktiviere alle Radios und zeige Reset-Button
        document.querySelectorAll('#timeRangeSelector input[name="timeRange"]').forEach(radio => {
            radio.checked = false;
        });
        if (resetBtn) resetBtn.style.display = 'inline-block';
    } else {
        // Standardbereich, aktiviere das richtige Radio und verstecke Reset-Button
        const radioToCheck = document.querySelector(`#timeRangeSelector input[value="${state.selectedTimeRange}"]`);
        if (radioToCheck) {
            radioToCheck.checked = true;
        }
        if (resetBtn) resetBtn.style.display = 'none';
    }
}

/**
 * Filtert ein Array von Preisdaten basierend auf dem ausgewählten Zeitraum.
 * @param {Array} data - Das Array mit den Preisdaten.
 * @param {string} range - Der ausgewählte Zeitraum ('1d', '7d', '14d', 'all').
 * @returns {Array} Das gefilterte Datenarray.
 */
function filterDataByTimeRange(data, range) {
    if (range === 'all' || !data) {
        return data;
    }

    let startDate, endDate;

    if (typeof range === 'object' && range.start && range.end) {
        startDate = range.start;
        endDate = range.end;
    } else if (typeof range === 'string') {
        const now = new Date();
        startDate = new Date();
        if (range === '1d') {
            startDate.setDate(now.getDate() - 1);
        } else if (range === '7d') {
            startDate.setDate(now.getDate() - 7);
        } else if (range === '14d') {
            startDate.setDate(now.getDate() - 14);
        } else {
            return data; // Sollte nicht passieren, wenn range nicht 'all' ist
        }
    } else {
        return data; // Ungültiger Range-Typ
    }

    return data.filter(row => {
        const rowDate = new Date(row.last_transmission);
        return rowDate >= startDate && (!endDate || rowDate <= endDate);
    });
}
/**
 * Hauptfunktion, die das Abrufen von Daten und die Aktualisierung von Diagramm und Analyse auslöst.
 */
async function updateChartAndAnalysis() {
    const recommendationEl = document.getElementById('recommendation');
    if (state.selectedStations.length === 0) {
        if (state.priceChart) state.priceChart.destroy();
        recommendationEl.textContent = "Wähle eine oder mehrere Tankstellen aus, um die Analyse zu starten.";
        recommendationEl.style.color = 'black';
        return;
    }

    recommendationEl.textContent = 'Lade Preisdaten...';

    try {
        // Rufe Preisdaten für alle ausgewählten Tankstellen parallel ab
        const priceDataPromises = state.selectedStations.map(station => fetchPriceHistory(station.station_id));
        const results = await Promise.all(priceDataPromises);

        const stationDataArray = state.selectedStations.map((station, index) => ({
            station: station,
            data: results[index]
        }));

        // Filtere die Daten für das Diagramm basierend auf dem ausgewählten Zeitraum
        const filteredStationDataArray = stationDataArray.map(sd => ({
            ...sd,
            data: filterDataByTimeRange(sd.data, state.selectedTimeRange)
        }));

        renderMultiStationChart(filteredStationDataArray);
        // Führe die Analyse mit den abgerufenen Daten der letzten 30 Tage durch.
        analyzeMultiStationPrices(stationDataArray);
    } catch (error) {
        console.error("Fehler beim Abrufen der Preis-Historien:", error);
        recommendationEl.textContent = "Fehler beim Laden der Preisdaten.";
        recommendationEl.style.color = 'red';
    }
}

/**
 * Ruft die Preis-Historie für eine bestimmte Tankstellen-ID ab (maximal 30 Tage).
 */
async function fetchPriceHistory(stationId) {
    // Datum für 30 Tage in der Vergangenheit berechnen
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 30);

    // Diese SQL-Abfrage verbindet die Preishistorie mit den Stammdaten der Tankstelle.
    const sqlQuery = `
        SELECT
          ph.last_transmission,
          ph.price_diesel,
          ph.price_super,
          ph.price_super_e10
        FROM price_history ph
        JOIN gas_stations gs ON ph.station_id = gs.id
        WHERE gs.station_id = :station_id AND ph.last_transmission >= :since
        ORDER BY ph.last_transmission
    `;

    try {
        return await fetchPaginatedData(sqlQuery, {
            station_id: stationId,
            since: sinceDate.toISOString()
        });
    } catch (error) {
        console.error(`Fehler beim Abrufen der Preis-Historie für Station ${stationId}:`, error);
        return []; // Gib ein leeres Array zurück, um Promise.all nicht zu unterbrechen
    }
}

/**
 * Rendert das Diagramm mit den Preisdaten von mehreren Tankstellen.
 * @param {Array} stationDataArray - Ein Array von Objekten, die Tankstelle und Preisdaten enthalten.
 */
function renderMultiStationChart(stationDataArray) {
    const ctx = document.getElementById('priceChart').getContext('2d');

    if (state.priceChart) {
        state.priceChart.destroy(); // Zerstöre altes Diagramm, bevor ein neues gezeichnet wird
    }

    // Erstelle eine Master-Liste aller eindeutigen Zeitstempel von allen Tankstellen
    const allTimestamps = new Set();
    stationDataArray.forEach(sd => {
        sd.data.forEach(row => allTimestamps.add(row.last_transmission));
    });
    const sortedLabels = Array.from(allTimestamps).sort();
    const formattedLabels = sortedLabels.map(ts => new Date(ts).toLocaleString('de-DE'));

    // Erstelle die Datensätze für das Diagramm
    const datasets = [];
    const activeFuelTypes = FUEL_TYPE_CONFIG.filter(fuel => state.selectedFuelTypes.includes(fuel.key));

    stationDataArray.forEach((sd, index) => {
        const stationColor = CHART_COLORS[index % CHART_COLORS.length];
        activeFuelTypes.forEach(fuel => {
            // Erstelle eine Map für schnellen Zugriff auf Preise per Zeitstempel
            const priceMap = new Map(sd.data.map(row => [row.last_transmission, row[fuel.key]]));
            // Ordne die Preise der Master-Zeitstempel-Liste zu (null, wenn kein Preis vorhanden)
            const dataPoints = sortedLabels.map(ts => priceMap.get(ts) || null);

            datasets.push({
                label: `${sd.station.name} - ${fuel.name}`,
                data: dataPoints,
                borderColor: stationColor,
                borderDash: fuel.style === 'dashed' ? [5, 5] : (fuel.style === 'dotted' ? [1, 5] : []),
                fill: false,
                tension: 0.1, // Glättet die Linien leicht
            });
        });
    });

    state.priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedLabels,
            datasets: datasets
        },
        options: {
            scales: {
                y: {
                    ticks: {
                        callback: function (value) {
                            return formatPrice(value);
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += formatPrice(context.parsed.y);
                            }
                            return label;
                        }
                    }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                    },
                    zoom: {
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(0, 123, 255, 0.2)'
                        },
                        mode: 'x',
                        onZoomComplete: ({ chart }) => {
                            const { min, max } = chart.scales.x;
                            handleZoom(sortedLabels[min], sortedLabels[max]);
                        }
                    }
                }
            }
        }
    });
}

/**
 * Analysiert die Preisdaten einer Tankstelle, um typische Muster zu finden.
 * @param {Array} priceData - Die Preis-Historie einer Tankstelle.
 * @param {string} fuelKey - Der Schlüssel für die zu analysierende Kraftstoffart (z.B. 'price_super_e10').
 * @returns {object|null} Ein Objekt mit den Analyseergebnissen oder null.
 */
function analyzePricePatterns(priceData, fuelKey) {
    const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    const dailyStats = Array(7).fill(null).map(() => ({ sum: 0, count: 0 }));
    const hourlyStats = Array(24).fill(null).map(() => ({ sum: 0, count: 0 }));

    priceData.forEach(row => {
        const price = row[fuelKey];
        if (price) {
            const date = new Date(row.last_transmission);
            const day = date.getDay();
            const hour = date.getHours();

            dailyStats[day].sum += price;
            dailyStats[day].count++;

            hourlyStats[hour].sum += price;
            hourlyStats[hour].count++;
        }
    });

    const dailyAverages = dailyStats.map(stat => stat.count > 0 ? stat.sum / stat.count : null);
    const hourlyAverages = hourlyStats.map(stat => stat.count > 0 ? stat.sum / stat.count : null);

    // Finde min/max für Tage
    let cheapestDay = { index: -1, price: Infinity };
    let dearestDay = { index: -1, price: -Infinity };
    dailyAverages.forEach((price, index) => {
        if (price !== null) {
            if (price < cheapestDay.price) cheapestDay = { index, price };
            if (price > dearestDay.price) dearestDay = { index, price };
        }
    });

    // Finde min/max für Stunden
    let cheapestHour = { index: -1, price: Infinity };
    let dearestHour = { index: -1, price: -Infinity };
    hourlyAverages.forEach((price, index) => {
        if (price !== null) {
            if (price < cheapestHour.price) cheapestHour = { index, price };
            if (price > dearestHour.price) dearestHour = { index, price };
        }
    });

    if (cheapestDay.index === -1 || cheapestHour.index === -1) {
        return null; // Nicht genügend Daten für eine Analyse
    }

    return {
        cheapestDay: { day: dayNames[cheapestDay.index], price: cheapestDay.price },
        dearestDay: { day: dayNames[dearestDay.index], price: dearestDay.price },
        cheapestHour: { hour: cheapestHour.index, price: cheapestHour.price },
        dearestHour: { hour: dearestHour.index, price: dearestHour.price }
    };
}

/**
 * Analysiert die aktuellen Preise der ausgewählten Tankstellen und gibt eine Empfehlung.
 * @param {Array} stationDataArray
 */
function analyzeMultiStationPrices(stationDataArray) {
    const recommendationEl = document.getElementById('recommendation');
    if (stationDataArray.length === 0 || stationDataArray.every(sd => sd.data.length === 0)) {
        recommendationEl.textContent = "Keine Preisdaten für die ausgewählten Tankstellen vorhanden.";
        return;
    }

    // Funktion zum Finden der günstigsten Tankstelle für einen bestimmten Kraftstoff
    const findCheapest = (fuelKey) => {
        let cheapest = { station: null, price: Infinity };
        stationDataArray.forEach(sd => {
            if (sd.data.length > 0) {
                const latestPrice = sd.data[sd.data.length - 1][fuelKey];
                if (latestPrice && latestPrice < cheapest.price) {
                    cheapest = { station: sd.station, price: latestPrice };
                }
            }
        });
        return cheapest.price === Infinity ? null : cheapest;
    };

    const activeFuelTypes = FUEL_TYPE_CONFIG.filter(fuel => state.selectedFuelTypes.includes(fuel.key));
    let recommendationText = '<strong>Aktuell günstigste Preise:</strong><br>';
    let pricesFound = false;

    activeFuelTypes.forEach(fuel => {
        const cheapest = findCheapest(fuel.key);
        if (cheapest) {
            recommendationText += `${fuel.name}: <strong>${formatPrice(cheapest.price)}</strong> bei ${cheapest.station.name}<br>`;
            pricesFound = true;
        }
    });

    if (pricesFound) {
        recommendationEl.innerHTML = recommendationText;
        recommendationEl.style.color = 'black';
    } else {
        recommendationEl.textContent = "Keine aktuellen Preisdaten für die ausgewählten Kraftstoffarten gefunden.";
    }

    // Führe die Preismuster-Analyse durch und zeige sie an
    const patternContainer = document.getElementById('pricePatternAnalysis');
    patternContainer.innerHTML = ''; // Vorherige Ergebnisse löschen

    stationDataArray.forEach(sd => {
        // Analysiere nur, wenn genügend Datenpunkte vorhanden sind (z.B. mehr als 50)
        if (sd.data.length < 50) {
            return;
        }

        const stationAnalysisEl = document.createElement('div');
        stationAnalysisEl.className = 'station-analysis';
        stationAnalysisEl.innerHTML = `<h3>Preismuster für ${sd.station.name}</h3>`;

        activeFuelTypes.forEach(fuel => {
            const patterns = analyzePricePatterns(sd.data, fuel.key);
            if (patterns) {
                const fuelAnalysisEl = document.createElement('p');
                fuelAnalysisEl.innerHTML = `
                    <strong>${fuel.name}:</strong><br>
                    Typisch am günstigsten: <strong>${patterns.cheapestDay.day}s, ca. ${patterns.cheapestHour.hour}:00 Uhr</strong> (Ø ${formatPrice(patterns.cheapestHour.price)})<br>
                    Typisch am teuersten: <strong>${patterns.dearestDay.day}s, ca. ${patterns.dearestHour.hour}:00 Uhr</strong> (Ø ${formatPrice(patterns.dearestHour.price)})
                `;
                stationAnalysisEl.appendChild(fuelAnalysisEl);
            }
        });

        if (stationAnalysisEl.children.length > 1) { // Füge das Element nur hinzu, wenn eine Analyse möglich war
            patternContainer.appendChild(stationAnalysisEl);
        }
    });
}

/**
 * Wird aufgerufen, wenn der Benutzer im Diagramm zoomt. Aktualisiert den Zustand.
 * @param {string} startDate - Das Startdatum als ISO-String.
 * @param {string} endDate - Das Enddatum als ISO-String.
 */
function handleZoom(startDate, endDate) {
    state.selectedTimeRange = { start: new Date(startDate), end: new Date(endDate) };
    saveSelectedTimeRange();
    updateUrlWithState();
    updateTimeRangeRadios(); // Deaktiviert Radios und zeigt Reset-Button
}

/**
 * Setzt den Zoom des Diagramms und den Zeitraum auf "Alle" zurück.
 */
function handleResetZoom() {
    state.selectedTimeRange = 'all';
    saveSelectedTimeRange();

    if (state.priceChart) {
        state.priceChart.resetZoom('none');
    }

    updateChartAndAnalysis();
}

/**
 * Hauptfunktion, die die Anwendung startet.
 */
async function main() {
    setupEventListeners();
    await initializeApp();
}

document.addEventListener('DOMContentLoaded', main);