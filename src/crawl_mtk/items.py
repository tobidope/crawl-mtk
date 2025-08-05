# Define here the models for your scraped items
#
# See documentation in:
# https://docs.scrapy.org/en/latest/topics/items.html

import scrapy


class TankenTankenItem(scrapy.Item):
    id = scrapy.Field()
    price = scrapy.Field()
    address = scrapy.Field()
    name = scrapy.Field()
