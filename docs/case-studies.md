# Pre-launch case studies

Eight documented launches. Each one happened in a real city. The question is not whether a big city will sell out. The question is which city on a locked list fits this taste best.

The rule is **city-rank-2**, locked on **2026-10-14**, after the city-rank-1 live run ranked every real city 1 of 5. This checkout has no `QLOO_API_KEY`. Every rank in the published file is empty. Those rows are not hits and they are not misses.

This is not a sales forecast.

city-rank-1 (local 50, heatmap 25, popularity 25) crowned Tokyo and New York on size, including Forever 21 and Innisfree. An earlier absolute rule (encourage only when the ledger total was at least 55 and local fit was at least 50) matched 2 of 4 scored Tokyo rows. Those passes are history. Those totals are not ranks under city-rank-2, and they are not in the fixture.

## The rule

`rankOptions` lives in `packages/contracts/src/rank.ts`. The API re-exports it from `apps/api/src/engine/rank-options.ts`. Compare mode and this probe both call that function. Neither sorts or weights on its own.

Locked before the city-rank-2 rerun:

- Each brief is scored in every city on its region list. The lists were fixed before the run and are not reordered after scores.
- Japan: Tokyo, Osaka, Kyoto, Fukuoka, Sapporo.
- United States: New York, Los Angeles, Chicago, Miami, Boston.
- The real launch city is one of those five. Five cities, not six, so a full pass stays near 104 calls.
- Each option score is taste lift on local × 60, taste lift on the in-city heatmap × 35, and popularity × 5. Taste lift is affinity divided by that city's own popularity, then divided by 2 and capped at 1. A missing or non-positive size leaves the affinity as-is. A shared national divisor is not used, because it would not change the order. Points are rounded. A missing part stays null. It is not filled with zero. An option with no parts is unscored and sorts last. Popularity itself can add at most 5 points, so a capital does not win on size.
- Popularity is the mean heatmap `popularity_affinity` inside the city box. If that is missing, it is the mean place popularity. A single entity-wide popularity would be the same in every city, so it is not added on top.
- Ties share a rank (1, 1, 3). Inside a tie, the locked list order wins.
- A sold-out show, a record opening, or a store that stayed is a hit only when the real city ranks in the **top 2**.
- A later exit (`left`) is a hit only when the real city ranks in the **bottom 2**. For five cities that is rank 4 or 5.
- Rank 3 of 5 is a miss for both. A null rank is unscored and stays out of the hit rate and the mean rank.
- The reported numbers are the top-2 rate among successes, the low-rank rate among failures, and the mean rank of scored cases.

The same settings apply to every brief:

- Search, then one insights call for the closest neighbors of the same type. The panel keeps the subject plus up to four neighbors (five references at most), highest affinity first, name as the tie-break.
- Panel confidence follows the reference count, the same bands as engine evidence: 4 or more **HIGH**, 2–3 **MEDIUM**, fewer than 2 **LIMITED**. A ledger gap still forces LIMITED on the product scorer. That behavior is unchanged, and it is not this panel confidence.
- Age and gender come from `urn:demographics` for the primary entity. The strongest positive age bucket and the strongest positive gender are the audience. A non-positive skew is not a target. Ties break by bucket name. The same audience is sent on every city's place call. The skew value is not a score term, because it would not change the rank.
- Demographics need a location or Qloo returns HTTP 400. The location is the first city on the locked regional list (Tokyo, or New York). It is not a vote for that city.
- `bias.trends` is `mid` on the related call, the place call, and the heatmap call. An HTTP 400 retries that call once without the parameter.
- Price level is the product's public band, sent as `filter.price_level.max` for every city in the case: 1 for Forever 21 and Innisfree, 3 for the others.

Search sends a URN. A short type string such as `artist` is HTTP 400 on the hackathon host.

## What is in the file

| Launch | Domain | Real city | Public outcome | Rank |
|---|---|---|---|---|
| Billie Eilish, Ariake, 26 Aug 2022 | Music | Tokyo | Sold out | Awaiting live Qloo |
| Olivia Rodrigo, Ariake, 27 Sep 2024 | Music | Tokyo | Sold out | Awaiting live Qloo |
| Harry Styles, Ex Theater Roppongi, 7 Dec 2017 | Music | Tokyo | Sold out | Awaiting live Qloo |
| Forever 21, Harajuku, April 2009 | Fashion retail | Tokyo | Left in 2019 | Awaiting live Qloo |
| Blue Bottle, Kiyosumi-Shirakawa, 6 Feb 2015 | Food | Tokyo | Stayed | Awaiting live Qloo |
| Innisfree, Union Square, 15 Sep 2017 | Beauty | New York | Left in 2021 | Awaiting live Qloo |
| Nintendo TOKYO, Shibuya, 22 Nov 2019 | Games | Tokyo | Stayed | Awaiting live Qloo |
| The Super Mario Bros. Movie, 28 Apr 2023 | Film | Tokyo | Record Japan opening | Awaiting live Qloo |

**Top-2 hit rate and mean rank are not knowable from this file.** No live pass of city-rank-2 has been recorded here.

## Budget

Eight briefs × (search + related entities + demographics + two calls × five cities) = **104 calls**. The shared daily budget is 1000 (`QLOO_DAILY_BUDGET`). If every trends call returned HTTP 400, the one retry would add 11 calls per brief (88), and the pass would still be about 192. Cache hits do not call Qloo again. Live 200 bodies stay in `apps/api/data/qloo-cache`, which is gitignored.

## The launches

Blue Bottle's first shop outside the United States opened in Kiyosumi-Shirakawa, Tokyo, on 6 February 2015, and the cafe is still on the company's Japan shop page. Outcome class: stayed.

Innisfree's first US flagship opened at 862 Broadway, Union Square, New York, on 15 September 2017. On 7 May 2021 Amorepacific said it would close every North American Innisfree store. Product stayed at Sephora. The company named the pandemic, so this exit is not a pure taste failure. Outcome class: left. The brief does not include that exit. Today's graph can still reflect it.

Nintendo TOKYO opened on the sixth floor of Shibuya Parco on 22 November 2019, the first store Nintendo operated directly in Japan. Nintendo still lists it. Outcome class: stayed. The Qloo subject is the brand Nintendo, not a separate store entity.

The Super Mario Bros. Movie opened in Japan on 28 April 2023. The first three days sold 1.276 million tickets and ¥1.843 billion, reported as the biggest opening weekend for an animated studio film in Japan. Tokyo is the city string sent to Qloo. The gross is national. A record opening is the positive side of the ranking rule, the same side as a sellout.

## Reproduce

`npm run case-studies -w @tastedraft/api` with `QLOO_API_KEY` set. The script prints one line per launch (id, real city, rank, score, confidence, outcome, hit or miss, calls) and then the top-2 rate, the low-rank rate, and the mean rank. It overwrites [apps/web/public/case-studies.json](../apps/web/public/case-studies.json) with `grounding: "live"`. The writer refuses the file if it contains a raw results payload, an entity id field, explainability, an image, or a key.

Without a key the script prints the locked rule and the 104-call estimate, then exits. It does not rewrite the fixture and it does not fall back to the sample graph.

## Sources

Billie Eilish, first solo Japan date, Ariake Arena, 26 August 2022, sold out. [Universal Music Japan, the announcement](https://www.universal-music.co.jp/billie-eilish/news/2022-06-23/), [Universal Music Japan, after the show](https://www.universal-music.co.jp/billie-eilish/news/2022-08-30/), [iFLYER](https://iflyer.tv/en/article/2022/06/23/happierthaneverworldtour-japan2022/).

Olivia Rodrigo, first concert in Japan, Ariake Arena, 27 September 2024, sold out, with a second show added. [Tower Records](https://tower.jp/article/news/2024/05/09/tg013), [Niew Media, the on-sale](https://niewmedia.com/en/news/040239/), [Niew Media, the sellout](https://niewmedia.com/en/news/043985/), [Skream](https://en.skream.jp/news/2024/06/olivia_rodrigo_guts_world_tour_japan_add.php).

Harry Styles, first solo Japan shows. Ex Theater Roppongi, 7 December 2017, 3,600 of 3,600. Makuhari Messe, 12 May 2018, 8,908 of 8,908. [Wikipedia, Live on Tour](https://en.wikipedia.org/wiki/Harry_Styles:_Live_on_Tour), [Sony Music Japan](https://www.sonymusic.co.jp/artist/harrystyles/info/483508), [Makuhari Messe](https://www.m-messe.co.jp/event/detail/4526). The 2023 Ariake dates were a return, so they are not this case. The brief does not include Fine Line or Harry's House.

Forever 21, first Japan store, Harajuku, April 2009. The chain grew to 14 stores. On 25 September 2019 the Japanese arm said it would close every store and the online shop by 31 October 2019, citing continued sluggish sales. The US company filed for Chapter 11 the same week. [Nikkei Asia](https://asia.nikkei.com/business/business-trends/forever-21-to-exit-japan-in-october), [BBC](https://www.bbc.com/news/business-49874688), [Lmaga](https://www.lmaga.jp/news/2019/09/77183/), [Shibuya Keizai Shimbun](https://www.shibukei.com/headline/14564/).

Blue Bottle Coffee, Kiyosumi-Shirakawa, 6 February 2015, first shop outside the United States. The cafe is still listed. [Sprudge](https://sprudge.com/blue-bottle-tokyo-roastery-kiyosumi-shirakawa-opening-70221.html), [Eater, opening day](https://www.eater.com/2015/2/6/7992629/tokyo-blue-bottle-3-hour-lines-opening-day), [The Japan Times](https://www.japantimes.co.jp/life/2015/02/03/food/blue-bottle-coffee-offers-fresher-brew/), [Blue Bottle Japan](https://store.bluebottlecoffee.jp/pages/kiyosumi).

Innisfree, 862 Broadway, Union Square, New York, 15 September 2017, first US flagship. North American stores closed from the 7 May 2021 announcement. [Amorepacific](https://www.apgroup.com/int/en/news/2017-09-18.html), [The Korea Times](https://www.koreatimes.co.kr/business/companies/20210507/amorepacific-withdraws-innisfree-business-from-north-america), [Business of Fashion](https://www.businessoffashion.com/news/beauty/amorepacifics-innisfree-to-exit-us-market/).

Nintendo TOKYO, Shibuya Parco, 22 November 2019, first directly operated Nintendo store in Japan. Still listed. [Nintendo, February 2019 announcement](https://www.nintendo.co.jp/corporate/release/2019/190201_2.html), [Nintendo, the opening](https://www.nintendo.com/jp/topics/article/5c5d7496-efad-11e9-b641-063b7ac45a6d), [Denfami Nico Gamer, opening day](https://news.denfaminicogamer.jp/kikakuthetower/191122b), [Nintendo, current stores](https://www.nintendo.com/jp/officialstore/index.html).

The Super Mario Bros. Movie, Japan, 28 April 2023. First three days: 1.276 million admissions and ¥1.843 billion. [Anime News Network](https://www.animenewsnetwork.com/news/2023-05-03/the-super-mario-bros-movie-opens-at-no.1-in-japan-knights-of-the-zodiac-at-no.8/.197719), [Deadline](https://deadline.com/2023/04/super-mario-bros-movie-crosses-one-billion-global-box-office-1235341660/), [Nikkan Sports](https://www.nikkansports.com/entertainment/news/202305020000519.html).
