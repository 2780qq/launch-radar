// Launch Radar's page. It reads window.RADAR (written by main.ts as data.js) and draws the board,
// the detail view and the filters. No network, no framework, no build step.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;

  var state = { q: '', cat: 'all', flag: 'all', sort: 'rank', dir: 'asc', sel: null };

  function money(n) {
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // header: the law the board is built on, stated in full
  var f = R.fit;
  document.getElementById('sub').textContent =
    R.totals.preToken + ' protocols record no token · ' + R.totals.watchlist + ' above the floor · snapshot of ' + R.as_of;
  document.getElementById('law').innerHTML =
    'law fitted on <b>' + f.samples + '</b> live protocols\n' +
    'mcap = 10<sup>' + f.intercept.toFixed(4) + '</sup> × tvl<sup>' + f.slope.toFixed(4) + '</sup>';

  // category chips, most populous first
  var cats = {};
  R.rows.forEach(function (r) {
    var c = r.category || 'Unnamed';
    cats[c] = (cats[c] || 0) + 1;
  });
  var catChips = document.getElementById('catChips');
  var allCat = el('button', 'chip on', 'All categories');
  allCat.dataset.cat = 'all';
  catChips.appendChild(allCat);
  Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 9).forEach(function (c) {
    var chip = el('button', 'chip', c + ' ' + cats[c]);
    chip.dataset.cat = c;
    catChips.appendChild(chip);
  });

  function rowsFiltered() {
    var q = state.q.toLowerCase();
    return R.rows.filter(function (r) {
      if (state.cat !== 'all' && (r.category || 'Unnamed') !== state.cat) return false;
      if (state.flag === 'watch' && !r.watchlist) return false;
      if (state.flag === 'early' && r.watchlist) return false;
      if (state.flag === 'hot' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (!q) return true;
      return (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) {
      var k = state.sort, d = state.dir === 'asc' ? 1 : -1;
      var av = a[k], bv = b[k];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * d;
      return (av - bv) * d;
    });
  }

  /** The market's own prices: the live protocols, TVL against market cap, with the fitted law drawn. */
  function renderMarket() {
    var ol = document.getElementById('rows');
    ol.textContent = '';
    document.getElementById('count').textContent = R.live.length + ' live protocols, priced by the market';
    var host = document.createElement('div');
    host.className = 'marketview';
    host.innerHTML = marketSheet();
    ol.appendChild(host);
  }

  function marketSheet() {
    var w = 700, h = 330, padL = 56, padR = 18, padT = 18, padB = 40;
    var pts = R.live.filter(function (p) { return p.tvl_usd > 0 && p.mcap_usd > 0; });
    var lx = pts.map(function (p) { return Math.log10(p.tvl_usd); });
    var ly = pts.map(function (p) { return Math.log10(p.mcap_usd); });
    var xmin = Math.min.apply(null, lx) - 0.2, xmax = Math.max.apply(null, lx) + 0.2;
    var ymin = Math.min.apply(null, ly) - 0.3, ymax = Math.max.apply(null, ly) + 0.3;
    var X = function (v) { return padL + ((v - xmin) / (xmax - xmin)) * (w - padL - padR); };
    var Y = function (v) { return padT + h - padT - padB - ((v - ymin) / (ymax - ymin)) * (h - padT - padB); };

    // the law, drawn across the same range
    var x0 = xmin, x1 = xmax;
    var y0 = f.intercept + f.slope * x0, y1 = f.intercept + f.slope * x1;

    var dots = pts.map(function (p) {
      var cx = X(Math.log10(p.tvl_usd)), cy = Y(Math.log10(p.mcap_usd));
      return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.2" fill="#f0a83c" opacity=".72"/>';
    }).join('');

    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var gy = padT + h - padT - padB - (g / 4) * (h - padT - padB);
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (w - padR) + '" y2="' + gy + '" stroke="#232e3e"/>';
      var lab = Math.pow(10, ymin + (g / 4) * (ymax - ymin));
      grid += '<text x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end" font-size="10" fill="#5c6b7e" font-family="ui-monospace,monospace">' + money(lab) + '</text>';
    }

    var rowsHtml = pts.slice(0, 14).map(function (p) {
      return '<tr><td>' + p.name + '</td><td class="n">' + money(p.tvl_usd) + '</td><td class="n">' + money(p.mcap_usd) + '</td><td class="n" style="color:#f0a83c">' + p.multiple.toFixed(2) + 'x</td></tr>';
    }).join('');

    return '<div class="msheet">' +
      '<h2>The market\'s own prices</h2>' +
      '<p class="ml">Every protocol in the snapshot that already trades a token, its TVL against its market cap on log axes. The line is the same law the board prices by: it is fitted to these points, so a reader can see what it got right.</p>' +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" class="mchart">' + grid +
      '<line x1="' + X(x0) + '" y1="' + Y(y0) + '" x2="' + X(x1) + '" y2="' + Y(y1) + '" stroke="#6fd0a8" stroke-width="2" stroke-dasharray="6 4"/>' +
      dots + '</svg>' +
      '<div class="mkey"><span><i style="background:#f0a83c"></i>a live protocol</span><span><i style="background:#6fd0a8"></i>mcap = 10^' + f.intercept.toFixed(4) + ' x tvl^' + f.slope.toFixed(4) + '</span></div>' +
      '<table class="mtable"><thead><tr><th>Protocol</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">Multiple</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '</div>';
  }

  function renderBoard() {
    if (state.flag === 'market') { renderMarket(); return; }
    var list = rowsFiltered();
    var ol = document.getElementById('rows');
    ol.textContent = '';
    document.getElementById('count').textContent = list.length + ' of ' + R.rows.length + ' protocols';
    var frag = document.createDocumentFragment();
    list.forEach(function (r) {
      var li = el('li', 'row' + (r.rank <= 3 ? ' top3' : '') + (state.sel === r.slug ? ' sel' : ''));
      li.dataset.slug = r.slug;

      var rank = el('div', 'rank', String(r.rank));
      var pn = el('div', 'pname');
      var n = el('span', 'n', r.name);
      if (r.watchlist) n.appendChild(el('span', 'tag', 'watchlist'));
      pn.appendChild(n);
      pn.appendChild(el('span', 'c', r.chains.slice(0, 2).join(' · ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '')));
      var cat = el('div', 'cat', r.category || '—');
      var tvl = el('div', 'money', money(r.tvl_usd));
      var d = el('div', 'delta ' + (r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat'), pct(r.change_7d));
      var val = el('div', 'val', money(r.implied_value_usd));

      li.appendChild(rank); li.appendChild(pn); li.appendChild(cat);
      li.appendChild(tvl); li.appendChild(d); li.appendChild(val);
      frag.appendChild(li);
    });
    ol.appendChild(frag);
  }

  function renderDetail() {
    var box = document.getElementById('detail');
    box.textContent = '';
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === state.sel) { r = R.rows[i]; break; }
    if (!r) {
      box.appendChild(el('h2', null, 'Pick a protocol'));
      box.appendChild(el('p', 'dcat', 'The board ranks every pre-token protocol by what its token would be worth if its record stayed as it is. Select a row for the arithmetic and the farm plan.'));
      var p = el('p', 'fine', R.totals.boardRows + ' rows, ' + R.categories.length + ' measured category factors, ' + R.totals.live + ' live protocols behind the fit.');
      box.appendChild(p);
      return;
    }
    box.appendChild(el('h2', null, r.name));
    box.appendChild(el('p', 'dcat', (r.category || 'no category') + ' · ' + r.chains.join(', ') + (r.watchlist ? ' · on the watchlist' : ' · below the floor')));

    var big = el('div', 'big');
    big.appendChild(el('span', 'v', money(r.implied_value_usd)));
    big.appendChild(el('span', 'l', 'implied launch value'));
    box.appendChild(big);
    box.appendChild(el('p', 'range', 'range ' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + ' (the fit\'s 10th–90th residual)'));

    var kv = el('dl', 'kv');
    function pair(k, v) { kv.appendChild(el('dt', null, k)); kv.appendChild(el('dd', null, v)); }
    pair('TVL', money(r.tvl_usd));
    pair('7-day TVL change', pct(r.change_7d));
    pair('Tracked since', r.listed_at || 'not recorded');
    pair('Age', r.age_days === null ? 'unknown' : r.age_days + ' days');
    pair('Board rank', '#' + r.rank);
    box.appendChild(kv);

    var math = el('div', 'math');
    math.innerHTML =
      'base      = 10^' + f.intercept.toFixed(4) + ' × ' + (r.tvl_usd / 1e6).toFixed(1) + 'M^' + f.slope.toFixed(4) + ' = ' + money(r.model.base_usd) + '\n' +
      'category  × ' + r.model.category_factor.toFixed(4) + (r.model.category_samples ? '  (' + r.model.category_samples + ' live in ' + (r.category || '—') + ')' : '  (too few to measure)') + '\n' +
      'momentum  × ' + r.model.momentum_factor.toFixed(4) + '  (' + pct(r.model.momentum_pct) + ' TVL over 7d, weight ' + R.momentum_weight + ')\n' +
      'implied   = <b>' + money(r.implied_value_usd) + '</b>';
    box.appendChild(math);

    box.appendChild(el('p', 'farm-title', 'How to farm it'));
    var ul = el('ul', 'farm');
    r.farm_steps.forEach(function (s) { ul.appendChild(el('li', null, s)); });
    box.appendChild(ul);
  }

  // wiring
  document.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.chip') : null;
    if (chip) {
      var group = chip.parentElement;
      Array.prototype.forEach.call(group.children, function (c) { c.classList.remove('on'); });
      chip.classList.add('on');
      if (chip.dataset.cat !== undefined) state.cat = chip.dataset.cat;
      if (chip.dataset.flag !== undefined) state.flag = chip.dataset.flag;
      renderBoard();
      return;
    }
    var h = e.target.closest ? e.target.closest('.h') : null;
    if (h) {
      var k = h.dataset.sort;
      if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = k; state.dir = k === 'rank' || k === 'name' || k === 'category' ? 'asc' : 'desc'; }
      Array.prototype.forEach.call(document.querySelectorAll('.h'), function (x) { x.classList.remove('asc', 'desc'); });
      h.classList.add(state.dir);
      renderBoard();
      return;
    }
    var row = e.target.closest ? e.target.closest('.row') : null;
    if (row) {
      state.sel = row.dataset.slug;
      Array.prototype.forEach.call(document.querySelectorAll('.row'), function (x) { x.classList.remove('sel'); });
      row.classList.add('sel');
      renderDetail();
    }
  });

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value;
    renderBoard();
  });

  document.getElementById('method').textContent =
    'The board prices a protocol by the market\'s own law of value, fitted by ordinary least squares on the ' +
    f.samples + ' protocols in the snapshot that already trade a token: log10(market cap) = ' +
    f.intercept.toFixed(4) + ' + ' + f.slope.toFixed(4) + ' × log10(TVL). TVL and market cap do not move one for one: ' +
    'a tenfold TVL predicts a ' + Math.pow(10, f.slope).toFixed(1) + 'fold market cap. Each category\'s median residual, ' +
    'measured over its own live protocols, scales the fit, and a protocol\'s seven-day TVL change shifts it by the fitted ' +
    'momentum weight (' + R.momentum_weight + ' per 100% of change, capped). No protocol is named in the model.';

  state.sel = R.rows[0] ? R.rows[0].slug : null;
  renderBoard();
  renderDetail();
})();
