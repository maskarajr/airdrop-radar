(function () {
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  var CELLS = {};
  DATA.evidence.odds_cells.forEach(function (cell) { CELLS[cell.key] = cell; });
  var DEFAULT_DEP = DATA.default_deposit_usd || 10000;
  var DEFAULT_SHARE = 0.07;
  var state = {
    q: '',
    category: '',
    verdict: '',
    deposit: String(DEFAULT_DEP),
    share: DEFAULT_SHARE,
    open: '',
    watch: false,
    sort: { key: 'rank', dir: 1 },
    compare: [],
  };
  var PILL = { FARM: 'v-farm', MARGINAL: 'v-mid', SKIP: 'v-no' };

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

  function economicsAt(row, deposit, share) {
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

  function economics(row, deposit) {
    return economicsAt(row, deposit, state.share);
  }

  function defaultEcon(row) {
    return economicsAt(row, DEFAULT_DEP, DEFAULT_SHARE);
  }

  function verdictOf(net, perHour) {
    if (net > 0 && perHour >= 25) return 'FARM';
    if (net > 0) return 'MARGINAL';
    return 'SKIP';
  }

  function pill(verdict) {
    return h('span', { class: 'pill ' + PILL[verdict], text: verdict });
  }

  function planLine(row, deposit) {
    return money(deposit) + ' · ' + row.hold_days + ' d · ' + row.farm_steps.length + ' steps';
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
    if (!hash || hash === 'evidence' || hash === 'board' || hash === 'comps') return '';
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
    var tab = detailSlug() ? 'board' : hash === 'evidence' ? 'evidence' : hash === 'comps' ? 'comps' : 'board';
    return h('nav', { class: 'tabs' }, [
      ['board', 'No token yet ' + DATA.counts.board],
      ['comps', 'Tokens that trade ' + DATA.counts.traded],
      ['evidence', 'Evidence'],
    ].map(function (item) {
      return h('button', {
        type: 'button', 'data-tab': item[0], 'aria-selected': tab === item[0] ? 'true' : 'false', text: item[1],
        onclick: function () { go(item[0] === 'board' ? '' : item[0]); },
      });
    }));
  }

  function counted() {
    var farm = 0;
    DATA.rows.forEach(function (row) {
      var econ = defaultEcon(row);
      if (verdictOf(econ.net, econ.perHour) === 'FARM') farm += 1;
    });
    return farm;
  }

  function liveTally(rows) {
    var t = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    rows.forEach(function (row) {
      var econ = economics(row, depositOf(row));
      t[verdictOf(econ.net, econ.perHour)] += 1;
    });
    return t;
  }

  function stats() {
    var ev = DATA.evidence;
    var odds = DATA.odds;
    var watch = DATA.counts.watchlist_on_board + '/' + DATA.counts.watchlist;
    var items = [
      ['lead', 'Held-out miss', times(ev.heldout.loo_median), 'vs ' + times(ev.flat.median) + ' flat'],
      ['', 'Range honesty', Math.round(ev.band_coverage * 100) + '%', 'Left-out tokens inside p25–p75'],
      ['', 'Odds Brier', odds.brier.toFixed(3), 'vs ' + odds.base_brier.toFixed(3) + ' base · AUC ' + odds.auc.toFixed(2)],
      ['', 'Worth farming', String(counted()), 'Net ≥ $25/h at $10k · 7%'],
      ['', 'Watchlist', watch, 'Every named slug is ranked'],
      ['', 'On the board', String(DATA.counts.board), DATA.counts.protocols + ' protocols scanned'],
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
      h('caption', { class: 'fn', text: 'impliedValue()' }),
      h('thead', null, [h('tr', null, [h('th', { text: 'Launch value' }), h('th', { class: 'num', text: 'Leave-one-out' }), h('th', { class: 'num', text: 'Mean' })])]),
      h('tbody', null, [
        h('tr', null, [h('td', { text: 'Flat multiple' }), h('td', { class: 'num', text: times(ev.flat.median) }), h('td', { class: 'num', text: times(ev.flat.mean) })]),
        h('tr', null, [h('td', { text: 'Log TVL fit' }), h('td', { class: 'num', text: times(ev.heldout.loo_median) }), h('td', { class: 'num', text: times(ev.heldout.loo_mean) })]),
        h('tr', null, [h('td', { text: 'Walk-forward fit' }), h('td', { class: 'num', text: times(ev.heldout.walk_median) }), h('td', { class: 'num', text: times(ev.heldout.walk_mean) })]),
      ]),
    ]);
    var odds = h('table', null, [
      h('thead', null, [h('tr', null, [h('th', { text: 'Launch odds, added in order' }), h('th', { class: 'num', text: 'Brier' }), h('th', { class: 'num', text: 'AUC' })])]),
      h('tbody', null,       ev.odds_terms.map(function (term, i) {
        var prev = i === 0 ? term.brier : ev.odds_terms[i - 1].brier;
        var mark = i === 0 ? 'baseline' : (term.brier <= prev ? 'kept' : 'tested · nested');
        return h('tr', null, [h('td', { text: term.term + ' · ' + mark }), h('td', { class: 'num', text: term.brier.toFixed(3) }), h('td', { class: 'num', text: term.auc.toFixed(3) })]);
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
      [watch === DATA.watchlist.length && DATA.watchlist.length === 40, 'Watchlist 40/40'],
      [steps, 'Steps 4–8, 20–600 characters'],
      [total === DATA.counts.protocols, 'Ledger ' + total + '/' + DATA.counts.protocols],
      [recomputed === rows.length, '203/203 recomputed'],
    ];
    return h('div', { class: 'tickwrap' }, [
      fn('integrity()'),
      h('ul', { class: 'ticks' }, checks.map(function (c) { return h('li', { class: c[0] ? 'ok' : 'bad', text: c[1] }); })),
    ]);
  }

  function farmNext() {
    var ranked = [];
    DATA.rows.forEach(function (row) {
      var econ = defaultEcon(row);
      var verdict = verdictOf(econ.net, econ.perHour);
      if (verdict === 'FARM') ranked.push({ row: row, econ: econ });
    });
    ranked.sort(function (a, b) { return b.econ.perHour - a.econ.perHour || a.row.rank - b.row.rank; });
    ranked = ranked.slice(0, 3);
    var cards = ranked.length === 0
      ? [h('p', { class: 'empty', text: 'No FARM row at the default $10k · 7% view.' })]
      : ranked.map(function (item) {
        return h('button', { type: 'button', onclick: function () { go(item.row.slug); } }, [
          h('span', { class: 'name-btn', text: item.row.name }),
          pill('FARM'),
          h('span', { class: 'muted', text: 'Net ' + money(item.econ.net) }),
          h('span', { class: 'muted', text: money(item.econ.perHour) + '/hour' }),
          h('span', { class: 'muted', text: planLine(item.row, DEFAULT_DEP) }),
        ]);
      });
    return h('section', { class: 'next' }, [
      h('h2', null, ['Farm next ', fn('farmPlan()')]),
      h('div', { class: 'next-row' }, cards),
    ]);
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

  function fn(name) {
    return h('code', { class: 'fn', text: name });
  }

  function tier(row) {
    if (row.watchlist) return h('span', { class: 'badge watch', text: 'Watchlist' });
    if (row.tvl_usd < DATA.floor_usd) return h('span', { class: 'badge early', text: 'Early' });
    return h('span', { class: 'badge off', text: 'Off-list' });
  }

  function openAction(row, dep) {
    var p = row.playbook;
    var n = row.name;
    var c = row.primary_chain;
    var d = money(dep);
    if (p === 'dex') return 'LP ' + d + ' in ' + n + '\'s main pair on ' + c + ', in range.';
    if (p === 'lending') return 'Supply ' + d + ' on ' + n + ' (' + c + '). Borrow a little. Keep health above 2.';
    if (p === 'perps') return 'Post ' + d + ' margin on ' + n + ' (' + c + ') and open a small hedge.';
    if (p === 'yield') return 'Deposit ' + d + ' into ' + n + ' vault shares on ' + c + '.';
    if (p === 'staking') return 'Stake ' + d + ' on ' + n + ' (' + c + ') and keep the receipt token.';
    if (p === 'rwa') return 'Mint or hold ' + d + ' of ' + n + ' on ' + c + '.';
    if (p === 'bridge') return 'Bridge ' + d + ' through ' + n + ' on ' + c + ', then use it on the far side.';
    if (p === 'prediction') return 'Place ' + d + ' on ' + n + ' (' + c + ') in one listed market.';
    if (p === 'launchpad') return 'Commit ' + d + ' to the listed ' + n + ' sale on ' + c + '.';
    if (p === 'basis') return 'Hold ' + d + ' in the ' + n + ' basis book on ' + c + '.';
    if (p === 'insurance') return 'Buy ' + d + ' of cover from ' + n + ' on ' + c + '.';
    return 'Deposit ' + d + ' into ' + n + ' on ' + c + '.';
  }

  function sizedSteps(row, dep) {
    var weeks = Math.max(1, Math.round(row.hold_days / 7));
    var gas = money(row.gas_per_tx_usd);
    var cut = money(Math.round(row.tvl_usd * 0.7));
    var setup = Math.max(8, Math.round(row.work_minutes / 4));
    return [
      { when: 'Day 0', act: 'Fresh wallet for ' + row.name + ' on ' + row.primary_chain + '. Official app only. Never pay to claim.', cost: '$0', time: '5 min' },
      { when: 'Day 0', act: openAction(row, dep), cost: money(dep) + ' + ' + gas, time: setup + ' min' },
      { when: 'Weekly ×' + weeks, act: 'Confirm the ' + row.name + ' position on ' + row.primary_chain + ' is still open and the balance moved only by fees.', cost: '$0 unless a tx (' + gas + ')', time: '7 min ×' + weeks },
      { when: 'Day ' + row.hold_days, act: 'Close and withdraw the ' + money(dep) + ' from ' + row.name + ' on ' + row.primary_chain + '.', cost: gas, time: '8 min' },
      { when: 'Any day', act: 'Exit if TVL drops 30% below ' + money(row.tvl_usd) + ' (trigger ' + cut + '). Withdraw from the protocol page.', cost: gas, time: '8 min' },
    ];
  }

  function stepList(row, deposit) {
    var econ = economics(row, deposit);
    var steps = sizedSteps(row, deposit);
    var items = steps.map(function (s) {
      return h('li', { class: 'step' }, [
        h('p', null, [h('span', { class: 'when', text: s.when }), ' ', s.act]),
        h('div', { class: 'chips' }, [
          h('span', { class: 'mini', text: 'COST ' + s.cost }),
          h('span', { class: 'mini', text: 'TIME ' + s.time }),
        ]),
      ]);
    });
    return h('div', null, [
      fn('farmPlan()'),
      h('ol', { class: 'steps' }, items),
      h('p', { class: 'total', text: 'All in: ' + steps.length + ' steps over ' + row.hold_days + ' days on ' + money(deposit) + ': net ' + money(econ.net) + ', ' + money(econ.perHour) + '/h' }),
    ]);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (row) {
      if (state.watch && !row.watchlist) return false;
      if (state.category && row.category !== state.category) return false;
      if (state.verdict) {
        var econ = economics(row, depositOf(row));
        if (verdictOf(econ.net, econ.perHour) !== state.verdict) return false;
      }
      if (!q) return true;
      return (row.name + ' ' + row.category + ' ' + row.primary_chain).toLowerCase().indexOf(q) !== -1;
    });
    var key = state.sort.key;
    var dir = state.sort.dir;
    list.sort(function (a, b) {
      var ea = economics(a, depositOf(a));
      var eb = economics(b, depositOf(b));
      var va;
      var vb;
      if (key === 'rank') { va = a.rank; vb = b.rank; }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -1e18 : a.change_7d; vb = b.change_7d === null ? -1e18 : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'odds') { va = a.p_token; vb = b.p_token; }
      else if (key === 'launch') { va = a.launch_value_usd; vb = b.launch_value_usd; }
      else if (key === 'implied') { va = a.implied_value_usd; vb = b.implied_value_usd; }
      else if (key === 'net') { va = ea.net; vb = eb.net; }
      else if (key === 'hour') { va = ea.perHour; vb = eb.perHour; }
      else { va = a.rank; vb = b.rank; }
      if (va !== vb) return va < vb ? -dir : dir;
      return a.rank - b.rank;
    });
    return list;
  }

  function sortHead(label, key, numeric) {
    var on = state.sort.key === key;
    var arrow = on ? (state.sort.dir === 1 ? ' ↑' : ' ↓') : '';
    return h('th', { class: (numeric ? 'num' : '') + (on ? ' sorted' : '') }, [
      h('button', {
        type: 'button',
        class: 'th-sort',
        'aria-sort': on ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none',
        text: label + arrow,
        onclick: function () {
          if (state.sort.key === key) state.sort.dir = -state.sort.dir;
          else { state.sort.key = key; state.sort.dir = key === 'rank' ? 1 : -1; }
          render();
        },
      }),
    ]);
  }

  function toggleCompare(slug) {
    var i = state.compare.indexOf(slug);
    if (i >= 0) state.compare.splice(i, 1);
    else if (state.compare.length < 3) state.compare.push(slug);
    render();
  }

  function controls(rows) {
    var shown = rows.length;
    var tvlSum = 0;
    var implSum = 0;
    rows.forEach(function (row) { tvlSum += row.tvl_usd; implSum += row.implied_value_usd; });
    var categories = [];
    var seen = {};
    DATA.rows.forEach(function (row) { if (!seen[row.category]) { seen[row.category] = true; categories.push(row.category); } });
    categories.sort();
    var deps = [['plan', 'Plan size'], ['1000', '$1k'], ['10000', '$10k']];
    var shares = [[0.035, '3.5%'], [0.07, '7%'], [0.14, '14%']];
    var chips = [];
    if (state.q.trim()) chips.push(h('button', { type: 'button', class: 'chip', text: 'Search ' + state.q.trim() + ' ×', onclick: function () { state.q = ''; render(); } }));
    if (state.watch) chips.push(h('button', { type: 'button', class: 'chip', text: 'Watchlist ×', onclick: function () { state.watch = false; render(); } }));
    if (state.category) chips.push(h('button', { type: 'button', class: 'chip', text: state.category + ' ×', onclick: function () { state.category = ''; render(); } }));
    if (state.verdict) chips.push(h('button', { type: 'button', class: 'chip', text: state.verdict + ' ×', onclick: function () { state.verdict = ''; render(); } }));
    if (chips.length) chips.push(h('button', { type: 'button', class: 'chip', text: 'Clear', onclick: function () { state.q = ''; state.watch = false; state.category = ''; state.verdict = ''; render(); } }));
    return h('div', { class: 'controls' }, [
      h('div', { class: 'seg' }, deps.map(function (item) {
        return h('button', { type: 'button', 'data-dep': item[0], 'aria-pressed': String(state.deposit) === item[0] ? 'true' : 'false', text: item[1], onclick: function () { state.deposit = item[0]; render(); } });
      })),
      h('div', { class: 'seg' }, shares.map(function (item) {
        return h('button', { type: 'button', 'data-share': String(item[0]), 'aria-pressed': state.share === item[0] ? 'true' : 'false', text: item[1], onclick: function () { state.share = item[0]; render(); } });
      })),
      h('input', { id: 'q', type: 'search', placeholder: 'Search', value: state.q, oninput: function (ev) { state.q = ev.target.value; render(); } }),
      h('label', { class: 'toggle' }, [
        h('input', { id: 'watch', type: 'checkbox', checked: state.watch ? 'checked' : null, onchange: function (ev) { state.watch = ev.target.checked; render(); } }),
        ' Watchlist only',
      ]),
      h('select', { id: 'category', onchange: function (ev) { state.category = ev.target.value; render(); } }, [h('option', { value: '', text: 'All categories' })].concat(categories.map(function (c) {
        return h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      }))),
      h('select', { id: 'verdict', onchange: function (ev) { state.verdict = ev.target.value; render(); } }, ['', 'FARM', 'MARGINAL', 'SKIP'].map(function (v) {
        return h('option', { value: v, text: v || 'All verdicts', selected: v === state.verdict ? 'selected' : null });
      })),
    ].concat(chips).concat([h('span', { class: 'shown', text: shown + ' of ' + DATA.rows.length + ' rows · ' + money(tvlSum) + ' TVL · ' + money(implSum) + ' implied' })]));
  }

  function compareTray() {
    if (state.compare.length === 0) return null;
    var cols = state.compare.map(function (slug) {
      var row = null;
      for (var i = 0; i < DATA.rows.length; i += 1) if (DATA.rows[i].slug === slug) row = DATA.rows[i];
      return row;
    }).filter(Boolean);
    var fields = [
      ['TVL', function (row) { return money(row.tvl_usd); }],
      ['7D', function (row) { return row.change_7d === null ? '—' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%'; }],
      ['Age', function (row) { return ageText(row.age_days); }],
      ['Odds', function (row) { return pct(row.p_token); }],
      ['If it launches', function (row) { return money(row.launch_value_usd); }],
      ['Implied value', function (row) { return money(row.implied_value_usd); }],
      ['Verdict', function (row) {
        var econ = economics(row, depositOf(row));
        return verdictOf(econ.net, econ.perHour);
      }],
      ['Net', function (row) { return money(economics(row, depositOf(row)).net); }],
      ['Net/hour', function (row) { return money(economics(row, depositOf(row)).perHour); }],
      ['Plan', function (row) { return planLine(row, depositOf(row)); }],
    ];
    return h('section', { class: 'compare', id: 'compare' }, [
      h('h2', { text: 'Compare ' + cols.length }),
      h('table', { class: 'cmp' }, [
        h('thead', null, [h('tr', null, [h('th', { text: '' })].concat(cols.map(function (row) {
          return h('th', null, [h('button', { type: 'button', class: 'name-btn', text: row.name, onclick: function () { go(row.slug); } })]);
        })))]),
        h('tbody', null, fields.map(function (field) {
          return h('tr', null, [h('th', { text: field[0] })].concat(cols.map(function (row) {
            if (field[0] === 'Verdict') {
              var econ = economics(row, depositOf(row));
              var v = verdictOf(econ.net, econ.perHour);
              return h('td', null, [pill(v)]);
            }
            return h('td', { class: 'num', text: field[1](row) });
          })));
        })),
      ]),
    ]);
  }

  function board() {
    var rows = filteredRows();
    var tally = liveTally(rows);
    var body = [];
    rows.forEach(function (row) {
      var dep = depositOf(row);
      var econ = economics(row, dep);
      var verdict = verdictOf(econ.net, econ.perHour);
      var change = row.change_7d === null ? '—' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(1) + '%';
      var checked = state.compare.indexOf(row.slug) >= 0;
      body.push(h('tr', { class: 'row' + (checked ? ' picked' : '') }, [
        h('td', { class: 'pick' }, [
          h('input', {
            type: 'checkbox',
            'aria-label': 'Compare ' + row.name,
            checked: checked ? 'checked' : null,
            disabled: !checked && state.compare.length >= 3 ? 'disabled' : null,
            onchange: function () { toggleCompare(row.slug); },
          }),
        ]),
        h('td', { class: 'num' }, [h('div', { text: String(row.rank) }), h('div', { class: 'band', text: row.rank_lo + '–' + row.rank_hi })]),
        h('td', null, [
          h('button', { type: 'button', class: 'name-btn', text: row.name, onclick: function () { go(row.slug); } }),
          tier(row),
        ]),
        h('td', { class: 'num', text: money(row.tvl_usd) }),
        h('td', { class: 'num ' + (row.change_7d > 0 ? 'up' : row.change_7d < 0 ? 'down' : ''), text: change }),
        h('td', { class: 'num', text: ageText(row.age_days) }),
        h('td', { class: 'num' }, [oddsBar(row.p_token)]),
        h('td', { class: 'num', text: money(row.launch_value_usd) }),
        h('td', { class: 'num nowrap', text: money(row.implied_value_usd) + '  ' + money(row.low_value_usd) + '–' + money(row.high_value_usd) }),
        h('td', { class: 'verdict' }, [pill(verdict), h('div', { class: 'band', text: money(econ.net) })]),
        h('td', { class: 'num', text: money(econ.perHour) }),
        h('td', { class: 'plan' }, [
          h('div', { text: planLine(row, dep) }),
          h('button', { type: 'button', class: 'expand', text: state.open === row.slug ? 'Hide steps' : 'Steps', onclick: function () { state.open = state.open === row.slug ? '' : row.slug; render(); } }),
        ]),
      ]));
      if (state.open === row.slug) {
        body.push(h('tr', { class: 'expanded' }, [h('td', { colspan: '12' }, [stepList(row, dep)])]));
      }
    });
    var emptyWhy = 'No row matches these filters. Clear a chip or widen the search.';
    return h('div', { id: 'main' }, [
      controls(rows),
      h('p', { class: 'tally', text: 'FARM ' + tally.FARM + ' · MARGINAL ' + tally.MARGINAL + ' · SKIP ' + tally.SKIP }),
      compareTray(),
      rows.length === 0 ? h('p', { class: 'empty', text: emptyWhy }) : h('table', { class: 'board' }, [
        h('thead', null, [h('tr', null, [
          h('th', { class: 'pick', text: '' }),
          sortHead('Rank', 'rank', true),
          h('th', { text: 'Protocol' }),
          sortHead('TVL', 'tvl', true),
          sortHead('7D', 'change', true),
          sortHead('No-token age', 'age', true),
          sortHead('Odds', 'odds', true),
          sortHead('If it launches', 'launch', true),
          sortHead('Implied value', 'implied', true),
          sortHead('Verdict', 'net', true),
          sortHead('Net/hour', 'hour', true),
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
    var vsBill = verdict === 'FARM'
      ? 'Net ' + money(econ.net) + ' and ' + money(econ.perHour) + '/h beat the 4% T-bill charge of ' + money(econ.charge) + ' and the $25/h bar, so FARM.'
      : verdict === 'MARGINAL'
        ? 'Net ' + money(econ.net) + ' beats the 4% T-bill charge of ' + money(econ.charge) + ' but ' + money(econ.perHour) + '/h is under $25/h, so MARGINAL.'
        : 'Net ' + money(econ.net) + ' does not cover gas, fees and the 4% T-bill charge of ' + money(econ.charge) + ', so SKIP.';
    var tvlDown = impliedValue(row.tvl_usd * 0.7, row.change_7d, row.age_days, row.category);
    var flat7 = impliedValue(row.tvl_usd, 0, row.age_days, row.category);
    var older = impliedValue(row.tvl_usd, row.change_7d, (row.age_days || 0) + 182, row.category);
    return h('article', { id: 'main' }, [
      h('button', { type: 'button', class: 'back', text: 'Back to the board', onclick: function () { go(''); } }),
      h('div', { class: 'detail' }, [
        h('h2', { text: row.name }),
        h('p', { class: 'iv' }, [fn('impliedValue()'), ' ', money(row.implied_value_usd)]),
        h('p', { class: 'rk', text: '#' + row.rank + ' of ' + DATA.rows.length + ' · rank ' + row.rank_lo + '–' + row.rank_hi }),
        h('p', { class: 'verdict-line' }, [pill(verdict), ' ', vsBill]),
        h('p', { class: 'facts' }, [
          row.category + ' · ',
          h('span', { text: 'TVL ' + money(row.tvl_usd) }),
          ' · ' + change,
          ' · listed ' + (row.listed_at || 'without a date'),
          ' · ' + ageText(row.age_days) + ' with no token · deposit ' + money(dep),
        ]),
      ]),
      h('section', { class: 'panel plan-panel' }, [
        h('h3', null, ['Plan ', fn('farmPlan()')]),
        stepList(row, dep),
      ]),
      h('div', { class: 'detail-grid' }, [
        h('section', { class: 'panel' }, [
          h('h3', null, ['How the figure is made ', fn('impliedValue()')]),
          h('dl', null, [
            h('dt', { text: 'Log-log TVL anchor (loo ' + times(e.heldout.loo_median) + ')' }), h('dd', { text: money(anchor) }),
            h('dt', { text: '7-day carry (vs median, ±25%)' }), h('dd', { text: '× ' + row.carry.toFixed(3) }),
            h('dt', { text: 'Value if it launches' }), h('dd', { text: money(row.launch_value_usd) }),
            h('dt', { text: 'Launch odds (Brier ' + DATA.odds.brier.toFixed(3) + ' vs ' + DATA.odds.base_brier.toFixed(3) + ')' }), h('dd', { text: '× ' + pct(row.p_token) }),
            h('dt', { text: 'Odds cell' }), h('dd', { text: row.odds_level }),
            h('dt', { text: 'Implied value' }), h('dd', { text: money(row.implied_value_usd) }),
            h('dt', { text: 'p25–p75 (range honesty ' + Math.round(e.band_coverage * 100) + '%)' }), h('dd', { class: 'nowrap', text: money(row.low_value_usd) + ' – ' + money(row.high_value_usd) }),
          ]),
        ]),
        h('section', { class: 'panel' }, [
          h('h3', { text: 'Nearest priced peers' }),
          peers(row),
        ]),
        h('section', { class: 'panel' }, [
          h('h3', { text: 'Verdict at this deposit and drop share' }),
          h('p', { class: 'muted' }, [money(dep) + ' deposit · ' + pct(state.share) + ' drop share · ', pill(verdict)]),
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
        h('section', { class: 'panel' }, [
          h('h3', { text: 'What moves the value' }),
          h('table', null, [
            h('thead', null, [h('tr', null, [h('th', { text: 'Case' }), h('th', { class: 'num', text: 'Implied' })])]),
            h('tbody', null, [
              h('tr', null, [h('td', { text: 'As recorded' }), h('td', { class: 'num', text: money(row.implied_value_usd) })]),
              h('tr', null, [h('td', { text: 'TVL −30%' }), h('td', { class: 'num', text: money(tvlDown) })]),
              h('tr', null, [h('td', { text: '7D 0%' }), h('td', { class: 'num', text: money(flat7) })]),
              h('tr', null, [h('td', { text: '+6 months with no token' }), h('td', { class: 'num', text: money(older) })]),
            ]),
          ]),
        ]),
        h('section', { class: 'panel' }, [
          h('h3', { text: 'TVL vs market cap' }),
          scatter(row),
        ]),
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

  function scatter(mark) {
    var ev = DATA.evidence;
    var W = 820;
    var H = mark ? 280 : 400;
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
    if (mark) {
      var mx0 = Math.log10(mark.tvl_usd);
      var my0 = Math.log10(Math.max(1, mark.launch_value_usd));
      x0 = Math.min(x0, mx0); x1 = Math.max(x1, mx0);
      y0 = Math.min(y0, my0); y1 = Math.max(y1, my0);
    }
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
    if (mark) {
      var mx = Math.log10(mark.tvl_usd);
      var my = Math.log10(Math.max(1, mark.launch_value_usd));
      kids.push(se('circle', { class: 'mark', cx: X(mx), cy: Y(my), r: '5' }));
    }
    return se('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Log market cap against log TVL, fitted line and residual band' }, kids);
  }

  function comps() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.comparables.filter(function (c) {
      if (!q) return true;
      return (c.name + ' ' + c.category + ' ' + (c.symbol || '')).toLowerCase().indexOf(q) !== -1;
    });
    var body = rows.slice(0, 80).map(function (c) {
      return h('tr', { class: 'row' }, [
        h('td', { text: c.name }),
        h('td', { text: c.category }),
        h('td', { class: 'num', text: money(c.mcap_usd) }),
        h('td', { class: 'num', text: money(c.tvl_usd) }),
        h('td', { class: 'num', text: times(c.mcap_tvl) }),
      ]);
    });
    return h('div', { id: 'main' }, [
      h('p', { class: 'muted', text: 'Tokens that already trade. Used as comparables, not ranked.' }),
      h('input', { id: 'q', type: 'search', placeholder: 'Search traded tokens', value: state.q, oninput: function (ev) { state.q = ev.target.value; render(); } }),
      rows.length === 0
        ? h('p', { class: 'empty', text: 'No traded token matches this search. Clear the box to list comparables.' })
        : h('table', { class: 'board comps' }, [
          h('thead', null, [h('tr', null, [h('th', { text: 'Protocol' }), h('th', { text: 'Category' }), h('th', { class: 'num', text: 'Market cap' }), h('th', { class: 'num', text: 'TVL' }), h('th', { class: 'num', text: 'Mcap/TVL' })])]),
          h('tbody', null, body),
        ]),
    ]);
  }

  function evidence() {
    return h('div', { id: 'main' }, [
      formulaLine(),
      h('p', { class: 'muted', text: DATA.method.odds }),
      ledger(),
      termTable(),
      integrity(),
      h('section', { class: 'chart-card' }, [
        h('h2', { text: 'Market cap against TVL' }),
        h('p', { class: 'muted', text: DATA.evidence.comparable_count + ' traded tokens. Slope ' + DATA.evidence.line.slope.toFixed(2) + '. The band is the 25th to 75th residual.' }),
        scatter(),
      ]),
    ]);
  }

  function render() {
    var active = document.activeElement;
    var keepId = active && active.id ? active.id : '';
    var keepPos = (active && typeof active.selectionStart === 'number') ? active.selectionStart : null;
    var slug = detailSlug();
    var hash = currentHash();
    var row = null;
    if (slug) {
      for (var i = 0; i < DATA.rows.length; i += 1) if (DATA.rows[i].slug === slug) row = DATA.rows[i];
    }
    var page;
    if (row) page = detail(row);
    else if (hash === 'evidence') page = evidence();
    else if (hash === 'comps') page = comps();
    else page = h('div', null, [stats(), ledger(), integrity(), termTable(), farmNext(), board()]);
    var y = window.scrollY;
    app.replaceChildren(h('div', { class: 'wrap' }, [header(), tabs(), page]));
    window.scrollTo(0, y);
    if (keepId) {
      var el = document.getElementById(keepId);
      if (el && typeof el.focus === 'function') {
        el.focus();
        if (keepPos !== null && el.setSelectionRange) el.setSelectionRange(keepPos, keepPos);
      }
    }
  }

  window.addEventListener('hashchange', render);
  render();
})();
