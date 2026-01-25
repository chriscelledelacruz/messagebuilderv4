// ----- STATE ------

let verifiedUsers = [];
let tasks = [createEmptyTask()];
let historyItems = [];

// Excel/Merge Data State
let excelData = null;
let mergeFields = [];
let csvContent = "";

// --- DOM ELEMENTS ---
const elements = {
  // Tabs
  tabs: document.querySelectorAll(".tab"),
  tabContents: document.querySelectorAll(".tab-content"),

  // Section 1: Targeting
  storeIdsInput: document.getElementById("storeIds"),
  verifyBtn: document.getElementById("verifyBtn"),
  verifyResults: document.getElementById("verifyResults"),
  titleInput: document.getElementById("title"),
  departmentSelect: document.getElementById("department"),

  // Section 2: Excel Upload
  uploadArea: document.getElementById("uploadArea"),
  excelFile: document.getElementById("excelFile"),
  fileInfo: document.getElementById("fileInfo"),
  fileName: document.getElementById("fileName"),
  fileRows: document.getElementById("fileRows"),
  removeFile: document.getElementById("removeFile"),
  mergeTableContainer: document.getElementById("mergeTableContainer"),
  mergeTableBody: document.getElementById("mergeTableBody"),
  uploadToStaffbaseBtn: document.getElementById("uploadToStaffbaseBtn"),
  uploadStatus: document.getElementById("uploadStatus"),

  // Section 3: Tasks
  tasksContainer: document.getElementById("tasksContainer"),
  addTaskBtn: document.getElementById("addTaskBtn"),
  taskCountNum: document.getElementById("taskCountNum"),

  // Submit
  submitBtn: document.getElementById("submitBtn"),

  // History
  searchInput: document.getElementById("searchInput"),
  filterStoreId: document.getElementById("filterStoreId"),
  filterCategory: document.getElementById("filterCategory"),
  filterDateFrom: document.getElementById("filterDateFrom"),
  filterDateTo: document.getElementById("filterDateTo"),
  applyFiltersBtn: document.getElementById("applyFiltersBtn"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  historyContainer: document.getElementById("historyContainer"),

  // Preview Modal
  previewModal: document.getElementById("previewModal"),
  closeModalBtn: document.querySelector(".close-modal"),
  previewStoreId: document.getElementById("previewStoreId"),
  refreshPreviewBtn: document.getElementById("refreshPreviewBtn"),
  previewContent: document.getElementById("previewContent"),
  previewLoading: document.getElementById("previewLoading"),

  // Toast
  toast: document.getElementById("toast"),
};

// --- CATEGORY CONFIG ---
const categoryConfig = {
  operations: { class: "operations", label: "Operations" },
  marketing: { class: "marketing", label: "Marketing" },
  "food service": { class: "food-service", label: "Food Service" },
  merchandising: { class: "merchandising", label: "Merchandising" },
  safety: { class: "safety", label: "Safety" },
  "safety & compliance": { class: "safety", label: "Safety" },
  training: { class: "training", label: "Training" },
  hr: { class: "hr", label: "HR" },
  "human resources": { class: "hr", label: "HR" },
  uncategorized: { class: "uncategorized", label: "Uncategorized" },
};

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initExcelUpload();
  initVerification();
  initTasks();
  initSubmit();
  initHistory();
  initPreviewModal();
  renderTasks();
});

// ===========================================
// TAB SWITCHING
// ===========================================

function initTabs() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      elements.tabs.forEach((t) => t.classList.remove("active"));
      elements.tabContents.forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add("active");
      if (tab.dataset.tab === "history") loadHistory();
    });
  });
}

// ===========================================
// EXCEL UPLOAD & PARSING
// ===========================================

function initExcelUpload() {
  // Click to upload
  elements.uploadArea.addEventListener("click", () => elements.excelFile.click());

  // File input change
  elements.excelFile.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleExcelFile(e.target.files[0]);
    }
  });

  // Drag and drop events
  elements.uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    elements.uploadArea.classList.add("drag-over");
  });

  elements.uploadArea.addEventListener("dragleave", () => {
    elements.uploadArea.classList.remove("drag-over");
  });

  elements.uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    elements.uploadArea.classList.remove("drag-over");
    if (e.dataTransfer.files.length > 0) {
      handleExcelFile(e.dataTransfer.files[0]);
    }
  });

  // Remove file
  elements.removeFile.addEventListener("click", () => {
    clearExcelData();
  });

  // Upload to Staffbase
  elements.uploadToStaffbaseBtn.addEventListener("click", uploadToStaffbase);
}

function handleExcelFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast("Please upload an Excel file (.xlsx or .xls)", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      // Get first sheet
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length < 2) {
        showToast("Excel file must have headers and at least one row of data", "error");
        return;
      }

      excelData = {
        headers: jsonData[0],
        rows: jsonData.slice(1).filter((row) => row.length > 0),
      };

      // Process merge fields with Date Logic
      processMergeFields();

      // Update UI
      elements.fileName.textContent = file.name;
      elements.fileRows.textContent = `(${excelData.rows.length} rows)`;
      elements.uploadArea.style.display = "none";
      elements.fileInfo.style.display = "flex";
      elements.mergeTableContainer.style.display = "block";

      // Auto-populate store IDs from first column
      const storeIds = excelData.rows.map((row) => row[0]).filter(Boolean);
      elements.storeIdsInput.value = storeIds.join(", ");

      // Auto-verify users
      verifyUsers();

      showToast(`Loaded ${excelData.rows.length} rows from Excel`, "success");
    } catch (err) {
      console.error("Excel parsing error:", err);
      showToast("Failed to parse Excel file: " + err.message, "error");
    }
  };

  reader.readAsArrayBuffer(file);
}

function processMergeFields() {
  mergeFields = [];
  
  // Create Date Suffix: YYYYMMDD
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateSuffix = `_${yyyy}${mm}${dd}`;

  excelData.headers.forEach((header, index) => {
    if (!header) return;

    const originalName = String(header).trim();
    let fieldId;

    if (index === 0) {
      // First column is always storeid (primary key) - No suffix
      fieldId = "storeid";
    } else {
      // Clean name + Append Date Suffix
      const cleanName = originalName.toLowerCase().replace(/[^a-z0-9]/g, "");
      fieldId = `${cleanName}${dateSuffix}`;
    }

    // Get sample value
    let sampleValue = excelData.rows[0]?.[index];
    if (sampleValue instanceof Date) {
      sampleValue = formatDate(sampleValue);
    } else if (typeof sampleValue === "number" && isExcelDate(sampleValue)) {
      sampleValue = formatDate(excelDateToJS(sampleValue));
    } else if (sampleValue !== undefined && sampleValue !== null) {
      sampleValue = String(sampleValue);
    } else {
      sampleValue = "";
    }

    const mergeCode = `{{user.profile.${fieldId}}}`;

    mergeFields.push({
      originalName,
      fieldId,
      sampleValue,
      mergeCode,
      columnIndex: index,
      isStoreId: index === 0,
    });
  });

  renderMergeTable();
  generateCSVContent();
}

// ... Date helpers ...
function isExcelDate(value) { return typeof value === "number" && value > 25569 && value < 2958465; }
function excelDateToJS(excelDate) { return new Date((excelDate - 25569) * 86400 * 1000); }
function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return "";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function renderMergeTable() {
  elements.mergeTableBody.innerHTML = mergeFields
    .map(
      (field) => `
    <tr>
      <td>
        <span class="field-original">${escapeHtml(field.originalName)}</span>
        ${field.isStoreId ? '<span class="store-id-badge">Primary Key</span>' : `<br><span class="field-mapped">→ ${field.fieldId}</span>`}
      </td>
      <td title="${escapeHtml(field.sampleValue)}">${escapeHtml(field.sampleValue)}</td>
      <td><code class="merge-code">${escapeHtml(field.mergeCode)}</code></td>
      <td>
        <button class="btn-copy" data-code="${escapeHtml(field.mergeCode)}">
          <svg class="icon" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        </button>
      </td>
    </tr>
  `
    )
    .join("");

  // Attach copy handlers
  elements.mergeTableBody.querySelectorAll(".btn-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      copyToClipboard(btn.dataset.code);
      btn.classList.add("copied");
      btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy`;
      }, 2000);
    });
  });
}

function generateCSVContent() {
  // Generate CSV with updated field IDs (including suffix)
  const headers = mergeFields.map((f) => f.fieldId);
  const rows = excelData.rows.map((row) => {
    return mergeFields.map((field, i) => {
      let value = row[field.columnIndex];
      if (value instanceof Date) value = formatDate(value);
      else if (typeof value === "number" && isExcelDate(value)) value = formatDate(excelDateToJS(value));
      
      if (value === null || value === undefined) return "";
      const strValue = String(value);
      if (strValue.includes(",") || strValue.includes('"') || strValue.includes("\n")) {
        return '"' + strValue.replace(/"/g, '""') + '"';
      }
      return strValue;
    });
  });
  csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function clearExcelData() {
  excelData = null;
  mergeFields = [];
  csvContent = "";
  elements.excelFile.value = "";
  elements.uploadArea.style.display = "block";
  elements.fileInfo.style.display = "none";
  elements.mergeTableContainer.style.display = "none";
  elements.uploadStatus.innerHTML = "";
}

async function uploadToStaffbase() {
  if (!csvContent) { showToast("No data to upload", "error"); return; }
  setButtonLoading(elements.uploadToStaffbaseBtn, true, "Uploading...");
  
  try {
    const fieldMappings = {};
    mergeFields.forEach((field) => {
      if (!field.isStoreId) fieldMappings[field.fieldId] = field.fieldId;
    });

    const res = await fetch("/api/upload-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvContent, fieldMappings }),
    });

    const data = await res.json();
    if (data.success) {
      elements.uploadStatus.innerHTML = createAlert("success", `<strong>✓ Upload successful!</strong> Data updated.`);
      showToast("Data uploaded to Staffbase!", "success");
    } else {
      throw new Error(data.error || "Upload failed");
    }
  } catch (err) {
    elements.uploadStatus.innerHTML = createAlert("error", `Upload failed: ${err.message}`);
    showToast("Upload failed", "error");
  } finally {
    setButtonLoading(elements.uploadToStaffbaseBtn, false, "Upload Merge Data to Staffbase");
  }
}

// ===========================================
// SECTION 1: TARGETING & VERIFICATION
// ===========================================

function initVerification() {
  elements.verifyBtn.addEventListener("click", verifyUsers);
  elements.storeIdsInput.addEventListener("input", () => {
    updateSubmitButton();
  });
  elements.titleInput.addEventListener("input", updateSubmitButton);
  elements.departmentSelect.addEventListener("change", updateSubmitButton);
}

async function verifyUsers() {
  const ids = elements.storeIdsInput.value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    showVerifyResult("warning", "Please enter at least one Store ID");
    return;
  }

  setButtonLoading(elements.verifyBtn, true, "Verifying...");
  try {
    const res = await fetch("/api/verify-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeIds: ids }),
    });

    const data = await res.json();
    verifiedUsers = data.foundUsers || [];

    let html = "";
    if (verifiedUsers.length > 0) {
      html += createAlert("success", `<strong>${verifiedUsers.length} stores verified</strong>`);
    }
    if (data.notFoundIds && data.notFoundIds.length > 0) {
      html += createAlert("warning", `<strong>${data.notFoundIds.length} IDs not found:</strong> ${data.notFoundIds.join(", ")}`);
    }
    elements.verifyResults.innerHTML = html;
    updateSubmitButton();
  } catch (err) {
    showVerifyResult("error", `Error: ${err.message}`);
  } finally {
    setButtonLoading(elements.verifyBtn, false, "Verify Stores");
  }
}

function showVerifyResult(type, message) {
  elements.verifyResults.innerHTML = createAlert(type, message);
}

// ===========================================
// TASKS & SUBMIT
// ===========================================

function initTasks() {
  elements.addTaskBtn.addEventListener("click", addTask);
  elements.submitBtn.addEventListener("click", submitForm);
}

function createEmptyTask() { return { id: Date.now(), title: "", description: "", dueDate: "" }; }

function addTask() {
  if (tasks.length >= 20) return;
  tasks.push(createEmptyTask());
  renderTasks();
}

function removeTask(id) {
  if (tasks.length <= 1) return;
  tasks = tasks.filter((t) => t.id !== id);
  renderTasks();
}

function updateTask(id, field, value) {
  const task = tasks.find((t) => t.id === id);
  if (task) task[field] = value;
}

function renderTasks() {
  elements.tasksContainer.innerHTML = tasks.map((task, index) => `
    <div class="task-card" data-id="${task.id}">
      <div class="task-card-inner">
        <div class="task-number">${index + 1}</div>
        <div class="task-fields">
          <input type="text" value="${escapeHtml(task.title)}" placeholder="Task title *" data-field="title">
          <textarea placeholder="Description (optional)" data-field="description">${escapeHtml(task.description)}</textarea>
          <div class="task-date-row">
            <input type="date" value="${task.dueDate}" data-field="dueDate">
            <span class="optional">(optional)</span>
          </div>
        </div>
        <button class="btn btn-icon remove-task" ${tasks.length === 1 ? "disabled" : ""}>
          <svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
  `).join("");

  elements.taskCountNum.textContent = tasks.length;
  elements.addTaskBtn.disabled = tasks.length >= 20;

  elements.tasksContainer.querySelectorAll(".task-card").forEach((card) => {
    const id = parseInt(card.dataset.id);
    card.querySelectorAll("input, textarea").forEach((input) => {
      input.addEventListener("input", (e) => updateTask(id, e.target.dataset.field, e.target.value));
    });
    card.querySelector(".remove-task")?.addEventListener("click", () => removeTask(id));
  });
}

function updateSubmitButton() {
  const hasUsers = verifiedUsers.length > 0;
  const hasTitle = elements.titleInput.value.trim() !== "";
  const hasCat = elements.departmentSelect.value !== "";
  elements.submitBtn.disabled = !(hasUsers && hasTitle && hasCat);
}

async function submitForm() {
  const validTasks = tasks.filter((t) => t.title.trim() !== "");
  setButtonLoading(elements.submitBtn, true, "Creating...");

  try {
    const res = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verifiedUsers,
        title: elements.titleInput.value.trim(),
        department: elements.departmentSelect.value,
        tasks: validTasks,
      }),
    });

    const data = await res.json();
    if (data.success) {
      showToast("Channel created successfully!", "success");
      alert(`✅ Success!\n\nChannel created: ${data.channelId}`);
      resetForm();
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    setButtonLoading(elements.submitBtn, false, "Create Channel & Distribute Tasks");
    updateSubmitButton();
  }
}

function resetForm() {
  elements.storeIdsInput.value = "";
  elements.titleInput.value = "";
  elements.departmentSelect.value = "";
  verifiedUsers = [];
  tasks = [createEmptyTask()];
  elements.verifyResults.innerHTML = "";
  clearExcelData();
  renderTasks();
  updateSubmitButton();
}

// ===========================================
// HISTORY & PREVIEW
// ===========================================

function initHistory() {
  let searchTimeout;
  elements.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => filterAndRender(), 300);
  });
  elements.applyFiltersBtn.addEventListener("click", loadHistory);
  elements.clearFiltersBtn.addEventListener("click", clearFilters);
}

function clearFilters() {
  elements.filterStoreId.value = "";
  elements.filterCategory.value = "";
  elements.filterDateFrom.value = "";
  elements.filterDateTo.value = "";
  elements.searchInput.value = "";
  loadHistory();
}

async function loadHistory() {
  elements.historyContainer.innerHTML = `<div class="empty-state"><div class="spinner spinner-dark" style="margin: 0 auto;"></div><p>Loading...</p></div>`;

  try {
    const params = new URLSearchParams();
    if (elements.filterStoreId.value.trim()) params.set("storeId", elements.filterStoreId.value.trim());
    if (elements.filterCategory.value) params.set("category", elements.filterCategory.value);
    
    const res = await fetch(`/api/items?${params.toString()}`);
    const data = await res.json();
    historyItems = data.items || [];
    filterAndRender();
  } catch (err) {
    elements.historyContainer.innerHTML = createAlert("error", `Error loading history: ${err.message}`);
  }
}

function filterAndRender() {
  const searchTerm = elements.searchInput.value.toLowerCase().trim();
  let filtered = historyItems;
  if (searchTerm) {
    filtered = historyItems.filter(item => 
      item.title.toLowerCase().includes(searchTerm) || 
      item.department.toLowerCase().includes(searchTerm)
    );
  }
  renderHistoryList(filtered);
}

function renderHistoryList(items) {
  if (!items || items.length === 0) {
    elements.historyContainer.innerHTML = `<div class="empty-state"><p>No submissions found</p></div>`;
    return;
  }

  elements.historyContainer.innerHTML = items.map(item => {
    const categoryClass = getCategoryClass(item.department);
    return `
    <div class="history-item category-border-${categoryClass}" data-id="${item.channelId}">
      <div class="history-info">
        <h3>
          ${escapeHtml(item.title)}
          <span class="category-label category-${categoryClass}">${escapeHtml(item.department)}</span>
        </h3>
        <div class="history-meta">
          <span>${item.userCount} users</span>
          <span>${new Date(item.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="history-actions">
        <button class="btn btn-secondary btn-sm preview-trigger" data-id="${item.channelId}">
          <svg class="icon icon-small" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          Preview
        </button>
      </div>
    </div>
  `;
  }).join("");

  // Attach Preview Listeners
  elements.historyContainer.querySelectorAll(".preview-trigger").forEach(btn => {
    btn.addEventListener("click", () => {
      const item = historyItems.find(i => i.channelId === btn.dataset.id);
      openPreviewModal(item);
    });
  });
}

function getCategoryClass(department) {
  const key = department.toLowerCase();
  return categoryConfig[key]?.class || "uncategorized";
}

// --- PREVIEW MODAL LOGIC ---
let currentPreviewItem = null;

function initPreviewModal() {
  elements.closeModalBtn.addEventListener("click", closePreviewModal);
  window.addEventListener("click", (e) => {
    if (e.target === elements.previewModal) closePreviewModal();
  });

  elements.refreshPreviewBtn.addEventListener("click", async () => {
    const storeId = elements.previewStoreId.value.trim();
    if (!storeId || !currentPreviewItem) return;
    
    // Fetch user data and update view
    await renderPreviewContent(currentPreviewItem, storeId);
  });
}

function openPreviewModal(item) {
  currentPreviewItem = item;
  elements.previewModal.style.display = "block";
  elements.previewContent.innerHTML = `<div class="preview-placeholder">Enter a Store ID above to generate a preview for this communication.</div>`;
  elements.previewStoreId.value = "";
}

function closePreviewModal() {
  elements.previewModal.style.display = "none";
  currentPreviewItem = null;
}

async function renderPreviewContent(item, storeId) {
  elements.previewLoading.style.display = "block";
  elements.previewContent.style.opacity = "0.5";

  try {
    // Fetch real user data
    const res = await fetch(`/api/user/${storeId}`);
    const userData = await res.json();

    if (!userData || userData.error) throw new Error(userData.error || "User not found");

    // Replace merge tags in Title
    const processedTitle = replaceMergeTags(item.title, userData);
    
    // Tasks (we assume tasks are part of the 'item' object if fetched, 
    // but the list API might not return them. For now, we mock if missing or 
    // ideally we would fetch the tasks for that channel. 
    // NOTE: The current API doesn't return full tasks in list view. 
    // We will simulate with placeholders if tasks aren't in `item`.
    
    // Simplification: We will just display the Title and basic info for now 
    // as fetching historical tasks requires more API calls.
    
    let html = `
      <div class="preview-card">
        <h2 class="preview-title">${escapeHtml(processedTitle)}</h2>
        <div class="preview-meta">To: Store ${storeId} | Category: ${item.department}</div>
        <hr>
        <p><em>(Task content preview requires additional data fetch. Showing header info only.)</em></p>
      </div>
    `;

    elements.previewContent.innerHTML = html;

  } catch (err) {
    elements.previewContent.innerHTML = `<div class="alert alert-error">Error: ${err.message}</div>`;
  } finally {
    elements.previewLoading.style.display = "none";
    elements.previewContent.style.opacity = "1";
  }
}

function replaceMergeTags(text, user) {
  if (!text) return "";
  return text.replace(/{{user\.profile\.([a-zA-Z0-9_]+)}}/g, (match, field) => {
    // Check nested profile first
    if (user.profile && user.profile[field] !== undefined) return user.profile[field];
    // Check top level
    if (user[field] !== undefined) return user[field];
    return match; // Return original if not found
  });
}

// --- UTILS ---
function escapeHtml(str) { return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function createAlert(type, msg) { return `<div class="alert alert-${type}">${msg}</div>`; }
function setButtonLoading(btn, isLoading, text) {
  btn.disabled = isLoading;
  btn.innerHTML = isLoading ? `<div class="spinner"></div> ${text}` : text;
}
function showToast(msg, type) {
  elements.toast.textContent = msg;
  elements.toast.className = `toast show ${type}`;
  setTimeout(() => elements.toast.className = "toast", 3000);
}
function copyToClipboard(text) {
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}
