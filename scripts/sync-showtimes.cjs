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
function textMd(html) { return converter.turndown(html).replace(/\r/g, ''); }
function record(cinema, businessDate, title, format, time, sourceUrl, poster = null) {
  title = String(title || '').replace(/\s+/g, ' ').trim();
  format = String(format || '數位').replace(/\s+/g, ' ').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || businessDate < today ||
      businessDate > maximumDate || title.length < 2 || title.length > 120 ||
      format.length > 50 || !validTime.test(time)) return;
  if (!/^https:\/\//.test(sourceUrl) || !['www.vscinemas.com.tw','www.ambassador.com.tw','www.atmovies.com.tw'].includes(new URL(sourceUrl).hostname)) return;
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
  const expected = atmoviesFallback[cinema.id];
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
async function get(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 22000);
  try {
    const response = await fetch(url, { signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MovieCheckerPersonalPOC/1.0; +https://github.com/Ed-Lam-11111010010/taipei-movie-checker)', 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    if (html.length < 1000 || html.length > 8000000) throw new Error('Unexpected HTML length ' + html.length);
    return textMd(html);
  } finally { clearTimeout(timer); }
}
async function run() {
  const previous = JSON.parse(fs.readFileSync('catalog.json','utf8'));
  if (!Array.isArray(previous.cinemas) || previous.cinemas.length !== 12) throw new Error('Cinema catalog mismatch');
  const sources = [];
  for (const cinema of previous.cinemas) {
    let error = null, dates = [], before = output.length;
    const urls = [];
    if (cinema.id.startsWith('vieshow-')) {
      urls.push([today, cinema.officialUrl, 'vieshow']);
      for (let d = 0; d < 3; d++) {
        const day = addDays(today, d);
        urls.push([day, 'https://www.atmovies.com.tw/showtime/' + atmoviesFallback[cinema.id][0] + '/a02/' + day.replaceAll('-', '') + '/', 'atmovies']);
      }
    }
    else if (cinema.id.startsWith('ambassador-')) for (let d=0;d<3;d++) {
      const day = addDays(today,d);
      urls.push([day, cinema.showtimesUrl + '&DT=' + day.replaceAll('-', '%2F'), 'ambassador']);
    } else if (cinema.id === 'showtime-xinxin') for (let d=0;d<3;d++) {
      const day = addDays(today,d);
      urls.push([day, 'https://www.atmovies.com.tw/showtime/t02d03/a02/' + day.replaceAll('-', '') + '/', 'atmovies']);
    }
    let officialSucceeded = false;
    for (const [day,url,kind] of urls) {
      if (kind === 'atmovies' && officialSucceeded) continue;
      try {
        const markdown = await get(url);
        if (kind === 'vieshow') { parseVieshow(markdown, cinema); officialSucceeded = true; }
        if (kind === 'ambassador') parseAmbassador(markdown, cinema, day, url);
        if (kind === 'atmovies') parseAtmovies(markdown, cinema, day, url);
      } catch (e) { error = (e instanceof Error ? e.message : String(e)).slice(0, 150); console.warn(cinema.id, day, error); }
    }
    const rows = output.slice(before);
    dates = [...new Set(rows.map(r=>r.sourceBusinessDate))].sort();
    const success = rows.length > 0;
    const usedFallback = success && cinema.id.startsWith('vieshow-') && !officialSucceeded;
    sources.push({ cinemaId: cinema.id, sourceUrl: success ? rows[0].sourceUrl : cinema.showtimesUrl,
      state: success ? (error ? 'partial' : 'ok') : 'error',
      lastAttemptAt: checkedAt, lastSuccessAt: success ? checkedAt : null,
      coverage: dates,
      message: success ? rows.length + ' 個可解析場次／' + dates.length + ' 個日期' +
        (usedFallback ? '；威秀官方來源拒絕自動請求，改用開眼影城頁' : '') +
        (error && !usedFallback ? '；其他頁面讀取失敗' : '') :
        '無法安全解析場次；請前往來源網頁確認' });
    console.log(cinema.id + ': ' + rows.length + ' screenings, days=' + dates.length);
  }
  if (output.length < 5) throw new Error('No safe publish: too few valid real screenings (' + output.length + ')');
  if (output.length > 15000) throw new Error('Too many screenings: ' + output.length);
  output.sort((a,b) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title));
  const catalog = { schemaVersion: 1, mode: 'source-snapshot', checkedAt,
    refreshIntervalMinutes: 360, cinemas: previous.cinemas, screenings: output,
    sources, adapterVersion: 'github-actions-source-parser-v2-posters' };
  fs.writeFileSync('catalog.json', JSON.stringify(catalog) + '\n');
  console.log('Published snapshot: ' + output.length + ' entries, ' + sources.filter(s => s.lastSuccessAt).length + '/12 venues, ' + checkedAt);
}
function selftest() {
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
  console.log('Parser and source-matched poster selftests passed');
}

if (process.argv.includes('--self-test')) selftest();
else run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
