import pytest
from scrapy.http import TextResponse, Request
from crawl_mtsk.spiders.tankentanken import TankenTankenSpider


@pytest.fixture
def station_detail():
    with open("tests/fixtures/station_detail.html", "rb") as f:
        return TextResponse(
            url="https://tankentanken.de/tankstelle/123",
            body=f.read(),
            encoding="utf-8",
            request=Request(url="https://tankentanken.de/tankstelle/123"),
        )


@pytest.fixture
def station_list():
    with open("tests/fixtures/station_list.html", "rb") as f:
        return TextResponse(
            url="https://tankentanken.de/suche/supere5/10/address/50.0/8.0",
            body=f.read(),
            encoding="utf-8",
            request=Request(
                url="https://tankentanken.de/suche/supere5/10/address/50.0/8.0"
            ),
        )


def test_spider_initialization():
    spider = TankenTankenSpider(latitude="50.0", longitude="8.0")
    assert spider.locations[0]["latitude"] == 50.0
    assert spider.locations[0]["longitude"] == 8.0
    assert spider.locations[0]["radius"] == 10  # default value


def test_spider_initialization_with_locations():
    locations = '[{"latitude": "50.0", "longitude": "8.0", "radius": 5}]'
    spider = TankenTankenSpider(locations=locations)
    assert len(spider.locations) == 1
    assert spider.locations[0]["latitude"] == 50.0
    assert spider.locations[0]["longitude"] == 8.0
    assert spider.locations[0]["radius"] == 5


def test_spider_missing_coordinates():
    with pytest.raises(
        ValueError, match="Both latitude and longitude must be provided."
    ):
        TankenTankenSpider()


@pytest.mark.asyncio
async def test_start():
    spider = TankenTankenSpider(latitude="50.0", longitude="8.0")
    result = [_ async for _ in spider.start()]
    request = result[0]
    assert request.url == "https://tankentanken.de/suche/supere5/10/address/50.0/8.0"


def test_parse_station_list(station_list):
    spider = TankenTankenSpider(latitude="50.0", longitude="8.0")

    requests = list(spider.parse(station_list))

    assert len(requests) == 2
    assert requests[0].url == "https://tankentanken.de/tankstelle/123"
    assert requests[1].url == "https://tankentanken.de/tankstelle/456"


def test_parse_station_details(station_detail):
    spider = TankenTankenSpider(latitude="50.0", longitude="8.0")

    items = list(spider.parse_station(station_detail))

    assert len(items) == 1
    item = items[0]
    assert item["id"] == "123"
    assert item["name"] == "Oil!"
    assert item["address"] == "Leverkusener Straße 41, 51467 Bergisch Gladbach"
    assert any(
        key in item for key in ["price_diesel", "price_super", "price_super_e10"]
    )
    assert item["price_diesel"] == 1.509
    assert item["price_super_e10"] == 1.579
    assert item["price_super"] == 1.639
    assert "address" in item
