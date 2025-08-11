import os
from datetime import datetime
import scrapy

from crawl_mtsk.items import TankenTankenItem


class TankenTankenSpider(scrapy.Spider):
    name = "tankentanken"
    allowed_domains = ["tankentanken.de"]
    URL_TEMPLATE = (
        "https://tankentanken.de/suche/{fuel}/{radius}/address/{latitude}/{longitude}"
    )

    def __init__(
        self,
        name=None,
        fuel="supere5",
        radius=10,
        longitude=None,
        latitude=None,
        **kwargs,
    ):
        super().__init__(name, **kwargs)
        if os.environ.get("SCRAPY_CHECK"):
            return
        self.fuel = fuel
        self.radius = radius
        if latitude is None or longitude is None:
            raise ValueError("Both latitude and longitude must be provided.")
        self.latitude = float(latitude)
        self.longitude = float(longitude)

    async def start(self):
        url = self.URL_TEMPLATE.format(
            fuel=self.fuel,
            radius=self.radius,
            latitude=self.latitude,
            longitude=self.longitude,
        )
        yield scrapy.Request(url=url, callback=self.parse)

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
        item = TankenTankenItem()
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

        prices = response.xpath("//div[@class='price-list']//div[@class='price']")
        for name, price in zip(
            ("price_diesel", "price_super", "price_super_e10"),
            prices,
            strict=True,
        ):
            value = "".join(_.strip() for _ in price.xpath("./*/text()").getall())
            if value:
                item[name] = float(value)

        timestamp_str = response.xpath("//span[@class='time-of-capture']/text()").get()
        if timestamp_str:
            item["last_transmission"] = datetime.strptime(
                timestamp_str.strip(), "%d.%m.%Y / %H:%M"
            )

        yield item
