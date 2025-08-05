from base64 import urlsafe_b64decode
import os
import scrapy

from crawl_mtk.items import TankenTankenItem


class TankentankenSpider(scrapy.Spider):
    name = "tankentanken"
    allowed_domains = ["tankentanken.de"]
    URL_TEMPLATE = (
        "https://tankentanken.de/suche/{fuel}/{radius}/address/{latitude}/{longitude}"
    )

    def __init__(
        self,
        name=None,
        fuel="supere10",
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
        self.latitude = latitude
        self.longitude = longitude

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

        @url https://tankentanken.de/suche/supere5/1/Dorsten%2C%20NW%2C%20Deutschland/51.6604071/6.9647431
        @returns items 1 2
        @returns requests 0 0
        @scrapes id name price address
        """
        for tankstelle in response.xpath('//a[@class="station-item"]'):
            item = TankenTankenItem()
            item["id"] = tankstelle.xpath(".//@href").get().strip().split("/")[-1]
            item["name"] = (
                tankstelle.xpath('.//div[@class="name"]/text()').get().strip()
            )
            # Extrahiere Hauptteil und Nachkommastelle des Preises
            price_main = tankstelle.xpath('.//div[@class="price"]/text()').get().strip()
            price_fraction = (
                tankstelle.xpath('.//div[@class="price"]/sup/text()').get().strip()
            )
            item["price"] = float(f"{price_main}{price_fraction}")
            item["address"] = ", ".join(
                s.strip()
                for s in tankstelle.xpath(
                    './/div[@class="adress uppercase"]/text()'
                ).getall()
            )
            yield item
