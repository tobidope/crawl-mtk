from datetime import datetime
import os
from typing import Any
import scrapy

from crawl_mtsk.items import GasStationItem


class CleverTankenSpider(scrapy.Spider):
    name = "clevertanken"
    allowed_domains = ["clever-tanken.de"]
    url_template = "https://www.clever-tanken.de/tankstelle_liste?lat={latitude}&lon={longitude}&ort={address}&spritsorte={fuel}&r={radius}"

    def __init__(
        self,
        name: str | None = None,
        address: str = "",
        latitude: str | float | None = None,
        longitude: str | float | None = None,
        radius: str | int = 1,
        **kwargs: Any,
    ):
        super().__init__(name, **kwargs)
        if os.environ.get("SCRAPY_CHECK"):
            return
        self.address = address
        if latitude is None or longitude is None:
            raise ValueError("Both latitude and longitude must be provided.")
        self.latitude = float(latitude)
        self.longitude = float(longitude)
        self.radius = int(radius)

    async def start(self):
        for fuel in (3, 5, 7):
            yield scrapy.Request(
                self.url_template.format(
                    fuel=fuel,
                    radius=self.radius,
                    latitude=self.latitude,
                    longitude=self.longitude,
                    address=self.address,
                ),
                callback=self.parse,
            )

    def parse(self, response):
        yield from response.follow_all(
            response.xpath("//div[@id='main-column-container']/a/@href"),
            self.parse_station,
        )

        next_page = response.css("a.right-arrow.ml-2::attr(href)")
        if next_page:
            yield response.follow(next_page.get(), self.parse)

    def parse_station(self, response):
        item = GasStationItem()
        item["id"] = response.url.split("/")[-1]
        item["name"] = response.css("span.strong-title::text").get()
        address_parts = response.css("div.location-address span::text").getall()
        item["address"] = " ".join(part.strip() for part in address_parts)

        labels = response.css("div.price-type-name::text").getall()
        prices = response.css("div.price-field")
        for label, price in zip(labels, prices, strict=False):
            price = "".join(_.strip() for _ in price.xpath(".//text()").getall())
            if price:
                price = float(price)
            else:
                price = None
            match label:
                case "Diesel":
                    item["price_diesel"] = price
                case "Super E5":
                    item["price_super"] = price
                case "Super E10":
                    item["price_super_e10"] = price

        transmission_date = (
            response.css("div.price-footer span::text").get().split(":", 1)[1].strip()
        )
        if transmission_date:
            item["last_transmission"] = datetime.strptime(
                transmission_date, "%d.%m.%Y %H:%M"
            )
        yield item
