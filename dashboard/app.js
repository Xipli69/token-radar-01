// Sonar — the token launch radar page. It renders window.RADAR (written beside dashboard/
// by main.ts from the same board board.json carries) as a sortable, filterable board with a
// per-protocol detail view, a live-token view of the calibration set, and a model panel that
// shows the calibration table and lets a reader stress the two softest constants. The page
// makes no request of its own: every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = {
    q: '', category: 'all', chain: 'all', watchOnly: false, minTvl: 0,
    tab: 'board', sort: 'implied', dir: -1, selected: null,
    gw: M.growth_weight, scale: 1
  };
  var sandbox = function () { return state.gw !== M.growth_weight || state.scale !== 1; };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // The model's arithmetic, mirrored from lib/model.ts so the page can re-derive a row.
  // At the stated constants (growth weight and scale untouched) this is the number
  // board.json carries; the sliders below move it on purpose, and say so.
  function impliedOf(row, gw, scale) {
    var growthMult = 1 + (row.growth_pct / 100) * gw;
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult * row.maturity_multiplier * row.breadth_multiplier * scale));
  }
  function shownImplied(row) { return sandbox() ? impliedOf(row, state.gw, state.scale) : row.implied_value_usd; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'multiple') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = shownImplied(a); bv = shownImplied(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, 'SONAR ', el('em', { text: 'token launch radar' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'model ', el('b', { text: DATA.model_version })),
        el('span', null, 'source ', el('b', { text: 'DefiLlama protocols' }))
      )
    );
  }

  function lede() {
    var totalTvl = DATA.rows.reduce(function (s, r) { return s + r.tvl_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'Every pre-token protocol, ranked by ', el('span', { class: 'hl', text: 'what its launch would be worth' }), '.'),
        el('p', { text: 'Sonar prices a protocol with no token from the protocols that already trade: each category is priced at the median market-cap-to-TVL its traded peers actually fetch, then adjusted for momentum, maturity and chain breadth. The watchlist is the floor — all ' + DATA.watchlist_size + ' of its protocols are here — and the early radar adds every other launch candidate below it. Wrapped, staked and bridged products of tokens that already trade (' + DATA.wrapper_size + ' of them, WBTC and USDT0 among them) are set aside: they are not waiting on a launch. Records no token is DefiLlama\u2019s record, not proof; implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'TVL under the radar' }), el('b', { text: fmtUsd(totalTvl) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function selectField(id, label, values, current, onChange) {
      var sel = el('select', { id: id, 'aria-label': label },
        el('option', { value: 'all', text: label === 'Category' ? 'All categories' : 'All chains' }),
        values.map(function (v) { return el('option', { value: v, text: v, selected: v === current ? 'selected' : null }); })
      );
      sel.addEventListener('change', function () { onChange(sel.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), sel);
    }
    var minSel = el('select', { id: 'mintvl', 'aria-label': 'Minimum TVL' },
      [[0, 'Any TVL'], [1e7, '$10M and up'], [5e7, '$50M and up'], [2e8, '$200M and up'], [1e9, '$1B and up']].map(function (pair) {
        return el('option', { value: String(pair[0]), text: pair[1], selected: state.minTvl === pair[0] ? 'selected' : null });
      })
    );
    minSel.addEventListener('change', function () { state.minTvl = Number(minSel.value); render(); });
    var watch = el('input', { type: 'checkbox', id: 'watchonly' });
    if (state.watchOnly) watch.setAttribute('checked', '');
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });
    var boardTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live tokens (' + DATA.live_total + ')', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', categories, state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain', chains, state.chain, function (v) { state.chain = v; }),
      el('div', { class: 'field' }, el('label', { for: 'mintvl', text: 'Min TVL' }), minSel),
      el('div', { class: 'field check' }, watch, el('label', { for: 'watchonly', text: 'Watchlist only' })),
      el('div', { class: 'field' }, el('span', { class: 'sub-label', text: 'View' }), el('div', { class: 'tabs' }, boardTab, liveTab)),
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' of ' + DATA.board_size + ' rows' : DATA.live_size + ' shown of ' + DATA.live_total + ' live' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      } }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null)
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Loosen the search, the category or the chain — the full board is one clear away.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; state.minTvl = 0; writeHash(); render();
        } })
      ));
    }
    var max = Math.max.apply(null, list.map(shownImplied).concat([1]));
    var tbody = el('tbody');
    list.forEach(function (r) {
      var implied = shownImplied(r);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: '#' + r.rank }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          r.watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null,
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain not recorded') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num ratio', text: fmtMult(r.peer_multiple) + (r.peer_fallback ? ' (global)' : '') }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((implied / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(implied) })
        )),
        el('td', { class: 'num ratio', text: (implied / r.tvl_usd).toFixed(2) + 'x' })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: (sandbox() ? 'Sandbox values — the sliders in the model panel are moved; board.json still carries the stated model. ' : '') + 'Pre-token protocols by implied value. Select any row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('multiple', 'Peer x'),
            sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Value / TVL' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          r.symbol ? el('span', { class: 'badge plain', text: r.symbol }) : null,
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' \u00b7 ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain not recorded') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ratio', text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl.toFixed(3) + 'x' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols are never ranked — their market caps are facts, and they are the peers the model calibrates from. The ' + DATA.live_size + ' largest of ' + DATA.live_total + ' live-token protocols are shown.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var cal = DATA.calibration;
    var calBody = el('tbody');
    cal.rows.forEach(function (row) {
      var used = row.peers >= M.min_peers;
      calBody.appendChild(el('tr', null,
        el('td', { text: row.category }),
        el('td', { class: 'num', text: String(row.peers) }),
        el('td', { class: 'num', text: row.median_ratio.toFixed(3) + 'x' }),
        el('td', { class: 'num', text: used ? row.multiple.toFixed(3) + 'x' : 'global ' + cal.global_multiple.toFixed(3) + 'x' })
      ));
    });
    var gwSlider = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.gw), 'aria-label': 'Growth weight' });
    gwSlider.addEventListener('input', function () { state.gw = Number(gwSlider.value); render(); });
    var scaleSlider = el('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(state.scale), 'aria-label': 'Multiple scale' });
    scaleSlider.addEventListener('input', function () { state.scale = Number(scaleSlider.value); render(); });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — model ' + DATA.model_version }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot\u2019s own figures only. The base multiple is not a guess: it is the median market-cap-to-TVL of the category\u2019s traded peers in this same snapshot (' + cal.global_peers + ' traded protocols; global median ' + cal.global_median.toFixed(3) + 'x), clamped to [' + M.multiple_min + ', ' + M.multiple_max + '] so one frothy corner cannot price a category. A category with fewer than ' + M.min_peers + ' traded peers — risk curators, almost all still pre-token, are the honest example — is priced at the global median and its rows say so.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl x peer_multiple x (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 x ' + M.growth_weight + ') x (' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' x ' + M.maturity_range + ') x (1 + 0.03 x extra_chains) )' }),
      el('p', { class: 'sub', text: 'Momentum rewards a protocol whose TVL is actually growing this week; maturity pays for time survived with no token (an unrecorded listing date counts as ' + M.unknown_age_days + ' days); breadth pays a little for each extra chain, up to ' + M.breadth_max_extra_chains + '. Nothing else enters: no name, no narrative, no hand-picked list.' }),
      el('table', null,
        el('caption', { text: 'The calibration table: every category with traded peers, its median, and the multiple the board used.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Traded peers' }),
          el('th', { scope: 'col', text: 'Median mcap / TVL' }), el('th', { scope: 'col', text: 'Multiple used' })
        )),
        calBody
      ),
      el('div', { class: 'sliders' },
        el('div', { class: 'slider' },
          el('label', null, 'Growth weight ', el('b', { text: state.gw.toFixed(2) })),
          gwSlider
        ),
        el('div', { class: 'slider' },
          el('label', null, 'Peer multiple scale ', el('b', { text: state.scale.toFixed(2) + 'x' })),
          scaleSlider
        ),
        sandbox() ? el('p', { class: 'sandbox-note', text: 'SANDBOX: the board above is re-ranked at your settings. board.json keeps the stated model.' }) : el('p', { class: 'note', text: 'Stress the model: move a slider and the board re-ranks live. The shipped board never moves.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function multRow(label, value, note) {
    var pct = Math.max(4, Math.min(100, Math.round((value / 1.8) * 100)));
    return el('div', { class: 'mult' },
      el('span', { class: 'm-label', text: label }),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + pct + '%' })),
      el('span', { class: 'm-val', text: fmtMult(value) }),
      note ? el('span', { class: 'note', text: note }) : null
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank #' + row.rank + ' of ' + DATA.board_size }),
        row.watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null,
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' \u00b7 ' + ((row.chains || []).join(', ') || 'chain not recorded') + ' \u00b7 records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The record' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '7-day change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'First tracked' }), el('b', { text: row.listed_at || 'not recorded' })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Implied value / TVL' }), el('b', { text: (row.implied_value_usd / row.tvl_usd).toFixed(2) + 'x' }))
      )
    ));
    var peerNote = row.peer_fallback
      ? 'global median of ' + row.peer_count + ' traded protocols — this category has fewer than ' + M.min_peers + ' of its own'
      : 'median of ' + row.peer_count + ' traded ' + (row.category || '') + ' peers in this snapshot';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — model ' + DATA.model_version }),
      multRow('Peer multiple', row.peer_multiple, peerNote),
      multRow('Momentum (7d ' + fmtPct(row.growth_pct) + ', clamped)', row.growth_multiplier, null),
      multRow('Maturity (' + fmtAge(row.age_days) + ' with no token)', row.maturity_multiplier, null),
      multRow('Breadth (' + (row.chains || []).length + ' chains)', row.breadth_multiplier, null),
      el('div', { class: 'equation' },
        el('div', { class: 'wide' }, el('span', { text: 'TVL x the four factors = implied value' }), el('b', { text: fmtUsd(row.tvl_usd) + '  \u2192  ' + fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'The same farm plan and the same number board.json carries for this protocol. An estimate of what a launch would be worth if the record held — not a prediction that one comes, and not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('span', { class: 'action', text: action }), tail ? el('span', { class: 'cost', text: tail }) : null);
      }))
    ));
    if (!dialog.isConnected) app.appendChild(dialog);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Data: ' + DATA.source + ' Snapshot date ' + DATA.as_of + '; the watchlist floor is ' + fmtUsd(DATA.floor_usd) + ' of TVL. The snapshot is sealed: every run of this radar reads the same bytes.' }),
      el('p', { text: 'Implied value is this entry\u2019s own model claim, never a market price and never a promise of a token, an airdrop or a return. A protocol shown as recording no token is one whose DefiLlama record carries none; verify on the protocol\u2019s own app before risking funds, and never pay anyone to claim or unlock an airdrop.' })
    );
  }

  function render() {
    var keepDialog = state.selected;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (keepDialog) openDetail(keepDialog);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
