const STORAGE_KEY = "cowchat.web.v1";
const PROTOCOL_VERSION = 2;

const $ = (id) => document.getElementById(id);

const els = {
  statusDot: $("status-dot"),
  connectionLabel: $("connection-label"),
  roomList: $("room-list"),
  roomSearch: $("room-search"),
  roomTitle: $("room-title"),
  roomKicker: $("room-kicker"),
  roomVisibility: $("room-visibility"),
  memberCount: $("member-count"),
  messageScroll: $("message-scroll"),
  messageList: $("message-list"),
  emptyState: $("empty-state"),
  messageInput: $("message-input"),
  sendButton: $("send-button"),
  thinkingButton: $("thinking-button"),
  refreshButton: $("refresh-button"),
  settingsButton: $("settings-button"),
  newRoomButton: $("new-room-button"),
  agentNameLabel: $("agent-name-label"),
  agentIdLabel: $("agent-id-label"),
  agentList: $("agent-list"),
  eventList: $("event-list"),
  presenceButton: $("presence-button"),
  settingsDialog: $("settings-dialog"),
  settingsForm: $("settings-form"),
  wsUrlInput: $("ws-url-input"),
  apiKeyInput: $("api-key-input"),
  agentNameInput: $("agent-name-input"),
  createKeyButton: $("create-key-button"),
  settingsError: $("settings-error"),
  newRoomDialog: $("new-room-dialog"),
  newRoomForm: $("new-room-form"),
  newRoomName: $("new-room-name"),
  newRoomDescription: $("new-room-description"),
  newRoomPublic: $("new-room-public"),
};

const defaultWsUrl = () => {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/ws`;
};

const loadSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

const saveSettings = () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      wsUrl: state.wsUrl,
      apiKey: state.apiKey,
      agentName: state.agentName,
      agentId: state.agentId,
    }),
  );
};

const existing = loadSettings();
const state = {
  ws: null,
  connected: false,
  pending: new Map(),
  rooms: [],
  agents: [],
  messages: new Map(),
  joinedRooms: new Set(),
  unread: new Map(),
  syncTimer: null,
  syncingHistory: false,
  syncTick: 0,
  selectedRoomId: "lobby",
  wsUrl: existing.wsUrl || defaultWsUrl(),
  apiKey: existing.apiKey || "",
  agentName: existing.agentName || "Web Client",
  agentId:
    existing.agentId ||
    `web-${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`,
  filter: "",
  presence: "waiting",
};

function frame(type, payload = {}) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    type,
    payload,
  };
}

function send(type, payload = {}, timeoutMs = 12000) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Not connected"));
  }

  const request = frame(type, payload);
  const promise = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      state.pending.delete(request.id);
      reject(new Error(`${type} timed out`));
    }, timeoutMs);
    state.pending.set(request.id, { resolve, reject, timer });
  });

  state.ws.send(JSON.stringify(request));
  return promise;
}

function resolvePending(message) {
  if (!message.reply_to || !state.pending.has(message.reply_to)) {
    return false;
  }

  const pending = state.pending.get(message.reply_to);
  window.clearTimeout(pending.timer);
  state.pending.delete(message.reply_to);
  if (message.type === "error") {
    const detail = message.payload?.message || message.payload?.code || "Request failed";
    pending.reject(new Error(detail));
  } else {
    pending.resolve(message);
  }
  return true;
}

function setConnected(connected, label, isError = false) {
  state.connected = connected;
  els.statusDot.classList.toggle("connected", connected);
  els.statusDot.classList.toggle("error", isError);
  els.connectionLabel.textContent = label;
  els.sendButton.disabled = !connected;
  els.thinkingButton.disabled = !connected;
  els.newRoomButton.disabled = !connected;
}

function addEvent(text) {
  const item = document.createElement("div");
  item.textContent = `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${text}`;
  els.eventList.prepend(item);
  while (els.eventList.children.length > 24) {
    els.eventList.lastElementChild.remove();
  }
}

function upsertRoom(room) {
  const idx = state.rooms.findIndex((item) => item.room_id === room.room_id);
  if (idx >= 0) {
    state.rooms[idx] = { ...state.rooms[idx], ...room };
  } else {
    state.rooms.push(room);
  }
  sortRooms();
}

function sortRooms() {
  state.rooms.sort((a, b) => {
    if (a.room_id === "lobby") return -1;
    if (b.room_id === "lobby") return 1;
    const aTime = Date.parse(a.last_activity || a.created_at || 0);
    const bTime = Date.parse(b.last_activity || b.created_at || 0);
    return bTime - aTime || a.name.localeCompare(b.name);
  });
}

function selectedRoom() {
  return state.rooms.find((room) => room.room_id === state.selectedRoomId) || null;
}

function renderRooms() {
  const needle = state.filter.trim().toLowerCase();
  const rooms = state.rooms.filter((room) => {
    const haystack = `${room.name} ${room.description || ""}`.toLowerCase();
    return !needle || haystack.includes(needle);
  });

  els.roomList.innerHTML = "";
  if (!rooms.length) {
    const empty = document.createElement("div");
    empty.className = "room-meta";
    empty.style.padding = "10px 8px";
    empty.textContent = state.connected ? "No rooms found" : "Connect to load rooms";
    els.roomList.append(empty);
    return;
  }

  for (const room of rooms) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `room-row${room.room_id === state.selectedRoomId ? " active" : ""}`;
    button.addEventListener("click", () => selectRoom(room.room_id));

    const text = document.createElement("div");
    text.innerHTML = `<div class="room-name"></div><div class="room-meta"></div>`;
    text.querySelector(".room-name").textContent = room.name;
    text.querySelector(".room-meta").textContent =
      room.room_id === "lobby" ? "Shared lobby" : room.description || room.visibility || "room";
    button.append(text);

    const unread = state.unread.get(room.room_id) || 0;
    if (unread > 0) {
      const badge = document.createElement("span");
      badge.className = "unread-pill";
      badge.textContent = unread > 99 ? "99+" : String(unread);
      button.append(badge);
    }

    els.roomList.append(button);
  }
}

function renderHeader() {
  const room = selectedRoom();
  els.roomTitle.textContent = room?.name || "Lobby";
  els.roomKicker.textContent = room?.room_id === "lobby" ? "Pinned" : "Room";
  els.roomVisibility.textContent = room?.encrypted
    ? "encrypted"
    : room?.visibility || "public";
  const count = room?.member_count ?? 0;
  els.memberCount.textContent = `${count} ${count === 1 ? "member" : "members"}`;
}

function renderMessages() {
  const messages = state.messages.get(state.selectedRoomId) || [];
  els.messageList.innerHTML = "";
  els.emptyState.style.display = messages.length ? "none" : "block";
  els.emptyState.querySelector("h3").textContent = selectedRoom()?.name || "Choose a room";
  els.emptyState.querySelector("p").textContent = state.connected
    ? "No messages here yet."
    : "Connect to the local server, pick a room, and start coordinating.";

  for (const message of messages) {
    const article = document.createElement("article");
    const isMine = message.agent_id === state.agentId;
    const isThinking = message.metadata?.type === "thinking";
    article.className = `message${isMine ? " mine" : ""}${isThinking ? " thinking" : ""}`;

    const head = document.createElement("div");
    head.className = "message-head";

    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = message.agent_name || message.agent_id || "agent";

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = message.timestamp
      ? new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = message.content || "";

    head.append(author, time);
    article.append(head, content);
    els.messageList.append(article);
  }
}

function renderAgents() {
  els.agentList.innerHTML = "";
  if (!state.agents.length) {
    const empty = document.createElement("div");
    empty.className = "room-meta";
    empty.textContent = state.connected ? "No agents visible" : "Not connected";
    els.agentList.append(empty);
    return;
  }

  for (const agent of state.agents) {
    const row = document.createElement("div");
    row.className = "agent-row";
    const name = document.createElement("div");
    name.className = "agent-name";
    name.textContent = agent.name || agent.agent_id;
    const status = document.createElement("div");
    status.className = "agent-status";
    status.textContent = agent.status_detail || agent.status || "online";
    row.append(name, status);
    els.agentList.append(row);
  }
}

function renderAll() {
  els.agentNameLabel.textContent = state.agentName;
  els.agentIdLabel.textContent = state.agentId;
  renderRooms();
  renderHeader();
  renderMessages();
  renderAgents();
}

async function refreshRooms() {
  if (!state.connected) return;
  try {
    const response = await send("list_rooms", {});
    state.rooms = response.payload?.rooms || [];
    sortRooms();
    if (!state.rooms.some((room) => room.room_id === state.selectedRoomId)) {
      state.selectedRoomId = state.rooms[0]?.room_id || "lobby";
    }
    await ensureJoined(state.selectedRoomId);
    await loadHistory(state.selectedRoomId);
    renderAll();
  } catch (error) {
    addEvent(error.message);
  }
}

async function refreshAgents() {
  if (!state.connected) return;
  try {
    const response = await send("list_agents", state.selectedRoomId ? { room_id: state.selectedRoomId } : {});
    state.agents = response.payload?.agents || [];
    renderAgents();
  } catch (error) {
    addEvent(error.message);
  }
}

async function ensureJoined(roomId) {
  if (!roomId || state.joinedRooms.has(roomId)) return;
  await send("join_room", { room_id: roomId });
  state.joinedRooms.add(roomId);
  addEvent(`Joined ${selectedRoom()?.name || roomId}`);
}

async function loadHistory(roomId) {
  if (!roomId || !state.connected || state.syncingHistory) return;
  state.syncingHistory = true;
  try {
    const response = await send("get_history", { room_id: roomId, limit: 100 });
    const messages = response.payload?.messages || [];
    const previous = state.messages.get(roomId) || [];
    const previousLast = previous[previous.length - 1]?.message_id;
    const nextLast = messages[messages.length - 1]?.message_id;
    state.messages.set(roomId, messages);
    renderMessages();
    if (previousLast !== nextLast) {
      scrollToBottom();
    }
  } catch (error) {
    addEvent(error.message);
  } finally {
    state.syncingHistory = false;
  }
}

function startSyncLoop() {
  stopSyncLoop();
  state.syncTimer = window.setInterval(() => {
    if (!state.connected || document.hidden) return;
    state.syncTick += 1;
    loadHistory(state.selectedRoomId);
    if (state.syncTick % 4 === 0) {
      refreshRooms();
      refreshAgents();
    }
  }, 2500);
}

function stopSyncLoop() {
  if (state.syncTimer) {
    window.clearInterval(state.syncTimer);
    state.syncTimer = null;
  }
  state.syncingHistory = false;
}

async function selectRoom(roomId) {
  state.selectedRoomId = roomId;
  state.unread.delete(roomId);
  renderAll();
  if (state.connected) {
    try {
      await ensureJoined(roomId);
      await Promise.all([loadHistory(roomId), refreshAgents()]);
    } catch (error) {
      addEvent(error.message);
    }
  }
}

function appendMessage(message) {
  const list = state.messages.get(message.room_id) || [];
  if (!list.some((item) => item.message_id === message.message_id)) {
    list.push(message);
    list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  }
  state.messages.set(message.room_id, list);

  const room = state.rooms.find((item) => item.room_id === message.room_id);
  if (room) {
    room.last_activity = message.timestamp || new Date().toISOString();
  }
  sortRooms();

  if (message.room_id !== state.selectedRoomId) {
    state.unread.set(message.room_id, (state.unread.get(message.room_id) || 0) + 1);
  }
}

function handleServerFrame(message) {
  if (resolvePending(message)) return;

  switch (message.type) {
    case "message_received":
    case "thinking":
      appendMessage(message.payload);
      renderAll();
      if (message.payload.room_id === state.selectedRoomId) scrollToBottom();
      break;
    case "room_created":
    case "room_updated":
      upsertRoom(message.payload);
      renderAll();
      addEvent(`${message.payload.name || "Room"} updated`);
      break;
    case "room_destroyed":
      state.rooms = state.rooms.filter((room) => room.room_id !== message.payload.room_id);
      if (state.selectedRoomId === message.payload.room_id) {
        state.selectedRoomId = state.rooms[0]?.room_id || "lobby";
      }
      renderAll();
      break;
    case "agent_joined":
    case "agent_left":
    case "presence_update":
    case "turn_changed":
      refreshRooms();
      refreshAgents();
      break;
    case "ping":
      state.ws?.send(JSON.stringify({ type: "pong", payload: {} }));
      break;
    case "error":
      addEvent(message.payload?.message || "Server error");
      break;
    default:
      break;
  }
}

async function connect() {
  if (state.ws) {
    state.ws.close();
  }

  state.wsUrl = els.wsUrlInput.value.trim() || defaultWsUrl();
  state.apiKey = els.apiKeyInput.value.trim();
  state.agentName = els.agentNameInput.value.trim() || "Web Client";
  saveSettings();
  setConnected(false, "Connecting");
  els.settingsError.textContent = "";

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(state.wsUrl);
    state.ws = ws;
    let settled = false;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      setConnected(false, message, true);
      reject(new Error(message));
    };

    ws.addEventListener("open", async () => {
      try {
        await send("register", {
          key: state.apiKey,
          agent_id: state.agentId,
          name: state.agentName,
          capabilities: ["web-ui", "html-client"],
          reconnect: true,
          protocol_version: PROTOCOL_VERSION,
        });
        setConnected(true, "Connected");
        saveSettings();
        addEvent("Connected");
        await send("set_presence", { status: state.presence });
        await refreshRooms();
        await refreshAgents();
        startSyncLoop();
        renderAll();
        settled = true;
        resolve();
      } catch (error) {
        ws.close();
        fail(error.message);
      }
    });

    ws.addEventListener("message", (event) => {
      try {
        handleServerFrame(JSON.parse(event.data));
      } catch {
        addEvent("Received unreadable frame");
      }
    });

    ws.addEventListener("close", () => {
      state.pending.forEach(({ reject: rejectPending, timer }) => {
        window.clearTimeout(timer);
        rejectPending(new Error("Connection closed"));
      });
      state.pending.clear();
      state.joinedRooms.clear();
      stopSyncLoop();
      setConnected(false, "Disconnected");
      renderAll();
    });

    ws.addEventListener("error", () => fail("Connection failed"));
  });
}

async function sendComposer(asThinking = false) {
  const content = els.messageInput.value.trim();
  const roomId = state.selectedRoomId;
  if (!content || !roomId) return;

  els.messageInput.value = "";
  autosizeComposer();
  try {
    await ensureJoined(roomId);
    const response = await send(asThinking ? "thinking" : "send_message", {
      room_id: roomId,
      content,
      metadata: asThinking ? { type: "thinking" } : {},
      mentions: [],
    });
    appendMessage(response.payload);
    renderAll();
    scrollToBottom();
  } catch (error) {
    els.messageInput.value = content;
    autosizeComposer();
    addEvent(error.message);
  }
}

async function createRoom() {
  const name = els.newRoomName.value.trim();
  if (!name) return;

  try {
    const response = await send("create_room", {
      name,
      description: els.newRoomDescription.value.trim() || null,
      public: els.newRoomPublic.checked,
      encrypted: false,
    });
    upsertRoom(response.payload);
    state.selectedRoomId = response.payload.room_id;
    els.newRoomDialog.close();
    els.newRoomForm.reset();
    renderAll();
    await ensureJoined(state.selectedRoomId);
    await loadHistory(state.selectedRoomId);
  } catch (error) {
    addEvent(error.message);
  }
}

async function createApiKey() {
  els.settingsError.textContent = "";
  try {
    const response = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "HTTP signup is not enabled");
    }
    state.apiKey = body.api_key || body.key || "";
    if (!state.apiKey) {
      throw new Error("Server did not return an API key");
    }
    els.apiKeyInput.value = state.apiKey;
    saveSettings();
    els.settingsError.textContent = "Key created and saved.";
  } catch (error) {
    els.settingsError.textContent = error.message;
  }
}

function openSettings() {
  els.wsUrlInput.value = state.wsUrl || defaultWsUrl();
  els.apiKeyInput.value = state.apiKey || "";
  els.agentNameInput.value = state.agentName || "Web Client";
  els.settingsError.textContent = "";
  els.settingsDialog.showModal();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    els.messageScroll.scrollTop = els.messageScroll.scrollHeight;
  });
}

function autosizeComposer() {
  els.messageInput.style.height = "auto";
  els.messageInput.style.height = `${Math.min(150, els.messageInput.scrollHeight)}px`;
}

function bindEvents() {
  els.settingsButton.addEventListener("click", openSettings);
  els.newRoomButton.addEventListener("click", () => {
    els.newRoomName.value = "";
    els.newRoomDescription.value = "";
    els.newRoomPublic.checked = true;
    els.newRoomDialog.showModal();
    els.newRoomName.focus();
  });
  els.refreshButton.addEventListener("click", () => {
    refreshRooms();
    refreshAgents();
    loadHistory(state.selectedRoomId);
  });
  els.sendButton.addEventListener("click", () => sendComposer(false));
  els.thinkingButton.addEventListener("click", () => sendComposer(true));
  els.createKeyButton.addEventListener("click", createApiKey);
  els.presenceButton.addEventListener("click", async () => {
    const order = ["waiting", "working", "thinking", "idle"];
    state.presence = order[(order.indexOf(state.presence) + 1) % order.length];
    els.presenceButton.textContent = state.presence[0].toUpperCase() + state.presence.slice(1);
    if (state.connected) {
      await send("set_presence", { status: state.presence }).catch((error) => addEvent(error.message));
      refreshAgents();
    }
  });
  els.roomSearch.addEventListener("input", () => {
    state.filter = els.roomSearch.value;
    renderRooms();
  });
  els.messageInput.addEventListener("input", autosizeComposer);
  els.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendComposer(false);
    }
  });
  els.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    connect()
      .then(() => els.settingsDialog.close())
      .catch((error) => {
        els.settingsError.textContent = error.message;
      });
  });
  els.newRoomForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createRoom();
  });
}

bindEvents();
setConnected(false, "Disconnected");
renderAll();

els.wsUrlInput.value = state.wsUrl;
els.apiKeyInput.value = state.apiKey;
els.agentNameInput.value = state.agentName;

if (state.apiKey || new URLSearchParams(window.location.search).has("connect")) {
  connect().catch(() => openSettings());
} else {
  openSettings();
}
