/* Movie Checker — movie-first views. Movie detail routes: #movie=<encoded title>.
   Uses the existing, already validated catalog and screening helpers. */
(() => {
  'use strict';
  let chosenDate = 'auto';
  let chosenCinema = '';
  const collator = new Intl.Collator('zh-TW', {numeric: true, sensitivity: 'base'});
  const $page = id => document.getElementById(id);
  const titleKey = title => String(title).normalize('NFKC').replace(/\s+/g,' ').trim().replace(/[.。．]+$/g,'');
  const encodePage = key => '#movie=' + encodeURIComponent(key);
  const selectedKey = () => {
    const match = /^#movie=(.*)$/.exec(location.hash);
    if (!match) return '';
    try { return titleKey(decodeURIComponent(match[1])); } catch { return ''; }
  };
  // The only supported general ticket destinations (do not synthesize session IDs).
  const PORTALS = {
    vieshow: 'https://www.vscinemas.com.tw/vsTicketing/ticketing/ticket.aspx',
    ambassador: 'https://booking.ambassador.com.tw/',
    showtime: 'https://www.showtimes.com.tw/cinemas/2/'
  };
  function sourceLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
      if (!['www.vscinemas.com.tw','www.ambassador.com.tw','www.showtimes.com.tw','www.atmovies.com.tw','kinotw.com'].includes(url.hostname)) return null;
      return url.href;
    } catch { return null; }
  }
  function ticketFor(row,cinema) {
    if (!sourceMode() || row.isDemo) return null;
    const direct = officialBookingPage(row);
    if (direct) return {url:direct,direct:true};
    if (cinema.id.startsWith('vieshow-') && cinema.ticketPortalUrl===PORTALS.vieshow) return {url:PORTALS.vieshow,direct:false};
    if (cinema.id.startsWith('ambassador-') && cinema.ticketPortalUrl===PORTALS.ambassador) return {url:PORTALS.ambassador,direct:false};
    if (cinema.id==='showtime-xinxin' && cinema.ticketPortalUrl===PORTALS.showtime) return {url:PORTALS.showtime,direct:false};
    return null;
  }
  function priceFor(row, cinema) {
    if (!sourceMode() || row.isDemo) return {value:'未驗證票價', note:'僅供資料預覽'};
    const guide=cinema.priceGuide;
    if (!guide) return {value:'請至官方確認票價',note:'本影城尚無公開參考價'};
    const format=String(row.format).normalize('NFKC').toUpperCase();
    const special=/4DX|SCREENX|IMAX|D.?BOX|ATMOS|MUCROWN|GOLD|TITAN|CROWN|首映|演唱會|LIVE|巨幕|特殊|特別|VIP/.test(format);
    if (special) {
      if (/SCREENX/.test(format) && cinema.id==='showtime-xinxin' && Number.isFinite(guide.screenX2D))
        return {value:'全票參考 NT$'+guide.screenX2D,note:'SCREENX 公開整理價，非即時售價'};
      return {value:'請至官方查詢特殊版本票價',note:'特殊放映與影廳可能另計費用'};
    }
    const is3D=/3D|立體/.test(format);
    const key=is3D?'regular3D':'regular2D';
    const price=guide[key],range=guide[key+'Range'];
    const number=Number.isFinite(price)?String(price):
      Array.isArray(range)&&range.length===2?range[0]+'–'+range[1]:null;
    if (!number) return {value:'請至官方確認票價',note:'此版本沒有公開的全票參考價'};
    return {value:'全票參考 NT$'+number,
      note:(guide.source==='official'?'影城公開票價':'第三方整理價')+' · 一般'+(is3D?'3D':'2D')+' · 不含網路手續費'};
  }
  function movieGroups() {
    const groups=new Map(), cinemaIds=new Set(cinemas.map(c=>c.id));
    for (const row of showings) {
      if (!cinemaIds.has(row.cinemaId) || !isUpcoming(row)) continue;
      const key=titleKey(row.title);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key,{key,title:key,rows:[],cinemaIds:new Set(),poster:null,first:Infinity});
      const group=groups.get(key);
      group.rows.push(row);
      group.cinemaIds.add(row.cinemaId);
      group.first=Math.min(group.first,startTime(row));
      if (!group.poster || (!group.poster.posterUrl && row.posterUrl)) group.poster=row;
    }
    return [...groups.values()];
  }
  function tile(group) {
    const route=encodePage(group.key);
    return '<article class="film-tile">'+posterHtml(group.poster)+
      '<div class="film-tile-info"><a class="film-tile-title" href="'+esc(route)+'">'+esc(group.title)+'</a>'+
      '<span class="film-tile-meta">'+group.cinemaIds.size+' 間影城 · '+group.rows.length+' 場</span>'+
      '<a class="film-tile-cta" href="'+esc(route)+'">查看上映日期、票價與訂票 →</a></div></article>';
  }
  function screening(row,cinema) {
    const price=priceFor(row,cinema), ticket=ticketFor(row,cinema), source=sourceLink(row.sourceUrl);
    return '<div class="film-session"><div class="film-session-info"><strong>'+esc(row.time)+'</strong>'+
      '<span>'+esc(dateLabel(row.date,{month:'numeric',day:'numeric',weekday:'short'}))+'</span>'+
      '<span>'+esc(row.format)+'</span>'+
      '<span class="film-session-price" title="'+esc(price.note)+'">'+esc(price.value)+'</span></div>'+
      '<div class="film-session-actions">'+
      (source?'<a href="'+esc(source)+'" target="_blank" rel="noopener noreferrer">核對來源 ↗</a>':'')+
      (ticket?'<a class="film-ticket" href="'+esc(ticket.url)+'" target="_blank" rel="noopener noreferrer" title="'+
        esc(ticket.direct?'來源提供已驗證場次連結':'需在影城平台重新選擇電影、日期和時間')+'">'+
        (ticket.direct?'直接前往官方訂票 ↗':'前往官方訂票 ↗')+'</a>':'<span>沒有可驗證的訂票入口</span>')+
      '</div></div>';
  }
  function venueSection(cinema, rows) {
    const guide=cinema.priceGuide||{};
    const priceUrl=sourceLink(guide.sourceUrl);
    return '<article class="film-venue"><header class="film-venue-head"><div><h4>'+esc(cinema.name)+
      '</h4><p>'+esc(cinema.district)+' · '+rows.length+' 場</p></div>'+
      '<div class="film-venue-guide">'+
      (priceUrl?'<a href="'+esc(priceUrl)+'" target="_blank" rel="noopener noreferrer">'+
        (guide.source==='official'?'影城票價公告 ↗':'第三方票價參考 ↗')+'</a>':'')+
      '<span>最終價格以影城結帳為準</span></div></header>'+
      rows.map(row=>screening(row,cinema)).join('')+'</article>';
  }
  function renderMoviePage() {
    const gallery=$page('film-grid'),detail=$page('film-detail'),tools=$page('film-tools');
    if (!gallery||!detail||!tools) return;
    if (hostedSnapshot&&!personalImportActive&&!sourceMode()&&!demoPreviewActive) {
      gallery.innerHTML='<p class="film-empty">正在讀取網站已發布的電影場次。若一直沒有資料，請按下方「重新載入已發布場次」。</p>';
      detail.classList.add('hidden');gallery.classList.remove('hidden');tools.classList.remove('hidden');
      return;
    }
    const groups=movieGroups(),chosen=groups.find(group=>group.key===selectedKey());
    if (!chosen) {
      detail.classList.add('hidden');gallery.classList.remove('hidden');tools.classList.remove('hidden');
      const query=$page('film-search').value.trim().toLocaleLowerCase('zh-TW');
      const sort=$page('film-sort').value;
      const visible=groups.filter(group=>group.title.toLocaleLowerCase('zh-TW').includes(query));
      visible.sort((a,b)=>sort==='title'?collator.compare(a.title,b.title):
        sort==='next'?(a.first-b.first||collator.compare(a.title,b.title)):
        (b.rows.length-a.rows.length||collator.compare(a.title,b.title)));
      $page('film-count').textContent=visible.length+' 部電影';
      gallery.innerHTML=visible.map(tile).join('')||'<p class="film-empty">目前沒有符合搜尋的未開演場次。可清除搜尋或往下查看影城來源。</p>';
      gallery.querySelectorAll('.poster img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
      return;
    }
    gallery.classList.add('hidden');detail.classList.remove('hidden');tools.classList.add('hidden');
    const dates=[...new Set(chosen.rows.map(row=>row.date))].sort();
    const day=chosenDate==='auto'?dates[0]:chosenDate;
    const tabs=[{key:'all',label:'全部日期'},...dates.map(key=>({key,label:dateLabel(key,{month:'numeric',day:'numeric',weekday:'short'})}))];
    const buttons='<div class="film-date-tabs" role="group" aria-label="上映日期">'+
      tabs.map(d=>'<button type="button" data-film-date="'+esc(d.key)+'" aria-pressed="'+String(d.key===day)+'">'+esc(d.label)+'</button>').join('')+'</div>';
    const cinemasForFilm=[...chosen.cinemaIds].map(id=>cinemas.find(c=>c.id===id)).filter(Boolean);
    const options='<label class="film-venue-select">影城<select id="film-venue-filter"><option value="">全部影城</option>'+
      cinemasForFilm.map(c=>'<option value="'+esc(c.id)+'"'+(c.id===chosenCinema?' selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label>';
    const shown=chosen.rows.filter(row=>(day==='all'||row.date===day)&&(!chosenCinema||row.cinemaId===chosenCinema))
      .sort((a,b)=>startTime(a)-startTime(b));
    const grouped=new Map();
    for (const row of shown){if(!grouped.has(row.cinemaId))grouped.set(row.cinemaId,[]);grouped.get(row.cinemaId).push(row);}
    const theatres=[...grouped.entries()].sort((a,b)=>startTime(a[1][0])-startTime(b[1][0]))
      .map(([id,rows])=>venueSection(cinemas.find(c=>c.id===id),rows)).join('');
    detail.innerHTML='<a class="film-back" href="#movie-explorer">← 返回所有電影</a>'+
      '<div class="film-detail-head">'+posterHtml(chosen.poster)+'<div><p class="eyebrow">'+
      esc(sourceMode()?'已發布場次快照':personalImportActive?'個人匯入 · 未經核對':'虛構測試資料')+
      '</p><h3>'+esc(chosen.title)+'</h3><p>'+chosen.cinemaIds.size+' 間影城 · '+chosen.rows.length+
      ' 個未開演場次 · '+dates.length+' 個日期</p>'+
      '<p>'+(sourceMode()?'請先選上映日期，再比較影城與放映時間。前往影城官方售票入口後，通常需再次選擇相同場次。':'目前為個人匯入或虛構測試資料，沒有經過官方場次核對，因此不提供訂票按鈕。')+'</p></div></div>'+
      buttons+'<div class="film-detail-filters"><span>'+shown.length+' 個顯示場次</span>'+options+'</div>'+
      (theatres||'<p class="film-empty">此篩選下暫無場次，請選擇其他日期或影城。</p>');
    detail.querySelectorAll('[data-film-date]').forEach(button=>button.addEventListener('click',()=>{
      chosenDate=button.dataset.filmDate;renderMoviePage();
    }));
    $page('film-venue-filter').addEventListener('change',e=>{chosenCinema=e.target.value;renderMoviePage();});
    detail.querySelectorAll('.poster img').forEach(img=>img.addEventListener('error',()=>img.remove(),{once:true}));
  }
  window.renderMovieExplorer=renderMoviePage;
  window.movieBookingFor=ticketFor;
  window.moviePriceFor=priceFor;
  window.movieSourceLink=sourceLink;
  $page('film-search').addEventListener('input',renderMoviePage);
  $page('film-sort').addEventListener('change',renderMoviePage);
  window.addEventListener('hashchange',()=>{
    chosenDate='auto';chosenCinema='';renderMoviePage();
    if(location.hash.startsWith('#movie=')) $page('movie-explorer').scrollIntoView({block:'start'});
  });
  // Also refresh the original time-based list, so its actions use the same portals.
  render();
})();
