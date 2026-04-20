/**
 * Smart Home - Control de Dispositivos
 * Con soporte para acceso REMOTO de cámaras (DDNS, P2P, TURN)
 * Y guardado REAL en Supabase
 */

// ===========================
// CONFIGURACIÓN SUPABASE
// ===========================
const SUPABASE_URL = "https://xwzbizqfsgvboetswrqj.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3emJpenFmc2d2Ym9ldHN3cnFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2ODEwODksImV4cCI6MjA5MjI1NzA4OX0.lkailidmZXDPimqf6zWX273rrcas_0Uy7vgloAnR_sc";

const TABLE_MAP = {
  lights: "lights",
  locks: "locks",
  thermostats: "thermostats",
  sensors: "motion_sensors",
  cameras: "cameras",
};

const SECTION_TITLES = {
  lights: "Luces",
  locks: "Cerraduras",
  thermostats: "Termostato",
  sensors: "Sensores de Movimiento",
  cameras: "Camaras de Seguridad",
};

let data = { lights: [], locks: [], thermostats: [], sensors: [], cameras: [] };
let currentSection = "lights";
let currentCameraId = null;
let cameraZoomLevel = 1;
let cameraMicActive = false;
let cameraAudioActive = false;
let supabaseReady = false;

// ===========================
// STREAMING CONFIGURATION
// ===========================
const webrtcConnections = new Map();
const localStreams = new Map();
const streamingCanvases = new Map();

// Configuración ICE con STUN y TURN servers
let ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.stunprotocol.org:3478" },
  ],
};

// Cargar configuración TURN guardada
function loadTURNConfig() {
  const turnUrl = localStorage.getItem("turn-server-url");
  const turnUser = localStorage.getItem("turn-username");
  const turnPass = localStorage.getItem("turn-password");

  if (turnUrl) {
    ICE_SERVERS.iceServers.push({
      urls: turnUrl,
      username: turnUser || "",
      credential: turnPass || ""
    });
    console.log("[ICE] TURN server configurado:", turnUrl);
  }
}

// Servidor de Streaming RTSP URL (configurable)
// NO usar localhost por defecto - solo conectar si el usuario configura un servidor
let SIGNALING_SERVER_URL = localStorage.getItem("webrtc-signaling-server") || null;

// Funcion para generar URL de WebSocket basada en el host actual
function getAutoWebSocketURL(port = 8080) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  return `${protocol}//${host}:${port}`;
}

// Puerto del servidor WebSocket (configurable)
let WS_PORT = parseInt(localStorage.getItem("webrtc-ws-port")) || 8080;

// WebSocket connection para streaming
let streamingSocket = null;
let streamingConnected = false;

// Flag para evitar reintentos automaticos si no hay servidor configurado
let signalingServerConfigured = !!SIGNALING_SERVER_URL;

// Cache de frames para cada cámara
const frameCache = new Map();

// ===========================
// SUPABASE HELPERS - MEJORADOS
// ===========================
function sbHeaders() {
  return {
    apikey: SUPABASE_ANON,
    Authorization: "Bearer " + SUPABASE_ANON,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function sbSelect(table) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.asc`, {
      headers: sbHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Supabase] Error SELECT ${table}:`, res.status, errorText);
      throw new Error(res.statusText);
    }
    return res.json();
  } catch (error) {
    console.error(`[Supabase] Error en sbSelect(${table}):`, error);
    throw error;
  }
}

async function sbInsert(table, row) {
  try {
    console.log(`[Supabase] Insertando en ${table}:`, row);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Supabase] Error INSERT ${table}:`, res.status, errorText);
      throw new Error(`${res.statusText}: ${errorText}`);
    }
    const result = await res.json();
    console.log(`[Supabase] Insertado exitosamente:`, result);
    showToast("Dispositivo guardado en la nube", "success");
    return result;
  } catch (error) {
    console.error(`[Supabase] Error en sbInsert(${table}):`, error);
    showToast("Error guardando: " + error.message, "error");
    throw error;
  }
}

async function sbUpdate(table, id, fields) {
  try {
    console.log(`[Supabase] Actualizando ${table} id=${id}:`, fields);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: sbHeaders(),
      body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Supabase] Error UPDATE ${table}:`, res.status, errorText);
      throw new Error(`${res.statusText}: ${errorText}`);
    }
    const result = await res.json();
    console.log(`[Supabase] Actualizado exitosamente:`, result);
    return result;
  } catch (error) {
    console.error(`[Supabase] Error en sbUpdate(${table}, ${id}):`, error);
    throw error;
  }
}

async function sbDelete(table, id) {
  try {
    console.log(`[Supabase] Eliminando de ${table} id=${id}`);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: sbHeaders(),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Supabase] Error DELETE ${table}:`, res.status, errorText);
      throw new Error(`${res.statusText}: ${errorText}`);
    }
    console.log(`[Supabase] Eliminado exitosamente`);
    showToast("Dispositivo eliminado", "success");
  } catch (error) {
    console.error(`[Supabase] Error en sbDelete(${table}, ${id}):`, error);
    throw error;
  }
}

// ===========================
// TOAST NOTIFICATIONS
// ===========================
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === "success" ? "✓" : type === "error" ? "✗" : "ℹ"}</span>
    <span class="toast-message">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ===========================
// INIT
// ===========================
document.addEventListener("DOMContentLoaded", async () => {
  loadTURNConfig();
  navigateTo("lights");
  await loadAllData();
  setInterval(loadAllData, 10000); // Reducido a 10 segundos

  // Conectar al servidor de streaming
  initSignalingConnection();

  // Event listeners para cambio de tipo de conexión
  document.querySelectorAll('input[name="connection-type"]').forEach(radio => {
    radio.addEventListener("change", handleConnectionTypeChange);
  });

  // P2P service change
  const p2pSelect = document.getElementById("camera-p2p-service");
  if (p2pSelect) {
    p2pSelect.addEventListener("change", handleP2PServiceChange);
  }
});

function handleConnectionTypeChange(e) {
  const type = e.target.value;
  const remoteOptions = document.getElementById("remote-options");
  const webrtcOptions = document.getElementById("webrtc-options");

  if (remoteOptions) remoteOptions.style.display = type === "remote" ? "block" : "none";
  if (webrtcOptions) webrtcOptions.style.display = type === "webrtc" ? "block" : "none";
}

function handleP2PServiceChange(e) {
  const service = e.target.value;
  const p2pIdGroup = document.getElementById("p2p-device-id-group");
  if (p2pIdGroup) {
    p2pIdGroup.style.display = service !== "none" ? "block" : "none";
  }
}

// ===========================
// DATA LOADING
// ===========================
async function loadAllData() {
  try {
    const [lights, locks, thermostats, sensors, cameras] = await Promise.all([
      sbSelect("lights"),
      sbSelect("locks"),
      sbSelect("thermostats"),
      sbSelect("motion_sensors"),
      sbSelect("cameras"),
    ]);
    data = { lights, locks, thermostats, sensors, cameras };
    supabaseReady = true;
    updateBadge(true);
  } catch (err) {
    console.error("[Data] Error cargando datos:", err);
    if (!supabaseReady) {
      data = getDefaults();
    }
    updateBadge(false);
  }

  // Cargar cámaras guardadas localmente y combinarlas
  const localCameras = getLocalCameras();
  if (localCameras.length > 0) {
    const existingIds = new Set(data.cameras.map(c => c.id));
    const newLocalCameras = localCameras.filter(c => !existingIds.has(c.id));
    data.cameras = [...data.cameras, ...newLocalCameras];
  }

  renderCurrentSection();
  updateSidebarCounts();
}

// ===========================
// LOCAL STORAGE PERSISTENCE
// ===========================
function getLocalCameras() {
  try {
    const stored = localStorage.getItem("local-cameras");
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

function saveLocalCamera(camera) {
  const cameras = getLocalCameras();
  cameras.push(camera);
  localStorage.setItem("local-cameras", JSON.stringify(cameras));
}

function updateLocalCamera(camera) {
  const cameras = getLocalCameras();
  const index = cameras.findIndex(c => c.id === camera.id);
  if (index !== -1) {
    cameras[index] = camera;
    localStorage.setItem("local-cameras", JSON.stringify(cameras));
  }
}

function removeLocalCamera(cameraId) {
  const cameras = getLocalCameras().filter(c => c.id !== cameraId);
  localStorage.setItem("local-cameras", JSON.stringify(cameras));
}

function getDefaults() {
  return {
    lights: [],
    locks: [],
    thermostats: [],
    sensors: [],
    cameras: [],
  };
}

/**
 * Elimina una cámara (local o de Supabase)
 */
async function deleteCamera(cameraId) {
  if (!confirm("¿Eliminar esta cámara?")) return;

  if (String(cameraId).startsWith("local-")) {
    removeLocalCamera(cameraId);
    data.cameras = data.cameras.filter(c => c.id !== cameraId);
    showToast("Cámara local eliminada", "success");
  } else {
    try {
      await sbDelete("cameras", cameraId);
      data.cameras = data.cameras.filter(c => c.id !== cameraId);
    } catch (error) {
      console.error("Error eliminando cámara:", error);
      showToast("Error eliminando cámara", "error");
    }
  }

  renderCurrentSection();
  updateSidebarCounts();
}

function updateBadge(connected) {
  const b1 = document.getElementById("connection-badge");
  const b2 = document.getElementById("topbar-badge");
  [b1, b2].forEach((b) => {
    if (!b) return;
    b.className = connected ? "badge badge-online" : "badge badge-offline";
    b.textContent = connected ? "Conectado" : "Sin conexión";
  });
}

function updateSidebarCounts() {
  Object.keys(data).forEach((key) => {
    const el = document.getElementById(`count-${key}`);
    if (el) el.textContent = data[key].length;
  });
}

// ===========================
// NAVIGATION
// ===========================
function navigateTo(section) {
  currentSection = section;

  document.querySelectorAll(".nav-item[data-section]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === section);
  });

  document.querySelectorAll(".content-section").forEach((el) => {
    el.classList.toggle("active", el.id === "section-" + section);
  });

  const title = document.getElementById("section-title");
  if (title) title.textContent = SECTION_TITLES[section] || section;

  document.getElementById("sidebar").classList.remove("open");
  renderCurrentSection();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

// ===========================
// RENDERING
// ===========================
function renderCurrentSection() {
  const section = currentSection;
  const items = data[section] || [];
  const gridId = section + "-grid";
  const grid = document.getElementById(gridId);
  if (!grid) return;

  grid.innerHTML = "";

  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">--</div><div class="empty-text">No hay dispositivos</div><div class="empty-sub">Agrega uno con el boton de arriba</div></div>';
    return;
  }

  items.forEach((item) => {
    if (section === "cameras") {
      grid.appendChild(createCameraCard(item));
    } else {
      grid.appendChild(createDeviceCard(section, item));
    }
  });
}

// ===========================
// DEVICE CARDS
// ===========================
function createDeviceCard(section, device) {
  const card = document.createElement("div");
  card.className = "device-card";
  const online = device.is_online !== false;
  let controls = "";

  switch (section) {
    case "lights":
      controls = `
        <div class="device-control">
          <button class="btn btn-toggle ${device.is_on ? "on" : "off"}" onclick="toggleLight('${device.id}', ${!device.is_on})">
            ${device.is_on ? "Encendido" : "Apagado"}
          </button>
        </div>
        <div class="device-control">
          <span class="control-label">Brillo: ${device.brightness || 100}%</span>
          <input type="range" min="0" max="100" value="${device.brightness || 100}" class="slider" onchange="updateBrightness('${device.id}', this.value)">
        </div>
        <div class="device-control">
          <span class="control-label">Color</span>
          <input type="color" value="${device.color || '#FFFFFF'}" class="color-picker" onchange="updateLightColor('${device.id}', this.value)">
        </div>`;
      break;

    case "locks":
      controls = `
        <div class="device-control">
          <button class="btn btn-toggle ${device.is_locked ? "on" : "off"}" onclick="toggleLock('${device.id}', ${!device.is_locked})">
            ${device.is_locked ? "Bloqueada" : "Desbloqueada"}
          </button>
        </div>
        <div class="device-control">
          <label class="switch-label">
            <span>Auto-bloqueo</span>
            <input type="checkbox" ${device.auto_lock ? "checked" : ""} onchange="toggleAutoLock('${device.id}', this.checked)">
          </label>
        </div>`;
      break;

    case "thermostats":
      controls = `
        <div class="device-control">
          <button class="btn btn-toggle ${device.is_on ? "on" : "off"}" onclick="toggleThermostat('${device.id}', ${!device.is_on})">
            ${device.is_on ? "Encendido" : "Apagado"}
          </button>
        </div>
        <div class="device-control">
          <span class="control-label">Actual: ${device.current_temp || 20}°C</span>
        </div>
        <div class="device-control">
          <span class="control-label">Objetivo: ${device.target_temp || 22}°C</span>
          <div class="temp-controls">
            <button class="btn btn-sm" onclick="adjustTemp('${device.id}', -0.5)">-</button>
            <span class="temp-value">${device.target_temp || 22}°C</span>
            <button class="btn btn-sm" onclick="adjustTemp('${device.id}', 0.5)">+</button>
          </div>
        </div>
        <div class="device-control">
          <span class="control-label">Modo</span>
          <select class="mode-select" onchange="changeMode('${device.id}', this.value)">
            <option value="auto" ${device.mode === "auto" ? "selected" : ""}>Auto</option>
            <option value="cool" ${device.mode === "cool" ? "selected" : ""}>Enfriar</option>
            <option value="heat" ${device.mode === "heat" ? "selected" : ""}>Calentar</option>
            <option value="fan" ${device.mode === "fan" ? "selected" : ""}>Ventilador</option>
          </select>
        </div>
        <div class="device-control">
          <span class="control-label">Humedad: ${device.humidity || 45}%</span>
        </div>`;
      break;

    case "sensors":
      controls = `
        <div class="device-control">
          <div class="motion-status ${device.motion_detected ? "detected" : "idle"}">
            ${device.motion_detected ? "Movimiento Detectado" : "Sin Movimiento"}
          </div>
        </div>
        <div class="device-control">
          <label class="switch-label">
            <span>Activo</span>
            <input type="checkbox" ${device.is_active ? "checked" : ""} onchange="toggleSensorActive('${device.id}', this.checked)">
          </label>
        </div>
        <div class="device-control">
          <span class="control-label">Sensibilidad</span>
          <select class="mode-select" onchange="changeSensitivity('${device.id}', this.value)">
            <option value="low" ${device.sensitivity === "low" ? "selected" : ""}>Baja</option>
            <option value="medium" ${device.sensitivity === "medium" ? "selected" : ""}>Media</option>
            <option value="high" ${device.sensitivity === "high" ? "selected" : ""}>Alta</option>
          </select>
        </div>`;
      break;
  }

  card.innerHTML = `
    <div class="device-header">
      <div>
        <div class="device-name">${device.name}</div>
        <div class="device-location">${device.location || "-"}</div>
      </div>
      <div class="device-header-right">
        <div class="device-indicator ${online ? "online" : "offline"}"></div>
        <button class="btn-icon btn-delete" onclick="deleteDevice('${currentSection}', '${device.id}')" title="Eliminar">&#x2715;</button>
      </div>
    </div>
    <div class="device-body">${controls}</div>`;

  return card;
}

// ===========================
// CAMERA CARDS
// ===========================
function createCameraCard(cam) {
  const card = document.createElement("div");
  card.className = "camera-card";
  card.setAttribute("data-camera-id", cam.id);
  card.onclick = () => openCameraView(cam.id);

  const isRemote = cam.connection_type === "remote" || cam.ddns_url || cam.p2p_service;
  const isStreaming = cam.connection_type === "webrtc" || cam.stream_url;
  const isLocalCam = cam.use_local_camera;

  const connectionBadge = isRemote ? '<span class="camera-badge remote">REMOTO</span>' :
    isStreaming ? '<span class="camera-badge webrtc">RTSP</span>' :
      isLocalCam ? '<span class="camera-badge local">Local</span>' : '';

  card.innerHTML = `
    <div class="camera-feed-preview">
      <button class="camera-delete-btn" onclick="event.stopPropagation(); deleteCamera('${cam.id}')" title="Eliminar cámara">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      ${isLocalCam ? `
        <video class="camera-video-preview" data-camera-id="${cam.id}" autoplay muted playsinline></video>
        <div class="camera-no-signal" style="display:none">Sin senal</div>
      ` : isStreaming || isRemote ? `
        <img class="camera-stream-preview" data-camera-id="${cam.id}" alt="${cam.name}">
        <div class="camera-no-signal" style="display:none">Conectando...</div>
      ` : cam.snapshot_url ? `
        <img src="${cam.snapshot_url}" alt="${cam.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
        <div class="camera-no-signal" style="display:none">Sin senal</div>
      ` : `
        <div class="camera-no-signal">
          <span class="no-signal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32">
              <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/>
              <rect x="2" y="7" width="14" height="10" rx="2"/>
              <line x1="2" y1="2" x2="22" y2="22" stroke-linecap="round"/>
            </svg>
          </span>
          <span>Sin configurar</span>
        </div>
      `}
      <div class="camera-card-overlay">
        <div>
          <div class="camera-card-name">${cam.name}</div>
          <div class="camera-card-location">${cam.location || ""} | ${cam.camera_brand || "---"} | ${cam.resolution || "---"}</div>
        </div>
        <div class="camera-status-badges">
          ${connectionBadge}
          <div class="camera-rec-dot ${cam.is_recording ? "" : "off"}"></div>
        </div>
      </div>
    </div>`;

  // Iniciar conexion segun tipo
  setTimeout(() => {
    if (isLocalCam) {
      const videoEl = card.querySelector("video");
      if (videoEl) connectCamera(cam.id, videoEl);
    } else if (isStreaming || isRemote) {
      const imgEl = card.querySelector("img.camera-stream-preview");
      if (imgEl) connectCamera(cam.id, imgEl);
    }
  }, 100);

  return card;
}

function setCameraGrid(cols) {
  const grid = document.getElementById("cameras-grid");
  grid.className = "cameras-grid grid-" + cols;
  document.querySelectorAll(".grid-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.grid) === cols);
  });
}

// ===========================
// CAMERA FULL VIEW
// ===========================
function openCameraView(camId) {
  const cam = data.cameras.find((c) => c.id === camId);
  if (!cam) return;

  currentCameraId = camId;
  cameraZoomLevel = 1;
  cameraMicActive = false;
  cameraAudioActive = false;

  document.getElementById("camera-view-title").textContent = cam.name + " - " + (cam.location || "");

  const feed = document.getElementById("camera-feed-full");
  const isWebRTC = cam.connection_type === "webrtc" || cam.connection_type === "remote" || cam.use_local_camera;

  if (isWebRTC || cam.use_local_camera) {
    feed.innerHTML = `
      <video id="camera-full-video" data-camera-id="${cam.id}" autoplay playsinline style="transform:scale(1)"></video>
      <div class="camera-placeholder-full" style="display:none">Conectando...</div>
    `;

    const videoEl = document.getElementById("camera-full-video");
    const existingStream = localStreams.get(camId);
    if (existingStream) {
      videoEl.srcObject = existingStream;
      videoEl.play().catch(e => console.log("[WebRTC] Autoplay bloqueado:", e));
    } else {
      connectCamera(camId, videoEl);
    }
  } else if (cam.snapshot_url) {
    feed.innerHTML = `<img id="camera-full-img" src="${cam.snapshot_url}" alt="${cam.name}" style="transform:scale(1)" onerror="this.outerHTML='<div class=\\'camera-placeholder-full\\'>Error de conexion</div>'">`;
  } else {
    feed.innerHTML = `
      <div class="camera-placeholder-full">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48">
          <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/>
          <rect x="2" y="7" width="14" height="10" rx="2"/>
        </svg>
        <span>Camara sin configurar</span>
        <span class="placeholder-hint">Haz click en Ajustes para conectarla</span>
      </div>
    `;
  }

  const btnMic = document.getElementById("btn-mic");
  const btnAudio = document.getElementById("btn-audio");
  const btnRec = document.getElementById("btn-record");

  btnMic.classList.remove("active");
  btnMic.disabled = !cam.has_mic;
  btnMic.title = cam.has_mic ? "Microfono" : "Sin microfono";

  btnAudio.classList.remove("active");
  btnAudio.disabled = !cam.has_audio;
  btnAudio.title = cam.has_audio ? "Audio" : "Sin audio";

  btnRec.classList.toggle("active", cam.is_recording);

  const info = document.getElementById("camera-info-bar");
  if (info) {
    const connectionType = cam.connection_type === "remote" ? "Remoto" :
      cam.use_local_camera ? "Local" :
        cam.connection_type === "webrtc" ? "WebRTC" : "HTTP";
    info.innerHTML = `
      <span>${cam.camera_brand || "---"}</span>
      <span>${cam.resolution || "---"}</span>
      <span class="connection-type ${connectionType.toLowerCase()}">${connectionType}</span>
      ${cam.has_night_vision ? '<span>Vision nocturna</span>' : ''}
      ${cam.ddns_url ? '<span>DDNS: ' + cam.ddns_url.substring(0, 20) + '...</span>' : ''}
    `;
  }

  document.getElementById("camera-view-modal").classList.remove("hidden");
}

function closeCameraViewModal() {
  const video = document.getElementById("camera-full-video");
  if (video) {
    video.pause();
  }

  document.getElementById("camera-view-modal").classList.add("hidden");
  currentCameraId = null;
}

function toggleCameraMic() {
  cameraMicActive = !cameraMicActive;
  document.getElementById("btn-mic").classList.toggle("active", cameraMicActive);
}

function toggleCameraAudio() {
  cameraAudioActive = !cameraAudioActive;
  document.getElementById("btn-audio").classList.toggle("active", cameraAudioActive);
}

function zoomCamera(direction) {
  cameraZoomLevel = Math.max(1, Math.min(4, cameraZoomLevel + direction * 0.5));

  const img = document.getElementById("camera-full-img");
  const video = document.getElementById("camera-full-video");

  if (img) img.style.transform = "scale(" + cameraZoomLevel + ")";
  if (video) video.style.transform = "scale(" + cameraZoomLevel + ")";

  const label = document.getElementById("zoom-label");
  if (label) label.textContent = cameraZoomLevel.toFixed(1) + "x";
}

async function toggleCameraRecording() {
  if (!currentCameraId) return;
  const cam = data.cameras.find((c) => c.id === currentCameraId);
  if (!cam) return;
  const newVal = !cam.is_recording;

  try {
    if (!String(currentCameraId).startsWith("local-")) {
      await sbUpdate("cameras", currentCameraId, { is_recording: newVal });
    }
    cam.is_recording = newVal;
  } catch (e) {
    cam.is_recording = newVal;
  }

  document.getElementById("btn-record").classList.toggle("active", newVal);
  await loadAllData();
}

// ===========================
// DEVICE ACTIONS - CON GUARDADO REAL
// ===========================
async function toggleLight(id, val) {
  try {
    await sbUpdate("lights", id, { is_on: val });
  } catch (e) {
    const d = data.lights.find((x) => x.id === id);
    if (d) d.is_on = val;
  }
  await loadAllData();
}

async function updateBrightness(id, val) {
  try {
    await sbUpdate("lights", id, { brightness: parseInt(val) });
  } catch (e) {
    const d = data.lights.find((x) => x.id === id);
    if (d) d.brightness = parseInt(val);
  }
  await loadAllData();
}

async function updateLightColor(id, val) {
  try {
    await sbUpdate("lights", id, { color: val });
  } catch (e) {
    const d = data.lights.find((x) => x.id === id);
    if (d) d.color = val;
  }
  await loadAllData();
}

async function toggleLock(id, val) {
  try {
    await sbUpdate("locks", id, { is_locked: val });
  } catch (e) {
    const d = data.locks.find((x) => x.id === id);
    if (d) d.is_locked = val;
  }
  await loadAllData();
}

async function toggleAutoLock(id, val) {
  try {
    await sbUpdate("locks", id, { auto_lock: val });
  } catch (e) {
    const d = data.locks.find((x) => x.id === id);
    if (d) d.auto_lock = val;
  }
  await loadAllData();
}

async function toggleThermostat(id, val) {
  try {
    await sbUpdate("thermostats", id, { is_on: val });
  } catch (e) {
    const d = data.thermostats.find((x) => x.id === id);
    if (d) d.is_on = val;
  }
  await loadAllData();
}

async function adjustTemp(id, delta) {
  const d = data.thermostats.find((x) => x.id === id);
  if (!d) return;
  const newVal = Math.max(10, Math.min(35, (d.target_temp || 20) + delta));
  try {
    await sbUpdate("thermostats", id, { target_temp: newVal });
  } catch (e) {
    d.target_temp = newVal;
  }
  await loadAllData();
}

async function changeMode(id, val) {
  try {
    await sbUpdate("thermostats", id, { mode: val });
  } catch (e) {
    const d = data.thermostats.find((x) => x.id === id);
    if (d) d.mode = val;
  }
  await loadAllData();
}

async function toggleSensorActive(id, val) {
  try {
    await sbUpdate("motion_sensors", id, { is_active: val });
  } catch (e) {
    const d = data.sensors.find((x) => x.id === id);
    if (d) d.is_active = val;
  }
  await loadAllData();
}

async function changeSensitivity(id, val) {
  try {
    await sbUpdate("motion_sensors", id, { sensitivity: val });
  } catch (e) {
    const d = data.sensors.find((x) => x.id === id);
    if (d) d.sensitivity = val;
  }
  await loadAllData();
}

async function deleteDevice(section, id) {
  if (!confirm("Eliminar este dispositivo?")) return;
  const table = TABLE_MAP[section];
  try {
    await sbDelete(table, id);
  } catch (e) {
    data[section] = data[section].filter((x) => x.id !== id);
    showToast("Eliminado localmente", "info");
  }
  await loadAllData();
}

// ===========================
// ADD DEVICE MODAL
// ===========================
function openAddDeviceModal(type) {
  const titles = { lights: "Agregar Luz", locks: "Agregar Cerradura", thermostats: "Agregar Termostato", sensors: "Agregar Sensor" };
  document.getElementById("add-device-title").textContent = titles[type] || "Agregar Dispositivo";
  document.getElementById("device-section-input").value = type;
  document.getElementById("add-device-form").reset();
  document.getElementById("add-device-modal").classList.remove("hidden");
}

function closeAddDeviceModal() {
  document.getElementById("add-device-modal").classList.add("hidden");
}

async function handleAddDevice(event) {
  event.preventDefault();
  const section = document.getElementById("device-section-input").value;
  const name = document.getElementById("device-name").value.trim();
  const location = document.getElementById("device-location").value.trim();
  if (!name) return;

  const table = TABLE_MAP[section];
  const defaults = {
    lights: { name, location, is_on: false, brightness: 100, color: "#FFFFFF", is_online: true },
    locks: { name, location, is_locked: true, auto_lock: false, is_online: true },
    thermostats: { name, location, is_on: false, current_temp: 20, target_temp: 22, mode: "auto", humidity: 45, is_online: true },
    sensors: { name, location, is_active: true, motion_detected: false, sensitivity: "medium", is_online: true },
  };

  const row = defaults[section];

  try {
    const result = await sbInsert(table, row);
    console.log("[Device] Dispositivo creado:", result);
  } catch (e) {
    console.error("[Device] Error guardando, usando local:", e);
    row.id = "local-" + Date.now();
    data[section].push(row);
    showToast("Guardado localmente (sin conexión)", "warning");
  }

  closeAddDeviceModal();
  await loadAllData();
}

// ===========================
// ADD CAMERA MODAL - CON OPCIONES REMOTAS
// ===========================
let editingCameraId = null;

function openCameraSetupModal() {
  editingCameraId = null;
  document.getElementById("camera-setup-form").reset();
  document.getElementById("camera-edit-id").value = "";
  document.getElementById("camera-modal-title").textContent = "Configurar Camara";

  // Reset connection type options visibility
  document.getElementById("remote-options").style.display = "block";
  document.getElementById("webrtc-options").style.display = "none";
  document.getElementById("conn-remote").checked = true;

  document.getElementById("camera-setup-modal").classList.remove("hidden");
}

function closeCameraSetupModal() {
  document.getElementById("camera-setup-modal").classList.add("hidden");
  editingCameraId = null;
}

async function handleCameraSetup(event) {
  event.preventDefault();

  const connectionType = document.querySelector('input[name="connection-type"]:checked')?.value || "remote";
  const editId = document.getElementById("camera-edit-id").value;

  const row = {
    name: document.getElementById("camera-name").value.trim(),
    location: document.getElementById("camera-location").value.trim(),
    camera_username: document.getElementById("camera-username").value.trim() || null,
    camera_password: document.getElementById("camera-password").value.trim() || null,
    camera_brand: document.getElementById("camera-brand").value || "H-VIEW",
    resolution: document.getElementById("camera-resolution").value,
    has_audio: document.getElementById("camera-has-audio").checked,
    has_mic: document.getElementById("camera-has-mic").checked,
    has_night_vision: document.getElementById("camera-has-nightvision").checked,
    is_recording: false,
    connection_type: connectionType,
    use_local_camera: connectionType === "local",
    is_online: true,
  };

  // Configuración específica según tipo de conexión
  if (connectionType === "remote") {
    row.ddns_url = document.getElementById("camera-ddns-url").value.trim() || null;
    row.remote_port = parseInt(document.getElementById("camera-remote-port").value) || 80;
    row.rtsp_port = parseInt(document.getElementById("camera-rtsp-port").value) || 554;
    row.stream_url = document.getElementById("camera-stream-url-remote").value.trim() || null;
    row.snapshot_url = document.getElementById("camera-snapshot-url-remote").value.trim() || null;
    row.p2p_service = document.getElementById("camera-p2p-service").value || null;
    row.p2p_device_id = document.getElementById("camera-p2p-device-id")?.value.trim() || null;

    // Generar URL si no se proporcionó
    if (!row.stream_url && row.ddns_url) {
      const user = row.camera_username || "admin";
      const pass = row.camera_password || "";
      row.stream_url = `rtsp://${user}:${pass}@${row.ddns_url}:${row.rtsp_port}/stream1`;
    }
  } else if (connectionType === "webrtc") {
    row.stream_url = document.getElementById("camera-stream-url").value.trim() || null;
    row.snapshot_url = document.getElementById("camera-snapshot-url").value.trim() || null;
  }

  if (!row.name) return;

  if (editId) {
    // Actualizar cámara existente
    try {
      if (!String(editId).startsWith("local-")) {
        await sbUpdate("cameras", editId, row);
      } else {
        // Actualizar local
        const cam = data.cameras.find(c => c.id === editId);
        if (cam) Object.assign(cam, row);
        updateLocalCamera({ ...cam, ...row });
      }
      showToast("Cámara actualizada", "success");
    } catch (e) {
      console.error("[Camera] Error actualizando:", e);
    }
  } else {
    // Crear nueva cámara
    try {
      await sbInsert("cameras", row);
    } catch (e) {
      console.error("[Camera] Error guardando, usando local:", e);
      row.id = "local-" + Date.now();
      row.created_at = new Date().toISOString();
      saveLocalCamera(row);
      data.cameras.push(row);
      showToast("Guardado localmente", "warning");
    }
  }

  closeCameraSetupModal();
  await loadAllData();
}

function editCameraConfig(camId) {
  closeCameraViewModal();
  const cam = data.cameras.find((c) => c.id === camId);
  if (!cam) return;

  editingCameraId = camId;
  document.getElementById("camera-edit-id").value = camId;
  document.getElementById("camera-modal-title").textContent = "Editar Camara";

  document.getElementById("camera-name").value = cam.name || "";
  document.getElementById("camera-location").value = cam.location || "";
  document.getElementById("camera-username").value = cam.camera_username || "";
  document.getElementById("camera-password").value = cam.camera_password || "";
  document.getElementById("camera-brand").value = cam.camera_brand || "H-VIEW";
  document.getElementById("camera-resolution").value = cam.resolution || "1080p";
  document.getElementById("camera-has-audio").checked = !!cam.has_audio;
  document.getElementById("camera-has-mic").checked = !!cam.has_mic;
  document.getElementById("camera-has-nightvision").checked = !!cam.has_night_vision;

  // Set connection type
  const connType = cam.connection_type || "webrtc";
  const radio = document.getElementById(`conn-${connType}`);
  if (radio) radio.checked = true;

  // Set remote options
  if (connType === "remote") {
    document.getElementById("remote-options").style.display = "block";
    document.getElementById("webrtc-options").style.display = "none";
    document.getElementById("camera-ddns-url").value = cam.ddns_url || "";
    document.getElementById("camera-remote-port").value = cam.remote_port || 80;
    document.getElementById("camera-rtsp-port").value = cam.rtsp_port || 554;
    document.getElementById("camera-stream-url-remote").value = cam.stream_url || "";
    document.getElementById("camera-snapshot-url-remote").value = cam.snapshot_url || "";
    document.getElementById("camera-p2p-service").value = cam.p2p_service || "none";
    if (cam.p2p_device_id) {
      document.getElementById("camera-p2p-device-id").value = cam.p2p_device_id;
      document.getElementById("p2p-device-id-group").style.display = "block";
    }
  } else if (connType === "webrtc") {
    document.getElementById("remote-options").style.display = "none";
    document.getElementById("webrtc-options").style.display = "block";
    document.getElementById("camera-stream-url").value = cam.stream_url || "";
    document.getElementById("camera-snapshot-url").value = cam.snapshot_url || "";
  }

  document.getElementById("camera-setup-modal").classList.remove("hidden");
}

// Probar conexión de cámara
async function testCameraConnection() {
  const connectionType = document.querySelector('input[name="connection-type"]:checked')?.value;
  let testUrl = "";

  if (connectionType === "remote") {
    testUrl = document.getElementById("camera-snapshot-url-remote").value.trim() ||
      document.getElementById("camera-ddns-url").value.trim();
  } else {
    testUrl = document.getElementById("camera-snapshot-url").value.trim();
  }

  if (!testUrl) {
    showToast("Ingresa una URL para probar", "warning");
    return;
  }

  showToast("Probando conexión...", "info");

  try {
    // Para pruebas HTTP/snapshot
    if (testUrl.startsWith("http")) {
      const img = new Image();
      img.onload = () => showToast("Conexión exitosa!", "success");
      img.onerror = () => showToast("No se pudo conectar (CORS o URL inválida)", "error");
      img.src = testUrl + "?t=" + Date.now();
    } else {
      showToast("URL RTSP requiere servidor de streaming", "warning");
    }
  } catch (e) {
    showToast("Error de conexión: " + e.message, "error");
  }
}

// ===========================
// KEYBOARD
// ===========================
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeCameraViewModal();
    closeCameraSetupModal();
    closeAddDeviceModal();
    closeWebRTCSettings();
    closeDVRScanModal();
    closeDVRCamerasModal();
  }
});

// ===========================
// STREAMING FUNCTIONS (RTSP via WebSocket MJPEG)
// ===========================

/**
 * Inicializa la conexion WebSocket para streaming RTSP
 * Solo se conecta si hay un servidor configurado (no localhost por defecto)
 */
function initSignalingConnection() {
  // No intentar conectar si no hay servidor configurado
  if (!SIGNALING_SERVER_URL || !signalingServerConfigured) {
    console.log("[Streaming] No hay servidor de streaming configurado. Configure uno en Ajustes WebRTC.");
    updateWebRTCStatus(false, "No configurado");
    return;
  }

  if (streamingSocket && streamingSocket.readyState === WebSocket.OPEN) {
    return;
  }

  // Validar que la URL no sea localhost (a menos que se haya configurado explicitamente)
  if (SIGNALING_SERVER_URL.includes("localhost") || SIGNALING_SERVER_URL.includes("127.0.0.1")) {
    const savedUrl = localStorage.getItem("webrtc-signaling-server");
    if (!savedUrl) {
      console.log("[Streaming] Servidor localhost detectado pero no configurado explicitamente. Configure un servidor remoto.");
      updateWebRTCStatus(false, "Configure servidor remoto");
      return;
    }
  }

  console.log("[Streaming] Conectando a servidor remoto:", SIGNALING_SERVER_URL);

  try {
    streamingSocket = new WebSocket(SIGNALING_SERVER_URL);

    streamingSocket.onopen = () => {
      console.log("[Streaming] Conectado al servidor RTSP remoto");
      streamingConnected = true;
      updateWebRTCStatus(true, "Conectado");
      showToast("Conectado al servidor de streaming", "success");

      // Re-suscribirse a camaras activas
      streamingCanvases.forEach((canvas, cameraId) => {
        subscribeToCamera(cameraId);
      });
    };

    streamingSocket.onclose = () => {
      console.log("[Streaming] Desconectado del servidor");
      streamingConnected = false;
      updateWebRTCStatus(false, "Desconectado");
      // Reconectar despues de 10 segundos solo si hay servidor configurado
      if (signalingServerConfigured && SIGNALING_SERVER_URL) {
        setTimeout(initSignalingConnection, 10000);
      }
    };

    streamingSocket.onerror = (error) => {
      console.error("[Streaming] Error de conexion:", error);
      streamingConnected = false;
      updateWebRTCStatus(false, "Error de conexion");
    };

    streamingSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleStreamingMessage(message);
      } catch (error) {
        console.error("[Streaming] Error parseando mensaje:", error);
      }
    };
  } catch (e) {
    console.error("[Streaming] Error creando WebSocket:", e);
    updateWebRTCStatus(false, "Error");
  }
}

/**
 * Maneja mensajes del servidor de streaming
 */
function handleStreamingMessage(message) {
  const { type, cameraId, data: msgData } = message;

  switch (type) {
    case "frame":
      renderFrame(cameraId, msgData);
      break;
    case "cameras-list":
      console.log("[Streaming] Camaras disponibles en servidor:", message.cameras);
      window.serverCameras = message.cameras;
      break;
    case "subscribed":
      console.log("[Streaming] Suscrito exitosamente a camara:", cameraId);
      updateCameraConnectionStatus(cameraId, "connected");
      break;
    case "error":
      console.error("[Streaming] Error del servidor:", message.message, "camara:", cameraId);
      showCameraError(cameraId, message.message);
      break;
    case "stream-ended":
      console.log("[Streaming] Stream terminado:", cameraId);
      updateCameraConnectionStatus(cameraId, "disconnected");
      break;
  }
}

/**
 * Renderiza un frame JPEG en el canvas/img de la camara
 */
let frameCount = 0;
function renderFrame(cameraId, base64Data) {
  frameCount++;
  frameCache.set(cameraId, base64Data);

  const imgElements = document.querySelectorAll(`img[data-camera-stream="${cameraId}"]`);
  const canvasElements = document.querySelectorAll(`canvas[data-camera-stream="${cameraId}"]`);

  const dataUrl = `data:image/jpeg;base64,${base64Data}`;

  imgElements.forEach(img => {
    img.src = dataUrl;
  });

  canvasElements.forEach(canvas => {
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  });
}

/**
 * Suscribirse a una camara RTSP
 */
function subscribeToCamera(cameraId) {
  const cam = data.cameras.find(c => c.id === cameraId || c.id === parseInt(cameraId));

  if (streamingSocket?.readyState === WebSocket.OPEN) {
    const msg = {
      type: "subscribe",
      cameraId: String(cameraId),
      rtspUrl: cam?.stream_url || null,
      options: {
        name: cam?.name || "Camera",
        width: cam?.resolution === "4K" ? 3840 : cam?.resolution === "2K" ? 2560 : cam?.resolution === "1080p" ? 1920 : 1280,
        height: cam?.resolution === "4K" ? 2160 : cam?.resolution === "2K" ? 1440 : cam?.resolution === "1080p" ? 1080 : 720,
        fps: 15
      }
    };
    streamingSocket.send(JSON.stringify(msg));
  }
}

/**
 * Desuscribirse de una camara
 */
function unsubscribeFromCamera(cameraId) {
  if (streamingSocket?.readyState === WebSocket.OPEN) {
    streamingSocket.send(JSON.stringify({
      type: "unsubscribe",
      cameraId: cameraId
    }));
  }
  streamingCanvases.delete(cameraId);
}

/**
 * Inicia streaming RTSP para una camara
 */
function startRTSPStreaming(cameraId, targetElement) {
  const camIdStr = String(cameraId);

  streamingCanvases.set(camIdStr, targetElement);
  targetElement.setAttribute("data-camera-stream", camIdStr);

  if (streamingConnected) {
    subscribeToCamera(camIdStr);
  } else {
    initSignalingConnection();
    const checkConnection = setInterval(() => {
      if (streamingConnected) {
        clearInterval(checkConnection);
        subscribeToCamera(camIdStr);
      }
    }, 500);
    setTimeout(() => clearInterval(checkConnection), 10000);
  }
}

/**
 * Detiene streaming de una camara
 */
function stopRTSPStreaming(cameraId) {
  unsubscribeFromCamera(cameraId);
  const elements = document.querySelectorAll(`[data-camera-stream="${cameraId}"]`);
  elements.forEach(el => el.removeAttribute("data-camera-stream"));
}

/**
 * Actualiza el estado de conexion en la UI
 */
function updateWebRTCStatus(connected, message = null) {
  const statusEl = document.getElementById("webrtc-status");
  if (statusEl) {
    statusEl.className = connected ? "webrtc-status connected" : "webrtc-status disconnected";
    if (message) {
      statusEl.textContent = message;
    } else {
      statusEl.textContent = connected ? "Servidor Activo" : "Servidor Desconectado";
    }
  }
}

/**
 * Actualiza el estado de conexion de una camara
 */
function updateCameraConnectionStatus(cameraId, state) {
  const card = document.querySelector(`[data-camera-id="${cameraId}"]`);
  if (card) {
    card.setAttribute("data-connection-state", state);
  }
}

/**
 * Intenta conectar usando getUserMedia (camara local/webcam)
 */
async function tryLocalCameraFallback(cameraId, videoElement) {
  const cam = data.cameras.find((c) => c.id === cameraId);
  if (!cam) return false;

  if (cam.camera_type === "local" || cam.use_local_camera) {
    try {
      const constraints = {
        video: {
          width: { ideal: cam.resolution === "4K" ? 3840 : cam.resolution === "2K" ? 2560 : cam.resolution === "1080p" ? 1920 : 1280 },
          height: { ideal: cam.resolution === "4K" ? 2160 : cam.resolution === "2K" ? 1440 : cam.resolution === "1080p" ? 1080 : 720 },
        },
        audio: cam.has_audio || false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreams.set(cameraId, stream);
      videoElement.srcObject = stream;
      await videoElement.play();
      console.log("[Streaming] Camara local conectada:", cameraId);
      return true;
    } catch (error) {
      console.error("[Streaming] Error accediendo camara local:", error);
      return false;
    }
  }

  return false;
}

/**
 * Conecta una camara usando el mejor metodo disponible
 */
async function connectCamera(cameraId, targetElement) {
  const cam = data.cameras.find((c) => c.id === cameraId);
  if (!cam) return;

  showCameraLoading(cameraId, true);

  // 1. Camara local (webcam)
  if (cam.use_local_camera && targetElement.tagName === "VIDEO") {
    if (await tryLocalCameraFallback(cameraId, targetElement)) {
      showCameraLoading(cameraId, false);
      return;
    }
  }

  // 2. Streaming RTSP via WebSocket (local o remoto)
  if (cam.connection_type === "webrtc" || cam.connection_type === "remote" || cam.stream_url) {
    startRTSPStreaming(cameraId, targetElement);
    showCameraLoading(cameraId, false);
    return;
  }

  // 3. Snapshot HTTP (remoto o local)
  if (cam.snapshot_url) {
    showCameraSnapshot(cameraId, cam.snapshot_url);
    showCameraLoading(cameraId, false);
    return;
  }

  // 4. Mensaje de configuración
  showCameraError(cameraId, "Configura la conexión de la cámara");
  showCameraLoading(cameraId, false);
}

/**
 * Muestra estado de carga para una camara
 */
function showCameraLoading(cameraId, loading) {
  const container = document.querySelector(`[data-camera-id="${cameraId}"]`);
  if (!container) return;

  let loader = container.querySelector(".camera-loader");
  if (loading && !loader) {
    loader = document.createElement("div");
    loader.className = "camera-loader";
    loader.innerHTML = '<div class="loader-spinner"></div><span>Conectando...</span>';
    container.appendChild(loader);
  } else if (!loading && loader) {
    loader.remove();
  }
}

/**
 * Muestra un snapshot estatico de la camara
 */
function showCameraSnapshot(cameraId, snapshotUrl) {
  const container = document.querySelector(`[data-camera-id="${cameraId}"]`);
  if (!container) return;

  const video = container.querySelector("video");
  if (video) video.style.display = "none";

  let img = container.querySelector("img.camera-snapshot");
  if (!img) {
    img = document.createElement("img");
    img.className = "camera-snapshot";
    container.appendChild(img);
  }
  img.src = snapshotUrl;
  img.alt = "Camera snapshot";
}

/**
 * Muestra error de conexion
 */
function showCameraError(cameraId, message) {
  const container = document.querySelector(`[data-camera-id="${cameraId}"]`);
  if (!container) return;

  let errorEl = container.querySelector(".camera-error");
  if (!errorEl) {
    errorEl = document.createElement("div");
    errorEl.className = "camera-error";
    container.appendChild(errorEl);
  }
  errorEl.innerHTML = `<span class="error-icon">!</span><span>${message}</span>`;
}

/**
 * Configura el servidor de senalizacion (remoto)
 * @param {string} url - URL del servidor WebSocket (ej: wss://mi-servidor.com:8080)
 */
function setSignalingServer(url) {
  if (!url || url.trim() === "") {
    console.log("[Streaming] URL vacia, deshabilitando servidor de streaming");
    SIGNALING_SERVER_URL = null;
    signalingServerConfigured = false;
    localStorage.removeItem("webrtc-signaling-server");
    if (streamingSocket) {
      streamingSocket.close();
    }
    updateWebRTCStatus(false, "No configurado");
    return;
  }

  // Validar formato de URL WebSocket
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    showToast("La URL debe comenzar con ws:// o wss://", "error");
    return;
  }

  SIGNALING_SERVER_URL = url;
  signalingServerConfigured = true;
  localStorage.setItem("webrtc-signaling-server", url);
  
  console.log("[Streaming] Servidor configurado:", url);
  showToast("Servidor de streaming configurado", "success");
  
  if (streamingSocket) {
    streamingSocket.close();
  }
  initSignalingConnection();
}

/**
 * Obtiene dispositivos de camara disponibles
 */
async function getAvailableCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput");
  } catch (error) {
    console.error("[WebRTC] Error enumerando dispositivos:", error);
    return [];
  }
}

/**
 * Abre modal para configurar servidor WebRTC (remoto)
 */
function openWebRTCSettings() {
  document.getElementById("webrtc-settings-modal").classList.remove("hidden");
  document.getElementById("signaling-server-url").value = SIGNALING_SERVER_URL || "";
  
  // Mostrar placeholder con ejemplo de URL remota usando el host actual
  const serverInput = document.getElementById("signaling-server-url");
  const autoUrl = getAutoWebSocketURL(WS_PORT);
  serverInput.placeholder = autoUrl;
  
  // Configurar puerto
  const portInput = document.getElementById("ws-port");
  if (portInput) {
    portInput.value = WS_PORT;
  }
  
  // Mostrar URL detectada automaticamente
  const autoUrlDisplay = document.getElementById("auto-detected-url");
  if (autoUrlDisplay) {
    autoUrlDisplay.textContent = autoUrl;
  }

  // Cargar configuracion TURN
  document.getElementById("turn-server-url").value = localStorage.getItem("turn-server-url") || "";
  document.getElementById("turn-username").value = localStorage.getItem("turn-username") || "";
  document.getElementById("turn-password").value = localStorage.getItem("turn-password") || "";
}

function closeWebRTCSettings() {
  document.getElementById("webrtc-settings-modal").classList.add("hidden");
}

/**
 * Usa automaticamente la URL detectada del host actual
 */
function useAutoDetectedURL() {
  const portInput = document.getElementById("ws-port");
  const port = portInput ? parseInt(portInput.value) || 8080 : WS_PORT;
  const autoUrl = getAutoWebSocketURL(port);
  document.getElementById("signaling-server-url").value = autoUrl;
  showToast("URL auto-detectada aplicada: " + autoUrl, "success");
}

/**
 * Actualiza la URL mostrada cuando cambia el puerto
 */
function updateAutoDetectedURL() {
  const portInput = document.getElementById("ws-port");
  const port = portInput ? parseInt(portInput.value) || 8080 : 8080;
  const autoUrl = getAutoWebSocketURL(port);
  const autoUrlDisplay = document.getElementById("auto-detected-url");
  if (autoUrlDisplay) {
    autoUrlDisplay.textContent = autoUrl;
  }
}

function saveWebRTCSettings() {
  const url = document.getElementById("signaling-server-url").value.trim();
  
  // Guardar puerto configurado
  const portInput = document.getElementById("ws-port");
  if (portInput) {
    const port = parseInt(portInput.value) || 8080;
    WS_PORT = port;
    localStorage.setItem("webrtc-ws-port", port.toString());
  }
  
  // setSignalingServer ya maneja la validacion y guardado en localStorage
  setSignalingServer(url);

  // Guardar configuracion TURN
  const turnUrl = document.getElementById("turn-server-url").value.trim();
  const turnUser = document.getElementById("turn-username").value.trim();
  const turnPass = document.getElementById("turn-password").value.trim();

  if (turnUrl) {
    localStorage.setItem("turn-server-url", turnUrl);
    localStorage.setItem("turn-username", turnUser);
    localStorage.setItem("turn-password", turnPass);

    // Actualizar ICE servers
    ICE_SERVERS.iceServers = ICE_SERVERS.iceServers.filter(s => !s.urls?.includes("turn:"));
    ICE_SERVERS.iceServers.push({
      urls: turnUrl,
      username: turnUser,
      credential: turnPass
    });
    showToast("Servidor TURN configurado", "success");
  }

  closeWebRTCSettings();
  showToast("Configuración guardada", "success");
}

// Probar conexión TURN
async function testTURNConnection() {
  const turnUrl = document.getElementById("turn-server-url").value.trim();
  const turnUser = document.getElementById("turn-username").value.trim();
  const turnPass = document.getElementById("turn-password").value.trim();

  if (!turnUrl) {
    showToast("Ingresa una URL de servidor TURN", "warning");
    return;
  }

  showToast("Probando conexión TURN...", "info");

  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: turnUrl, username: turnUser, credential: turnPass }
      ]
    });

    let turnWorking = false;

    pc.onicecandidate = (e) => {
      if (e.candidate && e.candidate.type === "relay") {
        turnWorking = true;
        showToast("Servidor TURN funcionando!", "success");
        pc.close();
      }
    };

    pc.createDataChannel("test");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Timeout
    setTimeout(() => {
      if (!turnWorking) {
        showToast("No se pudo conectar al servidor TURN", "error");
        pc.close();
      }
    }, 5000);
  } catch (e) {
    showToast("Error probando TURN: " + e.message, "error");
  }
}

// ===========================
// DVR QR SCANNER
// ===========================
let html5QrCode = null;
let currentDVRConfig = null;
let selectedDVRCameras = new Set();

const DVR_RTSP_TEMPLATES = {
  hikvision: "rtsp://{user}:{pass}@{ip}:{port}/Streaming/Channels/{ch}01",
  dahua: "rtsp://{user}:{pass}@{ip}:{port}/cam/realmonitor?channel={ch}&subtype=0",
  hview: "rtsp://{user}:{pass}@{ip}:{port}/stream{ch}",
  xmeye: "rtsp://{user}:{pass}@{ip}:{port}/user={user}&password={pass}&channel={ch}&stream=0.sdp",
  other: "rtsp://{user}:{pass}@{ip}:{port}/ch{ch}/main/av_stream"
};

function openDVRScanModal() {
  document.getElementById("dvr-scan-modal").classList.remove("hidden");
  switchDVRTab("scan");
}

function closeDVRScanModal() {
  document.getElementById("dvr-scan-modal").classList.add("hidden");
  stopQRScanner();
}

function switchDVRTab(tabName) {
  document.querySelectorAll(".dvr-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  document.querySelectorAll(".dvr-tab-content").forEach(content => {
    content.classList.toggle("active", content.id === `dvr-tab-${tabName}`);
  });

  if (tabName !== "scan") {
    stopQRScanner();
  }
}

async function startQRScanner() {
  const placeholder = document.getElementById("qr-reader-placeholder");
  if (placeholder) placeholder.classList.add("hidden");

  try {
    html5QrCode = new Html5Qrcode("qr-reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
      onQRCodeScanned,
      () => { }
    );
  } catch (error) {
    console.error("Error iniciando escaner QR:", error);
    showToast("No se pudo acceder a la cámara", "error");
    if (placeholder) placeholder.classList.remove("hidden");
  }
}

async function stopQRScanner() {
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
      html5QrCode = null;
    } catch (error) {
      console.error("Error deteniendo escaner:", error);
    }
  }

  const placeholder = document.getElementById("qr-reader-placeholder");
  if (placeholder) placeholder.classList.remove("hidden");

  const reader = document.getElementById("qr-reader");
  if (reader) reader.innerHTML = "";
}

function onQRCodeScanned(decodedText) {
  console.log("QR Escaneado:", decodedText);
  stopQRScanner();

  const dvrConfig = parseQRCode(decodedText);

  if (dvrConfig) {
    currentDVRConfig = dvrConfig;
    showDVRCameras(dvrConfig);
    showToast("DVR detectado: " + dvrConfig.name, "success");
  } else {
    showToast("Código QR no reconocido", "error");
    switchDVRTab("manual");
  }
}

function parseQRCode(qrText) {
  if (qrText.startsWith("HIKVISION://") || qrText.includes("hik")) {
    return parseHikvisionQR(qrText);
  }

  if (qrText.startsWith("{") || qrText.includes("dahua")) {
    return parseDahuaQR(qrText);
  }

  if (qrText.includes("xmeye") || qrText.includes("xm.")) {
    return parseXMEyeQR(qrText);
  }

  if (qrText.startsWith("rtsp://")) {
    return parseRTSPUrl(qrText);
  }

  try {
    const json = JSON.parse(qrText);
    return {
      brand: json.brand || json.type || "other",
      name: json.name || json.deviceName || "DVR",
      ip: json.ip || json.host || json.address,
      port: json.port || 554,
      username: json.user || json.username || "admin",
      password: json.pass || json.password || "",
      channels: json.channels || json.ch || 8,
      deviceId: json.deviceId || json.sn || null
    };
  } catch (e) { }

  const ipMatch = qrText.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (ipMatch) {
    return {
      brand: "other",
      name: "DVR",
      ip: ipMatch[1],
      port: 554,
      username: "admin",
      password: "",
      channels: 8
    };
  }

  return null;
}

function parseHikvisionQR(qrText) {
  const match = qrText.match(/HIKVISION:\/\/([^:]+):?(\d+)?\/?(.*)?/i) ||
    qrText.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):?(\d+)?/);

  if (match) {
    return {
      brand: "hikvision",
      name: match[3] || "Hikvision DVR",
      ip: match[1],
      port: parseInt(match[2]) || 554,
      username: "admin",
      password: "",
      channels: 8,
      deviceId: match[3] || null
    };
  }
  return null;
}

function parseDahuaQR(qrText) {
  try {
    const json = JSON.parse(qrText);
    return {
      brand: "dahua",
      name: json.Name || "Dahua DVR",
      ip: json.IP || json.Host,
      port: json.Port || 554,
      username: json.User || "admin",
      password: json.Password || "",
      channels: json.Channels || 8,
      deviceId: json.SN || null
    };
  } catch (e) {
    const ipMatch = qrText.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (ipMatch) {
      return {
        brand: "dahua",
        name: "Dahua DVR",
        ip: ipMatch[1],
        port: 554,
        username: "admin",
        password: "",
        channels: 8
      };
    }
  }
  return null;
}

function parseXMEyeQR(qrText) {
  const ipMatch = qrText.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  const portMatch = qrText.match(/:(\d{3,5})/);

  return {
    brand: "xmeye",
    name: "XMEye DVR",
    ip: ipMatch ? ipMatch[1] : "",
    port: portMatch ? parseInt(portMatch[1]) : 554,
    username: "admin",
    password: "",
    channels: 8
  };
}

function parseRTSPUrl(url) {
  const match = url.match(/rtsp:\/\/(?:([^:]+):([^@]+)@)?([^:\/]+):?(\d+)?\/(.*)/);

  if (match) {
    return {
      brand: "other",
      name: "DVR",
      ip: match[3],
      port: parseInt(match[4]) || 554,
      username: match[1] || "admin",
      password: match[2] || "",
      channels: 1,
      directUrl: url
    };
  }
  return null;
}

function updateDVRDefaults() {
  const brand = document.getElementById("dvr-brand").value;
  const template = DVR_RTSP_TEMPLATES[brand] || DVR_RTSP_TEMPLATES.other;
  document.getElementById("dvr-rtsp-template").value = template;
}

async function handleDVRManualConfig(event) {
  event.preventDefault();

  const config = {
    brand: document.getElementById("dvr-brand").value,
    name: document.getElementById("dvr-name").value.trim(),
    ip: document.getElementById("dvr-ip").value.trim(),
    port: parseInt(document.getElementById("dvr-port").value) || 554,
    username: document.getElementById("dvr-username").value.trim(),
    password: document.getElementById("dvr-password").value,
    channels: parseInt(document.getElementById("dvr-channels").value) || 8,
    rtspTemplate: document.getElementById("dvr-rtsp-template").value.trim() || DVR_RTSP_TEMPLATES[document.getElementById("dvr-brand").value],
    isRemote: false
  };

  if (!config.ip) {
    showToast("Ingresa la dirección IP del DVR", "warning");
    return;
  }

  currentDVRConfig = config;
  showDVRCameras(config);
}

// Manejo de configuración remota de DVR
function updateRemoteDVROptions() {
  const type = document.getElementById("dvr-remote-type").value;
  const ddnsGroup = document.getElementById("ddns-host-group");
  const p2pGroup = document.getElementById("p2p-serial-group");

  if (type === "ddns" || type === "direct-ip") {
    ddnsGroup.style.display = "block";
    p2pGroup.style.display = "none";
  } else {
    ddnsGroup.style.display = "none";
    p2pGroup.style.display = "block";
  }
}

async function handleDVRRemoteConfig(event) {
  event.preventDefault();

  const remoteType = document.getElementById("dvr-remote-type").value;
  const host = remoteType === "ddns" || remoteType === "direct-ip"
    ? document.getElementById("dvr-ddns-host").value.trim()
    : document.getElementById("dvr-p2p-serial").value.trim();

  const config = {
    brand: document.getElementById("dvr-remote-brand").value,
    name: document.getElementById("dvr-remote-name").value.trim(),
    ip: host,
    ddnsHost: host,
    port: parseInt(document.getElementById("dvr-remote-port-rtsp").value) || 554,
    httpPort: parseInt(document.getElementById("dvr-remote-port-http").value) || 80,
    username: document.getElementById("dvr-remote-username").value.trim(),
    password: document.getElementById("dvr-remote-password").value,
    channels: parseInt(document.getElementById("dvr-remote-channels").value) || 8,
    rtspTemplate: DVR_RTSP_TEMPLATES[document.getElementById("dvr-remote-brand").value],
    isRemote: true,
    remoteType: remoteType,
    p2pService: remoteType !== "ddns" && remoteType !== "direct-ip" ? remoteType : null
  };

  if (!host) {
    showToast("Ingresa el host DDNS o ID P2P", "warning");
    return;
  }

  currentDVRConfig = config;
  showDVRCameras(config);
}

async function testDVRConnection() {
  const ip = document.getElementById("dvr-ip").value.trim();
  const port = document.getElementById("dvr-port").value || 554;

  if (!ip) {
    showToast("Ingresa la dirección IP del DVR", "warning");
    return;
  }

  if (streamingSocket?.readyState === WebSocket.OPEN) {
    streamingSocket.send(JSON.stringify({
      type: "test-connection",
      ip: ip,
      port: port
    }));
    showToast("Solicitud de prueba enviada", "info");
  } else {
    showToast("Conecta primero al servidor de streaming", "warning");
  }
}

function showDVRCameras(config) {
  closeDVRScanModal();

  document.getElementById("dvr-cameras-title").textContent = `Cámaras de ${config.name}`;
  document.getElementById("dvr-info-name").textContent = config.name;
  document.getElementById("dvr-info-ip").textContent = config.ip + ":" + config.port;

  const connTypeBadge = document.getElementById("dvr-info-connection-type");
  if (connTypeBadge) {
    connTypeBadge.textContent = config.isRemote ? "Remoto" : "Local";
    connTypeBadge.className = config.isRemote ? "badge badge-remote" : "badge badge-online";
  }

  const grid = document.getElementById("dvr-cameras-grid");
  grid.innerHTML = "";
  selectedDVRCameras.clear();

  for (let i = 1; i <= config.channels; i++) {
    const item = document.createElement("div");
    item.className = "dvr-camera-item";
    item.dataset.channel = i;
    item.onclick = () => toggleDVRCameraSelection(item, i);

    item.innerHTML = `
      <div class="dvr-camera-checkbox">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div class="dvr-camera-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
          <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11"/>
          <rect x="2" y="7" width="14" height="10" rx="2"/>
        </svg>
      </div>
      <div class="dvr-camera-name">Canal ${i}</div>
      <div class="dvr-camera-channel">CH${i.toString().padStart(2, "0")}</div>
      <span class="dvr-camera-status online">Disponible</span>
    `;

    grid.appendChild(item);
  }

  document.getElementById("dvr-cameras-modal").classList.remove("hidden");
}

function toggleDVRCameraSelection(item, channel) {
  item.classList.toggle("selected");

  if (item.classList.contains("selected")) {
    selectedDVRCameras.add(channel);
  } else {
    selectedDVRCameras.delete(channel);
  }
}

function selectAllDVRCameras() {
  const items = document.querySelectorAll(".dvr-camera-item");
  const allSelected = selectedDVRCameras.size === items.length;

  items.forEach(item => {
    const channel = parseInt(item.dataset.channel);
    if (allSelected) {
      item.classList.remove("selected");
      selectedDVRCameras.delete(channel);
    } else {
      item.classList.add("selected");
      selectedDVRCameras.add(channel);
    }
  });
}

function closeDVRCamerasModal() {
  document.getElementById("dvr-cameras-modal").classList.add("hidden");
  currentDVRConfig = null;
  selectedDVRCameras.clear();
}

function generateRTSPUrl(config, channel) {
  if (config.directUrl) {
    return config.directUrl;
  }

  const template = config.rtspTemplate || DVR_RTSP_TEMPLATES[config.brand] || DVR_RTSP_TEMPLATES.other;
  const host = config.ddnsHost || config.ip;

  return template
    .replace(/{user}/g, config.username)
    .replace(/{pass}/g, config.password)
    .replace(/{ip}/g, host)
    .replace(/{port}/g, config.port)
    .replace(/{ch}/g, channel);
}

async function addSelectedDVRCameras() {
  if (selectedDVRCameras.size === 0) {
    showToast("Selecciona al menos una cámara", "warning");
    return;
  }

  const config = currentDVRConfig;
  let addedCount = 0;
  let savedToCloud = 0;

  for (const channel of selectedDVRCameras) {
    const rtspUrl = generateRTSPUrl(config, channel);

    const camera = {
      name: `${config.name} - Canal ${channel}`,
      location: config.name,
      stream_url: rtspUrl,
      snapshot_url: null,
      camera_username: config.username,
      camera_password: config.password,
      camera_brand: config.brand.charAt(0).toUpperCase() + config.brand.slice(1),
      resolution: "1080p",
      has_audio: true,
      has_mic: false,
      has_night_vision: true,
      is_recording: false,
      connection_type: config.isRemote ? "remote" : "webrtc",
      use_local_camera: false,
      dvr_ip: config.ip,
      dvr_channel: channel,
      ddns_url: config.ddnsHost || null,
      p2p_service: config.p2pService || null,
      is_online: true
    };

    try {
      await sbInsert("cameras", camera);
      addedCount++;
      savedToCloud++;
    } catch (error) {
      console.error("[DVR] Error guardando en Supabase:", error);
      camera.id = "local-dvr-" + Date.now() + "-ch" + channel;
      camera.created_at = new Date().toISOString();
      saveLocalCamera(camera);
      data.cameras.push(camera);
      addedCount++;
    }
  }

  closeDVRCamerasModal();
  await loadAllData();

  if (savedToCloud > 0) {
    showToast(`${savedToCloud} cámaras guardadas en la nube`, "success");
  }
  if (addedCount > savedToCloud) {
    showToast(`${addedCount - savedToCloud} cámaras guardadas localmente`, "warning");
  }
}
