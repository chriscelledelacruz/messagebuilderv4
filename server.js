const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();

app.set("etag", false);
app.disable("view cache");

app.use(express.json({ limit: "50mb" }));

// --- ENV VARIABLES ---
const STAFFBASE_BASE_URL = process.env.STAFFBASE_BASE_URL;
const STAFFBASE_TOKEN = process.env.STAFFBASE_TOKEN;
const STAFFBASE_SPACE_ID = process.env.STAFFBASE_SPACE_ID;
const HIDDEN_ATTRIBUTE_KEY = process.env.HIDDEN_ATTRIBUTE_KEY || "storeid";
const STAFFBASE_STUDIO_URL = process.env.STAFFBASE_STUDIO_URL || STAFFBASE_BASE_URL?.replace("/api", "");
const FIXED_OPS_IDS = (process.env.FIXED_OPS_IDS || "").split(",").filter(Boolean);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- API HELPER ---
async function sb(method, apiPath, body, customHeaders = {}) {
  const url = `${STAFFBASE_BASE_URL}${apiPath}`;
  const options = {
    method,
    headers: {
      Authorization: `Basic ${STAFFBASE_TOKEN}`,
      "Content-Type": "application/json",
      ...customHeaders,
    },
  };
  if (body) options.body = JSON.stringify(body);

  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(url, options);

      if (res.status === 429) {
        console.warn(`[API 429] Rate limit hit. Waiting 2s...`);
        await delay(2000);
        retries--;
        continue;
      }

      if (!res.ok) {
        const txt = await res.text();
        console.error(`[API Error] ${method} ${apiPath}: ${res.status} - ${txt}`);
        throw new Error(`API ${res.status}: ${txt}`);
      }

      if (res.status === 204) return {};
      return res.json();
    } catch (err) {
      if (retries <= 1) throw err;
      retries--;
      await delay(1000);
    }
  }
  throw new Error("API Timeout after retries");
}

// --- CSV UPLOAD HELPER (multipart/form-data) ---
async function sbUploadCSV(csvContent, filename = "import.csv") {
  const boundary = "----StaffbaseCSVBoundary" + Date.now();
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    "Content-Type: text/csv",
    "",
    csvContent,
    `--${boundary}--`,
  ].join("\r\n");

  const res = await fetch(`${STAFFBASE_BASE_URL}/users/imports`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${STAFFBASE_TOKEN}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`CSV Upload failed: ${res.status} - ${txt}`);
  }

  // Get import ID from Location header or response
  const location = res.headers.get("location");
  const importId = location ? location.split("/").pop() : null;
  
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}

  return { importId: importId || data.id, ...data };
}

// --- LOGIC HELPERS ---

async function getOpsGroupMembers() {
  const OPS_GROUP_ID = process.env.OPS_GROUP_ID;
  if (!OPS_GROUP_ID) return [];

  try {
    const filter = encodeURIComponent(`groups eq "${OPS_GROUP_ID}"`);
    const headers = { Accept: "application/vnd.staffbase.accessors.users-search.v1+json" };
    const res = await sb("GET", `/users/search?filter=${filter}`, null, headers);
    return res.data || [];
  } catch (e) {
    console.warn("[OPS] Failed to fetch Ops members:", e.message);
    return [];
  }
}

// --- CACHED USER MAP ---
let cachedUserMap = null;
let userMapLastFetch = 0;
const USER_MAP_TTL = 1000 * 60 * 15;

async function getAllUsersMap(forceRefresh = false) {
  if (!forceRefresh && cachedUserMap && Date.now() - userMapLastFetch < USER_MAP_TTL) {
    return cachedUserMap;
  }

  console.log("[CACHE] Refreshing User Map...");
  const userMap = new Map();
  let offset = 0;
  const limit = 100;

  while (true) {
    try {
      const res = await sb("GET", `/users?limit=${limit}&offset=${offset}`);
      if (!res.data || res.data.length === 0) break;

      for (const user of res.data) {
        const storeId = user.profile?.[HIDDEN_ATTRIBUTE_KEY];
        if (storeId) {
          userMap.set(String(storeId), {
            id: user.id,
            visibleId: String(storeId),
            externalId: user.externalId,
            name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
          });
        }
      }
      if (res.data.length < limit) break;
      offset += limit;
      if (offset % 1000 === 0) await delay(200);
    } catch (e) {
      console.error("[CACHE] Error fetching users:", e.message);
      break;
    }
  }

  cachedUserMap = userMap;
  userMapLastFetch = Date.now();
  console.log(`[CACHE] User Map loaded with ${userMap.size} entries`);
  return userMap;
}

async function discoverProjectsByStoreIds(storeIds) {
  const projectMap = {};
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await sb("GET", `/spaces/${STAFFBASE_SPACE_ID}/installations?limit=${limit}&offset=${offset}`);
    if (!res.data || res.data.length === 0) break;

    res.data.forEach((inst) => {
      const title = inst.config?.localization?.en_US?.title || "";
      const match = title.match(/^Store\s*#?\s*(\w+)$/i);
      if (match && storeIds.includes(match[1])) {
        projectMap[match[1]] = inst.id;
      }
    });

    if (res.data.length < limit) break;
    offset += limit;
  }

  return projectMap;
}

// --- ROUTES ---

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/config", (req, res) => {
  res.json({ studioUrl: STAFFBASE_STUDIO_URL });
});

// VERIFY USERS
app.post("/api/verify-users", async (req, res) => {
  try {
    const { storeIds } = req.body;
    if (!storeIds || !Array.isArray(storeIds)) {
      return res.status(400).json({ error: "Invalid storeIds - expected array" });
    }

    const userMap = await getAllUsersMap();
    const foundUsers = [];
    const notFoundIds = [];

    for (const id of storeIds) {
      const user = userMap.get(String(id));
      if (user) foundUsers.push(user);
      else notFoundIds.push(id);
    }

    console.log(`[VERIFY] Found ${foundUsers.length}/${storeIds.length} users`);
    res.json({ foundUsers, notFoundIds });
  } catch (err) {
    console.error("[VERIFY] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// UPLOAD USERS TO STAFFBASE (CSV Import)
app.post("/api/upload-users", async (req, res) => {
  try {
    const { csvContent, fieldMappings } = req.body;

    if (!csvContent) {
      return res.status(400).json({ error: "No CSV content provided" });
    }

    console.log("[CSV IMPORT] Starting upload...");
    console.log("[CSV IMPORT] Field mappings:", fieldMappings);

    // Step 1: Upload CSV file
    const uploadResult = await sbUploadCSV(csvContent, "merge_data_import.csv");
    const importId = uploadResult.importId;

    if (!importId) {
      throw new Error("Failed to get import ID from upload response");
    }

    console.log(`[CSV IMPORT] File uploaded, import ID: ${importId}`);

    // Step 2: Configure mapping (Delta import)
    // First column (storeid) maps to externalId for user identification
    const mappingConfig = {
      delta: true, // Only update users in this file
      mapping: {
        identifier: "storeid", // Use storeid column to identify users
        ...fieldMappings, // Additional field mappings
      },
    };

    console.log("[CSV IMPORT] Configuring mapping...");
    // FIX: Changed from PUT to PATCH based on API 405 response
    await sb("PATCH", `/users/imports/${importId}/config`, mappingConfig);

    // Step 3: Optional - Preview first
    console.log("[CSV IMPORT] Generating preview...");
    await sb("PATCH", `/users/imports/${importId}`, { state: "PREVIEW_PENDING" });

    // Wait for preview to complete
    let previewComplete = false;
    let attempts = 0;
    while (!previewComplete && attempts < 30) {
      await delay(1000);
      const status = await sb("GET", `/users/imports/${importId}`);
      if (status.state === "PREVIEW_COMPLETE" || status.state === "DRAFT") {
        previewComplete = true;
      } else if (status.state === "PREVIEW_FAILED") {
        throw new Error("Preview failed: " + JSON.stringify(status.errors || {}));
      }
      attempts++;
    }

    // Step 4: Execute import
    console.log("[CSV IMPORT] Executing import...");
    await sb("PATCH", `/users/imports/${importId}`, { state: "IMPORT_PENDING" });

    // Wait for import to complete
    let importComplete = false;
    attempts = 0;
    while (!importComplete && attempts < 60) {
      await delay(2000);
      const status = await sb("GET", `/users/imports/${importId}`);
      if (status.state === "IMPORT_COMPLETE") {
        importComplete = true;
        console.log("[CSV IMPORT] Import completed successfully");
        res.json({
          success: true,
          importId,
          message: "User data imported successfully",
          stats: status.stats || {},
        });
        return;
      } else if (status.state === "IMPORT_FAILED") {
        throw new Error("Import failed: " + JSON.stringify(status.errors || {}));
      }
      attempts++;
    }

    if (!importComplete) {
      res.json({
        success: true,
        importId,
        message: "Import started - check Staffbase Studio for status",
        warning: "Import is still processing",
      });
    }
  } catch (err) {
    console.error("[CSV IMPORT] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE POST & TASKS
app.post("/api/create", async (req, res) => {
  try {
    let { verifiedUsers, title, department, tasks } = req.body;

    if (!title || title.trim() === "") {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!department || department === "undefined" || department.trim() === "") {
      department = "Uncategorized";
    }

    if (typeof verifiedUsers === "string") {
      try { verifiedUsers = JSON.parse(verifiedUsers); } catch (e) {}
    }

    if (typeof tasks === "string") {
      try { tasks = JSON.parse(tasks); } catch (e) { tasks = []; }
    }

    if (!Array.isArray(tasks)) tasks = [];
    tasks = tasks.slice(0, 20).filter((t) => t.title && t.title.trim() !== "");

    if (!verifiedUsers || verifiedUsers.length === 0) {
      let { storeIds } = req.body;
      if (typeof storeIds === "string") {
        try { storeIds = JSON.parse(storeIds); } catch (e) {}
      }

      if (storeIds && storeIds.length > 0) {
        const userMap = await getAllUsersMap();
        verifiedUsers = [];
        for (const id of storeIds) {
          const u = userMap.get(String(id));
          if (u) verifiedUsers.push(u);
        }
      }
    }

    if (!verifiedUsers || verifiedUsers.length === 0) {
      return res.status(400).json({ error: "No verified users provided." });
    }

    const storeUserIds = verifiedUsers.map((u) => u.id);
    const storeIds = verifiedUsers.map((u) => u.visibleId || u.csvId);

    const opsUsers = await getOpsGroupMembers();
    const opsUserIds = opsUsers.map((u) => u.id);
    const allAccessorIDs = [...new Set([...storeUserIds, ...opsUserIds, ...FIXED_OPS_IDS])];

    const now = Date.now();

    // Find earliest due date
    let earliestDueDate = null;
    tasks.forEach((t) => {
      if (t.dueDate) {
        const d = new Date(t.dueDate);
        if (!earliestDueDate || d < earliestDueDate) earliestDueDate = d;
      }
    });

    // Generate Task Table HTML for news content
    let taskTableHTML = "";
    if (tasks.length > 0) {
      taskTableHTML = `
<h3>📋 Action Items</h3>
<table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
  <thead>
    <tr style="background:#f3f4f6;">
      <th style="border:1px solid #e5e7eb; padding:12px; text-align:left; font-weight:600;">#</th>
      <th style="border:1px solid #e5e7eb; padding:12px; text-align:left; font-weight:600;">Task</th>
      <th style="border:1px solid #e5e7eb; padding:12px; text-align:left; font-weight:600;">Description</th>
      <th style="border:1px solid #e5e7eb; padding:12px; text-align:left; font-weight:600;">Due Date</th>
    </tr>
  </thead>
  <tbody>`;
      
      tasks.forEach((t, index) => {
        const dueDisplay = t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        }) : '—';
        const descDisplay = t.description || '—';
        
        taskTableHTML += `
    <tr>
      <td style="border:1px solid #e5e7eb; padding:12px; text-align:center; font-weight:600; color:#FF6900;">${index + 1}</td>
      <td style="border:1px solid #e5e7eb; padding:12px; font-weight:500;">${t.title}</td>
      <td style="border:1px solid #e5e7eb; padding:12px; color:#6b7280;">${descDisplay}</td>
      <td style="border:1px solid #e5e7eb; padding:12px; white-space:nowrap;">${dueDisplay}</td>
    </tr>`;
      });
      
      taskTableHTML += `
  </tbody>
</table>`;
    }

    const channelName = `${department} - ${new Date().toLocaleDateString()}`;

    // Create Channel
    const channelRes = await sb("POST", `/spaces/${STAFFBASE_SPACE_ID}/installations`, {
      pluginID: "news",
      externalID: now.toString(),
      config: {
        localization: {
          en_US: { title: channelName },
          de_DE: { title: channelName },
        },
      },
      accessorIDs: allAccessorIDs,
    });

    const channelId = channelRes.id;
    console.log(`[CREATE] Channel created: ${channelId}`);

    // Create Post with task table in content
    const contentHTML = `<h2>${title}</h2><hr>${taskTableHTML}`;
    const dueDateStr = earliestDueDate ? earliestDueDate.toISOString() : "";
    const contentTeaser = `Category: ${department}; Stores: ${storeUserIds.length}; DueDate: ${dueDateStr}`;

    const postRes = await sb("POST", `/channels/${channelId}/posts`, {
      contents: {
        en_US: {
          title: title,
          content: contentHTML,
          teaser: contentTeaser,
          kicker: department,
        },
      },
    });

    console.log(`[CREATE] Post created: ${postRes.id}`);

    // Distribute Tasks to Project Installations
    let taskCount = 0;
    let taskListsCreated = 0;
    let taskErrors = [];

    if (tasks.length > 0) {
      console.log(`[TASKS] Discovering projects for ${storeIds.length} stores...`);
      const projectMap = await discoverProjectsByStoreIds(storeIds);
      const installationIds = Object.values(projectMap);

      console.log(`[TASKS] Found ${installationIds.length} project installations`);

      if (installationIds.length > 0) {
        // Process in chunks to avoid rate limits
        const chunks = [];
        for (let i = 0; i < installationIds.length; i += 5) {
          chunks.push(installationIds.slice(i, i + 5));
        }

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (instId) => {
              try {
                // Create Task List with the Comms Title as the list name
                const listRes = await sb("POST", `/tasks/${instId}/lists`, { 
                  name: title 
                });
                console.log(`[TASKS] Created task list "${title}" (${listRes.id}) in installation ${instId}`);
                taskListsCreated++;

                // Create individual tasks in the list
                for (const t of tasks) {
                  try {
                    const taskPayload = {
                      title: t.title,
                      description: t.description || "",
                      status: "OPEN",
                      taskListId: listRes.id,
                      assigneeIds: [],
                      groupIds: [],
                      priority: "Priority_3",
                      attachmentIds: []
                    };

                    // Add dueDate if provided (format: ISO 8601)
                    if (t.dueDate) {
                      // Set due date to end of day
                      const dueDateTime = new Date(t.dueDate);
                      dueDateTime.setHours(23, 59, 59, 0);
                      taskPayload.dueDate = dueDateTime.toISOString();
                    }

                    await sb("POST", `/tasks/${instId}/tasks`, taskPayload);
                    taskCount++;
                    console.log(`[TASKS] Created task "${t.title}" in list ${listRes.id}`);
                  } catch (taskErr) {
                    console.error(`[TASKS] Failed to create task "${t.title}":`, taskErr.message);
                    taskErrors.push({ task: t.title, installation: instId, error: taskErr.message });
                  }
                }
              } catch (e) {
                console.error(`[TASKS] Failed to create task list in ${instId}:`, e.message);
                taskErrors.push({ installation: instId, error: e.message });
              }
            })
          );
          await delay(200);
        }
      } else {
        console.warn("[TASKS] No matching project installations found for store IDs");
      }
    }

    res.json({
      success: true,
      channelId,
      postId: postRes.id,
      taskListsCreated,
      taskCount,
      taskErrors: taskErrors.length > 0 ? taskErrors : undefined,
    });
  } catch (err) {
    console.error("[CREATE] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET PAST SUBMISSIONS
app.get("/api/items", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  try {
    const { storeId, category, dueDateFrom, dueDateTo, search } = req.query;
    let targetUserId = null;

    if (storeId) {
      const userMap = await getAllUsersMap();
      const user = userMap.get(String(storeId));
      if (user) targetUserId = user.id;
      else return res.json({ items: [] });
    }

    const items = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const result = await sb("GET", `/spaces/${STAFFBASE_SPACE_ID}/installations?limit=${limit}&offset=${offset}`);
      if (!result.data || result.data.length === 0) break;

      for (const inst of result.data) {
        if (inst.pluginID !== "news") continue;
        if (targetUserId && (!inst.accessorIDs || !inst.accessorIDs.includes(targetUserId))) continue;

        const channelTitle = inst.config?.localization?.en_US?.title || "Untitled";
        const defaultUserCount = inst.accessorIDs ? inst.accessorIDs.length : 0;
        const dateStr = inst.createdAt || inst.created || new Date().toISOString();

        let item = {
          channelId: inst.id,
          postId: null,
          title: channelTitle,
          department: "Uncategorized",
          userCount: defaultUserCount,
          createdAt: dateStr,
          dueDate: null,
          status: "Draft",
          studioUrl: null,
        };

        try {
          const posts = await sb("GET", `/channels/${item.channelId}/posts?limit=1`);
          if (posts.data && posts.data.length > 0) {
            const p = posts.data[0];
            item.postId = p.id;
            item.title = p.contents?.en_US?.title || item.title;

            const kickerText = p.contents?.en_US?.kicker || "";
            if (kickerText) item.department = kickerText.trim();

            const teaserText = p.contents?.en_US?.teaser || "";
            const dueDateMatch = teaserText.match(/DueDate:\s*([^;]*)/i);
            if (dueDateMatch && dueDateMatch[1].trim()) item.dueDate = dueDateMatch[1].trim();

            if (p.published) item.status = "Published";
            else if (p.planned) item.status = "Scheduled";

            if (STAFFBASE_STUDIO_URL && item.postId) {
              item.studioUrl = `${STAFFBASE_STUDIO_URL}/studio/channels/${item.channelId}/posts/${item.postId}/edit`;
            }
          }
        } catch (e) {}

        if (category && item.department.toLowerCase() !== category.toLowerCase()) continue;
        if (dueDateFrom || dueDateTo) {
          if (!item.dueDate) continue;
          const itemDue = new Date(item.dueDate);
          if (dueDateFrom && itemDue < new Date(dueDateFrom)) continue;
          if (dueDateTo && itemDue > new Date(dueDateTo)) continue;
        }
        if (search) {
          const searchLower = search.toLowerCase();
          if (!item.title.toLowerCase().includes(searchLower) && !item.department.toLowerCase().includes(searchLower)) continue;
        }

        items.push(item);
      }

      if (result.data.length < limit) break;
      offset += limit;
    }

    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ items });
  } catch (err) {
    console.error("[LIST] Error:", err);
    res.json({ items: [] });
  }
});

// DELETE
app.delete("/api/delete/:id", async (req, res) => {
  try {
    await sb("DELETE", `/installations/${req.params.id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
