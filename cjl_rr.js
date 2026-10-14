/* CJL round robin helpers for the display pages.
 * The standings logic mirrors computeRoundRobinStandings() in the Apps Script
 * exactly, so the overlays, the public status page and the Sheet always agree:
 *   dual wins → head-to-head wins among the tied teams → team points scored
 *   → team-point difference → name.
 * Works on the flat bout list the control panel pushes on the relay's
 * 'bracket' channel (same shape as ?action=getBracket).
 */
(function (root) {
  'use strict';
  var RR_PREFIX = 'Round Robin — Round ';
  var FINAL_PREFIX = 'Round Robin Final';

  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function isPlaceholder(t) { var s = str(t); return !s || s === 'TBD' || /^(?:[WL]|RR)-/.test(s); }
  function isRRNote(n) { return str(n).indexOf(RR_PREFIX) === 0; }
  function isFinalNote(n) { return str(n).indexOf(FINAL_PREFIX) === 0; }
  function divBouts(bouts, division) { return (bouts || []).filter(function (b) { return str(b.division) === division; }); }

  function isRoundRobin(bouts, division) {
    return divBouts(bouts, division).some(function (b) { return isRRNote(b.notes); });
  }

  function standings(bouts, division) {
    var duals = divBouts(bouts, division);
    var rr = duals.filter(function (d) { return isRRNote(d.notes); });
    var teams = {};
    function add(name) {
      if (isPlaceholder(name)) return;
      if (!teams[name]) teams[name] = { name: name, wins: 0, losses: 0, played: 0, ptsFor: 0, ptsAgainst: 0 };
    }
    rr.forEach(function (d) { add(str(d.team1)); add(str(d.team2)); });
    var done = rr.filter(function (d) {
      return d.status === 'Complete' && !isPlaceholder(d.team1) && !isPlaceholder(d.team2) &&
        (str(d.winner) === str(d.team1) || str(d.winner) === str(d.team2));
    });
    done.forEach(function (d) {
      var t1 = teams[str(d.team1)], t2 = teams[str(d.team2)];
      var s1 = Number(d.team1Score) || 0, s2 = Number(d.team2Score) || 0;
      t1.played++; t2.played++;
      t1.ptsFor += s1; t1.ptsAgainst += s2;
      t2.ptsFor += s2; t2.ptsAgainst += s1;
      if (str(d.winner) === str(d.team1)) { t1.wins++; t2.losses++; } else { t2.wins++; t1.losses++; }
    });
    var list = Object.keys(teams).map(function (k) { return teams[k]; });
    list.forEach(function (t) { t.diff = t.ptsFor - t.ptsAgainst; });
    list.sort(function (a, b) { return b.wins - a.wins; });
    var ordered = [], i = 0;
    while (i < list.length) {
      var j = i;
      while (j < list.length && list[j].wins === list[i].wins) j++;
      var group = list.slice(i, j), names = {};
      group.forEach(function (t) { names[t.name] = true; t.h2h = 0; });
      if (group.length > 1) {
        done.forEach(function (d) { if (names[str(d.team1)] && names[str(d.team2)]) teams[str(d.winner)].h2h++; });
      }
      group.sort(function (a, b) {
        return (b.h2h - a.h2h) || (b.ptsFor - a.ptsFor) || (b.diff - a.diff) ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      });
      group.forEach(function (t) { ordered.push(t); });
      i = j;
    }
    var fin = duals.filter(function (d) { return isFinalNote(d.notes); })[0];
    var complete = rr.length > 0 && rr.every(function (d) { return d.status === 'Complete'; });
    var result = ordered;
    if (fin && fin.status === 'Complete' && str(fin.winner) &&
        (str(fin.winner) === str(fin.team1) || str(fin.winner) === str(fin.team2))) {
      var w = str(fin.winner), l = w === str(fin.team1) ? str(fin.team2) : str(fin.team1);
      result = ordered.filter(function (t) { return t.name === w; })
        .concat(ordered.filter(function (t) { return t.name === l; }),
                ordered.filter(function (t) { return t.name !== w && t.name !== l; }));
    }
    return result.map(function (t, k) {
      return { rank: k + 1, name: t.name, wins: t.wins, losses: t.losses, played: t.played,
               ptsFor: t.ptsFor, ptsAgainst: t.ptsAgainst, diff: t.diff, roundRobinComplete: complete };
    });
  }

  // [{label:'Round 1', bouts:[…]}, …, {label:'Final', bouts:[final]}]
  function rounds(bouts, division) {
    var byRound = {}, order = [];
    divBouts(bouts, division).forEach(function (b) {
      var n = str(b.notes), key;
      if (isRRNote(n)) key = 'Round ' + n.slice(RR_PREFIX.length);
      else if (isFinalNote(n)) key = 'Final';
      else return;
      if (!byRound[key]) { byRound[key] = []; order.push(key); }
      byRound[key].push(b);
    });
    order.sort(function (a, b) {
      if (a === 'Final') return 1; if (b === 'Final') return -1;
      return (parseInt(a.slice(6), 10) || 0) - (parseInt(b.slice(6), 10) || 0);
    });
    return order.map(function (k) { return { label: k, bouts: byRound[k] }; });
  }

  function finalBout(bouts, division) {
    return divBouts(bouts, division).filter(function (b) { return isFinalNote(b.notes); })[0] || null;
  }

  // Champion once it's decided: the final's winner, or the table leader when
  // every round robin bout is in and there is no final.
  function champion(bouts, division) {
    var fin = finalBout(bouts, division);
    if (fin) return fin.status === 'Complete' && str(fin.winner) ? str(fin.winner) : '';
    var t = standings(bouts, division);
    return t.length && t[0].roundRobinComplete ? t[0].name : '';
  }

  function esc(s) {
    return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // "W-B1" → "Winner of Bout 1", "L-W3" → "Loser of Bout W3", "RR-1" → "Round robin #1"
  function placeholderLabel(t) {
    var s = str(t), m = /^([WL])-(B|W|S)(\d+)$/.exec(s);
    if (m) return (m[1] === 'W' ? 'Winner' : 'Loser') + ' of ' + (m[2] === 'B' ? 'Bout ' : m[2] === 'W' ? 'Bout W' : 'Super ') + m[3];
    m = /^RR-(\d+)$/.exec(s);
    if (m) return '#' + m[1] + ' in standings';
    return s && s !== 'TBD' ? s : 'TBD';
  }

  // Bracket rounds read from the bout notes, so the same page draws any
  // bracket size (2–16 teams, with byes) and the rulebook's 8-team layout.
  // side: 'champ' (Championship …) or 'con' (Consolation / placement bouts).
  // Rounds come out in playing order.
  var LABELS = {
    'Championship Quarterfinal': 'Quarterfinals', 'Championship Semi': 'Semifinals', 'Championship Final — 1st/2nd': 'Final',
    'Consolation Semi — 5th Place': '5th Place Semis', 'Consolation — 7th/8th': '7th/8th Place',
    'Consolation — 5th/6th': '5th/6th Place', 'Consolation Final — 3rd/4th': '3rd/4th Place'
  };
  function roundLabel(note) {
    if (LABELS[note]) return LABELS[note];
    var m = /^Championship R(\d+)$/.exec(note);
    if (m) return 'Round ' + m[1];
    return note;
  }
  function bracketRounds(bouts, division, side) {
    var prefix = side === 'champ' ? 'Championship' : 'Consolation';
    var order = [], by = {};
    divBouts(bouts, division).forEach(function (b) {
      var n = str(b.notes).replace(/^Women's /, '');
      if (n.indexOf(prefix) !== 0) return;
      if (!by[n]) { by[n] = []; order.push(n); }
      by[n].push(str(b.bout));
    });
    if (side === 'champ') {   // final always last
      order.sort(function (a, b) { return (a.indexOf('Final') !== -1) - (b.indexOf('Final') !== -1); });
    } else {                  // 3rd/4th place last (it's the con page's "result")
      order.sort(function (a, b) { return (a.indexOf('3rd/4th') !== -1) - (b.indexOf('3rd/4th') !== -1); });
    }
    return order.map(function (n) { return { label: roundLabel(n), bouts: by[n] }; });
  }

  function hasDivision(bouts, division) { return divBouts(bouts, division).length > 0; }

  // ── Line bracket (TrackWrestling style) ────────────────────────────────
  // Works out which bout feeds which slot (from "W-B1"/"L-B1" placeholders,
  // or — once resolved — from who won the earlier bout), then lays the
  // bracket out on a grid: one horizontal line per team slot, a bracket
  // connector per bout, and the winner's line continuing into the next round.
  // y values are in "line units" (0 … total), columns 0 … cols-1 (the last
  // column holds the result lines: Champion / 3rd place …).
  function boutOrder(id) {
    var m = /(\d+)\s*$/.exec(str(id)); return m ? parseInt(m[1], 10) : 0;
  }
  function placeText(note) {
    var n = str(note).replace(/^Women's /, '');
    if (/1st\/2nd/.test(n)) return 'Champion';
    var m = /(\d+)(?:st|nd|rd|th)\/\d+(?:st|nd|rd|th)/.exec(n);
    if (m) return m[1] + (m[1] === '3' ? 'rd' : 'th') + ' place';
    if (/5th Place/.test(n)) return '5th place semi';
    return 'Winner';
  }
  function bracketLayout(bouts, division, side) {
    var prefix = side === 'champ' ? 'Championship' : 'Consolation';
    var S = divBouts(bouts, division).filter(function (b) { return str(b.notes).replace(/^Women's /, '').indexOf(prefix) === 0; })
      .sort(function (a, b) { return boutOrder(a.bout) - boutOrder(b.bout); });
    var byId = {};
    S.forEach(function (b) { byId[str(b.bout)] = b; });
    // feeders
    var feed = {}, fedBy = {};
    S.forEach(function (b) {
      feed[b.bout] = [null, null];
      [1, 2].forEach(function (s) {
        var t = str(b['team' + s]), m = /^([WL])-(B|W)(\d+)$/.exec(t), f = null, ext = null;
        if (m) {
          var id = (m[2] === 'B' ? 'Bout ' : 'Bout W') + m[3];
          if (m[1] === 'W' && byId[id]) f = id; else ext = (m[1] === 'W' ? 'Winner' : 'Loser') + ' of ' + id;
        } else if (t && t !== 'TBD') {
          var cands = S.filter(function (x) { return boutOrder(x.bout) < boutOrder(b.bout) && x.status === 'Complete' && str(x.winner) === t && !fedBy[x.bout]; });
          if (cands.length) f = str(cands[cands.length - 1].bout);
          else if (side !== 'champ') {   // dropped down from a championship bout
            var lost = divBouts(bouts, division).filter(function (x) { return !byId[str(x.bout)] && x.status === 'Complete' && str(x.winner) && str(x.winner) !== t &&
              (str(x.team1) === t || str(x.team2) === t) && boutOrder(x.bout) < boutOrder(b.bout); });
            if (lost.length) ext = 'Loser of ' + str(lost[lost.length - 1].bout);
          }
        }
        if (f) fedBy[f] = b.bout;
        feed[b.bout][s - 1] = f ? { bout: f } : (ext ? { ext: ext } : null);
      });
    });
    var roots = S.filter(function (b) { return !fedBy[b.bout]; });
    roots.sort(function (a, b) {   // champ: final first; con: best place first
      var pa = parseInt((/(\d+)(?:st|nd|rd|th)\//.exec(str(a.notes)) || [0, 99])[1], 10);
      var pb = parseInt((/(\d+)(?:st|nd|rd|th)\//.exec(str(b.notes)) || [0, 99])[1], 10);
      return (pa - pb) || (boutOrder(a.bout) - boutOrder(b.bout));
    });
    var depth = {}, maxDepth = 0;
    function setDepth(id, d) { depth[id] = d; if (d > maxDepth) maxDepth = d;
      feed[id].forEach(function (f) { if (f && f.bout) setDepth(f.bout, d + 1); }); }
    roots.forEach(function (r) { setDepth(r.bout, 0); });
    function leaves(id) { return feed[id].reduce(function (n, f) { return n + (f && f.bout ? leaves(f.bout) : 1); }, 0); }
    var lines = [], connectors = [], outputs = [], cursor = 0, GAP = 0.7;
    function slotState(b, s) {
      if (b.status !== 'Complete' || !str(b.winner)) return 'pending';
      return str(b.winner) === str(b['team' + s]) ? 'win' : 'lose';
    }
    // returns the y of bout id's output (midpoint of its two slots)
    function place(id, top) {
      var b = byId[id], col = maxDepth - depth[id], ys = [], t = top;
      [1, 2].forEach(function (s) {
        var f = feed[id][s - 1], n = f && f.bout ? leaves(f.bout) : 1, y;
        if (f && f.bout) y = place(f.bout, t); else y = t + n / 2;
        var team = str(b['team' + s]);
        var resolved = team && !isPlaceholder(team);
        lines.push({ bout: id, slot: s, col: col, y: y, fedBy: f && f.bout ? f.bout : '',
          entry: !(f && f.bout) && !(f && f.ext) && resolved,
          team: resolved ? team : '', short: resolved ? str(b['team' + s + 'Short']) : '',
          seed: b['team' + s + 'Seed'] || '', color: b['team' + s + 'Color'] || '',
          label: !resolved && f && f.ext ? f.ext : '', from: f && f.ext ? f.ext.replace(/^(\w)\w+ of /, '$1 · ') : '',
          score: b.status === 'Complete' ? str(b['team' + s + 'Score']) : '', state: slotState(b, s) });
        ys.push(y); t += n;
      });
      var ym = (ys[0] + ys[1]) / 2, ws = b.status === 'Complete' && str(b.winner) ? (str(b.winner) === str(b.team1) ? 1 : 2) : 0;
      connectors.push({ bout: id, col: col, y1: ys[0], y2: ys[1], ym: ym, winSlot: ws, complete: b.status === 'Complete',
                        tiebreak: str(b.resultType) === 'Tiebreaker', label: roundLabel(str(b.notes).replace(/^Women's /, '')) });
      return ym;
    }
    roots.forEach(function (r, i) {
      if (i) cursor += GAP;
      var n = leaves(r.bout), ym = place(r.bout, cursor);
      var w = r.status === 'Complete' ? str(r.winner) : '';
      var wSlot = w ? (w === str(r.team1) ? 1 : 2) : 0;
      outputs.push({ bout: r.bout, col: maxDepth + 1, y: ym, place: placeText(r.notes), team: w,
                     short: wSlot ? str(r['team' + wSlot + 'Short']) : '', color: wSlot ? (r['team' + wSlot + 'Color'] || '') : '' });
      cursor += n;
    });
    // column headings: the round name when every bout in the column shares it
    var cols = [];
    for (var c = 0; c <= maxDepth + 1; c++) {
      var labs = connectors.filter(function (k) { return k.col === c; }).map(function (k) { return k.label; });
      cols.push(c === maxDepth + 1 ? (side === 'champ' ? 'Champion' : 'Places')
        : labs.length && labs.every(function (l) { return l === labs[0]; }) ? labs[0] : '');
    }
    return { cols: cols, total: cursor, lines: lines, connectors: connectors, outputs: outputs, bouts: S.length };
  }

  // Draws bracketLayout() into a positioned container (needs a browser).
  function drawBracket(container, bouts, division, side, opts) {
    opts = opts || {};
    var L = bracketLayout(bouts, division, side);
    container.innerHTML = '';
    if (!L.bouts) return L;
    var W = container.clientWidth || 1840, H = container.clientHeight || 960;
    var top = 34, usableH = H - top - 10, unit = Math.min(140, usableH / Math.max(L.total, 1));
    var ncol = L.cols.length, colW = Math.min(520, W / ncol), pad = 6;
    var X0 = (W - colW * ncol) / 2;                       // small brackets sit in the middle
    top += (usableH - unit * L.total) / 2;
    var font = Math.max(13, Math.min(24, unit * 0.36)), small = Math.max(10, Math.min(13, font * 0.55));
    var Y = function (y) { return top + y * unit; };
    var xL = function (c) { return X0 + c * colW; }, xR = function (c) { return X0 + (c + 1) * colW - (c === ncol - 1 ? pad : 0); };
    var short = function (t, s) { return s && s !== t ? s : t; };
    var done = window.__cjlDone || (window.__cjlDone = {}), first = !window.__cjlDrawn;
    window.__cjlDrawn = true;
    var svg = ['<svg class="br-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
    var html = [];
    L.cols.forEach(function (lab, c) { if (lab) html.push('<div class="br-col" style="left:' + (xL(c) + 4) + 'px;width:' + (colW - 8) + 'px;top:' + Math.max(0, top - 34 - 8) + 'px">' + esc(lab) + '</div>'); });
    var fresh = {};
    L.connectors.forEach(function (k) { if (k.complete && !done[k.bout] && !first) fresh[k.bout] = true; if (k.complete) done[k.bout] = true; });
    L.lines.forEach(function (ln) {
      var y = Y(ln.y), x1 = ln.entry ? (opts.byeFromStart === false ? xL(ln.col) : xL(0)) + pad : xL(ln.col), x2 = xR(ln.col);
      var cls = 'br-line ' + ln.state + (fresh[ln.bout] && ln.state === 'win' ? ' fresh' : '');
      svg.push('<line class="' + cls + '" x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '"/>');
      var tx = (ln.entry ? x1 : xL(ln.col)) + 10, name;
      if (ln.team) name = (ln.color ? '<i style="background:' + esc(ln.color) + '"></i>' : '') +
                          (ln.seed && ln.entry ? '<em>' + esc(ln.seed) + '</em>' : '') + esc(short(ln.team, ln.short));
      else name = ln.label ? '<span class="ph">' + esc(ln.label) + '</span>' : '';
      if (ln.team && ln.from) name += '<span class="from">' + esc(ln.from) + '</span>';
      html.push('<div class="br-name ' + ln.state + (fresh[ln.fedBy] ? ' fresh' : '') + '" style="left:' + tx + 'px;top:' + (y - font * 1.25) + 'px;width:' + (x2 - tx - 34) + 'px;font-size:' + font + 'px">' + name + '</div>');
      if (ln.score !== '') html.push('<div class="br-score ' + ln.state + '" style="left:' + (x2 - 40) + 'px;top:' + (y - font * 1.25) + 'px;font-size:' + font + 'px">' + esc(ln.score) + '</div>');
      if (ln.entry && ln.col > 0) html.push('<div class="br-bye" style="left:' + (xL(ln.col) - 44) + 'px;top:' + (y + 3) + 'px;font-size:' + small + 'px">BYE</div>');
    });
    L.connectors.forEach(function (k) {
      var x = xR(k.col), y1 = Y(k.y1), y2 = Y(k.y2), ym = Y(k.ym);
      svg.push('<line class="br-line pending" x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + y2 + '"/>');
      if (k.winSlot) svg.push('<line class="br-line win' + (fresh[k.bout] ? ' fresh' : '') + '" x1="' + x + '" y1="' + (k.winSlot === 1 ? y1 : y2) + '" x2="' + x + '" y2="' + ym + '"/>');
      html.push('<div class="br-bout" style="left:' + (x - 160) + 'px;width:150px;text-align:right;top:' + (ym - small * 0.7) + 'px;font-size:' + small + 'px">' + esc(k.bout) + (k.tiebreak ? ' · TB' : '') + '</div>');
    });
    L.outputs.forEach(function (o) {
      var y = Y(o.y), x1 = xL(o.col), x2 = xR(o.col);
      svg.push('<line class="br-line ' + (o.team ? 'win out' : 'pending') + (fresh[o.bout] ? ' fresh' : '') + '" x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '"/>');
      html.push('<div class="br-place" style="left:' + (x1 + 10) + 'px;top:' + (y + 4) + 'px;font-size:' + small + 'px">' + (o.place === 'Champion' ? '🏆 ' : '') + esc(o.place) + '</div>');
      if (o.team) html.push('<div class="br-name win champ' + (fresh[o.bout] ? ' fresh' : '') + '" style="left:' + (x1 + 10) + 'px;top:' + (y - font * 1.35) + 'px;width:' + (x2 - x1 - 16) + 'px;font-size:' + (font * 1.1) + 'px">' +
                             (o.color ? '<i style="background:' + esc(o.color) + '"></i>' : '') + esc(short(o.team, o.short)) + '</div>');
    });
    svg.push('</svg>');
    container.innerHTML = svg.join('') + html.join('');
    return L;
  }

  var api = { bracketLayout: bracketLayout, drawBracket: drawBracket, isRoundRobin: isRoundRobin, hasDivision: hasDivision, placeholderLabel: placeholderLabel, bracketRounds: bracketRounds, standings: standings, rounds: rounds, finalBout: finalBout,
              champion: champion, isPlaceholder: isPlaceholder, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CJLRR = api;
})(typeof window !== 'undefined' ? window : globalThis);
