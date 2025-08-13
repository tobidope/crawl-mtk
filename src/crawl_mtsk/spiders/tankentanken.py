import os
from datetime import datetime
import scrapy

from crawl_mtsk.items import GasStationItem


class TankenTankenSpider(scrapy.Spider):
    name = "tankentanken"
    allowed_domains = ["tankentanken.de"]
    URL_TEMPLATE = (
        "https://tankentanken.de/suche/{fuel}/{radius}/address/{latitude}/{longitude}"
    )

    def __init__(
        self,
        name=None,
        radius=10,
        longitude=None,
        latitude=None,
        **kwargs,
    ):
        super().__init__(name, **kwargs)
        if os.environ.get("SCRAPY_CHECK"):
            return
        self.radius = int(radius)
        if latitude is None or longitude is None:
            raise ValueError("Both latitude and longitude must be provided.")
        self.latitude = float(latitude)
        self.longitude = float(longitude)

    async def start(self):
        for fuel in ("supere5", "diesel", "super_e10"):
            yield scrapy.Request(
                url=self.URL_TEMPLATE.format(
                    fuel=fuel,
                    radius=self.radius,
                    latitude=self.latitude,
                    longitude=self.longitude,
                ),
                callback=self.parse,
            )

    def parse(self, response):
        """

        @url https://tankentanken.de/suche/supere10/1/Berlin%2C%20Deutschland/52.510885/13.3989367
        @returns request 1 1
        """
        yield from response.follow_all(
            xpath='//a[@class="station-item"]/@href', callback=self.parse_station
        )

    def parse_station(self, response):
        """
        @url https://tankentanken.de/tankstelle/594eafdd-3537-45ae-8bf0-d667aaa25454
        @returns items 1 1
        @scrapes id name address price_diesel price_super price_super_e10 last_transmission
        """
        item = GasStationItem()
        item["id"] = response.url.split("/")[-1]

        item["name"] = (
            "".join(_ for _ in response.css("div.headline.uppercase *::text").getall())
            .split("|")[0]
            .strip()
        )

        item["address"] = ", ".join(
            _.strip()
            for _ in response.xpath(
                "//div[@class='article']/h3//following-sibling::p/text()"
            ).getall()
        )

        labels = response.css("div.label::text").getall()
        prices = response.css("div.price")
        for label, price in zip(labels, prices, strict=False):
            price = "".join(_.strip() for _ in price.xpath(".//text()").getall())
            if price:
                price = float(price.strip())
            else:
                price = None
            match label:
                case "Diesel:":
                    item["price_diesel"] = price
                case "Super:":
                    item["price_super"] = price
                case "Super E10:":
                    item["price_super_e10"] = price

        timestamp_str = response.xpath("//span[@class='time-of-capture']/text()").get()
        if timestamp_str:
            item["last_transmission"] = datetime.strptime(
                timestamp_str.strip(), "%d.%m.%Y / %H:%M"
            )

        yield item
