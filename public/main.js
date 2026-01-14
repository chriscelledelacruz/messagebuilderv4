/* ===========================================
   7-ELEVEN MESSAGE BUILDER - MAIN JS
   =========================================== */

// --- STATE ---
let verifiedUsers = [];
let tasks = [createEmptyTask()];
let historyItems = [];
let currentView = "list";
let currentMonth = new Date();

// Excel/Merge Data State
let excelData = null;
let mergeFields = [];
let csvContent = "";

// --- DOM ELEMENTS ---
const elements = {
  // Tabs
  tabs: document.querySelectorAll(".tab"),
  tabContents: document.querySelectorAll(".tab-content"),

  // Excel Upload
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

  // Step 1: Store IDs
  storeIdsInput: document.getElementById("storeIds"),
  verifyBtn: document.getElementById("verifyBtn"),
  verifyResults: document.getElementById("verifyResults"),

  // Step 2: Message Details
  titleInput: document.getElementById("title"),
  departmentSelect: document.getElementById("department"),
  contentTextarea: document.getElementById("content"),

  // Step 3: Tasks
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
  viewBtns: document.querySelectorAll(".view-btn"),
  listViewContainer: document.getElementById("listViewContainer"),
  calendarViewContainer: document.getElementById("calendarViewContainer"),
  historyContainer: document.getElementById("historyContainer"),

  // Calendar
  calendarMonthYear: document.getElementById("calendarMonthYear"),
  calendarDays: document.getElementById("calendarDays"),
  prevMonthBtn: document.getElementById("prevMonthBtn"),
  nextMonthBtn: document.getElementById("nextMonthBtn"),

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

  // Drag and drop
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

      // Process merge fields
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

  excelData.headers.forEach((header, index) => {
    if (!header) return;

    const originalName = String(header).trim();

    // Clean field ID: lowercase, remove spaces and special characters
    let fieldId;
    if (index === 0) {
      // First column is always storeid
      fieldId = "storeid";
    } else {
      fieldId = originalName.toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    // Get sample value from first row
    let sampleValue = excelData.rows[0]?.[index];

    // Format dates
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

function isExcelDate(value) {
  // Excel dates are numbers > 25569 (Jan 1, 1970) and < 2958465 (Dec 31, 9999)
  return typeof value === "number" && value > 25569 && value < 2958465;
}

function excelDateToJS(excelDate) {
  // Excel epoch is Dec 30, 1899
  return new Date((excelDate - 25569) * 86400 * 1000);
}

function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return "";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatCurrency(value) {
  if (typeof value !== "number") return value;
  return "$" + value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function renderMergeTable() {
  elements.mergeTableBody.innerHTML = mergeFields
    .map(
      (field) => `
    <tr>
      <td>
        ${escapeHtml(field.originalName)}
        ${field.isStoreId ? '<span class="store-id-badge">Primary Key</span>' : ""}
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
      const code = btn.dataset.code;
      copyToClipboard(code);
      btn.classList.add("copied");
      btn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Copied!
      `;
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.innerHTML = `
          <svg class="icon" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          Copy
        `;
      }, 2000);
    });
  });
}

function generateCSVContent() {
  // Generate CSV with cleaned headers
  const headers = mergeFields.map((f) => f.fieldId);
  const rows = excelData.rows.map((row) => {
    return mergeFields.map((field, i) => {
      let value = row[field.columnIndex];

      // Format dates
      if (value instanceof Date) {
        value = formatDate(value);
      } else if (typeof value === "number" && isExcelDate(value)) {
        value = formatDate(excelDateToJS(value));
      }

      // Escape CSV values
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
  if (!csvContent) {
    showToast("No data to upload", "error");
    return;
  }

  setButtonLoading(elements.uploadToStaffbaseBtn, true, "Uploading...");
  elements.uploadStatus.innerHTML = createAlert("info", "Uploading user data to Staffbase...");

  try {
    // Build field mappings for the API
    const fieldMappings = {};
    mergeFields.forEach((field) => {
      if (!field.isStoreId) {
        fieldMappings[field.fieldId] = field.fieldId;
      }
    });

    const res = await fetch("/api/upload-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        csvContent,
        fieldMappings,
      }),
    });

    const data = await res.json();

    if (data.success) {
      elements.uploadStatus.innerHTML = createAlert(
        "success",
        `<strong>✓ Upload successful!</strong> User profiles have been updated. ${data.warning || ""}`
      );
      showToast("User data uploaded to Staffbase!", "success");
    } else {
      throw new Error(data.error || "Upload failed");
    }
  } catch (err) {
    console.error("Upload error:", err);
    elements.uploadStatus.innerHTML = createAlert("error", `<strong>Upload failed:</strong> ${err.message}`);
    showToast("Upload failed: " + err.message, "error");
  } finally {
    setButtonLoading(elements.uploadToStaffbaseBtn, false, "Upload to Staffbase User API", getUploadIcon());
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
  showToast("Copied to clipboard!", "success");
}

// ===========================================
// USER VERIFICATION
// ===========================================

function initVerification() {
  elements.verifyBtn.addEventListener("click", verifyUsers);
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
      html += createAlert("success", `<strong>${verifiedUsers.length} stores verified successfully</strong>`);
    }
    if (data.notFoundIds && data.notFoundIds.length > 0) {
      html += createAlert(
        "warning",
        `<strong>${data.notFoundIds.length} IDs not found:</strong> ${data.notFoundIds.join(", ")}`
      );
    }

    elements.verifyResults.innerHTML = html;
    updateSubmitButton();
  } catch (err) {
    showVerifyResult("error", `Error: ${err.message}`);
  } finally {
    setButtonLoading(elements.verifyBtn, false, "Verify Users", getUsersIcon());
  }
}

function showVerifyResult(type, message) {
  elements.verifyResults.innerHTML = createAlert(type, message);
}

// ===========================================
// TASK MANAGEMENT
// ===========================================

function initTasks() {
  elements.addTaskBtn.addEventListener("click", addTask);
}

function createEmptyTask() {
  return { id: Date.now(), title: "", description: "", dueDate: "" };
}

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
  elements.tasksContainer.innerHTML = tasks
    .map(
      (task, index) => `
    <div class="task-card" data-id="${task.id}">
      <div class="task-card-inner">
        <div class="task-number">${index + 1}</div>
        <div class="task-fields">
          <input type="text" value="${escapeHtml(task.title)}" placeholder="Task title *" data-field="title">
          <textarea placeholder="Description (optional)" data-field="description">${escapeHtml(task.description)}</textarea>
          <div class="task-date-row">
            <svg class="icon" style="color: #9ca3af;" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <input type="date" value="${task.dueDate}" data-field="dueDate">
            <span class="optional">(optional)</span>
          </div>
        </div>
        <button class="btn btn-icon remove-task" ${tasks.length === 1 ? "disabled" : ""}>
          <svg class="icon" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `
    )
    .join("");

  elements.taskCountNum.textContent = tasks.length;
  elements.addTaskBtn.disabled = tasks.length >= 20;

  elements.tasksContainer.querySelectorAll(".task-card").forEach((card) => {
    const id = parseInt(card.dataset.id);

    card.querySelectorAll("input, textarea").forEach((input) => {
      input.addEventListener("input", (e) => {
        updateTask(id, e.target.dataset.field, e.target.value);
      });
    });

    const removeBtn = card.querySelector(".remove-task");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => removeTask(id));
    }
  });
}

// ===========================================
// FORM SUBMISSION
// ===========================================

function initSubmit() {
  elements.titleInput.addEventListener("input", updateSubmitButton);
  elements.submitBtn.addEventListener("click", submitForm);
}

function updateSubmitButton() {
  const hasUsers = verifiedUsers.length > 0;
  const hasTitle = elements.titleInput.value.trim() !== "";
  elements.submitBtn.disabled = !(hasUsers && hasTitle);
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
        department: elements.departmentSelect.value || "Uncategorized",
        tasks: validTasks,
      }),
    });

    const data = await res.json();

    if (data.success) {
      showToast("Channel created successfully!", "success");
      alert(
        `✅ Success!\n\nChannel created: ${data.channelId}\nPost ID: ${data.postId}\nTasks distributed: ${data.taskCount}`
      );
      resetForm();
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    setButtonLoading(elements.submitBtn, false, "Create Channel & Distribute Tasks", getSendIcon());
    updateSubmitButton();
  }
}

function resetForm() {
  elements.storeIdsInput.value = "";
  elements.titleInput.value = "";
  elements.departmentSelect.value = "";
  if (elements.contentTextarea) elements.contentTextarea.value = "";
  verifiedUsers = [];
  tasks = [createEmptyTask()];
  elements.verifyResults.innerHTML = "";
  clearExcelData();
  renderTasks();
  updateSubmitButton();
}

// ===========================================
// HISTORY TAB
// ===========================================

function initHistory() {
  let searchTimeout;
  elements.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => filterAndRender(), 300);
  });

  elements.applyFiltersBtn.addEventListener("click", () => loadHistory());
  elements.clearFiltersBtn.addEventListener("click", clearFilters);

  elements.viewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.viewBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view;

      elements.listViewContainer.classList.toggle("active", currentView === "list");
      elements.calendarViewContainer.classList.toggle("active", currentView === "calendar");

      if (currentView === "calendar") renderCalendar();
    });
  });

  elements.prevMonthBtn.addEventListener("click", () => {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    renderCalendar();
  });

  elements.nextMonthBtn.addEventListener("click", () => {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    renderCalendar();
  });
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
  elements.historyContainer.innerHTML = `
    <div class="empty-state">
      <div class="spinner spinner-dark" style="margin: 0 auto;"></div>
      <p>Loading...</p>
    </div>
  `;

  try {
    const params = new URLSearchParams();
    if (elements.filterStoreId.value.trim()) params.set("storeId", elements.filterStoreId.value.trim());
    if (elements.filterCategory.value) params.set("category", elements.filterCategory.value);
    if (elements.filterDateFrom.value) params.set("dueDateFrom", elements.filterDateFrom.value);
    if (elements.filterDateTo.value) params.set("dueDateTo", elements.filterDateTo.value);

    const url = `/api/items${params.toString() ? "?" + params.toString() : ""}`;
    const res = await fetch(url);
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
    filtered = historyItems.filter(
      (item) =>
        item.title.toLowerCase().includes(searchTerm) || item.department.toLowerCase().includes(searchTerm)
    );
  }

  renderHistoryList(filtered);
  if (currentView === "calendar") renderCalendar(filtered);
}

function renderHistoryList(items) {
  if (!items || items.length === 0) {
    elements.historyContainer.innerHTML = `
      <div class="empty-state">
        <svg class="icon-large" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <p>No submissions found</p>
        <p style="font-size: 13px;">Try adjusting your filters or create a new announcement</p>
      </div>
    `;
    return;
  }

  elements.historyContainer.innerHTML = items.map((item) => createHistoryItem(item)).join("");

  elements.historyContainer.querySelectorAll(".delete-item").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = btn.dataset.id;
      if (confirm("Are you sure you want to delete this channel?")) {
        try {
          await fetch(`/api/delete/${id}`, { method: "DELETE" });
          loadHistory();
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      }
    });
  });
}

function createHistoryItem(item) {
  const statusClass =
    item.status === "Published"
      ? "status-published"
      : item.status === "Scheduled"
      ? "status-scheduled"
      : "status-draft";

  const date = new Date(item.createdAt).toLocaleDateString();
  const dueDate = item.dueDate ? new Date(item.dueDate).toLocaleDateString() : null;
  const categoryClass = getCategoryClass(item.department);

  const editLink = item.studioUrl
    ? `<a href="${item.studioUrl}" target="_blank" class="edit-link" onclick="event.stopPropagation();">
        <svg class="icon icon-small" viewBox="0 0 24 24">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        Edit in Studio
       </a>`
    : "";

  return `
    <div class="history-item" data-id="${item.channelId}">
      <div class="history-info">
        <h3>
          ${item.studioUrl ? `<a href="${item.studioUrl}" target="_blank">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)}
          <span class="category-label category-${categoryClass}">${escapeHtml(item.department)}</span>
        </h3>
        <div class="history-meta">
          <span>
            <svg class="icon icon-small" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
            </svg>
            ${item.userCount} users
          </span>
          <span>
            <svg class="icon icon-small" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            Created: ${date}
          </span>
          ${dueDate ? `
          <span>
            <svg class="icon icon-small" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            Due: ${dueDate}
          </span>
          ` : ""}
        </div>
      </div>
      <div class="history-actions">
        ${editLink}
        <span class="status-badge ${statusClass}">${item.status}</span>
        <button class="btn-delete delete-item" data-id="${item.channelId}">
          <svg class="icon" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function getCategoryClass(department) {
  const key = department.toLowerCase();
  return categoryConfig[key]?.class || "uncategorized";
}

// ===========================================
// CALENDAR VIEW
// ===========================================

function renderCalendar(items = historyItems) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  elements.calendarMonthYear.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  const itemsByDate = {};
  items.forEach((item) => {
    const dateStr = item.dueDate || item.createdAt;
    if (dateStr) {
      const d = new Date(dateStr);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!itemsByDate[day]) itemsByDate[day] = [];
        if (!itemsByDate[day].find((i) => i.channelId === item.channelId)) {
          itemsByDate[day].push(item);
        }
      }
    }
  });

  let html = "";
  let dayCount = 1;
  let nextMonthDay = 1;
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    let dayNum;
    let isOtherMonth = false;
    let isToday = false;

    if (i < firstDay) {
      dayNum = daysInPrevMonth - firstDay + i + 1;
      isOtherMonth = true;
    } else if (dayCount <= daysInMonth) {
      dayNum = dayCount;
      isToday = isCurrentMonth && dayNum === today.getDate();
      dayCount++;
    } else {
      dayNum = nextMonthDay;
      isOtherMonth = true;
      nextMonthDay++;
    }

    const dayClass = `calendar-day${isOtherMonth ? " other-month" : ""}${isToday ? " today" : ""}`;
    const dayEvents = isOtherMonth ? [] : itemsByDate[dayNum] || [];

    html += `
      <div class="${dayClass}">
        <span class="day-number">${dayNum}</span>
        <div class="calendar-events">
          ${renderCalendarEvents(dayEvents)}
        </div>
      </div>
    `;
  }

  elements.calendarDays.innerHTML = html;

  elements.calendarDays.querySelectorAll(".calendar-event").forEach((el) => {
    el.addEventListener("click", () => {
      const url = el.dataset.url;
      if (url) window.open(url, "_blank");
    });
  });
}

function renderCalendarEvents(events) {
  if (events.length === 0) return "";

  const maxVisible = 2;
  const visible = events.slice(0, maxVisible);
  const remaining = events.length - maxVisible;

  let html = visible
    .map((item) => {
      const catClass = getCategoryClass(item.department);
      const url = item.studioUrl || "";
      return `<div class="calendar-event ${catClass}" data-url="${url}" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>`;
    })
    .join("");

  if (remaining > 0) {
    html += `<div class="more-events">+${remaining} more</div>`;
  }

  return html;
}

// ===========================================
// UTILITY FUNCTIONS
// ===========================================

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createAlert(type, message) {
  const icons = {
    success: `<svg class="icon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    warning: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    error: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    info: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
  };

  return `<div class="alert alert-${type}">${icons[type] || ""}${message}</div>`;
}

function setButtonLoading(btn, isLoading, text, icon = "") {
  if (isLoading) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div> ${text}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = `${icon} ${text}`;
  }
}

function showToast(message, type = "") {
  elements.toast.textContent = message;
  elements.toast.className = "toast show " + type;
  setTimeout(() => {
    elements.toast.className = "toast";
  }, 3000);
}

function getUsersIcon() {
  return `<svg class="icon" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
}

function getSendIcon() {
  return `<svg class="icon" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
}

function getUploadIcon() {
  return `<svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;
}
