# TasteDraft — Research Report (13 ต.ค. 2026)

> สถานะ: ยังไม่เขียนโค้ดแอป · ทุกอย่างที่ระบุ "(unverified)" = ยังไม่ได้ยืนยันจาก docs ทางการ/ยังไม่ได้ลองยิง API จริง

## 0. TL;DR
- Prototype render ได้ standalone ใน Chromium (runtime ฝังในไฟล์ แต่โหลด React จาก jsDelivr CDN → ต้องมีเน็ต)
- Engine math ตรง spec: V1 = 24+20+15+17−5 = **71**, V2 = 24+20+18+22−2 = **82** ✅
- แต่ score เป็น **ค่าคงที่** (SUBS1/SUBS2) — เปลี่ยน idea/city/age/refs แล้วคะแนนไม่เปลี่ยน (ยกเว้นปัด ≈ ตอน LIMITED)
- **Qloo Agentic Hackathon 2026 เปิดอยู่** (deadline 30 ต.ค. 2026 23:45 EDT = 31 ต.ค. 10:45 ICT, $25k) — ขอ key ฟรีผ่านฟอร์ม ได้ภายใน "a few business days" → ขอวันนี้เลย
- Hackathon key ใช้ได้เฉพาะ `https://hackathon.api.qloo.com`, header `X-Api-Key`
- ระหว่างรอ key: ใช้ `EvidenceProvider` interface + Open-data provider (Wikidata/Last.fm/TMDB/OSM) + LLM-inferred (ติดป้ายชัด)

---
## 1. Review Main.dc.html

### 1.1 โครงสร้างไฟล์ (bundle ของ Claude Design)
- `shell` (bootstrap/unpacker) → `__bundler/manifest` (290 KB, gzip: React 18.3.1 UMD + DC runtime) → `__bundler/ext_resources` (React จาก cdn.jsdelivr.net) → `__bundler/template` (JSON string 108 KB = หน้าเว็บจริง)
- Template: 2 `<style>` (fonts 7 KB, app CSS 46 KB) + markup ใช้ `{{binding}}`, `sc-if`, `sc-camel-on-click` + `<script type="text/x-dc" data-props=…>` = `class Component extends DCLogic`
- Props: `refImages` ({name:url}), `phase` (input|analyzing|result), `$preview` 1440×900
- แยกไฟล์แล้วที่ `split/` (ดู §6)

### 1.2 State / flow
- state: phase, step, idea, ageIdx, city, interests, pos, refs[], muted[], applied, ver, busy, modal, draft, evSel, open{}, evOpen, whyOpen, qFold, qOn, anim, toast
- Phase 1 Input → `startTest` → Phase 2 analyzing: 5 STEPS × 900ms (+700ms) → Phase 3 result
- 5 modals: `brief`, `refs` (Taste playlist), `proposal`, `compare`, `evidence` — focus trap + Esc + confirm discard เมื่อ dirty
- Apply: busy 2s → applied=true, ver=2, count-up animation 71→82
- `renderVals()` คืนค่าทั้งหมดให้ template (ledger, cmp, signals, hexes, frictions, proposals, qdiff…)

### 1.3 Engine
```
p.x = round(sub.x × W.x / 100), friction = −round(sub.friction × 0.4); total = Σ
W = {anchor 30, cross 25, local 20, audience 25}
SUBS1 = {80,80,74,68, fr 12} → 24+20+15+17−5 = 71 (MODERATE: ≥60)
SUBS2 = {80,80,90,88, fr 6}  → 24+20+18+22−2 = 82 (HIGH: ≥80)
evidence: active refs ≥4 HIGH, 2–3 MEDIUM, <2 LIMITED → แสดง "≈ round(total/5)*5"
```
ตรง spec ✅ (หมายเหตุ: round ต่อมิติก่อนรวม → total อาจต่างจาก round(Σ) ได้ ±2; ควรเขียน spec ให้ชัด)

### 1.4 Bugs / inconsistencies (เรียงตามความสำคัญ)
1. **Textarea idea แสดง "[object Object]"** (เห็นใน screenshot input ทั้ง desktop/mobile) — `{{ideaInit}}` วางเป็น child ของ `<textarea>` แล้ว runtime ใส่เป็น object; ควรใช้ `value="{{idea}}"`/defaultValue. ถ้าผู้ใช้กด TEST โดยไม่แก้ state.idea ยังเป็น DEFAULT_IDEA (หน้า result โชว์ถูก) แต่ UX หน้าแรกพัง
2. Score คงที่: city/age/pos/interests/refs ไม่มีผลต่อ SUBS — `rerun()` แค่ busy 1.7s + toast "ประเมินใหม่แล้ว" (หลอกผู้ใช้ว่าคำนวณใหม่)
3. `interests` ถูกเก็บแต่ไม่ถูกใช้ที่ไหนเลย และไม่มีในโมดัล brief
4. LIMITED: score โชว์ "≈ 70" แต่ `whyTitle` = "Why 71?" และ ledger โชว์ตัวเลขเต็ม; ตอน V2+LIMITED count-up animation ถูกข้าม (`shown` ไม่ใช้ `anim`)
5. `<img src="{{c.image}}">` ยิง request ไปที่ literal `%7B%7Bc.image%7D%7D` ก่อน bind (เห็นใน network log) → ควรใช้ `sc-if hasImage` ครอบ/ใช้ data-src
6. Map: ตำแหน่ง pin/hex คงที่ทุกเมือง (x 4.3,y 2.4) — เปลี่ยนเมืองแล้วแผนที่เหมือนเดิม แค่ชื่อย่านเปลี่ยน; CITIES เป็น "Illustrative" (มี comment บอก) แต่ UI ไม่บอก
7. `sigCount = 2n+1`, `domCount` สูตรสมมุติ ไม่ได้มาจากข้อมูล
8. Signals: `Location` level ขยับเป็น Strong ใน V2 ทั้งที่ proposal เปลี่ยนราคา/drop ไม่ใช่ location; fits/frictions/proposals hardcode กับตัวอย่าง streetwear เสมอ
9. ลบ ref ในหน้า input ไม่ลบจาก `muted`; เพิ่ม ref ซ้ำได้; ref ที่ผู้ใช้เพิ่มเป็น type "Reference"
10. Evidence modal: `lastFocus=null` → ปิดแล้ว focus ไม่กลับปุ่มเดิม (a11y); โค้ด `signals[i].open` ตัวแรกเป็น dead code (`openModal()||setState`)
11. focus-trap query รวม input ที่ hidden/disabled
12. `segments()` สร้าง RegExp จากชื่อย่านโดยไม่ escape (ปลอดภัยกับ table ปัจจุบัน แต่พังถ้าชื่อมี `(`, `.`)
13. React/fonts โหลดจาก CDN (jsDelivr, Google Fonts) → offline demo พัง

### 1.5 ข้อความที่อ้าง Qloo ทั้งที่เป็น mock (ต้องแก้ก่อนส่ง/ให้กรรมการดู)
- Badge **"Grounded by Qloo"** / "CULTURAL EVIDENCE · GROUNDED BY QLOO"
- frictions WHY: "**Qloo พบว่า**กลุ่มวัย … ผูกกับ independent…"
- proposal evidence: "**Qloo ชี้ว่า**กลุ่มนี้…"
- "Derived from Qloo cultural signals · our deterministic model", qdiff "คำนวณได้ 71"
- Header switch "QLOO ON/OFF" (aria-label "Qloo demo mode" ถูกแล้ว แต่ label ที่มองเห็นไม่บอกว่า demo)
→ แนะนำ: badge "Sample data · Qloo not connected" จนกว่าจะต่อจริง และใส่ `source: "mock"|"qloo"|"open-data"|"llm-inferred"` ใน response

### 1.6 Accessibility / responsive
- ดี: role=dialog/switch/status/alert, aria-checked, prefers-reduced-motion (5 จุด), media queries 1000/760/600/520px, ไม่มี horizontal overflow ที่ 390px (scrollWidth=390 ✓)
- เสี่ยง: (1) evidence modal focus restore (2) ข้อความ label ตัวเล็กมาก (eyebrow ~10–11px) บน mobile (3) chip playlist บน mobile ตัดขอบ/scroll แนวนอนไม่มี affordance (4) `animation-timeline` มี fallback แต่ควรทดสอบ Safari (5) contrast ของ pip "Moderate" สีทอง #B8892B บนพื้นอ่อน ≈ 3:1 (ต่ำกว่า 4.5 สำหรับ text — ใช้ได้เฉพาะ non-text) (unverified ด้วยเครื่องมือวัด)

### 1.7 Screenshots (`shots/`)
`{orig|img}-{1440|390}-{1-input,2-analyzing,3-result-v1,4-modal-proposal,5-result-v2,6-modal-compare}.png` (24 ไฟล์, full-page สำหรับ input/result)

### 1.8 Cover images (Main.with-images.dc.html)
แก้เฉพาะ `data-props.refImages.default` (ต้นฉบับไม่แตะ). โหลดสำเร็จ 5/5 (naturalWidth 500) ทั้ง desktop/mobile.
| Ref | File (Wikimedia Commons) | License |
|---|---|---|
| Comme des Garçons | File:Comme des Garcons logo.svg | Public domain (text logo; trademark ยังมีผล) |
| Muji | File:MUJI logo.svg | Public domain (text logo; trademark) |
| Aphex Twin | File:Aphex Twin, 2008.jpg — Octavio Ruiz Cervera | CC BY-SA 2.0 |
| Lost in Translation | File:New York Bar Unplugged, Park Hyatt Tokyo (8376387540).jpg — Jun Seita | CC BY 2.0 (ใช้สถานที่ถ่ายทำแทนโปสเตอร์หนังซึ่งไม่ฟรี) |
| Silver Lake | File:Know Your City No.101 Silver Lake Reservoir.jpg — Los Angeles Times | CC BY 4.0 (ภาพขาวดำเก่า) |
ข้อสังเกตจาก render: โลโก้แบรนด์ถูก crop แรงจาก `object-fit: cover` ในการ์ดสี่เหลี่ยม ("es G", "MUJI" ตัดขาด) → แนะนำ `contain` + พื้นขาว + padding สำหรับ type Brand; ต้องใส่ attribution (CC BY/BY-SA) ใน footer/credits; hotlink upload.wikimedia.org — production ควร cache เอง. Qloo จริงมี `properties.image.url` ต่อ entity (เห็นในโค้ด community, unverified จาก docs ทางการ)

---
## 2. Qloo API (official docs)
แหล่ง: https://docs.qloo.com/reference/insights-api-deep-dive · https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide · https://qloo.devpost.com/

- **Auth**: header `X-Api-Key` (ไม่ใช่ Bearer). Hackathon base `https://hackathon.api.qloo.com` (key ใช้กับ api./staging. ไม่ได้ → 401)
- **Insights**: `GET /v2/insights` — guide ระบุ "GET, params ใน query string, POST JSON จะ fail" (แต่ OpenAPI ระบุบาง param เช่น `signal.interests.entities.query` เป็น POST-only → ขัดกัน, ทดสอบจริงก่อน)
  - `filter.type` (required): artist, book, brand, destination, movie, person, place, podcast, tv_show, video_game (guide) / `urn:heatmap`, `urn:entity:locality` (partial), `urn:tag` (ใช้ในตัวอย่าง community) ; `urn:entity:audience` deprecated
  - signals: `signal.interests.entities` (IDs), `signal.interests.tags`, `signal.demographics.age` (enum: 24_and_younger, 25_to_29, 30_to_34, 35_and_younger, 35_to_44, 36_to_55, 45_to_54, 55_and_older), `signal.demographics.gender`, `signal.demographics.audiences`, `signal.location` (WKT/locality ID), `signal.location.query` ("Los Angeles", "Lower East Side"), `*.weight`
  - filters: `filter.location.query`, `filter.location.radius`, `filter.tags`, `filter.results.entities`, `filter.results.tags` ("Often used to assess the affinity of a tag towards input"), `filter.popularity.min/max`, `filter.price_level.*` (places), `filter.exists=properties.image`, `filter.parents.types` (urn:audience:…)
  - `feature.explainability=true` → `query.explainability` บอกว่า input entity ไหน contribute เท่าไร (0–1) ← ใช้ทำ `sources[]`
  - heatmap: `filter.type=urn:heatmap`, `output.heatmap.boundary` (geohash default / `urn:entity:locality` = neighborhood), `heatmap.dimensions=quality,popularity,hotel_class,price_level`
  - `take` ≤ 50, `page`, `diversify.by`
- **Lookup**: `GET /search?query=&types=urn:entity:brand…` (entity resolution); `GET /v2/tags?filter.query=&feature.semantic_search=true`; `/v2/tags/types`; `/v2/audiences`, `/v2/audiences/types`; `Analysis`, `Analysis Compare`; Trending (ชื่อ endpoint จาก docs nav; path/params ละเอียด unverified)
- **Response fields**: OpenAPI ระบุแค่ `success`, `results.entities[]`, `duration`. Field ต่อ entity ที่ community ใช้: `entity_id`, `name`, `types`, `properties.image.url`, `properties.description`, `tags[]`, `query.affinity` (0–1), popularity — **unverified จาก docs ทางการ, ต้อง log response จริงก่อนออกแบบ schema**. บล็อก Qloo บอก affinity "0 to 100" แต่ API/heatmap ตัวอย่างเป็น 0–1 → normalise เอง
- **Rate limits**: ไม่เปิดเผย ("high enough for typical hackathon projects", ขอเพิ่มใน Discord #api-help). Cache ฝั่ง server ได้ ห้ามเก็บ response ใน public repo
- **Pricing**: ไม่มีราคาเปิดเผย/ไม่มี self-serve free tier (enterprise quote) — ทางเดียวที่ realistic = hackathon key
- **Gotchas**: param ผิดถูก ignore เงียบ ๆ (200 + empty); type ผิด → 403; tag ต้องเป็น ID จาก /v2/tags; hackathon env อาจไม่มีข้อมูลทุกเมือง

### Hackathons ของ Qloo
- Qloo LLM Hackathon 2025 (2,893 คน): ชนะ GeoTaste ($10k), HM: Alloy, Resonance AI, Zesty. เกณฑ์ (เท่ากัน): thoughtful LLM use, Qloo integration (cross-domain affinity), technical execution, originality, real-world potential — https://qloo-hackathon.devpost.com/rules
- **Qloo Agentic Hackathon 2026 — เปิดอยู่**, deadline 30 ต.ค. 2026 23:45 EDT, $15k/$6k/$4k (+JCal $25k investment). ต้องมี live hosted demo + public repo + OSS license (ไม่ต้องมีวิดีโอ). เกณฑ์: Technological Implementation (ใช้ Qloo ลึก), Design (product ครบ), Potential Impact, Quality of Idea. "If your submission would work the same without Qloo, you're building the wrong thing" — https://qloo.devpost.com/
  → TasteDraft เข้าธีมพอดี (agent + human authorize). ส่งได้ทั้ง U-Hackathon (16 ต.ค.) และ Qloo (30 ต.ค.)

### 2.1 Mapping mock → Qloo
| Mock ใน prototype | Qloo จริง | หมายเหตุ/Gap |
|---|---|---|
| TYPES (Brand/Artist/Film/Place) | `GET /search?query=<ref>&types=…` → entity_id, types | types ของ /search ≠ filter.type |
| refImages | `properties.image.url` จาก search/insights | field unverified |
| 4 signals (Fashion/Music/Design/Location) + Strong/Moderate | `/v2/insights?filter.type=urn:tag&signal.interests.entities=<ids>&signal.demographics.age=24_and_younger&signal.location.query=Los Angeles` → tag affinity; แบ่ง level จาก percentile ของเรา | Qloo ไม่มี "level" — เราจัดเอง |
| cross-domain fit | Insights `filter.type` = artist / brand / movie / place (3–4 calls) ด้วย signal เดียวกัน + `feature.explainability=true` | |
| Districts min/lux + hex map | `filter.type=urn:heatmap&signal.interests.entities=<ids>&filter.location.query=Los Angeles&output.heatmap.boundary=urn:entity:locality` (+ อีก call ด้วย luxury tag หรือ `heatmap.dimensions=price_level`) | ต้องแปลง geohash→hex เอง; ข้อมูลเมืองนอก US อาจบาง |
| audience 18–25 | `signal.demographics.age=24_and_younger` (+`25_to_29` ถ้า 26+) | bucket ไม่ตรง 18–25 — แสดง "≈" |
| friction (premium price / scarcity) | `filter.results.tags=<luxury/premium tag IDs>` กับ audience signal → affinity ต่ำ = friction | ไม่มี price-sensitivity โดยตรง (inferred) |
| V2 | rerun pipeline เดียวกันด้วย concept tags ใหม่ | |
| inference prose, WHY, proposals | LLM (grounded ใน JSON response) | ไม่ใช่ Qloo |
| sigCount/domCount | นับจาก response จริง | |

---
## 3. Fallback evidence ระหว่างยังไม่มี Qloo key
ออกแบบ `interface EvidenceProvider { resolve(refs), tagAffinity(seed, audience, city), crossDomain(...), localSignals(city, tags), audienceFit(...) }` คืน `Signal{domain,name,value0to1,source,provenance:'qloo'|'open-data'|'llm-inferred'|'mock', url}` → engine อ่านเฉพาะ `value0to1` จึงสลับ Qloo ได้ทีหลังโดยไม่แก้ UI/engine.

| แหล่ง | ใช้ทำอะไร | Key? | หมายเหตุ |
|---|---|---|---|
| Wikidata SPARQL / API | entity resolution, type (brand/artist/film/place), รูป P18, genre/movement | ฟรี ไม่ต้อง key | ใส่ User-Agent |
| Wikimedia Commons | cover images + license metadata | ฟรี ไม่ต้อง key | (ใช้แล้วในงานนี้) |
| Wikipedia Pageviews API | popularity proxy (รวมแยกภาษา) | ฟรี ไม่ต้อง key | |
| Last.fm API | artist.getSimilar, artist.getTopTags, tag.getTopArtists, geo.getTopArtists (ระดับประเทศ) | ฟรี ต้อง API key | ไม่มีระดับเมือง/อายุ (unverified ว่ายังเปิด) |
| MusicBrainz / ListenBrainz | genre tags, similar artists | ฟรี ไม่ต้อง key | rate limit ~1 req/s |
| TMDB | film search, keywords, recommendations, images | ฟรี ต้อง key (non-commercial) | |
| OpenStreetMap Overpass | ความหนาแน่น POI ต่อย่าน (record store, boutique, gallery vs luxury) → local fit/district map | ฟรี ไม่ต้อง key | proxy ไม่ใช่ taste |
| Spotify Web API | search, artist genres/popularity | ฟรี ต้อง client id/secret | Related Artists/Recommendations/Audio Features **ปิดสำหรับ app ใหม่ตั้งแต่ 27 พ.ย. 2024** (https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) |
| Google Trends | interest by region | official API = alpha แบบสมัคร (https://developers.google.com/search/blog/2025/07/trends-api); pytrends = unofficial เสี่ยงพัง | ไม่แนะนำสำหรับ demo |
| LLM + web search | ทุกมิติ (สำรองสุดท้าย) | ต้อง key LLM | ต้องติดป้าย "Inferred by AI — not measured", cap evidence = LIMITED/MEDIUM |
ลำดับแนะนำ: Qloo → Open-data (Wikidata+Last.fm+TMDB+OSM) → LLM-inferred → Mock. ทุกค่าใน UI แสดง provenance.

---
## 4. Competitor scan
| เครื่องมือ | ทำอะไร | แหล่ง |
|---|---|---|
| Synthetic Users | AI personas สัมภาษณ์/concept & messaging test | https://www.syntheticusers.com/ |
| Evidenza | synthetic surveys/interviews B2B | https://www.evidenza.ai/ |
| Ask Rally | audience simulator, virtual focus groups/polls | https://askrally.com/ |
| Electric Twin | twin ของ audience จาก customer data, validate กับ survey จริง | https://www.electrictwin.com/ |
| Aaru | population simulation (ไม่เปิด pricing) | https://getminds.ai/blog/synthetic-users-alternatives |
**ต่างกันตรงไหน**: คู่แข่งส่วนใหญ่ = LLM persona "ตอบแทน" คนจริง (คะแนน/คำตอบมาจาก LLM). TasteDraft = (1) evidence จาก taste graph ที่วัดได้ (Qloo) + location ระดับย่าน (2) คะแนน deterministic ตรวจสอบได้ (ledger) (3) agent เสนอ counterfactual แล้ว human authorize → re-sim เทียบ V1/V2. จุดอ่อน: ไม่มี qualitative "เสียงลูกค้า" และขึ้นกับ coverage ของ Qloo

---
## 5. MVP plan (one loop)
**Input** idea, age, city, refs[≤8], positioning
1. LLM extract → `{concept_terms[], conflicts_hypotheses[] (เช่น premium, scarcity), domains[]}` (JSON schema, ไม่มีตัวเลข)
2. Resolve: `GET /search?query=<ref>` ×N (parallel) + `GET /v2/tags?filter.query=<term>&feature.semantic_search=true` ×terms → entity IDs, concept tag IDs, conflict tag IDs
3. Evidence (parallel, cache by hash):
   - A anchor: `/v2/insights?filter.type=urn:tag&signal.interests.entities=<refIDs>&filter.results.tags=<conceptTags>`
   - B cross: `/v2/insights?filter.type=urn:entity:{artist,brand,movie}&signal.interests.tags=<conceptTags>&signal.interests.entities=<refIDs>&feature.explainability=true&take=10`
   - C local: `/v2/insights?filter.type=urn:heatmap&signal.interests.tags=<conceptTags>&filter.location.query=<city>&output.heatmap.boundary=urn:entity:locality` (+ conflict tags สำหรับ lux map)
   - D audience: `/v2/insights?filter.type=urn:tag&signal.demographics.age=<bucket>&signal.location.query=<city>&filter.results.tags=<conceptTags,conflictTags>`
4. Engine (pure TS function, unit-tested):
   - normalise affinity a∈[0,1] (ถ้า 0–100 หาร 100)
   - `anchor = 100·mean(a_concept | refs)`
   - `cross = 100·mean_d( mean top-5 a in domain d )` เฉพาะ domain ที่มีผล ≥3 รายการ; × coverage = domainsWithData/3 (cap 1)
   - `local = 100·(share ของ concept affinity ใน top-3 localities)` หรือ percentile ของ city-level affinity
   - `audience = 100·mean(a_concept | age, city)`
   - `friction = 100·max_c( max(0, a_conflict_in_concept_seed − a_conflict_in_audience) )` (ช่องว่างระหว่าง "สิ่งที่ concept สื่อ" กับ "สิ่งที่ audience ชอบ")
   - total ตาม WEIGHTS + FRICTION_FACTOR เดิม; evidenceStrength = f(active refs ที่ resolve ได้ + จำนวน signals ที่ไม่ว่าง); เก็บ ledger + raw inputs ทุกตัว (auditable)
   - **สูตรนี้เป็นข้อเสนอของเรา ไม่ใช่ของ Qloo** — calibrate กับ 3–5 concept ตัวอย่าง
5. LLM critic: รับ ledger + signals JSON → frictions[{text,why,evidenceIds}] + proposals[{before,after,why,evidence}] (ต้องอ้าง signal id; validate ว่า id มีจริง)
6. Human Apply → แก้ concept tags (swap conflict tag → alt tag) → รัน step 3–4 ใหม่ (re-use cache refs) → compare V1/V2 (delta ต่อมิติ)
Response = shape เดิมใน brief + `provenance`, `raw` (debug)

**Top risks**: (1) key ไม่ทันก่อน 16 ต.ค. → ใช้ fallback provider + ติดป้าย (2) field/param จริงต่างจากที่คาด + param ผิดถูก ignore เงียบ → spike test วันแรก, log response (3) ข้อมูลบางในบางเมือง/อายุ bucket ไม่ตรง (4) V2 อาจไม่ดีขึ้นจริง → ต้องโชว์ตรงไปตรงมา ไม่ fix 71→82 (5) LLM hallucinate evidence → enforce evidenceIds (6) latency 6–10 calls → parallel + cache + progress steps จริง (7) Claude Design format แก้ยาก → ย้ายไป Vite/React เมื่อเริ่ม build (ใช้ split/ เป็นต้นฉบับ)

## 6. Split files (`split/`)
template.html 31 KB · styles.css 46 KB · fonts.css 7 KB · logic.js 28 KB · engine.js 0.4 KB · mock-data.js 0.9 KB · shell.html 19 KB · runtime.manifest.json 290 KB (อย่าโหลดเข้า AI) · build.mjs · README.md. `node split/build.mjs` → `Main.rebuilt.dc.html` **byte-identical** กับต้นฉบับ (cmp ผ่าน). หมายเหตุ: compute() และ mock texts (signals/fits/WHY/proposals) ยังอยู่ใน logic.js เพราะเป็น method ของ class
