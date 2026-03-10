// script.js — Main application logic (rendering, loading, filters, export, QR, bootstrap)
// Depends on: data.js, charts.js  (must be loaded first)
(function (global) {


  /* ===================================================
     STATE
  =================================================== */

  /* ===================================================
     COLUMN NAME NORMALIZER
  =================================================== */
  /* ===================================================
     AUTO-REFRESH / CHART DEFAULTS
  =================================================== */
  const REFRESH_SECS = 300;
  let countdown = REFRESH_SECS;
  let isLoading = false;


  /* ===================================================
     UPDATE CHARTS WITH DATA
  =================================================== */
  /* ===================================================
     GAUGE METER
  =================================================== */
  /* ===================================================
     AIR QUALITY STATUS & DASHBOARD RENDER
  =================================================== */
  function getAQStatus(pm25) {
    if (pm25 <=  50) return { cls: 'status-good',      label: 'Good',      color: '#78be21' };
    if (pm25 <= 100) return { cls: 'status-moderate',  label: 'Moderate',  color: '#f5c400' };
    if (pm25 <= 150) return { cls: 'status-unhealthy', label: 'Unhealthy for Sensitive Groups', color: '#f07d00' };
    return                  { cls: 'status-hazardous', label: 'Unhealthy', color: '#dc2626' };
  }

  function renderDashboard(rows) {
    if (!rows || rows.length === 0) {
      showToast('No data found in the spreadsheet.');
      return;
    }

    allData = rows;
    _dataCacheSource = null;  // invalidate date filter cache
    const n    = rows.length;
    const last = rows[n - 1];
    const prev = n > 1 ? rows[n - 2] : null;

    const pm25 = parseFloat(last['PM2.5'])       || 0;
    const pm10 = parseFloat(last['PM10'])        || 0;
    const temp = parseFloat(last['Temperature']) || 0;
    const hum  = parseFloat(last['Humidity'])    || 0;

    // Current reading cards
    // Remove skeleton
    ['val-pm25','val-pm10','val-temp','val-hum'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('skeleton');
    });
    setText('val-pm25', pm25.toFixed(1), true);
    setText('val-pm10', pm10.toFixed(1), true);
    setText('val-temp', temp.toFixed(1), true);
    setText('val-hum',  hum.toFixed(1), true);

    setDelta('delta-pm25', pm25, prev ? +prev['PM2.5']       : null, '\u00B5g/m\u00B3');
    setDelta('delta-pm10', pm10, prev ? +prev['PM10']        : null, '\u00B5g/m\u00B3');
    setDelta('delta-temp', temp, prev ? +prev['Temperature'] : null, '\u00B0C');
    setDelta('delta-hum',  hum,  prev ? +prev['Humidity']    : null, '%');

    // AQ badge
    const status = getAQStatus(pm25);
    const badge  = document.getElementById('aqBadge');
    badge.className = 'aq-status-badge ' + status.cls;
    document.getElementById('aqDot').style.background = status.color;
    document.getElementById('aqText').textContent =
      status.label + ' - PM2.5 ' + pm25.toFixed(1) + ' \u00B5g/m\u00B3';

    updateGauge(pm25);
    updateGauge10(pm10);
    updateCharts(rows);

    // Analytics: single pass (was 2 separate loops before)
    let pm25Sum = 0, pm25Min = Infinity, pm25Max = -Infinity;
    let tempSum = 0, humSum  = 0;

    for (let i = 0; i < n; i++) {
      const r   = rows[i];
      const v25 = parseFloat(r['PM2.5'])       || 0;
      const vT  = parseFloat(r['Temperature']) || 0;
      const vH  = parseFloat(r['Humidity'])    || 0;
      pm25Sum += v25;
      tempSum += vT;
      humSum  += vH;
      if (v25 < pm25Min) pm25Min = v25;
      if (v25 > pm25Max) pm25Max = v25;
    }

    setText('stat-avgPm25', (pm25Sum / n).toFixed(1), true);
    setText('stat-maxPm25', pm25Max.toFixed(1),         true);
    setText('stat-minPm25', pm25Min.toFixed(1),         true);
    setText('stat-avgTemp', (tempSum / n).toFixed(1),   true);
    setText('stat-avgHum',  (humSum  / n).toFixed(1),   true);
    setText('stat-total',   n,                          true);

    // Reverse once, reuse (was [...rows].reverse() which creates a copy)
    renderTable(rows.slice().reverse());

    // Batch DOM writes - system status
    const now = new Date().toLocaleTimeString('th-TH');
    const latestTimestamp = last['Timestamp'] ? fmtTs(last['Timestamp']) : 'Latest reading available';
    setText('sysLastUpdate', now);
    setText('sysConn',       'Connected');
    setText('sysTotalRec',   n + ' rows');
    updateHeaderMeta(now, latestTimestamp, n + ' total rows');
    setHeaderConnection('Live', 'var(--good)');

    document.getElementById('sysDot').className = 'sys-dot live';

    resetCountdown();
  }

  /* ===================================================
     TABLE & FILTERING
  =================================================== */
  // Cache: pre-parsed ISO date strings per row (rebuilt when allData changes)
  let _dateCache = null;
  let _dataCacheSource = null;

  function getDateCache() {
    if (_dataCacheSource === allData) return _dateCache;
    _dataCacheSource = allData;
    _dateCache = allData.map(r => {
      const d = parseTimestamp(r['Timestamp'] || '');
      return d ? d.toISOString().slice(0, 10) : '';
    });
    return _dateCache;
  }

  function normalizeFilterDate(val) {
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const m = val.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? (m[3] + '-' + m[2] + '-' + m[1]) : val;
  }

  function filterByDate() {
    const val = normalizeFilterDate(document.getElementById('dateFilter').value);
    if (!val) {
      renderTable(allData.slice().reverse());
      setText('filterCount', '');
      updateHeaderMeta(undefined, allData.length ? 'Latest reading available' : 'Latest reading ready', undefined);
      return;
    }

    const cache = getDateCache();
    const filtered = allData.filter((_, i) => cache[i] === val);

    renderTable(filtered.slice().reverse());

    const count = filtered.length;
    const label = document.getElementById('filterCount');
    label.textContent = count > 0 ? `${count} records on this date` : 'No records for this date';
    label.style.color = count > 0 ? 'var(--good)' : 'var(--hazardous)';
    updateHeaderMeta(undefined, 'Filtered: ' + document.getElementById('dateFilter').value, count + ' matching rows');
  }

  function clearDateFilter() {
    if (datePicker) datePicker.clear();
    else document.getElementById('dateFilter').value = '';
    renderTable(allData.slice().reverse());
    setText('filterCount', '');
    updateHeaderMeta(undefined, allData.length ? 'Latest reading available' : 'Latest reading ready', allData.length ? allData.length + ' total rows' : 'No data loaded');
  }

  function initDatePicker() {
    if (!global.flatpickr) return;
    datePicker = global.flatpickr('#dateFilter', {
      dateFormat: 'd/m/Y',
      locale: global.flatpickr.l10ns.th || 'default',
      monthSelectorType: 'static',
      disableMobile: true,
      allowInput: false,
      clickOpens: true,
      onChange: filterByDate
    });
  }
  function renderTable(rows) {
    const tbody = document.getElementById('tableBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="loading-overlay">No records</div></td></tr>';
      return;
    }
    // Use push+join instead of map for large datasets (avoids closure per row)
    const parts = [];
    for (let i = 0, len = rows.length; i < len; i++) {
      const r = rows[i];
      parts.push(
        '<tr><td class="ts">'   + fmtTs(r['Timestamp'] || '') +
        '</td><td class="pm25v">' + ((parseFloat(r['PM2.5'])      || 0).toFixed(1)) +
        '</td><td class="pm10v">' + ((parseFloat(r['PM10'])        || 0).toFixed(1)) +
        '</td><td class="tempv">' + ((parseFloat(r['Temperature']) || 0).toFixed(1)) +
        '</td><td class="humv">'  + ((parseFloat(r['Humidity'])    || 0).toFixed(1)) +
        '</td></tr>'
      );
    }
    tbody.innerHTML = parts.join('');
    // Stagger animation: cap at 20 rows to avoid perf hit
    const rows2 = tbody.querySelectorAll('tr');
    const cap = Math.min(rows2.length, 20);
    for (let i = 0; i < cap; i++) {
      rows2[i].style.animationDelay = (i * 18) + 'ms';
    }
  }

  function updateSortIndicators() {
    const headers = document.querySelectorAll('#dataTable th[data-sort-col]');
    headers.forEach(th => {
      const isActive = Number(th.dataset.sortCol) === sortCol;
      th.setAttribute('aria-sort', isActive ? (sortAsc ? 'ascending' : 'descending') : 'none');
    });
  }

  function sortTable(col) {
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = true; }

    const keys = ['Timestamp', 'PM2.5', 'PM10', 'Temperature', 'Humidity'];
    const key  = keys[col];
    const sorted = [...allData].sort((a, b) => {
      const av = col === 0 ? (parseTimestamp(a[key])?.getTime() ?? Number.NEGATIVE_INFINITY) : +a[key];
      const bv = col === 0 ? (parseTimestamp(b[key])?.getTime() ?? Number.NEGATIVE_INFINITY) : +b[key];
      return (av > bv ? 1 : av < bv ? -1 : 0) * (sortAsc ? 1 : -1);
    });
    renderTable(sorted);
    updateSortIndicators();
  }

  /* ===================================================
     SPLASH & TOP BAR
  =================================================== */
  function splashProgress(pct, msg) {
    document.getElementById('splashBar').style.width    = pct + '%';
    document.getElementById('splashStatus').textContent = msg;
  }

  function splashHide() {
    splashProgress(100, 'Ready');
    setTimeout(() => {
      document.getElementById('splash').classList.add('hide');
    }, 400);
  }

  function topBarStart() {
    const b = document.getElementById('topBar');
    b.style.transition = 'width .3s ease, opacity .1s ease';
    b.style.opacity    = '1';
    b.style.width      = '70%';
    b.classList.add('running');
  }

  function topBarDone() {
    const b = document.getElementById('topBar');
    b.classList.remove('running');
    b.style.transition = 'width .25s ease, opacity .5s ease .3s';
    b.style.width      = '100%';
    setTimeout(() => { b.style.opacity = '0'; b.style.width = '0%'; }, 500);
  }

  function topBarError() {
    const b = document.getElementById('topBar');
    b.classList.remove('running');
    b.style.background = '#dc2626';
    b.style.width      = '100%';
    setTimeout(() => {
      b.style.opacity    = '0';
      b.style.width      = '0%';
      b.style.background = 'linear-gradient(90deg,#0284c7,#7c3aed,#0284c7)';
      b.style.backgroundSize = '200% 100%';
    }, 600);
  }

  /* ===================================================
     DATA LOADING - fetch + CORS, JSONP fallback
  =================================================== */
  function loadData() {
    const url = document.getElementById('sheetsUrl').value.trim();
    if (!url) { showToast('Please enter an Apps Script URL.'); return; }

    isLoading = true;
    showToast('Loading data...');
    setText('sysConn', 'Loading...');
    updateHeaderMeta('Refreshing now...', 'Checking data source...', allData.length ? allData.length + ' cached rows' : 'Preparing dataset');
    setHeaderConnection('Syncing', 'var(--accent)');
    topBarStart();
    ['val-pm25','val-pm10','val-temp','val-hum'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('skeleton');
    });
    fetchLoad(url);
  }

  function fetchLoad(url) {
    const sep     = url.includes('?') ? '&' : '?';
    const fullUrl = url + sep + '_t=' + Date.now();
    let   done    = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true; isLoading = false;
      topBarError();
      splashProgress(100, 'Timeout');
      setTimeout(() => document.getElementById('splash').classList.add('hide'), 800);
      showToast('Request timed out. Check the URL and deploy permissions.');
      setText('sysConn', 'Timeout');
      updateHeaderMeta('Sync timeout', 'Connection needs attention', allData.length ? allData.length + ' cached rows' : 'No cached data');
      setHeaderConnection('Issue', 'var(--hazardous)');
      document.getElementById('sysDot').className = 'sys-dot err';
    }, 15000);

    fetch(fullUrl)
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.text(); })
      .then(text => {
        if (done) return;
        clearTimeout(timer); done = true;
        let json;
        const t = text.trim();
        if (t.startsWith('[') || t.startsWith('{')) {
          json = JSON.parse(t);
        } else {
          const m = t.match(/[^(]+[(](.+)[)]\s*;?\s*$/s);
          if (!m) throw new Error('Unsupported response format');
          json = JSON.parse(m[1]);
        }
        const raw  = Array.isArray(json) ? json : (json.data || json.values || []);
        const rows = normaliseRows(raw);
        console.log('[AQM] fetch OK -', rows.length, 'rows');
        isLoading = false;
        renderDashboard(rows);
        topBarDone(); splashHide();
        showToast('Loaded ' + rows.length + ' rows successfully.');
      })
      .catch(err => {
        if (done) return;
        clearTimeout(timer);
        console.warn('[AQM] fetch failed, JSONP fallback...', err.message);
        jsonpFallback(document.getElementById('sheetsUrl').value.trim());
      });
  }

  function jsonpFallback(url) {
    const old = document.getElementById('__aqmScript');
    if (old) old.remove();
    const cbName  = '__aqmCb';
    const sep     = url.includes('?') ? '&' : '?';
    const fullUrl = url + sep + 'callback=' + cbName + '&_t=' + Date.now();

    const onFail = (msg) => {
      delete global[cbName];
      const s = document.getElementById('__aqmScript');
      if (s) s.remove();
      isLoading = false; topBarError();
      splashProgress(100, 'Connection failed');
      setTimeout(() => document.getElementById('splash').classList.add('hide'), 800);
      showToast(msg);
      setText('sysConn', 'Error');
      updateHeaderMeta('Connection failed', 'Unable to reach source', allData.length ? allData.length + ' cached rows' : 'No cached data');
      setHeaderConnection('Issue', 'var(--hazardous)');
      document.getElementById('sysDot').className = 'sys-dot err';
    };

    const timer = setTimeout(() => onFail('Timeout - check the URL and deploy permissions'), 15000);

    global[cbName] = function(json) {
      clearTimeout(timer);
      delete global[cbName];
      const s = document.getElementById('__aqmScript');
      if (s) s.remove();
      try {
        const raw  = Array.isArray(json) ? json : (json.data || json.values || []);
        const rows = normaliseRows(raw);
        console.log('[AQM] JSONP OK -', rows.length, 'rows');
        isLoading = false;
        renderDashboard(rows); topBarDone(); splashHide();
        showToast('Loaded ' + rows.length + ' rows successfully.');
      } catch(e) { onFail('Parse error: ' + e.message); }
    };

    const script   = document.createElement('script');
    script.id      = '__aqmScript';
    script.src     = fullUrl;
    script.onerror = () => { clearTimeout(timer); onFail('Load failed - check the URL and deploy permissions'); };
    document.head.appendChild(script);
  }

  /* ===================================================
     EXPORT / CSV
  =================================================== */
  function exportPDF() {
    if (!allData.length) {
      showToast('No data yet - click Reload Data first.');
      return;
    }

    const now = new Date().toLocaleString('th-TH', { dateStyle:'long', timeStyle:'short' });

    const esc = v => String(v ?? '--').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const fmtForPdf = ts => {
      const d = new Date(ts);
      if (isNaN(d)) return esc(ts);
      return d.toLocaleString('th-TH', {
        year:'numeric',
        month:'2-digit',
        day:'2-digit',
        hour:'2-digit',
        minute:'2-digit',
        second:'2-digit',
        hour12: false
      });
    };

    const rows = [...allData].reverse();
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${fmtForPdf(r['Timestamp'])}</td>
        <td>${(+r['PM2.5'] || 0).toFixed(1)}</td>
        <td>${(+r['PM10']  || 0).toFixed(1)}</td>
        <td>${(parseFloat(r['Temperature']) || 0).toFixed(1)}</td>
        <td>${(parseFloat(r['Humidity'])    || 0).toFixed(1)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Historical Data - Air Quality</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; background: #fff; color: #0f172a; padding: 32px 40px; font-size: 11pt; }
    .report-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #0284c7; }
    .logo { width: 46px; height: 46px; background: linear-gradient(135deg,#0284c7,#7c3aed); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; }
    .report-header h1 { font-size: 16pt; font-weight: 700; }
    .report-header p  { font-size: 9pt; color: #64748b; margin-top: 2px; }
    .meta { display: flex; gap: 24px; margin-bottom: 18px; font-size: 9pt; color: #64748b; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    thead tr { background: #0284c7; color: #fff; }
    thead th { padding: 9px 12px; text-align: left; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; }
    thead th:not(:first-child) { text-align: right; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody td { padding: 7px 12px; border-bottom: 1px solid #e2e8f0; color: #334155; }
    tbody td:first-child { color: #64748b; font-size: 9pt; }
    tbody td:not(:first-child) { font-weight: 600; text-align: right; }
    .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 8pt; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } body { padding: 20px 28px; } }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="logo" style="background:none;box-shadow:none;padding:0;overflow:hidden"><svg width="40" height="40" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad3" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="80" height="80" rx="22" fill="url(#grad3)"/>
  <path d="M28 52 C28 52 20 36 36 24 C52 12 60 28 52 38 C46 46 34 44 28 52Z" fill="white" fill-opacity="0.95"/>
  <path d="M28 52 C32 44 40 38 48 30" stroke="#0284c7" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M55 34 C58 34 61 31 61 28" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.85"/>
  <path d="M55 40 C61 40 66 36 66 30" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6"/>
  <path d="M55 46 C63 46 70 40 70 32" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.35"/>
</svg></div>
    <div><h1>Historical Data Report</h1><p>Air Quality Monitoring System</p></div>
  </div>
  <div class="meta">
    <span>Export: ${now}</span>
    <span>Total: ${rows.length} records</span>
  </div>
  <table>
    <thead><tr><th>Timestamp</th><th>PM2.5 (&micro;g/m&sup3;)</th><th>PM10 (&micro;g/m&sup3;)</th><th>Temp (&deg;C)</th><th>Humidity (%)</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer"><span>Air Quality Monitoring Dashboard</span><span>${now}</span></div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (win) {
      win.addEventListener('afterprint', () => URL.revokeObjectURL(url));
    } else {
      showToast('Please allow pop-ups in your browser first.');
      URL.revokeObjectURL(url);
    }
  }

  function downloadCSV() {
    if (!allData.length) {
      showToast('No data yet - click Reload Data first.');
      return;
    }

    const headers = ['Timestamp', 'PM2.5', 'PM10', 'Temperature', 'Humidity'];
    const lines   = [
      headers.join(','),
      ...allData.map(r =>
        headers.map(h => `"${(r[h] !== undefined ? r[h] : '')}"`).join(',')
      )
    ];

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href     = URL.createObjectURL(blob);
    link.download = 'air_quality_' + new Date().toISOString().slice(0, 10) + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('CSV downloaded (' + allData.length + ' rows).');
  }

  /* ===================================================
     AUTO-REFRESH TICK
  =================================================== */
  function resetCountdown() {
    countdown = REFRESH_SECS;
  }

  setInterval(() => {
    // Pause the countdown during loading and resume when fresh data arrives.
    if (isLoading) return;

    countdown = Math.max(0, countdown - 1);

    if (countdown === 0) {
      countdown = REFRESH_SECS;
      if (document.getElementById('sheetsUrl').value.trim()) {
        loadData();
      }
    }

    const pct  = (countdown / REFRESH_SECS) * 100;
    const mins = Math.floor(countdown / 60);
    const secs = String(countdown % 60).padStart(2, '0');

    document.getElementById('refreshFill').style.width    = pct + '%';
    document.getElementById('countdownText').textContent  = `${mins}:${secs}`;
  }, 1000);

  /* ===================================================
     HELPERS
  =================================================== */

  function setText(id, val, animate = false) {
    const el = document.getElementById(id);
    if (!el) return;
    if (animate && el.textContent !== String(val)) {
      el.classList.remove('updating', 'pop');
      void el.offsetWidth; // force reflow
      el.classList.add(el.classList.contains('card-value') ? 'updating' :
                       el.classList.contains('analytics-value') || el.classList.contains('gauge-number') ? 'pop' : '');
      el.textContent = val;
      el.addEventListener('animationend', () => el.classList.remove('updating','pop'), { once: true });
    } else {
      el.textContent = val;
    }
  }
  function updateHeaderMeta(lastSync, rangeText, recordText) {
    if (lastSync !== undefined) setText('headerLastSync', lastSync);
    if (rangeText !== undefined) setText('headerRange', rangeText);
    if (recordText !== undefined) setText('headerRecordCount', recordText);
  }

  function setHeaderConnection(state, color) {
    setText('headerStatus', state);
    const hd = document.getElementById('headerDot');
    if (!hd) return;
    hd.classList.remove('live-glow');
    hd.style.background = color;
    hd.style.boxShadow = color === 'var(--good)' ? '0 0 7px var(--good)' : color === 'var(--accent)' ? '0 0 7px rgba(2,132,199,0.35)' : '0 0 7px rgba(220,38,38,0.2)';
    if (state === 'Live') hd.classList.add('live-glow');
  }

  function setDelta(id, cur, prev, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    if (prev === null || isNaN(prev)) {
      el.textContent = 'Latest reading';
      el.style.color = '';
      return;
    }
    const diff = cur - prev;
    const sign = diff > 0 ? '+' : '';
    el.textContent = `${sign}${diff.toFixed(1)} ${unit} vs prev`;
    el.style.color = diff > 0 ? 'var(--hazardous)' : diff < 0 ? 'var(--good)' : 'var(--muted)';
  }

  function fmtTs(ts, short = false) {
    if (!ts) return '--';
    const d = parseTimestamp(ts);
    if (!d) return String(ts);
    if (short) return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3800);
  }


  /* ===================================================
     QR CODE
  =================================================== */
  let _qrInstance = null;
  let lastFocusedElement = null;

  const STORAGE_KEY   = 'aqm-script-url';
  const DASHBOARD_URL = global.location.href;

  function openQR() {
    lastFocusedElement = document.activeElement;
    const modal   = document.getElementById('qrModal');
    const wrap    = document.getElementById('qrCanvas');
    const urlText = document.getElementById('qrUrlText');

    urlText.textContent = DASHBOARD_URL;
    wrap.innerHTML = '';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => { const closeBtn = modal.querySelector('.qr-close'); if (closeBtn) closeBtn.focus(); }, 0);

    if (!global.QRCode) {
      wrap.innerHTML = '<div style="padding:24px 18px;border:1px dashed #cbd5e1;border-radius:14px;color:#64748b;font-size:0.82rem;text-align:center">QR library unavailable<br>Open this link directly instead.</div>';
      showToast('QR generator is unavailable right now.');
      return;
    }

    try {
      _qrInstance = new QRCode(wrap, {
        text: DASHBOARD_URL,
        width: 220,
        height: 220,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (err) {
      wrap.innerHTML = '<div style="padding:24px 18px;border:1px dashed #cbd5e1;border-radius:14px;color:#64748b;font-size:0.82rem;text-align:center">Unable to render QR<br>Open this link directly instead.</div>';
      showToast('Unable to render QR code.');
      return;
    }

    setTimeout(() => {
      const qrImg = wrap.querySelector('img') || wrap.querySelector('canvas');
      if (!qrImg) return;

      const c = document.createElement('canvas');
      c.width = 220;
      c.height = 220;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      const drawLogo = () => {
        ctx.drawImage(qrImg, 0, 0, 220, 220);
        const logoSize = 48;
        const x = (220 - logoSize) / 2;
        const y = (220 - logoSize) / 2;

        ctx.save();
        ctx.fillStyle = '#ffffff';
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(x - 4, y - 4, logoSize + 8, logoSize + 8, 12);
          ctx.shadowColor = 'rgba(0,0,0,0.15)';
          ctx.shadowBlur = 6;
          ctx.fill();
        } else {
          ctx.fillRect(x - 4, y - 4, logoSize + 8, logoSize + 8);
        }
        ctx.restore();

        const svgStr = `<svg width="${logoSize}" height="${logoSize}" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="gL" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#0284c7"/>
              <stop offset="100%" stop-color="#7c3aed"/>
            </linearGradient>
          </defs>
          <rect width="80" height="80" rx="22" fill="url(#gL)"/>
          <path d="M28 52 C28 52 20 36 36 24 C52 12 60 28 52 38 C46 46 34 44 28 52Z" fill="white" fill-opacity="0.95"/>
          <path d="M28 52 C32 44 40 38 48 30" stroke="#0284c7" stroke-width="2" stroke-linecap="round" fill="none"/>
          <path d="M55 34 C58 34 61 31 61 28" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.85"/>
          <path d="M55 40 C61 40 66 36 66 30" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6"/>
          <path d="M55 46 C63 46 70 40 70 32" stroke="white" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.35"/>
        </svg>`;
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, x, y, logoSize, logoSize);
          URL.revokeObjectURL(svgUrl);
          qrImg.replaceWith(c);
        };
        img.src = svgUrl;
      };

      if (qrImg.tagName === 'IMG') {
        if (qrImg.complete) drawLogo();
        else qrImg.onload = drawLogo;
      } else {
        drawLogo();
      }
    }, 50);
  }

  function closeQR() {
    const modal = document.getElementById('qrModal');
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    _qrInstance = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  // Close the QR modal with Escape.
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQR(); });

  /* ===================================================
     STARTUP & SETTINGS
  =================================================== */
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzQVa8DL21CDDQTb4ffwNd8UQSwQXItb23IMkQjTQRzaFr73s_Vd2z28IJrZ5tJeRttCg/exec';

  function bootstrap() {
    initCharts();
    initGauge();
    initDatePicker();

    splashProgress(30, 'Starting dashboard...');
    const savedUrl = global.localStorage.getItem(STORAGE_KEY);
    document.getElementById('sheetsUrl').value = savedUrl || SCRIPT_URL;

    setTimeout(() => splashProgress(60, 'Loading latest data...'), 300);
    loadData();

    let logoClickCount = 0;
    let logoClickTimer = null;
    const logoTrigger = document.getElementById('logoTrigger');

    logoTrigger.addEventListener('click', function() {
      logoClickCount++;
      clearTimeout(logoClickTimer);
      logoClickTimer = setTimeout(() => { logoClickCount = 0; }, 600);

      if (logoClickCount >= 3) {
        logoClickCount = 0;
        const panel = document.getElementById('settingsPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    });

    logoTrigger.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        logoTrigger.click();
      }
    });

    document.querySelectorAll('#dataTable th[data-sort-col]').forEach(th => {
      th.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          sortTable(Number(th.dataset.sortCol));
        }
      });
    });

    updateSortIndicators();
  }

  function closeSettings() {
    document.getElementById('settingsPanel').style.display = 'none';
  }

  function saveAndLoad() {
    const url = document.getElementById('sheetsUrl').value.trim();
    if (!url) {
      showToast('Please enter an Apps Script URL.');
      return;
    }
    global.localStorage.setItem(STORAGE_KEY, url);
    closeSettings();
    loadData();
    showToast('Saved URL and started loading data.');
  }

  // Public API exposed for HTML event handlers
  global.AirQualityDashboard = {
    bootstrap,
    loadData,
    exportPDF,
    downloadCSV,
    filterByDate,
    clearDateFilter,
    saveAndLoad,
    closeSettings,
    sortTable
  };

  // Maintain backward compatibility with existing inline handlers (if any)
  global.loadData      = loadData;
  global.exportPDF     = exportPDF;
  global.downloadCSV   = downloadCSV;
  global.filterByDate  = filterByDate;
  global.clearDateFilter = clearDateFilter;
  global.saveAndLoad   = saveAndLoad;
  global.closeSettings = closeSettings;
  global.sortTable     = sortTable;
  global.openQR        = openQR;
  global.closeQR       = closeQR;

  // Kick off app once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
