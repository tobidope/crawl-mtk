import pytest

from crawl_mtsk.pipelines import DBClient


@pytest.fixture
def db_client(tmp_path):
    client = DBClient(tmp_path / "test_db.sqlite")
    client.create_schema()
    yield client
    client.close()


def test_save_item(db_client):
    item = {
        "id": "test_station",
        "name": "Test Station",
        "address": "123 Test St, Test City",
        "price_diesel": 1.5,
        "price_super": 1.6,
        "price_super_e10": 1.55,
        "latitude": 50.0,
        "longitude": 8.0,
        "last_transmission": "2023-10-01T12:00:00Z",
    }
    db_client.save_item(item)

    # Verify the item was saved correctly
    result = db_client.connection.execute(
        """
        SELECT id, station_id, name, address
        FROM gas_stations WHERE station_id = ?""",
        (item["id"],),
    ).fetchone()

    assert result is not None
    db_id = result[0]
    assert db_id is not None
    assert result[1] == item["id"]
    assert result[2] == item["name"]
    assert result[3] == item["address"]

    # Verify the prices were saved correctly
    result = db_client.connection.execute(
        """
        SELECT price_diesel, price_super, price_super_e10, last_transmission
        FROM price_history WHERE station_id = ?""",
        (db_id,),
    ).fetchone()

    assert result is not None
    assert result[0] == item["price_diesel"]
    assert result[1] == item["price_super"]
    assert result[2] == item["price_super_e10"]
    assert result[3] == item["last_transmission"]

    # Verify the geocoding was saved
    result = db_client.connection.execute(
        """
        SELECT latitude, longitude FROM gas_stations WHERE id = ?""",
        (db_id,),
    ).fetchone()

    assert result is not None
    assert result[0] == item["latitude"]
    assert result[1] == item["longitude"]


def test_save_item_second_time_works(db_client):
    item = {
        "id": "test_station",
        "name": "Test Station",
        "address": "123 Test St, Test City",
        "price_diesel": 1.5,
        "price_super": 1.6,
        "price_super_e10": 1.55,
        "latitude": 50.0,
        "longitude": 8.0,
        "last_transmission": "2023-10-01T12:00:00Z",
    }
    db_client.save_item(item)
    item["last_transmission"] = "2023-10-01T12:01:00Z"
    db_client.save_item(item)

    result = db_client.connection.execute(
        "select count(*) from gas_stations"
    ).fetchone()
    assert result[0] == 1

    result = db_client.connection.execute(
        "select count(*) from price_history"
    ).fetchone()
    assert result[0] == 2


def test_is_geocoded(db_client):
    item = {
        "id": "test_station",
        "name": "Test Station",
        "address": "123 Test St, Test City",
        "latitude": 50.0,
        "longitude": 8.0,
        "last_transmission": "2023-10-01T12:00:00Z",
    }
    db_client.save_item(item)

    assert db_client.is_geocoded(item) is True

    # Check with an item that has no coordinates
    item_no_coords = {
        "id": "test_station_no_coords",
    }
    assert db_client.is_geocoded(item_no_coords) is False
