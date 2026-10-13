# Pre-launch case studies

Four documented entries into Tokyo, scored from facts a promoter could have known before opening. The Qloo graph these calls hit is today's graph, not a snapshot from 2009, 2017, 2022, or 2024. Later records, and Forever 21's exit, can still sit inside the affinities. The briefs themselves stop at the pre-launch facts below.

This is not a sales forecast. Two of the four public outcomes match the rule that was locked before the calls.

## The rule

Locked before any live call:

- **Encourage** only when the ledger total is at least 55 and local fit is at least 50, and neither is missing.
- Otherwise **caution**.
- A sold-out show matches only an encourage. A later exit matches only a caution.

The scorer is `scoreInsightMeasurements`. It maps measured 0–1 affinities onto the ledger (anchor 30, cross 25, local 20, audience 25). Friction is the gap between anchor and audience when both exist. A missing affinity stays null. It is not filled from the sample tables. The sample path that scores 71, then 80, is not used here.

Heatmap cells are reported as context. They are not a ledger row.

One subject means `activeRefCount` is 1, so evidence strength stays **LIMITED** even when every row is measured.

Audience affinity is the predeclared age bucket `24_and_younger`, not whichever bucket looks best after the fact. A negative skew would count as 0. These four were positive.

Search sends `urn:entity:artist` or `urn:entity:brand`. A short type string such as `artist` is HTTP 400 on the hackathon host.

## What came back

Each row is 7 live calls: search, the subject, places, a heatmap, two cross-category types, and demographics. None of those calls failed. The anchor row is still a gap on every study: the insights call succeeded, and it did not return an affinity for the subject entity itself. Friction stays empty because it needs that anchor. Totals below are the sum of the rows that were measured.

| Launch | Public outcome | Total | Local | Audience | Cross | Verdict | Match |
|---|---|---:|---:|---:|---:|---|---|
| Billie Eilish, Ariake, 26 Aug 2022 | Sold out | 45 | 87 | 46 | 64 | Caution | Miss |
| Olivia Rodrigo, Ariake, 27 Sep 2024 | Sold out | 55 | 85 | 87 | 63 | Encourage | Match |
| Harry Styles, Ex Theater Roppongi, 7 Dec 2017 | Sold out | 44 | 87 | 42 | 64 | Caution | Miss |
| Forever 21, Harajuku, April 2009 | Left in 2019 | 42 | 89 | 31 | 64 | Caution | Match |

Derived place medians are 0.87, 0.84, 0.87, and 0.89. Local fit does not separate the sold-out shows from the brand that left. The same thing showed up in the earlier city-entry backtest ([docs/backtest.md](backtest.md)).

Cross-category medians sit between 0.94 and 0.98 for every row. They do not separate outcomes either.

In-city heatmap medians are 0.71, 0.59, 0.68, and 0.70. Forever 21, the exit, is not the cold cell. Olivia Rodrigo, a sellout, has the coolest in-city median of the four. The heatmap is not in the score.

The spread that does exist is the predeclared age skew: 0.46, 0.87, 0.42, and 0.31. Olivia Rodrigo clears 55 because that skew is 0.87 (audience points 22). The other three land at 42–45 and stay on caution. The rule therefore catches one sellout and the exit, and misses two sellouts.

## How to read the misses

Billie Eilish and Harry Styles sold out, and the locked rule said caution. The miss is not a hidden low place score. Tokyo places are high for both. The anchor measurement is absent, so a strong self-affinity never enters the total, and friction never subtracts or adds. What remains is a high local row, a high cross row that is almost the same for every case, and a moderate youth skew.

Olivia Rodrigo's encourage is real under the rule, and it is also the row most exposed to contamination: the graph was queried after the sellout, not on 9 May 2024.

Forever 21's caution matches the later exit. It should not be read as the engine spotting sluggish sales in 2009. Place affinity is the highest of the four (0.89). The caution is the youth skew at 0.31 plus the missing anchor, on a graph that already knows the 2019 closure.

## Reproduce

`npm run case-studies -w @tastedraft/api` with `QLOO_API_KEY` set. The script prints one derived line per launch and writes [apps/web/public/case-studies.json](../apps/web/public/case-studies.json). The writer refuses the file if it contains a raw results payload, an entity id field, explainability, an image, or a key. Response bodies stay in the gitignored cache.

## Sources

Billie Eilish, first solo Japan date, Ariake Arena, 26 August 2022, sold out. [Universal Music Japan, the announcement](https://www.universal-music.co.jp/billie-eilish/news/2022-06-23/), [Universal Music Japan, after the show](https://www.universal-music.co.jp/billie-eilish/news/2022-08-30/), [iFLYER](https://iflyer.tv/en/article/2022/06/23/happierthaneverworldtour-japan2022/).

Olivia Rodrigo, first concert in Japan, Ariake Arena, 27 September 2024, sold out, with a second show added. [Tower Records](https://tower.jp/article/news/2024/05/09/tg013), [Niew Media, the on-sale](https://niewmedia.com/en/news/040239/), [Niew Media, the sellout](https://niewmedia.com/en/news/043985/), [Skream](https://en.skream.jp/news/2024/06/olivia_rodrigo_guts_world_tour_japan_add.php).

Harry Styles, first solo Japan shows. Ex Theater Roppongi, 7 December 2017, 3,600 of 3,600. Makuhari Messe, 12 May 2018, 8,908 of 8,908. [Wikipedia, Live on Tour](https://en.wikipedia.org/wiki/Harry_Styles:_Live_on_Tour), [Sony Music Japan](https://www.sonymusic.co.jp/artist/harrystyles/info/483508), [Makuhari Messe](https://www.m-messe.co.jp/event/detail/4526). The 2023 Ariake dates were a return, so they are not this case. The brief does not include Fine Line or Harry's House.

Forever 21, first Japan store, Harajuku, April 2009. The chain grew to 14 stores. On 25 September 2019 the Japanese arm said it would close every store and the online shop by 31 October 2019, citing continued sluggish sales. The US company filed for Chapter 11 the same week. [Nikkei Asia](https://asia.nikkei.com/business/business-trends/forever-21-to-exit-japan-in-october), [BBC](https://www.bbc.com/news/business-49874688), [Lmaga](https://www.lmaga.jp/news/2019/09/77183/), [Shibuya Keizai Shimbun](https://www.shibukei.com/headline/14564/).
