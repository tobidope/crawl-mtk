import sqlite3
import sys
import time
from geopy.geocoders import Nominatim


def fix_adresses(address):
    return address.lower().replace("berg.", "bergisch")


def main():
    db = sys.argv[1]
    print(f"Using database: {db}")

    locator = Nominatim(user_agent="crawl_mtsk_geolocation")
    connection = sqlite3.connect(db)
    sql = """
        SELECT id, address FROM gas_stations
        WHERE latitude IS NULL OR longitude IS NULL
    """
    try:
        for station in connection.execute(sql):
            station_id, address = station
            address = fix_adresses(address)
            location = None
            for _ in range(3):
                try:
                    location = locator.geocode(address)
                    break
                except Exception as e:
                    print(f"Error geocoding {station_id} at address: {address} - {e}")
                    time.sleep(30)
            else:
                print(f"Failed to geocode {station_id} at address: {address}")
                continue

            if not location:
                print(
                    f"Could not find coordinates for {station_id} at address: {address}"
                )
                continue

            print(
                f"Updating {station_id} with coordinates: {location.latitude}, {location.longitude}"
            )
            for _ in range(3):
                try:
                    with connection:
                        connection.execute(
                            "UPDATE gas_stations SET latitude = ?, longitude = ? WHERE id = ?",
                            (location.latitude, location.longitude, station_id),
                        )
                    break
                except sqlite3.OperationalError as e:
                    print(f"Error updating {station_id}: {e}")
                    time.sleep(30)
            else:
                print(f"Failed to update {station_id} after multiple attempts")
    finally:
        connection.commit()
        connection.close()
    return 0
