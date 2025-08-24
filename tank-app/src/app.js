import Chart from 'chart.js/auto';
import Fuse from 'fuse.js';

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

        // Lade gespeicherte Tankstellen aus dem LocalStorage
        state.selectedStations = loadSelectedStations(state.allStations);
        state.selectedFuelTypes = loadSelectedFuelTypes();
        state.selectedTimeRange = loadSelectedTimeRange();

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
    updateChartAndAnalysis();
}

/**
 * Behandelt die Änderung der Zeitraums-Auswahl.
 */
function handleTimeRangeChange(event) {
    state.selectedTimeRange = event.target.value;
    saveSelectedTimeRange();
    updateChartAndAnalysis();
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
    localStorage.setItem('selectedTimeRange', state.selectedTimeRange);
}

/**
 * Lädt den Zeitraum aus dem LocalStorage oder gibt einen Standardwert zurück.
 * @returns {string} Der ausgewählte Zeitraum.
 */
function loadSelectedTimeRange() {
    return localStorage.getItem('selectedTimeRange') || 'all';
}

/** Aktualisiert die Radio-Buttons, um den in `state.selectedTimeRange` gespeicherten Zustand widerzuspiegeln. */
function updateTimeRangeRadios() {
    const radioToCheck = document.querySelector(`#timeRangeSelector input[value="${state.selectedTimeRange}"]`);
    if (radioToCheck) {
        radioToCheck.checked = true;
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

    const now = new Date();
    const cutoffDate = new Date();

    if (range === '1d') {
        cutoffDate.setDate(now.getDate() - 1);
    } else if (range === '7d') {
        cutoffDate.setDate(now.getDate() - 7);
    } else if (range === '14d') {
        cutoffDate.setDate(now.getDate() - 14);
    }

    return data.filter(row => new Date(row.last_transmission) >= cutoffDate);
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
 * Hauptfunktion, die die Anwendung startet.
 */
async function main() {
    setupEventListeners();
    await initializeApp();
}

document.addEventListener('DOMContentLoaded', main);