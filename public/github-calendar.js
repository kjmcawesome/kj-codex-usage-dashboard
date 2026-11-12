const DAY = 86_400_000;
const account = 'kjmcawesome';
const profile = 'https://github.com/' + account;
const number = new Intl.NumberFormat('en-US');
const fmt = options => new Intl.DateTimeFormat('en-US', {timeZone:'UTC', ...options});
const fullDate = fmt({weekday:'long', month:'long', day:'numeric', year:'numeric'});
const shortDate = fmt({month:'short', day:'numeric', year:'numeric'});
const month = fmt({month:'short'});
const fetched = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
const stamp = date => Date.parse(date + 'T00:00:00Z');
const contributions = count => number.format(count) + ' contribution' + (count === 1 ? '' : 's');
const line = day => fullDate.format(stamp(day.date)) + ' · ' + contributions(day.count);

function validated(value) {
  if (value?.login !== account || value.profile_url !== profile || !Number.isFinite(Date.parse(value.fetched_at)) ||
      !Array.isArray(value.days) || value.days.length === 0 || value.days.length > 371) throw Error('Invalid GitHub calendar');
  const days = [...value.days].sort((a,b) => String(a.date).localeCompare(String(b.date)));
  let sum = 0;
  for (let i = 0; i < days.length; i++) {
    const d = days[i], t = stamp(d.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Number.isFinite(t) || new Date(t).toISOString().slice(0,10) !== d.date ||
        (i > 0 && t !== stamp(days[i-1].date) + DAY) ||
        !Number.isSafeInteger(d.count) || d.count < 0 || !Number.isInteger(d.level) || d.level < 0 || d.level > 4) throw Error('Invalid GitHub day');
    sum += d.count;
  }
  if (sum !== value.total) throw Error('GitHub total does not match its calendar');
  return {...value, days};
}

export function connectGitHubCalendar(doc) {
  const el = id => doc.getElementById(id);
  const grid = el('github-days'), scroll = el('github-scroll'), status = el('github-status');
  let current, selected, task;
  const buttonAt = i => grid.querySelector('[data-gh-index="'+i+'"]');
  function show(i) {
    const day = current?.days[i];
    if (!day) return;
    selected = day.date;
    const before = grid.querySelector('[tabindex="0"]');
    if (before) { before.tabIndex = -1; before.setAttribute('aria-pressed','false'); }
    const button = buttonAt(i);
    button.tabIndex = 0; button.setAttribute('aria-pressed','true');
    el('github-day-detail').textContent = line(day);
  }
  for (const eventName of ['click','focusin']) grid.addEventListener(eventName, event => {
    const b = event.target.closest('[data-gh-index]');
    if (b && grid.contains(b)) show(Number(b.dataset.ghIndex));
  });
  grid.addEventListener('keydown', event => {
    const b = event.target.closest('[data-gh-index]');
    if (!b || !current) return;
    const i = Number(b.dataset.ghIndex), last = current.days.length - 1;
    const target = {ArrowUp:i-1, ArrowDown:i+1, ArrowLeft:i-7, ArrowRight:i+7, Home:0, End:last}[event.key];
    if (typeof target !== 'number') return;
    event.preventDefault(); buttonAt(Math.max(0, Math.min(last, target))).focus();
  });
  function render(data, backup) {
    const existing = Boolean(current);
    if (current && Date.parse(current.fetched_at) > Date.parse(data.fetched_at)) { unavailable(); return; }
    current = data;
    const {days} = data, first = stamp(days[0].date), last = stamp(days.at(-1).date);
    const offset = new Date(first).getUTCDay();
    const weeks = Math.ceil((offset + days.length)/7);
    const cells = doc.createDocumentFragment(), labels = doc.createDocumentFragment();
    const prevFocus = grid.contains(doc.activeElement);
    el('github').style.setProperty('--gh-weeks', String(weeks));
    let lastMonthWeek = -3;
    days.forEach((d,i) => {
      const pos = offset+i, week = Math.floor(pos/7), day = doc.createElement('button');
      day.className = 'github-day'; day.type='button'; day.tabIndex=-1;
      day.dataset.level = String(d.level); day.dataset.ghIndex=String(i);
      day.style.gridColumn=String(week+1); day.style.gridRow=String(pos%7+1);
      day.title = line(d); day.setAttribute('aria-label',day.title); day.setAttribute('aria-pressed','false'); cells.append(day);
      if ((i === 0 || d.date.endsWith('-01')) && week-lastMonthWeek >= 3 && weeks-week >= 2) {
        const label = doc.createElement('span'); label.style.gridColumn=String(week+1); label.textContent=month.format(stamp(d.date)); labels.append(label); lastMonthWeek=week;
      }
    });
    el('github-months').replaceChildren(labels); grid.replaceChildren(cells);
    const preview = doc.createDocumentFragment();
    for (const d of days.slice(Math.max(0, (weeks-14)*7-offset))) {
      const tile=doc.createElement('i'); tile.dataset.level=String(d.level); preview.append(tile);
    }
    el('mini-grid').replaceChildren(preview); el('github-preview').hidden=false;
    el('github-title').textContent = contributions(data.total);
    const active = days.filter(d => d.count > 0).length;
    el('github-period').textContent = shortDate.format(first)+' – '+shortDate.format(last)+' · '+number.format(active)+' active '+(active === 1 ? 'day' : 'days');
    el('github-calendar').hidden = false;
    const previousIndex = days.findIndex(d=>d.date === selected), index = previousIndex < 0 ? days.length-1 : previousIndex;
    show(index);
    if (prevFocus) buttonAt(index).focus({preventScroll:true});
    if (!existing) requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });
    const saved = backup || data.stale === true || ['backup', 'stale'].includes(data.cache_status);
    status.textContent = (saved ? 'Showing saved GitHub data from ' : 'GitHub profile counts · Checked ') + fetched.format(new Date(data.fetched_at)) + '.';
  }
  function unavailable() {
    status.textContent = current ? 'GitHub refresh unavailable. Showing data checked '+fetched.format(new Date(current.fetched_at))+'.' :
      'GitHub contributions are unavailable. Open the profile above to check the calendar.';
  }
  async function read(url) {
    const res = await fetch(url, {cache:'no-store',signal:AbortSignal.timeout(8500)});
    if (!res.ok) throw Error('GitHub calendar unavailable');
    return validated(await res.json());
  }
  async function load() {
    status.textContent = 'Checking GitHub contributions…';
    try { render(await read('./data/github-contributions.json'), false); }
    catch {
      if (current) { unavailable(); return; }
      try { render(await read('./data/github-contributions-backup.json'), true); }
      catch { unavailable(); }
    }
  }
  return () => (task ||= load().finally(() => { task = undefined; }));
}
