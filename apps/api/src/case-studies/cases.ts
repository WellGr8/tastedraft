/**
 * Launches compared across a locked city list.
 * Rule city-rank-2 was locked on 2026-10-14, after city-rank-1 and before the rerun.
 * The lists are the same for every brief in a region. They are not reordered after scores.
 */
import type { CityBox } from '../backtest/cases.ts';

export interface CityOption {
  city: string;
  box: CityBox;
}

/** Major Japanese cities. Tokyo is the real city for the Japan briefs. */
export const JAPAN_CITIES: readonly CityOption[] = [
  { city: 'Tokyo', box: { minLat: 35.4, maxLat: 35.9, minLng: 139.3, maxLng: 140.0 } },
  { city: 'Osaka', box: { minLat: 34.5, maxLat: 34.85, minLng: 135.3, maxLng: 135.65 } },
  { city: 'Kyoto', box: { minLat: 34.9, maxLat: 35.15, minLng: 135.6, maxLng: 135.85 } },
  { city: 'Fukuoka', box: { minLat: 33.5, maxLat: 33.7, minLng: 130.2, maxLng: 130.5 } },
  { city: 'Sapporo', box: { minLat: 42.9, maxLat: 43.2, minLng: 141.2, maxLng: 141.5 } },
];

/** Major US cities. New York is the real city for the US brief. */
export const US_CITIES: readonly CityOption[] = [
  { city: 'New York', box: { minLat: 40.5, maxLat: 40.95, minLng: -74.1, maxLng: -73.7 } },
  { city: 'Los Angeles', box: { minLat: 33.7, maxLat: 34.3, minLng: -118.7, maxLng: -118.1 } },
  { city: 'Chicago', box: { minLat: 41.6, maxLat: 42.05, minLng: -87.9, maxLng: -87.5 } },
  { city: 'Miami', box: { minLat: 25.6, maxLat: 25.9, minLng: -80.4, maxLng: -80.1 } },
  { city: 'Boston', box: { minLat: 42.2, maxLat: 42.5, minLng: -71.2, maxLng: -70.9 } },
];

export type LaunchRegion = 'japan' | 'us';

export function citiesFor(region: LaunchRegion): readonly CityOption[] {
  return region === 'japan' ? JAPAN_CITIES : US_CITIES;
}

export type PublicOutcome = 'sold_out' | 'stayed' | 'left';

export type LaunchDomain = 'music' | 'fashion' | 'food' | 'beauty' | 'games' | 'film';

export type LaunchSearchType = 'artist' | 'brand' | 'movie' | 'tv_show' | 'videogame';

export interface LaunchCase {
  id: string;
  title: string;
  domain: LaunchDomain;
  /** Short label for the case list. Not a score input. */
  domainLabel: string;
  query: string;
  /** Qloo `/search` type. */
  searchType: LaunchSearchType;
  /** Insight type used to find the subject and its closest neighbors. */
  anchorType: string;
  region: LaunchRegion;
  /** The city where the launch actually happened. It is one of `citiesFor(region)`. */
  city: string;
  /**
   * Place price cap sent for every city in the region. It is the product's
   * public price band, not a per-city adjustment.
   */
  priceLevel: 1 | 2 | 3 | 4;
  launch: string;
  outcome: PublicOutcome;
  outcomeSummary: string;
  prelaunch: string;
  sources: readonly string[];
}

export const LAUNCH_CASES: readonly LaunchCase[] = [
  {
    id: 'billie-eilish-tokyo-2022',
    title: 'Billie Eilish, first solo Japan show',
    domain: 'music',
    domainLabel: 'Music',
    query: 'Billie Eilish',
    searchType: 'artist',
    anchorType: 'urn:entity:artist',
    region: 'japan',
    city: 'Tokyo',
    priceLevel: 3,
    launch: '2022-08-26',
    outcome: 'sold_out',
    outcomeSummary: 'Ariake Arena, 26 August 2022, sold out on release. Extra seats went on sale 20 August. Universal Music Japan called the first solo Japan date a success.',
    prelaunch: 'Before the 23 June 2022 announcement: Happier Than Ever (2021) had been number one in 15 countries, When We All Fall Asleep, Where Do We Go? (2019) was already out, and a September 2020 Ariake date had sold out and then been cancelled. She had played Summer Sonic 2019, which was a festival set, not a solo headline.',
    sources: [
      'https://www.universal-music.co.jp/billie-eilish/news/2022-06-23/',
      'https://www.universal-music.co.jp/billie-eilish/news/2022-08-30/',
      'https://iflyer.tv/en/article/2022/06/23/happierthaneverworldtour-japan2022/',
    ],
  },
  {
    id: 'olivia-rodrigo-tokyo-2024',
    title: 'Olivia Rodrigo, first concert in Japan',
    domain: 'music',
    domainLabel: 'Music',
    query: 'Olivia Rodrigo',
    searchType: 'artist',
    anchorType: 'urn:entity:artist',
    region: 'japan',
    city: 'Tokyo',
    priceLevel: 3,
    launch: '2024-09-27',
    outcome: 'sold_out',
    outcomeSummary: 'Ariake Arena, 27 September 2024, sold out immediately. A second show on 28 September was added and also sold out. A last batch of seats was released on 24 September.',
    prelaunch: 'Before the 9 May 2024 on-sale: SOUR (2021) and GUTS (September 2023) had debuted at number one in the US and the UK. She had visited Japan in September 2023 for promotion and had not played a concert there.',
    sources: [
      'https://tower.jp/article/news/2024/05/09/tg013',
      'https://niewmedia.com/en/news/040239/',
      'https://niewmedia.com/en/news/043985/',
      'https://en.skream.jp/news/2024/06/olivia_rodrigo_guts_world_tour_japan_add.php',
    ],
  },
  {
    id: 'harry-styles-tokyo-2017',
    title: 'Harry Styles, first solo Japan shows',
    domain: 'music',
    domainLabel: 'Music',
    query: 'Harry Styles',
    searchType: 'artist',
    anchorType: 'urn:entity:artist',
    region: 'japan',
    city: 'Tokyo',
    priceLevel: 3,
    launch: '2017-12-07',
    outcome: 'sold_out',
    outcomeSummary: 'Ex Theater Roppongi, 7 December 2017, 3,600 of 3,600. The follow-up at Makuhari Messe on 12 May 2018 was 8,908 of 8,908.',
    prelaunch: 'Before 7 December 2017: the solo album Harry Styles had been out since 12 May 2017, and One Direction had already toured Japan. The brief does not include Fine Line (2019) or Harry\'s House (2022). Today\'s Qloo graph still knows those later records.',
    sources: [
      'https://en.wikipedia.org/wiki/Harry_Styles:_Live_on_Tour',
      'https://www.sonymusic.co.jp/artist/harrystyles/info/483508',
      'https://www.m-messe.co.jp/event/detail/4526',
    ],
  },
  {
    id: 'forever-21-tokyo-2009',
    title: 'Forever 21, first Japan store',
    domain: 'fashion',
    domainLabel: 'Fashion retail',
    query: 'Forever 21',
    searchType: 'brand',
    anchorType: 'urn:entity:brand',
    region: 'japan',
    city: 'Tokyo',
    priceLevel: 1,
    launch: '2009-04-01',
    outcome: 'left',
    outcomeSummary: 'The first Japan store opened in Harajuku in April 2009. The chain grew to 14 stores. On 25 September 2019 the Japanese arm said it would close every store and the online shop by 31 October 2019, citing continued sluggish sales. The US company filed for Chapter 11 the same week and said it would leave most of Asia.',
    prelaunch: 'Before the 2009 opening: Forever 21 was a Los Angeles fast-fashion chain aimed at teens, priced as a full outfit near $100. H&M was already in Japan. The brief does not include the 2019 exit. Today\'s Qloo graph can still reflect it.',
    sources: [
      'https://asia.nikkei.com/business/business-trends/forever-21-to-exit-japan-in-october',
      'https://www.bbc.com/news/business-49874688',
      'https://www.lmaga.jp/news/2019/09/77183/',
      'https://www.shibukei.com/headline/14564/',
    ],
  },
  {
    id: 'blue-bottle-tokyo-2015',
    title: 'Blue Bottle Coffee, first shop outside the US',
    domain: 'food',
    domainLabel: 'Food',
    query: 'Blue Bottle Coffee',
    searchType: 'brand',
    anchorType: 'urn:entity:brand',
    region: 'japan',
    city: 'Tokyo',
    priceLevel: 3,
    launch: '2015-02-06',
    outcome: 'stayed',
    outcomeSummary: 'The Kiyosumi-Shirakawa flagship opened on 6 February 2015, the first Blue Bottle outside the United States. Opening day drew lines of about three hours. Blue Bottle\'s Japan shop page still lists the cafe.',
    prelaunch: 'Before 6 February 2015: Blue Bottle was an Oakland specialty coffee company that had not opened a shop outside the United States. A second Tokyo cafe, in Aoyama, was already announced for 7 March 2015 and had not opened. The brief does not include the opening-day lines or the later Japan shops.',
    sources: [
      'https://sprudge.com/blue-bottle-tokyo-roastery-kiyosumi-shirakawa-opening-70221.html',
      'https://www.eater.com/2015/2/6/7992629/tokyo-blue-bottle-3-hour-lines-opening-day',
      'https://www.japantimes.co.jp/life/2015/02/03/food/blue-bottle-coffee-offers-fresher-brew/',
      'https://store.bluebottlecoffee.jp/pages/kiyosumi',
    ],
  },
  {
    id: 'innisfree-new-york-2017',
    title: 'Innisfree, first US flagship',
    domain: 'beauty',
    domainLabel: 'Beauty',
    query: 'Innisfree',
    searchType: 'brand',
    anchorType: 'urn:entity:brand',
    region: 'us',
    city: 'New York',
    priceLevel: 1,
    launch: '2017-09-15',
    outcome: 'left',
    outcomeSummary: 'The first US store opened at 862 Broadway, Union Square, on 15 September 2017. On 7 May 2021 Amorepacific said it would close every Innisfree store in North America. The company cited the pandemic and a shift to digital. Product remained at Sephora. The standalone New York stores did not stay.',
    prelaunch: 'Before 15 September 2017: Innisfree was Amorepacific\'s affordable Jeju-ingredient skincare brand, with a large store network in Asia and no US shop yet. The brief does not include the 2021 exit. Today\'s Qloo graph can still reflect it. The exit was not only a taste result: the company named the pandemic.',
    sources: [
      'https://www.apgroup.com/int/en/news/2017-09-18.html',
      'https://www.koreatimes.co.kr/business/companies/20210507/amorepacific-withdraws-innisfree-business-from-north-america',
      'https://www.businessoffashion.com/news/beauty/amorepacifics-innisfree-to-exit-us-market/',
    ],
  },
  {
    id: 'nintendo-tokyo-2019',
    title: 'Nintendo TOKYO, first direct store in Japan',
    domain: 'games',
    domainLabel: 'Games',
    query: 'Nintendo',
    searchType: 'brand',
    anchorType: 'urn:entity:brand',
    region: 'japan',
    city: 'Tokyo',
    priceLevel: 3,
    launch: '2019-11-22',
    outcome: 'stayed',
    outcomeSummary: 'Shibuya Parco 6F opened on 22 November 2019, the first Nintendo store the company operated directly in Japan. Opening day switched to numbered tickets and stopped admitting people once those ran out. Nintendo still lists the store, alongside later shops in Osaka, Kyoto, and Fukuoka.',
    prelaunch: 'Before 22 November 2019: Nintendo sold hardware and software in Japan through other retailers. Switch had been out since 2017. The company had announced the Shibuya shop on 1 February 2019 and had no directly operated permanent store in Japan yet. The brief does not include the opening-day queues or the later Osaka, Kyoto, and Fukuoka stores.',
    sources: [
      'https://www.nintendo.co.jp/corporate/release/2019/190201_2.html',
      'https://www.nintendo.com/jp/topics/article/5c5d7496-efad-11e9-b641-063b7ac45a6d',
      'https://news.denfaminicogamer.jp/kikakuthetower/191122b',
      'https://www.nintendo.com/jp/officialstore/index.html',
    ],
  },
  {
    id: 'mario-movie-tokyo-2023',
    title: 'The Super Mario Bros. Movie, Japan opening',
    domain: 'film',
    domainLabel: 'Film',
    query: 'The Super Mario Bros. Movie',
    searchType: 'movie',
    anchorType: 'urn:entity:movie',
    region: 'japan',
    city: 'Tokyo',
    priceLevel: 3,
    launch: '2023-04-28',
    outcome: 'sold_out',
    outcomeSummary: 'Japan opened on 28 April 2023. The first three days sold 1.276 million tickets and ¥1.843 billion, which Toho-Towa and Universal called the biggest opening weekend for an animated studio film in Japan and Universal\'s biggest Japan opening. Tokyo is the city string sent to Qloo. The published gross is national, not one Tokyo screen.',
    prelaunch: 'Before the 28 April 2023 Japan opening: the film had already opened in the United States on 5 April 2023. The brief stops before the Japan weekend. Today\'s Qloo graph can still reflect that weekend. A record opening is the positive side of the ranking rule, the same side as a sellout.',
    sources: [
      'https://www.animenewsnetwork.com/news/2023-05-03/the-super-mario-bros-movie-opens-at-no.1-in-japan-knights-of-the-zodiac-at-no.8/.197719',
      'https://deadline.com/2023/04/super-mario-bros-movie-crosses-one-billion-global-box-office-1235341660/',
      'https://www.nikkansports.com/entertainment/news/202305020000519.html',
    ],
  },
];

export function polarityOf(outcome: PublicOutcome): 'positive' | 'negative' {
  return outcome === 'left' ? 'negative' : 'positive';
}
