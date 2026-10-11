(function () {
  var D = window.AR, ca = document.getElementById('ca'), cb = document.getElementById('cb'), out = document.getElementById('cmp');
  var by = {}; D.agents.forEach(function (a) { by[a.slug] = a; });
  var p = new URLSearchParams(location.search);
  if (by[p.get('a')]) ca.value = p.get('a');
  if (by[p.get('b')]) cb.value = p.get('b');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function link(a) { return '<a href="' + D.base + '/agents/' + a.slug + '/">' + esc(a.name) + '</a>'; }
  function dur(s) { return s == null ? '—' : s < 90 ? Math.round(s) + 's' : (s / 60).toFixed(1) + ' min'; }
  function render() {
    var a = by[ca.value], b = by[cb.value];
    var rows = [['Made by', 'vendor'], ['Interface', 'interface'], ['Models', 'models'], ['Licence', 'license'], ['How it’s billed', 'billing'], ['GitHub stars', 'stars']];
    var h = '<div class="table-wrap"><table><thead><tr><th></th><th>' + link(a) + '</th><th>' + link(b) + '</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var f = function (x) { var v = x[r[1]]; return r[1] === 'stars' ? Number(v).toLocaleString('en-US') : r[1] === 'license' ? esc(v || 'No open-source licence') : esc(v); };
      h += '<tr><td class="muted">' + r[0] + '</td><td>' + f(a) + '</td><td>' + f(b) + '</td></tr>';
    });
    D.tasks.forEach(function (t) {
      var ra = t.rows.filter(function (x) { return x.agent === a.slug; })[0], rb = t.rows.filter(function (x) { return x.agent === b.slug; })[0];
      var cell = function (r) { return r ? '<span class="num">' + r.score.toFixed(1) + '%</span> <span class="muted small">' + Math.round(r.solveRate * 100) + '% solved · ' + dur(r.duration) + ' · ' + r.n + ' run(s)</span>' : '<span class="pill pend">Not yet tested</span>'; };
      h += '<tr><td class="muted">Task #' + t.number + ': ' + esc(t.title) + '</td><td>' + cell(ra) + '</td><td>' + cell(rb) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    if (a.slug === b.slug) h = '<p class="muted">Pick two different agents.</p>' + h;
    out.innerHTML = h;
    history.replaceState(null, '', '?a=' + a.slug + '&b=' + b.slug);
  }
  ca.addEventListener('change', render); cb.addEventListener('change', render); render();
})();
