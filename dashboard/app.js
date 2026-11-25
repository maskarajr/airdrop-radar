(function () {
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  var CELLS = {};
  DATA.evidence.odds_cells.forEach(function (cell) { CELLS[cell.key] = cell; });
  var state = { q: '', category: '', verdict: '', watch: false, deposit: '10000', share: 0.07, open: '', sort: 'hour', dir: -1, compare: [] };

  function money(n) {
    var sign = n < 0 ? '−' : '';
    var v = Math.abs(n);
    var body;
    if (v >= 1e9) body = (v / 1e9).toFixed(2) + 'B';
    else if (v >= 1e6) body = (v / 1e6).toFixed(2) + 'M';
    else if (v >= 1e3) body = (v / 1e3).toFixed(v >= 1e4 ? 1 : 2) + 'k';
    else if (v >= 100) body = String(Math.round(v));
    else body = v.toFixed(2);
    return sign + '$' + body;
  }

  function pct(n) {
    var p = n * 100;
    if (p !== 0 && Math.abs(p) < 0.1) return p.toFixed(2) + '%';
    return p.toFixed(1) + '%';
  }

  function times(n) { return n.toFixed(2) + '×'; }

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }

  var SVGNS = 'http' + String.fromCharCode(58, 47, 47) + 'www.w3.org/2000/svg';
  function se(name, attrs, kids) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (kid) { if (kid) node.append(kid); });
    return node;
  }

  function yearBand(age) {
    if (age === null || age === undefined) return 'unknown';
    if (age < 365) return 'under-1y';
    if (age < 730) return '1y';
    if (age < 1095) return '2y';
    return '3y-plus';
  }

  function growthBand(change) {
    if (change === null || change === undefined || !isFinite(change)) return 'missing';
    if (change <= -10) return 'down';
    if (change < 10) return 'flat';
    return 'up';
  }

  function tvlBand(tvl) {
    if (tvl < 100000000) return '50-100m';
    if (tvl < 250000000) return '100-250m';
    if (tvl < 1000000000) return '250m-1b';
    return 'over-1b';
  }

  function carryOf(change, median) {
    if (change === null || change === undefined || !isFinite(change)) return 1;
    var excess = (change - median) / 100;
    if (excess > 0.25) excess = 0.25;
    if (excess < -0.25) excess = -0.25;
    return 1 + excess;
  }

  function cellRate(key, parent) {
    var cell = CELLS[key];
    var k = cell ? cell.k : 0;
    var n = cell ? cell.n : 0;
    return (k + 8 * parent) / (n + 8);
  }

  function oddsOf(age, change, tvl, category) {
    var y = yearBand(age);
    var g = growthBand(change);
    var t = tvlBand(tvl);
    var base = DATA.evidence.odds_base;
    var p = cellRate('c:' + category + '|' + y + '|' + g + '|' + t, cellRate('ygt:' + y + '|' + g + '|' + t, cellRate('yg:' + y + '|' + g, cellRate('y:' + y, base))));
    return Math.round(p * 1e6) / 1e6;
  }

  function impliedValue(tvl, change7d, ageDays, category) {
    var e = DATA.evidence;
    var log = e.beta[0] + e.beta[1] * (Math.log(tvl) - e.center_log_tvl);
    var n = Math.round(Math.exp(log) * carryOf(change7d, DATA.median_change_7d) * oddsOf(ageDays, change7d, tvl, category));
    if (!isFinite(n) || n < 1) return 1;
    if (n > 1e14) return 1e14;
    return n;
  }

  function depositOf(row) {
    if (state.deposit === 'plan') return row.deposit_usd;
    return Number(state.deposit);
  }

  function economics(row, deposit) {
    var share = state.share;
    var drop = row.implied_value_usd * share * deposit / (row.tvl_usd + deposit);
    var fee = deposit * row.fee_rate;
    var charge = deposit * 0.04 * row.hold_days / 365;
    var net = drop - row.gas_total_usd - fee - charge;
    var perHour = row.work_minutes > 0 ? net / (row.work_minutes / 60) : 0;
    return {
      drop: Math.round(drop * 100) / 100,
      fee: Math.round(fee * 100) / 100,
      charge: Math.round(charge * 100) / 100,
      net: Math.round(net * 100) / 100,
      perHour: Math.round(perHour * 100) / 100,
    };
  }

  function verdictOf(net, perHour) {
    if (net > 0 && perHour >= 25) return 'FARM';
    if (net > 0) return 'MARGINAL';
    return 'SKIP';
  }

  function pill(verdict) {
    return h('span', { class: 'pill ' + verdict.toLowerCase(), text: verdict });
  }

  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function go(hash) {
    var next = hash ? '#' + hash : '';
    if (location.hash === next || (!hash && (location.hash === '' || location.hash === '#'))) { render(); return; }
    location.hash = hash;
  }

  function currentHash() { return decodeURIComponent(location.hash.replace(/^#/, '')); }

  function detailSlug() {
    var hash = currentHash();
    if (!hash || hash === 'evidence' || hash === 'board') return '';
    for (var i = 0; i < DATA.rows.length; i += 1) if (DATA.rows[i].slug === hash) return hash;
    return '';
  }

  function header() {
    return h('header', { class: 'top' }, [
      h('h1', { text: 'Token radar' }),
      h('div', { class: 'asof', text: 'Snapshot ' + DATA.as_of }),
    ]);
  }

  function tabs() {
    var hash = currentHash();
    var tab = detailSlug() ? 'board' : hash === 'evidence' ? 'evidence' : 'board';
    return h('nav', { class: 'tabs' }, [['board', 'Board'], ['evidence', 'Evidence']].map(function (item) {
      return h('button', {
        type: 'button', 'data-tab': item[0], 'aria-selected': tab === item[0] ? 'true' : 'false', text: item[1],
        onclick: function () { go(item[0] === 'board' ? '' : item[0]); },
      });
    }));
  }

  function counted() {
    var farm = 0;
    DATA.rows.forEach(function (row) {
      var econ = economics(row, depositOf(row));
      if (verdictOf(econ.net, econ.perHour) === 'FARM') farm += 1;
    });
    return farm;
  }

  function stats() {
    var ev = DATA.evidence;
    var odds = DATA.odds;
    var watch = DATA.counts.watchlist_on_board + '/' + DATA.counts.watchlist;
    var items = [
      ['lead', 'Held-out miss', times(ev.heldout.loo_median), 'Flat multiple ' + times(ev.flat.median)],
      ['', 'Range honesty', Math.round(ev.band_coverage * 100) + '%', 'Left-out tokens inside p25–p75'],
      ['', 'Odds Brier', odds.brier.toFixed(3), 'Base rate ' + odds.base_brier.toFixed(3) + ' · AUC ' + odds.auc.toFixed(2)],
      ['', 'Terms in the figure', 'Four', 'TVL, 7-day, age, category'],
      ['', 'Worth farming', String(counted()), 'Net above $25 an hour'],
      ['', 'Watchlist', watch, 'Every named slug is ranked'],
    ];
    return h('section', { class: 'stats' }, items.map(function (item) {
      return h('div', { class: 'stat ' + item[0] }, [
        h('span', { class: 'k', text: item[1] }),
        h('span', { class: 'n', text: item[2] }),
        h('span', { class: 's', text: item[3] }),
      ]);
    }));
  }

  function formulaLine() {
    var e = DATA.evidence;
    var a = e.beta[0].toFixed(3);
    var b = e.beta[1].toFixed(3);
    var c = e.center_log_tvl.toFixed(3);
    var m = DATA.median_change_7d.toFixed(2);
    return h('p', { class: 'formula', text: 'launch = exp(' + a + ' + ' + b + '×(ln TVL − ' + c + ')) × (1 + clamp((7d − ' + m + ')/100, −25%, 25%)). implied = round(launch × P(years, 7-day band, TVL band, category)).' });
  }

  function ledger() {
    var segs = DATA.ledger;
    var total = 0;
    segs.forEach(function (seg) { total += seg.count; });
    var greys = ['#555555', '#707070', '#8a8a8a', '#3a3a3a', '#464646', '#626262'];
    var x = 0;
    var rects = segs.map(function (seg, i) {
      var w = (seg.count / total) * 1000;
      var fill = seg.label === 'Ranked' ? '#e0a15c' : greys[(i + greys.length - 1) % greys.length];
      var rect = se('rect', { x: x.toFixed(2), y: '0', width: Math.max(w, 0.4).toFixed(2), height: '14', fill: fill });
      x += w;
      return rect;
    });
    return h('section', { class: 'ledger' }, [
      h('h2', { text: 'All ' + total + ' protocols' }),
      se('svg', { class: 'stack', viewBox: '0 0 1000 14', role: 'img', 'aria-label': 'Every protocol in the snapshot' }, rects),
      h('ul', { class: 'legend' }, segs.map(function (seg, i) {
        var fill = seg.label === 'Ranked' ? '#e0a15c' : greys[(i + greys.length - 1) % greys.length];
        return h('li', null, [h('span', { class: 'swatch', style: 'background:' + fill }), seg.label + ' ' + seg.count]);
      })),
    ]);
  }

  function termTable() {
    var ev = DATA.evidence;
    var fit = h('table', null, [
      h('thead', null, [h('tr', null, [h('th', { text: 'Launch value' }), h('th', { class: 'num', text: 'Leave-one-out' }), h('th', { class: 'num', text: 'Mean' })])]),
      h('tbody', null, [
        h('tr', null, [h('td', { text: 'Flat multiple' }), h('td', { class: 'num', text: times(ev.flat.median) }), h('td', { class: 'num', text: times(ev.flat.mean) })]),
        h('tr', null, [h('td', { text: 'Log TVL fit' }), h('td', { class: 'num', text: times(ev.heldout.loo_median) }), h('td', { class: 'num', text: times(ev.heldout.loo_mean) })]),
        h('tr', null, [h('td', { text: 'Walk-forward fit' }), h('td', { class: 'num', text: times(ev.heldout.walk_median) }), h('td', { class: 'num', text: times(ev.heldout.walk_mean) })]),
      ]),
    ]);
    var odds = h('table', null, [
      h('thead', null, [h('tr', null, [h('th', { text: 'Launch odds, added in order' }), h('th', { class: 'num', text: 'Brier' }), h('th', { class: 'num', text: 'AUC' })])]),
      h('tbody', null, ev.odds_terms.map(function (term) {
        return h('tr', null, [h('td', { text: term.term }), h('td', { class: 'num', text: term.brier.toFixed(3) }), h('td', { class: 'num', text: term.auc.toFixed(3) })]);
      })),
    ]);
    return h('section', { class: 'terms' }, [fit, odds]);
  }

  function integrity() {
    var rows = DATA.rows;
    var ranks = true;
    var order = true;
    var steps = true;
    var recomputed = 0;
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (row.rank !== i + 1) ranks = false;
      if (i > 0 && row.implied_value_usd > rows[i - 1].implied_value_usd) order = false;
      if (impliedValue(row.tvl_usd, row.change_7d, row.age_days, row.category) === row.implied_value_usd) recomputed += 1;
      if (row.farm_steps.length < 4 || row.farm_steps.length > 8) steps = false;
      for (var s = 0; s < row.farm_steps.length; s += 1) {
        var n = row.farm_steps[s].trim().length;
        if (n < 20 || n > 600) steps = false;
      }
    }
    var have = {};
    rows.forEach(function (row) { have[row.slug] = true; });
    var watch = 0;
    DATA.watchlist.forEach(function (slug) { if (have[slug]) watch += 1; });
    var total = 0;
    DATA.ledger.forEach(function (seg) { total += seg.count; });
    var checks = [
      [ranks, 'Ranks 1–' + rows.length],
      [order, 'Values never rise'],
      [watch === DATA.watchlist.length && DATA.watchlist.length === 40, 'Watchlist ' + watch + '/' + DATA.watchlist.length],
      [steps, 'Steps 4–8, 20–600 characters'],
      [total === DATA.counts.protocols, 'Ledger ' + total + '/' + DATA.counts.protocols],
      [recomputed === rows.length, 'recomputed ' + recomputed + ' of ' + rows.length],
    ];
    return h('ul', { class: 'ticks' }, checks.map(function (c) { return h('li', { class: c[0] ? 'ok' : 'bad', text: c[1] }); }));
  }

  function viewOf(row) {
    var econ = economics(row, depositOf(row));
    return { econ: econ, verdict: verdictOf(econ.net, econ.perHour) };
  }

  function tally() {
    var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    DATA.rows.forEach(function (row) { counts[viewOf(row).verdict] += 1; });
    return counts;
  }

  function planLine(row) {
    return money(depositOf(row)) + ' · ' + row.hold_days + ' d · ' + row.farm_steps.length + ' steps';
  }

  function farmNext() {
    var ranked = DATA.rows.map(function (row) {
      var view = viewOf(row);
      return { row: row, econ: view.econ, verdict: view.verdict };
    }).filter(function (item) { return item.verdict === 'FARM'; })
      .sort(function (a, b) { return b.econ.perHour - a.econ.perHour || a.row.rank - b.row.rank; })
      .slice(0, 3);
    var body = ranked.length === 0
      ? h('p', { class: 'muted', text: 'No row clears $25 an hour at this deposit.' })
      : h('div', { class: 'next-row' }, ranked.map(function (item) {
        return h('button', { type: 'button', onclick: function () { go(item.row.slug); } }, [
          h('span', { class: 'name-btn', text: item.row.name }),
          pill(item.verdict),
          h('span', { class: 'muted', text: money(item.econ.net) + ' net · ' + money(item.econ.perHour) + '/hour' }),
          h('span', { class: 'muted', text: planLine(item.row) }),
        ]);
      }));
    return h('section', { class: 'next' }, [h('h2', { text: 'Farm next' }), body]);
  }

  function rangeBar(row) {
    var lo = Math.log(Math.max(1, row.low_value_usd));
    var hi = Math.log(Math.max(1, row.high_value_usd));
    var mid = Math.log(Math.max(1, row.implied_value_usd));
    var t = hi === lo ? 0.5 : (mid - lo) / (hi - lo);
    var cx = (2 + Math.min(1, Math.max(0, t)) * 60).toFixed(1);
    return se('svg', { class: 'range', viewBox: '0 0 64 8', width: '64', height: '8', 'aria-hidden': 'true' }, [
      se('line', { x1: '2', y1: '4', x2: '62', y2: '4' }),
      se('circle', { cx: cx, cy: '4', r: '2.2' }),
    ]);
  }

  function oddsBar(p) {
    return h('span', null, [
      h('span', { class: 'obar' }, [h('i', { style: 'width:' + Math.round(p * 100) + '%' })]),
      pct(p),
    ]);
  }

  function splitStep(text) {
    var at = text.indexOf(' Cost: ');
    if (at === -1) return { act: text, cost: '', time: '' };
    var rest = text.slice(at + 7);
    var timeAt = rest.indexOf(' Time: ');
    if (timeAt === -1) return { act: text.slice(0, at), cost: rest, time: '' };
    return { act: text.slice(0, at), cost: rest.slice(0, timeAt).replace(/\.$/, ''), time: rest.slice(timeAt + 7).replace(/\.$/, '') };
  }

  function stepList(row, deposit) {
    var econ = economics(row, deposit);
    var items = row.farm_steps.map(function (text) {
      var parts = splitStep(text);
      return h('li', { class: 'step' }, [
        h('p', { text: parts.act }),
        h('div', { class: 'chips' }, [
          parts.cost ? h('span', { class: 'mini', text: 'Cost ' + parts.cost }) : null,
          parts.time ? h('span', { class: 'mini', text: 'Time ' + parts.time }) : null,
        ]),
      ]);
    });
    return h('div', null, [
      h('ol', { style: 'list-style:none;margin:0;padding:0' }, items),
      h('p', { class: 'total', text: 'Total cost ' + money(row.gas_total_usd + econ.fee + econ.charge) + ' · ' + row.work_minutes + ' minutes of stated work · hold ' + row.hold_days + ' days' }),
    ]);
  }

  function sortValue(row, key) {
    if (key === 'rank') return row.rank;
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'd7') return row.change_7d === null ? -1e12 : row.change_7d;
    if (key === 'age') return row.age_days === null ? -1 : row.age_days;
    if (key === 'odds') return row.p_token;
    if (key === 'launch') return row.launch_value_usd;
    if (key === 'implied') return row.implied_value_usd;
    if (key === 'net') return viewOf(row).econ.net;
    return viewOf(row).econ.perHour;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (row) {
      if (state.watch && !row.watchlist) return false;
      if (state.category && row.category !== state.category) return false;
      if (state.verdict && viewOf(row).verdict !== state.verdict) return false;
      if (!q) return true;
      return (row.name + ' ' + row.slug + ' ' + row.category).toLowerCase().indexOf(q) !== -1;
    });
    var dir = state.dir;
    var key = state.sort;
    return rows.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  function toggleCompare(slug) {
    var at = state.compare.indexOf(slug);
    if (at >= 0) state.compare.splice(at, 1);
    else if (state.compare.length < 3) state.compare.push(slug);
    render();
  }

  function controls(shown) {
    var categories = [];
    var seen = {};
    DATA.rows.forEach(function (row) { if (!seen[row.category]) { seen[row.category] = true; categories.push(row.category); } });
    categories.sort();
    var deps = [['plan', 'Plan size'], ['1000', '$1k'], ['10000', '$10k']];
    var shares = [[0.035, '3.5%'], [0.07, '7%'], [0.14, '14%']];
    return h('div', { class: 'controls' }, [
      h('div', { class: 'seg' }, deps.map(function (item) {
        return h('button', { type: 'button', 'data-dep': item[0], 'aria-pressed': String(state.deposit) === item[0] ? 'true' : 'false', text: item[1], onclick: function () { state.deposit = item[0]; render(); } });
      })),
      h('div', { class: 'seg' }, shares.map(function (item) {
        return h('button', { type: 'button', 'data-share': String(item[0]), 'aria-pressed': state.share === item[0] ? 'true' : 'false', text: item[1], onclick: function () { state.share = item[0]; render(); } });
      })),
      h('select', { id: 'category', onchange: function (ev) { state.category = ev.target.value; render(); } }, [h('option', { value: '', text: 'All categories' })].concat(categories.map(function (c) {
        return h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      }))),
      h('select', { id: 'verdict', onchange: function (ev) { state.verdict = ev.target.value; render(); } }, ['', 'FARM', 'MARGINAL', 'SKIP'].map(function (v) {
        return h('option', { value: v, text: v || 'All verdicts', selected: v === state.verdict ? 'selected' : null });
      })),
      h('input', { id: 'q', type: 'search', placeholder: 'Search protocols', value: state.q, oninput: function (ev) { state.q = ev.target.value; render(); } }),
      h('button', { type: 'button', id: 'watch', class: 'chip', 'aria-pressed': state.watch ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watch = !state.watch; render(); } }),
      state.category ? h('button', { type: 'button', class: 'chip', text: state.category + ' ×', onclick: function () { state.category = ''; render(); } }) : null,
      state.verdict ? h('button', { type: 'button', class: 'chip', text: state.verdict + ' ×', onclick: function () { state.verdict = ''; render(); } }) : null,
      state.watch ? h('button', { type: 'button', class: 'chip', text: 'Watchlist ×', onclick: function () { state.watch = false; render(); } }) : null,
      h('span', { class: 'shown', text: shown + ' of ' + DATA.rows.length }),
    ]);
  }

  function sortHead(key, label) {
    var on = state.sort === key;
    var arrow = on ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return h('th', { class: 'num' }, [
      h('button', { type: 'button', 'data-sort': key, text: label + arrow, onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
        render();
      } }),
    ]);
  }

  function compareTray() {
    if (state.compare.length === 0) return null;
    var cards = state.compare.map(function (slug) {
      var row = null;
      for (var i = 0; i < DATA.rows.length; i += 1) if (DATA.rows[i].slug === slug) row = DATA.rows[i];
      if (!row) return null;
      var view = viewOf(row);
      var change = row.change_7d === null ? '—' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%';
      return h('article', { class: 'cmp' }, [
        h('h3', { text: row.name }),
        pill(view.verdict),
        h('dl', null, [
          h('dt', { text: 'TVL' }), h('dd', { text: money(row.tvl_usd) }),
          h('dt', { text: '7D' }), h('dd', { text: change }),
          h('dt', { text: 'No-token age' }), h('dd', { text: ageText(row.age_days) }),
          h('dt', { text: 'Odds' }), h('dd', { text: pct(row.p_token) }),
          h('dt', { text: 'If it launches' }), h('dd', { text: money(row.launch_value_usd) }),
          h('dt', { text: 'Implied value' }), h('dd', { text: money(row.implied_value_usd) }),
          h('dt', { text: 'Net' }), h('dd', { text: money(view.econ.net) }),
          h('dt', { text: 'Net/hour' }), h('dd', { text: money(view.econ.perHour) }),
          h('dt', { text: 'Plan' }), h('dd', { text: planLine(row) }),
        ]),
      ]);
    });
    return h('section', { class: 'tray' }, [h('h2', { text: 'Compare' }), h('div', { class: 'tray-row' }, cards)]);
  }

  function board() {
    var rows = filteredRows();
    var body = [];
    rows.forEach(function (row) {
      var dep = depositOf(row);
      var econ = economics(row, dep);
      var verdict = verdictOf(econ.net, econ.perHour);
      var change = row.change_7d === null ? '—' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%';
      body.push(h('tr', null, [
        h('td', { class: 'num' }, [h('div', { text: String(row.rank) }), h('div', { class: 'band', text: row.rank_lo + '–' + row.rank_hi })]),
        h('td', null, [
          h('label', { class: 'pick' }, [
            h('input', {
              type: 'checkbox', class: 'cmpick', 'aria-label': 'Compare ' + row.name,
              checked: state.compare.indexOf(row.slug) >= 0 ? 'checked' : null,
              onchange: function () { toggleCompare(row.slug); },
            }),
          ]),
          h('button', { type: 'button', class: 'name-btn', text: row.name, onclick: function () { go(row.slug); } }),
          h('span', { class: 'tag' + (row.watchlist ? ' watch' : ''), text: row.watchlist ? 'Watchlist' : 'Off-list' }),
        ]),
        h('td', { class: 'num', text: money(row.tvl_usd) }),
        h('td', { class: 'num ' + (row.change_7d > 0 ? 'up' : row.change_7d < 0 ? 'down' : ''), text: change }),
        h('td', { class: 'num', text: ageText(row.age_days) }),
        h('td', { class: 'num' }, [oddsBar(row.p_token)]),
        h('td', { class: 'num', text: money(row.launch_value_usd) }),
        h('td', { class: 'num' }, [
          h('div', { text: money(row.implied_value_usd) }),
          rangeBar(row),
          h('div', { class: 'band', text: money(row.low_value_usd) + ' – ' + money(row.high_value_usd) }),
        ]),
        h('td', null, [pill(verdict), h('div', { class: 'band', text: money(econ.net) })]),
        h('td', { class: 'num', text: money(econ.perHour) }),
        h('td', null, [
          h('div', { class: 'plan', text: planLine(row) }),
          h('button', { type: 'button', class: 'expand', text: state.open === row.slug ? 'Hide steps' : 'Steps', onclick: function () { state.open = state.open === row.slug ? '' : row.slug; render(); } }),
        ]),
      ]));
      if (state.open === row.slug) {
        body.push(h('tr', { class: 'expanded' }, [h('td', { colspan: '11' }, [stepList(row, dep)])]));
      }
    });
    var counts = tally();
    return h('div', { id: 'main' }, [
      farmNext(),
      controls(rows.length),
      h('p', { class: 'mix' }, [
        h('span', { class: 'pill farm', text: 'FARM ' + counts.FARM }),
        h('span', { class: 'pill marginal', text: 'MARGINAL ' + counts.MARGINAL }),
        h('span', { class: 'pill skip', text: 'SKIP ' + counts.SKIP }),
      ]),
      compareTray(),
      rows.length === 0 ? h('p', { class: 'empty', text: 'No protocols match this search and filter.' }) : h('table', { class: 'board' }, [
        h('thead', null, [h('tr', null, [
          sortHead('rank', 'Rank'),
          h('th', { text: 'Protocol' }),
          sortHead('tvl', 'TVL'),
          sortHead('d7', '7D'),
          sortHead('age', 'No-token age'),
          sortHead('odds', 'Odds'),
          sortHead('launch', 'If it launches'),
          sortHead('implied', 'Implied value'),
          h('th', { text: 'Verdict' }),
          sortHead('hour', 'Net/hour'),
          h('th', { text: 'Plan' }),
        ])]),
        h('tbody', null, body),
      ]),
    ]);
  }

  function peers(row) {
    var list = DATA.comparables.map(function (c) {
      return { c: c, d: Math.abs(Math.log(c.tvl_usd) - Math.log(row.tvl_usd)), same: c.category === row.category ? 0 : 1 };
    }).sort(function (a, b) { return a.same - b.same || a.d - b.d || (a.c.slug < b.c.slug ? -1 : 1); }).slice(0, 4);
    return h('table', null, [
      h('thead', null, [h('tr', null, [h('th', { text: 'Peer' }), h('th', { class: 'num', text: 'Market cap' }), h('th', { class: 'num', text: 'TVL' })])]),
      h('tbody', null, list.map(function (item) {
        return h('tr', null, [h('td', { text: item.c.name }), h('td', { class: 'num', text: money(item.c.mcap_usd) }), h('td', { class: 'num', text: money(item.c.tvl_usd) })]);
      })),
    ]);
  }

  function detail(row) {
    var dep = depositOf(row);
    var econ = economics(row, dep);
    var verdict = verdictOf(econ.net, econ.perHour);
    var e = DATA.evidence;
    var anchor = Math.exp(e.beta[0] + e.beta[1] * (Math.log(row.tvl_usd) - e.center_log_tvl));
    var deps = [['plan', row.deposit_usd], ['1000', 1000], ['10000', 10000]];
    var shares = [0.035, 0.07, 0.14];
    var saved = state.share;
    var gridRows = shares.map(function (share) {
      state.share = share;
      var cells = deps.map(function (item) {
        var amount = item[0] === 'plan' ? row.deposit_usd : item[1];
        var cell = economics(row, amount);
        var v = verdictOf(cell.net, cell.perHour);
        var on = (state.deposit === 'plan' ? row.deposit_usd : Number(state.deposit)) === amount && saved === share;
        return h('td', { class: on ? 'on' : '' }, [money(cell.net), ' ', pill(v)]);
      });
      state.share = saved;
      return h('tr', null, [h('th', { text: pct(share) })].concat(cells));
    });
    var change = row.change_7d === null ? 'no 7-day print' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '% over 7 days';
    return h('article', { id: 'main' }, [
      h('button', { type: 'button', class: 'back', text: 'Back to the board', onclick: function () { go(''); } }),
      h('div', { class: 'detail' }, [
        h('h2', { text: row.name }),
        h('p', { class: 'facts' }, [
          row.category + ' · ',
          h('span', { text: 'TVL ' + money(row.tvl_usd) }),
          ' · ' + change,
          ' · listed ' + (row.listed_at || 'without a date'),
          ' · ' + ageText(row.age_days) + ' with no token',
        ]),
      ]),
      h('div', { class: 'detail-grid' }, [
        h('section', { class: 'panel' }, [
          h('h3', { text: 'How the figure is made' }),
          h('dl', null, [
            h('dt', { text: 'Log-log TVL anchor' }), h('dd', { text: money(anchor) }),
            h('dt', { text: '7-day carry' }), h('dd', { text: '× ' + row.carry.toFixed(3) }),
            h('dt', { text: 'Value if it launches' }), h('dd', { text: money(row.launch_value_usd) }),
            h('dt', { text: 'Launch odds' }), h('dd', { text: '× ' + pct(row.p_token) }),
            h('dt', { text: 'Odds cell' }), h('dd', { text: row.odds_level }),
            h('dt', { text: 'Implied value' }), h('dd', { text: money(row.implied_value_usd) }),
            h('dt', { text: 'p25–p75' }), h('dd', { text: money(row.low_value_usd) + ' – ' + money(row.high_value_usd) }),
          ]),
        ]),
        h('section', { class: 'panel' }, [
          h('h3', { text: 'Nearest priced peers' }),
          peers(row),
        ]),
        h('section', { class: 'panel' }, [
          h('h3', { text: 'Verdict at this deposit and drop share' }),
          h('p', { class: 'muted', text: money(dep) + ' deposit · ' + pct(state.share) + ' drop share · ' + verdict }),
          h('table', { class: 'grid3' }, [
            h('thead', null, [h('tr', null, [h('th', { text: 'Drop share' }), h('th', { text: 'Plan ' + money(row.deposit_usd) }), h('th', { text: '$1k' }), h('th', { text: '$10k' })])]),
            h('tbody', null, gridRows),
          ]),
        ]),
        h('section', { class: 'panel' }, [
          h('h3', { text: 'Net at the selected size' }),
          h('dl', null, [
            h('dt', { text: 'Modelled drop' }), h('dd', { text: money(econ.drop) }),
            h('dt', { text: 'Gas' }), h('dd', { text: money(row.gas_total_usd) }),
            h('dt', { text: 'Fees' }), h('dd', { text: money(econ.fee) }),
            h('dt', { text: 'T-bill, 4%' }), h('dd', { text: money(econ.charge) }),
            h('dt', { text: 'Net' }), h('dd', { text: money(econ.net) }),
            h('dt', { text: 'Net/hour' }), h('dd', { text: money(econ.perHour) }),
            h('dt', { text: 'Verdict' }), h('dd', null, [pill(verdict)]),
          ]),
        ]),
      ]),
      h('section', { class: 'panel', style: 'margin-top:12px' }, [
        h('h3', { text: 'Plan' }),
        stepList(row, dep),
      ]),
    ]);
  }

  function logLabel(p) {
    var v = Math.pow(10, p);
    if (v >= 1e9) return '$' + Math.round(v / 1e9) + 'B';
    if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }

  function scatter() {
    var ev = DATA.evidence;
    var W = 820;
    var H = 480;
    var L = 52;
    var R = 16;
    var T = 12;
    var B = 28;
    var pts = ev.scatter.map(function (p) { return { x: Math.log10(p.tvl), y: Math.log10(p.mcap) }; });
    var x0 = pts[0].x;
    var x1 = x0;
    var y0 = pts[0].y;
    var y1 = y0;
    function lineY(x) { return ev.line.intercept + ev.line.slope * x; }
    pts.forEach(function (p) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y, lineY(p.x) + ev.band.low);
      y1 = Math.max(y1, p.y, lineY(p.x) + ev.band.high);
    });
    x0 -= 0.12; x1 += 0.12;
    var pad = (y1 - y0) * 0.08;
    y0 -= pad; y1 += pad;
    function X(x) { return (L + ((x - x0) / (x1 - x0)) * (W - L - R)).toFixed(1); }
    function Y(y) { return (T + ((y1 - y) / (y1 - y0)) * (H - T - B)).toFixed(1); }
    var kids = [];
    for (var tick = Math.ceil(x0); tick <= Math.floor(x1); tick += 1) {
      kids.push(se('line', { class: 'grid', x1: X(tick), y1: String(T), x2: X(tick), y2: String(H - B) }));
      kids.push(se('text', { x: X(tick), y: String(H - 8), 'text-anchor': 'middle', text: logLabel(tick) }));
    }
    for (var ytick = Math.ceil(y0); ytick <= Math.floor(y1); ytick += 1) {
      kids.push(se('line', { class: 'grid', x1: String(L), y1: Y(ytick), x2: String(W - R), y2: Y(ytick) }));
      kids.push(se('text', { x: String(L - 6), y: String(Number(Y(ytick)) + 3), 'text-anchor': 'end', text: logLabel(ytick) }));
    }
    function hi(x) { return X(x) + ',' + Y(lineY(x) + ev.band.high); }
    function lo(x) { return X(x) + ',' + Y(lineY(x) + ev.band.low); }
    kids.push(se('polygon', { class: 'band', points: [hi(x0), hi(x1), lo(x1), lo(x0)].join(' ') }));
    pts.forEach(function (p) { kids.push(se('circle', { class: 'dot', cx: X(p.x), cy: Y(p.y), r: '2.4' })); });
    kids.push(se('line', { class: 'fit', x1: X(x0), y1: Y(lineY(x0)), x2: X(x1), y2: Y(lineY(x1)) }));
    return se('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Log market cap against log TVL, fitted line and residual band' }, kids);
  }

  function evidence() {
    return h('div', { id: 'main' }, [
      h('section', { class: 'chart-card' }, [
        h('h2', { text: 'Market cap against TVL' }),
        h('p', { class: 'muted', text: DATA.evidence.comparable_count + ' traded tokens. Slope ' + DATA.evidence.line.slope.toFixed(2) + '. The band is the 25th to 75th residual.' }),
        scatter(),
      ]),
      termTable(),
    ]);
  }

  function render() {
    var slug = detailSlug();
    var hash = currentHash();
    var row = null;
    if (slug) {
      for (var i = 0; i < DATA.rows.length; i += 1) if (DATA.rows[i].slug === slug) row = DATA.rows[i];
    }
    var body = row ? detail(row) : hash === 'evidence' ? evidence() : h('div', null, [stats(), formulaLine(), ledger(), termTable(), integrity(), board()]);
    app.replaceChildren(h('div', { class: 'wrap' }, [header(), tabs(), body]));
  }

  window.addEventListener('hashchange', render);
  render();
})();
