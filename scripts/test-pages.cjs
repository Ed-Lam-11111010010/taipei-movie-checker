'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, ResourceLoader, VirtualConsole} = require('jsdom');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
const appCss = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
const movieCss = fs.readFileSync(path.join(root, 'movie-pages.css'), 'utf8');
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
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
        if (typeof resource === 'string' && resource.startsWith('https://geocode.arcgis.com/')) {
          const address = new URL(resource).searchParams.get('SingleLine') || '';
          const location = address.includes('松壽路20號') ? {x:121.56725, y:25.03558}
            : address.includes('松仁路58號') ? {x:121.5688, y:25.0369}
            : {x:121.52, y:25.12};
          return {ok:true, json:async () => ({candidates:[{score:96,location}]})};
        }
        assert.equal(resource, './catalog.json');
        return {ok: true, json: async () => catalog};
      };
      Object.defineProperty(win.navigator, 'geolocation', {configurable:true, value:{
        getCurrentPosition(success) {
          success({coords:{latitude:25.03558,longitude:121.56725,accuracy:50}});
        }
      }});
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
  assert.equal(win.document.querySelectorAll('.site-nav a').length, 4, 'all four page links remain available');
  for (const link of win.document.querySelectorAll('.site-nav a')) {
    link.focus();
    assert.equal(win.document.activeElement, link, 'navigation link can receive keyboard focus');
  }
  assert.equal(win.document.querySelectorAll('.demo-label').length, 1);
  assert.equal(win.document.querySelectorAll('#toggle-demo-preview').length,0,'no public demo switch');
  assert.ok(!win.document.querySelector('.demo-banner').textContent.includes('虛構'),'public banner should describe source data');
  const sourceDetail=win.document.getElementById('source-details');
  assert.ok(sourceDetail && sourceDetail.contains(win.document.getElementById('source-health')),'read-only sync logs accessible');
  assert.equal(sourceDetail.open,false,'source logs collapsed by default');
  const importer=win.document.querySelector('.advanced-import');
  assert.ok(importer,'internal CSV import structure can remain for future work');
  assert.equal(win.getComputedStyle(importer).display,'none','no visible demo or test importer');

  const coverageLabel=win.document.querySelector('.film-explorer-kicker');
  assert.equal(coverageLabel.textContent.trim(),'場次資料收錄 '+catalog.cinemas.length+' 間影城',
    'cinema coverage count is derived from the loaded catalog');
  const sourceSection=win.document.getElementById('live-showtimes');
  assert.ok(sourceSection,'historical source links remain available');
  assert.match(sourceSection.textContent,/最早接入同步的 12 間影城來源連結/,
    '12 is identified only as the historical source-link group');
  const nonHistoricalMarkup=html.replace(/<section\b[^>]*id="live-showtimes"[^>]*>[\s\S]*?<\/section>/i,'');
  assert.doesNotMatch(nonHistoricalMarkup,/(?:12|38)\s*間影城/,
    'static UI copy has no hardcoded current cinema count outside the historical source section');
  assert.doesNotMatch(win.document.querySelector('.hero').textContent,/個人非商業\s*POC/i,
    'hero copy uses visitor-facing wording');
  assert.match(win.document.querySelector('.demo-banner').textContent,/時間與票價可能變更/,
    'the concise source-data disclaimer remains visible');
  const extraDateField=win.document.getElementById('extra-date-field');
  assert.ok(extraDateField && extraDateField.querySelector('#date-picker'),
    'shared date-picker remains in the DOM on every page');
  if (name.startsWith('cinemas.html') || name.startsWith('map.html')) {
    assert.equal(win.getComputedStyle(extraDateField).display,'none',
      'directory pages hide a date control that does not filter their listing');
    const directoryDisclosure=win.document.getElementById('directory-filter-disclosure');
    assert.ok(directoryDisclosure && directoryDisclosure.open,
      'secondary directory filters are accessible and expanded by default on desktop');
    assert.ok(!win.document.getElementById('query').closest('#directory-filter-disclosure'),
      'primary cinema search remains outside the secondary-filter disclosure');
  } else if (name.startsWith('showtimes.html')) {
    assert.notEqual(win.getComputedStyle(extraDateField).display,'none',
      'Showtimes keeps its later-date picker visible');
    assert.equal(win.document.getElementById('directory-filter-disclosure'),null);
  }

  assert.equal(win.document.querySelectorAll('[id]').length,
    new Set([...win.document.querySelectorAll('[id]')].map(el => el.id)).size, 'unique IDs');
  return dom;
}
async function test() {
  const muted = /--muted:\s*(#[0-9a-f]{6})/i.exec(appCss)?.[1];
  const paper = /--paper:\s*(#[0-9a-f]{6})/i.exec(appCss)?.[1];
  const card = /--card:\s*(#[0-9a-f]{6})/i.exec(appCss)?.[1];
  assert.ok(muted && paper && card, 'readable theme color tokens exist');
  assert.ok(contrastRatio(muted, paper) >= 4.5, 'muted copy meets WCAG AA on paper');
  assert.ok(contrastRatio(muted, card) >= 4.5, 'muted copy meets WCAG AA on cards');
  assert.match(appCss, /\.top-links\s*\{[^}]*flex:\s*1 0 100%/,
    'mobile navigation moves below the brand instead of shrinking beside it');
  assert.match(appCss, /\.site-nav a\s*\{[^}]*min-height:\s*44px/,
    'mobile navigation keeps comfortable touch targets');
  assert.doesNotMatch(appCss, /\.top-links a:first-child\s*\{\s*display:\s*none/,
    'mobile does not hide the first page link');
  assert.match(appCss, /\.filter-controls\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/,
    'narrow-phone filters use a non-overflowing single column');
  assert.match(appCss, /\.page-showtimes \.date-jump\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/,
    'narrow-phone date picker stacks inside the page width');
  assert.match(appCss, /\.page-cinemas #extra-date-field[^{}]*\{[^}]*display:none!important/,
    'cinema directory date control is hidden without removing the shared input');
  assert.match(appCss, /\.page-map #extra-date-field[^{}]*\{[^}]*display:none!important/,
    'map directory date control is hidden without removing the shared input');
  assert.match(appCss, /\.page-map \.layout\s*\{[^}]*flex-direction:column-reverse/,
    'the mobile map view precedes secondary search filters');
  assert.match(appCss, /\.directory-filter-disclosure>summary[^{}]*\{[^}]*min-height:44px/,
    'secondary directory filters have an accessible disclosure target');
  assert.match(movieCss, /\.page-movies \.movie-explorer\s*\{[^}]*margin:10px 0 20px/,
    'mobile movie discovery starts closer to the hero');
  assert.match(appCss, /\.field input,\.field select,\.date-jump input,\.sort-control select,[\s\S]*?\.clear-button,\.refresh-button\s*\{\s*min-height:\s*44px/,
    'mobile filters, sorting, refresh and reset controls meet touch target guidance');
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
    const movieVenues=[...document.querySelectorAll('#film-detail .film-venue')];
    assert.ok(movieVenues.length,'movie details include cinema locations');
    for(const venue of movieVenues){
      const cinemaName=venue.querySelector('.film-venue-head h4').textContent.trim();
      const knownCinema=catalog.cinemas.find(c=>c.name===cinemaName);
      assert.ok(knownCinema,'movie detail venue maps to an actual cinema');
      const locationLinks=venue.querySelectorAll('a.film-location');
      assert.equal(locationLinks.length,1,'one cinema location link per venue, regardless of showtime count');
      const nameRow=venue.querySelector('.film-venue-head .film-venue-main .film-venue-name-row');
      assert.ok(nameRow,'cinema title and map link use one shared row');
      assert.equal(movies.window.getComputedStyle(nameRow).display,'flex','cinema title row is inline flex layout');
      assert.equal(nameRow.children.length,2,'title row holds exactly the cinema name and location link');
      assert.equal(nameRow.children[0].tagName,'H4','cinema title is leftmost');
      const mapAction=nameRow.querySelector('a.film-location');
      assert.equal(nameRow.children[1],mapAction,'location link is rightmost beside cinema title');
      assert.equal(locationLinks[0],mapAction,'the only venue link is in the title row');
      assert.equal(movies.window.getComputedStyle(mapAction).minHeight,'44px','map action remains touch-friendly');
      assert.ok(venue.querySelector('.film-venue-main > p'),'district and showtime count remain below the title row');
      assert.match(mapAction.textContent,/查看影城位置/,'cinema-level action identifies map');
      const mapUrl=new URL(mapAction.href);
      assert.equal(mapUrl.origin,'https://www.google.com','location points to Google Maps');
      assert.equal(mapUrl.pathname,'/maps/search/','Google Maps search link is used');
      assert.equal(mapUrl.searchParams.get('api'),'1');
      assert.equal(mapUrl.searchParams.get('query'),cinemaName+' '+knownCinema.address,
        'Google Maps link searches the correct cinema name and street address');
      assert.equal(mapAction.target,'_blank');
      assert.ok(mapAction.rel.includes('noopener'),'location link opens safely');
      for(const session of venue.querySelectorAll('.film-session')){
        const actions=session.querySelector('.film-session-actions');
        assert.equal(actions.querySelectorAll('.film-location').length,0,'no repeated map link in individual showtimes');
        assert.ok(actions.querySelector('.film-ticket'),'existing booking link is preserved');
        const source=actions.querySelector('.film-source-reference');
        assert.ok(source,'validated showtime sources remain accessible');
        assert.equal(new URL(source.href).protocol,'https:');
      }
    }
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
    assert.ok(document.querySelector('.showtimes-date-toolbar #date-picker'), 'date picker is next to seven-day shortcuts');
    assert.equal(document.querySelectorAll('.showtimes-date-toolbar .date-button').length, 7, 'seven date shortcuts');
    assert.equal(document.querySelectorAll('.showtimes-date-toolbar .date-button small').length, 7, 'daily availability labels');
    assert.equal(document.querySelector('#sort-note').tagName, 'DETAILS', 'technical version explanation starts as a disclosure');
    assert.ok(!document.querySelector('#sort-note').open, 'version explanation collapsed initially');
    const filterPanel=document.getElementById('filter-disclosure');
    assert.ok(filterPanel && filterPanel.open, 'desktop filters usable');
    assert.ok(document.getElementById('filter-active-summary'), 'filter selection summary shown');
    const picker=document.getElementById('date-picker');
    picker.value=dates[0];picker.dispatchEvent(new Event('change',{bubbles:true}));
    assert.ok(document.querySelectorAll('#screening-view .screening-card').length>0,'showtime cards');
    assert.ok(document.querySelector('#screening-view .screening-card a[href*="index.html#movie="]'),'links to movie details');
    assert.ok(document.querySelector('#screening-view a.action-link'),'official ticket links');
    assert.ok(document.querySelector('.advanced-import'),'personal import remains available');
    const query=document.getElementById('query');
    query.value='__no_matching_movie_or_cinema__';
    query.dispatchEvent(new Event('input',{bubbles:true}));
    assert.equal(document.querySelectorAll('#screening-view .screening-card').length,0,
      'showtime filters can reach an empty result');
    assert.ok(!document.getElementById('empty-state').classList.contains('hidden'),
      'empty showtime results have a visible explanation');
    query.value='';query.dispatchEvent(new Event('input',{bubbles:true}));
    assert.ok(document.querySelectorAll('#screening-view .screening-card').length>0,
      'clearing the query restores showtimes');

    // A browser tab left open must pick up new scheduled snapshots without
    // disturbing its selected date, input state, or showing synthetic records.
    const selectedDateBeforeAuto=picker.value;
    let autoFetchCalls=0;
    let remoteCatalog=catalog;
    showtimes.window.fetch=async resource=>{
      assert.equal(resource,'./catalog.json');
      autoFetchCalls++;
      return {ok:true,json:async()=>remoteCatalog};
    };
    showtimes.window.Date.now=()=>clock+10*60000;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(autoFetchCalls,0,'no needless refresh before 15-minute interval');
    showtimes.window.Date.now=()=>clock+16*60000;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(()=>autoFetchCalls===1);
    await waitFor(()=>!document.getElementById('refresh-catalog').disabled);
    assert.equal(picker.value,selectedDateBeforeAuto,'unchanged background refresh keeps selected date');
    assert.equal(query.value,'','unchanged background refresh keeps search state');
    assert.ok(!document.getElementById('sync-time').textContent.includes('更新中'),
      'background refresh does not flash manual loading state');
    remoteCatalog={...catalog,checkedAt:new Date(clock+32*60000).toISOString()};
    showtimes.window.Date.now=()=>clock+32*60000;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(()=>autoFetchCalls===2);
    await waitFor(()=>document.getElementById('sync-time').textContent.includes('已自動更新已發布場次'));
    assert.equal(picker.value,selectedDateBeforeAuto,'new background snapshot keeps selected date');
    assert.equal(query.value,'','new background snapshot keeps current filters');
    assert.equal(document.getElementById('refresh-catalog').disabled,false,'refresh button becomes available');
    console.log('PASS Showtimes:',dates[0],document.querySelectorAll('#screening-view .screening-card').length,'session cards');
  } finally { showtimes.window.close(); }

  // A municipal timetable may contain linked film titles in its source cells.
  // Browser-facing movie labels must display the visible title only.
  const fuzhongRow=catalog.screenings.find(row=>row.cinemaId==='fuzhong15' && Date.parse(row.startsAt)>clock);
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
    assert.equal(cinemas.window.getComputedStyle(document.querySelector('.format-field')).display,'none','irrelevant cinema format filter hidden');
    assert.equal(document.querySelector('#query').placeholder,'影城名稱、行政區或地址');
    assert.equal(document.querySelectorAll('#cinema-view .venue-card').length,38);
    assert.equal(document.querySelectorAll('#cinema-view .venue-card[data-coverage="directory"]').length,38-catalog.cinemas.length);
    assert.equal(document.querySelectorAll('#cinema-view .venue-card[data-coverage="synced"]').length,catalog.cinemas.length);
    assert.equal(document.querySelectorAll('#cinema-view .venue-card .venue-coverage').length,38);
    assert.ok(document.querySelector('#cinema-view a[href*="showtimes.html?cinema="]'),'cinema-to-showtime route');
    assert.ok(document.querySelector('#live-showtimes .cinema-source-group'),'external source directory');
    const cinemaQuery=document.getElementById('query');
    cinemaQuery.value='台北';
    cinemaQuery.dispatchEvent(new cinemas.window.Event('input',{bubbles:true}));
    const searched=document.querySelectorAll('#cinema-view .venue-card').length;
    assert.ok(searched>0 && searched<38,'cinema search filters the directory');
    document.getElementById('clear').click();
    assert.equal(document.querySelectorAll('#cinema-view .venue-card').length,38,
      'reset restores all cinema directory cards');
    cinemaQuery.value='__no_matching_cinema__';
    cinemaQuery.dispatchEvent(new cinemas.window.Event('input',{bubbles:true}));
    assert.equal(document.querySelectorAll('#cinema-view .venue-card').length,0,
      'cinema directory search can reach an empty result');
    assert.match(document.querySelector('#cinema-view').textContent,/找不到符合條件的影城/,
      'empty cinema results have a visible explanation');
    document.getElementById('clear').click();
    assert.equal(document.querySelectorAll('#cinema-view .venue-card').length,38,
      'clear restores the directory after an empty search');
    const directoryDisclosure=document.getElementById('directory-filter-disclosure');
    directoryDisclosure.querySelector('summary').click();
    assert.equal(directoryDisclosure.open,false,'directory secondary filters collapse on request');
    directoryDisclosure.querySelector('summary').click();
    assert.equal(directoryDisclosure.open,true,'directory secondary filters can be reopened');
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
    assert.equal(map.window.getComputedStyle(document.querySelector('.format-field')).display,'none','irrelevant map format filter hidden');
    assert.equal(document.querySelector('#query').placeholder,'影城名稱、行政區或地址');
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
    const nearButton=document.getElementById('find-nearest-cinema');
    assert.ok(nearButton && !nearButton.disabled,'nearby action is available without prompting on page load');
    assert.ok(!document.getElementById('nearest-external-map').hasAttribute('href'),'visitor location is not exposed before consent');
    nearButton.click();
    await waitFor(() => document.getElementById('nearest-cinema-status').textContent.includes('已依位置排序'));
    const first=document.querySelector('#map-place-list .map-place');
    assert.equal(first.dataset.cinemaId,'vieshow-xinyi','nearest cinema uses actual coordinates, not alphabetic order');
    assert.match(first.textContent,/約 0.0 公里（直線）/,'nearby cinema shows straight-line distance');
    assert.equal(document.getElementById('map-selected-name').textContent,'台北信義威秀影城','nearest cinema becomes selected map destination');
    assert.ok(document.getElementById('nearest-external-map').href.includes('/@25.03558,121.56725,14z'),'external map is opt-in and centered near visitor');
    document.getElementById('clear-nearest-cinema').click();
    assert.ok(!document.getElementById('map-place-list').textContent.includes('公里（直線）'),'clear disables distance sorting');
    assert.ok(!document.getElementById('nearest-external-map').hasAttribute('href'),'reset clears the location link');
    Object.defineProperty(map.window.navigator,'geolocation',{configurable:true,value:{
      getCurrentPosition(success,error){ error({code:1}); }
    }});
    nearButton.click();
    assert.match(document.getElementById('nearest-cinema-status').textContent,/已拒絕定位授權/,'permission denied has usable fallback');
    assert.equal(document.querySelectorAll('#map-place-list .map-place').length,38,'permission denial retains full cinema directory');
        console.log('PASS Map: 38 map destinations with coverage labels and showtime links');
  } finally { map.window.close(); }
}
test().catch(err => {console.error(err.stack || err);process.exitCode = 1;});
