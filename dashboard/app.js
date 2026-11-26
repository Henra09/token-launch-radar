// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, filters, and a per-protocol detail drawer with the model's own inputs and that
// protocol's farm plan. Vanilla JS, no network, no framework: every byte shown comes from data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = {
    q: '', category: 'all', chain: 'all', band: 'all', view: 'board',
    sort: 'implied', dir: -1, selected: null,
  };

  /* ---------------- formatting ---------------- */

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + 'y';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 30) return Math.round(days / 30) + 'mo';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtDate(iso) { return iso === null || iso === undefined ? 'unlisted' : String(iso); }

  // Value bands: which slice of the board a row's implied value lands in.
  var BANDS = [
    { id: 'p1', label: '$100M+ implied', test: function (v) { return v >= 1e8; } },
    { id: 'p2', label: '$25M - $100M', test: function (v) { return v >= 25e6 && v < 1e8; } },
    { id: 'p3', label: '$5M - $25M', test: function (v) { return v >= 5e6 && v < 25e6; } },
    { id: 'p4', label: 'under $5M', test: function (v) { return v < 5e6; } },
  ];
  function bandOf(v) { for (var i = 0; i < BANDS.length; i++) if (BANDS[i].test(v)) return BANDS[i].id; return null; }

  /* ---------------- element helper ---------------- */

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
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

  /* ---------------- momentum sparkline ---------------- */

  // A seven-cell bar strip approximating the protocol's recent TVL path: the 7d change is
  // spread back over the week's cells so growth reads left-to-right as it happened.
  function spark(change7d) {
    var strip = el('span', { class: 'spark', 'aria-hidden': 'true' });
    var g = change7d === null || change7d === undefined || !isFinite(change7d) ? null : change7d;
    if (g === null) { strip.classList.add('flat'); return strip; }
    var clamped = Math.max(-50, Math.min(100, g));
    var daily = Math.pow(1 + clamped / 100, 1 / 7) - 1; // constant daily rate that reproduces the 7d move
    var level = 1;
    for (var d = 0; d < 7; d++) {
      var h = 6 + Math.min(18, Math.round(level * 10));
      var up = daily >= 0;
      strip.appendChild(el('i', {
        style: 'height:' + h + 'px;background:' + (up ? 'var(--up)' : 'var(--down)'),
        title: up ? 'rising' : 'falling',
      }));
      level *= 1 + daily;
    }
    strip.classList.add(clamped >= 0 ? 'up' : 'down');
    return strip;
  }

  /* ---------------- filtering and sorting ---------------- */

  function categories() {
    var seen = {};
    var out = [];
    DATA.rows.forEach(function (r) {
      var c = r.category_label || 'Other';
      if (!seen[c]) { seen[c] = true; out.push(c); }
    });
    return out.sort();
  }
  function chains() {
    var seen = {};
    var out = [];
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; out.push(c); } });
    });
    return out.sort();
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category_label || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.band !== 'all' && bandOf(r.implied_value_usd) !== state.band) return false;
      if (q) {
        var hay = [r.name, r.slug, r.category_label, (r.chains || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; dir = 1; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  /* ---------------- header / lede ---------------- */

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'LAUNCH RADAR' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'Floor $' + Math.round(DATA.floor_usd / 1e6) + 'M TVL' }),
        el('span', { class: 'ver', text: 'model ' + DATA.model_version })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'What would a token be worth, if it launched today?' }),
        el('p', null,
          'This board ranks ' + DATA.board_size + ' protocols that record no token - every one of the ' +
          DATA.watchlist_size + ' on the snapshot watchlist, plus ' + DATA.early_size +
          ' earlier-stage names below its $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. The implied value is this radar\u2019s own model, ' +
          'built only from each protocol\u2019s snapshot figures: how much value it holds, whether that value is moving, ' +
          'how long it has run without a token, and what kind of cash flow its category captures. It is an estimate of a launch\u2019s size, never a prediction that one comes.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist coverage' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early finds below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live tokens set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  /* ---------------- model explainer ---------------- */

  function modelPanel() {
    var m = DATA.model;
    var weights = (DATA.category_weights || []).map(function (w) {
      return el('span', { class: 'wt' }, w.label + ' x' + w.weight);
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The value model, in one formula' }),
      el('p', { class: 'sub', text: 'One function scores every protocol from its snapshot record alone; no name is special-cased.' }),
      el('div', { class: 'formula' },
        el('code', { text: 'implied_value = tvl_usd \u00d7 ' + m.base_multiple }),
        el('code', { text: '\u00d7 momentum: 1 + clamp(change_7d, ' + m.momentum_floor + ', +' + m.momentum_cap + ')/100 \u00d7 ' + m.momentum_weight }),
        el('code', { text: '\u00d7 patience: ' + m.patience_floor + ' + min(age_days, ' + m.patience_days + ')/' + m.patience_days + ' \u00d7 ' + m.patience_range }),
        el('code', { text: '\u00d7 category weight: 0.80 \u2026 1.35' })
      ),
      el('p', { class: 'sub' },
        'Momentum pays a protocol whose TVL grew over the last seven days and dings one that shrank; unreported change scores a neutral 1.00. ',
        'Patience counts the days since the protocol was first tracked - the longer it has run with no token, the more users a launch would inherit; an unlisted age scores as ' + m.patience_default_days + ' days. ',
        'The category weight prices a dollar of TVL by what cash flow it captures: '),
      el('div', { class: 'weights' }, weights),
      el('p', { class: 'sub' },
        'The board also separates protocols whose token already trades (shown with the market\u2019s own market cap on the Live token tab) from the pre-token names a launch would still create.')
    );
  }

  /* ---------------- controls ---------------- */

  function select(id, label, options, current, onchange) {
    var s = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o.v, text: o.t, selected: o.v === current ? 'selected' : null }); })
    );
    s.addEventListener('change', function () { onchange(s.value); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain\u2026', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; syncHash(); render(); });

    var cats = [{ v: 'all', t: 'All categories (' + DATA.rows.length + ' rows)' }].concat(
      categories().map(function (c) { return { v: c, t: c }; })
    );
    var chs = [{ v: 'all', t: 'All chains' }].concat(chains().map(function (c) { return { v: c, t: c }; }));
    var bands = [{ v: 'all', t: 'All value bands' }].concat(BANDS.map(function (b) { return { v: b.id, t: b.label }; }));

    return el('div', { class: 'controls' },
      el('div', { class: 'field grow' }, el('label', { for: 'q', text: 'Search' }), search),
      select('f-cat', 'Category', cats, state.category, function (v) { state.category = v; syncHash(); render(); }),
      select('f-chain', 'Chain', chs, state.chain, function (v) { state.chain = v; syncHash(); render(); }),
      select('f-band', 'Implied value', bands, state.band, function (v) { state.band = v; syncHash(); render(); }),
      el('div', { class: 'field' },
        el('span', { class: 'field-label', text: 'View' }),
        el('div', { class: 'tabs' },
          el('button', { type: 'button', 'aria-pressed': state.view === 'board' ? 'true' : 'false', text: 'Ranked board', onclick: function () { state.view = 'board'; render(); } }),
          el('button', { type: 'button', 'aria-pressed': state.view === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.view = 'live'; render(); } })
        )
      ),
      el('span', { class: 'count', id: 'count' })
    );
  }

  function countLabel(n) { return n + ' of ' + DATA.rows.length + ' protocols shown'; }

  /* ---------------- board table ---------------- */

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', {
        type: 'button',
        onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); }
      }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null)
    );
  }

  function boardTable() {
    var list = sorted(filtered());
    var count = document.getElementById('count');
    if (count) count.textContent = countLabel(list.length);
    if (list.length === 0) {
      return el('div', { class: 'panel empty-wrap' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing matches those filters' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear all filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.band = 'all'; syncHash(); render(); } })
      ));
    }
    var maxImplied = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var gc = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var w = Math.max(4, Math.round((r.implied_value_usd / maxImplied) * 100));
      tbody.appendChild(el('tr', {
        'data-slug': r.slug,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category_label || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') : 'unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, spark(r.change_7d)),
        el('td', { class: 'num ' + gc, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar' }, el('i', { style: 'width:' + w + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill' + (r.on_watchlist ? '' : ' early'), text: r.on_watchlist ? 'watchlist' : 'early find' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols by implied value. Every column sorts; select a row for the full model breakdown and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', '#'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            el('th', { scope: 'col', text: '7d path' }),
            sortHeader('growth', '7d \u0394'),
            sortHeader('age', 'No-token age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Source' })
          )),
          tbody
        )
      )
    );
  }

  /* ---------------- live-token table ---------------- */

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: r.name })),
        el('td', { class: 'sub', text: r.category || 'Other' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num sub', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '\u00d7' : 'n/a' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'These protocols already trade, so their market cap is a fact, not a model. They are kept out of the ranking - and their mcap/TVL ratios hint at what multiples the market actually pays.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d \u0394' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap/TVL' })
          )),
          tbody
        )
      )
    );
  }

  /* ---------------- detail drawer ---------------- */

  var dialog = el('dialog', { class: 'detail', id: 'detail' });
  dialog.addEventListener('close', function () { state.selected = null; syncHash(); });

  function factRow(label, value, cls) {
    return el('div', null, el('span', { text: label }), el('b', { class: 'num ' + (cls || ''), text: value }));
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    syncHash();
    dialog.textContent = '';

    // Head: name, rank, category, chains.
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'ver', text: 'RANK ' + row.rank + ' / ' + DATA.board_size + (row.on_watchlist ? ' \u00b7 watchlist' : ' \u00b7 early find') }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category_label || 'Other') + ' \u00b7 category weight \u00d7' + row.category_weight })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '\u2715', onclick: function () { dialog.close(); } })
    ));

    // Chains as pills.
    dialog.appendChild(el('div', { class: 'pills' },
      (row.chains || []).map(function (c) { return el('span', { class: 'pill', text: c }); })
    ));

    // Facts: TVL, trend, listed date, age.
    dialog.appendChild(el('div', { class: 'facts detail-facts' },
      el('div', { class: 'fact' }, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', { class: 'fact' }, el('span', { text: '7-day change' }), el('b', { class: 'num ' + (row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(row.change_7d) })),
      el('div', { class: 'fact' }, el('span', { text: 'First tracked' }), el('b', { class: 'num', text: fmtDate(row.listed_at) })),
      el('div', { class: 'fact' }, el('span', { text: 'Days with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) }))
    ));

    // Model breakdown: every multiplier and its arithmetic.
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How the implied value is built' }),
      el('div', { class: 'equation' },
        factRow('TVL', fmtUsd(row.tvl_usd)),
        factRow('\u00d7 base multiple (' + DATA.model.base_multiple + ')', fmtUsd(Math.round(row.tvl_usd * DATA.model.base_multiple))),
        factRow('\u00d7 momentum (' + fmtPct(row.change_7d) + ' 7d)', '\u00d7' + row.momentum_mult),
        factRow('\u00d7 patience (' + fmtAge(row.age_days) + ' age)', '\u00d7' + row.patience_mult),
        factRow('\u00d7 category (' + (row.category_label || 'Other') + ')', '\u00d7' + row.category_weight),
        factRow('= implied value', fmtUsd(row.implied_value_usd), 'strong')
      ),
      el('p', { class: 'sub', text: 'An estimate of what a launch would be worth if the market priced this protocol like its peers - not a claim that a launch comes, or when.' })
    ));

    // Farm plan: the concrete steps, with cost and time per step.
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan \u00b7 before a token exists' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        return el('li', null,
          el('b', { text: s.text }),
          el('span', { class: 'cost', text: 'Cost: ' + s.cost + ' \u00b7 Time: ' + s.time })
        );
      }))
    ));

    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  /* ---------------- hash sync ---------------- */

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('band')) state.band = params.get('band');
    if (params.get('p')) state.selected = params.get('p');
  }
  function syncHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.band !== 'all') params.set('band', state.band);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  /* ---------------- render ---------------- */

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.view === 'board' ? boardTable() : liveTable());
    shell.appendChild(modelPanel());
    shell.appendChild(el('footer', { class: 'foot' },
      el('p', { class: 'sub', text: 'Source: the sealed protocol snapshot (' + DATA.as_of + '), fetched once from a public protocol-index API. Implied values are this radar\u2019s model output, not market prices and not advice.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected && state.view === 'board') openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
