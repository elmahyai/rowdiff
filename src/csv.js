// RFC4180 CSV parsing with delimiter sniffing. No dependencies, no streaming assumptions:
// the whole file is materialised because diffing needs both sides in memory anyway.

const CANDIDATES = [',', ';', '\t', '|'];

export class CsvError extends Error {}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Accepts a string, Buffer (Node) or ArrayBuffer/Uint8Array (browser) so the same
// parser runs in the CLI and in the static web app.
export function decode(buf) {
  if (typeof buf === 'string') return stripBom(buf);

  let bytes;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) bytes = buf;
  else if (buf instanceof Uint8Array) bytes = buf;
  else if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf);
  else return stripBom(String(buf));

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripBom(new TextDecoder('utf-16le').decode(bytes.subarray(2)));
  }
  return stripBom(new TextDecoder('utf-8').decode(bytes));
}

// Pick the delimiter that yields the most consistent column count across the first
// non-empty lines. Ties go to the earlier candidate, which keeps comma-default behaviour.
export function sniffDelimiter(text) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '') lines.push(line);
    if (lines.length >= 20) break;
  }
  if (lines.length === 0) return ',';

  let best = { delim: ',', score: -1 };
  for (const delim of CANDIDATES) {
    const counts = lines
      .map((line) => splitRecord(line, delim).length)
      .filter((n) => n > 1);
    if (counts.length === 0) continue;
    const mode = counts[0];
    const consistent = counts.filter((n) => n === mode).length;
    const score = consistent * 1000 + mode;
    if (score > best.score) best = { delim, score };
  }
  return best.delim;
}

// Single-record split honouring quotes; used for sniffing where embedded newlines
// cannot appear (we only look at physical lines).
function splitRecord(line, delim) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

export function parseRecords(text, delim) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let sawAnyChar = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
      sawAnyChar = true;
      i++;
      continue;
    }
    if (ch === delim) {
      endField();
      sawAnyChar = true;
      i++;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      endRecord();
      sawAnyChar = false;
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      endRecord();
      sawAnyChar = false;
      i++;
      continue;
    }
    field += ch;
    sawAnyChar = true;
    i++;
  }

  if (quoted) throw new CsvError('Unterminated quoted field (missing closing ")');
  if (sawAnyChar || field !== '' || record.length > 0) endRecord();

  // Drop a trailing record that is a single empty field: that is the newline at EOF.
  while (records.length > 0) {
    const last = records[records.length - 1];
    if (last.length === 1 && last[0] === '') records.pop();
    else break;
  }
  return records;
}

export function parse(input, options = {}) {
  const text = decode(input);
  const delimiter = options.delimiter === 'auto' || options.delimiter == null
    ? sniffDelimiter(text)
    : options.delimiter;
  if (text.trim() === '') {
    return { header: [], rows: [], delimiter, duplicateHeaders: [], widths: new Set() };
  }

  const records = parseRecords(text, delimiter);
  if (records.length === 0) {
    return { header: [], rows: [], delimiter, duplicateHeaders: [], widths: new Set() };
  }

  const header = records[0].map((h) => h.trim());
  const duplicateHeaders = header.filter((h, idx) => header.indexOf(h) !== idx);
  const widths = new Set(records.map((r) => r.length));
  const rows = [];

  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length === 1 && rec[0] === '') continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      const name = header[c] || `column_${c + 1}`;
      obj[name] = rec[c] === undefined ? '' : rec[c];
    }
    rows.push(obj);
  }

  return { header, rows, delimiter, duplicateHeaders, widths };
}
