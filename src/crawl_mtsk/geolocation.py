import sqlite3
import sys
import time
from geopy.geocoders import Nominatim


def main():
    db = sys.argv[1]
    print(f"Using database: {db}")

    locator = Nominatim(user_agent="crawl_mtsk_geolocation")
    connection = sqlite3.connect(db)
    sql = """
        SELECT id, address FROM gas_stations
        WHERE latitude IS NULL OR longitude IS NULL
    """
    for station in connection.execute(sql):
        station_id, address = station
        address = address.replace("BERG.", "BERGISCH")
        location = locator.geocode(address)
        if location:
            print(
                f"Updating {station_id} with coordinates: {location.latitude}, {location.longitude}"
            )
            with connection:
                connection.execute(
                    "UPDATE gas_stations SET latitude = ?, longitude = ? WHERE id = ?",
                    (location.latitude, location.longitude, station_id),
                )
        else:
            print(f"Could not find coordinates for {station_id} at address: {address}")
        # sleep for 1 second
        time.sleep(1)
