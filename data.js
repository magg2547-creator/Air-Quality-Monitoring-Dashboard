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
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }

    const raw = String(value).trim();

    // กำหนดรูปแบบวันที่ที่มักจะมาจาก Google Sheets เพื่อให้ Day.js ช่วยแปลง
    const formats = [
      'YYYY-MM-DDTHH:mm:ss.SSSZ', // ISO Format
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DD',
      'DD/MM/YYYY HH:mm:ss',
      'DD/MM/YYYY',
      'MM/DD/YYYY HH:mm:ss',
      'MM/DD/YYYY'
    ];

    // ใช้ dayjs พร้อม plugin (ที่ดึงมาจาก index.html) ช่วยประมวลผล
    const parsed = dayjs(raw, formats, false); 

    if (parsed.isValid()) {
      return parsed.toDate();
    }

    // กรณีที่เจอ Format แปลกๆ ให้ Fallback กลับไปใช้วิธีพื้นฐานของ JavaScript
    const fallbackDate = new Date(raw);
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  }
