// Token Radar, radar-2 dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail dialog with the model's
// own inputs and the protocol's farm plan, and a live model sandbox. No network: every byte it
// shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  var DEFAULTS = { base: DATA.model.base_multiple, growth: DATA.model.growth_weight, mat: DATA.model.maturity_range };
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null, sandbox: { base: DEFAULTS.base, growth: DEFAULTS.growth, mat: DEFAULTS.mat } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
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
  function money(n) { return '$' + n.toFixed(2).replace(/\.00$/, ''); }

  // The model in one function, the same arithmetic lib/model.ts runs: dampened TVL past $1B,
  // asymmetric growth (falls weigh 0.8, rises 0.5), maturity 1.00-1.50 by age with no token,
  // chain breadth 1 + 0.03 per extra chain capped at 1.30.
  function impliedOf(row, model) {
    var t = model.dampen_threshold_usd;
    var damp = row.tvl_usd <= t ? row.tvl_usd : t + (row.tvl_usd - t) * Math.sqrt(t / row.tvl_usd);
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * (growth >= 0 ? model.growth_weight : model.downside_weight);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = Math.max(1, (row.chains || []).length);
    var chainMult = Math.min(1 + model.chain_step * (chains - 1), model.chain_cap);
    return { implied: Math.max(1, Math.round(damp * model.base_multiple * growthMult * maturity * chainMult)), damp: damp, growth: growth, growthMult: growthMult, maturity: maturity, chainMult: chainMult, age: age };
  }
  function sandboxActive() {
    return state.sandbox.base !== DEFAULTS.base || state.sandbox.growth !== DEFAULTS.growth || state.sandbox.mat !== DEFAULTS.mat;
  }
  function sandboxModel() {
    var m = {};
    Object.keys(DATA.model).forEach(function (k) { m[k] = DATA.model[k]; });
    m.base_multiple = state.sandbox.base;
    m.growth_weight = state.sandbox.growth;
    m.maturity_range = state.sandbox.mat;
    return m;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  var CHEAP = { Base: 1, Arbitrum: 1, Optimism: 1, Polygon: 1, Linea: 1, Scroll: 1, Unichain: 1, Ink: 1, Katana: 1, Morph: 1, Blast: 1, Zora: 1, Mode: 1, BOB: 1, 'World Chain': 1, Abstract: 1, Soneium: 1, Berachain: 1, Sonic: 1, Sei: 1, Mantle: 1 };
  function gasFor(chain) {
    if (chain === 'Ethereum') return { usd: 10, label: '$5-15 per transaction on Ethereum' };
    if (chain === 'Solana') return { usd: 0.05, label: 'about $0.05 per transaction on Solana' };
    if (CHEAP[chain]) return { usd: 0.5, label: 'about $0.50 per transaction on this L2' };
    return { usd: 2, label: 'about $1-3 per transaction on this chain' };
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('liquid restaking') >= 0 || c.indexOf('restaked btc') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow a small amount against it, and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + " of liquidity to " + name + "'s main pool on " + chain + ' in a tight range and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + " of LP tokens into " + name + "'s farm on " + chain + ' and keep the position open.';
    if (c.indexOf('cross chain') >= 0 || c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app the same day.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetics') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ' on ' + chain + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + " into " + name + "'s basis vault on " + chain + ' and keep the shares.';
    if (c.indexOf('stablecoin wrapper') >= 0 || c.indexOf('stablecoin issuer') >= 0 || c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('launchpad') >= 0) return 'Commit $' + capital + ' to the next ' + name + ' launch allocation on ' + chain + ' and complete its checks.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of the governance asset through ' + name + ' on ' + chain + ' and vote once.';
    if (c.indexOf('payments') >= 0 || c.indexOf('card') >= 0) return 'Top up $' + capital + ' through ' + name + ' on ' + chain + ' and make one real payment with it.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s private pool on " + chain + ' and keep the note.';
    if (c.indexOf('indexes') >= 0) return 'Buy $' + capital + " of " + name + "'s index token on " + chain + ' and hold it.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + " onto the chain through " + name + "'s official bridge, then use its flagship app once.";
    if (c.indexOf('token locker') >= 0 || c.indexOf('otc') >= 0) return 'Lock $' + capital + ' of tokens through ' + name + ' on ' + chain + ' and keep the lock receipt.';
    if (c.indexOf('reserve currency') >= 0 || c.indexOf('algo-stables') >= 0 || c.indexOf('dual-token') >= 0) return 'Bond or mint $' + capital + ' through ' + name + ' on ' + chain + ' and hold the position.';
    if (c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'Deposit $' + capital + ' of BTC value through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + " into " + name + "'s CeDeFi vault on " + chain + ' and keep the shares.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var secondChain = p.chains.length > 1 ? p.chains[1] : null;
    var gas2 = secondChain ? gasFor(secondChain) : gas;
    var half = Math.max(10, Math.round(capital / 2));
    function step(text, cost, time, gasUsd, min) { return { text: text, cost: cost, time: time, gas_usd: gasUsd, active_min: min }; }
    return [
      step('Use a fresh wallet that holds only the funds you plan to farm on ' + chain + ', and keep its seed phrase offline.', gas.label + ' for the first transaction', '5 minutes', gas.usd, 5),
      step(actionFor(p, capital, chain), '$' + capital + ' of capital and ' + gas.label, '15 minutes to set up', gas.usd, 15),
      step('Make one qualifying action each week for ' + weeks + ' weeks, such as a deposit, a borrow, a swap or a vote, so activity spans more than one snapshot.', 'about ' + money(gas.usd * weeks) + ' of gas over ' + weeks + ' weeks', '10 minutes a week for ' + weeks + ' weeks', gas.usd * weeks, 10 * weeks),
      step('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days', 0, 0),
      step(secondChain ? 'Repeat the core action on ' + secondChain + ' with $' + half + ' so your activity shows on a second chain.' : 'Add a second, smaller position of $' + half + ' a week later so your activity spans more than one snapshot.', '$' + half + ' of capital and ' + gas2.label, '15 minutes', gas2.usd, 15),
      step("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay to claim.", 'no fee to check, and never pay to claim', '10 minutes', 0, 10)
    ];
  }
  function stepText(s) { return s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; }

  // Why this rank, from the figures alone: TVL standing, growth direction, age, breadth.
  function whyRank(row) {
    var tvlRank = DATA.rows.filter(function (r) { return r.tvl_usd > row.tvl_usd; }).length + 1;
    var parts = [];
    parts.push('TVL ' + fmtUsd(row.tvl_usd) + ' is the ' + tvlRank + (tvlRank === 1 ? 'st' : tvlRank === 2 ? 'nd' : tvlRank === 3 ? 'rd' : 'th') + ' largest of ' + DATA.board_size + ' ranked protocols');
    if (row.change_7d !== null && row.change_7d > 0) parts.push('7d growth ' + fmtPct(row.change_7d) + ' lifts it');
    else if (row.change_7d !== null && row.change_7d < 0) parts.push('7d growth ' + fmtPct(row.change_7d) + ' drags it down');
    else parts.push('7d growth is unreported, so the model scores it as flat');
    if (row.age_days !== null && row.age_days >= 1095) parts.push('it has run ' + fmtAge(row.age_days) + ' with no token on record, the maximum overdue factor');
    else if (row.age_days !== null) parts.push('it has run ' + fmtAge(row.age_days) + ' with no token on record');
    else parts.push('its listing date is unknown, so the model assumes a year with no token');
    if ((row.chains || []).length >= 10) parts.push('and it runs on ' + row.chains.length + ' chains, the maximum breadth bonus');
    else if ((row.chains || []).length >= 4) parts.push('and it runs on ' + row.chains.length + ' chains');
    return 'Rank #' + row.rank + ' because ' + parts.join(', ') + '.';
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('w') === '1') state.watchOnly = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('w', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Display rows: the board's values, or the sandbox's recomputed values and ranks.
  function displayRows() {
    var active = sandboxActive();
    var model = active ? sandboxModel() : DATA.model;
    var list = DATA.rows.map(function (r) {
      var v = impliedOf(r, model);
      return { row: r, imp: active ? v.implied : r.implied_value_usd, raw: v };
    });
    if (active) list.sort(function (a, b) { return b.imp - a.imp || (a.row.slug < b.row.slug ? -1 : 1); });
    list.forEach(function (d, i) { d.rank = active ? i + 1 : d.row.rank; });
    return list;
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return displayRows().filter(function (d) {
      var r = d.row;
      if (state.watchOnly && !WATCH[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (key === 'growth') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (key === 'age') { av = a.row.age_days === null ? Infinity : a.row.age_days; bv = b.row.age_days === null ? Infinity : b.row.age_days; }
      else { av = a.imp; bv = b.imp; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null, 'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }), ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }), ' pre-token protocols below that floor. Implied value is a model, not a promise — and never a prediction of when, or whether, a token launches.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var watch = el('button', { type: 'button', class: 'check' + (state.watchOnly ? ' on' : ''), 'aria-pressed': state.watchOnly ? 'true' : 'false', text: (state.watchOnly ? '● ' : '○ ') + 'Watchlist only', onclick: function () { state.watchOnly = !state.watchOnly; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? filtered().length : DATA.live.length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('span', { text: 'Scope' }), watch),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count' }, el('b', { text: String(shown) }), state.tab === 'pre-token' ? ' rows shown' : ' live-token protocols')
    );
  }

  function slider(id, label, min, max, step, value, oninput) {
    var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    var val = el('b', { text: String(value) });
    input.addEventListener('input', function () { val.textContent = input.value; oninput(Number(input.value)); });
    return el('div', { class: 'slider' }, el('label', { for: id }, label, val), input);
  }
  function sandbox() {
    var active = sandboxActive();
    var panel = el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox — move a slider, the board re-ranks' }),
      el('p', { text: 'The same impliedOf function scores every row again in the page. Change a weight and watch the ranks move; reset returns to the published model.' }),
      el('div', { class: 'sliders' },
        slider('sb-base', 'Base multiple (TVL x)', 0.1, 0.5, 0.01, state.sandbox.base, function (v) { state.sandbox.base = v; render(); }),
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, state.sandbox.growth, function (v) { state.sandbox.growth = v; render(); }),
        slider('sb-mat', 'Maturity cap (3y+ bonus)', 0, 0.8, 0.05, state.sandbox.mat, function (v) { state.sandbox.mat = v; render(); })
      ),
      active ? el('div', { class: 'sandbox-note' }, 'Sandbox on: ranks and values below are recomputed live, not the published board. ', el('button', { class: 'button ghost', type: 'button', text: 'Reset to published model', onclick: function () { state.sandbox = { base: DEFAULTS.base, growth: DEFAULTS.growth, mat: DEFAULTS.mat }; render(); } })) : null
    );
    return panel;
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filtered());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (d) { if (d.imp > max) max = d.imp; });
    var tbody = el('tbody');
    list.forEach(function (d) {
      var r = d.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(d.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), WATCH[r.slug] ? el('span', { class: 'watch', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((d.imp / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(d.imp) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
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
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed — model radar-2' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('div', null, 'dampened_tvl = tvl_usd up to $1B, then $1B + (tvl_usd - $1B) x sqrt($1B / tvl_usd)'),
        el('div', null, 'base = dampened_tvl x ', el('b', { text: String(m.base_multiple) })),
        el('div', null, 'growth = clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ');  growthMult = 1 + growth / 100 x ' + m.growth_weight + ' up, x ' + m.downside_weight + ' down'),
        el('div', null, 'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + '  (age unknown: ' + m.unknown_age_days + 'd; 3y+ scores 1.50)'),
        el('div', null, 'chainMult = min(1 + 0.03 x (chains - 1), 1.30)'),
        el('div', null, 'implied = round(base x growthMult x maturity x chainMult), ranks forced strictly descending')
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token. Size is dampened past $1B so a giant is not worth 2.75x a $1B protocol; falls weigh more than rises; the longer the wait with no token, the higher the overdue factor. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var v = impliedOf(row, DATA.model);
    var steps = farmSteps(row);
    var gasTotal = 0, minTotal = 0;
    steps.forEach(function (s) { gasTotal += s.gas_usd; minTotal += s.active_min; });
    var capital = capitalFor(row);
    var half = Math.max(10, Math.round(capital / 2));
    var hold = holdDaysFor(row.age_days);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WATCH[row.slug] ? ' · Watchlist' : ' · Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('p', { class: 'why' }, el('b', { text: 'Why this rank: ' }), whyRank(row)));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — every multiplier shown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Dampened TVL (size x' + row.size_multiplier.toFixed(4) + ')' }), el('b', { class: 'num', text: fmtUsd(row.dampened_tvl_usd) })),
        el('div', null, el('span', { text: 'Base = dampened x ' + DATA.model.base_multiple }), el('b', { class: 'num', text: fmtUsd(row.dampened_tvl_usd * DATA.model.base_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth ' + fmtPct(row.change_7d) }), el('b', { class: 'num', text: 'x' + row.growth_multiplier })),
        el('div', null, el('span', { text: 'Age with no token (' + fmtAge(row.age_days) + ')' }), el('b', { class: 'num', text: 'x' + row.maturity_multiplier })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: 'x' + row.chain_multiplier })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(v.implied) + (v.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', while the board carries ' + fmtUsd(row.implied_value_usd) + ': a $1 tie-break cut keeps ranks strictly descending.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null, el('b', { text: s.text }), el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }));
      })),
      el('div', { class: 'totals' },
        el('div', null, 'Total gas: ', el('b', { text: 'about ' + money(gasTotal) })),
        el('div', null, 'Capital committed: ', el('b', { text: '$' + (capital + half) + ' ($' + capital + ' main + $' + half + ' second position)' })),
        el('div', null, 'Hold: ', el('b', { text: hold + ' days' }), ' · Active work: ', el('b', { text: 'about ' + minTotal + ' minutes' }))
      )
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(sandbox());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__shotReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
