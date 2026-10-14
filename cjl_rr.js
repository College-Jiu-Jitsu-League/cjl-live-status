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
    if (m) return 'Round robin #' + m[1];
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

  var api = { isRoundRobin: isRoundRobin, hasDivision: hasDivision, placeholderLabel: placeholderLabel, bracketRounds: bracketRounds, standings: standings, rounds: rounds, finalBout: finalBout,
              champion: champion, isPlaceholder: isPlaceholder, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CJLRR = api;
})(typeof window !== 'undefined' ? window : globalThis);
