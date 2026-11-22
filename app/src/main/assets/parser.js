/* WhatsApp chat export parser. Works in the browser and in Node (for tests). */
(function (root) {
  'use strict';

  var INVISIBLE = /[‎‏‪-‮﻿]/g;
  var DATE = '(\\d{1,4})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{1,4})';
  var TIME = '(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?';
  var AMPM = '(?:[\\s\\u202f\\u00a0]*([AaPp])\\.?[Mm]\\.?)?';

  // iOS:     [31/12/23, 9:41:05 PM] Name: text
  var RE_IOS = new RegExp('^\\[\\s*' + DATE + ',?\\s+' + TIME + AMPM + '\\s*\\]\\s?(.*)$');
  // Android: 31/12/2023, 21:41 - Name: text
  var RE_AND = new RegExp('^' + DATE + ',?\\s+' + TIME + AMPM + '\\s+[-\\u2013]\\s+(.*)$');

  var OMITTED = /^(<media omitted>|<attached: [^>]*>|(image|video|audio|sticker|document|gif|contact card|voice call|video call) omitted)$/i;

  function matchHeader(line) {
    var m = RE_IOS.exec(line) || RE_AND.exec(line);
    if (!m) return null;
    return {
      a: m[1], b: m[2], c: m[3],
      hh: +m[4], mm: +m[5], ss: m[6] ? +m[6] : 0,
      ap: m[7] ? m[7].toLowerCase() : '',
      rest: m[8]
    };
  }

  function detectOrder(headers) {
    var dmy = false, mdy = false, ymd = false;
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (h.a.length === 4) { ymd = true; continue; }
      if (+h.a > 12) dmy = true;
      if (+h.b > 12) mdy = true;
    }
    if (ymd) return 'ymd';
    if (dmy && !mdy) return 'dmy';
    if (mdy && !dmy) return 'mdy';
    return 'dmy';
  }

  function makeDate(h, order) {
    var d, mo, y;
    if (order === 'ymd') { y = +h.a; mo = +h.b; d = +h.c; }
    else if (order === 'mdy') { mo = +h.a; d = +h.b; y = +h.c; }
    else { d = +h.a; mo = +h.b; y = +h.c; }
    if (y < 100) y += 2000;
    var hr = h.hh;
    if (h.ap === 'p' && hr < 12) hr += 12;
    if (h.ap === 'a' && hr === 12) hr = 0;
    return new Date(y, mo - 1, d, hr, h.mm, h.ss).getTime();
  }

  function classify(msg) {
    // Detect an attached file or an omitted-media marker on the first line.
    var lines = msg.text.split('\n');
    var first = lines[0].trim();
    var m = /^<attached:\s*([^>]+?)\s*>$/i.exec(first);
    var f = /^(.+?)\s+\((?:file attached)\)$/i.exec(first);
    if (m) { msg.media = { file: m[1] }; msg.text = lines.slice(1).join('\n'); }
    else if (f) { msg.media = { file: f[1] }; msg.text = lines.slice(1).join('\n'); }
    else if (OMITTED.test(first)) { msg.media = { omitted: true }; msg.text = lines.slice(1).join('\n'); }
  }

  /**
   * parse(text, opts) -> { messages, senders, order }
   * opts.order: 'dmy' | 'mdy' | 'ymd' to override auto-detection.
   */
  function parse(text, opts) {
    opts = opts || {};
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    var parsed = [], headers = [];
    for (var i = 0; i < lines.length; i++) {
      var clean = lines[i].replace(INVISIBLE, '');
      var h = matchHeader(clean);
      if (h) { headers.push(h); parsed.push({ h: h }); }
      else parsed.push({ cont: lines[i].replace(/[‎‏﻿]/g, '') });
    }
    var order = opts.order || detectOrder(headers);
    var messages = [], senders = [], seen = {}, cur = null;
    for (var j = 0; j < parsed.length; j++) {
      var p = parsed[j];
      if (p.h) {
        var rest = p.h.rest;
        var idx = rest.indexOf(': ');
        var msg = { ts: makeDate(p.h, order), sender: '', text: '', system: false };
        if (idx > 0 && idx <= 60 && rest.charAt(0) !== ' ') {
          msg.sender = rest.slice(0, idx);
          msg.text = rest.slice(idx + 2);
          if (!seen[msg.sender]) { seen[msg.sender] = 1; senders.push(msg.sender); }
        } else {
          msg.system = true;
          msg.text = rest;
        }
        messages.push(msg);
        cur = msg;
      } else if (cur) {
        cur.text += '\n' + p.cont;
      }
    }
    for (var k = 0; k < messages.length; k++) {
      var mm = messages[k];
      mm.text = mm.text.replace(/\s+$/, '');
      if (!mm.system) classify(mm);
    }
    return { messages: messages, senders: senders, order: order };
  }

  function titleFromFilename(name) {
    var base = String(name || '').replace(/\.(txt|zip)$/i, '');
    var m = /WhatsApp Chat (?:with|-)\s+(.+)$/i.exec(base);
    return m ? m[1].trim() : base.trim();
  }

  root.WAParser = { parse: parse, titleFromFilename: titleFromFilename };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WAParser;
})(typeof window !== 'undefined' ? window : globalThis);
