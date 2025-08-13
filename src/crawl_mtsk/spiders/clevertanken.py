import scrapy


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
        yield {}
