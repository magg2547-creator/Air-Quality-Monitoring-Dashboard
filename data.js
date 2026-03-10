// data.js — State, data normalisation, timestamp parsing

// State
let allData  = [];
let sortCol  = 0;
let sortAsc  = false;
let datePicker = null;

const COL_MAP = {
  'Timestamp':   ['timestamp', 'time', 'datetime', 'date'],
  'PM2.5':       ['pm2.5', 'pm25', 'pm2_5', 'pm2-5'],
  'PM10':        ['pm10', 'pm_10'],
  'Temperature': ['temperature', 'temp', 'tmp'],
  'Humidity':    ['humidity', 'humi', 'humid', 'rh']
};

function normaliseRows(rows) {
    if (!rows || !rows.length) return rows;

    const sample = rows[0];
    const keyMap = {};

    Object.keys(sample).forEach(origKey => {
      const trimmed = origKey.trim();
      const lc      = trimmed.toLowerCase();

      if (COL_MAP[trimmed]) {
        keyMap[origKey] = trimmed;
        return;
      }

      let matched = false;
      for (const [canonical, aliases] of Object.entries(COL_MAP)) {
        if (aliases.includes(lc)) {
          keyMap[origKey] = canonical;
          matched = true;
          break;
        }
      }
      if (!matched) keyMap[origKey] = trimmed;
    });

    return rows.map(row => {
      const out = {};
      Object.entries(row).forEach(([k, v]) => {
        out[keyMap[k] || k] = v;
      });
      return out;
    });
  }

function parseTimestamp(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (value === null || value === undefined) return null;

    const raw = String(value).trim();
    if (!raw) return null;

    const normalized = raw.replace(/\s+/g, ' ');
    const direct = new Date(normalized);
    if (!Number.isNaN(direct.getTime())) return direct;

    const m = normalized.match(
      /^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/
    );
    if (!m) return null;

    let a = Number(m[1]);
    let b = Number(m[2]);
    let c = Number(m[3]);
    const hour = Number(m[4] || 0);
    const minute = Number(m[5] || 0);
    const second = Number(m[6] || 0);

    let year;
    let month;
    let day;

    if (m[1].length === 4) {
      year = a;
      month = b;
      day = c;
    } else if (m[3].length === 4) {
      year = c;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      } else if (b > 12 && a <= 12) {
        month = a;
        day = b;
      } else {
        day = a;
        month = b;
      }
    } else {
      return null;
    }

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 || month > 12 ||
      day < 1 || day > 31
    ) {
      return null;
    }

    const parsed = new Date(year, month - 1, day, hour, minute, second);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
