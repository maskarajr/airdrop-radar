(function () {
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  var state = { tab: 'board', q: '', category: '', chain: '', watch: false, sort: 'rank', dir: 1 };

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

  function times(n) {
    return n === null || n === undefined ? '—' : n.toFixed(2) + '×';
  }

  function changeText(n) {
    if (n === null || n === undefined) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(1) + '%';
  }

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
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
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (kid) { if (kid) node.append(kid); });
    return node;
  }

  function impliedValue(tvl) {
    var e = DATA.evidence;
    var log = e.beta[0] + e.beta[1] * (Math.log(tvl) - e.center_log_tvl);
    var n = Math.round(Math.exp(log));
    if (!isFinite(n) || n < 1) return 1;
    if (n > 1e14) return 1e14;
    return n;
  }

  function go(hash) {
    var next = hash ? '#' + hash : '';
    if (location.hash === next || (hash === '' && (location.hash === '' || location.hash === '#'))) {
      render();
      return;
    }
    location.hash = hash;
  }

  function currentHash() {
    return decodeURIComponent(location.hash.replace(/^#/, ''));
  }

  function detailSlug() {
    var hash = currentHash();
    if (!hash || hash === 'evidence' || hash === 'traded' || hash === 'board') return null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === hash) return hash;
    return null;
  }

  function integrity() {
    var rows = DATA.rows;
    var ranks = true;
    var order = true;
    var fit = true;
    var steps = true;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.rank !== i + 1) ranks = false;
      if (i > 0 && row.implied_value_usd > rows[i - 1].implied_value_usd) order = false;
      if (impliedValue(row.tvl_usd) !== row.implied_value_usd) fit = false;
      if (row.farm_steps.length < 4 || row.farm_steps.length > 8) steps = false;
      for (var s = 0; s < row.farm_steps.length; s++) {
        var n = row.farm_steps[s].trim().length;
        if (n < 20 || n > 600) steps = false;
      }
    }
    var have = {};
    rows.forEach(function (row) { have[row.slug] = true; });
    var watch = 0;
    DATA.watchlist.forEach(function (slug) { if (have[slug]) watch += 1; });
    var watchOk = watch === DATA.watchlist.length && DATA.watchlist.length === 40;
    var total = 0;
    DATA.ledger.forEach(function (seg) { total += seg.count; });
    var checks = [
      [ranks, 'Ranks 1–' + rows.length],
      [order, 'Values never rise'],
      [watchOk, 'Watchlist ' + watch + '/' + DATA.watchlist.length],
      [steps, 'Steps 4–8, 20–600 characters'],
      [total === DATA.counts.protocols, 'Ledger ' + total + '/' + DATA.counts.protocols],
      [fit, 'Fit matches every value'],
    ];
    return h('ul', { class: 'ticks' }, checks.map(function (c) {
      return h('li', { class: c[0] ? 'ok' : 'bad', text: c[1] });
    }));
  }

  function header() {
    return h('header', { class: 'top' }, [
      h('div', null, [
        h('h1', { text: 'Token radar' }),
        h('p', { class: 'note', text: 'Rank is the log-log fit on traded tokens. Family, growth and age were tested and not kept. The mean miss is higher because a few tokens sit far from the line.' }),
      ]),
      h('div', { class: 'asof', text: 'Snapshot ' + DATA.as_of }),
    ]);
  }

  function stats() {
    var ev = DATA.evidence;
    var odds = DATA.odds;
    var items = [
      ['lead', 'Leave-one-out miss', times(ev.heldout.loo_median), 'Mean ' + times(ev.heldout.loo_mean) + ' · plain model ' + times(ev.baseline.median)],
      ['', 'Walk-forward miss', times(ev.heldout.walk_median), 'Mean ' + times(ev.heldout.walk_mean) + ' · plain model ' + times(ev.baseline.walk_median)],
      ['', 'Odds, held-out half', odds.auc.toFixed(2) + ' AUC', 'Brier ' + odds.brier.toFixed(3) + ' vs base ' + odds.base_brier.toFixed(3)],
      ['', 'On this board', String(DATA.verdicts.FARM) + ' farm', DATA.verdicts.MARGINAL + ' marginal · ' + DATA.verdicts.SKIP + ' skip'],
    ];
    return h('section', { class: 'stats', 'aria-label': 'Held-out results' }, items.map(function (item) {
      return h('div', { class: 'stat ' + item[0] }, [
        h('span', { class: 'k', text: item[1] }),
        h('span', { class: 'n', text: item[2] }),
        h('span', { class: 's', text: item[3] }),
      ]);
    }));
  }

  function tabs() {
    var hash = currentHash();
    var tab = detailSlug() ? 'board' : hash === 'evidence' || hash === 'traded' ? hash : 'board';
    var items = [['board', 'Board'], ['evidence', 'Evidence'], ['traded', 'Trading tokens']];
    return h('nav', { class: 'tabs', 'aria-label': 'Views' }, items.map(function (item) {
      return h('button', {
        type: 'button',
        'data-tab': item[0],
        'aria-selected': tab === item[0] ? 'true' : 'false',
        text: item[1],
        onclick: function () { go(item[0] === 'board' ? '' : item[0]); },
      });
    }));
  }

  function pill(verdict) {
    return h('span', { class: 'pill ' + verdict.toLowerCase(), text: verdict });
  }

  function farmNext() {
    var picks = DATA.rows.filter(function (row) { return row.verdict === 'FARM'; }).slice(0, 3);
    var body = picks.length === 0
      ? h('p', { class: 'muted', text: 'No row clears the farm bar.' })
      : h('div', { class: 'next-row' }, picks.map(function (row) {
        return h('button', { type: 'button', onclick: function () { go(row.slug); } }, [
          h('span', { class: 'name', text: row.name }),
          h('span', { class: 'meta', text: row.category + ' · rank ' + row.rank }),
          pill(row.verdict),
          h('span', { class: 'meta', text: pct(row.p_token) + ' odds · ' + money(row.implied_value_usd) + ' implied · net ' + money(row.net_usd) }),
        ]);
      }));
    return h('section', { class: 'next' }, [
      h('h2', { text: 'Farm next' }),
      h('p', { class: 'muted', text: 'The three highest-ranked FARM rows. The filter below does not change this list.' }),
      body,
    ]);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.category && row.category !== state.category) return false;
      if (state.chain && row.chains.indexOf(state.chain) === -1) return false;
      if (state.watch && !row.watchlist) return false;
      if (!q) return true;
      return (row.name + ' ' + row.slug + ' ' + row.category).toLowerCase().indexOf(q) !== -1;
    });
  }

  function sorted(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av;
      var bv;
      if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'odds') { av = a.p_token; bv = b.p_token; }
      else if (key === 'ev') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      if (a.slug < b.slug) return -1;
      if (a.slug > b.slug) return 1;
      return 0;
    });
  }

  function rangeBar(row) {
    var lo = Math.log(row.low_value_usd);
    var hi = Math.log(row.high_value_usd);
    var mid = Math.log(row.implied_value_usd);
    var t = hi === lo ? 0.5 : (mid - lo) / (hi - lo);
    var cx = (2 + Math.min(1, Math.max(0, t)) * 60).toFixed(1);
    return se('svg', { class: 'range', viewBox: '0 0 64 8', width: '64', height: '8', 'aria-hidden': 'true' }, [
      se('line', { x1: '2', y1: '4', x2: '62', y2: '4' }),
      se('circle', { cx: cx, cy: '4', r: '2.4' }),
    ]);
  }

  function chainLabel(row) {
    var primary = row.primary_chain || row.chains[0] || '—';
    if (state.chain && state.chain !== primary && row.chains.indexOf(state.chain) !== -1) return primary + ' · ' + state.chain;
    return primary;
  }

  function filters(shown, total) {
    var categories = [];
    var chains = [];
    var seenC = {};
    var seenH = {};
    DATA.rows.forEach(function (row) {
      if (!seenC[row.category]) { seenC[row.category] = true; categories.push(row.category); }
      row.chains.forEach(function (chain) { if (!seenH[chain]) { seenH[chain] = true; chains.push(chain); } });
    });
    categories.sort();
    chains.sort();
    var active = state.q || state.category || state.chain || state.watch;
    return h('div', { class: 'filters' }, [
      h('input', {
        id: 'q', type: 'search', placeholder: 'Search protocols', value: state.q,
        oninput: function (ev) { state.q = ev.target.value; render(); },
      }),
      h('select', {
        id: 'category',
        onchange: function (ev) { state.category = ev.target.value; render(); },
      }, [h('option', { value: '', text: 'All categories' })].concat(categories.map(function (c) {
        return h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null });
      }))),
      h('select', {
        id: 'chain',
        onchange: function (ev) { state.chain = ev.target.value; render(); },
      }, [h('option', { value: '', text: 'All chains' })].concat(chains.map(function (c) {
        return h('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null });
      }))),
      h('button', {
        type: 'button', class: 'chip', 'aria-pressed': state.watch ? 'true' : 'false', text: 'Watchlist',
        onclick: function () { state.watch = !state.watch; render(); },
      }),
      active ? h('button', {
        type: 'button', class: 'chip', text: 'Clear',
        onclick: function () { state.q = ''; state.category = ''; state.chain = ''; state.watch = false; render(); },
      }) : null,
      h('span', { class: 'shown', text: shown + ' of ' + total }),
    ]);
  }

  function sortHeader(key, label, numeric) {
    var on = state.sort === key;
    var mark = on ? (state.dir > 0 ? ' ↑' : ' ↓') : '';
    return h('th', { class: numeric ? 'num' : '', scope: 'col' }, [
      h('button', {
        type: 'button',
        text: label + mark,
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
          render();
        },
      }),
    ]);
  }

  function board() {
    var rows = sorted(filteredRows());
    var body = rows.map(function (row) {
      return h('tr', { class: row.watchlist ? 'watch' : '' }, [
        h('td', { class: 'num', text: String(row.rank) }),
        h('td', null, [
          h('button', { type: 'button', class: 'name-btn', text: row.name, onclick: function () { go(row.slug); } }),
          h('span', { class: 'tag', text: row.category + (row.watchlist ? ' · Watch' : '') }),
        ]),
        h('td', { text: chainLabel(row) }),
        h('td', { class: 'num', text: money(row.tvl_usd) }),
        h('td', { class: 'num' }, [
          h('div', { class: 'val', text: money(row.implied_value_usd) }),
          rangeBar(row),
          h('div', { class: 'band', text: money(row.low_value_usd) + ' – ' + money(row.high_value_usd) }),
        ]),
        h('td', { class: 'num' }, [
          h('div', { class: 'val', text: pct(row.p_token) }),
          h('div', { class: 'band', text: row.odds_tier }),
        ]),
        h('td', null, [pill(row.verdict)]),
        h('td', { class: 'num', text: money(row.expected_value_usd) }),
      ]);
    });
    return h('div', { id: 'main' }, [
      farmNext(),
      filters(rows.length, DATA.rows.length),
      rows.length === 0
        ? h('p', { class: 'empty', text: 'Nothing matches this filter.' })
        : h('div', { class: 'table-wrap' }, [
          h('table', null, [
            h('thead', null, [h('tr', null, [
              sortHeader('rank', 'Rank', true),
              h('th', { scope: 'col', text: 'Protocol' }),
              h('th', { scope: 'col', text: 'Chain' }),
              sortHeader('tvl', 'TVL', true),
              sortHeader('implied', 'Implied value', true),
              sortHeader('odds', 'Odds', true),
              h('th', { scope: 'col', text: 'Verdict' }),
              sortHeader('ev', 'Expected value', true),
            ])]),
            h('tbody', null, body),
          ]),
        ]),
    ]);
  }

  function splitStep(text) {
    var at = text.indexOf(' Cost: ');
    if (at === -1) return { act: text, when: '' };
    return { act: text.slice(0, at), when: text.slice(at + 1) };
  }

  function detail(row) {
    var comps = DATA.comparables.filter(function (c) { return c.category === row.category; }).slice(0, 5);
    var ev = DATA.evidence;
    var slope = ev.line.slope;
    return h('article', { class: 'detail', id: 'main' }, [
      h('div', { class: 'detail-head' }, [
        h('button', { type: 'button', class: 'back', text: 'Back to the board', onclick: function () { go(''); } }),
        h('h2', { text: row.name }),
        h('p', { class: 'muted', text: row.category + ' · ' + (row.chains.join(', ') || 'no chain') + ' · ' + row.playbook }),
      ]),
      h('div', { class: 'figures' }, [
        h('div', { class: 'stat lead' }, [h('span', { class: 'k', text: 'Implied value' }), h('span', { class: 'n', text: money(row.implied_value_usd) }), h('span', { class: 's', text: money(row.low_value_usd) + ' – ' + money(row.high_value_usd) })]),
        h('div', { class: 'stat' }, [h('span', { class: 'k', text: 'P(token)' }), h('span', { class: 'n', text: pct(row.p_token) }), h('span', { class: 's', text: row.odds_tier + ' · ' + row.odds_level })]),
        h('div', { class: 'stat' }, [h('span', { class: 'k', text: 'Expected value' }), h('span', { class: 'n', text: money(row.expected_value_usd) }), h('span', { class: 's', text: 'Implied value × odds' })]),
        h('div', { class: 'stat' }, [h('span', { class: 'k', text: 'Farm net' }), h('span', { class: 'n', text: money(row.net_usd) }), h('span', { class: 's', text: money(row.per_hour_usd) + '/hour · ' + pillText(row) })]),
      ]),
      h('section', { class: 'factors' }, [
        h('h3', { text: 'Why this value' }),
        h('dl', null, [
          h('dt', { text: 'log TVL elasticity' }), h('dd', { text: slope.toFixed(2) + ', kept' }),
          h('dt', { text: 'Family, growth, age' }), h('dd', { text: 'tested, not kept' }),
          h('dt', { text: 'TVL on record' }), h('dd', { text: money(row.tvl_usd) }),
          h('dt', { text: 'Fitted value' }), h('dd', { text: money(row.implied_value_usd) }),
          h('dt', { text: 'p25–p75 band' }), h('dd', { text: money(row.low_value_usd) + ' – ' + money(row.high_value_usd) }),
          h('dt', { text: 'Plain category median' }), h('dd', { text: money(row.plain_value_usd) }),
          h('dt', { text: 'Median source' }), h('dd', { text: row.multiple_source + ', n=' + row.comparable_count }),
        ]),
        h('p', { text: 'The plain median is the comparison model. Rank uses the fit, which depends only on TVL. ' + (row.risk_flags[0] || 'No extra flag on this row.') }),
      ]),
      h('section', { class: 'cost' }, [
        h('h3', { text: 'Odds and the costed plan' }),
        h('dl', null, [
          h('dt', { text: 'P(token)' }), h('dd', { text: pct(row.p_token) + ' ' + row.odds_tier }),
          h('dt', { text: 'Smoothed from' }), h('dd', { text: row.odds_level }),
          h('dt', { text: 'Category cell' }), h('dd', { text: String(row.odds_cell) }),
          h('dt', { text: 'Deposit' }), h('dd', { text: money(row.deposit_usd) }),
          h('dt', { text: 'Minimum deposit' }), h('dd', { text: money(row.min_deposit_usd) }),
          h('dt', { text: 'Gas' }), h('dd', { text: money(row.gas_total_usd) }),
          h('dt', { text: 'Fees (' + pct(row.fee_rate) + ')' }), h('dd', { text: money(row.fee_usd) }),
          h('dt', { text: 'Capital charge, 4%' }), h('dd', { text: money(row.capital_charge_usd) }),
          h('dt', { text: 'Net' }), h('dd', { text: money(row.net_usd) }),
          h('dt', { text: 'Per hour' }), h('dd', { text: money(row.per_hour_usd) }),
          h('dt', { text: 'Break-even' }), h('dd', { text: pct(row.breakeven) }),
          h('dt', { text: 'Hold' }), h('dd', { text: row.hold_days + ' days' }),
          h('dt', { text: 'Verdict' }), h('dd', null, [pill(row.verdict)]),
        ]),
        h('p', { text: row.farm_headline }),
      ]),
      h('section', { class: 'comps' }, [
        h('h3', { text: 'Traded tokens in ' + row.category }),
        comps.length === 0
          ? h('p', { text: 'No traded token in this category. The plain median falls back to the family or the global set.' })
          : h('table', null, [
            h('thead', null, [h('tr', null, [
              h('th', { text: 'Token' }), h('th', { class: 'num', text: 'Market cap' }), h('th', { class: 'num', text: 'TVL' }), h('th', { class: 'num', text: 'mcap/TVL' }),
            ])]),
            h('tbody', null, comps.map(function (c) {
              return h('tr', null, [
                h('td', { text: c.name }),
                h('td', { class: 'num', text: money(c.mcap_usd) }),
                h('td', { class: 'num', text: money(c.tvl_usd) }),
                h('td', { class: 'num', text: c.mcap_tvl.toFixed(2) }),
              ]);
            })),
          ]),
      ]),
      h('ol', { class: 'steps' }, row.farm_steps.map(function (text, i) {
        var parts = splitStep(text);
        return h('li', null, [
          h('h3', { text: 'Step ' + (i + 1) }),
          h('p', { class: 'act', text: parts.act }),
          parts.when ? h('p', { class: 'when', text: parts.when }) : null,
        ]);
      })),
    ]);
  }

  function pillText(row) {
    return row.verdict;
  }

  function logLabel(p) {
    var v = Math.pow(10, p);
    if (Math.abs(v) >= 1e12) return '$' + Math.round(v / 1e12) + 'T';
    if (v >= 1e9) return '$' + Math.round(v / 1e9) + 'B';
    if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }

  function scatter() {
    var ev = DATA.evidence;
    var W = 820;
    var H = 360;
    var L = 56;
    var R = 16;
    var T = 12;
    var B = 32;
    var pts = ev.scatter.map(function (p) { return { x: Math.log10(p.tvl), y: Math.log10(p.mcap) }; });
    var x0 = pts[0].x;
    var x1 = x0;
    var y0 = pts[0].y;
    var y1 = y0;
    function lineY(x) { return ev.line.intercept + ev.line.slope * x; }
    pts.forEach(function (p) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y, lineY(p.x) + ev.band.low);
      y1 = Math.max(y1, p.y, lineY(p.x) + ev.band.high);
    });
    x0 -= 0.12;
    x1 += 0.12;
    var yPad = (y1 - y0) * 0.08;
    y0 -= yPad;
    y1 += yPad;
    function X(x) { return (L + ((x - x0) / (x1 - x0)) * (W - L - R)).toFixed(1); }
    function Y(y) { return (T + ((y1 - y) / (y1 - y0)) * (H - T - B)).toFixed(1); }
    var kids = [];
    for (var tick = Math.ceil(x0); tick <= Math.floor(x1); tick++) {
      kids.push(se('line', { class: 'grid', x1: X(tick), y1: String(T), x2: X(tick), y2: String(H - B) }));
      kids.push(se('text', { x: X(tick), y: String(H - 10), 'text-anchor': 'middle', text: logLabel(tick) }));
    }
    for (var ytick = Math.ceil(y0); ytick <= Math.floor(y1); ytick++) {
      kids.push(se('line', { class: 'grid', x1: String(L), y1: Y(ytick), x2: String(W - R), y2: Y(ytick) }));
      kids.push(se('text', { x: String(L - 8), y: String(Number(Y(ytick)) + 4), 'text-anchor': 'end', text: logLabel(ytick) }));
    }
    var hi = function (x) { return X(x) + ',' + Y(lineY(x) + ev.band.high); };
    var lo = function (x) { return X(x) + ',' + Y(lineY(x) + ev.band.low); };
    kids.push(se('polygon', { class: 'band', points: [hi(x0), hi(x1), lo(x1), lo(x0)].join(' ') }));
    pts.forEach(function (p) {
      kids.push(se('circle', { class: 'dot', cx: X(p.x), cy: Y(p.y), r: '2.6' }));
    });
    kids.push(se('line', { class: 'fit', x1: X(x0), y1: Y(lineY(x0)), x2: X(x1), y2: Y(lineY(x1)) }));
    return se('svg', {
      class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Log market cap against log TVL, fitted line and residual band',
    }, kids);
  }

  function topBars() {
    var rows = DATA.rows.slice(0, 10);
    var max = rows[0].implied_value_usd;
    var W = 360;
    var rowH = 26;
    var H = rows.length * rowH;
    var kids = [];
    rows.forEach(function (row, i) {
      var y = i * rowH + 4;
      var w = Math.max(4, (row.implied_value_usd / max) * 120);
      var name = row.name.length > 14 ? row.name.slice(0, 13) + '…' : row.name;
      kids.push(se('text', { x: '0', y: String(y + 12), text: name }));
      kids.push(se('rect', { class: 'bar' + (i === 0 ? ' lead' : ''), x: '108', y: String(y), width: w.toFixed(1), height: '10', rx: '1' }));
      kids.push(se('text', { x: (114 + w).toFixed(1), y: String(y + 10), text: money(row.implied_value_usd) }));
    });
    return se('svg', { class: 'bars', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Ten largest implied values' }, kids);
  }

  function ledger() {
    var segs = DATA.ledger;
    var total = 0;
    segs.forEach(function (seg) { total += seg.count; });
    var greys = ['#3a3a3a', '#555555', '#707070', '#8a8a8a', '#2f2f2f', '#464646'];
    var x = 0;
    var rects = segs.map(function (seg, i) {
      var w = (seg.count / total) * 1000;
      var fill = seg.label === 'Ranked' ? '#e0a15c' : greys[(i - 1) % greys.length];
      var rect = se('rect', { x: x.toFixed(2), y: '0', width: Math.max(w, 0.5).toFixed(2), height: '16', fill: fill });
      x += w;
      return rect;
    });
    var chart = se('svg', { class: 'stack', viewBox: '0 0 1000 16', role: 'img', 'aria-label': 'Every protocol in the snapshot' }, rects);
    var legend = h('ul', { class: 'legend' }, segs.map(function (seg, i) {
      var fill = seg.label === 'Ranked' ? '#e0a15c' : greys[(i + greys.length - 1) % greys.length];
      return h('li', null, [
        h('span', { class: 'swatch', style: 'background:' + fill }),
        seg.label + ' ' + seg.count,
      ]);
    }));
    return h('section', { class: 'ledger' }, [
      h('h2', { text: 'Where all ' + total + ' protocols went' }),
      chart,
      legend,
    ]);
  }

  function evidence() {
    var ev = DATA.evidence;
    var terms = h('table', null, [
      h('thead', null, [h('tr', null, [
        h('th', { text: 'Term' }),
        h('th', { text: 'Decision' }),
        h('th', { class: 'num', text: 'Leave-one-out median' }),
        h('th', { class: 'num', text: 'Leave-one-out mean' }),
        h('th', { class: 'num', text: 'Walk-forward median' }),
        h('th', { class: 'num', text: 'Walk-forward mean' }),
        h('th', { class: 'num', text: 'Previous medians' }),
      ])]),
      h('tbody', null, [h('tr', null, [
        h('td', { text: 'Category median' }),
        h('td', { text: 'Baseline' }),
        h('td', { class: 'num', text: times(ev.baseline.median) }),
        h('td', { class: 'num', text: times(ev.baseline.mean) }),
        h('td', { class: 'num', text: times(ev.baseline.walk_median) }),
        h('td', { class: 'num', text: times(ev.baseline.walk_mean) }),
        h('td', { class: 'num', text: '—' }),
      ])].concat(ev.terms.map(function (term) {
        return h('tr', null, [
          h('td', { text: term.term }),
          h('td', { class: term.kept ? 'kept' : 'drop', text: term.kept ? 'Kept' : 'Not kept' }),
          h('td', { class: 'num', text: times(term.loo_median) }),
          h('td', { class: 'num', text: times(term.loo_mean) }),
          h('td', { class: 'num', text: times(term.walk_median) }),
          h('td', { class: 'num', text: times(term.walk_mean) }),
          h('td', { class: 'num', text: times(term.against_loo_median) + ' · ' + times(term.against_walk_median) }),
        ]);
      }))),
    ]);
    return h('div', { class: 'evidence', id: 'main' }, [
      h('section', { class: 'chart-card' }, [
        h('h2', { text: 'Market cap against TVL' }),
        h('p', { class: 'muted', text: ev.comparable_count + ' traded tokens. The line is the kept fit, slope ' + ev.line.slope.toFixed(2) + '. The band is the 25th to 75th residual.' }),
        scatter(),
      ]),
      h('section', { class: 'side-card' }, [
        h('h2', { text: 'Largest fitted values' }),
        h('p', { class: 'muted', text: 'Top 10 on the board. Same order as rank.' }),
        topBars(),
      ]),
      h('section', { class: 'term-wrap' }, [
        h('h2', { text: 'What the held-out test kept' }),
        h('p', { class: 'muted', text: 'A term is kept only when both medians fall. Walk-forward trains through ' + ev.walk_cutoff + ' (' + ev.walk_train + ' tokens) and tests ' + ev.walk_test + ' listed after that.' }),
        terms,
      ]),
      ledger(),
      h('section', { class: 'method' }, [
        h('p', { text: DATA.method.thesis }),
        h('p', { text: DATA.method.odds + ' ' + DATA.method.farm }),
        h('p', { text: DATA.method.caveats.join(' ') }),
      ]),
    ]);
  }

  function traded() {
    var rows = DATA.comparables.slice(0, 40);
    return h('div', { id: 'main' }, [
      h('p', { class: 'note', text: 'These tokens already trade. They train the fit and stay off the ranked board. Showing 40 of ' + DATA.comparables.length + ', largest market cap first.' }),
      h('div', { class: 'table-wrap' }, [
        h('table', null, [
          h('thead', null, [h('tr', null, [
            h('th', { text: 'Protocol' }), h('th', { text: 'Category' }),
            h('th', { class: 'num', text: 'Market cap' }), h('th', { class: 'num', text: 'TVL' }), h('th', { class: 'num', text: 'mcap/TVL' }),
          ])]),
          h('tbody', null, rows.map(function (row) {
            return h('tr', null, [
              h('td', { text: row.name }),
              h('td', { text: row.category }),
              h('td', { class: 'num', text: money(row.mcap_usd) }),
              h('td', { class: 'num', text: money(row.tvl_usd) }),
              h('td', { class: 'num', text: row.mcap_tvl.toFixed(2) }),
            ]);
          })),
        ]),
      ]),
    ]);
  }

  function render() {
    var slug = detailSlug();
    var hash = currentHash();
    var row = null;
    if (slug) {
      for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) row = DATA.rows[i];
    }
    var body;
    if (row) body = detail(row);
    else if (hash === 'evidence') body = evidence();
    else if (hash === 'traded') body = traded();
    else body = board();
    var chrome = row ? [header(), tabs()] : [header(), stats(), integrity(), tabs()];
    app.replaceChildren(h('div', { class: 'wrap' }, chrome.concat([body])));
    var q = document.getElementById('q');
    if (q && state.q) q.focus();
  }

  window.addEventListener('hashchange', render);
  render();
})();
