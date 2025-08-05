import scrapy

from crawl_mtk.items import TankenTankenItem


class TankentankenSpider(scrapy.Spider):
    name = "tankentanken"
    allowed_domains = ["tankentanken.de"]
    start_urls = [
        "https://tankentanken.de/suche/supere10/10/51467%20Bergisch%20Gladbach%2C%20Deutschland/51.01232255/7.1450907597991185"
    ]

    def __init__(self, fuel=None, **kwargs):
        if fuel is None:
            self.fuel = ["supere10", "supere5", "diesel"]
        else:
            self.fuel = fuel.split(",")
        super().__init__(name, **kwargs)

    def parse(self, response):
        for tankstelle in response.xpath('//a[@class="station-item"]'):
            item = TankenTankenItem()
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
