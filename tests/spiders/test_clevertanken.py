from datetime import datetime
import pytest
from scrapy.http import TextResponse, Request

from crawl_mtsk.items import GasStationItem
from crawl_mtsk.spiders.clevertanken import CleverTankenSpider


@pytest.fixture
def station_list():
    with open("tests/fixtures/clever_tanken_station_list.html", "rb") as f:
        return TextResponse(
            url="https://clever-tanken.de/tankstelle_liste?lat=51.0122841512018&lon=7.14506200022488&ort=51467+Bergisch+Gladbach&spritsorte=5&r=20",
            body=f.read(),
            encoding="utf-8",
            request=Request(
                url="https://clever-tanken.de/tankstelle_liste?lat=51.0122841512018&lon=7.14506200022488&ort=51467+Bergisch+Gladbach&spritsorte=5&r=20"
            ),
        )


@pytest.fixture
def station_detail():
    with open("tests/fixtures/clever_tanken_station_detail.html", "rb") as f:
        return TextResponse(
            url="https://www.clever-tanken.de/tankstelle_details/8884",
            body=f.read(),
            encoding="utf-8",
            request=Request(url="https://www.clever-tanken.de/tankstelle_details/8884"),
        )


def test_spider_parse(station_list):
    spider = CleverTankenSpider("adresse", "50.0", "8.0")

    requests = list(spider.parse(station_list))

    assert len(requests) > 0
    assert all(isinstance(req, Request) for req in requests)
    assert requests[0].callback == spider.parse_station
    assert requests[0].url == "https://clever-tanken.de/tankstelle_details/15176"
    assert (
        requests[-1].url
        == "https://clever-tanken.de/tankstelle_liste?spritsorte=5&r=10&ort=51069+K%C3%B6ln%2FDellbr%C3%BCck&lon=7.07410617479976&lat=50.9759207973319&page=2"
    )
    assert requests[-1].callback == spider.parse


def test_spider_parse_station(station_detail):
    spider = CleverTankenSpider("adresse", "50.0", "8.0")

    result = list(spider.parse_station(station_detail))

    assert len(result) == 1
    item = result[0]
    assert isinstance(item, GasStationItem)
    assert item["id"] == "8884"
    assert item["name"] == "TotalEnergies"
    assert item["address"] == "Bonner Str. 417-425 50968 Köln"
    assert item["price_diesel"] == 1.559
    assert item["price_super"] == 1.649
    assert item["price_super_e10"] == 1.589
    assert item["last_transmission"] == datetime.fromisoformat("2025-08-13 16:23")
