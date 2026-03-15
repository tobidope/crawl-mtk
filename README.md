# Dokumentation: CleverTanken Spider

## Übersicht

Der `clevertanken` Spider ist ein Scrapy-Spider, der die Website [clever-tanken.de](https://www.clever-tanken.de) crawlt, um aktuelle Kraftstoffpreise von Tankstellen in Deutschland zu sammeln. Er extrahiert Informationen wie Tankstellenname, Adresse, Preise für Diesel, Super E5 und Super E10 sowie das Datum der letzten Preisübertragung.

Der Spider ist Teil des `crawl-mtsk` Projekts und verwendet Scrapy für das Web-Scraping.

## Voraussetzungen

- Python 3.12 oder höher
- uv (für Dependency-Management)
- Scrapy (wird automatisch über uv installiert)

## Installation

1. Klonen Sie das Repository oder navigieren Sie zum Projektverzeichnis:
   ```
   cd /Users/tobias/code/crawl-mtk
   ```

2. Installieren Sie die Abhängigkeiten mit uv:
   ```
   uv sync
   ```

## Nutzung

Der Spider wird über die Scrapy-Befehlszeile ausgeführt. Verwenden Sie `uv run scrapy crawl clevertanken` mit den erforderlichen Parametern.

### Grundlegende Syntax

```
uv run scrapy crawl clevertanken -a address="IhreAdresse" -a latitude=WERT -a longitude=WERT [-a radius=WERT]
```

### Erforderliche Parameter

- `address`: Die Adresse als String (z.B. "Berlin, Deutschland"). Wird für die URL-Konstruktion verwendet.
- `latitude`: Der Breitengrad als Float (z.B. 52.5200).
- `longitude`: Der Längengrad als Float (z.B. 13.4050).

### Optionale Parameter

- `radius`: Der Suchradius in Kilometern (Standard: 1). Beeinflusst, wie viele Tankstellen gefunden werden.

### Beispielaufrufe

1. **Einfacher Aufruf für Berlin:**
   ```
   uv run scrapy crawl clevertanken -a address="Berlin, Deutschland" -a latitude=52.5200 -a longitude=13.4050
   ```

2. **Mit größerem Radius (5 km):**
   ```
   uv run scrapy crawl clevertanken -a address="Berlin, Deutschland" -a latitude=52.5200 -a longitude=13.4050 -a radius=5
   ```

3. **Ausgabe in JSON-Datei speichern:**
   ```
   uv run scrapy crawl clevertanken -a address="Berlin, Deutschland" -a latitude=52.5200 -a longitude=13.4050 -o output.json
   ```

## Funktionsweise

1. **Startphase:** Der Spider generiert Anfragen für verschiedene Kraftstofftypen (Diesel, Super E5, Super E10) basierend auf den übergebenen Koordinaten und dem Radius.

2. **Listen-Parsing:** Er parst die Tankstellenliste und folgt Links zu den Detailseiten jeder Tankstelle.

3. **Detail-Parsing:** Auf jeder Tankstellenseite extrahiert er:
   - Tankstellen-ID
   - Name
   - Adresse
   - Kraftstoffpreise (Diesel, Super E5, Super E10)
   - Datum der letzten Preisübertragung

4. **Paginierung:** Falls mehrere Seiten vorhanden sind, folgt der Spider automatisch der nächsten Seite.

## Ausgabedaten

Der Spider gibt `GasStationItem`-Objekte aus, die folgende Felder enthalten:

- `id`: Eindeutige ID der Tankstelle
- `name`: Name der Tankstelle
- `address`: Vollständige Adresse
- `price_diesel`: Preis für Diesel (Float oder None)
- `price_super`: Preis für Super E5 (Float oder None)
- `price_super_e10`: Preis für Super E10 (Float oder None)
- `last_transmission`: Datum und Uhrzeit der letzten Preisübertragung (datetime-Objekt)
- `latitude`: Breitengrad (wird in Pipelines hinzugefügt)
- `longitude`: Längengrad (wird in Pipelines hinzugefügt)
- `db_id`: Datenbank-ID (wird in Pipelines hinzugefügt)

## Pipelines und Middleware

Das Projekt verwendet Pipelines zur Datenverarbeitung:
- `LocationPipeline`: Fügt Geokoordinaten hinzu
- `DatabasePipeline`: Speichert Daten in einer Datenbank

Middleware wie `RandomUserAgentMiddleware` und `RetryMiddleware` sorgen für robustes Scraping.

## Konfiguration

Die Spider-Einstellungen sind in `settings.py` definiert:
- User-Agent: Firefox 141.0
- Robots.txt: Nicht befolgt (für Scraping)
- Download-Delay: 0 (keine Verzögerung)
- Cookies: Deaktiviert

## Fehlerbehebung

- **Fehlende Koordinaten:** Stellen Sie sicher, dass `latitude` und `longitude` angegeben sind.
- **Keine Ergebnisse:** Überprüfen Sie die Adresse und Koordinaten. Erhöhen Sie den Radius bei Bedarf.
- **Scrapy-Fehler:** Führen Sie `uv run scrapy check` aus, um die Spider-Integrität zu prüfen.

## Tests

Führen Sie die Tests aus, um die Funktionalität zu überprüfen:
```
uv run pytest
```

Spezifische Tests für den Spider befinden sich in `tests/spiders/test_clevertanken.py`.

## Lizenz und Haftung

Beachten Sie die Nutzungsbedingungen von clever-tanken.de. Das Scraping erfolgt auf eigene Verantwortung. Verwenden Sie den Spider verantwortungsvoll und respektieren Sie die Website-Richtlinien.