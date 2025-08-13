import pytest
from scrapy.http import TextResponse, Request

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


def test_spider_parse(station_list):
    spider = CleverTankenSpider()

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


def test_spider_parse_station(station_list):
    pass
