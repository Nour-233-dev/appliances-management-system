/* =========================================================================
   دفتر المبيعات — script.js (نسخة احترافية v2)
   تطبيق ويب محلي بالكامل (بدون Backend) لإدارة مبيعات وأقساط محل أجهزة كهربائية.
   كل البيانات تُحفظ داخل المتصفح عبر localStorage.

   تنظيم الملف:
     1) Storage            6) Modal Management + Focus Trap
     2) Helpers            7) Sales (+ منع تعارض تغيير نوع البيع)
     3) Calculations       8) Payments
     4) Reports            9) Search & Filters
     5) Validation        10) Import / Export (+ CSV + تذكير النسخ الاحتياطي)
                           11) Customer Profile
                           12) Event Listeners
                           13) Init
   ========================================================================= */

(function () {
  "use strict";

  /* =====================================================================
     1) STORAGE
     ===================================================================== */

  const STORAGE_KEY = "electro_sales_data_v1";     // لا يجب تغييره أبدًا
  const LAST_EXPORT_KEY = "electro_last_export_at_v1";

  let sales = [];
  let bannerDismissedThisSession = false;

  function loadData() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      console.error("تعذر الوصول إلى localStorage:", err);
      sales = [];
      return;
    }
    if (!raw) { sales = []; return; }
    try {
      const parsed = JSON.parse(raw);
      sales = Array.isArray(parsed) ? sanitizeSalesArray(parsed) : [];
    } catch (err) {
      console.error("البيانات المحفوظة تالفة، سيتم البدء بقائمة فارغة:", err);
      sales = [];
    }
  }

  function sanitizeSalesArray(arr) {
    return arr
      .filter((item) => item && typeof item === "object" && typeof item.customerName === "string")
      .map((item) => ({
        ...item,
        id: item.id || generateId(),
        saleType: item.saleType === "installment" ? "installment" : "cash",
        price: Number(item.price) || 0,
        downPayment: Number(item.downPayment) || 0,
        payments: Array.isArray(item.payments) ? item.payments : [],
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
      }));
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
      return true;
    } catch (err) {
      console.error("تعذر حفظ البيانات:", err);
      showToast("حدث خطأ أثناء حفظ البيانات. تأكد من مساحة التخزين المتاحة بالمتصفح.", "danger");
      return false;
    }
  }

  function getLastExportAt() {
    try {
      const v = localStorage.getItem(LAST_EXPORT_KEY);
      return v ? Number(v) : null;
    } catch (err) { return null; }
  }

  function markExported() {
    try { localStorage.setItem(LAST_EXPORT_KEY, String(Date.now())); } catch (err) { /* غير مهم */ }
    checkBackupReminder();
  }

  /* =====================================================================
     2) HELPERS
     ===================================================================== */

  function generateId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** حماية من XSS: أي نص يُدخله المستخدم يُحوَّل إلى نص آمن قبل وضعه داخل HTML */
  function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = value === null || value === undefined ? "" : String(value);
    return div.innerHTML;
  }

  function formatMoney(num) {
    const n = Number(num) || 0;
    return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  function todayISO() {
    const d = new Date();
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 10);
  }

  /** تحويل تاريخ ISO إلى صيغة يوم/شهر/سنة (للعرض فقط، الحسابات تعتمد على ISO) */
  function formatDateDisplay(isoDate) {
    if (!isoDate) return "—";
    const d = new Date(isoDate + "T00:00:00");
    if (isNaN(d.getTime())) return isoDate;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${d.getFullYear()}`;
  }

  function addMonths(isoDate, months) {
    const d = new Date(isoDate + "T00:00:00");
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(aISO, bISO) {
    const a = new Date(aISO + "T00:00:00");
    const b = new Date(bISO + "T00:00:00");
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  function isValidPhone(phone) {
    const cleaned = String(phone || "").trim().replace(/[\s-]/g, "");
    return /^\+?[0-9]{8,15}$/.test(cleaned);
  }

  /** تأخير تنفيذ دالة حتى يتوقف المستخدم عن الكتابة لفترة بسيطة (لتحسين أداء البحث) */
  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function showToast(message, type = "default") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = "toast" + (type === "success" ? " toast--success" : type === "danger" ? " toast--danger" : "");
    toast.setAttribute("role", type === "danger" ? "alert" : "status");
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  /** توست خاص بإمكانية التراجع (يُستخدم بعد الحذف) */
  function showUndoToast(message, onUndo) {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");

    const text = document.createElement("span");
    text.textContent = message;
    toast.appendChild(text);

    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "toast__undo-btn";
    undoBtn.textContent = "تراجع";
    undoBtn.addEventListener("click", () => {
      onUndo();
      toast.remove();
    });
    toast.appendChild(undoBtn);

    container.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  /* =====================================================================
     3) CALCULATIONS
     ===================================================================== */

  function getDerived(sale) {
    const payments = Array.isArray(sale.payments) ? sale.payments : [];
    const paymentsSum = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    let totalPaid = sale.saleType === "cash"
      ? (Number(sale.price) || 0)
      : (Number(sale.downPayment) || 0) + paymentsSum;

    let remaining = (Number(sale.price) || 0) - totalPaid;
    if (remaining < 0.01) remaining = 0;

    let installmentValue = null;
    let nextDueDate = null;

    if (sale.saleType === "installment") {
      const count = Number(sale.installmentsCount) || 0;
      const remainingAtStart = (Number(sale.price) || 0) - (Number(sale.downPayment) || 0);
      installmentValue = count > 0 ? remainingAtStart / count : 0;
      if (remaining > 0 && sale.firstInstallmentDate) {
        nextDueDate = addMonths(sale.firstInstallmentDate, payments.length);
      }
    }
    return { totalPaid, remaining, installmentValue, nextDueDate };
  }

  function getPaymentStatus(sale, derived) {
    if (sale.saleType === "cash" || derived.remaining <= 0) {
      return { key: "paid", label: "مسدد بالكامل", badgeClass: "badge--paid" };
    }
    if (!derived.nextDueDate) {
      return { key: "upcoming", label: "قسط قادم", badgeClass: "badge--upcoming" };
    }
    const diff = daysBetween(todayISO(), derived.nextDueDate);
    if (diff < 0) return { key: "late", label: `متأخر (${formatDateDisplay(derived.nextDueDate)})`, badgeClass: "badge--late" };
    if (diff === 0) return { key: "today", label: "مستحق اليوم", badgeClass: "badge--today" };
    if (diff <= 7) return { key: "week", label: `خلال ${diff} يوم`, badgeClass: "badge--week" };
    return { key: "upcoming", label: formatDateDisplay(derived.nextDueDate), badgeClass: "badge--upcoming" };
  }

  /* =====================================================================
     4) REPORTS (تقارير ورسوم بيانية بسيطة بدون أي مكتبات خارجية)
     ===================================================================== */

  const ARABIC_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

  function getMonthKey(iso) { return (iso || "").slice(0, 7); }

  function shiftMonthKey(monthKey, delta) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function monthKeyToLabel(monthKey) {
    const [y, m] = monthKey.split("-").map(Number);
    return `${ARABIC_MONTHS[m - 1]} ${String(y).slice(2)}`;
  }

  /** إجمالي قيمة المبيعات لكل شهر من آخر 6 أشهر (بما فيها الشهر الحالي) */
  function computeMonthlySales(salesArr, currentMonthKey) {
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonthKey(currentMonthKey, -i));
    const totals = Object.fromEntries(months.map((m) => [m, 0]));
    salesArr.forEach((s) => {
      const mk = getMonthKey(s.purchaseDate);
      if (mk in totals) totals[mk] += Number(s.price) || 0;
    });
    return months.map((m) => ({ key: m, total: totals[m] }));
  }

  /** أكثر N أنواع أجهزة مبيعًا حسب عدد مرات البيع */
  function computeTopDevices(salesArr, topN = 5) {
    const counts = {};
    salesArr.forEach((s) => {
      const key = (s.deviceType || "غير محدد").trim() || "غير محدد";
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([type, count]) => ({ type, count }));
  }

  /** يبني رسمًا بيانيًا بالأعمدة كـ SVG بسيط، بدون أي مكتبة خارجية */
  function buildBarChartSVG(items, formatValue) {
    const width = 560, height = 200, paddingTop = 24, paddingBottom = 34, barGap = 16;
    const chartHeight = height - paddingTop - paddingBottom;
    const n = items.length;
    if (n === 0) return "";
    const barWidth = (width - barGap * (n + 1)) / n;
    const maxVal = Math.max(1, ...items.map((d) => d.value));

    let svgInner = "";
    items.forEach((d, i) => {
      const barHeight = (d.value / maxVal) * chartHeight;
      const x = barGap + i * (barWidth + barGap);
      const y = paddingTop + (chartHeight - barHeight);
      svgInner += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight, 1).toFixed(1)}" rx="4" style="fill:var(--primary)"></rect>`;
      svgInner += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${Math.max(y - 6, 12).toFixed(1)}" text-anchor="middle" class="chart-value-label">${escapeHTML(formatValue(d.value))}</text>`;
      svgInner += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(height - 12).toFixed(1)}" text-anchor="middle" class="chart-bar-label">${escapeHTML(d.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="رسم بياني بالأعمدة">${svgInner}</svg>`;
  }

  function renderMonthlySalesChart() {
    const container = document.getElementById("monthlySalesChart");
    const emptyMsg = document.getElementById("monthlySalesEmptyMsg");
    if (sales.length === 0) {
      container.innerHTML = "";
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;
    const monthly = computeMonthlySales(sales, getMonthKey(todayISO()));
    const items = monthly.map((m) => ({ label: monthKeyToLabel(m.key), value: m.total }));
    container.innerHTML = buildBarChartSVG(items, (v) => formatMoney(v));
  }

  function renderTopDevicesChart() {
    const container = document.getElementById("topDevicesChart");
    const emptyMsg = document.getElementById("topDevicesEmptyMsg");
    if (sales.length === 0) {
      container.innerHTML = "";
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;
    const top = computeTopDevices(sales, 5);
    const items = top.map((t) => ({ label: t.type, value: t.count }));
    container.innerHTML = buildBarChartSVG(items, (v) => String(v));
  }

  /* =====================================================================
     5) VALIDATION
     ===================================================================== */

  function validateSaleData(data) {
    if (!data.customerName) return "الاسم الثلاثي للعميل مطلوب.";
    if (!data.village) return "القرية / المدينة مطلوبة.";
    if (!data.phone) return "رقم الهاتف مطلوب.";
    if (!isValidPhone(data.phone)) return "رقم الهاتف غير صالح، أدخل أرقامًا فقط (8 إلى 15 رقمًا).";
    if (!data.deviceType) return "نوع الجهاز مطلوب.";
    if (!data.brand) return "الماركة مطلوبة.";
    if (!data.price || isNaN(data.price) || data.price <= 0) return "سعر الجهاز يجب أن يكون أكبر من صفر.";
    if (!data.purchaseDate) return "تاريخ الشراء مطلوب.";

    if (data.saleType === "installment") {
      if (data.downPayment < 0) return "المقدم لا يمكن أن يكون رقمًا سالبًا.";
      if (data.downPayment > data.price) return "المقدم لا يمكن أن يكون أكبر من سعر الجهاز.";
      if (!data.installmentsCount || data.installmentsCount < 1) return "عدد الأقساط يجب أن يكون 1 على الأقل.";
      if (!data.firstInstallmentDate) return "تاريخ أول قسط مطلوب في حالة التقسيط.";
    }
    return null;
  }

  /** يمنع تحويل عملية من "تقسيط" إلى "كاش" أثناء التعديل إذا كانت لها دفعات مسجلة بالفعل */
  function validateSaleTypeChange(existingSale, newSaleType) {
    if (!existingSale) return null;
    const hasPayments = Array.isArray(existingSale.payments) && existingSale.payments.length > 0;
    if (existingSale.saleType === "installment" && newSaleType === "cash" && hasPayments) {
      return "لا يمكن تحويل هذه العملية إلى كاش لأن بها دفعات مسجلة بالفعل. احذف سجل الدفعات أولًا إذا كنت متأكدًا من هذا التغيير.";
    }
    return null;
  }

  /** يبحث عن عملية أخرى بنفس رقم الهاتف (لاكتشاف تكرار العميل) */
  function findDuplicatePhone(phone, excludeId) {
    const cleaned = String(phone || "").trim();
    if (!cleaned) return null;
    return sales.find((s) => s.phone && s.phone.trim() === cleaned && s.id !== excludeId) || null;
  }

  /* =====================================================================
     RENDERING (الإحصائيات + الأقساط المستحقة + جدول السجل)
     ===================================================================== */

  let activeDueTab = "today";
  let activeRecordFilter = "all";

  function renderStats() {
    let totalSales = 0, totalPaid = 0, totalRemaining = 0, cashCount = 0, installmentCount = 0;
    sales.forEach((sale) => {
      const d = getDerived(sale);
      totalSales += Number(sale.price) || 0;
      totalPaid += d.totalPaid;
      totalRemaining += d.remaining;
      if (sale.saleType === "cash") cashCount++; else installmentCount++;
    });
    document.getElementById("statCount").textContent = sales.length;
    document.getElementById("statTotalSales").textContent = formatMoney(totalSales);
    document.getElementById("statTotalPaid").textContent = formatMoney(totalPaid);
    document.getElementById("statTotalRemaining").textContent = formatMoney(totalRemaining);
    document.getElementById("statInstallmentCount").textContent = installmentCount;
    document.getElementById("statCashCount").textContent = cashCount;
  }

  function renderDueSection() {
    const grouped = { today: [], week: [], late: [] };
    sales.forEach((sale) => {
      const derived = getDerived(sale);
      const status = getPaymentStatus(sale, derived);
      if (grouped[status.key]) grouped[status.key].push({ sale, derived });
    });
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => (a.derived.nextDueDate > b.derived.nextDueDate ? 1 : -1));
    });

    document.getElementById("dueTodayCount").textContent = grouped.today.length;
    document.getElementById("dueWeekCount").textContent = grouped.week.length;
    document.getElementById("dueLateCount").textContent = grouped.late.length;

    const list = grouped[activeDueTab] || [];
    const tbody = document.getElementById("dueTableBody");
    const emptyMsg = document.getElementById("dueEmptyMsg");

    if (list.length === 0) {
      tbody.innerHTML = "";
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;
    const rowClass = activeDueTab === "late" ? "due-late-row" : activeDueTab === "today" ? "due-today-row" : "";
    tbody.innerHTML = list.map(({ sale, derived }) => `
        <tr class="${rowClass}">
          <td>${escapeHTML(sale.customerName)}</td>
          <td>${escapeHTML(sale.phone)}</td>
          <td>${formatMoney(derived.installmentValue)}</td>
          <td>${formatDateDisplay(derived.nextDueDate)}</td>
          <td>${formatMoney(derived.remaining)}</td>
        </tr>`).join("");
  }

  function renderRecordsTable() {
    const searchTerm = document.getElementById("searchInput").value.trim().toLowerCase();

    const filtered = sales.filter((sale) => {
      const derived = getDerived(sale);
      const status = getPaymentStatus(sale, derived);

      const matchesSearch = !searchTerm || [
        sale.customerName, sale.phone, sale.village, sale.deviceType, sale.brand,
      ].some((f) => (f || "").toLowerCase().includes(searchTerm));

      let matchesFilter = true;
      if (activeRecordFilter === "cash") matchesFilter = sale.saleType === "cash";
      else if (activeRecordFilter === "installment") matchesFilter = sale.saleType === "installment";
      else if (activeRecordFilter === "late") matchesFilter = status.key === "late";
      else if (activeRecordFilter === "paid") matchesFilter = status.key === "paid";

      return matchesSearch && matchesFilter;
    });

    const tbody = document.getElementById("recordsTableBody");
    const emptyMsg = document.getElementById("recordsEmptyMsg");

    if (filtered.length === 0) {
      tbody.innerHTML = "";
      emptyMsg.hidden = false;
      emptyMsg.textContent = sales.length === 0
        ? 'لا توجد بيانات بعد. اضغط "عملية بيع جديدة" للبدء.'
        : "لا توجد نتائج مطابقة للبحث أو الفلتر المحدد.";
      return;
    }
    emptyMsg.hidden = true;

    const sorted = [...filtered].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    tbody.innerHTML = sorted.map((sale) => {
      const derived = getDerived(sale);
      const status = getPaymentStatus(sale, derived);
      const isCash = sale.saleType === "cash";

      const saleTypeBadge = isCash
        ? '<span class="badge badge--cash">كاش</span>'
        : '<span class="badge badge--installment">قسط</span>';

      const dueCell = isCash
        ? '<span class="badge badge--paid">مسدد بالكامل</span>'
        : `<span class="badge ${status.badgeClass}">${escapeHTML(status.label)}</span>`;

      const paymentBtn = (!isCash && derived.remaining > 0)
        ? `<button class="btn btn--small btn--icon" data-action="payment" data-id="${escapeHTML(sale.id)}">دفعة</button>`
        : "";

      return `
        <tr data-id="${escapeHTML(sale.id)}">
          <td><button type="button" class="customer-link" data-action="profile" data-phone="${escapeHTML(sale.phone)}">${escapeHTML(sale.customerName)}</button></td>
          <td>${escapeHTML(sale.village)}</td>
          <td>${escapeHTML(sale.phone)}</td>
          <td>${escapeHTML(sale.deviceType)}</td>
          <td>${escapeHTML(sale.brand)}</td>
          <td>${formatMoney(sale.price)}</td>
          <td>${saleTypeBadge}</td>
          <td>${formatMoney(derived.totalPaid)}</td>
          <td>${formatMoney(derived.remaining)}</td>
          <td>${isCash ? "—" : formatMoney(derived.installmentValue)}</td>
          <td>${dueCell}</td>
          <td>
            <div class="row-actions">
              ${paymentBtn}
              <button class="btn btn--small btn--icon" data-action="edit" data-id="${escapeHTML(sale.id)}">تعديل</button>
              <button class="btn btn--small btn--icon" data-action="delete" data-id="${escapeHTML(sale.id)}">حذف</button>
            </div>
          </td>
        </tr>`;
    }).join("");
  }

  function renderAll() {
    renderStats();
    renderDueSection();
    renderRecordsTable();
    renderMonthlySalesChart();
    renderTopDevicesChart();
    checkBackupReminder();
  }

  /* =====================================================================
     6) MODAL MANAGEMENT + FOCUS TRAP
     ===================================================================== */

  const saleModalOverlay = document.getElementById("saleModalOverlay");
  const paymentModalOverlay = document.getElementById("paymentModalOverlay");
  const confirmModalOverlay = document.getElementById("confirmModalOverlay");
  const customerProfileModalOverlay = document.getElementById("customerProfileModalOverlay");

  function openModal(overlayEl) {
    overlayEl.hidden = false;
    const firstField = overlayEl.querySelector("input:not([type=hidden]):not([disabled]), button");
    if (firstField) setTimeout(() => firstField.focus(), 30);
  }

  function closeModal(overlayEl) {
    overlayEl.hidden = true;
  }

  function getFocusableIn(container) {
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])'
    )).filter((el) => el.offsetParent !== null);
  }

  /** نافذة تأكيد عامة تُستخدم للحذف وللاستيراد بنفس عناصر HTML الموجودة */
  let pendingConfirmAction = null;

  function openConfirmModal({ title, message, confirmLabel, danger = true }, onConfirm) {
    document.getElementById("confirmModalTitle").textContent = title;
    document.getElementById("confirmModalMessage").textContent = message;
    const btn = document.getElementById("btnConfirmDelete");
    btn.textContent = confirmLabel;
    btn.classList.toggle("btn--danger", danger);
    btn.classList.toggle("btn--primary", !danger);
    pendingConfirmAction = onConfirm;
    openModal(confirmModalOverlay);
  }

  function runPendingConfirmAction() {
    if (typeof pendingConfirmAction === "function") pendingConfirmAction();
    pendingConfirmAction = null;
    closeModal(confirmModalOverlay);
  }

  /* =====================================================================
     7) SALES (إضافة / تعديل / حذف)
     ===================================================================== */

  const saleForm = document.getElementById("saleForm");
  const installmentFieldset = document.getElementById("installmentFieldset");

  function toggleInstallmentFields() {
    const isInstallment = document.getElementById("saleTypeInstallment").checked;
    installmentFieldset.hidden = !isInstallment;
    ["downPayment", "installmentsCount", "firstInstallmentDate"].forEach((id) => {
      const inp = document.getElementById(id);
      inp.required = isInstallment;
      if (!isInstallment) inp.value = "";
    });
    updateInstallmentPreview();
  }

  function updateInstallmentPreview() {
    const price = Number(document.getElementById("price").value) || 0;
    const down = Number(document.getElementById("downPayment").value) || 0;
    const count = Number(document.getElementById("installmentsCount").value) || 0;
    const remaining = Math.max(price - down, 0);
    document.getElementById("remainingPreview").value = formatMoney(remaining);
    document.getElementById("installmentValuePreview").value = count > 0 ? formatMoney(remaining / count) : "";
  }

  function resetSaleForm() {
    saleForm.reset();
    document.getElementById("saleId").value = "";
    installmentFieldset.hidden = true;
    document.getElementById("remainingPreview").value = "";
    document.getElementById("installmentValuePreview").value = "";
    document.getElementById("purchaseDate").value = todayISO();
    clearFieldErrors(saleForm);
    document.getElementById("phoneDuplicateWarning").hidden = true;
  }

  function clearFieldErrors(formEl) {
    formEl.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
  }

  function highlightErrorField(message) {
    const map = {
      "الاسم الثلاثي": "customerName", "القرية": "village", "رقم الهاتف": "phone",
      "نوع الجهاز": "deviceType", "الماركة": "brand", "سعر الجهاز": "price",
      "تاريخ الشراء": "purchaseDate", "المقدم": "downPayment",
      "عدد الأقساط": "installmentsCount", "تاريخ أول قسط": "firstInstallmentDate",
    };
    const key = Object.keys(map).find((k) => message.includes(k));
    if (key) {
      const el = document.getElementById(map[key]);
      if (el) { el.classList.add("field-error"); el.focus(); }
    }
  }

  function checkPhoneDuplicate() {
    const phone = document.getElementById("phone").value.trim();
    const currentId = document.getElementById("saleId").value;
    const warningEl = document.getElementById("phoneDuplicateWarning");
    const dup = findDuplicatePhone(phone, currentId);
    if (dup) {
      warningEl.textContent = `⚠ هذا الرقم مسجل من قبل باسم "${dup.customerName}".`;
      warningEl.hidden = false;
    } else {
      warningEl.hidden = true;
    }
  }

  function openSaleModalForCreate() {
    resetSaleForm();
    document.getElementById("saleModalTitle").textContent = "عملية بيع جديدة";
    openModal(saleModalOverlay);
  }

  function openSaleModalForEdit(saleId) {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;

    resetSaleForm();
    document.getElementById("saleModalTitle").textContent = "تعديل بيانات العملية";
    document.getElementById("saleId").value = sale.id;
    document.getElementById("customerName").value = sale.customerName || "";
    document.getElementById("village").value = sale.village || "";
    document.getElementById("phone").value = sale.phone || "";
    document.getElementById("deviceType").value = sale.deviceType || "";
    document.getElementById("brand").value = sale.brand || "";
    document.getElementById("manufactureYear").value = sale.manufactureYear || "";
    document.getElementById("price").value = sale.price || "";
    document.getElementById("purchaseDate").value = sale.purchaseDate || "";

    if (sale.saleType === "installment") {
      document.getElementById("saleTypeInstallment").checked = true;
      toggleInstallmentFields();
      document.getElementById("downPayment").value = sale.downPayment || "";
      document.getElementById("installmentsCount").value = sale.installmentsCount || "";
      document.getElementById("firstInstallmentDate").value = sale.firstInstallmentDate || "";
      updateInstallmentPreview();
    } else {
      document.getElementById("saleTypeCash").checked = true;
      toggleInstallmentFields();
    }

    openModal(saleModalOverlay);
  }

  function handleSaleFormSubmit(e) {
    e.preventDefault();
    clearFieldErrors(saleForm);

    const id = document.getElementById("saleId").value;
    const saleType = document.getElementById("saleTypeInstallment").checked ? "installment" : "cash";

    const data = {
      customerName: document.getElementById("customerName").value.trim(),
      village: document.getElementById("village").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      deviceType: document.getElementById("deviceType").value.trim(),
      brand: document.getElementById("brand").value.trim(),
      manufactureYear: document.getElementById("manufactureYear").value
        ? Number(document.getElementById("manufactureYear").value) : null,
      price: Number(document.getElementById("price").value),
      purchaseDate: document.getElementById("purchaseDate").value,
      saleType,
      downPayment: saleType === "installment" ? (Number(document.getElementById("downPayment").value) || 0) : 0,
      installmentsCount: saleType === "installment" ? (Number(document.getElementById("installmentsCount").value) || 0) : null,
      firstInstallmentDate: saleType === "installment" ? document.getElementById("firstInstallmentDate").value : null,
    };

    const errorMessage = validateSaleData(data);
    if (errorMessage) {
      showToast(errorMessage, "danger");
      highlightErrorField(errorMessage);
      return;
    }

    if (id) {
      const existing = sales.find((s) => s.id === id);
      const typeChangeError = validateSaleTypeChange(existing, saleType);
      if (typeChangeError) {
        showToast(typeChangeError, "danger");
        return;
      }
      const idx = sales.findIndex((s) => s.id === id);
      if (idx > -1) {
        sales[idx] = { ...sales[idx], ...data, updatedAt: Date.now() };
        saveData();
        renderAll();
        showToast("تم حفظ التعديلات بنجاح.", "success");
      }
    } else {
      sales.push({ id: generateId(), ...data, payments: [], createdAt: Date.now(), updatedAt: Date.now() });
      saveData();
      renderAll();
      showToast("تم تسجيل عملية البيع بنجاح.", "success");
    }

    closeModal(saleModalOverlay);
    resetSaleForm();
  }

  function openDeleteConfirm(saleId) {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;

    const paymentsCount = Array.isArray(sale.payments) ? sale.payments.length : 0;
    const paymentsNote = paymentsCount > 0
      ? ` سيؤدي هذا أيضًا إلى حذف سجل دفعاتها المكوّن من ${paymentsCount} دفعة.`
      : "";

    openConfirmModal({
      title: "تأكيد حذف عملية البيع",
      message: `هل أنت متأكد من حذف عملية بيع "${sale.deviceType || ""}" الخاصة بالعميل "${sale.customerName || ""}"؟${paymentsNote}`,
      confirmLabel: "حذف نهائيًا",
      danger: true,
    }, () => deleteSaleWithUndo(saleId));
  }

  /** حذف فعلي فورًا (لضمان تحديث البيانات والإحصائيات)، مع إتاحة "تراجع" لفترة قصيرة */
  function deleteSaleWithUndo(saleId) {
    const idx = sales.findIndex((s) => s.id === saleId);
    if (idx === -1) return;
    const [removed] = sales.splice(idx, 1);
    saveData();
    renderAll();

    showUndoToast("تم حذف العملية.", () => {
      sales.splice(idx, 0, removed);
      saveData();
      renderAll();
      showToast("تم التراجع عن الحذف بنجاح.", "success");
    });
  }

  /* =====================================================================
     8) PAYMENTS
     ===================================================================== */

  const paymentForm = document.getElementById("paymentForm");

  function openPaymentModal(saleId) {
    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;

    document.getElementById("paymentSaleId").value = saleId;
    document.getElementById("paymentAmount").value = "";
    document.getElementById("paymentDate").value = todayISO();

    renderPaymentModalSummary(sale);
    renderPaymentsHistory(sale);
    openModal(paymentModalOverlay);
  }

  function renderPaymentModalSummary(sale) {
    const derived = getDerived(sale);
    const status = getPaymentStatus(sale, derived);

    document.getElementById("paymentSummary").innerHTML =
      `${escapeHTML(sale.customerName)} — <span class="badge ${status.badgeClass}">${escapeHTML(status.label)}</span>`;

    const grid = document.getElementById("paymentDetailsGrid");
    grid.innerHTML = [
      ["إجمالي السعر", formatMoney(sale.price) + " ج.م"],
      ["المقدم", formatMoney(sale.downPayment) + " ج.م"],
      ["عدد الأقساط", sale.installmentsCount || "—"],
      ["قيمة القسط", formatMoney(derived.installmentValue) + " ج.م"],
      ["تاريخ أول قسط", formatDateDisplay(sale.firstInstallmentDate)],
      ["القسط القادم", derived.remaining > 0 ? formatDateDisplay(derived.nextDueDate) : "—"],
      ["إجمالي المدفوع", formatMoney(derived.totalPaid) + " ج.م"],
      ["المتبقي الحالي", formatMoney(derived.remaining) + " ج.م"],
    ].map(([label, value]) => `
        <div class="info-grid__item">
          <span class="info-grid__label">${escapeHTML(label)}</span>
          <span class="info-grid__value">${escapeHTML(value)}</span>
        </div>`).join("");
  }

  function renderPaymentsHistory(sale) {
    const payments = Array.isArray(sale.payments) ? sale.payments : [];
    const tbody = document.getElementById("paymentsHistoryBody");
    const emptyMsg = document.getElementById("paymentsEmptyMsg");

    if (payments.length === 0) {
      tbody.innerHTML = "";
      emptyMsg.hidden = false;
      return;
    }
    emptyMsg.hidden = true;

    const sortedPayments = [...payments].sort((a, b) => (a.date > b.date ? 1 : -1));
    let runningPaid = sale.saleType === "cash" ? Number(sale.price) || 0 : Number(sale.downPayment) || 0;

    tbody.innerHTML = sortedPayments.map((p) => {
      runningPaid += Number(p.amount) || 0;
      const runningRemaining = Math.max((Number(sale.price) || 0) - runningPaid, 0);
      return `
        <tr>
          <td>${formatDateDisplay(p.date)}</td>
          <td>${formatMoney(p.amount)}</td>
          <td>${formatMoney(runningPaid)}</td>
          <td>${formatMoney(runningRemaining)}</td>
        </tr>`;
    }).join("");
  }

  function handlePaymentFormSubmit(e) {
    e.preventDefault();

    const saleId = document.getElementById("paymentSaleId").value;
    const amount = Number(document.getElementById("paymentAmount").value);
    const date = document.getElementById("paymentDate").value;

    const sale = sales.find((s) => s.id === saleId);
    if (!sale) return;

    if (!amount || amount <= 0) {
      showToast("من فضلك أدخل قيمة دفعة صحيحة أكبر من صفر.", "danger");
      return;
    }
    if (!date) {
      showToast("من فضلك أدخل تاريخ الدفعة.", "danger");
      return;
    }

    const derived = getDerived(sale);
    if (amount > derived.remaining + 0.009) {
      showToast(`لا يمكن تسجيل دفعة أكبر من المتبقي (${formatMoney(derived.remaining)} ج.م). لم يتم تعديل أي بيانات.`, "danger");
      return;
    }

    if (!Array.isArray(sale.payments)) sale.payments = [];
    sale.payments.push({ id: generateId(), date, amount });
    sale.updatedAt = Date.now();

    saveData();
    renderAll();
    renderPaymentModalSummary(sale);
    renderPaymentsHistory(sale);

    document.getElementById("paymentAmount").value = "";
    document.getElementById("paymentDate").value = todayISO();
    document.getElementById("paymentAmount").focus();

    const newDerived = getDerived(sale);
    showToast(
      newDerived.remaining <= 0 ? "تم تسجيل الدفعة، وتم سداد العملية بالكامل! 🎉" : "تم تسجيل الدفعة بنجاح.",
      "success"
    );
  }

  /* =====================================================================
     9) SEARCH & FILTERS
     ===================================================================== */

  function setupDueTabs() {
    document.querySelectorAll(".due-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeDueTab = btn.dataset.due;
        document.querySelectorAll(".due-tab").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderDueSection();
      });
    });
  }

  function setupRecordFilters() {
    document.querySelectorAll(".filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeRecordFilter = btn.dataset.filter;
        document.querySelectorAll(".filter-chip").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderRecordsTable();
      });
    });
  }

  /* =====================================================================
     10) IMPORT / EXPORT
     ===================================================================== */

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportData() {
    const payload = { appName: "دفتر المبيعات", exportedAt: new Date().toISOString(), recordCount: sales.length, sales };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `دفتر-المبيعات-نسخة-احتياطية-${todayISO()}.json`);
    markExported();
    showToast("تم تنزيل نسخة البيانات (JSON) بنجاح.", "success");
  }

  function csvEscape(value) {
    const str = String(value === null || value === undefined ? "" : value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function exportCSV() {
    const headers = ["اسم العميل", "القرية/المدينة", "رقم الهاتف", "نوع الجهاز", "الماركة", "سنة التصنيع",
      "السعر", "تاريخ الشراء", "نوع البيع", "المقدم", "عدد الأقساط", "قيمة القسط",
      "إجمالي المدفوع", "المتبقي", "تاريخ أول قسط", "ميعاد القسط القادم"];

    const rows = sales.map((s) => {
      const d = getDerived(s);
      return [
        s.customerName, s.village, s.phone, s.deviceType, s.brand, s.manufactureYear || "",
        s.price, formatDateDisplay(s.purchaseDate), s.saleType === "cash" ? "كاش" : "تقسيط",
        s.downPayment || 0, s.installmentsCount || "",
        d.installmentValue != null ? Math.round(d.installmentValue * 100) / 100 : "",
        Math.round(d.totalPaid * 100) / 100, Math.round(d.remaining * 100) / 100,
        s.firstInstallmentDate ? formatDateDisplay(s.firstInstallmentDate) : "",
        d.nextDueDate ? formatDateDisplay(d.nextDueDate) : "",
      ];
    });

    const csvLines = [headers, ...rows].map((row) => row.map(csvEscape).join(","));
    const csvContent = "\uFEFF" + csvLines.join("\r\n"); // BOM حتى يقرأ Excel العربية بشكل صحيح
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `دفتر-المبيعات-${todayISO()}.csv`);
    markExported();
    showToast("تم تصدير ملف Excel (CSV) بنجاح.", "success");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        showToast("تعذر قراءة الملف: الملف ليس بصيغة JSON صحيحة.", "danger");
        return;
      }

      const incomingSales = Array.isArray(parsed) ? parsed : parsed.sales;
      if (!Array.isArray(incomingSales)) {
        showToast("ملف غير متوافق: لا يحتوي على بيانات مبيعات صالحة لهذا التطبيق.", "danger");
        return;
      }

      const validSales = sanitizeSalesArray(
        incomingSales.filter((item) => item && typeof item === "object" && typeof item.customerName === "string" && !isNaN(Number(item.price)))
      );

      if (validSales.length === 0) {
        showToast("الملف لا يحتوي على أي عملية بيع صحيحة قابلة للاستيراد.", "danger");
        return;
      }

      const skipped = incomingSales.length - validSales.length;
      const skippedNote = skipped > 0 ? ` (سيتم تجاهل ${skipped} عنصر غير صالح في الملف).` : "";

      openConfirmModal({
        title: "تأكيد استيراد نسخة احتياطية",
        message: `تحذير: استيراد هذه النسخة سيستبدل جميع البيانات الحالية في البرنامج (${sales.length} عملية) بالبيانات الموجودة في ملف النسخة الاحتياطية (${validSales.length} عملية). إذا كانت لديك بيانات حالية مهمة، قم بتصدير نسخة احتياطية منها أولًا قبل المتابعة.${skippedNote}`,
        confirmLabel: "استيراد واستبدال البيانات",
        danger: true,
      }, () => {
        sales = validSales;
        saveData();
        renderAll();
        showToast("تم استيراد البيانات واستبدال النسخة الحالية بنجاح.", "success");
      });
    };
    reader.onerror = () => showToast("حدث خطأ أثناء قراءة الملف.", "danger");
    reader.readAsText(file);
  }

  /** تنبيه لطيف إذا مرّ وقت طويل بدون تصدير نسخة احتياطية */
  function checkBackupReminder() {
    const banner = document.getElementById("backupReminderBanner");
    if (bannerDismissedThisSession || sales.length === 0) {
      banner.hidden = true;
      return;
    }
    const lastExport = getLastExportAt();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const needsReminder = !lastExport || (Date.now() - lastExport > sevenDaysMs);

    if (needsReminder) {
      document.getElementById("backupReminderText").textContent = lastExport
        ? "آخر نسخة احتياطية كانت منذ أكثر من أسبوع. يُفضّل تصدير نسخة جديدة الآن لحماية بياناتك."
        : "لم تقم بتصدير أي نسخة احتياطية من قبل. يُفضّل تصدير نسخة الآن لحماية بياناتك.";
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  /* =====================================================================
     11) CUSTOMER PROFILE (ملف العميل)
     ===================================================================== */

  function openCustomerProfile(phone) {
    const customerSales = sales.filter((s) => s.phone === phone);
    if (customerSales.length === 0) return;
    const latest = customerSales[0];

    document.getElementById("customerProfileModalTitle").textContent = "ملف العميل: " + latest.customerName;

    let totalPurchases = 0, totalPaidAll = 0, totalRemainingAll = 0;
    customerSales.forEach((s) => {
      const d = getDerived(s);
      totalPurchases += Number(s.price) || 0;
      totalPaidAll += d.totalPaid;
      totalRemainingAll += d.remaining;
    });

    document.getElementById("customerProfileSummary").innerHTML = [
      ["رقم الهاتف", latest.phone],
      ["القرية / المدينة", latest.village],
      ["عدد العمليات", customerSales.length],
      ["إجمالي المشتريات", formatMoney(totalPurchases) + " ج.م"],
      ["إجمالي المدفوع", formatMoney(totalPaidAll) + " ج.م"],
      ["إجمالي المتبقي", formatMoney(totalRemainingAll) + " ج.م"],
    ].map(([label, value]) => `
        <div class="info-grid__item">
          <span class="info-grid__label">${escapeHTML(label)}</span>
          <span class="info-grid__value">${escapeHTML(value)}</span>
        </div>`).join("");

    document.getElementById("customerProfileSalesBody").innerHTML = customerSales.map((s) => {
      const d = getDerived(s);
      const status = getPaymentStatus(s, d);
      return `
        <tr>
          <td>${escapeHTML(s.deviceType)}</td>
          <td>${formatMoney(s.price)}</td>
          <td>${s.saleType === "cash" ? "كاش" : "قسط"}</td>
          <td>${formatMoney(d.remaining)}</td>
          <td><span class="badge ${status.badgeClass}">${escapeHTML(status.label)}</span></td>
        </tr>`;
    }).join("");

    openModal(customerProfileModalOverlay);
  }

  /* =====================================================================
     ENTER KEY NAVIGATION
     ===================================================================== */

  function setupEnterNavigation(formEl) {
    const focusable = () => getFocusableIn(formEl).filter((el) => el.tagName !== "BUTTON" || el.type === "submit");
    formEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
      e.preventDefault();
      const items = getFocusableIn(formEl).filter((el) => !(el.tagName === "BUTTON" && el.type === "button"));
      const idx = items.indexOf(e.target);
      if (idx > -1 && idx < items.length - 1) {
        items[idx + 1].focus();
      } else if (formEl.requestSubmit) {
        formEl.requestSubmit();
      } else {
        formEl.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
  }

  /* =====================================================================
     12) EVENT LISTENERS
     ===================================================================== */

  function bindEvents() {
    document.getElementById("btnNewSale").addEventListener("click", openSaleModalForCreate);
    document.getElementById("btnExport").addEventListener("click", exportData);
    document.getElementById("btnExportCSV").addEventListener("click", exportCSV);
    document.getElementById("btnExportFromBanner").addEventListener("click", exportData);
    document.getElementById("btnDismissBackupReminder").addEventListener("click", () => {
      bannerDismissedThisSession = true;
      document.getElementById("backupReminderBanner").hidden = true;
    });

    document.getElementById("importFile").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importData(file);
      e.target.value = "";
    });

    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", () => closeModal(document.getElementById(el.dataset.closeModal)));
    });

    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal(overlay);
      });
    });

    // إغلاق بـ Escape + حبس التركيز (Focus Trap) داخل أي نافذة مفتوحة
    document.addEventListener("keydown", (e) => {
      const openOverlay = Array.from(document.querySelectorAll(".modal-overlay")).find((o) => !o.hidden);
      if (!openOverlay) return;

      if (e.key === "Escape") {
        closeModal(openOverlay);
        return;
      }
      if (e.key === "Tab") {
        const modal = openOverlay.querySelector(".modal");
        const focusables = getFocusableIn(modal);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });

    saleForm.addEventListener("submit", handleSaleFormSubmit);
    document.getElementById("saleTypeCash").addEventListener("change", toggleInstallmentFields);
    document.getElementById("saleTypeInstallment").addEventListener("change", toggleInstallmentFields);
    document.getElementById("price").addEventListener("input", updateInstallmentPreview);
    document.getElementById("downPayment").addEventListener("input", updateInstallmentPreview);
    document.getElementById("installmentsCount").addEventListener("input", updateInstallmentPreview);
    document.getElementById("phone").addEventListener("input", checkPhoneDuplicate);
    setupEnterNavigation(saleForm);

    paymentForm.addEventListener("submit", handlePaymentFormSubmit);
    document.getElementById("btnConfirmDelete").addEventListener("click", runPendingConfirmAction);

    document.getElementById("searchInput").addEventListener("input", debounce(renderRecordsTable, 150));

    document.getElementById("recordsTableBody").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const { action, id, phone } = btn.dataset;
      if (action === "edit") openSaleModalForEdit(id);
      else if (action === "delete") openDeleteConfirm(id);
      else if (action === "payment") openPaymentModal(id);
      else if (action === "profile") openCustomerProfile(phone);
    });

    setupDueTabs();
    setupRecordFilters();
  }

  /* =====================================================================
     13) INIT
     ===================================================================== */

  document.addEventListener("DOMContentLoaded", () => {
    loadData();
    bindEvents();
    resetSaleForm();
    renderAll();
  });
})();
