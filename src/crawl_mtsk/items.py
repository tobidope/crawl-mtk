# Define here the models for your scraped items
#
# See documentation in:
# https://docs.scrapy.org/en/latest/topics/items.html

import scrapy


class TankenTankenItem(scrapy.Item):
    id = scrapy.Field()
    price_diesel = scrapy.Field()
    price_super = scrapy.Field()
    price_super_e10 = scrapy.Field()
    address = scrapy.Field()
    name = scrapy.Field()
    last_transmission = scrapy.Field()
    latitude = scrapy.Field()
    longitude = scrapy.Field()
    db_id = scrapy.Field()
