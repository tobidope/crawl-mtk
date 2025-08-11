import pytest
from scrapy.http import TextResponse, Request
from crawl_mtsk.spiders.tankentanken import TankenTankenSpider


def test_spider_initialization():
    spider = TankenTankenSpider(latitude="50.0", longitude="8.0")
    assert spider.latitude == 50.0
    assert spider.longitude == 8.0
    assert spider.radius == 10  # default value


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


def test_parse_station_list():
    spider = TankenTankenSpider(latitude="50.0", longitude="8.0")
    with open("tests/fixtures/station_list.html", "rb") as f:
        response = TextResponse(
            url="https://tankentanken.de/suche/supere5/10/address/50.0/8.0",
            body=f.read(),
            encoding="utf-8",
            request=Request(
                url="https://tankentanken.de/suche/supere5/10/address/50.0/8.0"
            ),
        )
    requests = list(spider.parse(response))
    assert len(requests) == 2
    assert requests[0].url == "https://tankentanken.de/tankstelle/123"
    assert requests[1].url == "https://tankentanken.de/tankstelle/456"


def test_parse_station_details():
    spider = TankenTankenSpider(latitude="50.0", longitude="8.0")
    with open("tests/fixtures/station_detail.html", "rb") as f:
        response = TextResponse(
            url="https://tankentanken.de/tankstelle/123",
            body=f.read(),
            encoding="utf-8",
            request=Request(url="https://tankentanken.de/tankstelle/123"),
        )
    items = list(spider.parse_station(response))
    assert len(items) == 1
    item = items[0]
    assert item["id"] == "123"
    assert item["name"] == "Oil!"
    assert item["address"] == "Leverkusener Straße 41, 51467 Bergisch Gladbach"
    assert any(
        key in item for key in ["price_diesel", "price_super", "price_super_e10"]
    )
    assert "address" in item
