/**
 * Launches scored from facts a promoter could have known before opening night.
 * The Qloo graph this process calls is today's graph, not a snapshot from that year.
 */
import type { CityBox } from '../backtest/cases.ts';

export const TOKYO: CityBox = { minLat: 35.4, maxLat: 35.9, minLng: 139.3, maxLng: 140.0 };

/** Locked before the live calls. A launch is "encourage" only when both clear. */
export const ENCOURAGE_TOTAL = 55;
export const ENCOURAGE_LOCAL = 50;

export type PublicOutcome = 'sold_out' | 'left';

export interface LaunchCase {
  id: string;
  title: string;
  query: string;
  /** Qloo `/search` type. */
  searchType: 'artist' | 'brand';
  /** Insight type used to score the subject itself. */
  anchorType: string;
  /** Two other entity types. Coverage in the engine reaches full weight at three. */
  crossTypes: readonly string[];
  city: string;
  box: CityBox;
  /** `signal.demographics.age` a promoter would have sent. Not chosen after seeing Qloo. */
  ageBucket: string;
  /** Qloo place price scale the brief would have sent. */
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
    query: 'Billie Eilish',
    searchType: 'artist',
    anchorType: 'urn:entity:artist',
    crossTypes: ['urn:entity:brand', 'urn:entity:movie'],
    city: 'Tokyo',
    box: TOKYO,
    ageBucket: '24_and_younger',
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
    query: 'Olivia Rodrigo',
    searchType: 'artist',
    anchorType: 'urn:entity:artist',
    crossTypes: ['urn:entity:brand', 'urn:entity:movie'],
    city: 'Tokyo',
    box: TOKYO,
    ageBucket: '24_and_younger',
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
    query: 'Harry Styles',
    searchType: 'artist',
    anchorType: 'urn:entity:artist',
    crossTypes: ['urn:entity:brand', 'urn:entity:movie'],
    city: 'Tokyo',
    box: TOKYO,
    ageBucket: '24_and_younger',
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
    query: 'Forever 21',
    searchType: 'brand',
    anchorType: 'urn:entity:brand',
    crossTypes: ['urn:entity:artist', 'urn:entity:movie'],
    city: 'Tokyo',
    box: TOKYO,
    ageBucket: '24_and_younger',
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
];

export function launchVerdict(total: number | null, local: number | null): 'encourage' | 'caution' {
  if (total == null || local == null) return 'caution';
  if (total >= ENCOURAGE_TOTAL && local >= ENCOURAGE_LOCAL) return 'encourage';
  return 'caution';
}

export function verdictMatched(verdict: 'encourage' | 'caution', outcome: PublicOutcome): boolean {
  return outcome === 'left' ? verdict === 'caution' : verdict === 'encourage';
}
