# Define your item pipelines here
#
# Don't forget to add your pipeline to the ITEM_PIPELINES setting
# See: https://docs.scrapy.org/en/latest/topics/item-pipeline.html


import logging
import sqlite3
from geopy.adapters import AioHTTPAdapter
from geopy.geocoders import GoogleV3
from scrapy.signals import spider_opened, spider_closed

logger = logging.getLogger(__name__)


class DBClient:
    logger = logging.getLogger(__name__)

    def __init__(self, db_path: str):
        self.connection = sqlite3.connect(db_path)
        self.station_cache = {}

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

    def save_item(self, item):
        self._create_cache()
        with self.connection:
            # Stammdaten einfügen/aktualisieren
            self._create_station(item)
            self._update_coordinates(item)
            self._save_prices(item)
            return item

    def is_geocoded(self, item):
        query = """
            select latitude from gas_stations
            where station_id = ?
            """
        result = self.connection.execute(query, (item["id"],)).fetchone()
        logger.debug("Checking geocoding need for %s: %s", item["id"], result)
        return result is not None and result[0] is not None

    def _create_station(self, item):
        if item["id"] not in self.station_cache:
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
            db_id = result[0]
            self.station_cache[item["id"]] = db_id
        item["db_id"] = self.station_cache[item["id"]]

    def _update_coordinates(self, item):
        if item.get("latitude") is not None:
            self.connection.execute(
                """
                UPDATE gas_stations
                SET latitude = ?, longitude = ?
                WHERE id = ?
                """,
                (item["latitude"], item["longitude"], item["db_id"]),
            )

    def _save_prices(self, item):
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

    def _create_cache(self):
        if self.station_cache:
            return
        logger.info("Creating station cache")
        station_ids = self.connection.execute("""
            SELECT station_id, id FROM gas_stations
        """).fetchall()
        self.station_cache = {station_id: id for station_id, id in station_ids}

    def close(self):
        self.connection.commit()
        self.connection.close()


class SQLitePipeline:
    def __init__(self, client: DBClient):
        self.client = client

    @classmethod
    def from_crawler(cls, crawler):
        db_path = crawler.settings.get("SQLITE_DB_PATH")
        client = DBClient(db_path)
        return cls(client=client)

    def open_spider(self, spider):
        self.client.create_schema()

    def close_spider(self, spider):
        self.client.close()

    def process_item(self, item, spider):
        return self.client.save_item(item)


class GeoCodingPipeline:
    def __init__(self, db_client: DBClient):
        self.db_client = db_client

    def open_spider(self, spider):
        self.db_client.create_schema()

    async def _on_spider_opened(self, spider):
        self.locator = GoogleV3(
            api_key=spider.settings.get("GOOGLE_MAPS_API_KEY"),
            user_agent="crawl-mtsk",
            adapter_factory=AioHTTPAdapter,
        )
        await self.locator.__aenter__()

    def close_spider(self, spider):
        self.db_client.close()

    async def _on_spider_closed(self, spider):
        await self.locator.__aexit__(None, None, None)

    @classmethod
    def from_crawler(cls, crawler):
        client = DBClient(db_path=crawler.settings.get("SQLITE_DB_PATH"))
        pipeline = cls(client)
        crawler.signals.connect(pipeline._on_spider_opened, signal=spider_opened)
        crawler.signals.connect(pipeline._on_spider_closed, signal=spider_closed)
        return pipeline

    async def process_item(self, item, spider):
        if self.db_client.is_geocoded(item):
            logger.debug("Item %s already geocoded, skipping", item["id"])
            return item
        logger.info("Geocoding address for %s", item["address"])
        address = self.fix_adresses(item["address"])
        location = await self.locator.geocode(address, exactly_one=True)
        if location:
            logger.info("Found coordinates for %s: %s", item["id"], location)
            item["latitude"] = location.latitude
            item["longitude"] = location.longitude
            item["address"] = location.address
        else:
            logger.warning(
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
