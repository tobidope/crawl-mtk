# Define your item pipelines here
#
# Don't forget to add your pipeline to the ITEM_PIPELINES setting
# See: https://docs.scrapy.org/en/latest/topics/item-pipeline.html


import sqlite3


class SQLitePipeline:
    def __init__(self, db_path):
        self.db_path = db_path

    @classmethod
    def from_crawler(cls, crawler):
        return cls(db_path=crawler.settings.get("SQLITE_DB_PATH"))

    def open_spider(self, spider):
        self.connection = sqlite3.connect(self.db_path)
        self.create_table()

    def create_table(self):
        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS gas_stations (
                id TEXT PRIMARY KEY,
                name TEXT,
                address TEXT,
                latitude REAL,
                longitude REAL
            )
        """)

        self.connection.execute("""
            CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                station_id TEXT,
                price_diesel REAL,
                price_super REAL,
                price_super_e10 REAL,
                last_transmission TIMESTAMP,
                FOREIGN KEY(station_id) REFERENCES gas_stations(id),
                UNIQUE(station_id, last_transmission)
            )
        """)
        self.connection.commit()
        station_ids = self.connection.execute("""
            SELECT id FROM gas_stations
        """).fetchall()
        self.stations = frozenset(station_ids)

    def close_spider(self, spider):
        self.connection.close()

    def process_item(self, item, spider):
        # Stammdaten einfügen/aktualisieren
        if item["id"] not in self.stations:
            self.connection.execute(
                """
                INSERT INTO gas_stations (id, name, address)
                VALUES (?, ?, ?)
            """,
                (item["id"], item["name"], item["address"]),
            )

        # Preisdaten in Historie einfügen
        self.connection.execute(
            """
            INSERT INTO price_history 
            (station_id, price_diesel, price_super, price_super_e10, last_transmission)
            VALUES (?, ?, ?, ?, ?)
        """,
            (
                item["id"],
                item.get("price_diesel"),
                item.get("price_super"),
                item.get("price_super_e10"),
                item.get("last_transmission"),
            ),
        )
        self.connection.commit()
        return item
