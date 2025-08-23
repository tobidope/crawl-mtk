import Chart from 'chart.js/auto';
import Fuse from 'fuse.js';

const API_BASE_URL = "https://datasette.familie-bell.com"; // Deine datasette URL
const DB_NAME = "tankentanken"; // Der Name deiner Datenbankdatei ohne .db

let priceChart;
let fuse;
let allStations = [];
let selectedStations = [];
let selectedFuelTypes = [];

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
 * Initialisiert die Anwendung: Lädt die Tankstellen und richtet die Suche ein.
 */
async function init() {
    const searchInput = document.getElementById('stationSearch');
    searchInput.addEventListener('input', handleSearchInput);
    document.querySelectorAll('#fuelTypeSelector input[name="fuel"]').forEach(checkbox => {
        checkbox.addEventListener('change', handleFuelTypeChange);
    });

    try {
        allStations = await fetchStations();

        // Fuse.js für die Fuzzy-Suche initialisieren
        const options = {
            keys: ['name', 'address'],
            includeScore: true,
            threshold: 0.4 // Schwellenwert anpassen für mehr/weniger "Fuzziness"
        };
        fuse = new Fuse(allStations, options);

        // Lade gespeicherte Tankstellen aus dem LocalStorage
        loadSelectedStations();
        loadSelectedFuelTypes();
        renderSelectedStations();
        if (selectedStations.length > 0) {
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
    selectedFuelTypes = Array.from(document.querySelectorAll('#fuelTypeSelector input[name="fuel"]:checked')).map(cb => cb.value);
    saveSelectedFuelTypes();
    updateChartAndAnalysis();
}

/**
 * Ruft die Liste aller Tankstellen von der datasette API ab.
 */
async function fetchStations() {
    // Diese Abfrage holt alle eindeutigen Tankstellen
    const sqlQuery = `select station_id, name, address from gas_stations order by name;`;
    const response = await fetch(`${API_BASE_URL}/${DB_NAME}.json?_shape=array&sql=${encodeURIComponent(sqlQuery)}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
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
    const results = fuse.search(searchTerm);
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
    if (selectedStations.find(s => s.station_id === station.station_id)) {
        clearSearchResults();
        document.getElementById('stationSearch').value = '';
        return;
    }

    selectedStations.push(station);
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
    selectedStations.forEach(station => {
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
    selectedStations = selectedStations.filter(s => s.station_id !== stationId);
    saveSelectedStations();
    renderSelectedStations();
    updateChartAndAnalysis();
}

/**
 * Speichert die IDs der ausgewählten Tankstellen im LocalStorage.
 */
function saveSelectedStations() {
    const stationIds = selectedStations.map(s => s.station_id);
    localStorage.setItem('selectedStationIds', JSON.stringify(stationIds));
}

/**
 * Lädt die IDs aus dem LocalStorage und füllt die `selectedStations`-Liste.
 */
function loadSelectedStations() {
    const savedIds = JSON.parse(localStorage.getItem('selectedStationIds') || '[]');
    if (savedIds.length > 0 && allStations.length > 0) {
        // Finde die vollständigen Tankstellen-Objekte anhand der gespeicherten IDs
        selectedStations = savedIds.map(id => allStations.find(s => s.station_id === id)).filter(Boolean);
    }
}

/**
 * Speichert die Auswahl der Treibstoffe im LocalStorage.
 */
function saveSelectedFuelTypes() {
    localStorage.setItem('selectedFuelTypes', JSON.stringify(selectedFuelTypes));
}

/**
 * Lädt die Treibstoffauswahl aus dem LocalStorage.
 */
function loadSelectedFuelTypes() {
    const savedTypes = JSON.parse(localStorage.getItem('selectedFuelTypes'));
    // Standardmäßig alle anzeigen, wenn nichts gespeichert ist.
    selectedFuelTypes = savedTypes !== null ? savedTypes : FUEL_TYPE_CONFIG.map(ft => ft.key);

    // Aktualisiere die Checkboxen, um den geladenen Zustand widerzuspiegeln
    document.querySelectorAll('#fuelTypeSelector input[name="fuel"]').forEach(checkbox => {
        checkbox.checked = selectedFuelTypes.includes(checkbox.value);
    });
}
/**
 * Hauptfunktion, die das Abrufen von Daten und die Aktualisierung von Diagramm und Analyse auslöst.
 */
async function updateChartAndAnalysis() {
    const recommendationEl = document.getElementById('recommendation');
    if (selectedStations.length === 0) {
        if (priceChart) priceChart.destroy();
        recommendationEl.textContent = "Wähle eine oder mehrere Tankstellen aus, um die Analyse zu starten.";
        recommendationEl.style.color = 'black';
        return;
    }

    recommendationEl.textContent = 'Lade Preisdaten...';

    try {
        // Rufe Preisdaten für alle ausgewählten Tankstellen parallel ab
        const priceDataPromises = selectedStations.map(station => fetchPriceHistory(station.station_id));
        const results = await Promise.all(priceDataPromises);

        const stationDataArray = selectedStations.map((station, index) => ({
            station: station,
            data: results[index]
        }));

        renderMultiStationChart(stationDataArray);
        analyzeMultiStationPrices(stationDataArray);
    } catch (error) {
        console.error("Fehler beim Abrufen der Preis-Historien:", error);
        recommendationEl.textContent = "Fehler beim Laden der Preisdaten.";
        recommendationEl.style.color = 'red';
    }
}

/**
 * Ruft die Preis-Historie für eine bestimmte Tankstellen-ID ab.
 */
async function fetchPriceHistory(stationId) {
    // Diese SQL-Abfrage verbindet die Preishistorie mit den Stammdaten der Tankstelle.
    const sqlQuery = `
        SELECT
          ph.last_transmission,
          ph.price_diesel,
          ph.price_super,
          ph.price_super_e10
        FROM price_history ph
        JOIN gas_stations gs ON ph.station_id = gs.id
        WHERE gs.station_id = :station_id
        ORDER BY ph.last_transmission;
    `;
    const url = `${API_BASE_URL}/${DB_NAME}.json?_shape=array&sql=${encodeURIComponent(sqlQuery)}&station_id=${stationId}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Fehler beim Abrufen der Preis-Historie:", error);
        return []; // Gib ein leeres Array zurück, um Promise.all nicht zu unterbrechen
    }
}

/**
 * Rendert das Diagramm mit den Preisdaten von mehreren Tankstellen.
 * @param {Array} stationDataArray - Ein Array von Objekten, die Tankstelle und Preisdaten enthalten.
 */
function renderMultiStationChart(stationDataArray) {
    const ctx = document.getElementById('priceChart').getContext('2d');

    if (priceChart) {
        priceChart.destroy(); // Zerstöre altes Diagramm, bevor ein neues gezeichnet wird
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
    const activeFuelTypes = FUEL_TYPE_CONFIG.filter(fuel => selectedFuelTypes.includes(fuel.key));

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

    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedLabels,
            datasets: datasets
        }
    });
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

    const activeFuelTypes = FUEL_TYPE_CONFIG.filter(fuel => selectedFuelTypes.includes(fuel.key));
    let recommendationText = '<strong>Aktuell günstigste Preise:</strong><br>';
    let pricesFound = false;

    activeFuelTypes.forEach(fuel => {
        const cheapest = findCheapest(fuel.key);
        if (cheapest) {
            recommendationText += `${fuel.name}: <strong>${cheapest.price.toFixed(3)}€</strong> bei ${cheapest.station.name}<br>`;
            pricesFound = true;
        }
    });

    if (pricesFound) {
        recommendationEl.innerHTML = recommendationText;
        recommendationEl.style.color = 'black';
    } else {
        recommendationEl.textContent = "Keine aktuellen Preisdaten für die ausgewählten Kraftstoffarten gefunden.";
    }
}

// Starte die Anwendung, wenn das DOM geladen ist.
document.addEventListener('DOMContentLoaded', init);