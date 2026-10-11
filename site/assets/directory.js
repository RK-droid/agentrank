(function () {
  var C = window.ARD, PER = 50, all = [], view = [], page = 0;
  var q = document.getElementById('dq'), cat = document.getElementById('dc'), sort = document.getElementById('ds'), lic = document.getElementById('dl');
  var rows = document.getElementById('drows'), count = document.getElementById('dcount'), pg = document.getElementById('dpage');
  var prev = document.getElementById('dprev'), next = document.getElementById('dnext');
  var params = new URLSearchParams(location.search);
  if (params.get('q')) q.value = params.get('q');
  if (params.get('cat')) cat.value = params.get('cat');
  if (params.get('sort')) sort.value = params.get('sort');
  if (params.get('oss') === '1') lic.checked = true;
  var medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function img(o, cls) { return '<img class="av ' + cls + '" src="' + esc(o.avatar) + '" alt="" width="40" height="40" loading="lazy" decoding="async" referrerpolicy="no-referrer">'; }
  function tone(n) { return n >= 80 ? 'ok' : n >= 60 ? 'ver' : n >= 40 ? 'com' : 'pend'; }
  function short(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
  function row(d, i) {
    return '<tr><td class="rank">' + (sort.value === 'score' && !q.value && !cat.value && !lic.checked && medals[i] || (i + 1)) + '</td>' +
      '<td><a class="agent-cell" href="' + C.base + '/agents/' + d.slug + '/">' + img(d.owner, 'sm') + '<span><strong>' + esc(d.name) + (d.curated ? ' <span class="pill ver">Benchmark-ready</span>' : '') + '</strong><span class="sub">' + esc(d.description) + '</span></span></a></td>' +
      '<td><a class="maker" href="' + esc(d.owner.url) + '" rel="nofollow">' + img(d.owner, 'xs') + '<span>' + esc(d.owner.login) + '</span></a></td>' +
      '<td class="small">' + esc(d.category) + '</td><td><span class="score ' + tone(d.arScore) + '">' + d.arScore + '</span></td><td class="num">' + short(d.stars) + '</td></tr>';
  }
  function apply(resetPage) {
    var terms = q.value.toLowerCase().trim().split(' ').filter(Boolean);
    view = all.filter(function (d) {
      if (cat.value && d.category !== cat.value) return false;
      if (lic.checked && !d.license) return false;
      if (!terms.length) return true;
      var hay = (d.name + ' ' + d.repo + ' ' + d.description + ' ' + d.category + ' ' + (d.language || '')).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) > -1; });
    });
    var key = sort.value;
    view.sort(function (a, b) {
      if (key === 'new') return (b.createdAt || '').localeCompare(a.createdAt || '');
      if (key === 'pushed') return (b.pushedAt || '').localeCompare(a.pushedAt || '');
      if (key === 'name') return a.name.localeCompare(b.name);
      if (key === 'score') return b.arScore - a.arScore || b.stars - a.stars;
      return b.stars - a.stars;
    });
    if (resetPage) page = 0;
    render();
    var p = new URLSearchParams();
    if (q.value) p.set('q', q.value); if (cat.value) p.set('cat', cat.value); if (sort.value !== 'score') p.set('sort', sort.value); if (lic.checked) p.set('oss', '1');
    history.replaceState(null, '', p.toString() ? '?' + p : location.pathname);
  }
  function render() {
    var pages = Math.max(1, Math.ceil(view.length / PER));
    page = Math.min(page, pages - 1);
    rows.innerHTML = view.length ? view.slice(page * PER, page * PER + PER).map(function (d, i) { return row(d, page * PER + i); }).join('') :
      '<tr><td colspan="6" class="muted">No agents match. <a href="' + C.base + '/submit/">Submit one →</a></td></tr>';
    count.textContent = view.length.toLocaleString('en-US') + ' of ' + all.length.toLocaleString('en-US') + ' agents';
    pg.textContent = 'Page ' + (page + 1) + ' of ' + pages;
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
  }
  fetch(C.src).then(function (r) { return r.json(); }).then(function (j) {
    all = j.agents;
    [q, cat, sort, lic].forEach(function (el) { el.addEventListener(el === q ? 'input' : 'change', function () { apply(true); }); });
    prev.addEventListener('click', function () { page--; render(); scrollTo({ top: rows.closest('.leader').offsetTop - 80 }); });
    next.addEventListener('click', function () { page++; render(); scrollTo({ top: rows.closest('.leader').offsetTop - 80 }); });
    apply(true);
  }).catch(function () { count.textContent = 'Showing the top 50. Could not load the full list.'; });
})();
