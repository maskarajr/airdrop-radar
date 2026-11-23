// Token Radar dashboard. Reads window.RADAR from ../data.js. No network, no framework.
// impliedValue, categoryMultiple, growthFactor, maturityFactor and farmPlan are the same
// arithmetic the board was ranked with. renderDetail and renderBoard draw the two views.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) {
    if (app) app.textContent = 'Missing data.js beside dashboard/. Run main.ts, then open this page again.';
    return;
  }

  var GROWTH_FLOOR = -30;
  var GROWTH_CAP = 60;
  var GROWTH_WEIGHT = 0.5;
  var MATURITY_KNOTS = [[0, 0.85], [180, 1], [365, 1.15], [540, 1.12], [1095, 0.9], [1825, 0.72]];
  var BREADTH = [1, 1.03, 1.06, 1.08];
  var SIZE_LOG_LO = 6.7;
  var SIZE_LOG_HI = 10;
  var SIZE_LO = 0.97;
  var SIZE_SPAN = 0.11;

  var state = {
    tab: 'radar',
    sort: 'rank',
    dir: 1,
    q: '',
    category: 'all',
    chain: 'all',
    watchOnly: false,
    tvl: 'all',
    minImplied: 0,
    detail: null,
    tradedSort: 'mcap',
    tradedDir: -1
  };

  function round6(n) { return Math.round(n * 1e6) / 1e6; }

  function growthFactor(change) {
    if (change === null || change === undefined) return 1;
    var g = change;
    if (g < GROWTH_FLOOR) g = GROWTH_FLOOR;
    if (g > GROWTH_CAP) g = GROWTH_CAP;
    return round6(1 + (g / 100) * GROWTH_WEIGHT);
  }

  function maturityFactor(age) {
    if (age === null || age === undefined) return 1;
    var knots = MATURITY_KNOTS;
    if (age <= knots[0][0]) return knots[0][1];
    var last = knots[knots.length - 1];
    if (age >= last[0]) return last[1];
    for (var i = 1; i < knots.length; i++) {
      if (age <= knots[i][0]) {
        var left = knots[i - 1];
        var right = knots[i];
        var t = (age - left[0]) / (right[0] - left[0]);
        return round6(left[1] + (right[1] - left[1]) * t);
      }
    }
    return last[1];
  }

  function breadthFactor(chains) {
    var n = chains && chains.length ? chains.length : 0;
    if (n <= 1) return BREADTH[0];
    if (n === 2) return BREADTH[1];
    if (n === 3) return BREADTH[2];
    return BREADTH[3];
  }

  function sizeFactor(tvl) {
    var log = Math.log10(tvl > 1 ? tvl : 1);
    var t = (log - SIZE_LOG_LO) / (SIZE_LOG_HI - SIZE_LOG_LO);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return round6(SIZE_LO + t * SIZE_SPAN);
  }

  function impliedValue(tvl, multiple, growth, maturity, breadth, size) {
    var n = Math.round(tvl * multiple * growth * maturity * breadth * size);
    if (!isFinite(n) || n < 1) return 1;
    return n;
  }

  function categoryMultiple(category) {
    var rows = DATA.category_multiples;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].category === category) return rows[i];
    }
    return null;
  }

  function farmPlan(row) {
    return row.farm_steps;
  }

  function byCode(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function formatGas(n) {
    if (n < 0.1) return 'under $0.10';
    if (n >= 100) return formatUsd(n);
    return '$' + n.toFixed(2);
  }

  function formatUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var sign = n < 0 ? '-' : '';
    var v = Math.abs(n);
    function trim(x) {
      var s = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
      return s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
    }
    if (v >= 1e9) return sign + '$' + trim(v / 1e9) + 'B';
    if (v >= 1e6) return sign + '$' + trim(v / 1e6) + 'M';
    if (v >= 1e3) return sign + '$' + trim(v / 1e3) + 'K';
    return sign + '$' + String(Math.round(v));
  }

  function formatPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var body = Math.abs(n).toFixed(1);
    if (n > 0) return '+' + body + '%';
    if (n < 0) return '-' + body + '%';
    return '0.0%';
  }

  function formatAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) {
      var y = days / 365;
      var s = y >= 10 ? y.toFixed(0) : y.toFixed(1);
      return s.replace(/\.0$/, '') + 'y';
    }
    return String(days) + 'd';
  }

  function formatMult(n) {
    if (!isFinite(n)) return '—';
    return n.toFixed(2) + 'x';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function uniqSorted(list) {
    var seen = {};
    var out = [];
    list.forEach(function (item) {
      if (!item || seen[item]) return;
      seen[item] = true;
      out.push(item);
    });
    out.sort(byCode);
    return out;
  }

  function categories() {
    return uniqSorted(DATA.rows.map(function (r) { return r.category; }));
  }
  function chains() {
    var all = [];
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { all.push(c); }); });
    return uniqSorted(all);
  }

  function inTvl(tvl) {
    if (state.tvl === 'lt50') return tvl < 50e6;
    if (state.tvl === '50') return tvl >= 50e6 && tvl < 250e6;
    if (state.tvl === '250') return tvl >= 250e6 && tvl < 1e9;
    if (state.tvl === '1b') return tvl >= 1e9;
    return true;
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (!inTvl(r.tvl_usd)) return false;
      if (r.implied_value_usd < state.minImplied) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function valueOf(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'category') return (row.category || '').toLowerCase();
    if (key === 'chain') return (row.primary_chain || '').toLowerCase();
    if (key === 'rank') return row.rank;
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'change') return row.change_7d;
    if (key === 'age') return row.age_days;
    if (key === 'multiple') return row.category_multiple;
    if (key === 'farm') return row.capital_usd;
    return row.implied_value_usd;
  }

  function sorted(list, key, dir) {
    return list.slice().sort(function (a, b) {
      var av = valueOf(a, key);
      var bv = valueOf(b, key);
      var an = av === null || av === undefined;
      var bn = bv === null || bv === undefined;
      if (an || bn) {
        if (an && bn) return byCode(a.slug, b.slug);
        return an ? 1 : -1;
      }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return byCode(a.slug, b.slug);
    });
  }

  function openDetail(slug) {
    state.tab = 'radar';
    state.detail = slug;
    if (history.replaceState) history.replaceState(null, '', '#' + encodeURIComponent(slug));
    render();
  }

  function closeDetail() {
    state.detail = null;
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    render();
  }

  function clearFilters() {
    state.q = '';
    state.category = 'all';
    state.chain = 'all';
    state.watchOnly = false;
    state.tvl = 'all';
    state.minImplied = 0;
    render();
  }

  function header() {
    var c = DATA.counts;
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('div', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null,
          el('h1', { text: 'Token Radar' }),
          el('p', { text: 'Pre-token protocols, ranked by an implied value from this snapshot' })
        )
      ),
      el('div', { class: 'asof' },
        el('div', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('div', { text: c.protocols + ' scanned · ' + c.pre_token + ' record no token' })
      )
    );
  }

  function stats() {
    var c = DATA.counts;
    var g = DATA.global_multiple;
    function stat(label, value) {
      return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { text: value }));
    }
    return el('div', null,
      el('section', { class: 'stats' },
        stat('On the board', String(c.board)),
        stat('Watchlist covered', c.watchlist_on_board + ' / ' + c.watchlist),
        stat('Token already trades', String(c.traded)),
        stat('Global multiple', formatMult(g.multiple))
      ),
      el('p', { class: 'thesis', text: DATA.thesis })
    );
  }

  function tabs() {
    function tab(id, label) {
      return el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': state.tab === id ? 'true' : 'false',
        onclick: function () { state.tab = id; render(); },
        text: label
      });
    }
    return el('div', { class: 'tabs', role: 'tablist' },
      tab('radar', 'Pre-token radar'),
      tab('traded', 'Tokens already trading'),
      tab('method', 'How it works')
    );
  }

  function selectBox(id, label, value, options, onchange) {
    var box = el('select', { id: id, 'aria-label': label, onchange: function () { onchange(box.value); } },
      options.map(function (opt) {
        return el('option', { value: opt[0], text: opt[1], selected: opt[0] === value ? 'selected' : null });
      })
    );
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), box);
  }

  function chips() {
    var items = [];
    function add(label, clear) {
      items.push(el('span', { class: 'chip' }, label, el('button', { type: 'button', text: '×', 'aria-label': 'Remove ' + label, onclick: clear })));
    }
    if (state.q.trim()) add('Search “' + state.q.trim() + '”', function () { state.q = ''; render(); });
    if (state.category !== 'all') add(state.category, function () { state.category = 'all'; render(); });
    if (state.chain !== 'all') add(state.chain, function () { state.chain = 'all'; render(); });
    if (state.watchOnly) add('Watchlist only', function () { state.watchOnly = false; render(); });
    if (state.tvl !== 'all') {
      var tvlLabel = { lt50: 'TVL under $50M', '50': 'TVL $50M–$250M', '250': 'TVL $250M–$1B', '1b': 'TVL $1B+' }[state.tvl];
      add(tvlLabel, function () { state.tvl = 'all'; render(); });
    }
    if (state.minImplied > 0) add('Implied ≥ ' + formatUsd(state.minImplied), function () { state.minImplied = 0; render(); });
    if (items.length === 0) return el('div', { class: 'chips' });
    items.push(el('button', { type: 'button', class: 'text-btn', text: 'Clear', onclick: clearFilters }));
    return el('div', { class: 'chips' }, items);
  }

  function filters(shown, total) {
    var search = el('input', { id: 'q', type: 'search', value: state.q, placeholder: 'Name, slug, category, chain', 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; render(); });
    var watch = el('input', { id: 'watch', type: 'checkbox' });
    watch.checked = state.watchOnly;
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; render(); });
    return el('div', null,
      el('div', { class: 'filters' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        selectBox('category', 'Category', state.category, [['all', 'All categories']].concat(categories().map(function (c) { return [c, c]; })), function (v) { state.category = v; render(); }),
        selectBox('chain', 'Chain', state.chain, [['all', 'All chains']].concat(chains().map(function (c) { return [c, c]; })), function (v) { state.chain = v; render(); }),
        selectBox('tvl', 'TVL band', state.tvl, [['all', 'Any TVL'], ['lt50', 'Under $50M'], ['50', '$50M–$250M'], ['250', '$250M–$1B'], ['1b', '$1B+']], function (v) { state.tvl = v; render(); }),
        selectBox('minv', 'Min implied', String(state.minImplied), [['0', 'Any value'], ['10000000', '≥ $10M'], ['50000000', '≥ $50M'], ['100000000', '≥ $100M'], ['500000000', '≥ $500M']], function (v) { state.minImplied = Number(v); render(); }),
        el('div', { class: 'field check' }, watch, el('label', { for: 'watch', text: 'Watchlist only' })),
        el('div', { class: 'shown', text: shown + ' of ' + total + ' rows' })
      ),
      chips()
    );
  }

  function sortHeader(key, label, numeric) {
    var active = state.sort === key;
    var aria = active ? (state.dir < 0 ? 'descending' : 'ascending') : 'none';
    var mark = active ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return el('th', { scope: 'col', class: numeric ? 'num' : '', 'aria-sort': aria },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else {
          state.sort = key;
          state.dir = key === 'name' || key === 'category' || key === 'chain' || key === 'rank' ? 1 : -1;
        }
        render();
      }, text: label + mark })
    );
  }

  function renderBoard() {
    var list = sorted(filtered(), state.sort, state.dir);
    var body = list.map(function (r) {
      var changeClass = r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d < 0 ? 'down' : r.change_7d > 0 ? 'up' : '';
      var extra = r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '';
      var chain = r.primary_chain + extra;
      if (state.chain !== 'all' && state.chain !== r.primary_chain && (r.chains || []).indexOf(state.chain) >= 0) {
        chain += ' · ' + state.chain;
      }
      return el('tr', {
        class: r.watchlist ? 'is-watch' : '',
        onclick: function () { openDetail(r.slug); }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name', text: r.name }), r.watchlist ? el('span', { class: 'pill', text: 'Watch' }) : null),
        el('td', { text: r.category }),
        el('td', { text: chain }),
        el('td', { class: 'num', text: formatUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + changeClass, text: formatPct(r.change_7d) }),
        el('td', { class: 'num', text: formatAge(r.age_days) }),
        el('td', { class: 'num', text: formatMult(r.category_multiple) }),
        el('td', { class: 'num implied' }, formatUsd(r.implied_value_usd), el('span', { class: 'range', text: formatUsd(r.low_value_usd) + ' – ' + formatUsd(r.high_value_usd) })),
        el('td', { class: 'farm', text: r.farm_headline })
      );
    });
    var table = el('div', { class: 'table-wrap' },
      el('table', null,
        el('thead', null, el('tr', null,
          sortHeader('rank', 'Rank', true),
          sortHeader('name', 'Protocol', false),
          sortHeader('category', 'Category', false),
          sortHeader('chain', 'Chain', false),
          sortHeader('tvl', 'TVL', true),
          sortHeader('change', '7d', true),
          sortHeader('age', 'Age', true),
          sortHeader('multiple', 'Multiple', true),
          sortHeader('implied', 'Implied value', true),
          sortHeader('farm', 'Farm probe', true)
        )),
        el('tbody', null, body.length ? body : el('tr', null, el('td', { class: 'empty', colspan: '10', text: 'No protocols match these filters.' })))
      )
    );
    return el('div', null,
      filters(list.length, DATA.rows.length),
      table,
      el('p', { class: 'foot', text: 'Amber rows are the watchlist. The range under each implied value is the p25–p75 multiple, not a price. Click a row for the factors and the farm plan.' })
    );
  }

  function splitStep(s) {
    var costAt = s.lastIndexOf(' Cost: ');
    var timeAt = s.lastIndexOf(' Time: ');
    if (costAt < 0 || timeAt < costAt) return { text: s, cost: '', time: '' };
    return {
      text: s.slice(0, costAt),
      cost: s.slice(costAt + 7, timeAt).replace(/\.$/, ''),
      time: s.slice(timeAt + 7).replace(/\.$/, '')
    };
  }

  function renderDetail(row) {
    var check = impliedValue(row.tvl_usd, row.category_multiple, row.growth_factor, row.maturity_factor, row.breadth_factor, row.size_factor);
    var mult = categoryMultiple(row.category);
    var source = row.multiple_source === 'global'
      ? 'global median, ' + row.comparable_count + ' traded in category'
      : 'category median, n=' + row.comparable_count;
    function factor(op, label, value) {
      return el('div', { class: 'factor' }, el('span', { class: 'op', text: op }), el('span', { text: label }), el('b', { text: value }));
    }
    var same = DATA.comparables.filter(function (c) { return c.category === row.category; }).slice(0, 5);
    var comp = same.length
      ? el('table', { class: 'mini' },
          el('thead', null, el('tr', null, el('th', { text: 'Comparable' }), el('th', { class: 'num', text: 'Mcap' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Mcap/TVL' }))),
          el('tbody', null, same.map(function (c) {
            return el('tr', null,
              el('td', { text: c.name + (c.symbol ? ' (' + c.symbol + ')' : '') }),
              el('td', { class: 'num', text: formatUsd(c.mcap_usd) }),
              el('td', { class: 'num', text: formatUsd(c.tvl_usd) }),
              el('td', { class: 'num', text: formatMult(c.mcap_tvl) })
            );
          }))
        )
      : el('p', { class: 'foot', text: 'No protocol in this category has a positive market cap. The multiple is the global median.' });
    var steps = farmPlan(row).map(function (raw, i) {
      var part = splitStep(raw);
      return el('div', { class: 'step' },
        el('span', { class: 'n', text: String(i + 1) }),
        el('div', null,
          el('div', { text: part.text }),
          el('div', { class: 'meta', text: 'Cost: ' + part.cost + ' · Time: ' + part.time })
        )
      );
    });
    var chains = (row.chains || []).join(', ') || row.primary_chain;
    return el('article', null,
      el('div', { class: 'detail-head' },
        el('div', null,
          el('p', { class: 'kicker', text: 'Rank ' + row.rank + ' · ' + row.category + ' · ' + row.playbook }),
          el('h2', null, row.name, row.watchlist ? el('span', { class: 'pill', text: 'Watch' }) : null),
          el('p', { class: 'foot', text: chains + ' · listed ' + (row.listed_at || 'unknown') + ' · ' + formatAge(row.age_days) + ' with no token on record' })
        ),
        el('button', { type: 'button', class: 'back', text: 'Back to board', onclick: closeDetail })
      ),
      el('div', { class: 'grid' },
        el('div', null,
          el('section', { class: 'card' },
            el('h3', { text: 'Implied value' }),
            el('div', { class: 'big', text: formatUsd(row.implied_value_usd) }),
            el('p', { class: 'foot', text: 'Low–high ' + formatUsd(row.low_value_usd) + ' – ' + formatUsd(row.high_value_usd) + ' from the p25 and p75 multiples. Board figure ' + (check === row.implied_value_usd ? 'matches the formula.' : 'differs from a recompute (' + formatUsd(check) + ').') }),
            factor('TVL', formatUsd(row.tvl_usd) + ' on record', formatUsd(row.tvl_usd)),
            factor('×', 'Category multiple (' + source + ')', formatMult(row.category_multiple)),
            factor('×', 'Growth from 7d ' + formatPct(row.change_7d), row.growth_factor.toFixed(3)),
            factor('×', 'Maturity, ' + formatAge(row.age_days) + ' with no token', row.maturity_factor.toFixed(3)),
            factor('×', 'Chain breadth, ' + (row.chains.length || 0) + ' chains', row.breadth_factor.toFixed(2)),
            factor('×', 'Size tilt from TVL', row.size_factor.toFixed(3)),
            el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: formatUsd(row.implied_value_usd) }))
          ),
          el('section', { class: 'card', style: 'margin-top:16px' },
            el('h3', { text: 'Comparables in ' + row.category }),
            el('p', { class: 'foot', text: mult && mult.source === 'global' ? 'Under 5 traded tokens in this category, so the row uses the global median ' + formatMult(DATA.global_multiple.multiple) + '.' : 'Median of traded tokens in this category, outliers clipped.' }),
            comp
          ),
          el('section', { class: 'card', style: 'margin-top:16px' },
            el('h3', { text: 'Risk flags' }),
            row.risk_flags.length
              ? el('ul', { class: 'flags' }, row.risk_flags.map(function (f) { return el('li', { text: f }); }))
              : el('p', { class: 'foot', text: 'No extra flag from the model rules. The value is still a model, not a promise.' })
          )
        ),
        el('section', { class: 'card' },
          el('h3', { text: 'Farm plan' }),
          el('p', { class: 'foot', text: row.farm_headline + '. Capital is a probe sized from TVL, not a recommended allocation.' }),
          steps,
          el('div', { class: 'total' },
            el('span', { text: 'Probe total' }),
            el('b', { text: formatUsd(row.capital_usd) + ' capital · ' + formatGas(row.gas_total_usd) + ' gas · ' + row.hold_days + 'd hold' })
          )
        )
      )
    );
  }

  function tradedValue(row, key) {
    if (key === 'name') return row.name.toLowerCase();
    if (key === 'category') return row.category.toLowerCase();
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'change') return row.change_7d;
    if (key === 'ratio') return row.mcap_tvl;
    return row.mcap_usd;
  }

  function renderTraded() {
    var list = DATA.comparables.slice().sort(function (a, b) {
      var av = tradedValue(a, state.tradedSort);
      var bv = tradedValue(b, state.tradedSort);
      var an = av === null || av === undefined;
      var bn = bv === null || bv === undefined;
      if (an || bn) return an === bn ? byCode(a.slug, b.slug) : an ? 1 : -1;
      if (av < bv) return -state.tradedDir;
      if (av > bv) return state.tradedDir;
      return byCode(a.slug, b.slug);
    });
    function th(key, label, numeric) {
      var active = state.tradedSort === key;
      var mark = active ? (state.tradedDir < 0 ? ' ↓' : ' ↑') : '';
      return el('th', { class: numeric ? 'num' : '', 'aria-sort': active ? (state.tradedDir < 0 ? 'descending' : 'ascending') : 'none' },
        el('button', { type: 'button', text: label + mark, onclick: function () {
          if (state.tradedSort === key) state.tradedDir = -state.tradedDir;
          else { state.tradedSort = key; state.tradedDir = key === 'name' || key === 'category' ? 1 : -1; }
          render();
        } })
      );
    }
    return el('div', null,
      el('p', { class: 'banner', text: 'Token already trades. These protocols are the comparables behind the multiples. They are not ranked and they are not farm targets on this board.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            th('name', 'Protocol', false),
            th('category', 'Category', false),
            th('mcap', 'Market cap', true),
            th('tvl', 'TVL', true),
            th('ratio', 'Mcap/TVL', true),
            th('change', '7d', true)
          )),
          el('tbody', null, list.map(function (r) {
            var changeClass = r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d < 0 ? 'down' : 'up';
            return el('tr', null,
              el('td', null, el('span', { class: 'name', text: r.name }), el('span', { class: 'sub', text: r.symbol || r.slug })),
              el('td', { text: r.category }),
              el('td', { class: 'num', text: formatUsd(r.mcap_usd) }),
              el('td', { class: 'num', text: formatUsd(r.tvl_usd) }),
              el('td', { class: 'num', text: formatMult(r.mcap_tvl) }),
              el('td', { class: 'num ' + changeClass, text: formatPct(r.change_7d) })
            );
          }))
        )
      )
    );
  }

  function renderMethod() {
    var g = DATA.global_multiple;
    var multRows = DATA.category_multiples.filter(function (row) {
      return row.sample > 0 || DATA.rows.some(function (r) { return r.category === row.category; });
    });
    return el('div', { class: 'method' },
      el('h3', { text: 'The formula' }),
      el('p', null, el('code', { text: 'impliedValue = round(tvl × categoryMultiple × growthFactor × maturityFactor × breadthFactor × sizeFactor)' })),
      el('p', { text: 'growthFactor is 1 + clamp(change_7d, -30, 60) / 100 × 0.5. A missing 7-day change is 1.' }),
      el('p', { text: 'maturityFactor is piecewise linear through day 0 = 0.85, day 180 = 1.00, day 365 = 1.15, day 540 = 1.12, day 1095 = 0.90, day 1825 = 0.72. A missing listed date is 1. The rise is the 6 to 18 month window. After about 3 years the factor falls, because a token has become less likely.' }),
      el('p', { text: 'breadthFactor is 1.00, 1.03, 1.06 or 1.08 for 1, 2, 3 or 4+ chains. sizeFactor moves from 0.97 near $5M TVL to 1.08 at $10B, on a log scale. TVL already scales the result; size is only a tilt.' }),
      el('h3', { text: 'Category multiples' }),
      el('p', { text: 'categoryMultiple is the median mcap/TVL of protocols in that category with a positive market cap, after clipping to the 5th–95th percentile. Fewer than 5 such tokens, and the row uses the global median. Low and high swap in the 25th and 75th percentiles. Global set: ' + g.sample_positive + ' positive ratios, ' + g.sample_clipped + ' after the clip, median ' + formatMult(g.multiple) + ', p25 ' + formatMult(g.p25) + ', p75 ' + formatMult(g.p75) + '.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'mini' },
          el('thead', null, el('tr', null,
            el('th', { text: 'Category' }),
            el('th', { class: 'num', text: 'Traded' }),
            el('th', { text: 'Source' }),
            el('th', { class: 'num', text: 'p25' }),
            el('th', { class: 'num', text: 'Median' }),
            el('th', { class: 'num', text: 'p75' })
          )),
          el('tbody', null, multRows.map(function (row) {
            return el('tr', null,
              el('td', { text: row.category }),
              el('td', { class: 'num', text: String(row.sample) }),
              el('td', { text: row.source }),
              el('td', { class: 'num', text: formatMult(row.p25) }),
              el('td', { class: 'num', text: formatMult(row.multiple) }),
              el('td', { class: 'num', text: formatMult(row.p75) })
            );
          }))
        )
      ),
      el('h3', { text: 'Who is ranked' }),
      el('p', { text: 'The board ranks protocols that record no token: gecko_id and symbol are both null. A protocol with a positive market cap is a comparable whose token already trades, and it is not ranked. Every watchlist slug is included. Other rows drop CEX, bridges, liquid staking, liquid restaking, stablecoin wrappers, versioned names, and names that say wrapped, staked or bridged.' }),
      el('h3', { text: 'Farm costs' }),
      el('p', { text: 'Each plan has a dollar cost and a time. Capital is a probe by TVL tier: $50 under $10M, $100 under $50M, $250 under $250M, $500 under $1B, $1,000 under $5B, $2,000 above that. Gas is one simple transaction on the chain below. Anything not listed is $' + DATA.gas_default_usd.toFixed(2) + '. The hold follows the maturity curve: 45 days under 6 months, 30 days inside 6 to 18 months, 21 days until 3 years, 14 days after, 21 days if the listed date is missing.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'mini' },
          el('thead', null, el('tr', null, el('th', { text: 'Chain' }), el('th', { class: 'num', text: 'Gas / tx' }))),
          el('tbody', null, DATA.gas_table.map(function (gRow) {
            var label = gRow.usd_per_tx < 0.1 ? 'under $0.10' : gRow.usd_per_tx >= 1 ? formatUsd(gRow.usd_per_tx) : '$' + gRow.usd_per_tx.toFixed(2);
            return el('tr', null, el('td', { text: gRow.chain }), el('td', { class: 'num', text: label }));
          }))
        )
      ),
      el('h3', { text: 'Caveats' }),
      el('ul', { class: 'flags' }, DATA.method.caveats.map(function (line) { return el('li', { text: line }); }))
    );
  }

  function shell() {
    var main = el('main', { id: 'main', tabindex: '-1' });
    if (state.tab === 'traded') main.appendChild(renderTraded());
    else if (state.tab === 'method') main.appendChild(renderMethod());
    else if (state.detail) {
      var row = null;
      for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.detail) row = DATA.rows[i];
      main.appendChild(row ? renderDetail(row) : renderBoard());
    } else main.appendChild(renderBoard());
    if (state.tab === 'radar' && state.detail) return el('div', { class: 'wrap' }, header(), tabs(), main);
    return el('div', { class: 'wrap' }, header(), stats(), tabs(), main);
  }

  function render() {
    var focusId = document.activeElement && document.activeElement.id;
    var pos = focusId === 'q' && document.activeElement.selectionStart !== null ? document.activeElement.selectionStart : null;
    app.textContent = '';
    app.appendChild(shell());
    if (focusId) {
      var next = document.getElementById(focusId);
      if (next) {
        next.focus();
        if (pos !== null && next.setSelectionRange) next.setSelectionRange(pos, pos);
      }
    }
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.detail) closeDetail();
  });

  function detailFromHash() {
    var hash = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (hash && DATA.rows.some(function (r) { return r.slug === hash; })) {
      state.tab = 'radar';
      state.detail = hash;
      return true;
    }
    return false;
  }
  if (!detailFromHash() && DATA.rows.length) state.detail = DATA.rows[0].slug;
  window.addEventListener('hashchange', function () {
    if (detailFromHash()) render();
  });
  render();
})();
