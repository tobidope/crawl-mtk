# Define your item pipelines here
#
# Don't forget to add your pipeline to the ITEM_PIPELINES setting
# See: https://docs.scrapy.org/en/latest/topics/item-pipeline.html


import logging
import sqlite3
from geopy.adapters import AioHTTPAdapter
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import AsyncRateLimiter
from scrapy.signals import spider_opened, spider_closed


class SQLitePipeline:
    logger = logging.getLogger(__name__)

    def __init__(self, db_path):
        self.db_path = db_path

    @classmethod
    def from_crawler(cls, crawler):
        return cls(db_path=crawler.settings.get("SQLITE_DB_PATH"))

    def open_spider(self, spider):
        self.connection = sqlite3.connect(self.db_path)
        self.create_schema()
        station_ids = self.connection.execute("""
            SELECT station_id, id FROM gas_stations
        """).fetchall()
        self.stations = {station_id: id for station_id, id in station_ids}

    def close_spider(self, spider):
        self.connection.commit()
        self.connection.close()

    def create_schema(self):
        with self.connection:
            self.connection.execute("""
            CREATE TABLE IF NOT EXISTS gas_stations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id TEXT NOT NULL,
                name TEXT,
                address TEXT,
                latitude REAL,
                longitude REAL,
                UNIQUE(station_id)
            )""")

            self.connection.execute("""
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id INTEGER NOT NULL,
                price_diesel REAL,
                price_super REAL,
                price_super_e10 REAL,
                last_transmission TIMESTAMP NOT NULL,
                FOREIGN KEY(station_id) REFERENCES gas_stations(id),
                UNIQUE(station_id, last_transmission)
            )""")

    def process_item(self, item, spider):
        with self.connection:
            # Stammdaten einfügen/aktualisieren
            if item["id"] not in self.stations:
                db_id = self.create_station(item)
                self.stations[item["id"]] = db_id

            item["db_id"] = self.stations[item["id"]]
            if item.get("latitude") is not None:
                self.update_coordinates(item)
            # Preisdaten in Historie einfügen
            self.connection.execute(
                """
                INSERT INTO price_history 
                (station_id, price_diesel, price_super, price_super_e10, last_transmission)
                VALUES (?, ?, ?, ?, ?)
            """,
                (
                    item["db_id"],
                    item.get("price_diesel"),
                    item.get("price_super"),
                    item.get("price_super_e10"),
                    item.get("last_transmission"),
                ),
            )

        return item

    def create_station(self, item):
        result = self.connection.execute(
            """
            INSERT INTO gas_stations (station_id, name, address, latitude, longitude)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id
            """,
            (
                item["id"],
                item["name"],
                item["address"],
                item.get("latitude"),
                item.get("longitude"),
            ),
        ).fetchone()

        return result[0]

    def update_coordinates(self, item):
        self.connection.execute(
            """
            UPDATE gas_stations
            SET latitude = ?, longitude = ?
            WHERE id = ?
            """,
            (item["latitude"], item["longitude"], item["db_id"]),
        )


class GeoCodingPipeline:
    logger = logging.getLogger(__name__)

    def __init__(self, db_path):
        self.db_path = db_path

    def open_spider(self, spider):
        self.connection = sqlite3.connect(self.db_path)

    async def _on_spider_opened(self, spider):
        self.locator = Nominatim(
            user_agent="crawl-mtsk", adapter_factory=AioHTTPAdapter
        )
        await self.locator.__aenter__()
        self.geocode = AsyncRateLimiter(self.locator.geocode, min_delay_seconds=1)

    def close_spider(self, spider):
        self.connection.close()

    async def _on_spider_closed(self, spider):
        await self.locator.__aexit__(None, None, None)

    @classmethod
    def from_crawler(cls, crawler):
        pipeline = cls(db_path=crawler.settings.get("SQLITE_DB_PATH"))
        crawler.signals.connect(pipeline._on_spider_opened, signal=spider_opened)
        crawler.signals.connect(pipeline._on_spider_closed, signal=spider_closed)
        return pipeline

    async def process_item(self, item, spider):
        if not self.needs_geocoding(item):
            return item
        self.logger.info("Geocoding address for %s", item["address"])
        address = self.fix_adresses(item["address"])
        location = await self.geocode(address, language="de", country_codes="de")
        if location:
            self.logger.info("Found coordinates for %s: %s", item["id"], location)
            item["latitude"] = location.latitude
            item["longitude"] = location.longitude
            item["address"] = location.address
        else:
            self.logger.warning(
                "Could not find coordinates for %s: %s", item["id"], item["address"]
            )
            item["latitude"] = None
            item["longitude"] = None
        return item

    def fix_adresses(self, address):
        return (
            address.lower()
            .replace("berg.", "bergisch")
            .replace("str.", "straße")
            .replace("nierosta", "nirosta")
            .replace("linz-kretzhaus", "vettelschoß")
            .replace("wuelfrath", "velbert")
            .replace("saaner", "saarner")
            .replace("-thomasberg", "")
        )

    def needs_geocoding(self, item):
        query = """
            select latitude is null from gas_stations
            where station_id = ?
            """
        result = self.connection.execute(query, (item["id"],)).fetchone()
        self.logger.debug("Checking geocoding need for %s: %s", item["id"], result)
        return result is None or result[0] == 1
