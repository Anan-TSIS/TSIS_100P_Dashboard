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

const INPUT_TARGET_SHEET_NAME = 'Input_target';
const INPUT_TARGET_COLUMN_KEYS = ['fiscalYear', 'commitPercent', 'targetPercent'];

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
if (CHARTJS_AVAILABLE) {
  Chart.defaults.font.family = "'IBM Plex Mono', monospace";
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
let RAW_TARGETS = [];
let chartViewMode = 'normal'; // 'normal' | 'clustered' | 'stacked'
let chartSplitBy = 'site'; // 'site' | 'dept' | 'projectType' — ใช้เมื่อ chartViewMode != 'normal'
let compareEnabled = false;
let compareViewMode = 'normal';
let compareSplitBy = 'site';
let compareChartInstance = null; // Chart.js instance ของกราฟ overlay (canvas แยกต่างหาก)
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
  initChartControls();
  initQrModal();
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
// QR CODE MODAL
// ============================================================
function initQrModal() {
  const modal = document.getElementById('qr-modal');
  const openBtn = document.getElementById('qr-toggle-btn');
  const closeBtn = document.getElementById('qr-close-btn');
  const backdrop = modal.querySelector('.qr-modal-backdrop');
  const copyBtn = document.getElementById('qr-copy-btn');

  openBtn.addEventListener('click', openQrModal);
  closeBtn.addEventListener('click', closeQrModal);
  backdrop.addEventListener('click', closeQrModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeQrModal();
  });

  copyBtn.addEventListener('click', async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = '✅ Copied!';
    } catch (e) {
      copyBtn.textContent = '⚠️ Copy failed';
    }
    setTimeout(() => { copyBtn.textContent = '📋 Copy link'; }, 1800);
  });
}

function openQrModal() {
  const url = window.location.href;
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
  document.getElementById('qr-modal-img').src = qrImgUrl;
  document.getElementById('qr-modal-url').textContent = url;
  document.getElementById('qr-modal').hidden = false;
}

function closeQrModal() {
  document.getElementById('qr-modal').hidden = true;
}

// ============================================================
// COST SAVING CHART CONTROLS — view mode + compare
// ============================================================
function initChartControls() {
  // เผื่อกัน state ค้างจาก HTML — บังคับซ่อน compare filters ตอนเริ่มเสมอ
  document.getElementById('compare-filters').hidden = true;
  document.getElementById('split-by-group').hidden = true;
  document.getElementById('cmp-split-by-group').hidden = true;

  document.querySelectorAll('.view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chartViewMode = btn.dataset.viewMode;
      document.querySelectorAll('.view-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('split-by-group').hidden = (chartViewMode === 'normal');
      render();
    });
  });

  document.getElementById('split-by-select').addEventListener('change', e => {
    chartSplitBy = e.target.value;
    render();
  });

  document.querySelectorAll('.cmp-view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      compareViewMode = btn.dataset.viewMode;
      document.querySelectorAll('.cmp-view-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('cmp-split-by-group').hidden = (compareViewMode === 'normal');
      render();
    });
  });

  document.getElementById('cmp-split-by-select').addEventListener('change', e => {
    compareSplitBy = e.target.value;
    render();
  });

  const compareBtn = document.getElementById('compare-toggle-btn');
  compareBtn.addEventListener('click', () => {
    compareEnabled = !compareEnabled;
    compareBtn.classList.toggle('active', compareEnabled);
    document.getElementById('compare-filters').hidden = !compareEnabled;
    if (!compareEnabled) destroyCompareChart();
    render();
  });

  ['cmp-fiscalYear', 'cmp-site', 'cmp-dept', 'cmp-projectType', 'cmp-month'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      updateCompareFilterOptions();
      render();
    });
  });

  const clearCompareBtn = document.getElementById('clear-compare-filters-btn');
  if (clearCompareBtn) clearCompareBtn.addEventListener('click', clearCompareFilters);
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

      let targets = [];
      try {
        const targetJson = await fetchGvizSheet(INPUT_TARGET_SHEET_NAME);
        targets = gvizRowsToObjects(targetJson, INPUT_TARGET_COLUMN_KEYS);
      } catch (targetErr) {
        console.warn('โหลด Input_target ไม่สำเร็จ (ไม่กระทบข้อมูลหลัก):', targetErr.message);
      }

      return { success: true, count: data.length, data, salesCount: sales.length, sales, targets };
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
    RAW_TARGETS = (payload.targets || []).map(normalizeTargetRecord);
    updateFilterOptions();
    updateCompareFilterOptions();
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
    month: normalizeMonthLabel(r.month),
    cs: toNumber(r.cs)
  };
}

const MONTH_NAME_MAP = {
  JAN: 'JAN', JANUARY: 'JAN',
  FEB: 'FEB', FEBRUARY: 'FEB',
  MAR: 'MAR', MARCH: 'MAR',
  APR: 'APR', APRIL: 'APR',
  MAY: 'MAY',
  JUN: 'JUN', JUNE: 'JUN',
  JUL: 'JUL', JULY: 'JUL',
  AUG: 'AUG', AUGUST: 'AUG',
  SEP: 'SEP', SEPT: 'SEP', SEPTEMBER: 'SEP',
  OCT: 'OCT', OCTOBER: 'OCT',
  NOV: 'NOV', NOVEMBER: 'NOV',
  DEC: 'DEC', DECEMBER: 'DEC'
};

/**
 * แปลงชื่อเดือนที่พิมพ์มาแบบไหนก็ได้ (ย่อ/เต็ม/ตัวเล็ก-ใหญ่ปน) ให้เป็นรหัส 3 ตัวอักษร
 * มาตรฐานเสมอ (JAN..DEC) — กันปัญหาจากการกรอกข้อมูลไม่สม่ำเสมอใน Sheet
 * เช่น "June", "JULY", "march" ก็ยัง match ได้ถูกต้อง
 */
function normalizeMonthLabel(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return MONTH_NAME_MAP[s] || s;
}

function normalizeSaleRecord(r) {
  return {
    site: r.site != null ? String(r.site) : 'Unknown',
    fiscalYear: r.fiscalYear != null ? String(r.fiscalYear) : '',
    month: normalizeMonthLabel(r.month),
    salesAmount: toNumber(r.salesAmount)
  };
}

function normalizeTargetRecord(r) {
  // หมายเหตุ: cell ใน Input_target น่าจะ format เป็น % (Google Sheets เก็บค่าดิบเป็นเศษส่วน
  // เช่น cell โชว์ "1%" แต่ค่าดิบที่ gviz ส่งมาคือ 0.01) จึงต้องคูณ 100 ก่อนใช้
  return {
    fiscalYear: r.fiscalYear != null ? String(r.fiscalYear) : '',
    commitPercent: toNumber(r.commitPercent) * 100,
    targetPercent: toNumber(r.targetPercent) * 100
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

  updateSplitByOptions();
}

/**
 * ตัดตัวเลือกใน "Split By" ออกอัตโนมัติถ้า filter หลักของมิตินั้นถูกเลือกเจาะจงไว้แล้ว
 * (ไม่ใช่ All) เพราะแยกซ้ำกับสิ่งที่ filter ทำอยู่แล้วไม่มีประโยชน์ — เช่น เลือก Site=1510
 * ไปแล้ว ตัวเลือก "Site" ใน Split By จะหายไป เหลือแค่ N/A / Dept. / Project Type
 */
function updateSplitByOptions() {
  const f = getActiveFilters();
  const select = document.getElementById('split-by-select');
  const current = select.value;

  const options = [{ value: 'na', label: 'N/A' }];
  if (!f.site) options.push({ value: 'site', label: 'Site' });
  if (!f.dept) options.push({ value: 'dept', label: 'Dept.' });
  if (!f.projectType) options.push({ value: 'projectType', label: 'Project Type' });

  select.innerHTML = options.map(o => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('');

  if (options.some(o => o.value === current)) {
    select.value = current;
  } else {
    select.value = 'na';
    chartSplitBy = 'na';
  }
}

/**
 * เติมตัวเลือกให้ filter ชุด "Compare" (ไม่ cascading แบบ filter หลัก
 * เพื่อความเรียบง่าย — ใช้ค่าที่มีอยู่ทั้งหมดในข้อมูลเสมอ)
 */
/**
 * เติมตัวเลือกให้ filter ชุด "Compare" แบบ cascading เหมือน filter หลัก —
 * ตัวเลือกแต่ละช่องจะเหลือเฉพาะค่าที่มีข้อมูลจริงตาม filter อื่นๆ ในชุด compare เอง
 * (ไม่เกี่ยวกับ filter หลัก คนละชุดข้อมูลกัน)
 */
function updateCompareFilterOptions() {
  const FIELD_KEYS = ['fiscalYear', 'site', 'dept', 'projectType', 'month'];
  const cmpFilters = getCompareFilters();

  FIELD_KEYS.forEach(key => {
    const candidates = getFilteredRecords([key], cmpFilters);
    const values = new Set();
    candidates.forEach(r => { if (r[key]) values.add(r[key]); });

    let sortedValues;
    if (key === 'fiscalYear') sortedValues = [...values].sort().reverse();
    else if (key === 'month') sortedValues = MONTH_ORDER.filter(m => values.has(m));
    else sortedValues = [...values].sort();

    fillSelect(`cmp-${key}`, sortedValues);
  });

  updateCompareSplitByOptions();
}

/**
 * เหมือน updateSplitByOptions() แต่สำหรับชุด Compare — ตัดตัวเลือกใน "Split By"
 * ของ Compare ออกอัตโนมัติถ้า filter ของ Compare set เองเจาะจงมิตินั้นไว้แล้ว
 * (คนละชุดกับ filter หลัก ใช้ cmpFilters ของตัวเองล้วนๆ)
 */
function updateCompareSplitByOptions() {
  const f = getCompareFilters();
  const select = document.getElementById('cmp-split-by-select');
  const current = select.value;

  const options = [{ value: 'na', label: 'N/A' }];
  if (!f.site) options.push({ value: 'site', label: 'Site' });
  if (!f.dept) options.push({ value: 'dept', label: 'Dept.' });
  if (!f.projectType) options.push({ value: 'projectType', label: 'Project Type' });

  select.innerHTML = options.map(o => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('');

  if (options.some(o => o.value === current)) {
    select.value = current;
  } else {
    select.value = 'na';
    compareSplitBy = 'na';
  }
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

function getCompareFilters() {
  return {
    fiscalYear: document.getElementById('cmp-fiscalYear').value,
    site: document.getElementById('cmp-site').value,
    dept: document.getElementById('cmp-dept').value,
    projectType: document.getElementById('cmp-projectType').value,
    month: document.getElementById('cmp-month').value
  };
}

function getFilteredRecords(excludeKeys = [], filters = null) {
  const f = filters || getActiveFilters();
  return RAW_RECORDS.filter(r => {
    if (!excludeKeys.includes('fiscalYear') && f.fiscalYear && r.fiscalYear !== f.fiscalYear) return false;
    if (!excludeKeys.includes('site') && f.site && r.site !== f.site) return false;
    if (!excludeKeys.includes('dept') && f.dept && r.dept !== f.dept) return false;
    if (!excludeKeys.includes('projectType') && f.projectType && r.projectType !== f.projectType) return false;
    if (!excludeKeys.includes('month') && f.month && r.month !== f.month) return false;
    return true;
  });
}

function getFilteredSales(excludeKeys = [], filters = null) {
  const f = filters || getActiveFilters();
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

/**
 * เหมือน clearFilters() แต่ล้างเฉพาะ filter ของชุด Compare (cmp-*)
 * ไม่ยุ่งกับ filter หลัก
 */
function clearCompareFilters() {
  ['fiscalYear', 'site', 'dept', 'projectType', 'month'].forEach(key => {
    document.getElementById(`cmp-${key}`).value = '';
  });
  updateCompareFilterOptions();
  render();
}

// ============================================================
// RENDER
// ============================================================
function render() {
  const filtered = getFilteredRecords();
  const filteredSales = getFilteredSales();
  try { renderKPIs(filtered, filteredSales); } catch (e) { console.error('renderKPIs failed:', e); }
  try { renderTrendChart(); } catch (e) { console.error('renderTrendChart failed:', e); } // อ่าน filter หลัก/compare และ view mode เองข้างใน
  try { renderDeptChart(filtered); } catch (e) { console.error('renderDeptChart failed:', e); }
  try { renderTypeChart(filtered); } catch (e) { console.error('renderTypeChart failed:', e); }
  try { renderTable(filtered); } catch (e) { console.error('renderTable failed:', e); }
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

function hexWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function colorShades(colorFamily, count) {
  const base = CHART_COLORS[colorFamily];
  if (count <= 1) return [base];
  const shades = [];
  for (let i = 0; i < count; i++) {
    const alpha = 0.35 + (0.65 * i) / (count - 1); // ไล่เฉด 0.35 → 1.0
    shades.push(hexWithAlpha(base, alpha));
  }
  return shades;
}

/**
 * คำนวณ % Cost Saving รายเดือน (12 เดือน) + ค่าเฉลี่ยรวม (avg) จาก filter ที่ระบุ
 */
function computePercentSeries(filters) {
  const records = getFilteredRecords(['month'], filters);
  const salesRecords = getFilteredSales(['month'], filters);
  const csByMonth = groupSum(records, r => r.month, r => r.cs);
  const salesByMonth = groupSum(salesRecords, r => r.month, r => r.salesAmount);

  const monthly = MONTH_ORDER.map(m => {
    const cs = csByMonth[m] || 0;
    const sales = salesByMonth[m] || 0;
    return sales > 0 ? (cs / sales) * 100 : 0;
  });

  const totalCs = sum(records, r => r.cs);
  const totalSales = sum(salesRecords, r => r.salesAmount);
  const avg = totalSales > 0 ? (totalCs / totalSales) * 100 : 0;
  const hasData = Object.values(csByMonth).some(v => v !== 0);

  return { monthly, avg, hasData };
}

/**
 * หาค่าที่มีอยู่จริงของมิติที่จะแยก (site/dept/projectType) ภายใต้ filter อื่นๆ ที่เลือกไว้
 * (ไม่กรองด้วยมิตินั้นเอง เพราะกำลังจะแยกตามมิตินั้น)
 */
function getSplitValues(filters, dimension) {
  const candidates = getFilteredRecords([dimension], filters);
  const values = new Set();
  candidates.forEach(r => { if (r[dimension]) values.add(r[dimension]); });
  return [...values].sort();
}

/**
 * สร้างชุด dataset ตาม view mode ปัจจุบัน (normal/clustered/stacked) จาก filter ที่ระบุ
 * โหมด clustered/stacked จะแยกตามมิติที่เลือกไว้ใน chartSplitBy (site/dept/projectType)
 * จำนวนก้อน/ชั้น = จำนวนค่าที่มีข้อมูลจริงของมิตินั้น (ไม่ตายตัว)
 * colorFamily: 'savings' (ชุดหลัก, โทนเขียว) หรือ 'safety' (ชุด compare, โทนส้ม)
 * labelSuffix: ต่อท้ายชื่อ series เช่น ' (cmp)' เวลาเป็นชุด compare
 */
function buildModeDatasets(filters, colorFamily, labelSuffix, viewMode, splitBy) {
  viewMode = viewMode || chartViewMode;
  splitBy = splitBy || chartSplitBy;
  if ((viewMode === 'clustered' || viewMode === 'stacked') && splitBy !== 'na') {
    const dimension = splitBy;
    const values = getSplitValues(filters, dimension);
    const stacked = viewMode === 'stacked';
    const shades = colorShades(colorFamily, Math.max(values.length, 1));

    let hasAnyData = false;
    let datasets;

    if (stacked) {
      // สำคัญ: ต้องใช้ "ยอดขายรวมของทุกค่าในมิตินี้" เป็นตัวหารร่วมกันทุก series
      // ไม่งั้นเอา % ที่คำนวณแยกกันคนละตัวหารมาซ้อนกัน ผลรวมจะเพี้ยน (สูงเกินจริง)
      // ไม่ตรงกับ % Cost Saving รวมที่การ์ด KPI แสดง
      const salesFilters = dimension === 'site' ? { ...filters, site: '' } : filters;
      const sharedSales = getFilteredSales(['month'], salesFilters);
      const totalSalesByMonth = groupSum(sharedSales, r => r.month, r => r.salesAmount);
      const totalCombinedSales = sum(sharedSales, r => r.salesAmount);

      datasets = values.map((val, i) => {
        const records = getFilteredRecords(['month'], { ...filters, [dimension]: val });
        const csByMonth = groupSum(records, r => r.month, r => r.cs);
        const monthly = MONTH_ORDER.map(m => {
          const totalSales = totalSalesByMonth[m] || 0;
          return totalSales > 0 ? ((csByMonth[m] || 0) / totalSales) * 100 : 0;
        });
        const totalCsVal = sum(records, r => r.cs);
        const avg = totalCombinedSales > 0 ? (totalCsVal / totalCombinedSales) * 100 : 0;
        const hasData = Object.values(csByMonth).some(v => v !== 0);
        if (hasData) hasAnyData = true;

        return {
          label: `${val}${labelSuffix}`,
          data: [...monthly, avg],
          backgroundColor: shades[i],
          borderColor: shades[i],
          borderRadius: 2,
          maxBarThickness: 38,
          stack: colorFamily
        };
      });
    } else {
      // clustered — แต่ละ series เทียบ % ของตัวเอง (หารด้วยยอดขายของตัวเอง) เพื่อเปรียบเทียบ
      // ประสิทธิภาพระหว่างกัน ไม่ได้เอามาบวกกัน จึงไม่มีปัญหาเรื่องตัวหารร่วมแบบ stacked
      datasets = values.map((val, i) => {
        const s = computePercentSeries({ ...filters, [dimension]: val });
        if (s.hasData) hasAnyData = true;
        return {
          label: `${val}${labelSuffix}`,
          data: [...s.monthly, s.avg],
          backgroundColor: shades[i],
          borderColor: shades[i],
          borderRadius: 2,
          maxBarThickness: Math.max(10, 60 / values.length)
        };
      });
    }

    return { datasets, hasData: hasAnyData };
  }

  // normal
  const s = computePercentSeries(filters);
  return {
    datasets: [{
      label: `% CS.${labelSuffix}`,
      data: [...s.monthly, s.avg],
      backgroundColor: CHART_COLORS[`${colorFamily}Faint`],
      borderColor: CHART_COLORS[colorFamily],
      borderWidth: 1.5,
      borderRadius: 2,
      maxBarThickness: 38
    }],
    hasData: s.hasData
  };
}

/**
 * เส้น % Target — แสดงเฉพาะตอนเลือก Fiscal Year เดียวจริงๆ (ไม่ใช่ All)
 * และมีข้อมูลปีนั้นอยู่ใน sheet Input_target
 */
function buildTargetLineDatasets() {
  const fy = getActiveFilters().fiscalYear;
  if (!fy) return [];
  const target = RAW_TARGETS.find(t => t.fiscalYear === fy);
  if (!target) return [];

  const lines = [];
  lines.push({
    type: 'line',
    label: `Target ${fy}`,
    data: Array(13).fill(target.targetPercent),
    borderColor: CHART_COLORS.safety,
    borderDash: [5, 3],
    borderWidth: 1.25,
    pointRadius: 0,
    fill: false,
    order: -1,
    stack: 'target-line-only', // กันไม่ให้ Chart.js เอาไปรวมกับแท่ง stacked หรือกับเส้น Commit
    datalabels: { display: false }
  });
  lines.push({
    type: 'line',
    label: `Commit ${fy}`,
    data: Array(13).fill(target.commitPercent),
    borderColor: CHART_COLORS.savings,
    borderDash: [2, 3],
    borderWidth: 1.25,
    pointRadius: 0,
    fill: false,
    order: -1,
    stack: 'commit-line-only', // กันไม่ให้ Chart.js เอาไปรวมกับแท่ง stacked หรือกับเส้น Target
    datalabels: { display: false }
  });
  return lines;
}

/**
 * Plugin วาดตัวเลข % บนแท่งกราฟเอง — ไม่พึ่ง CDN ภายนอกเลย (แก้ปัญหาที่
 * chartjs-plugin-datalabels โหลดไม่ติดในบางเครือข่าย) รับประกันว่าทำงานเสมอ
 * เพราะเป็นโค้ดของเราเอง ไม่ใช่ third-party script
 */
const barValueLabelsPlugin = {
  id: 'barValueLabels',
  afterDatasetsDraw(chart) {
    try {
      const opts = chart.options.plugins && chart.options.plugins.barValueLabels;
      if (!opts || opts.display === false) return;
      const formatValue = opts.mode === 'percent'
        ? (v => `${formatPercent(v)}%`)
        : (v => formatNumber(v));
      const { ctx } = chart;
      const horizontal = chart.options.indexAxis === 'y';

      chart.data.datasets.forEach((dataset, datasetIndex) => {
        if (dataset.type === 'line') return; // เส้น target/commit ไม่ต้องมีตัวเลขกำกับ
        const meta = chart.getDatasetMeta(datasetIndex);
        if (!meta || meta.hidden || !meta.data) return;
        const stacked = !!dataset.stack;

        meta.data.forEach((el, index) => {
          if (!el) return;
          const value = dataset.data[index];
          if (value === undefined || value === null || value === 0 || Number.isNaN(value)) return;

          const x = el.x;
          const y = el.y;
          const base = el.base;
          const width = el.width;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;

          ctx.save();
          ctx.fillStyle = stacked ? '#ffffff' : (opts.color || '#5f5f5f');

          if (horizontal) {
            const barLength = Number.isFinite(base) ? Math.abs(x - base) : 24;
            const barThickness = (el.height != null ? el.height : (typeof el.height === 'function' ? el.height() : null)) || 20;
            const basis = stacked ? Math.min(barLength, barThickness) : barThickness;
            const fontSize = Math.max(7, Math.min(11, Math.floor(basis / 2.2)));
            ctx.font = `${fontSize}px 'IBM Plex Mono', monospace`;
            ctx.textBaseline = 'middle';
            if (stacked) {
              ctx.textAlign = 'center';
              ctx.fillText(formatValue(value), (x + base) / 2, y);
            } else {
              ctx.textAlign = 'left';
              ctx.fillText(formatValue(value), x + 4, y);
            }
          } else {
            const barWidth = width || 24;
            const barHeight = Number.isFinite(base) ? Math.abs(base - y) : 20;
            const basis = stacked ? Math.min(barWidth, barHeight) : barWidth;
            const fontSize = Math.max(7, Math.min(11, Math.floor(basis / 3.2)));
            ctx.font = `${fontSize}px 'IBM Plex Mono', monospace`;
            ctx.textAlign = 'center';
            if (stacked) {
              ctx.textBaseline = 'middle';
              ctx.fillText(formatValue(value), x, (y + base) / 2);
            } else {
              ctx.textBaseline = 'bottom';
              ctx.fillText(formatValue(value), x, y - 3);
            }
          }
          ctx.restore();
        });
      });
    } catch (err) {
      console.error('barValueLabelsPlugin draw error (ตัวเลขบนแท่งอาจหายไปแต่กราฟยังใช้งานได้):', err);
    }
  }
};

function maxOfDatasets(datasets) {
  let max = 0;
  datasets.forEach(ds => {
    if (ds.type === 'line') return; // เส้น target/commit ไม่นับรวมตอนหา max ของแท่ง
    (ds.data || []).forEach(v => {
      if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v;
    });
  });
  return max;
}

/**
 * ปัดค่า max ของแกน Y ขึ้นเป็นเลข "สวย" (1/2/2.5/5/10 คูณด้วย 10^n) แทนที่จะใช้
 * ค่าดิบตรงๆ ปกติ Chart.js จะเลือกเลขสวยแบบนี้ให้เองอัตโนมัติ (ผ่าน grace) แต่พอ
 * เราบังคับ max ตายตัวเพื่อให้กราฟ Compare ใช้สเกลเดียวกับกราฟหลัก (sharedYMax)
 * มันเลยได้เลขแปลกๆ ที่ไม่ลงตัว (เช่น 2.41%) เทียบกับตอนไม่ compare (2.50%)
 * ฟังก์ชันนี้แก้ให้ปัดขึ้นเป็นเลขสวยเหมือนกันทั้งสองโหมด
 */
function niceCeilingMax(value) {
  if (!(value > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude; // อยู่ในช่วง [1, 10)
  let niceNormalized;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 2.5) niceNormalized = 2.5;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function destroyCompareChart() {
  if (compareChartInstance) {
    compareChartInstance.destroy();
    compareChartInstance = null;
  }
  document.getElementById('chart-trend-compare').hidden = true;
}

function renderTrendChart() {
  if (!CHARTJS_AVAILABLE) return;

  const labels = [...MONTH_ORDER, 'AVG.'];
  const primary = buildModeDatasets(getActiveFilters(), 'savings', '', chartViewMode, chartSplitBy);
  let datasets = [...primary.datasets];
  let hasData = primary.hasData;

  const targetLines = buildTargetLineDatasets();
  datasets = datasets.concat(targetLines);

  setChartEmptyState('chart-trend-empty', !hasData);

  const stackedMode = chartViewMode === 'stacked';

  // ---------- คำนวณ sharedYMax ก่อนสร้างกราฟ (ต้องรู้ก่อนเพื่อให้ทั้งสองกราฟใช้สเกลเดียวกัน) ----------
  let sharedYMax = null;
  let compareBuild = null;
  if (compareEnabled) {
    compareBuild = buildModeDatasets(getCompareFilters(), 'safety', '', compareViewMode, compareSplitBy);
    const primaryMax = maxOfDatasets(primary.datasets);
    const compareMax = maxOfDatasets(compareBuild.datasets);
    sharedYMax = niceCeilingMax(Math.max(primaryMax, compareMax, 0.01) * 1.15);
  }

  const ctx = document.getElementById('chart-trend');
  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    plugins: [barValueLabelsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: CHART_COLORS.text, font: { family: "'IBM Plex Mono', monospace", size: 10.5 }, boxWidth: 12 }
        },
        barValueLabels: {
          display: true,
          color: CHART_COLORS.text,
          mode: 'percent'
        },
        tooltip: {
          backgroundColor: '#1e252b',
          borderColor: '#2a3540',
          borderWidth: 1,
          titleFont: { family: "'IBM Plex Mono', monospace", size: 11 },
          bodyFont: { family: "'IBM Plex Mono', monospace", size: 11 },
          callbacks: {
            label: ctx => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${formatPercent(ctx.parsed.y)}%`
          }
        }
      },
      scales: {
        x: {
          stacked: stackedMode,
          grid: { color: CHART_COLORS.grid, drawTicks: false },
          ticks: { font: { size: 10.5 } }
        },
        y: {
          stacked: stackedMode,
          grid: { color: CHART_COLORS.grid, drawTicks: false },
          ticks: { font: { size: 10.5 }, callback: v => `${formatPercent(v)}%` },
          beginAtZero: true,
          max: sharedYMax || undefined,
          grace: sharedYMax ? undefined : '12%'
        }
      }
    }
  });

  // ---------- Compare: กราฟซ้อนแยกต่างหาก แบบโปร่งใส ไม่รวม dataset เดียวกัน ----------
  // ต้องสร้าง "หลังจาก" กราฟหลักเสร็จแล้วเท่านั้น เพราะต้องใช้ charts.trend.chartArea
  // (พื้นที่วาดจริงเป็นพิกเซล) มาบังคับให้กราฟ compare วาดทับตำแหน่งเดียวกันเป๊ะๆ
  // ก่อนหน้านี้กราฟ compare ปิดทั้งแกนและ legend (display:false) ทำให้ Chart.js
  // ไม่เว้นพื้นที่ขอบให้เลย ในขณะที่กราฟหลักเว้นขอบไว้จริงสำหรับแกน/legend ผลคือ
  // "พื้นที่วาดกราฟ" ของสองแคนวาสมีขนาด/ตำแหน่งไม่ตรงกัน ทำให้แท่งเหลื่อมกัน
  if (compareEnabled && compareBuild) {
    renderCompareChart(labels, compareBuild.datasets, sharedYMax, charts.trend.chartArea);
  } else {
    destroyCompareChart();
  }
}

/**
 * วาดกราฟ Compare เป็น chart แยกต่างหากบน canvas ที่ซ้อนทับ chart หลักแบบโปร่งใส
 * (ไม่รวมเป็น dataset เดียวกับกราฟหลัก) แกน Y ใช้ max ร่วมกับกราฟหลักเพื่อให้เทียบกันได้ตรงสเกล
 * primaryChartArea: พื้นที่วาดจริงของกราฟหลัก (พิกเซล) — ใช้บังคับให้ compare วาดทับตำแหน่งเดียวกันเป๊ะ
 */
function renderCompareChart(labels, datasets, sharedYMax, primaryChartArea) {
  const canvas = document.getElementById('chart-trend-compare');
  canvas.hidden = false;

  const stackedMode = compareViewMode === 'stacked';
  const frame = canvas.parentElement;
  const frameW = frame.clientWidth;
  const frameH = frame.clientHeight;

  if (compareChartInstance) compareChartInstance.destroy();
  compareChartInstance = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    plugins: [barValueLabelsPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      events: [], // overlay ไม่ต้องรับ hover/click เอง (ให้ pointer-events:none ทาง CSS จัดการ)
      // บังคับ padding รอบ plot area ให้เท่ากับของกราฟหลักเป๊ะๆ (พิกเซลต่อพิกเซล)
      // แทนที่จะปล่อยให้ Chart.js คำนวณเองจากแกน/legend ที่ถูกซ่อนไว้ (ซึ่งจะได้ค่าไม่ตรงกัน)
      layout: {
        padding: {
          left: primaryChartArea.left,
          right: frameW - primaryChartArea.right,
          top: primaryChartArea.top,
          bottom: frameH - primaryChartArea.bottom
        }
      },
      plugins: {
        legend: { display: false },
        barValueLabels: { display: false }, // ปิดตัวเลขบนแท่งของ overlay กันข้อความซ้อนกันดูรก
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          stacked: stackedMode,
          display: false
        },
        y: {
          stacked: stackedMode,
          display: false,
          beginAtZero: true,
          max: sharedYMax
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
    plugins: [barValueLabelsPlugin],
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
      barValueLabels: {
        display: true,
        color: CHART_COLORS.text,
        mode: 'number'
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
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
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
