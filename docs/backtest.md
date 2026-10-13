# City-entry backtest

`npm run backtest -w @tastedraft/api` asks live Qloo about five sourced entries. Each row searches the brand, then requests places, a heatmap, and a demographics-modified place list in the city string below. The city is not rewritten. Tokyo stays Tokyo. Reading is sent as `Reading, United Kingdom`. The US West Coast row is Los Angeles, for Tesco’s banner Fresh & Easy. The sample engine is not called, so nothing here falls back to a Los Angeles score.

Qloo does not return a cultural resonance score, and these calls are not a sales forecast. Place affinity is the median `query.affinity` of up to eight places. Heat affinity is the median weight of heatmap cells that fall inside a box around the asked city. Cells outside that box are counted, then dropped from the median. The heatmap request does not send `output.heatmap.boundary`.

| Brand | City sent | Outcome | Entity Qloo resolved | Places | Median place affinity | Heatmap cells in the city box | Median heat in the box | Demographics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Muji | New York | Stayed | Muji | 8 | 0.88 | 96 of 599 | 0.83 | ok |
| Blue Bottle | Tokyo | Stayed | Blue Bottle Coffee | 8 | 0.89 | 55 of 64 | 0.56 | ok |
| Shake Shack | Tokyo | Stayed | Shake Shack | 8 | 0.89 | 62 of 76 | 0.59 | ok |
| Chick-fil-A | Reading, United Kingdom | Left | Chick-fil-A | 8 | 0.88 | 3 of 3 | 0.50 | ok |
| Fresh & Easy | Los Angeles | Left | Fresh & Easy | 8 | 1.00 | HTTP 400, no cells | — | ok |

## How this lines up

It does not separate stayed from left.

Place affinity for the three brands that stayed is 0.88, 0.89, and 0.89. Chick-fil-A left and sits at 0.88, the same band as Muji. Fresh & Easy left and has the highest place affinity in the table, 1.00.

Heat affinity is not a ranking of the outcome either. Muji, which stayed, has the highest in-box median, 0.83, but 503 of its 599 cells are outside the New York box. Blue Bottle and Shake Shack stayed at 0.56 and 0.59. Chick-fil-A left at 0.50, with all three cells inside the Reading box, so that location string did land in the UK and not in Reading, Pennsylvania. Fresh & Easy, the West Coast exit, is the one heatmap Qloo rejected, with HTTP 400. A missing heatmap is not a low score.

Demographics, sent as age `25_to_29` with the same place filter and the brand as an interest, succeeded for every row.

## Sources

- Muji, SoHo, first US store, opened 16 Nov 2007 and stayed. [Ryohin Keikaku](https://www.ryohin-keikaku.jp/news/2007_1025_01.html), [MUJI US](https://info.muji.us/2007/09/06/muji-will-open-its-first-us-store-in-november-2007/), [Wikipedia](https://en.wikipedia.org/wiki/MUJI).
- Blue Bottle, Kiyosumi-Shirakawa, first shop outside the US, opened 6 Feb 2015 and stayed. [Sprudge](https://sprudge.com/blue-bottle-tokyo-roastery-kiyosumi-shirakawa-opening-70221.html), [The Japan Times](https://www.japantimes.co.jp/life/2015/02/03/food/blue-bottle-coffee-offers-fresher-brew/), [The Seattle Times](https://www.seattletimes.com/nation-world/calif-coffee-chain-blue-bottle-brews-long-lines-in-tokyo/).
- Shake Shack, Meiji-Jingu Gaien, first in Asia, opened 13 Nov 2015 and stayed. [The Japan Times](https://www.japantimes.co.jp/news/2015/11/13/business/corporate-business/first-shake-shack-in-asia-opens-to-long-lines-in-tokyo/), [Shake Shack investor release](https://investor.shakeshack.com/press-releases/press-release-details/2015/Hajimemashite-Tokyo-Shake-Shack-to-Open-First-Tokyo-Location-in-Meiji-Jingu-Gaien-This-Winter/default.aspx), [Eater](https://www.eater.com/2015/11/13/9728444/shake-shack-opens-first-location-japan).
- Chick-fil-A, The Oracle, Reading, opened 10 Oct 2019. The landlord did not extend the pilot (announced 18 Oct 2019). The shop closed 20 Mar 2020. [BBC](https://www.bbc.com/news/uk-england-berkshire-50094551), [The Washington Post](https://www.washingtonpost.com/world/2019/10/19/days-after-opening-its-first-uk-restaurant-chick-fil-a-announces-location-will-close/).
- Tesco Fresh & Easy, US West Coast, opened 2007, never profitable. Exit announced 17 Apr 2013 at a cost of £1.2bn. The probe searches Fresh & Easy and sends Los Angeles. [BBC, the exit](https://www.bbc.com/news/business-22179255), [BBC, the writedown](https://www.bbc.com/news/business-22168463), [Reuters](https://www.reuters.com/article/business/tesco-quits-us-and-takes-35-billion-global-writedown-idUSBRE93G06O/).
