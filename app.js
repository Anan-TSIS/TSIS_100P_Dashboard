// ============================================================
// CONFIG
// ============================================================
// เปลี่ยนมาดึงข้อมูลตรงจาก Google Sheets ผ่าน Google Visualization API (gviz)
// แทน Apps Script Web App (doGet) เพราะ gviz เป็นฟีเจอร์หลักของ Sheets เอง
// เสถียรกว่ามาก ไม่มี cold start / ไม่มีปัญหา redirect ล่มเป็นระยะแบบ Apps Script
//
// ข้อกำหนด: ไฟล์ Google Sheet ต้องแชร์เป็น "Anyone with the link — Viewer"
// (Apps Script ยังใช้ตามปกติสำหรับปุ่ม "Generate All" ใน Sheets ไม่กระทบส่วนนี้)
const SHEET_ID = '1ZSIheE3Tva3UgevtJwu1u-RXL3MyCHDwCSRXC_C4o9Y';
const GVIZ_BASE = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;

const MASTER_LOG_SHEET_NAME = 'Master_Log';
const MASTER_LOG_SALE_SHEET_NAME = 'Master_Log_sale';

// ลำดับคอลัมน์ต้องตรงกับลำดับจริงในแต่ละ sheet (ซ้าย → ขวา)
const MASTER_LOG_COLUMN_KEYS = [
  'site', 'fiscalYear', 'registNo', 'projectType', 'projectName', 'dept',
  'material', 'materialName', 'rawMaterial', 'createDate', 'postingDate',
  'costingElement', 'before', 'month', 'after', 'diff', 'qty', 'cs'
];
const MASTER_LOG_SALE_COLUMN_KEYS = ['fiscalYear', 'site', 'month', 'salesAmount'];

const MONTH_ORDER = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ใช้แสดงบนจอ monitor ค้างไว้ทั้งวัน — ดึงข้อมูลใหม่อัตโนมัติทุก 24 ชม. โดยไม่ต้องกด Refresh เอง
// (ปุ่ม Refresh ด้วยมือยังใช้งานได้ตามปกติควบคู่กันไป)
const AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;

const CHART_COLORS_BY_THEME = {
  light: {
    savings: '#038c3e',
    savingsFaint: 'rgba(3,140,62,0.16)',
    safety: '#d95323',
    safetyFaint: 'rgba(217,83,35,0.18)',
    grid: '#dcdcdc',
    text: '#5f5f5f',
    palette: ['#038c3e', '#d95323', '#2f6fb0', '#a2478a', '#5a8f3a', '#b07a2f', '#3f8fa8', '#8a6b3f']
  },
  dark: {
    savings: '#3fcf82',
    savingsFaint: 'rgba(63,207,130,0.18)',
    safety: '#f2914d',
    safetyFaint: 'rgba(242,145,77,0.2)',
    grid: '#2a3540',
    text: '#9aa4ad',
    palette: ['#3fcf82', '#f2914d', '#7c93c9', '#c97ba0', '#8fb96d', '#c9986b', '#6ea3c9', '#b98f6d']
  }
};

let CHART_COLORS = CHART_COLORS_BY_THEME.light;

const CHARTJS_AVAILABLE = typeof Chart !== 'undefined';
const DATALABELS_AVAILABLE = typeof ChartDataLabels !== 'undefined';
if (CHARTJS_AVAILABLE) {
  Chart.defaults.font.family = "'IBM Plex Mono', monospace";
  if (DATALABELS_AVAILABLE) {
    Chart.register(ChartDataLabels);
    Chart.defaults.set('plugins.datalabels', { display: false }); // ปิดไว้เป็นค่าเริ่มต้น เปิดเฉพาะ chart ที่ต้องการทีละตัว
  }
}

function getCurrentTheme() {
  return document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyChartTheme() {
  CHART_COLORS = CHART_COLORS_BY_THEME[getCurrentTheme()];
  if (CHARTJS_AVAILABLE) Chart.defaults.color = CHART_COLORS.text;
}

// ============================================================
// STATE
// ============================================================
let RAW_RECORDS = [];
let defaultFiltersApplied = false;
let RAW_SALES = [];
let sortState = { key: 'totalCs', dir: 'desc' };
let charts = { trend: null, dept: null, type: null };

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();
  initSidebarToggle();
  initPinGate();
  loadData();
  setInterval(loadData, AUTO_REFRESH_MS);
  document.getElementById('refresh-btn').addEventListener('click', loadData);
  document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
  document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);
  ['fiscalYear', 'site', 'dept', 'projectType', 'month'].forEach(key => {
    document.getElementById(`filter-${key}`).addEventListener('change', () => {
      updateFilterOptions();
      render();
    });
  });
  document.querySelectorAll('#project-table thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState = { key, dir: key === 'totalCs' ? 'desc' : 'asc' };
      }
      renderTable(getFilteredRecords());
    });
  });
});

// ============================================================
// THEME
// ============================================================
const THEME_STORAGE_KEY = 'tsis100p-theme';

function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem(THEME_STORAGE_KEY) || 'light'; } catch (e) { /* ignore */ }
  setTheme(saved, false);
}

function toggleTheme() {
  setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark', true);
}

function setTheme(theme, rerender) {
  document.body.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) { /* ignore */ }
  applyChartTheme();
  if (rerender) render();
}

// ============================================================
// SIDEBAR TABS
// ============================================================
function initTabs() {
  document.querySelectorAll('.sidebar-link').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.sidebar-link').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.hidden = panel.id !== `tab-${tab}`;
  });
  document.getElementById('filters-kpi-block').hidden = (tab === 'inputdata');
}

// ============================================================
// SIDEBAR SHOW/HIDE
// ============================================================
const SIDEBAR_STORAGE_KEY = 'tsis100p-sidebar-hidden';

function initSidebarToggle() {
  const btn = document.getElementById('sidebar-toggle-btn');
  const shell = document.querySelector('.app-shell');
  let hidden = false;
  try { hidden = localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'; } catch (e) { /* ignore */ }
  applySidebarState(shell, btn, hidden);

  btn.addEventListener('click', () => {
    hidden = !shell.classList.contains('sidebar-hidden');
    applySidebarState(shell, btn, hidden);
    try { localStorage.setItem(SIDEBAR_STORAGE_KEY, hidden ? '1' : '0'); } catch (e) { /* ignore */ }
  });
}

function applySidebarState(shell, btn, hidden) {
  shell.classList.toggle('sidebar-hidden', hidden);
  btn.title = hidden ? 'Show sidebar' : 'Hide sidebar';
}

// ============================================================
// INPUT DATA TAB — PIN gate (client-side only, deterrent — not real security)
// ============================================================
const IDPW_SHEET_NAME = 'IDPW';
const IDPW_COLUMN_KEYS = ['id', 'pin', 'name'];

// รายการลิงก์ Google Sheet สำหรับ admin — แก้ url แต่ละอันให้ตรง tab จริง
// (เปิด tab นั้นใน Sheets แล้วคัดลอก URL จาก address bar มาแทน รวม #gid=... ด้วย
// จะได้เปิดตรง tab เลยแทนที่จะเปิดที่ tab แรกของไฟล์เสมอ)
const INPUT_LINKS = [
  {
    title: 'Input Data SAP (Cost Saving)',
    desc: 'กรอกข้อมูลต้นทุน/cost saving รายเดือน',
    url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
  },
  {
    title: 'Input Data Sale (ยอดขาย)',
    desc: 'กรอกยอดขายรายเดือนแต่ละ site',
    url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
  },
  {
    title: 'Input Target (% Target / Commit)',
    desc: 'กำหนด % Target และ % Commit รายปี',
    url: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
  }
];

function initPinGate() {
  document.getElementById('pin-submit-btn').addEventListener('click', handlePinSubmit);
  document.getElementById('pin-lock-btn').addEventListener('click', lockPinGate);
  ['pin-id', 'pin-code'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
      if (e.key === 'Enter') handlePinSubmit();
    });
  });
}

async function handlePinSubmit() {
  const idVal = document.getElementById('pin-id').value.trim();
  const pinVal = document.getElementById('pin-code').value.trim();
  const errEl = document.getElementById('pin-error');
  errEl.hidden = true;

  if (!idVal || !pinVal) {
    errEl.textContent = 'กรุณากรอก ID และ PIN';
    errEl.hidden = false;
    return;
  }

  try {
    const json = await fetchGvizSheet(IDPW_SHEET_NAME);
    const records = gvizRowsToObjects(json, IDPW_COLUMN_KEYS);
    const match = records.find(r =>
      String(r.id ?? '').trim() === idVal && String(r.pin ?? '').trim() === pinVal
    );

    if (match) {
      document.getElementById('pin-gate').hidden = true;
      document.getElementById('input-links').hidden = false;
      document.getElementById('pin-welcome-name').textContent = match.name || idVal;
      renderInputLinks();
    } else {
      errEl.textContent = 'ID หรือ PIN ไม่ถูกต้อง';
      errEl.hidden = false;
    }
  } catch (err) {
    errEl.textContent = `เชื่อมต่อ Google Sheets ไม่สำเร็จ: ${err.message}`;
    errEl.hidden = false;
  }
}

function lockPinGate() {
  document.getElementById('input-links').hidden = true;
  document.getElementById('pin-gate').hidden = false;
  document.getElementById('pin-id').value = '';
  document.getElementById('pin-code').value = '';
}

function renderInputLinks() {
  const container = document.getElementById('input-links-list');
  container.innerHTML = INPUT_LINKS.map(link => `
    <a class="input-link-card" href="${link.url}" target="_blank" rel="noopener">
      <span class="input-link-card-title">${escapeHtml(link.title)}</span>
      <span class="input-link-card-desc">${escapeHtml(link.desc)}</span>
    </a>
  `).join('');
}

// ============================================================
// DATA LOADING
// ============================================================
const MAX_FETCH_RETRIES = 3;
const RETRY_DELAY_MS = 1200; // เพิ่มขึ้นทีละรอบ (1.2s, 2.4s, 3.6s)

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function gvizUrl(sheetName) {
  return `${GVIZ_BASE}?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&headers=1`;
}

/**
 * gviz ตอบกลับมาเป็น text ห่อด้วย google.visualization.Query.setResponse({...});
 * ต้องแกะห่อก่อนค่อย JSON.parse
 */
function parseGvizResponse(text) {
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) throw new Error('รูปแบบข้อมูลจาก Google Sheets ไม่ตรงตามที่คาด (gviz)');
  return JSON.parse(match[1]);
}

async function fetchGvizSheet(sheetName) {
  const res = await fetch(gvizUrl(sheetName), { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${sheetName})`);
  const text = await res.text();
  return parseGvizResponse(text);
}

function gvizRowsToObjects(gvizJson, columnKeys) {
  const rows = (gvizJson.table && gvizJson.table.rows) || [];
  return rows.map(row => {
    const obj = {};
    columnKeys.forEach((key, i) => {
      const cell = row.c && row.c[i];
      obj[key] = cell ? cell.v : null;
    });
    return obj;
  });
}

async function fetchDataWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const [costJson, saleJson] = await Promise.all([
        fetchGvizSheet(MASTER_LOG_SHEET_NAME),
        fetchGvizSheet(MASTER_LOG_SALE_SHEET_NAME)
      ]);
      const data = gvizRowsToObjects(costJson, MASTER_LOG_COLUMN_KEYS);
      const sales = gvizRowsToObjects(saleJson, MASTER_LOG_SALE_COLUMN_KEYS);
      return { success: true, count: data.length, data, salesCount: sales.length, sales };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_FETCH_RETRIES) {
        document.getElementById('last-loaded').textContent = `retrying… (${attempt}/${MAX_FETCH_RETRIES - 1})`;
        await delay(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError; // ลองครบทุกรอบแล้วยังไม่สำเร็จ ค่อยโยน error จริง
}

async function loadData() {
  setLoadingState();
  document.getElementById('loading-bar').classList.add('active');
  try {
    const payload = await fetchDataWithRetry();

    RAW_RECORDS = (payload.data || []).map(normalizeRecord);
    RAW_SALES = (payload.sales || []).map(normalizeSaleRecord);
    updateFilterOptions();
    if (!defaultFiltersApplied) {
      applyDefaultFilters();
      updateFilterOptions(); // ปรับ dropdown อื่นให้เหลือแค่ตัวเลือกที่มีจริงในปีที่เลือก default
      defaultFiltersApplied = true;
    }
    render();

    document.getElementById('record-count').textContent = `${payload.count} records · ${payload.salesCount ?? RAW_SALES.length} sales rows`;
    document.getElementById('last-loaded').textContent = `loaded ${new Date().toLocaleTimeString('th-TH')}`;
    hideError();
  } catch (err) {
    showError(`โหลดข้อมูลไม่สำเร็จหลังลองซ้ำ ${MAX_FETCH_RETRIES} ครั้ง: ${err.message}`);
  } finally {
    document.getElementById('loading-bar').classList.remove('active');
  }
}

function normalizeRecord(r) {
  return {
    site: r.site != null ? String(r.site) : 'Unknown',
    fiscalYear: r.fiscalYear != null ? String(r.fiscalYear) : '',
    registNo: r.registNo || '',
    projectType: r.projectType || 'Unspecified',
    projectName: r.projectName || '',
    dept: r.dept || 'Unspecified',
    costingElement: r.costingElement || '',
    month: r.month || '',
    cs: toNumber(r.cs)
  };
}

function normalizeSaleRecord(r) {
  return {
    site: r.site != null ? String(r.site) : 'Unknown',
    fiscalYear: r.fiscalYear != null ? String(r.fiscalYear) : '',
    month: r.month || '',
    salesAmount: toNumber(r.salesAmount)
  };
}

function toNumber(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function setLoadingState() {
  document.getElementById('last-loaded').textContent = 'loading…';
  document.getElementById('project-table-body').innerHTML =
    '<tr><td colspan="7" class="table-empty">Loading data…</td></tr>';
}

// ============================================================
// FILTERS
// ============================================================
/**
 * สร้างรายการตัวเลือกของแต่ละ dropdown แบบ "cascading" — ตัวเลือกของ dropdown หนึ่ง
 * จะคำนวณจากข้อมูลที่ผ่าน filter อื่นๆ ที่เลือกไว้แล้วเท่านั้น (ไม่รวม filter ของ
 * ตัวมันเอง) เช่น เลือก Fiscal Year = 2026 ไปแล้ว ตัวเลือกใน Site/Dept/Type/Month
 * จะเหลือเฉพาะค่าที่มีข้อมูลจริงในปี 2026 เท่านั้น
 */
function updateFilterOptions() {
  const FIELD_KEYS = ['fiscalYear', 'site', 'dept', 'projectType', 'month'];

  FIELD_KEYS.forEach(key => {
    const candidates = getFilteredRecords([key]); // ไม่กรองด้วย filter ของตัวเอง
    const values = new Set();
    candidates.forEach(r => { if (r[key]) values.add(r[key]); });

    let sortedValues;
    if (key === 'fiscalYear') sortedValues = [...values].sort().reverse();
    else if (key === 'month') sortedValues = MONTH_ORDER.filter(m => values.has(m));
    else sortedValues = [...values].sort();

    fillSelect(`filter-${key}`, sortedValues);
  });
}

/**
 * ตั้งค่าเริ่มต้นตอนเปิดหน้าเว็บครั้งแรก ให้ chart/KPI โชว์เฉพาะปีงบปัจจุบัน
 * (ปีตามปฏิทินของเครื่องผู้ใช้) ถ้าปีนั้นมีอยู่ใน dropdown จริง
 * ทำแค่ครั้งเดียวตอนโหลดหน้าเว็บ — ไม่ทับ filter ที่ผู้ใช้เลือกเองระหว่างใช้งาน
 * (เช่นตอน auto-refresh ทุก 24 ชม.)
 */
function applyDefaultFilters() {
  const currentYear = String(new Date().getFullYear());
  const fySelect = document.getElementById('filter-fiscalYear');
  const hasCurrentYear = Array.from(fySelect.options).some(opt => opt.value === currentYear);
  if (hasCurrentYear) fySelect.value = currentYear;
}

function fillSelect(id, values) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = '<option value="">All</option>' +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(current)) select.value = current;
}

function getActiveFilters() {
  return {
    fiscalYear: document.getElementById('filter-fiscalYear').value,
    site: document.getElementById('filter-site').value,
    dept: document.getElementById('filter-dept').value,
    projectType: document.getElementById('filter-projectType').value,
    month: document.getElementById('filter-month').value
  };
}

function getFilteredRecords(excludeKeys = []) {
  const f = getActiveFilters();
  return RAW_RECORDS.filter(r => {
    if (!excludeKeys.includes('fiscalYear') && f.fiscalYear && r.fiscalYear !== f.fiscalYear) return false;
    if (!excludeKeys.includes('site') && f.site && r.site !== f.site) return false;
    if (!excludeKeys.includes('dept') && f.dept && r.dept !== f.dept) return false;
    if (!excludeKeys.includes('projectType') && f.projectType && r.projectType !== f.projectType) return false;
    if (!excludeKeys.includes('month') && f.month && r.month !== f.month) return false;
    return true;
  });
}

function getFilteredSales(excludeKeys = []) {
  const f = getActiveFilters();
  return RAW_SALES.filter(r => {
    if (!excludeKeys.includes('fiscalYear') && f.fiscalYear && r.fiscalYear !== f.fiscalYear) return false;
    if (!excludeKeys.includes('site') && f.site && r.site !== f.site) return false;
    if (!excludeKeys.includes('month') && f.month && r.month !== f.month) return false;
    return true;
  });
}

function clearFilters() {
  ['fiscalYear', 'site', 'dept', 'projectType', 'month'].forEach(key => {
    document.getElementById(`filter-${key}`).value = '';
  });
  updateFilterOptions();
  render();
}

// ============================================================
// RENDER
// ============================================================
function render() {
  const filtered = getFilteredRecords();
  const filteredSales = getFilteredSales();
  renderKPIs(filtered, filteredSales);
  renderTrendChart(getFilteredRecords(['month']), getFilteredSales(['month'])); // trend always shows all months in scope
  renderDeptChart(filtered);
  renderTypeChart(filtered);
  renderTable(filtered);
}

function renderKPIs(records, salesRecords) {
  const totalCs = sum(records, r => r.cs);
  const totalSales = sum(salesRecords, r => r.salesAmount);
  const projectCount = new Set(records.map(r => r.registNo)).size;

  const byDept = groupSum(records, r => r.dept, r => r.cs);
  const topDept = topEntry(byDept);
  const byType = groupSum(records, r => r.projectType, r => r.cs);
  const topType = topEntry(byType);

  const csPercentEl = document.getElementById('kpi-cs-percent');
  const csPercentSubEl = document.getElementById('kpi-cs-percent-sub');
  if (totalSales > 0) {
    csPercentEl.textContent = `${formatPercent((totalCs / totalSales) * 100)}%`;
    csPercentSubEl.textContent = `${formatNumber(totalCs)} CS. ÷ ${formatNumber(totalSales)} sales`;
  } else {
    csPercentEl.textContent = '—';
    csPercentSubEl.textContent = 'no sales data for this scope';
  }

  const csPercentEl2 = document.getElementById('kpi-total-cs');
  csPercentEl2.textContent = formatNumber(totalCs);
  csPercentEl2.title = formatNumber(totalCs);

  const totalSalesEl = document.getElementById('kpi-total-sales');
  totalSalesEl.textContent = formatNumber(totalSales);
  totalSalesEl.title = formatNumber(totalSales);

  document.getElementById('kpi-project-count').textContent = projectCount;
  document.getElementById('kpi-top-dept').textContent = topDept ? topDept[0] : '—';
  document.getElementById('kpi-top-dept-sub').textContent = topDept ? `${formatNumber(topDept[1])} CS.` : 'no data';
  document.getElementById('kpi-top-type').textContent = topType ? topType[0] : '—';
  document.getElementById('kpi-top-type-sub').textContent = topType ? `${formatNumber(topType[1])} CS.` : 'no data';
}

function renderTrendChart(records, salesRecords) {
  if (!CHARTJS_AVAILABLE) return;

  const csByMonth = groupSum(records, r => r.month, r => r.cs);
  const salesByMonth = groupSum(salesRecords, r => r.month, r => r.salesAmount);

  const monthlyPercents = MONTH_ORDER.map(m => {
    const cs = csByMonth[m] || 0;
    const sales = salesByMonth[m] || 0;
    return sales > 0 ? (cs / sales) * 100 : 0;
  });

  const totalCs = sum(records, r => r.cs);
  const totalSales = sum(salesRecords, r => r.salesAmount);
  const avgPercent = totalSales > 0 ? (totalCs / totalSales) * 100 : 0;

  const hasData = Object.values(csByMonth).some(v => v !== 0);
  setChartEmptyState('chart-trend-empty', !hasData);

  const labels = [...MONTH_ORDER, 'AVG.'];
  const values = [...monthlyPercents, avgPercent];
  const barColors = MONTH_ORDER.map(() => CHART_COLORS.savingsFaint).concat(CHART_COLORS.safetyFaint || CHART_COLORS.safety);
  const borderColors = MONTH_ORDER.map(() => CHART_COLORS.savings).concat(CHART_COLORS.safety);

  const ctx = document.getElementById('chart-trend');
  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '% CS.',
        data: values,
        backgroundColor: barColors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 2,
        maxBarThickness: 38
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: DATALABELS_AVAILABLE,
          anchor: 'end',
          align: 'end',
          offset: 2,
          clip: false,
          color: CHART_COLORS.text,
          font: { family: "'IBM Plex Mono', monospace", size: 10 },
          formatter: v => `${formatPercent(v)}%`
        },
        tooltip: {
          backgroundColor: '#1e252b',
          borderColor: '#2a3540',
          borderWidth: 1,
          titleFont: { family: "'IBM Plex Mono', monospace", size: 11 },
          bodyFont: { family: "'IBM Plex Mono', monospace", size: 11 },
          callbacks: { label: ctx => ` ${formatPercent(ctx.parsed.y)}%` }
        }
      },
      scales: {
        x: { grid: { color: CHART_COLORS.grid, drawTicks: false }, ticks: { font: { size: 10.5 } } },
        y: {
          grid: { color: CHART_COLORS.grid, drawTicks: false },
          ticks: { font: { size: 10.5 }, callback: v => `${v}%` },
          beginAtZero: true,
          grace: '12%'
        }
      }
    }
  });
}

function renderDeptChart(records) {
  renderBreakdownChart('chart-dept', groupSum(records, r => r.dept, r => r.cs), charts, 'dept');
}

function renderTypeChart(records) {
  renderBreakdownChart('chart-type', groupSum(records, r => r.projectType, r => r.cs), charts, 'type');
}

function renderBreakdownChart(canvasId, grouped, chartsObj, key) {
  if (!CHARTJS_AVAILABLE) return;
  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 8);
  setChartEmptyState(`${canvasId}-empty`, entries.length === 0);
  const ctx = document.getElementById(canvasId);

  if (chartsObj[key]) chartsObj[key].destroy();
  chartsObj[key] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => e[1]),
        backgroundColor: entries.map((_, i) => CHART_COLORS.palette[i % CHART_COLORS.palette.length]),
        borderRadius: 2,
        maxBarThickness: 26
      }]
    },
    options: baseChartOptions({ legend: false, indexAxis: 'y' })
  });
}

function setChartEmptyState(elId, isEmpty) {
  const el = document.getElementById(elId);
  if (el) el.hidden = !isEmpty;
}

function baseChartOptions({ legend = false, indexAxis = 'x' } = {}) {
  return {
    indexAxis,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: legend },
      datalabels: {
        display: DATALABELS_AVAILABLE,
        anchor: 'end',
        align: 'end',
        offset: 2,
        clip: false,
        color: CHART_COLORS.text,
        font: { family: "'IBM Plex Mono', monospace", size: 10 },
        formatter: v => formatNumber(v)
      },
      tooltip: {
        backgroundColor: '#1e252b',
        borderColor: '#2a3540',
        borderWidth: 1,
        titleFont: { family: "'IBM Plex Mono', monospace", size: 11 },
        bodyFont: { family: "'IBM Plex Mono', monospace", size: 11 },
        callbacks: { label: ctx => ` ${formatNumber(ctx.parsed[indexAxis === 'y' ? 'x' : 'y'])} CS.` }
      }
    },
    scales: {
      x: { grid: { color: CHART_COLORS.grid, drawTicks: false }, ticks: { font: { size: 10.5 } }, grace: indexAxis === 'y' ? '12%' : undefined },
      y: { grid: { color: CHART_COLORS.grid, drawTicks: false }, ticks: { font: { size: 10.5 } }, beginAtZero: true, grace: indexAxis === 'x' ? '12%' : undefined }
    }
  };
}

function renderTable(records) {
  const projects = {};
  records.forEach(r => {
    if (!projects[r.registNo]) {
      projects[r.registNo] = {
        registNo: r.registNo,
        site: r.site,
        fiscalYear: r.fiscalYear,
        projectName: r.projectName,
        dept: r.dept,
        projectType: r.projectType,
        totalCs: 0
      };
    }
    projects[r.registNo].totalCs += r.cs;
  });

  let rows = Object.values(projects);
  rows.sort((a, b) => {
    const { key, dir } = sortState;
    const mult = dir === 'asc' ? 1 : -1;
    if (key === 'totalCs') return (a.totalCs - b.totalCs) * mult;
    return String(a[key]).localeCompare(String(b[key])) * mult;
  });

  const tbody = document.getElementById('project-table-body');
  document.getElementById('table-count').textContent = `${rows.length} projects`;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No projects match the current filters</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(p => `
    <tr>
      <td class="mono">${escapeHtml(p.registNo)}</td>
      <td>${escapeHtml(p.site)}</td>
      <td class="mono">${escapeHtml(p.fiscalYear)}</td>
      <td>${escapeHtml(p.projectName)}</td>
      <td>${escapeHtml(p.dept)}</td>
      <td>${escapeHtml(p.projectType)}</td>
      <td class="num ${p.totalCs >= 0 ? 'cs-positive' : 'cs-negative'}">${formatNumber(p.totalCs)}</td>
    </tr>
  `).join('');
}

// ============================================================
// HELPERS
// ============================================================
function sum(arr, fn) { return arr.reduce((acc, x) => acc + fn(x), 0); }

function groupSum(arr, keyFn, valFn) {
  const out = {};
  arr.forEach(x => {
    const k = keyFn(x);
    out[k] = (out[k] || 0) + valFn(x);
  });
  return out;
}

function topEntry(grouped) {
  const entries = Object.entries(grouped);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0];
}

function formatNumber(n) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n || 0);
}

function formatPercent(n) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  el.textContent = msg;
  el.hidden = false;
}
function hideError() {
  document.getElementById('error-banner').hidden = true;
}
