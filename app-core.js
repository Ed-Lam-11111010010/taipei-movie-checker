
    const hostedSnapshot = document.querySelector('meta[name="movie-checker-hosting"]')?.content === 'snapshot' || location.hostname.toLowerCase() === 'ed-lam-11111010010.github.io';
    const baseDemoCatalog = window.MOVIE_CHECKER_DEMO_CATALOG;
    let mostRecentDemoCatalog = baseDemoCatalog;
    // Keep the synthetic POC usable after the original 14-day date window expires.
    // Never convert imported or real source records into synthetic screenings.
    function rollingDemoCatalog(snapshot, today = taipeiDateKey()) {
      if (snapshot.mode !== 'personal-local' || !Array.isArray(snapshot.screenings) ||
          !snapshot.screenings.length || !snapshot.screenings.every(item => item.isDemo === true)) return snapshot;
      const firstDate = snapshot.screenings.reduce((first, item) => item.date < first ? item.date : first, snapshot.screenings[0].date);
      const offset = (Date.parse(today + 'T00:00:00Z') - Date.parse(firstDate + 'T00:00:00Z')) / 86400000;
      if (!Number.isInteger(offset)) return snapshot;
      return { ...snapshot, screenings: snapshot.screenings.map(item => {
        const date = addDateKeyDays(item.date, offset);
        return { ...item, id: item.id.replace(/^demo-\d{4}-\d{2}-\d{2}/, 'demo-' + date),
          date, sourceBusinessDate: date, startsAt: date + 'T' + item.time + ':00+08:00' };
      }) };
    }
    let catalogue = hostedSnapshot ? {...baseDemoCatalog, mode:'loading', screenings:[], sources:[], checkedAt:null} : rollingDemoCatalog(baseDemoCatalog);
    const publicDemoCatalog = baseDemoCatalog;
    let latestPublicCatalog = catalogue;
    let demoPreviewActive = false;
    const sourceMode = () => !personalImportActive && catalogue.mode === 'source-snapshot';
    let personalImportActive = false;
    const originalDemoBanner = document.querySelector('.demo-banner div').innerHTML;
    const originalDemoDescription = document.querySelector('.demo-section-title p').textContent;
    const originalFooterDescription = document.querySelector('footer p:last-child').textContent;
    const additionalTheaters=Array.isArray(window.MOVIE_CHECKER_ADDITIONAL_THEATERS)?window.MOVIE_CHECKER_ADDITIONAL_THEATERS.filter(x=>x?.directoryOnly===true):[];
    function hydrateCinemas(rows) {
      const connected=rows.map(c=>({...c,ticketPortalUrl:c.ticketPortalUrl || additionalTheaters.find(t=>t.id===c.id)?.ticketPortalUrl,official:c.officialUrl,schedules:c.showtimesUrl,directoryOnly:false}));
      const known=new Set(connected.map(c=>c.id));
      return [...connected,...additionalTheaters.filter(c=>!known.has(c.id)).map(c=>({...c,official:c.officialUrl,schedules:c.showtimesUrl}))];
    }
    let cinemas=hydrateCinemas(catalogue.cinemas);
    // Present the plain title from linked government timetable cells, while
    // retaining original source dates, movie IDs and official booking links.
    function sanitizePublishedScreenings(records) {
      return records.map(row => {
        if (row.cinemaId !== 'fuzhong15' || typeof row.title !== 'string') return row;
        const clean = row.title.replace(/\[([^\]]{1,120})\]\([^)]+\)/g, '$1').trim();
        return clean === row.title ? row : {...row, title:clean};
      });
    }
    let showings = sanitizePublishedScreenings(catalogue.screenings);
    let formats = [...new Set(showings.map(s => normalizeMovieFormat(s.format)))].sort();
    let selectedMovieKeys = [];
    function esc(value) { return String(value).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    function posterHtml(item) {
      const fallback = `<span class="poster-fallback" aria-hidden="true"><small>FILM POSTER</small><b>${esc(item.title)}</b><small>暫無海報</small></span>`;
      let url;
      try {
        const candidate = new URL(item.posterUrl);
        const paths = {'www.unicornpopcorn.com.tw':/^\/ForVsWeb\/upload\/film\//i,'www.vscinemas.com.tw':/^\/(?:vsweb\/)?upload\/film\//i,'www.ambassador.com.tw':/^\/assets\/img\/movies\//i,'www.atmovies.com.tw':/^\/photo101\/[a-z0-9]+\/pl_[a-z0-9]+\.jpg$/i};
        if (candidate.protocol === 'https:' && !candidate.username && !candidate.password && !candidate.port && paths[candidate.hostname]?.test(candidate.pathname) && /\.(?:jpe?g|png|webp)$/i.test(candidate.pathname)) url = candidate.href;
      } catch {}
      return url ? `<a class="poster poster-photo" href="${esc(item.posterSourceUrl || item.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(item.title)}：查看來源電影介紹與海報">${fallback}<img src="${esc(url)}" alt="${esc(item.title)}電影海報" width="104" height="156" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>` : `<div class="poster" aria-hidden="true">${fallback}</div>`;
    }
    function taipeiDateKey(now = new Date()) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(now);
      const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
      return values.year + '-' + values.month + '-' + values.day;
    }
    function addDateKeyDays(key, days) {
      const [year, month, day] = key.split('-').map(Number);
      const shifted = new Date(Date.UTC(year, month - 1, day + days));
      return [
        String(shifted.getUTCFullYear()).padStart(4, '0'),
        String(shifted.getUTCMonth() + 1).padStart(2, '0'),
        String(shifted.getUTCDate()).padStart(2, '0')
      ].join('-');
    }
    const dateLabel = (key, options) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', ...options }).format(new Date(key + 'T12:00:00+08:00'));
    let taipeiTodayKey = taipeiDateKey();
    let selectedDate = taipeiTodayKey;
    const sitePage = ['movies','showtimes','cinemas','map'].includes(document.body.dataset.page) ? document.body.dataset.page : 'movies';
    let selectedView = sitePage === 'cinemas' ? 'cinemas' : sitePage === 'map' ? 'map' : 'screenings';
    let selectedMapCinema = cinemas[0].id;

    const $ = (selector) => document.querySelector(selector);
    const dateStrip = $('#date-strip');
    const cinemaSelect = $('#cinema');
    const initialCinemaQuery = sitePage === 'showtimes' ? new URLSearchParams(location.search).get('cinema') : null;
    const districtSelect = $('#district');
    const queryInput = $('#query');
    const formatSelect = $('#format');
    const sortSelect = $('#sort-order');

    function mapsSearch(cinema) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${cinema.name} ${cinema.address}`)}`;
    }
    function setMap(cinema) {
      if (!cinema) return;
      selectedMapCinema = cinema.id;
      $('#map-selected-name').textContent = cinema.name;
      $('#map-selected-address').textContent = cinema.address;
      const localSessions = document.getElementById('map-showtimes');
      if (localSessions) {
        localSessions.href=cinema.directoryOnly ? (cinema.schedules||cinema.official||mapsSearch(cinema)) : './showtimes.html?cinema='+encodeURIComponent(cinema.id);
        localSessions.textContent=cinema.directoryOnly?'場次尚未串接・前往來源網站 ↗':'查看這間影城場次 →';
        localSessions.target=cinema.directoryOnly?'_blank':'_self';
        localSessions.rel=cinema.directoryOnly?'noopener noreferrer':'';
      }
      const cinemaStatus=$('#map-cinema-status');
      if(cinemaStatus)cinemaStatus.textContent=cinema.directoryOnly?'僅收錄影城資料，尚未接入本站自動場次。':'已接入本站電影場次快照（非即時訂位）。';
      $('#map-launch').href = mapsSearch(cinema);
      const frame = $('#theatre-map');
      if (selectedView === 'map' && frame.dataset.cinemaId !== cinema.id) {
        frame.title = `Google Maps：${cinema.name}`;
        frame.src = 'https://maps.google.com/maps?' + new URLSearchParams({q: `${cinema.name} ${cinema.address}`, hl: 'zh-TW', z: '16', output: 'embed'});
        frame.dataset.cinemaId = cinema.id;
      }
      document.querySelectorAll('.map-place').forEach((button) => button.setAttribute('aria-current', String(button.dataset.cinemaId === cinema.id)));
    }
    function buildDates() {
      dateStrip.innerHTML = '';
      for (let offset = 0; offset < 7; offset += 1) {
        const key = addDateKeyDays(taipeiTodayKey, offset);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'date-button';
        button.dataset.date = key;
        button.setAttribute('aria-pressed', String(key === selectedDate));
        const dayName = offset === 0 ? '今天' : offset === 1 ? '明天' : dateLabel(key, { weekday: 'short' });
        button.innerHTML = `<span>${dayName}</span><strong>${dateLabel(key, { month: 'numeric', day: 'numeric' })}</strong>`;
        button.addEventListener('click', () => {
          selectedDate = key;
          document.querySelectorAll('.date-button').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.date === selectedDate)));
          render();
        });
        dateStrip.append(button);
      }
    }
    function buildFilters() {
      const previous = currentFilters();
      cinemaSelect.replaceChildren(new Option('全部追蹤影城', ''));
      districtSelect.replaceChildren(new Option('全部行政區', ''));
      formatSelect.replaceChildren(new Option('全部版本', ''));
      formats.forEach(function(format) { const option=document.createElement('option'); option.value=format; option.textContent=format; formatSelect.append(option); });
      [...new Set(cinemas.map((cinema) => cinema.district))].sort().forEach((district) => {
        const option = document.createElement('option'); option.value = district; option.textContent = district; districtSelect.append(option);
      });
      cinemas.forEach((cinema) => {
        const option = document.createElement('option'); option.value = cinema.id; option.textContent = cinema.name; cinemaSelect.append(option);
      });
      cinemaSelect.value = cinemas.some(c => c.id === previous.cinema) ? previous.cinema : '';
      districtSelect.value = cinemas.some(c => c.district === previous.district) ? previous.district : '';
      formatSelect.value = formats.includes(previous.format) ? previous.format : '';
    }
    function currentFilters() {
      return {
        query: queryInput.value.trim().toLocaleLowerCase('zh-TW'),
        district: districtSelect.value,
        cinema: cinemaSelect.value,
        format: formatSelect.value,
        movieKeys: [...selectedMovieKeys]
      };
    }
    function cinemaTextMatches(cinema, query) {
      const text = `${cinema.name} ${cinema.chain} ${cinema.district} ${cinema.address}`.toLocaleLowerCase('zh-TW');
      return !query || text.includes(query);
    }
    function withinCinemaFilters(cinema, filters) {
      return (!filters.district || cinema.district === filters.district) &&
        (!filters.cinema || cinema.id === filters.cinema);
    }
    function filteredCinemas(filters) {
      return cinemas.filter((cinema) => {
        if (!withinCinemaFilters(cinema, filters)) return false;
        const selected = new Set(filters.movieKeys || []);
        const matchesSelection = showing => showing.cinemaId === cinema.id && (selected.size > 0 || showing.date === selectedDate) && isUpcoming(showing) && (!filters.format || normalizeMovieFormat(showing.format) === normalizeMovieFormat(filters.format)) && (!selected.size || selected.has(movieVersionKey(showing)));
        if (selected.size && !showings.some(matchesSelection)) return false;
        const venueMatch = cinemaTextMatches(cinema, filters.query);
        const movieMatch = !filters.query || showings.some((showing) =>
          matchesSelection(showing) &&
          showing.title.toLocaleLowerCase('zh-TW').includes(filters.query)
        );
        return venueMatch || movieMatch;
      });
    }
    function startTime(showing) { return Date.parse(showing.startsAt || `${showing.date}T${showing.time}:00+08:00`); }
    function isUpcoming(showing) { const start = startTime(showing); return Number.isFinite(start) && start >= Date.now(); }
    function officialFilmPage(item) {
      if (!item.posterSourceUrl) return undefined;
      try {
        const url = new URL(item.posterSourceUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
        if (item.cinemaId.startsWith('vieshow-') && url.hostname !== 'www.vscinemas.com.tw') return undefined;
        if (item.cinemaId.startsWith('ambassador-') && url.hostname !== 'www.ambassador.com.tw') return undefined;
        if (url.hostname === 'www.vscinemas.com.tw' && /^\/(?:vsweb\/)?film\/detail\.aspx$/i.test(url.pathname) && /^\d+$/.test(url.searchParams.get('id') || '')) return url.href;
        if (url.hostname === 'www.ambassador.com.tw' && url.pathname === '/home/MovieContent' && /^[\da-f-]+$/i.test(url.searchParams.get('MID') || '')) return url.href;
      } catch {}
      return undefined;
    }
    function officialBookingPage(item) {
      const codes = {'vieshow-xinyi':'1','vieshow-qsquare':'12','vieshow-muvie':'21','vieshow-nangang':'35','vieshow-ximen':'34','vieshow-banqiao':'16','vieshow-xindian':'32','vieshow-zhonghe':'30','vieshow-linkou':'19'};
      if (!item.bookingUrl || !codes[item.cinemaId]) return undefined;
      try {
        const url = new URL(item.bookingUrl, 'https://www.vscinemas.com.tw');
        if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'www.vscinemas.com.tw' || url.username || url.password || url.port || !/^\/vsTicketing\/+ticketing\/booking\.aspx$/i.test(url.pathname) || url.searchParams.get('cinemacode') !== codes[item.cinemaId] || !/^\d+$/.test(url.searchParams.get('txtSessionId') || '')) return undefined;
        url.protocol = 'https:';
        return url.href;
      } catch { return undefined; }
    }
    function normalizeMovieFormat(format) {
      const compact = format.normalize('NFKC').replace(/[\s‧·・()]/g, '');
      const digitalFirst = /^(2D|3D)?數位(.+)$/.exec(compact);
      const languageFirst = /^(.+?)(2D|3D)?數位(?:版|板)?$/.exec(compact);
      const language = (digitalFirst?.[2] ?? languageFirst?.[1] ?? '').replace(/(?:版|板)$/, '');
      const languages = {
        英: '英語', 英文: '英語', 英語: '英語', 日: '日語', 日文: '日語', 日語: '日語',
        韓: '韓語', 韓文: '韓語', 韓語: '韓語', 粵: '粵語', 粵語: '粵語',
        國: '國語', 國語: '國語', 中: '中文', 中文: '中文',
        法: '法語', 法文: '法語', 法語: '法語', 波蘭語: '波蘭語', 泰語: '泰語', 越南語: '越南語',
      };
      if (!Object.hasOwn(languages, language)) return format;
      const dimension = digitalFirst?.[1] ?? languageFirst?.[2];
      return `${dimension === '3D' ? '3D ' : ''}數位（${languages[language]}）`;
    }
    function movieVersionKey(item) { return JSON.stringify([item.title, normalizeMovieFormat(item.format)]); }
    function movieVersionCounts(items) {
      const counts = new Map();
      items.forEach(item => { const key = movieVersionKey(item); counts.set(key, (counts.get(key) || 0) + 1); });
      return counts;
    }
    function sortScreenings(items, order) {
      const collator = new Intl.Collator('zh-TW', {numeric: true, sensitivity: 'variant'});
      return [...items].sort((a, b) => {
        if (order !== 'time') {
          const title = collator.compare(a.title, b.title);
          const version = collator.compare(normalizeMovieFormat(a.format), normalizeMovieFormat(b.format));
          const group = (order === 'version' ? version || title : title || version) || movieVersionKey(a).localeCompare(movieVersionKey(b));
          if (group) return group;
        }
        return startTime(a) - startTime(b) || a.id.localeCompare(b.id);
      });
    }
    function filteredShowings(filters, allDates = Boolean(filters.movieKeys?.length)) {
      const selected = new Set(filters.movieKeys || []);
      const items = showings.filter((showing) => {
        const cinema = cinemas.find((item) => item.id === showing.cinemaId);
        if (!cinema) return false;
        const queryMatch = cinemaTextMatches(cinema, filters.query) || !filters.query || showing.title.toLocaleLowerCase('zh-TW').includes(filters.query);
        return (allDates || showing.date === selectedDate) && isUpcoming(showing) && queryMatch && (!filters.format || normalizeMovieFormat(showing.format) === normalizeMovieFormat(filters.format)) && (!selected.size || selected.has(movieVersionKey(showing))) && withinCinemaFilters(cinema, filters);
      });
      return sortScreenings(items, sortSelect.value);
    }
    function renderShowings(filters) {
      const list = $('#screening-view');
      const items = filteredShowings(filters);
      const counts = movieVersionCounts(items);
      list.innerHTML = items.map((item, index) => {
        const cinema = cinemas.find((candidate) => candidate.id === item.cinemaId);
        const ticket = typeof window.movieBookingFor === "function" ? window.movieBookingFor(item, cinema) : null;
        const reference = typeof window.moviePriceFor === "function" ? window.moviePriceFor(item, cinema) : null;
        const fromSource = sourceMode() && !item.isDemo && typeof window.movieSourceLink === "function" ? window.movieSourceLink(item.sourceUrl) : null;
        const priceMarkup = reference ? `<span class="screening-price" title="${esc(reference.note)}">${esc(reference.value)}</span>` : "";
        const ticketAction = ticket ? `<a class="action-link" href="${esc(ticket.url)}" title="${esc(ticket.direct ? "原始場次訂票連結" : ticket.infoOnly ? "請在來源頁確認購票方式，不保證線上售票" : "請在訂票平台重新選擇影城、電影、日期與場次")}" target="_blank" rel="noopener noreferrer">${esc(ticket.label)}</a>` : "";
        const sourceAction = fromSource ? `<a class="map-quick-link" href="${esc(fromSource)}" target="_blank" rel="noopener noreferrer">核對場次 ↗</a>` : "";
        const variantKey = movieVersionKey(item);
        const startsGroup = sortSelect.value !== 'time' && (index === 0 || movieVersionKey(items[index - 1]) !== variantKey);
        const groupHeading = startsGroup ? `<div class="movie-group-heading"><h3>${esc(item.title)} <span class="tag">${esc(normalizeMovieFormat(item.format))}</span></h3><span>${counts.get(variantKey)} 個場次</span></div>` : '';
        return `${groupHeading}<article class="screening-card">
          ${posterHtml(item)}
          <div><h3 class="movie-title"><a href="./index.html#movie=${encodeURIComponent(item.title)}">${esc(item.title)}</a></h3>
            <div class="movie-meta"><span class="tag">${esc(item.format)}</span><span class="tag">${personalImportActive ? "個人匯入 · 未經驗證" : sourceMode() ? "來源快照 · 請於原站核對" : "虛構測試場次"}</span></div>
            <div class="cinema-row"><span class="pin" aria-hidden="true">⌖</span>${esc(cinema.name)}</div>
            <p class="address">${esc(cinema.address)}</p>
          </div>
           <div class="screening-actions"><time class="screening-date" datetime="${esc(item.date)}">${esc(item.date)}（${dateLabel(item.date, {weekday: 'short'})}）</time><span class="time">${esc(item.time)}</span>${priceMarkup}${ticketAction}${sourceAction}<a class="map-quick-link" href="${mapsSearch(cinema)}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a></div>
        </article>`;
      }).join('');
      list.querySelectorAll('.poster img').forEach((img) => img.addEventListener('error', () => img.remove(), {once: true}));
      list.classList.toggle('hidden', selectedView !== 'screenings');
    }
    function renderCinemas(filters) {
      const list=$('#cinema-view');
      const items=filteredCinemas(filters).sort((a,b)=>
        Number(!a.address.startsWith('台北市'))-Number(!b.address.startsWith('台北市'))||
        a.district.localeCompare(b.district,'zh-TW')||a.name.localeCompare(b.name,'zh-TW'));
      const countByVenue=new Map();
      filteredShowings(filters).forEach(row=>countByVenue.set(row.cinemaId,(countByVenue.get(row.cinemaId)||0)+1));
      list.innerHTML=items.map(cinema=>{
        const synced=!cinema.directoryOnly;
        const count=countByVenue.get(cinema.id)||0;
        const official=cinema.official?.startsWith('https://')?
          '<a href="'+esc(cinema.official)+'" target="_blank" rel="noopener noreferrer">影城網站 ↗</a>':'';
        const schedule=cinema.schedules?.startsWith('https://')?
          '<a href="'+esc(cinema.schedules)+'" target="_blank" rel="noopener noreferrer">'+(synced?'來源場次 ↗':'外部資訊 ↗')+'</a>':'';
        const local=synced?'<a href="./showtimes.html?cinema='+encodeURIComponent(cinema.id)+'">本站場次 →</a>':'';
        const ticket=typeof window.movieBookingFor==='function' ? window.movieBookingFor({cinemaId:cinema.id,isDemo:false},cinema) : null;
        const booking=ticket?'<a href="'+esc(ticket.url)+'" target="_blank" rel="noopener noreferrer" title="請於來源頁確認可用場次及購票方式">'+esc(ticket.label)+'</a>':'';
        return '<article class="venue-card" data-coverage="'+(synced?'synced':'directory')+'">'+
          '<span class="venue-kicker">'+(cinema.address.startsWith('台北市')?'台北市':'新北市')+' · '+esc(cinema.chain)+' · '+esc(cinema.district)+'</span>'+
          '<h3>'+esc(cinema.name)+'</h3>'+
          '<span class="venue-coverage '+(synced?'venue-covered':'venue-unconnected')+'">'+
          (synced?'已接入場次來源':'已收錄影城・尚未串接場次')+'</span>'+
          '<p>'+esc(cinema.address)+'<br>'+(synced?('選定日期有 '+count+' 筆已取得場次；沒有資料不代表停映。'):'目前不提供自動場次；請前往來源網站核對。')+'</p>'+
          '<div class="venue-actions"><a class="map-link" href="'+mapsSearch(cinema)+'" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>'+
          official+local+booking+schedule+'</div></article>';
      }).join('');
      list.classList.toggle('hidden',selectedView!=='cinemas');
    }
    function renderMap(filters) {
      const items = filteredCinemas(filters);
      const list = $('#map-place-list');
      list.innerHTML = items.map((cinema) => `<button class="map-place" type="button" data-cinema-id="${esc(cinema.id)}" aria-current="${cinema.id === selectedMapCinema}"><strong>${esc(cinema.name)}</strong><span>${esc(cinema.address)}</span><small>${cinema.directoryOnly?'尚未接入場次':'場次已接入'}</small></button>`).join('');
      list.querySelectorAll('.map-place').forEach((button) => button.addEventListener('click', () => {
        const cinema = cinemas.find((item) => item.id === button.dataset.cinemaId);
        setMap(cinema);
      }));
      if (items.length) {
        const selectedCinema = items.find(cinema => cinema.id === selectedMapCinema) || items[0];
        if ($('#theatre-map').dataset.cinemaId !== selectedCinema.id) setMap(selectedCinema);
      }
      $('#map-layout').classList.toggle('hidden', selectedView !== 'map' || items.length === 0);
    }
    function render() {
      document.getElementById('date-picker').value=selectedDate;
      const filters = currentFilters();
      const allMovieDates = filters.movieKeys.length > 0;
      $('#date-picker').disabled = allMovieDates;
      $('#date-scope-note').textContent = allMovieDates ? '已選電影：顯示所有日期；取消電影勾選後可按日期查看。' : '其他日期（含預售場次）';
      document.querySelectorAll('.date-button').forEach(item => { item.disabled = allMovieDates; item.setAttribute('aria-pressed', String(!allMovieDates && item.dataset.date === selectedDate)); });
      renderMoviePicker(filters);
      $('#sort-control').classList.toggle('hidden', selectedView !== 'screenings');
      $('#sort-note').classList.toggle('hidden', selectedView !== 'screenings');
      renderShowings(filters);
      renderCinemas(filters);
      renderMap(filters);
      if (selectedView === 'screenings') {
        const items = filteredShowings(filters);
        $('#results-title').textContent = '電影場次';
        $('#result-count').textContent = `${movieVersionCounts(items).size} 部電影版本 · ${items.length} 個場次`;
        const sortLabel = {time:'依時間排序',movie:'依電影・各版本分開',version:'依版本・各電影分開'}[sortSelect.value];
        $('#selected-date').textContent = `${allMovieDates ? '已選電影・所有日期' : dateLabel(selectedDate, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} · 台北時間・${sortLabel}・隱藏已開演`;
        const empty=$('#empty-state');
        const chosen=cinemas.find(c=>c.id===filters.cinema);
        if(chosen?.directoryOnly){
          empty.textContent='這間影城目前只列入名錄，尚未串接本站場次。請前往外部影城網站核對。 ';
          const url=chosen.schedules||chosen.official;
          if(url?.startsWith('https://')){
            const a=document.createElement('a');
            a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='查看外部資料 ↗';
            empty.append(a);
          }
        } else empty.textContent='目前沒有符合條件的未開演場次。未取得不代表沒有放映，請調整日期或核對來源。';
        empty.classList.toggle('hidden', items.length > 0);
      } else if (selectedView === 'cinemas') {
        const items = filteredCinemas(filters);
        $('#results-title').textContent = '追蹤影城';
        $('#result-count').textContent = `${items.length} 間影城`;
        const cityCount=items.filter(c=>c.address.startsWith('台北市')).length;
        $('#selected-date').textContent = `台北市 ${cityCount} 間／新北市 ${items.length-cityCount} 間；其中 ${items.filter(c=>!c.directoryOnly).length} 間有場次同步，其餘僅提供影城資訊。`;
        $('#empty-state').classList.toggle('hidden', items.length > 0);
      } else {
        const items = filteredCinemas(filters);
        $('#results-title').textContent = '影城地圖';
        $('#result-count').textContent = `${items.length} 個地點`;
        $('#selected-date').textContent = '台北市及新北市影城地圖；標示於地圖不代表本站已取得該影城場次。';
        $('#empty-state').classList.toggle('hidden', items.length > 0);
      }
      document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === selectedView)));
      if (typeof window.renderMovieExplorer === 'function') window.renderMovieExplorer();
    }
    function movieChoices(filters) {
      const choices = new Map();
      const cinemaIds = new Set(cinemas.map(cinema => cinema.id));
      showings.forEach(row => {
        if (!cinemaIds.has(row.cinemaId)) return;
        const key = movieVersionKey(row);
        choices.set(key, {key, title: row.title, format: normalizeMovieFormat(row.format), count: 0});
      });
      filteredShowings({...filters, query: '', movieKeys: []}, true).forEach(row => {
        const key = movieVersionKey(row);
        choices.set(key, {key, title: row.title, format: normalizeMovieFormat(row.format), count: (choices.get(key)?.count || 0) + 1});
      });
      (filters.movieKeys || []).forEach(key => {
        if (choices.has(key)) return;
        try { const pair = JSON.parse(key); if (Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) choices.set(key, {key, title: pair[0], format: pair[1], count: 0}); } catch {}
      });
      const collator = new Intl.Collator('zh-TW', {numeric: true, sensitivity: 'variant'});
      return [...choices.values()].sort((a,b) => collator.compare(a.title,b.title) || collator.compare(a.format,b.format) || a.key.localeCompare(b.key));
    }
    function movieChoiceHtml(choice) {
      return `<label class="movie-choice"><input type="checkbox" name="movie-versions" data-movie-key="${esc(choice.key)}" value="${esc(choice.key)}" ${selectedMovieKeys.includes(choice.key) ? 'checked' : ''}><span><strong>${esc(choice.title)}</strong><small>${esc(choice.format)}</small><small>${choice.count ? '所有日期：'+choice.count+' 個場次' : '目前篩選下暫無未開演場次'}</small></span></label>`;
    }
    function renderMoviePicker(filters) {
      const list = $('#movie-options');
      const choices = movieChoices(filters);
      $('#movie-selection-status').textContent = selectedMovieKeys.length ? `已勾選 ${selectedMovieKeys.length} 部電影版本` : '全部電影／版本';
      const signature = JSON.stringify(choices);
      if (list.dataset.signature !== signature) {
        const active = document.activeElement;
        const focusedKey = active && list.contains(active) ? active.getAttribute('data-movie-key') : null;
        list.innerHTML = choices.map(movieChoiceHtml).join('') || '<p class="movie-picker-note">尚未取得電影資料，請更新場次後再試。</p>';
        list.dataset.signature = signature;
        if (focusedKey) {
          const restored = [...list.querySelectorAll('input[data-movie-key]')].find(input => input.value === focusedKey);
          (restored || $('#movie-picker summary')).focus({preventScroll: true});
        }
      }
      list.querySelectorAll('input[data-movie-key]').forEach(input => { input.checked = selectedMovieKeys.includes(input.value); });
    }
    $('#movie-options').addEventListener('change', event => {
      const input = event.target;
      if (!input.matches('input[data-movie-key]')) return;
      selectedMovieKeys = input.checked ? [...new Set([...selectedMovieKeys, input.value])] : selectedMovieKeys.filter(key => key !== input.value);
      render();
    });
    $('#movie-clear').addEventListener('click', () => { selectedMovieKeys = []; render(); });
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
      selectedView = button.dataset.view;
      render();
      if (selectedView === 'map') setMap(cinemas.find((cinema) => cinema.id === selectedMapCinema));
    }));
    [queryInput, cinemaSelect, districtSelect, formatSelect].forEach((control) => control.addEventListener('input', render));
    [cinemaSelect, districtSelect, formatSelect].forEach((control) => control.addEventListener('change', render));
    sortSelect.addEventListener('change', render);
    $('#clear').addEventListener('click', () => {
      queryInput.value = ''; cinemaSelect.value = ''; districtSelect.value = ''; formatSelect.value = ''; selectedMovieKeys = []; render(); queryInput.focus();
    });
    const picker=document.getElementById('date-picker'); picker.value=selectedDate; picker.min=taipeiTodayKey; picker.max=addDateKeyDays(taipeiTodayKey,180); picker.addEventListener('change',function(){if(/^\d{4}-\d{2}-\d{2}$/.test(picker.value)){selectedDate=picker.value;render();}});
    const stamp = value => value ? new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)) : '尚無成功資料';
    function renderSourceStatus(prefix) {
      const summary = document.getElementById('sync-time');
      const detail = document.getElementById('source-health');
      const pageSummary = document.getElementById('page-data-summary');
      const updatePageSummary = () => { if (pageSummary) pageSummary.textContent = summary.textContent; };
      if (personalImportActive) {
        summary.textContent = '個人匯入 ' + showings.length + ' 筆（僅此瀏覽器，非官方同步）';
        detail.textContent = '此 CSV 的場次尚未經影城官方同步驗證；請使用來源連結核對。';
        updatePageSummary();
        return;
      }
      if (sourceMode()) {
        const success = catalogue.sources.filter(s => s.state === 'ok' || (s.state === 'partial' && s.lastSuccessAt)).length;
        const age = Date.now() - Date.parse(catalogue.checkedAt);
        const stale = !Number.isFinite(age) || age < -15 * 60000 || age > 12 * 3600000;
        summary.textContent = (prefix || '來源場次快照') + '・' + showings.length + ' 筆 / ' + success + ' 間影城・查核 ' + stamp(catalogue.checkedAt) + '（台北）' + (stale ? '・資料可能過期' : '');
        detail.textContent = '只顯示已取得的場次，未取得不代表沒有放映。' + (stale ? '目前快照超過 12 小時或時間不明，請優先前往官方影城確認。\n' : '\n') +
          catalogue.sources.map(s => (cinemas.find(c=>c.id===s.cinemaId)?.name || s.cinemaId) + '：' + s.message).join('\n');
      } else {
        summary.textContent = hostedSnapshot ? '等待正式電影場次資料' : '本機測試資料（非公開場次）';
        detail.textContent = hostedSnapshot ? '尚未成功載入公開場次，請按重新載入已發布場次。' : '本機開發測試資料。';
      }
      updatePageSummary();
    }
    async function refreshCatalog() {
      const button = document.getElementById('refresh-catalog');
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = '更新中…';
      button.setAttribute('aria-busy', 'true');
      document.getElementById('refresh-help').classList.add('hidden');
      document.getElementById('sync-time').textContent = '正在讀取已發布的來源快照…';
      try {
        const endpoint = hostedSnapshot ? './catalog.json' : location.protocol === 'file:' ? 'http://127.0.0.1:3001/api/catalog' : '/api/catalog';
        const response = await fetch(endpoint, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error('更新服務暫時無法回應');
        const next = await response.json();
        const validDemo = !hostedSnapshot && next.mode === 'personal-local' && next.screenings.every(item => item.isDemo === true);
        const validSource = next.mode === 'source-snapshot' && next.screenings.every(item => item.isDemo === false && item.sourceUrl && /^https:\/\//.test(item.sourceUrl));
        if (next.schemaVersion !== 1 || !Array.isArray(next.cinemas) || !Array.isArray(next.screenings) || !Array.isArray(next.sources) ||
            !next.screenings.length || !(validDemo || validSource)) throw new Error('場次格式不正確，已保留原資料');
        if (validDemo) mostRecentDemoCatalog = next;
        personalImportActive = false;
        demoPreviewActive = false;
        catalogue = validDemo ? rollingDemoCatalog(next) : next;
        latestPublicCatalog = catalogue;
        cinemas = hydrateCinemas(catalogue.cinemas);
        showings = sanitizePublishedScreenings(catalogue.screenings);
        formats = [...new Set(showings.map(s => normalizeMovieFormat(s.format)))].sort();
        const today = taipeiDateKey();
        if (selectedDate === taipeiTodayKey || selectedDate < today) selectedDate = today;
        taipeiTodayKey = today;
        picker.min = today;
        picker.max = addDateKeyDays(today, 180);
        setPersonalMode(false);
        buildDates(); buildFilters(); render();
        renderSourceStatus('已重新載入已發布場次');
      } catch (error) {
        document.getElementById('sync-time').textContent = '讀取失敗，保留目前場次。最近快照：'+stamp(catalogue.checkedAt)+'（台北時間）。'+(hostedSnapshot ? '請確認網路，然後重試。' : '請確認本機服務及網路，然後重試。');
        document.getElementById('refresh-help').classList.remove('hidden');
        document.getElementById('page-data-summary').textContent = document.getElementById('sync-time').textContent;
      } finally {
        button.disabled = false;
        button.textContent = '↻ 重新載入已發布場次';
        button.removeAttribute('aria-busy');
      }
    }

    // Personal showtime files remain entirely in browser memory.
    function parsePersonalCsv(source) {
      const content = source.replace(/^\uFEFF/, '');
      let rows = [], row = [], cell = '', quoted = false;
      function finishRow() {
        row.push(cell); cell = '';
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
        if (rows.length > 2001) throw Error('最多只能匯入 2,000 筆場次');
      }
      for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (quoted) {
          if (ch === '"' && content[i + 1] === '"') { cell += '"'; i++; }
          else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"' && cell === '') quoted = true;
        else if (ch === '"') throw Error('CSV 引號格式不正確');
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
          finishRow();
          if (ch === '\r' && content[i + 1] === '\n') i++;
        } else cell += ch;
      }
      if (quoted) throw Error('CSV 引號未關閉');
      if (row.length || cell.length) finishRow();
      if (rows.length < 2) throw Error('CSV 須包含標題列與至少一筆場次');
      const headers = rows.shift().map(value => value.trim());
      const required = ['cinemaId', 'title', 'date', 'time'];
      if (headers.some(value => ![...required, 'format'].includes(value)) ||
          new Set(headers).size !== headers.length || required.some(value => !headers.includes(value))) {
        throw Error('欄位須為 cinemaId,title,date,time,format（format 可省略）');
      }
      const known = new Map(publicDemoCatalog.cinemas.map(cinema => [cinema.id, cinema]));
      const today = taipeiDateKey(), latest = addDateKeyDays(today, 180);
      return rows.map((values, i) => {
        if (values.length !== headers.length) throw Error('第 ' + (i + 2) + ' 列欄位數不符');
        const fields = Object.fromEntries(headers.map((key, j) => [key, values[j].trim()]));
        const cinema = known.get(fields.cinemaId);
        if (!cinema) throw Error('第 ' + (i + 2) + ' 列影城代碼不正確');
        if (!fields.title || fields.title.length > 120) throw Error('第 ' + (i + 2) + ' 列電影名稱不正確');
        const format = fields.format || '數位';
        if (format.length > 40) throw Error('第 ' + (i + 2) + ' 列版本名稱過長');
        const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fields.date);
        if (!dateParts || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time)) throw Error('第 ' + (i + 2) + ' 列時間格式錯誤');
        const check = new Date(Date.UTC(+dateParts[1], +dateParts[2] - 1, +dateParts[3]));
        if (check.getUTCFullYear() !== +dateParts[1] || check.getUTCMonth() + 1 !== +dateParts[2] ||
            check.getUTCDate() !== +dateParts[3] || fields.date < today || fields.date > latest) {
          throw Error('第 ' + (i + 2) + ' 列日期須在今天起 180 天內');
        }
        return { id: 'personal-csv-' + (i + 1), cinemaId: cinema.id,
          title: fields.title, date: fields.date, sourceBusinessDate: fields.date,
          time: fields.time, startsAt: fields.date + 'T' + fields.time + ':00+08:00',
          format, sourceUrl: cinema.showtimesUrl, isDemo: true, personalImport: true,
          posterVariant: 'teal', fetchedAt: null };
      });
    }
    function setPersonalMode(active) {
      const fromSources = !active && sourceMode();
      document.querySelector('.demo-banner div').innerHTML = active
        ? '<b>個人匯入資料（未驗證）</b>此瀏覽器的個人資料未經影城核對。'
        : '<b>場次資訊僅供參考</b>放映時間、票價與可購買狀態請以影城或售票平台為準。';
      document.querySelector('.demo-section-title h2').textContent = fromSources ? '已取得的電影場次' : active ? '個人匯入場次' : '電影場次查詢';
      document.querySelector('.demo-section-title p').textContent = active
        ? '顯示個人匯入的場次，尚未經影城官方驗證。'
        : '以下是公開來源的定期場次快照，未取得場次不代表沒有放映。';
      document.querySelector('footer p:last-child').textContent = active
        ? '目前顯示此瀏覽器匯入的個人資料。'
        : '資料為來源網站的有限快照，實際時刻、票價與售票情況請以影城公告為準。';
      document.querySelector('.demo-label').textContent = active ? '個人資料 · 未驗證' : fromSources ? '已發布場次' : '場次載入中';
      const liveCountLabel = document.querySelector('.film-explorer-kicker');
      if (liveCountLabel) liveCountLabel.textContent = fromSources
        ? catalogue.cinemas.length + ' 間影城已接入電影時刻'
        : active ? '個人匯入 · 未驗證' : '正在讀取影城場次';
      document.getElementById('personal-import-reset').disabled = !active;
      document.getElementById('refresh-catalog').disabled = active;
    }
    function usePersonalShowings(rows) {
      personalImportActive = true;
      catalogue = { ...publicDemoCatalog, checkedAt: null, screenings: rows };
      cinemas = hydrateCinemas(publicDemoCatalog.cinemas);
      showings = rows;
      formats = [...new Set(showings.map(s => normalizeMovieFormat(s.format)))].sort();
      selectedMovieKeys = [];
      selectedDate = taipeiDateKey();
      setPersonalMode(true);
      buildDates(); buildFilters(); render(); renderSourceStatus();
    }
    document.getElementById('personal-import-paste-button').addEventListener('click', () => {
      const input = document.getElementById('personal-showtimes-paste');
      const status = document.getElementById('personal-import-status');
      try {
        const text = input.value;
        if (!text.trim() || new TextEncoder().encode(text).length > 256 * 1024) {
          throw Error('請貼上不超過 256 KB 的 CSV 內容');
        }
        const rows = parsePersonalCsv(text);
        usePersonalShowings(rows);
        input.value = '';
        status.textContent = '已在此瀏覽器貼上 ' + rows.length + ' 筆場次，資料不會上傳 GitHub。';
      } catch (error) {
        status.textContent = '貼上失敗：' + (error instanceof Error ? error.message : 'CSV 格式錯誤') + '。原本的場次仍保留。';
      }
    });
    document.getElementById('personal-showtimes-file').addEventListener('change', async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const status = document.getElementById('personal-import-status');
      try {
        if (!/\.csv$/i.test(file.name) || !file.size || file.size > 256 * 1024) {
          throw Error('請選擇小於 256 KB 的 CSV 檔案');
        }
        const rows = parsePersonalCsv(await file.text());
        usePersonalShowings(rows);
        status.textContent = '已在此瀏覽器匯入 ' + rows.length + ' 筆場次，未更新 GitHub。';
      } catch (error) {
        status.textContent = '匯入失敗：' + (error instanceof Error ? error.message : 'CSV 格式錯誤') + '。原本的場次仍保留。';
      } finally { event.target.value = ''; }
    });
    document.getElementById('personal-import-reset').addEventListener('click', () => {
      personalImportActive = false;
      demoPreviewActive = false;
      catalogue = latestPublicCatalog;
      cinemas = hydrateCinemas(catalogue.cinemas);
      showings = sanitizePublishedScreenings(catalogue.screenings);
      formats = [...new Set(showings.map(s => normalizeMovieFormat(s.format)))].sort();
      selectedMovieKeys = [];
      selectedDate = taipeiDateKey();
      setPersonalMode(false);
      buildDates(); buildFilters(); render(); renderSourceStatus();
      document.getElementById('personal-import-status').textContent = '已恢復網站已發布的場次。';
    });
    document.getElementById('personal-import-template').addEventListener('click', () => {
      const sample = 'cinemaId,title,date,time,format\r\n' +
        'vieshow-xinyi,自填電影名稱,' + addDateKeyDays(taipeiDateKey(), 1) + ',19:30,數位\r\n';
      const url = URL.createObjectURL(new Blob(['\uFEFF' + sample], {type:'text/csv;charset=utf-8'}));
      const a = document.createElement('a');
      a.href = url; a.download = 'movie-checker-personal-example.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    document.getElementById('refresh-catalog').addEventListener('click', refreshCatalog);

    setPersonalMode(false);
    renderSourceStatus();
    buildDates(); buildFilters();
    if (initialCinemaQuery && cinemas.some(c => c.id === initialCinemaQuery)) cinemaSelect.value = initialCinemaQuery;
    render();
    if (hostedSnapshot) refreshCatalog();
    function updateClock() {
      if (document.visibilityState !== 'visible') return;
      const today = taipeiDateKey();
      if (today !== taipeiTodayKey) {
        if (selectedDate <= taipeiTodayKey) selectedDate = today;
        taipeiTodayKey = today;
        if (!personalImportActive && demoPreviewActive) {
          catalogue = rollingDemoCatalog(publicDemoCatalog, today);
          showings = sanitizePublishedScreenings(catalogue.screenings);
          renderSourceStatus();
        }
        picker.min = today;
        picker.max = addDateKeyDays(today, 180);
        buildDates();
      }
      render();
    }
    setInterval(updateClock, 15000);
    document.addEventListener('visibilitychange', updateClock);
  