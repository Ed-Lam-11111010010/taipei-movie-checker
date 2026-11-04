'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, ResourceLoader, VirtualConsole} = require('jsdom');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
const pageNames = ['index.html', 'showtimes.html', 'cinemas.html', 'map.html'];
const permittedFiles = new Set([...pageNames, 'app.css', 'movie-pages.css',
  'demo-catalog.js', 'theater-directory.js', 'app-core.js', 'movie-pages.js']);
const base = 'https://movie-checker.test/';
const clock = Number.isFinite(Date.parse(catalog.checkedAt)) ?
  Date.parse(catalog.checkedAt) : Date.parse(catalog.screenings[0].startsAt);

class OnlyLocalAssets extends ResourceLoader {
  fetch(uri) {
    const url = new URL(uri);
    if (url.origin !== new URL(base).origin || !permittedFiles.has(url.pathname.slice(1))) return null;
    return Promise.resolve(fs.readFileSync(path.join(root, url.pathname.slice(1))));
  }
}
function waitFor(predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const until = Date.now() + timeoutMs;
    const check = () => {
      if (predicate()) resolve();
      else if (Date.now() > until) reject(new Error('Timed out waiting for catalog/UI'));
      else setTimeout(check, 40);
    };
    check();
  });
}
async function loadPage(name) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', e => errors.push(e?.message || String(e)));
  const OriginalDate = Date;
  const html = fs.readFileSync(path.join(root, name.split('?')[0]), 'utf8');
  const dom = new JSDOM(html, {
    url: base + name, resources: new OnlyLocalAssets(), runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: console,
    beforeParse(win) {
      // Same deterministic moment for all four pages, regardless of CI calendar.
      win.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [clock])); }
        static now() { return clock; }
      };
      win.fetch = async resource => {
        assert.equal(resource, './catalog.json');
        return {ok: true, json: async () => catalog};
      };
      win.HTMLElement.prototype.scrollIntoView = function() {};
      if (typeof win.AbortSignal.timeout !== 'function') win.AbortSignal.timeout = () => undefined;
    }
  });
  const win = dom.window;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Load timed out: ' + name)), 10000);
    win.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, {once:true});
  });
  await waitFor(() => win.document.getElementById('sync-time')?.textContent.includes('已重新載入'));
  if (errors.length) throw new Error(name + ': ' + errors.join('\n'));
  assert.equal(win.document.querySelectorAll('.site-nav a[aria-current="page"]').length, 1, 'one active nav');
  assert.equal(win.document.querySelectorAll('.demo-label').length, 1);
  assert.equal(win.document.querySelectorAll('#toggle-demo-preview').length,0,'no public demo switch');
  assert.ok(!win.document.querySelector('.demo-banner').textContent.includes('虛構'),'public banner should describe source data');
  const sourceDetail=win.document.getElementById('source-details');
  assert.ok(sourceDetail && sourceDetail.contains(win.document.getElementById('source-health')),'read-only sync logs accessible');
  assert.equal(sourceDetail.open,false,'source logs collapsed by default');
  const importer=win.document.querySelector('.advanced-import');
  assert.ok(importer,'internal CSV import structure can remain for future work');
  assert.equal(win.getComputedStyle(importer).display,'none','no visible demo or test importer');

  assert.equal(win.document.querySelectorAll('[id]').length,
    new Set([...win.document.querySelectorAll('[id]')].map(el => el.id)).size, 'unique IDs');
  return dom;
}
async function test() {
  assert.ok(catalog.cinemas.length >= 12 && catalog.cinemas.length <= 38, 'synced cinema count');
  assert.ok(catalog.screenings.length > 100);
  const movies = await loadPage('index.html');
  try {
    const {document, Event} = movies.window;
    const films=document.querySelectorAll('#film-grid .film-tile');
    assert.ok(films.length > 10, 'movies should list source-backed titles');
    const title = films[0].querySelector('.film-tile-title').textContent.trim();
    const yonghe=movies.window.MOVIE_CHECKER_ADDITIONAL_THEATERS.find(c=>c.id==='centuryasia-yonghe');
    assert.ok(yonghe,'Yonghe theater is in directory');
    const ticket=movies.window.movieBookingFor({cinemaId:yonghe.id,isDemo:false},yonghe);
    assert.equal(ticket.url,'https://www.ezding.com.tw/cinemabooking?campaign_code=atmovie_cinemapage&channel=atmovie&cinemaid=c072c5c43fc011e9a245782bcb259cad','Yonghe uses the theater-specific ez訂 booking URL');
    assert.match(ticket.label,/網路訂票/);
    const unknown=movies.window.movieBookingFor({cinemaId:'no-verified-portal',isDemo:false},
      {id:'no-verified-portal',showtimesUrl:'https://www.atmovies.com.tw/showtime/t02a13/a02/'});
    assert.equal(unknown.infoOnly,true,'unverified cinema must not claim a working booking portal');
    assert.match(unknown.label,/購票資訊/);
    assert.equal(movies.window.movieBookingFor({cinemaId:yonghe.id,isDemo:true},yonghe),null,
      'test data must never expose booking buttons');
    assert.ok(document.querySelector('#movie-explorer'));
    const route = '#movie=' + encodeURIComponent(title);
    movies.window.location.hash = route;
    await waitFor(() => !document.getElementById('film-detail').classList.contains('hidden'));
    assert.ok(document.querySelector('#film-detail .film-date-tabs'));
    assert.ok(document.querySelector('#film-detail .film-ticket'));
    assert.ok(document.getElementById('page-data-summary').textContent.includes('筆'), 'movie page shows data freshness');
    assert.equal(document.body.dataset.page,'movies');
    console.log('PASS Movies:',films.length,'film tiles; shareable route',route);
  } finally { movies.window.close(); }

  const showtimes=await loadPage('showtimes.html');
  try {
    const {document, Event}=showtimes.window;
    assert.equal(document.body.dataset.page,'showtimes');
    const dates=[...new Set(catalog.screenings.filter(row=>new Date(row.startsAt).getTime()>clock).map(r=>r.date))].sort();
    assert.ok(dates.length);
    const picker=document.getElementById('date-picker');
    picker.value=dates[0];picker.dispatchEvent(new Event('change',{bubbles:true}));
    assert.ok(document.querySelectorAll('#screening-view .screening-card').length>0,'showtime cards');
    assert.ok(document.querySelector('#screening-view .screening-card a[href*="index.html#movie="]'),'links to movie details');
    assert.ok(document.querySelector('#screening-view a.action-link'),'official ticket links');
    assert.ok(document.querySelector('.advanced-import'),'personal import remains available');
    console.log('PASS Showtimes:',dates[0],document.querySelectorAll('#screening-view .screening-card').length,'session cards');
  } finally { showtimes.window.close(); }

  // A municipal timetable may contain linked film titles in its source cells.
  // Browser-facing movie labels must display the visible title only.
  const fuzhongRow=catalog.screenings.find(row=>row.cinemaId==='fuzhong15');
  if (fuzhongRow) {
    const official=await loadPage('showtimes.html?cinema=fuzhong15');
    try {
      const {document,Event}=official.window;
      const picker=document.getElementById('date-picker');
      picker.value=fuzhongRow.date; picker.dispatchEvent(new Event('change',{bubbles:true}));
      const card=document.querySelector('#screening-view .screening-card');
      assert.ok(card,'Official Fuzhong session shown');
      assert.ok(!card.textContent.includes('/fuzhong15_chi/'),'No Markdown hyperlinks in public film titles');
      console.log('PASS Official Fuzhong15: linked title renders as plain film name');
    } finally { official.window.close(); }
  }

  const cinemas=await loadPage('cinemas.html');
  try {
    const {document}=cinemas.window;
    assert.equal(document.body.dataset.page,'cinemas');
    assert.equal(document.querySelectorAll('#cinema-view .venue-card').length,38);
    assert.equal(document.querySelectorAll('#cinema-view .venue-card[data-coverage="directory"]').length,38-catalog.cinemas.length);
    assert.equal(document.querySelectorAll('#cinema-view .venue-card[data-coverage="synced"]').length,catalog.cinemas.length);
    assert.equal(document.querySelectorAll('#cinema-view .venue-card .venue-coverage').length,38);
    assert.ok(document.querySelector('#cinema-view a[href*="showtimes.html?cinema="]'),'cinema-to-showtime route');
    assert.ok(document.querySelector('#live-showtimes .cinema-source-group'),'external source directory');
    console.log('PASS Cinemas: 25 Taipei City + 13 New Taipei entries; '+catalog.cinemas.length+' synchronized and '+(38-catalog.cinemas.length)+' directory-only');
  } finally { cinemas.window.close(); }

  // The source sync may promote any subset of the 26 theaters after validation.
  // Test unsynced behavior using a cinema the latest catalog has NOT promoted.
  const directoryCode=fs.readFileSync(path.join(root,'theater-directory.js'),'utf8');
  const directoryMatch=/window\.MOVIE_CHECKER_ADDITIONAL_THEATERS\s*=\s*(\[[\s\S]*?\]);\s*$/.exec(directoryCode);
  assert.ok(directoryMatch,'valid directory JSON');
  const directory=JSON.parse(directoryMatch[1]);
  assert.equal(directory.length,26);
  const syncedIds=new Set(catalog.cinemas.map(c=>c.id));
  const candidate=directory.find(c=>!syncedIds.has(c.id));
  if (candidate) {
    const unconnected=await loadPage('showtimes.html?cinema='+encodeURIComponent(candidate.id));
    try {
      const {document}=unconnected.window;
      assert.equal(document.getElementById('cinema').value,candidate.id);
      assert.equal(document.querySelectorAll('#screening-view .screening-card').length,0);
      assert.ok(document.getElementById('empty-state').textContent.includes('尚未串接'));
      assert.ok(document.querySelector('#empty-state a[href^="https://"]'));
      console.log('PASS Unconnected cinema:',candidate.id,'has no invented showtimes or booking links');
    } finally { unconnected.window.close(); }
  }

  const map=await loadPage('map.html');
  try {
    const {document}=map.window;
    assert.equal(document.body.dataset.page,'map');
    assert.ok(!document.getElementById('map-layout').classList.contains('hidden'),'map view shown');
    assert.equal(document.querySelectorAll('#map-place-list .map-place').length,38);
    assert.ok(document.getElementById('map-cinema-status').textContent.includes('已接入'));
    assert.ok(document.getElementById('map-showtimes').href.includes('showtimes.html?cinema='));
    if(candidate){
      const unsyncedButton=document.querySelector('#map-place-list [data-cinema-id="'+candidate.id+'"]');
      assert.ok(unsyncedButton,'unconnected cinema on map');
      unsyncedButton.click();
      assert.ok(document.getElementById('map-cinema-status').textContent.includes('尚未接入'));
      assert.ok(document.getElementById('map-showtimes').href.startsWith('https://'));
    }
    const promoted=directory.find(c=>syncedIds.has(c.id));
    if(promoted){
      const connectedButton=document.querySelector('#map-place-list [data-cinema-id="'+promoted.id+'"]');
      assert.ok(connectedButton,'promoted cinema on map');
      connectedButton.click();
      assert.ok(document.getElementById('map-showtimes').href.includes('showtimes.html?cinema='));
    }
        console.log('PASS Map: 38 map destinations with coverage labels and showtime links');
  } finally { map.window.close(); }
}
test().catch(err => {console.error(err.stack || err);process.exitCode = 1;});
