// ============================================================
// CONFIG — แก้ตรงนี้ถ้า URL ของ Web App เปลี่ยน (redeploy ใหม่)
// ============================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxUkEqW7hit0LdS1QTViUkWNpgAYx8n3qgps7a-WNpSv8cC0ABNvjGOKKVYdX5KPWpC/exec';

const MONTH_ORDER = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ใช้แสดงบนจอ monitor ค้างไว้ทั้งวัน — ดึงข้อมูลใหม่อัตโนมัติทุก 24 ชม. โดยไม่ต้องกด Refresh เอง
// (ปุ่ม Refresh ด้วยมือยังใช้งานได้ตามปกติควบคู่กันไป)
const AUTO_REFRESH_MS = 24 * 60 * 60 * 1000;

const CHART_COLORS = {
  savings: '#5fbfae',
  savingsFaint: 'rgba(95,191,174,0.18)',
  safety: '#f2a63b',
  grid: '#2a3540',
  text: '#7c8791',
  palette: ['#5fbfae', '#f2a63b', '#7c93c9', '#c97ba0', '#8fb96d', '#c9986b', '#6ea3c9', '#b98f6d']
};

const CHARTJS_AVAILABLE = typeof Chart !== 'undefined';
if (CHARTJS_AVAILABLE) {
  Chart.defaults.font.family = "'IBM Plex Mono', monospace";
  Chart.defaults.color = CHART_COLORS.text;
}

// ============================================================
// STATE
// ============================================================
let RAW_RECORDS = [];
let RAW_SALES = [];
let sortState = { key: 'totalCs', dir: 'desc' };
let charts = { trend: null, dept: null, type: null };

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  setInterval(loadData, AUTO_REFRESH_MS);
  document.getElementById('refresh-btn').addEventListener('click', loadData);
  document.getElementById('clear-filters-btn').addEventListener('click', clearFilters);
  ['fiscalYear', 'site', 'dept', 'projectType', 'month'].forEach(key => {
    document.getElementById(`filter-${key}`).addEventListener('change', render);
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
// DATA LOADING
// ============================================================
async function loadData() {
  setLoadingState();
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload.success) throw new Error(payload.error || 'API returned success:false');

    RAW_RECORDS = (payload.data || []).map(normalizeRecord);
    RAW_SALES = (payload.sales || []).map(normalizeSaleRecord);
    populateFilterOptions(RAW_RECORDS);
    render();

    document.getElementById('record-count').textContent = `${payload.count} records · ${payload.salesCount ?? RAW_SALES.length} sales rows`;
    document.getElementById('last-loaded').textContent = `loaded ${new Date().toLocaleTimeString('th-TH')}`;
    hideError();
  } catch (err) {
    showError(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

function normalizeRecord(r) {
  return {
    site: r.site || 'Unknown',
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
function populateFilterOptions(records) {
  const fields = {
    fiscalYear: new Set(),
    site: new Set(),
    dept: new Set(),
    projectType: new Set(),
    month: new Set()
  };
  records.forEach(r => {
    if (r.fiscalYear) fields.fiscalYear.add(r.fiscalYear);
    if (r.site) fields.site.add(r.site);
    if (r.dept) fields.dept.add(r.dept);
    if (r.projectType) fields.projectType.add(r.projectType);
    if (r.month) fields.month.add(r.month);
  });

  fillSelect('filter-fiscalYear', [...fields.fiscalYear].sort().reverse());
  fillSelect('filter-site', [...fields.site].sort());
  fillSelect('filter-dept', [...fields.dept].sort());
  fillSelect('filter-projectType', [...fields.projectType].sort());
  fillSelect('filter-month', MONTH_ORDER.filter(m => fields.month.has(m)));
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
  render();
}

// ============================================================
// RENDER
// ============================================================
function render() {
  const filtered = getFilteredRecords();
  const filteredSales = getFilteredSales();
  renderKPIs(filtered, filteredSales);
  renderTrendChart(getFilteredRecords(['month'])); // trend always shows all months in scope
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

  document.getElementById('kpi-total-cs').textContent = formatNumber(totalCs);
  document.getElementById('kpi-total-sales').textContent = formatNumber(totalSales);
  document.getElementById('kpi-project-count').textContent = projectCount;
  document.getElementById('kpi-top-dept').textContent = topDept ? topDept[0] : '—';
  document.getElementById('kpi-top-dept-sub').textContent = topDept ? `${formatNumber(topDept[1])} CS.` : 'no data';
  document.getElementById('kpi-top-type').textContent = topType ? topType[0] : '—';
  document.getElementById('kpi-top-type-sub').textContent = topType ? `${formatNumber(topType[1])} CS.` : 'no data';
}

function renderTrendChart(records) {
  if (!CHARTJS_AVAILABLE) return;
  const byMonth = groupSum(records, r => r.month, r => r.cs);
  const values = MONTH_ORDER.map(m => byMonth[m] || 0);
  const ctx = document.getElementById('chart-trend');

  if (charts.trend) charts.trend.destroy();
  charts.trend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTH_ORDER,
      datasets: [{
        label: 'CS.',
        data: values,
        backgroundColor: CHART_COLORS.savingsFaint,
        borderColor: CHART_COLORS.savings,
        borderWidth: 1.5,
        borderRadius: 2,
        maxBarThickness: 38
      }]
    },
    options: baseChartOptions({ legend: false })
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

function baseChartOptions({ legend = false, indexAxis = 'x' } = {}) {
  return {
    indexAxis,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: legend },
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
      x: { grid: { color: CHART_COLORS.grid, drawTicks: false }, ticks: { font: { size: 10.5 } } },
      y: { grid: { color: CHART_COLORS.grid, drawTicks: false }, ticks: { font: { size: 10.5 } }, beginAtZero: true }
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
