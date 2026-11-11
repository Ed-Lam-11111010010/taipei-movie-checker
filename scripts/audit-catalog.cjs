'use strict';
/* Source coverage health gate. Validated partial data may be published, but
   a seven-day coverage shortfall must be visible in Actions and on the site. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
});
const addDays = (date, offset) =>
  new Date(Date.parse(date + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const businessDay = value => fmt.format(new Date(value));
const dayCount = (rows, date) => rows.filter(row => row.date === date).length;

function inspect(catalog, previous) {
  const errors = [], warnings = [];
  if (!catalog || catalog.mode !== 'source-snapshot' ||
      !Array.isArray(catalog.screenings) || !Array.isArray(catalog.sources) ||
      !Array.isArray(catalog.cinemas) || !Number.isFinite(Date.parse(catalog.checkedAt))) {
    return {errors:['Invalid snapshot metadata or missing arrays'], warnings, days:[], cinemaCount:0};
  }
  const today = businessDay(catalog.checkedAt);
  const count = catalog.sources.length;
  if (count !== 38 || catalog.cinemas.length !== 38)
    errors.push('Expected all 38 cinema source records and cinema entries, got ' + count +
      ' sources and ' + catalog.cinemas.length + ' cinemas');
  const ids = catalog.sources.map(source => source.cinemaId);
  if (new Set(ids).size !== count)
    errors.push('Duplicate cinema source records');
  const seen = new Set(), validCinemas = new Set(catalog.cinemas.map(cinema => cinema.id));
  for (const row of catalog.screenings) {
    if (!validCinemas.has(row.cinemaId) || !row.title || !row.date ||
        !row.sourceBusinessDate || !row.time || !row.sourceUrl ||
        !/^https:\/\//.test(row.sourceUrl)) {
      errors.push('Malformed or untrusted screening row');
      break;
    }
    const key = [row.cinemaId,row.sourceBusinessDate,row.title,row.format,row.time].join('|');
    if (seen.has(key)) { errors.push('Duplicate screening: ' + key); break; }
    seen.add(key);
  }
  const days = Array.from({length:7}, (_, offset) => {
    const date = addDays(today, offset);
    const verified = catalog.sources.filter(source =>
      Array.isArray(source.dateChecks) && source.dateChecks.some(check =>
        check.date === date && check.state === 'verified')).length;
    const errorsBySource = catalog.sources.filter(source =>
      Array.isArray(source.dateChecks) && source.dateChecks.some(check =>
        check.date === date && check.state === 'source_error')).length;
    return {date, offset, verified, unverified:count-verified,
      sourceErrors:errorsBySource, screenings:dayCount(catalog.screenings,date)};
  });
  for (const source of catalog.sources) {
    if (!Array.isArray(source.dateChecks) || days.some(day =>
      !source.dateChecks.some(check => check.date === day.date &&
        ['verified','unverified','source_error'].includes(check.state)))) {
      errors.push('Missing seven-day per-source audit for ' + source.cinemaId);
      break;
    }
  }
  // Never silently replace a same-day good catalog with a large feed collapse.
  if (previous && previous.mode === 'source-snapshot' &&
      Array.isArray(previous.screenings) && Number.isFinite(Date.parse(previous.checkedAt)) &&
      businessDay(previous.checkedAt) === today) {
    for (const day of days.slice(0,2)) {
      const previousCount = dayCount(previous.screenings,day.date);
      if (previousCount >= 100 && day.screenings < Math.floor(previousCount * .60))
        errors.push(day.date + ' screenings regressed from ' + previousCount +
          ' to ' + day.screenings + ' (<60% of same-day last-good snapshot)');
    }
  }
  // Soft warnings become an explicit red coverage alert AFTER publishing the
  // usable verified snapshot; we cannot invent future showtimes not released.
  for (const day of days) {
    const threshold = Math.ceil(count * (day.offset === 0 ? .60 :
      day.offset === 1 ? .40 : .25));
    if (day.verified < threshold)
      warnings.push(day.date + ': ' + day.verified + '/' + count +
        ' cinemas verified; expected at least ' + threshold +
        ' for day +' + day.offset + ', source-not-ready or parser needs review');
  }
  return {today,errors,warnings,days,cinemaCount:count,screeningCount:catalog.screenings.length};
}

function selfTest() {
  const day='2026-11-11', now='2026-11-10T19:50:00.000Z';
  const sources=Array.from({length:38},(_,i)=>({
    cinemaId:'cinema-'+i, dateChecks:Array.from({length:7},(_,n)=>({
      date:addDays(day,n),state:'verified'
    }))
  }));
  const record=(date,id)=>({cinemaId:id,title:'Test',date,
    sourceBusinessDate:date,time:'12:00',format:'數位',sourceUrl:'https://example.com'});
  const current={mode:'source-snapshot',checkedAt:now,sources,
    cinemas:sources.map(item=>({id:item.cinemaId})),
    screenings:sources.map(item=>record(day,item.cinemaId))};
  assert.equal(inspect(current).errors.length,0);
  assert.equal(inspect(current).warnings.length,0);
  const missing=JSON.parse(JSON.stringify(current));
  for(const source of missing.sources)
    for(const check of source.dateChecks.slice(2))check.state='unverified';
  assert.equal(inspect(missing).warnings.length,5,'missing future dates trigger alerts');
  const duplicated=JSON.parse(JSON.stringify(current));
  duplicated.screenings.push({...duplicated.screenings[0]});
  assert.ok(inspect(duplicated).errors.some(s=>s.includes('Duplicate screening')));
  const previous=JSON.parse(JSON.stringify(current));
  previous.screenings=Array.from({length:100},(_,i)=>record(day,'cinema-'+(i%38))).map((x,i)=>({...x,title:'Test'+i}));
  const severelyReduced=JSON.parse(JSON.stringify(current));
  severelyReduced.screenings=severelyReduced.screenings.slice(0,20);
  assert.ok(inspect(severelyReduced,previous).errors.some(s=>s.includes('regressed')));
  console.log('PASS catalog audit: valid, missing future days, duplicates, data regressions');
}
function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const catalog=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../catalog.json'),'utf8'));
  const index=process.argv.indexOf('--previous');
  const previous=index>=0 ?
    JSON.parse(fs.readFileSync(process.argv[index+1],'utf8')) : null;
  const report=inspect(catalog,previous);
  console.log('Catalog: ' + report.screeningCount + ' sessions, ' +
    report.cinemaCount + ' source cinemas; checked ' + catalog.checkedAt);
  for(const day of report.days)
    console.log(day.date + ': ' + day.screenings + ' sessions; ' +
      day.verified + '/' + report.cinemaCount + ' cinema-days verified');
  for(const error of report.errors)console.error('::error::' + error);
  for(const warning of report.warnings)console.warn('::warning::' + warning);
  const summary=[
    '## Movie Checker — source coverage audit',
    'Catalog checked: ' + catalog.checkedAt + ' (UTC)',
    '',
    '| Taipei date | Sessions found | Verified cinemas | Source errors |',
    '| --- | ---: | ---: | ---: |',
    ...report.days.map(day=>'| ' + day.date + ' | ' + day.screenings +
      ' | ' + day.verified + '/' + report.cinemaCount + ' | ' + day.sourceErrors + ' |'),
    '',
    '**Data validity errors:** ' + report.errors.length,
    '**Future-day coverage warnings:** ' + report.warnings.length,
    '',
    'A green fetch does not mean all seven days are available. Missing dates are **unverified**, not zero showtimes.',
    ...(report.errors.length ? ['',...report.errors.map(s=>'- ERROR: '+s)] : []),
    ...(report.warnings.length ? ['',...report.warnings.map(s=>'- COVERAGE: '+s)] : [])
  ].join('\n')+'\n';
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
  else console.log(summary);
  if (report.errors.length || (process.argv.includes('--strict') && report.warnings.length))
    process.exitCode=1;
}
if (require.main === module)main();
module.exports={inspect};
