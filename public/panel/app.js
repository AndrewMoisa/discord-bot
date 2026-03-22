const state = {
  guilds: [],
  selectedGuildId: null,
  token: localStorage.getItem("panelToken") || "",
};

const elements = {
  tokenInput: document.querySelector("#tokenInput"),
  saveTokenBtn: document.querySelector("#saveTokenBtn"),
  refreshGuildsBtn: document.querySelector("#refreshGuildsBtn"),
  guildList: document.querySelector("#guildList"),
  detailTitle: document.querySelector("#detailTitle"),
  statusBadge: document.querySelector("#statusBadge"),
  metaGrid: document.querySelector("#metaGrid"),
  configForm: document.querySelector("#configForm"),
  provisionBtn: document.querySelector("#provisionBtn"),
  auditList: document.querySelector("#auditList"),
  guildItemTemplate: document.querySelector("#guildItemTemplate"),
};

function setStatus(text, tone = "idle") {
  elements.statusBadge.textContent = text;
  elements.statusBadge.style.borderColor = tone === "error" ? "#d44b1f" : tone === "ok" ? "#0c7c59" : "#d9d6cb";
  elements.statusBadge.style.color = tone === "error" ? "#d44b1f" : tone === "ok" ? "#0c7c59" : "#1a1a1a";
}

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Panel-Token": state.token,
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders(),
    },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || "Request failed");
  }

  return body;
}

function renderGuilds() {
  elements.guildList.innerHTML = "";

  for (const guild of state.guilds) {
    const node = elements.guildItemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".guild-name").textContent = guild.guildName;
    node.querySelector(".guild-sub").textContent = guild.guildId;
    node.querySelector(".guild-pill").textContent = guild.isProvisioned ? "Provisioned" : "Pending";

    if (state.selectedGuildId === guild.guildId) {
      node.classList.add("active");
    }

    node.addEventListener("click", () => {
      state.selectedGuildId = guild.guildId;
      renderGuilds();
      void loadGuildDetails(guild.guildId);
    });

    elements.guildList.appendChild(node);
  }
}

function fillConfigForm(config) {
  const form = elements.configForm;
  form.employeeRoleId.value = config?.employeeRoleId || "";
  form.cvChannelId.value = config?.cvChannelId || "";
  form.cvApprovedChannelId.value = config?.cvApprovedChannelId || "";
  form.timesheetChannelId.value = config?.timesheetChannelId || "";
  form.timesheetArchiveChannelId.value = config?.timesheetArchiveChannelId || "";
  form.timesheetSummaryChannelId.value = config?.timesheetSummaryChannelId || "";
  form.logChannelId.value = config?.logChannelId || "";
  form.timezone.value = config?.timezone || "Europe/Bucharest";
  form.managerRoleIdsRaw.value = (config?.managerRoleIds || []).join(",");
}

function renderMeta(details) {
  const tenant = details.tenant;
  const guild = details.guild;

  elements.detailTitle.textContent = `${guild.name} (${guild.id})`;

  const entries = [
    ["Bot in guild", guild.botInGuild ? "Yes" : "No"],
    ["Provisioned", tenant?.isProvisioned ? "Yes" : "No"],
    ["Schema", tenant?.schemaName || "-"],
    ["Schema version", tenant?.schemaVersion ?? "-"],
    ["Timezone", tenant?.config?.timezone || "-"],
    ["Last error", tenant?.lastError || "None"],
  ];

  elements.metaGrid.innerHTML = entries
    .map(([label, value]) => `<div class="meta-item"><p>${label}</p><strong>${value}</strong></div>`)
    .join("");

  const logs = tenant?.auditLogs || [];
  elements.auditList.innerHTML = logs.length
    ? logs
      .map((row) => `<div class="audit-row"><strong>${row.action} • ${row.status}</strong><p>${new Date(row.createdAt).toLocaleString()}</p><p>${row.details || ""}</p></div>`)
      .join("")
    : "<div class=\"audit-row\">No setup activity yet.</div>";
}

async function loadGuilds() {
  setStatus("Loading guilds...");
  const data = await api("/api/guilds");
  state.guilds = data.guilds || [];

  if (!state.selectedGuildId && state.guilds.length > 0) {
    state.selectedGuildId = state.guilds[0].guildId;
  }

  renderGuilds();

  if (state.selectedGuildId) {
    await loadGuildDetails(state.selectedGuildId);
  } else {
    setStatus("No guilds found", "error");
  }
}

async function loadGuildDetails(guildId) {
  setStatus("Loading details...");
  const details = await api(`/api/guilds/${encodeURIComponent(guildId)}`);
  renderMeta(details);
  fillConfigForm(details.tenant?.config);
  setStatus(details.tenant?.isProvisioned ? "Provisioned" : "Ready to setup", details.tenant?.isProvisioned ? "ok" : "idle");
}

function formPayload() {
  const form = elements.configForm;
  return {
    employeeRoleId: form.employeeRoleId.value.trim(),
    cvChannelId: form.cvChannelId.value.trim(),
    cvApprovedChannelId: form.cvApprovedChannelId.value.trim(),
    timesheetChannelId: form.timesheetChannelId.value.trim(),
    timesheetArchiveChannelId: form.timesheetArchiveChannelId.value.trim(),
    timesheetSummaryChannelId: form.timesheetSummaryChannelId.value.trim(),
    logChannelId: form.logChannelId.value.trim(),
    timezone: form.timezone.value.trim(),
    managerRoleIds: form.managerRoleIdsRaw.value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

async function saveConfig() {
  if (!state.selectedGuildId) {
    return;
  }

  setStatus("Saving config...");
  await api(`/api/guilds/${encodeURIComponent(state.selectedGuildId)}/config`, {
    method: "PUT",
    body: JSON.stringify({ config: formPayload() }),
  });
  await loadGuildDetails(state.selectedGuildId);
  setStatus("Config saved", "ok");
}

async function provisionGuild() {
  if (!state.selectedGuildId) {
    return;
  }

  setStatus("Provisioning tenant...");
  await api(`/api/guilds/${encodeURIComponent(state.selectedGuildId)}/provision`, {
    method: "POST",
    body: JSON.stringify({ config: formPayload(), actorUserId: "panel-owner" }),
  });
  await loadGuildDetails(state.selectedGuildId);
  await loadGuilds();
  setStatus("Provision complete", "ok");
}

function bindEvents() {
  elements.tokenInput.value = state.token;

  elements.saveTokenBtn.addEventListener("click", async () => {
    state.token = elements.tokenInput.value.trim();
    localStorage.setItem("panelToken", state.token);
    try {
      await loadGuilds();
      setStatus("Token accepted", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.refreshGuildsBtn.addEventListener("click", async () => {
    try {
      await loadGuilds();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveConfig();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  elements.provisionBtn.addEventListener("click", async () => {
    try {
      await provisionGuild();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
}

bindEvents();

if (state.token) {
  void loadGuilds().catch((error) => setStatus(error.message, "error"));
} else {
  setStatus("Paste panel token to start");
}
