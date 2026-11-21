// Fast broken-CSV reader: a drop-in for csv-reader 1.0.0's readCsv, written from scratch.
// It returns exactly the same {columns, rows, errors} for every {text, header} input,
// but reads the text in bulk instead of one character at a time.
//
// How it works, in outline:
//   - A record with no double quote before its line break is parsed with one slice
//     plus a native split(','); stray CRs inside it are stripped in bulk.
//   - Any other record is parsed field by field. An unquoted field finds its
//     next comma or line break with two native indexOf calls, and a stray CR
//     inside it with one bounded check. A quoted field finds its closing quote
//     with indexOf (doubled quotes skipped in pairs), slices its body once,
//     and only then rewrites "" -> " and CR/CRLF -> LF when the body has any.
//   - "line" is only ever needed at a record's start, so it is kept as a running
//     count and every error of a record is stamped with the line its record started
//     on, exactly like the reference.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const COMMA = 44; // ','
const LF = 10; // '\n'
const CR = 13; // '\r'
const QUOTE = 34; // '"'
const FEFF = 0xFEFF;

// How a field ended: 0 at a comma (the record goes on), 1 at a line break,
// 2 at the end of the text (the record ends).
const END_COMMA = 0;
const END_BREAK = 1;
const END_TEXT = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === FEFF ? 1 : 0;
  let line = 1; // the line the character at pos is on

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Next '"' or LF at or after lastIndex.
  const QUOTE_OR_LF = /["\n]/g;
  const DOUBLED_QUOTE = /""/g;
  const CR_RUN = /\r\n?/g;
  const ANY_CR = /\r/g;

  // How the last field read by scanUnquoted ended.
  let ended = END_TEXT;

  // Reads unquoted characters from pos onto `head` up to the next comma or line
  // break; a CR not followed by LF is dropped (stray_cr). Sets `ended` and
  // advances pos/line; returns the field.
  function scanUnquoted(head) {
    let segs = null; // pieces, only built when a stray CR splits the field
    let segStart = pos;
    for (;;) {
      const c1 = text.indexOf(',', pos);
      const c2 = text.indexOf('\n', pos);
      let d;
      let c;
      if (c1 === -1) { d = c2; c = LF; }
      else if (c2 === -1) { d = c1; c = COMMA; }
      else if (c1 < c2) { d = c1; c = COMMA; }
      else { d = c2; c = LF; }
      if (d === -1) {
        // No comma or LF left: only stray CRs can remain.
        const r = text.indexOf('\r', pos);
        if (r === -1) {
          const tail = text.slice(segStart);
          pos = n;
          ended = END_TEXT;
          if (segs === null) return head === '' ? tail : head + tail;
          segs.push(tail);
          return segs.join('');
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (segs === null) segs = [head];
        segs.push(text.slice(segStart, r));
        pos = r + 1;
        segStart = r + 1;
        continue;
      }
      // A CR just before an LF delimiter is the CRLF terminator, not a stray CR.
      const end = c === LF && d > pos && text.charCodeAt(d - 1) === CR ? d - 1 : d;
      // A stray CR before the field's end?
      const r = text.slice(pos, end).indexOf('\r');
      if (r !== -1) {
        const ri = pos + r;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (segs === null) segs = [head];
        segs.push(text.slice(segStart, ri));
        pos = ri + 1;
        segStart = ri + 1;
        continue;
      }
      const tail = text.slice(segStart, end);
      if (c === COMMA) {
        pos = d + 1;
        ended = END_COMMA;
      } else {
        pos = d + 1;
        line += 1;
        ended = END_BREAK;
      }
      if (segs === null) return head === '' ? tail : head + tail;
      segs.push(tail);
      return segs.join('');
    }
  }

  // Pushes a finished record through the width / header / rows bookkeeping.
  // Returns false when the record is dropped (a line holding only stray CRs).
  function finishRecord(fields, quoted) {
    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) return false;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return true;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    return true;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the first '"' or LF at or after pos. An LF first (or neither
    // before the end) means this record holds no quote at all.
    QUOTE_OR_LF.lastIndex = pos;
    const m = QUOTE_OR_LF.exec(text);
    if (m === null || text.charCodeAt(m.index) === LF) {
      const hasBreak = m !== null;
      const lineEnd = hasBreak ? m.index : n;
      let contentEnd = lineEnd;
      if (hasBreak && contentEnd > pos && text.charCodeAt(contentEnd - 1) === CR) contentEnd -= 1; // CRLF
      let content = text.slice(pos, contentEnd);
      let fields;
      if (content.indexOf('\r') === -1) {
        fields = content.split(',');
      } else {
        // Every CR left here is stray (none is followed by LF).
        let count = 0;
        let ix = -1;
        while ((ix = content.indexOf('\r', ix + 1)) !== -1) count += 1;
        for (let k = 0; k < count; k += 1) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        }
        fields = content.replace(ANY_CR, '').split(',');
      }
      finishRecord(fields, false);
      if (hasBreak) {
        line += 1;
        pos = lineEnd + 1;
      } else {
        pos = n;
      }
      continue;
    }

    // Slow path: this record holds a quote before its line break; read it
    // field by field.
    const fields = [];
    let quoted = false;
    for (;;) {
      const fieldStartLine = line;
      let value;
      if (text.charCodeAt(pos) === QUOTE) {
        quoted = true;
        const open = pos;
        // The closing quote is the first '"' not followed by another '"'.
        let close = -1;
        let i = open + 1;
        for (;;) {
          const j = text.indexOf('"', i);
          if (j === -1) break;
          if (text.charCodeAt(j + 1) === QUOTE) {
            i = j + 2;
            continue;
          }
          close = j;
          break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          line = fieldStartLine;
          pos = open + 1;
          value = scanUnquoted('"');
        } else {
          let body = text.slice(open + 1, close);
          if (body.indexOf('"') !== -1) body = body.replace(DOUBLED_QUOTE, '"');
          if (body.indexOf('\r') !== -1) body = body.replace(CR_RUN, '\n');
          // Each LF left in the body is one line the record spans.
          if (body.indexOf('\n') !== -1) {
            let breaks = 0;
            let bi = -1;
            while ((bi = body.indexOf('\n', bi + 1)) !== -1) breaks += 1;
            line += breaks;
          }
          pos = close + 1;
          if (pos >= n) {
            value = body;
            ended = END_TEXT;
          } else {
            const c = text.charCodeAt(pos);
            if (c === COMMA) {
              pos += 1;
              value = body;
              ended = END_COMMA;
            } else if (c === LF) {
              pos += 1;
              line += 1;
              value = body;
              ended = END_BREAK;
            } else if (c === CR && text.charCodeAt(pos + 1) === LF) {
              pos += 2;
              line += 1;
              value = body;
              ended = END_BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break.
              const before = body.length;
              value = scanUnquoted(body);
              if (value.length > before) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
            }
          }
        }
      } else {
        quoted = false;
        value = scanUnquoted('');
      }
      fields.push(value);
      if (ended !== END_COMMA) break;
    }
    finishRecord(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
