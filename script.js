// script.js — Main application logic (rendering, loading, filters, export, QR, bootstrap)
// Depends on: data.js, charts.js  (must be loaded first)
(function (global) {


  /* ===================================================
     STATE & AUTO-REFRESH & NOTIFICATION
  =================================================== */
  let currentRefreshSecs = 300;
  let countdown = currentRefreshSecs;
  let isLoading = false;
  let isPaused = false;
  
  // สถานะ Pagination
  let currentPage = 1;
  const TABLE_ROWS_PER_PAGE = 25;
  let currentViewData = []; // เก็บข้อมูลที่ถูกฟิลเตอร์แล้วเพื่อเอามาแบ่งหน้า

  // สถานะ Notification
  let notificationsEnabled = false;
  let lastAlertTimestamp = null;


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

    checkAirQualityAlert(last);

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
    currentViewData = rows;
    currentPage = 1;
    renderTablePage();
  }

  function renderTablePage() {
    const tbody = document.getElementById('tableBody');
    if (!currentViewData.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="loading-overlay">No records</div></td></tr>';
      document.getElementById('pageInfo').textContent = 'หน้า 1 / 1';
      document.getElementById('btnPrevPage').disabled = true;
      document.getElementById('btnNextPage').disabled = true;
      return;
    }

    const totalPages = Math.ceil(currentViewData.length / TABLE_ROWS_PER_PAGE) || 1;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * TABLE_ROWS_PER_PAGE;
    const end = start + TABLE_ROWS_PER_PAGE;
    const pageRows = currentViewData.slice(start, end);

    const parts = [];
    for (let i = 0, len = pageRows.length; i < len; i++) {
      const r = pageRows[i];
      parts.push(
        '<tr><td class="ts">'   + escapeHTML(fmtTs(r['Timestamp'] || '')) +
        '</td><td class="pm25v">' + escapeHTML((parseFloat(r['PM2.5'])      || 0).toFixed(1)) +
        '</td><td class="pm10v">' + escapeHTML((parseFloat(r['PM10'])        || 0).toFixed(1)) +
        '</td><td class="tempv">' + escapeHTML((parseFloat(r['Temperature']) || 0).toFixed(1)) +
        '</td><td class="humv">'  + escapeHTML((parseFloat(r['Humidity'])    || 0).toFixed(1)) +
        '</td></tr>'
      );
    }
    tbody.innerHTML = parts.join('');

    // อัปเดตสถานะปุ่มหน้าถัดไป/ย้อนกลับ
    document.getElementById('pageInfo').textContent = `หน้า ${currentPage} / ${totalPages}`;
    document.getElementById('btnPrevPage').disabled = (currentPage === 1);
    document.getElementById('btnNextPage').disabled = (currentPage === totalPages);

    const rowsDOM = tbody.querySelectorAll('tr');
    const cap = Math.min(rowsDOM.length, 20);
    for (let i = 0; i < cap; i++) {
      rowsDOM[i].style.animationDelay = (i * 18) + 'ms';
    }
  }

  function changePage(dir) {
    currentPage += dir;
    renderTablePage();
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
  function confirmExportPDF() {
    closeExportModal(); // ปิดหน้าต่าง Popup ก่อน

    if (!allData.length) {
      showToast('No data yet - click Reload Data first.');
      return;
    }

    // 1. ดึงค่าจากช่องค้นหาวันที่ในหน้าต่าง Popup
    const filterInput = document.getElementById('pdfDateFilter').value;
    const filterVal = normalizeFilterDate(filterInput);
    
    // 2. กรองข้อมูลที่จะนำไป Export
    let rowsToExport = allData;
    if (filterVal) {
      const cache = getDateCache();
      rowsToExport = allData.filter((_, i) => cache[i] === filterVal);
    }

    if (!rowsToExport.length) {
      showToast('No records found for the selected date.');
      return;
    }
    
    showToast('Generating PDF... Please wait.');

    const now = dayjs().format('D MMMM YYYY, HH:mm');
    const rows = [...rowsToExport].reverse(); 

    // 3. ปรับเปลี่ยนข้อความหัวเรื่องให้สอดคล้องกับการค้นหา
    const reportTitleText = filterInput ? `Daily Data Report: ${filterInput}` : 'Historical Data Report';

    const container = document.createElement('div');
    container.style.padding = '20px';
    container.style.fontFamily = "'DM Sans', sans-serif";
    container.style.color = '#0f172a';

    const reportHeader = `
      <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #0284c7;">
        <div>
          <h1 style="font-size: 18px; font-weight: 700; margin: 0;">${reportTitleText}</h1>
          <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">Air Quality Monitoring System</p>
        </div>
      </div>
      <div style="display: flex; gap: 24px; margin-bottom: 18px; font-size: 11px; color: #64748b;">
        <span>Export: ${now}</span>
        <span>Total: ${rows.length} records</span>
      </div>
    `;

    const rowsPerPage = 25; 
    let tablesHtml = '';

    for (let i = 0; i < rows.length; i += rowsPerPage) {
      const chunk = rows.slice(i, i + rowsPerPage);
      
      const rowsHtml = chunk.map((r, index) => `
        <tr style="background: ${(i + index) % 2 === 0 ? '#ffffff' : '#f8fafc'}; page-break-inside: avoid;">
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">${escapeHTML(fmtTs(r['Timestamp']))}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(+r['PM2.5'] || 0).toFixed(1)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(+r['PM10']  || 0).toFixed(1)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(parseFloat(r['Temperature']) || 0).toFixed(1)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 600; font-size: 11px;">${(parseFloat(r['Humidity'])    || 0).toFixed(1)}</td>
        </tr>`).join('');

      const pageBreak = i > 0 ? '<div style="page-break-before: always; margin-top: 20px;"></div>' : '';

      tablesHtml += `
        ${pageBreak}
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="background: #0284c7; color: #fff;">
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase;">Timestamp</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">PM2.5</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">PM10</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">Temp (&deg;C)</th>
              <th style="padding: 10px 12px; font-size: 10px; text-transform: uppercase; text-align: right;">Humidity (%)</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    }

    container.innerHTML = reportHeader + tablesHtml;

    const opt = {
      margin:       10,
      filename:     filterInput ? `AirQuality_${filterInput.replace(/\//g, '-')}.pdf` : `AirQuality_All_${dayjs().format('YYYYMMDD_HHmm')}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:    { mode: ['css', 'legacy'] }
    };

    html2pdf().set(opt).from(container).save().then(() => {
      showToast('PDF downloaded successfully.');
    }).catch(err => {
      showToast('Error generating PDF.');
      console.error(err);
    });
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
    if (!isPaused) {
      countdown = currentRefreshSecs;
    }
  }

  function changeRefreshInterval(val) {
    const v = parseInt(val, 10);
    if (v === -1) {
      isPaused = true;
      document.getElementById('countdownText').textContent = 'Paused';
      document.getElementById('refreshFill').style.width = '0%';
    } else {
      isPaused = false;
      currentRefreshSecs = v;
      resetCountdown();
    }
  }

  setInterval(() => {
    if (isLoading || isPaused) return;

    countdown = Math.max(0, countdown - 1);

    if (countdown === 0) {
      countdown = currentRefreshSecs;
      if (document.getElementById('sheetsUrl').value.trim()) {
        loadData(); // โหลดข้อมูลใหม่เมื่อหมดเวลา
      }
    }

    const pct  = (countdown / currentRefreshSecs) * 100;
    const mins = Math.floor(countdown / 60);
    const secs = String(countdown % 60).padStart(2, '0');

    document.getElementById('refreshFill').style.width    = pct + '%';
    document.getElementById('countdownText').textContent  = `${mins}:${secs}`;
  }, 1000);

  // ==========================================
  // ระบบ Notification แจ้งเตือนฝุ่น
  // ==========================================
  // ==========================================
  // ระบบ Notification แจ้งเตือนฝุ่น (อัปเดตใหม่เป็น Toggle)
  // ==========================================
  function toggleNotifications() {
    const cb = document.getElementById('notifToggleCb');
    
    // ถ้าผู้ใช้กด "เปิด"
    if (cb.checked) {
      if (!("Notification" in window)) {
        showToast("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน (Notifications)");
        cb.checked = false; // เด้งสวิตช์กลับไปสีแดง
        return;
      }
      
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          notificationsEnabled = true;
          showToast("🟢 เปิดระบบแจ้งเตือนสำเร็จ!");
        } else {
          showToast("🔴 คุณปฏิเสธการแจ้งเตือน กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์");
          cb.checked = false; // เด้งสวิตช์กลับถ้าไม่อนุญาต
        }
      });
    } 
    // ถ้าผู้ใช้กด "ปิด"
    else {
      notificationsEnabled = false;
      showToast("🔴 ปิดระบบแจ้งเตือนแล้ว");
    }
  }

  function checkAirQualityAlert(lastRow) {
    if (!notificationsEnabled || !lastRow) return;
    
    const pm25 = parseFloat(lastRow['PM2.5']) || 0;
    const ts = lastRow['Timestamp'];

    // แจ้งเตือนเมื่อฝุ่นเกิน 100 และต้องยังไม่เคยเตือนเวลานี้
    if (pm25 > 100 && ts !== lastAlertTimestamp) {
      lastAlertTimestamp = ts;
      new Notification("⚠️ แจ้งเตือนมลพิษทางอากาศ!", {
        body: `ค่า PM2.5 ปัจจุบันพุ่งสูงถึง ${pm25.toFixed(1)} µg/m³ (ระดับอันตราย) โปรดสวมหน้ากากอนามัย N95`,
        icon: 'https://cdn-icons-png.flaticon.com/512/3209/3209935.png' // ไอคอนหน้ากาก
      });
    }
  }

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
    if (!d) return escapeHTML(String(ts));
    
    // ใช้ dayjs ในการจัดรูปแบบวันที่แทน toLocaleString เพื่อความสม่ำเสมอ
    if (short) {
      return dayjs(d).format('HH:mm'); // แสดงแค่เวลา เช่น 18:00
    }
    
    // แสดงวันที่เต็มแบบ ค.ศ. (เช่น 09/03/2026 18:00)
    return dayjs(d).format('DD/MM/YYYY HH:mm'); 
    
    /* หมายเหตุ: ถ้าอยากให้แสดงผลเป็นปี พ.ศ. แบบเต็ม (เช่น 09/03/2569 18:00)
      ให้เปลี่ยนบรรทัดบนเป็น:
      return dayjs(d).add(543, 'year').format('DD/MM/YYYY HH:mm');
    */
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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

    document.body.style.overflow = 'hidden';

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

    document.body.style.overflow = '';

    _qrInstance = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  // Close the QR modal with Escape.
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQR(); });

  /* ===================================================
     EXPORT PDF MODAL
  =================================================== */
  let pdfDatePicker = null;

  function openExportModal() {
    const modal = document.getElementById('exportModal');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');

    // 🌟 ล็อคไม่ให้หน้าจอพื้นหลังเลื่อนได้
    document.body.style.overflow = 'hidden';

    // เรียกใช้ flatpickr สำหรับช่องเลือกวันที่ใน Modal
    if (!pdfDatePicker && global.flatpickr) {
      pdfDatePicker = global.flatpickr('#pdfDateFilter', {
        dateFormat: 'd/m/Y',
        locale: global.flatpickr.l10ns.th || 'default',
        disableMobile: true,
        allowInput: false,
        clickOpens: true
      });
    }

    // ซิงค์วันที่จากตารางหลักมาใส่ให้เป็นค่าเริ่มต้น
    const currentTableFilter = document.getElementById('dateFilter').value;
    if (pdfDatePicker) {
      pdfDatePicker.setDate(currentTableFilter);
    } else {
      document.getElementById('pdfDateFilter').value = currentTableFilter;
    }
  }

  function closeExportModal() {
    const modal = document.getElementById('exportModal');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');

    // 🌟 ปลดล็อคให้หน้าจอพื้นหลังกลับมาเลื่อนได้ตามปกติ
    document.body.style.overflow = '';
  }

  // ปิด Modal เมื่อกดปุ่ม Escape (ใส่เพิ่มต่อจาก EventListener ของ QR Modal ได้เลย)
  document.addEventListener('keydown', e => { 
    if (e.key === 'Escape') { closeQR(); closeExportModal(); } 
  });

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
    confirmExportPDF,
    downloadCSV,
    filterByDate,
    clearDateFilter,
    saveAndLoad,
    closeSettings,
    openExportModal,
    closeExportModal,
    changePage,
    changeRefreshInterval,
    toggleNotifications,
    sortTable,
  };

  // Maintain backward compatibility with existing inline handlers (if any)
  global.loadData         = loadData;
  global.confirmExportPDF = confirmExportPDF;
  global.openExportModal  = openExportModal;  // <--- เพิ่มบรรทัดนี้
  global.closeExportModal = closeExportModal; // <--- เพิ่มบรรทัดนี้
  global.downloadCSV      = downloadCSV;
  global.filterByDate     = filterByDate;
  global.clearDateFilter  = clearDateFilter;
  global.saveAndLoad      = saveAndLoad;
  global.closeSettings    = closeSettings;
  global.sortTable        = sortTable;
  global.openQR           = openQR;
  global.closeQR          = closeQR;
  global.changePage       = changePage;
  global.changeRefreshInterval = changeRefreshInterval;
  global.toggleNotifications = toggleNotifications;

  // Kick off app once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
