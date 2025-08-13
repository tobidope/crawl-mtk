from datetime import datetime
import scrapy

from crawl_mtsk.items import GasStationItem


class CleverTankenSpider(scrapy.Spider):
    name = "CleverTanken"
    allowed_domains = ["clever-tanken.de"]
    start_urls = ["https://clever-tanken.de"]

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
            price = float(price.strip())
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
