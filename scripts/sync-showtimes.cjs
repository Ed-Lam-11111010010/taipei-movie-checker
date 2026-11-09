'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const TurndownService = require('turndown');
const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '*' });
converter.remove(['script', 'style', 'noscript', 'svg']);
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
const checkedAt = new Date().toISOString();
const today = dateFmt.format(new Date());
const pad = x => String(x).padStart(2, '0');
const addDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const maximumDate = addDays(today, 30);
// All seven dates (today through +6) get an explicit source request, whether
// or not the site's navigation advertises them. Only trustworthy rows publish.
const LOOKAHEAD_DAYS = 7;
const SOURCE_FETCH_CONCURRENCY = 4;
const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
const seen = new Set();
const output = [];
// Keep all poster URLs matched to the same movie on a trusted source page.
// Never infer a poster from title-only search results or accept arbitrary hosts.
function trustedPoster(poster) {
  if (!poster || !poster.url || !poster.source) return {};
  try {
    const image = new URL(poster.url);
    const page = new URL(poster.source);
    if (image.protocol !== 'https:' || page.protocol !== 'https:' ||
        image.username || image.password || image.port ||
        page.username || page.password || page.port) return {};
    const photo = /^\/photo101\/([a-z0-9]+)\/pl_([a-z0-9]+)\.jpg$/i.exec(image.pathname);
    const film = /^\/(?:movie|film)\/([a-z0-9]+)\/$/i.exec(page.pathname);
    const atmovies = image.hostname === 'www.atmovies.com.tw' &&
      page.hostname === 'www.atmovies.com.tw' && photo && film &&
      photo[1].toLowerCase() === photo[2].toLowerCase() &&
      photo[1].toLowerCase() === film[1].toLowerCase();
    const ambassador = image.hostname === 'www.ambassador.com.tw' &&
      page.hostname === 'www.ambassador.com.tw' &&
      /^\/assets\/img\/movies\/[a-z0-9_.()-]+\.(?:jpg|jpeg|png|webp)$/i.test(image.pathname) &&
      page.pathname === '/home/MovieContent' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(page.searchParams.get('MID') || '');
    return atmovies || ambassador ? { posterUrl: image.href, posterSourceUrl: page.href } : {};
  } catch { return {}; }
}
// Alternate publicly readable theater-specific schedule pages. Used only if the Vieshow site blocks GitHub Actions.
const atmoviesFallback = {
  'vieshow-xinyi': ['t02a01', '台北信義威秀'],
  'vieshow-qsquare': ['t02b14', '台北京站威秀'],
  'vieshow-muvie': ['t02a11', 'MUVIE CINEMAS台北松仁威秀'],
  'vieshow-nangang': ['t02a12', '台北南港LaLaport威秀影城'],
  'vieshow-ximen': ['t02b08', '台北西門威秀影城'],
  'vieshow-banqiao': ['t02e07', '板橋大遠百威秀影城'],
  'vieshow-xindian': ['t02e21', '新店裕隆城威秀影城'],
  'vieshow-zhonghe': ['t02e20', '中和環球威秀影城'],
  'vieshow-linkou': ['t02e12', '林口三井OUTLET威秀影城'],
  'showtime-xinxin': ['t02d03', '欣欣秀泰影城']
};
// @movies publishes theater-specific screening URLs for these 26 directory additions.
// Mapping is an allowlist: validate the named venue and exact date before accepting rows.
// A theater is promoted into catalog.cinemas ONLY after a successful source parse.
const additionalAtmovies = {
  "showtime-dome": [
    "t02a13",
    "大巨蛋秀泰影城"
  ],
  "eslite-cinema": [
    "t02a08",
    "誠品電影院"
  ],
  "luxcinema-ximen": [
    "t02b03",
    "樂聲影城"
  ],
  "wonderful-cinema": [
    "t02b07",
    "真善美戲院"
  ],
  "centuryasia-ximen": [
    "t02b06",
    "喜樂時代影城西門今日店"
  ],
  "skcinema-ximen": [
    "t02b05",
    "台北新光影城"
  ],
  "miramar-dazhi": [
    "t02d05",
    "美麗華大直"
  ],
  "miranew-dazhi": [
    "t02d06",
    "美麗新大直皇家影城"
  ],
  "spot-taipei": [
    "t02d20",
    "光點台北電影院"
  ],
  "spot-huashan": [
    "t02b16",
    "光點華山電影館"
  ],
  "governor-taipei": [
    "t02a05",
    "總督影城"
  ],
  "breeze-taipei": [
    "t02a03",
    "微風影城"
  ],
  "centuryasia-nangang": [
    "t02a09",
    "喜樂時代影城"
  ],
  "halar-neihu": [
    "t02a06",
    "哈拉影城"
  ],
  "skcinema-tianmu": [
    "t02d04",
    "台北天母新光影城"
  ],
  "broadway-gongguan": [
    "t02c01",
    "百老匯影城公館店"
  ],
  "jingmei-jiajia": [
    "t02f05",
    "景美佳佳戲院"
  ],
  "tiantai-sanchong": [
    "t02e04",
    "三重天台戲院"
  ],
  "centuryasia-yonghe": [
    "t02e17",
    "永和喜樂時代影城"
  ],
  "showtime-tucheng": [
    "t02e15",
    "土城秀泰影城"
  ],
  "fuzhong15": [
    "t02e08",
    "府中15"
  ],
  "ambassador-xinzhuang": [
    "t02e11",
    "國賓新莊晶冠廣場影城"
  ],
  "machi-xinzhuang": [
    "t02e03",
    "新莊鴻金寶麻吉影城"
  ],
  "ambassador-linkou": [
    "t02e10",
    "國賓林口昕境廣場"
  ],
  "ambassador-tamsui": [
    "t02e18",
    "國賓影城淡水禮萊廣場"
  ],
  "showtime-shulin": [
    "t02e13",
    "樹林秀泰影城"
  ]
};
const primaryCinemaIds = new Set([...Object.keys(atmoviesFallback), 'ambassador-main', 'ambassador-changchun']);
function readAdditionalDirectory() {
  const code = fs.readFileSync('theater-directory.js','utf8');
  const match = /window\.MOVIE_CHECKER_ADDITIONAL_THEATERS\s*=\s*(\[[\s\S]*?\]);\s*$/.exec(code);
  if (!match) throw new Error('Additional theater directory format mismatch');
  const theaters = JSON.parse(match[1]);
  if (!Array.isArray(theaters) || theaters.length !== 26) throw new Error('Expected 26 directory cinemas');
  const names = new Set();
  for (const theater of theaters) {
    if (!theater.directoryOnly || names.has(theater.id) || !additionalAtmovies[theater.id] ||
        !theater.id || !theater.name || !theater.address ||
        !(theater.officialUrl === null || /^https:\/\//.test(theater.officialUrl)) ||
        !/^https:\/\//.test(theater.showtimesUrl)) {
      throw new Error('Untrusted additional theater record: ' + (theater?.id||'unknown'));
    }
    names.add(theater.id);
  }
  if (Object.keys(additionalAtmovies).length !== theaters.length) throw new Error('Mapping does not cover directory');
  return theaters;
}

function textMd(html) { return converter.turndown(html).replace(/\r/g, ''); }
function record(cinema, businessDate, title, format, time, sourceUrl, poster = null) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  format = String(format || '數位').replace(/\s+/g, ' ').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || businessDate < today ||
      businessDate > maximumDate || title.length < 2 || title.length > 120 ||
      format.length > 50 || !validTime.test(time)) return;
  if (!/^https:\/\//.test(sourceUrl) || !['www.vscinemas.com.tw','www.ambassador.com.tw','www.atmovies.com.tw','www.culture.ntpc.gov.tw'].includes(new URL(sourceUrl).hostname)) return;
  // Cinema listings sometimes group after-midnight showings under the previous business day.
  const date = Number(time.slice(0, 2)) < 6 ? addDays(businessDate, 1) : businessDate;
  const key = [cinema.id, businessDate, title, format, time].join('|');
  if (seen.has(key)) return;
  seen.add(key);
  const id = 'source-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 20);
  output.push({ id, cinemaId: cinema.id, date, sourceBusinessDate: businessDate,
    title, time, startsAt: date + 'T' + time + ':00+08:00', format,
    sourceUrl, isDemo: false, fetchedAt: checkedAt, posterVariant: 'teal', ...trustedPoster(poster) });
}
function vieshowDates(header) {
  const dates = [];
  for (const match of header.matchAll(/(?:^|[^\d])(\d{1,2})\/(\d{2})\s*\([日一二三四五六]\)/g)) {
    const month = Number(match[1]), day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year = Number(today.slice(0, 4));
    let key = year + '-' + pad(month) + '-' + pad(day);
    if (key < addDays(today, -30)) key = (year + 1) + '-' + pad(month) + '-' + pad(day);
    if (key >= today && key <= maximumDate && !dates.includes(key)) dates.push(key);
  }
  return dates;
}
function parseVieshow(md, cinema) {
  const begin = md.indexOf('全台威秀影城隔週電影新場次');
  if (begin < 0) throw new Error('Missing Vieshow session heading');
  const pieces = md.slice(begin).split(/所有售票通路同步開放購票/);
  const dates = vieshowDates(pieces[0]);
  if (dates.length < 1 || pieces.length < 2) throw new Error('Missing Vieshow date blocks');
  // A disclaimer separates each date panel; never guess extra panel dates.
  let matched = 0;
  for (let i = 0; i < Math.min(dates.length, pieces.length - 1); i++) {
    let title = '', format = '';
    for (const raw of pieces[i + 1].split('\n')) {
      const line = raw.trim();
      const movie = /^# (.+)$/.exec(line);
      const version = /^#{3,5} (.+)$/.exec(line);
      if (movie) { title = movie[1].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim(); format = ''; continue; }
      if (version) { format = version[1].trim(); continue; }
      if (!title || !format || !/^[*+-]\s+/.test(line)) continue;
      const clock = line.match(/(?:^|[^\d])([01]\d|2[0-3]):([0-5]\d)(?!\d)/);
      if (clock) { record(cinema, dates[i], title, format, clock[1] + ':' + clock[2], cinema.officialUrl); matched++; }
    }
  }
  if (matched < 5) throw new Error('Too few Vieshow screening rows: ' + matched);
}
function parseAmbassador(md, cinema, date, url) {
  if (!md.includes(date.replaceAll('-', '/')) || !md.includes(cinema.name)) throw new Error('Ambassador venue/date mismatch');
  const rows = md.split('\n');
  let title = '', format = '', active = false, matched = 0, posterCandidate = null, filmPoster = null;
  for (const raw of rows) {
    const line = raw.trim();
    if (/^##\s+影城資訊/.test(line)) break;
    const posterLink = /\[!\[\]\((https:\/\/www\.ambassador\.com\.tw\/assets\/img\/movies\/[^)\s]+)\)\]\((\/home\/MovieContent\?MID=[^)]+)\)/i.exec(line);
    if (posterLink) posterCandidate = { url: posterLink[1], page: posterLink[2] };
    if (/^###\s+/.test(line)) {
      title = ''; format = ''; active = true;
      const heading = /^###\s+\[[^\]]+\]\((\/home\/MovieContent\?MID=[^)]+)\)/i.exec(line);
      filmPoster = heading && posterCandidate && heading[1] === posterCandidate.page ?
        { url: posterCandidate.url, source: 'https://www.ambassador.com.tw' + heading[1] } : null;
    }
    const variant = /^\(([^)]{2,50})\)\s*(.{2,120})$/.exec(line);
    if (active && variant && /數位|ATMOS|IMAX|D-BOX|膠卷|國語|英文|日文|中文版|特別/.test(variant[1])) {
      title = variant[2].trim(); format = variant[1].trim(); continue;
    }
    if (!active || !title || !format) continue;
    const clock = /^(?:[-*]\s+)?#{4,6}\s+([01]\d|2[0-3]):([0-5]\d)/.exec(line);
    if (clock) { record(cinema, date, title, format, clock[1] + ':' + clock[2], url, filmPoster); matched++; }
  }
  if (matched < 1) throw new Error('No Ambassador showtimes');
}
function parseAtmovies(md, cinema, date, url) {
  const expected = atmoviesFallback[cinema.id] || additionalAtmovies[cinema.id];
  if (!expected || !md.includes(expected[1])) throw new Error('atmovies cinema identity does not match');
  const marker = '### ' + date.replaceAll('-', '/');
  const start = md.indexOf(marker);
  if (start < 0) throw new Error('No atmovies date heading');
  const section = md.slice(start).split(/更新時間:|## 台北戲院時間查詢/)[0];
  let title = '', format = '數位', matched = 0, filmId = '', filmPoster = null;
  for (const raw of section.split('\n')) {
    const line = raw.trim();
    if (/^#{1,4}\s+/.test(line) && !line.includes(marker)) { title = ''; continue; }
    // Titles must be linked to an @movies film page to avoid treating navigation as a movie.
    const film = line.match(/\[([^\]]{2,80})\]\((?:https?:\/\/[^)]*|\/)?(?:movie|film)\/[^)]*\)/i);
    if (film && !/片長|其他戲院|預告/.test(film[1])) {
      title = film[1].trim(); format = '數位';
      filmId = /\/(?:movie|film)\/([a-z0-9]+)\//i.exec(line)?.[1] || '';
      filmPoster = null;
      continue;
    }
    const image = /!\[[^\]]*\]\((\/photo101\/([a-z0-9]+)\/pl_([a-z0-9]+)\.jpg)\)/i.exec(line);
    if (title && filmId && image && image[2].toLowerCase() === filmId.toLowerCase() &&
        image[3].toLowerCase() === filmId.toLowerCase()) {
      filmPoster = { url: 'https://www.atmovies.com.tw' + image[1],
        source: 'https://www.atmovies.com.tw/movie/' + filmId + '/' };
    }
    if (title && /^\s*[*+-]\s+/.test(line)) {
      if (/SCREENX|IMAX|4DX|ATMOS/.test(line)) { format = line.replace(/^[*+-]\s*/, '').trim(); continue; }
      const t = line.match(/(?:^|[^\d])([01]\d|2[0-3])[：:]([0-5]\d)(?!\d)/);
      if (t) { record(cinema, date, title, format, t[1] + ':' + t[2], url, filmPoster); matched++; }
    }
  }
  if (matched < 1) throw new Error('No trustworthy atmovies rows');
}
// Navigation is advisory only: accept future dates from an identity-matched
// cinema header and validate every requested day with parseAtmovies().
function advertisedAtmoviesDays(md, cinema) {
  const expected = atmoviesFallback[cinema.id] || additionalAtmovies[cinema.id];
  if (!expected || !md.includes(expected[1])) return [];
  const header = md.split(/^###\s+20\d{2}\/\d{2}\/\d{2}/m)[0];
  return vieshowDates(header).filter(date => date >= today &&
    date <= addDays(today, ADVERTISED_LOOKAHEAD_DAYS - 1));
}
function queueAdvertisedAtmoviesDates(urls, md, cinema) {
  const expected = atmoviesFallback[cinema.id] || additionalAtmovies[cinema.id];
  if (!expected) return;
  for (const day of advertisedAtmoviesDays(md, cinema)) {
    const url = 'https://www.atmovies.com.tw/showtime/' + expected[0] +
      '/a02/' + day.replaceAll('-', '') + '/';
    if (!urls.some(candidate => candidate[1] === url)) urls.push([day, url, 'atmovies']);
  }
}
// Read a cinema-specific online ticket portal only from its identity-matched
// @movies venue page. Never guess a screening ID or accept arbitrary domains.
function atmoviesTicketPortal(md, cinema) {
  const expected = atmoviesFallback[cinema.id] || additionalAtmovies[cinema.id];
  if (!expected || !md.includes(expected[1])) return null;
  const header = md.split(/^###\s+20\d{2}\/\d{2}\/\d{2}/m)[0];
  const match = /網路訂票\s*:\s*\[www\.ezding\.com\.tw\]\((https:\/\/[^)\s]+)\)/.exec(header);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    if (url.protocol !== 'https:' || url.hostname !== 'www.ezding.com.tw' ||
        url.pathname !== '/cinemabooking' || url.username || url.password || url.port ||
        url.hash || !/^[a-f0-9]{32}$/i.test(url.searchParams.get('cinemaid') || '')) return null;
    return url.href;
  } catch { return null; }
}
// 府中15 has an official municipal, month-scoped screening table instead of
// ordinary per-movie schedules. Treat ticket/registration status as source data,
// never as an available/guaranteed ticket.
function parseFuzhong(html, cinema, url) {
  if (cinema.id !== 'fuzhong15') throw new Error('Fuzhong cinema mismatch');
  const md = textMd(html);
  if (!md.includes('府中15') || !/放映場次表/.test(md)) throw new Error('Fuzhong official page identity mismatch');
  const ym = /(20\d{2})年\s*(\d{1,2})月放映場次表/.exec(md);
  if (!ym) throw new Error('Missing official Fuzhong monthly calendar');
  const year = Number(ym[1]), month = Number(ym[2]);
  if (year < 2025 || year > 2100 || month < 1 || month > 12) throw new Error('Invalid official schedule month');
  let matched = 0;
  const consume = cells => {
    if (cells.length < 3) return;
    const dateMatch = /^\s*(\d{1,2})\/(\d{1,2})\s*\([日一二三四五六]\)/.exec(cells[0]);
    const timeMatch = /(?:^|[^\d])([01]\d|2[0-3]):([0-5]\d)(?!\d)/.exec(cells[1] || '');
    if (!dateMatch || !timeMatch || Number(dateMatch[1]) !== month) return;
    const date = year+'-'+pad(month)+'-'+pad(Number(dateMatch[2]));
    const rawTitle = cells[2].replace(/\[([^\]]{1,120})\]\([^)]+\)/g,'$1').replace(/\s+/g,' ').trim();
    const status = /(?:^|\s)([售報索])$/.exec(rawTitle)?.[1] || '';
    const title = rawTitle.replace(/\s+[售報索]$/, '').trim();
    if (!title || title==='片名' || title.length>120) return;
    const format = status === '售' ? '府中15電影放映（票券）' :
      status === '報' ? '府中15電影放映（需報名）' :
      status === '索' ? '府中15電影放映（索票）' : '府中15特別放映';
    const before=output.length;
    record(cinema,date,title,format,timeMatch[1]+':'+timeMatch[2],url);
    if (output.length > before) matched++;
  };
  // Use the official table's native rows first; Turndown's default rules
  // flatten HTML tables and otherwise lose the cell boundaries.
  for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(match=>textMd(match[1]).replace(/\s+/g,' ').trim());
    consume(cells);
  }
  if (matched < 1) throw new Error('No safely parsed upcoming Fuzhong sessions');
}

async function get(url, rawHtml = false, timeoutMs = 22000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MovieCheckerPersonalPOC/1.0; +https://github.com/Ed-Lam-11111010010/taipei-movie-checker)', 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    if (html.length < 1000 || html.length > 8000000) throw new Error('Unexpected HTML length ' + html.length);
    return rawHtml ? html : textMd(html);
  } finally { clearTimeout(timer); }
}
function candidateSourceUrls(cinema, newDirectory) {
  const urls = [];
  if (newDirectory) {
    if (cinema.id==='fuzhong15') {
      urls.push([today,'https://www.culture.ntpc.gov.tw/fuzhong15_chi/xcmovie?XsmSId=0M361641875264878260','fuzhong']);
    } else {
      const atmoviesId=additionalAtmovies[cinema.id][0];
      // The stable venue page often contains today's times when explicit
      // YYYYMMDD pages do not; parse only if its heading is exactly today.
      urls.push([today,'https://www.atmovies.com.tw/showtime/'+atmoviesId+'/a02/','atmovies']);
      // Validate seven explicit dates, including +5 and +6.
      for (let d=0;d<LOOKAHEAD_DAYS;d++) {
        const day=addDays(today,d);
        urls.push([day,'https://www.atmovies.com.tw/showtime/'+atmoviesId+
          '/a02/'+day.replaceAll('-','')+'/','atmovies']);
      }
    }
  } else if (cinema.id.startsWith('vieshow-')) {
    urls.push([today, cinema.officialUrl, 'vieshow']);
    // Official Vieshow often blocks automated access: consult its verified
    // alternate venue page as well as the seven explicit dates.
    urls.push([today, 'https://www.atmovies.com.tw/showtime/' +
      atmoviesFallback[cinema.id][0] + '/a02/', 'atmovies']);
    for (let d = 0; d < LOOKAHEAD_DAYS; d++) {
      const day = addDays(today, d);
      urls.push([day, 'https://www.atmovies.com.tw/showtime/' + atmoviesFallback[cinema.id][0] + '/a02/' + day.replaceAll('-', '') + '/', 'atmovies']);
    }
  }
  else if (cinema.id.startsWith('ambassador-')) for (let d=0;d<LOOKAHEAD_DAYS;d++) {
    const day = addDays(today,d);
    urls.push([day, cinema.showtimesUrl + '&DT=' + day.replaceAll('-', '%2F'), 'ambassador']);
  } else if (cinema.id === 'showtime-xinxin') {
    urls.push([today,'https://www.atmovies.com.tw/showtime/t02d03/a02/','atmovies']);
    for (let d=0;d<LOOKAHEAD_DAYS;d++) {
      const day = addDays(today,d);
      urls.push([day, 'https://www.atmovies.com.tw/showtime/t02d03/a02/' + day.replaceAll('-', '') + '/', 'atmovies']);
    }
  }
  return urls;
}
async function run() {
  const previous = JSON.parse(fs.readFileSync('catalog.json','utf8'));
  if (!Array.isArray(previous.cinemas)) throw new Error('Cinema catalog missing');
  const original = previous.cinemas.filter(c => primaryCinemaIds.has(c.id));
  if (original.length !== 12 || new Set(original.map(c=>c.id)).size !== 12)
    throw new Error('Original 12 cinema adapters missing or duplicated');
  const additional = readAdditionalDirectory();
  const allCinemas = original.concat(additional);
  const syncedAdditional = [];
  const sources = [];
  for (const cinema of allCinemas) {
    const newDirectory = !primaryCinemaIds.has(cinema.id);
    let error = null, dates = [], before = output.length, discoveredTicketPortal = null;
    const urls = candidateSourceUrls(cinema, newDirectory);
    // One status for each of the next seven days. A source error or an empty
    // parsed page NEVER means the cinema has no real-world screenings.
    const checkMap = new Map(Array.from({length:LOOKAHEAD_DAYS},(_,offset)=>
      [addDays(today,offset),{date:addDays(today,offset),state:'unverified'}]));
    function noteVerifiedDays() {
      for (const row of output.slice(before)) {
        if (checkMap.has(row.sourceBusinessDate))
          checkMap.set(row.sourceBusinessDate,{date:row.sourceBusinessDate,state:'verified'});
      }
    }
    const fetchCandidate = async candidate => {
      const [day,url,kind]=candidate;
      try {
        const markdown = await get(url,kind==='fuzhong',kind==='fuzhong'||kind==='vieshow'?22000:12000);
        return {candidate,markdown};
      } catch (failure) { return {candidate,failure}; }
    };
    let officialSucceeded = false;
    const parseCandidate = result => {
      const [day,url,kind]=result.candidate;
      try {
        if (result.failure) throw result.failure;
        const markdown = result.markdown;
        if (kind==='fuzhong') parseFuzhong(markdown,cinema,url);
        if (kind==='vieshow') { parseVieshow(markdown,cinema); officialSucceeded=true; }
        if (kind==='ambassador') parseAmbassador(markdown,cinema,day,url);
        if (kind==='atmovies') {
          // The seven dated requests are always present; navigation only
          // confirms dates the upstream site actually advertises.
          queueAdvertisedAtmoviesDates(urls,markdown,cinema);
          parseAtmovies(markdown,cinema,day,url);
          if (newDirectory && !discoveredTicketPortal)
            discoveredTicketPortal=atmoviesTicketPortal(markdown,cinema);
        }
        noteVerifiedDays();
      } catch (failure) {
        const message=(failure instanceof Error?failure.message:String(failure)).slice(0,150);
        error=message;
        if (result.failure && checkMap.get(day)?.state!=='verified')
          checkMap.set(day,{date:day,state:'source_error'});
        console.warn(cinema.id,day,message);
      }
    };
    // Official Vieshow is checked first. Dated fallback requests still run
    // even when it works, so day +5/+6 cannot be silently skipped.
    const official = urls.find(candidate=>candidate[2]==='vieshow');
    if (official) parseCandidate(await fetchCandidate(official));
    const dated = urls.filter(candidate=>candidate!==official);
    for (let offset=0;offset<dated.length;offset+=SOURCE_FETCH_CONCURRENCY) {
      const batch = await Promise.all(dated.slice(offset,offset+SOURCE_FETCH_CONCURRENCY).map(fetchCandidate));
      for (const result of batch) parseCandidate(result);
    }
    noteVerifiedDays();
    const dateChecks=[...checkMap.values()];
    const rows = output.slice(before);
    dates = [...new Set(rows.map(r=>r.sourceBusinessDate))].sort();
    const success = rows.length > 0;
    if (success && newDirectory) {
      // Remove the directory-only flag; all movie links will now use verified rows.
      const {directoryOnly, coverage, referenceUrl, region, ...fields} = cinema;
      const promoted = { ...fields, showtimesUrl: rows[0].sourceUrl };
      if (discoveredTicketPortal) promoted.ticketPortalUrl = discoveredTicketPortal;
      // Ticket portals are generic entry points, never a fabricated session link.
      if (cinema.id.startsWith('ambassador-'))
        promoted.ticketPortalUrl = 'https://booking.ambassador.com.tw/';
      if (cinema.id.startsWith('showtime-'))
        promoted.ticketPortalUrl = 'https://www.showtimes.com.tw/';
      syncedAdditional.push(promoted);
    }
    const usedFallback = success && cinema.id.startsWith('vieshow-') && !officialSucceeded;
    sources.push({ cinemaId: cinema.id, sourceUrl: success ? rows[0].sourceUrl : cinema.showtimesUrl,
      state: success ? (error ? 'partial' : 'ok') : 'error',
      lastAttemptAt: checkedAt, lastSuccessAt: success ? checkedAt : null,
      coverage: dates, dateChecks,
      message: success ? rows.length + ' 個可解析場次／' + dates.length + ' 個日期' +
        '；未來7日逐日驗證 '+dateChecks.filter(x=>x.state==='verified').length+'/7 日' +
        (usedFallback ? '；威秀官方來源拒絕自動請求，改用開眼影城頁' : '') +
        (error && !usedFallback ? '；其他頁面讀取失敗' : '') :
        '無法安全解析場次；請前往來源網頁確認' });
    console.log(cinema.id + ': ' + rows.length + ' screenings, verified_dates=' +
      dateChecks.filter(x=>x.state==='verified').map(x=>x.date).join(',') +
      ', unverified_dates=' + dateChecks.filter(x=>x.state!=='verified').map(x=>x.date+':'+x.state).join(','));
  }
  if (output.length < 5) throw new Error('No safe publish: too few valid real screenings (' + output.length + ')');
  if (output.length > 15000) throw new Error('Too many screenings: ' + output.length);
  output.sort((a,b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
  const catalog = { schemaVersion: 1, mode: 'source-snapshot', checkedAt,
    refreshIntervalMinutes: 360, cinemas: original.concat(syncedAdditional), screenings: output,
    sources, adapterVersion: 'github-actions-source-parser-v3-expanded-theaters' };
  fs.writeFileSync('catalog.json', JSON.stringify(catalog) + '\n');
  console.log('Published snapshot: ' + output.length + ' entries, ' +
    sources.filter(s=>s.lastSuccessAt).length + '/' + allCinemas.length +
    ' venues; ' + syncedAdditional.length + '/26 added cinemas successfully parsed, ' + checkedAt);
}
function selftest() {
  // Every cinema must actually attempt +5/+6 day URLs: listing those dates
  // in a landing-page navigation is not sufficient proof of checking them.
  const explicitDay5=addDays(today,5),explicitDay6=addDays(today,6);
  for(const c of [
    {id:'vieshow-xinyi',officialUrl:'https://www.vscinemas.com.tw/theater/detail.aspx?id=1',newDirectory:false},
    {id:'ambassador-main',showtimesUrl:'https://www.ambassador.com.tw/home/Showtime?ID=84b87b82-b936-4a39-b91f-e88328d33b4e',newDirectory:false},
    {id:'showtime-xinxin',newDirectory:false},
    {id:'centuryasia-yonghe',newDirectory:true}
  ]) {
    const requests=candidateSourceUrls(c,c.newDirectory);
    for(const date of [explicitDay5,explicitDay6]){
      const matches=requests.filter(([day,url,kind])=>day===date &&
        (kind==='ambassador' ? url.includes('DT='+date.replaceAll('-','%2F')) : url.includes(date.replaceAll('-',''))));
      if(matches.length!==1)throw Error('Missing unique explicit +5/+6 cinema/day check: '+c.id+' '+date);
    }
  }
  const dayLabel = key => Number(key.slice(5,7)) + '/' + key.slice(8) +
    ' (' + '日一二三四五六'[new Date(key + 'T00:00:00Z').getUTCDay()] + ')';
  const day3=addDays(today,3),day6=addDays(today,6),day8=addDays(today,8);
  const nav=['台北信義威秀','選擇日期：'+[dayLabel(day3),dayLabel(day6),dayLabel(day8)].join(' '),
    '### '+today.replaceAll('-','/')+' (一)'].join('\n');
  const options=advertisedAtmoviesDays(nav,{id:'vieshow-xinyi'});
  if (options.join(',') !== [day3,day6].join(','))
    throw new Error('Advertised date window must include valid future days up to seven');
  if (advertisedAtmoviesDays(nav.replace('台北信義威秀','無關影城'),{id:'vieshow-xinyi'}).length)
    throw new Error('Navigation must match the cinema');
  const urls=[[today,'https://www.atmovies.com.tw/showtime/t02a01/a02/','atmovies']];
  queueAdvertisedAtmoviesDates(urls,nav,{id:'vieshow-xinyi'});
  queueAdvertisedAtmoviesDates(urls,nav,{id:'vieshow-xinyi'});
  if (urls.length!==3 || !urls.some(r=>r[0]===day3 && r[1].endsWith(day3.replaceAll('-','')+'/')) ||
      !urls.some(r=>r[0]===day6) || urls.some(r=>r[0]===day8))
    throw new Error('Advertised date URLs must be identity-matched and deduplicated');

  const sampleTicket = '永和喜樂時代影城\\n網路訂票: [www.ezding.com.tw](https://www.ezding.com.tw/cinemabooking?campaign_code=atmovie_cinemapage&channel=atmovie&cinemaid=c072c5c43fc011e9a245782bcb259cad)\\n### 2026/11/04 (三)'.replaceAll('\\n','\n');
  if (atmoviesTicketPortal(sampleTicket, {id:'centuryasia-yonghe'}) !== 'https://www.ezding.com.tw/cinemabooking?campaign_code=atmovie_cinemapage&channel=atmovie&cinemaid=c072c5c43fc011e9a245782bcb259cad')
    throw new Error('Verified cinema-specific ticket link fixture failed');
  if (atmoviesTicketPortal(sampleTicket.replace('www.ezding.com.tw/cinemabooking','www.ezding.com.tw.evil.test/cinemabooking'),{id:'centuryasia-yonghe'}))
    throw new Error('Untrusted ticket host accepted');
  const fake = { id:'vieshow-xinyi',name:'台北信義威秀影城',officialUrl:'https://www.vscinemas.com.tw/theater/detail.aspx?id=1' };
  const weekday = '日一二三四五六'[new Date(today + 'T00:00:00Z').getUTCDay()];
  const head = '<h2>場次查詢全台威秀影城隔週電影新場次</h2><p>' + today.slice(5,7) + '/' + today.slice(8) + ' (' + weekday + ')</p><p>*所有售票通路同步開放購票</p>';
  const films = ['泥面人','快打旋風'].map(title => '<h1>' + title + '</h1><h2>ENGLISH</h2><h4>數位(英)</h4><ul><li><a>13:20</a></li><li><a>16:30</a></li><li><a>19:00</a></li></ul>').join('');
  parseVieshow(textMd(head+films),fake);
  if (output.length !== 6) throw new Error('Vieshow parser selftest: ' + output.length);

  const filmId = 'fcen34890576', formatDate = today.replaceAll('-', '/');
  const atmoviesFixture = ['台北信義威秀', '### ' + formatDate + ' (二)',
    '* [泥面人](/movie/' + filmId + '/)',
    '* * [![](/photo101/' + filmId + '/pl_' + filmId + '.jpg)](http://app2.atmovies.com.tw/poster/' + filmId + '/)',
    '* 19：30'].join('\n');
  parseAtmovies(atmoviesFixture, fake, today, 'https://www.atmovies.com.tw/showtime/t02a01/a02/' + today.replaceAll('-', '') + '/');
  const atm = output.find(row => row.cinemaId === fake.id && row.format === '數位' && row.title === '泥面人');
  if (!atm || atm.posterUrl !== 'https://www.atmovies.com.tw/photo101/' + filmId + '/pl_' + filmId + '.jpg' ||
      atm.posterSourceUrl !== 'https://www.atmovies.com.tw/movie/' + filmId + '/') throw new Error('Atmovies poster selftest failed');

  const venue = { id:'ambassador-main',name:'國賓大戲院' }, mid='74a37a70-92f7-42c8-8809-b69f94ee3453';
  const page = '/home/MovieContent?MID=' + mid + '&DT=' + formatDate;
  const jpg = 'https://www.ambassador.com.tw/assets/img/movies/Clayface_180x270_Poster.jpg';
  const ambassadorFixture = [venue.name, formatDate, '[![](' + jpg + ')](' + page + ')',
    '### [泥面人Clayface](' + page + ')', '(數位‧英文版)泥面人', '* ###### 18:50'].join('\n');
  parseAmbassador(ambassadorFixture, venue, today, 'https://www.ambassador.com.tw/home/Showtime?ID=84b87b82-b936-4a39-b91f-e88328d33b4e');
  const amb = output.find(row => row.cinemaId === venue.id && row.title === '泥面人');
  if (!amb || amb.posterUrl !== jpg || !amb.posterSourceUrl.includes(mid)) throw new Error('Ambassador poster selftest failed');
  if (Object.keys(trustedPoster({url:'https://www.atmovies.com.tw/photo101/a/pl_b.jpg',source:'https://www.atmovies.com.tw/movie/a/'})).length) throw new Error('Poster mismatch must be rejected');
  const extraCinema={id:'miramar-dazhi',name:'美麗華大直'};
  const extraSource='https://www.atmovies.com.tw/showtime/t02d05/a02/'+today.replaceAll('-','')+'/';
  const extraFixture=['## 美麗華大直', '### '+formatDate+' (三)',
    '* [泥面人](/movie/'+filmId+'/)',
    '* * [![](/photo101/'+filmId+'/pl_'+filmId+'.jpg)](http://app2.atmovies.com.tw/poster/'+filmId+'/)',
    '* 19：30'].join('\n');
  parseAtmovies(extraFixture,extraCinema,today,extraSource);
  const miramar=output.find(row=>row.cinemaId==='miramar-dazhi');
  if(!miramar || miramar.sourceUrl !== extraSource || !miramar.posterUrl) throw Error('Expanded cinema parser selftest failed');
  try {
    parseAtmovies(extraFixture,{id:'showtime-shulin'},today,extraSource);
    throw new Error('Must reject cross-cinema identity');
  } catch(error) {
    if (!/identity does not match/.test(error.message)) throw error;
  }
  const directory=readAdditionalDirectory();
  if(directory.length!==26) throw Error('26-theater directory selftest failed');
  // Municipal cinema pages list sessions in an HTML table with status and
  // multiple film-program rows. Only use the dated table, not unrelated links.
  const fuzhongFixture='<h1>府中15</h1><h2>'+today.slice(0,4)+'年'+Number(today.slice(5,7))+
    '月放映場次表</h2><table><tr><th>日期</th><th>時間</th><th>片名</th></tr><tr>'+
    '<td>'+Number(today.slice(5,7))+'/'+Number(today.slice(8))+'(三)</td>'+
    '<td>19:00</td><td><a href="/fuzhong15_chi/xcmovie/cont?sid=123">不丹是幸福</a> 售</td></tr></table>';
  parseFuzhong(fuzhongFixture,{id:'fuzhong15'},'https://www.culture.ntpc.gov.tw/fuzhong15_chi/xcmovie?XsmSId=0M361641875264878260');
  if(!output.some(row=>row.cinemaId==='fuzhong15' && row.title==='不丹是幸福'))
    throw Error('Official Fuzhong parser selftest failed');
  console.log('Parser and source-matched poster selftests passed');
}

if (process.argv.includes('--self-test')) selftest();
else run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
