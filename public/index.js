/* ====================================================================
   T-Gram Client — index.js (LENGKAP)
   ==================================================================== */

// ==================== STATE ====================
let token = localStorage.getItem('tgram_token') || null;
let currentUser = null;
let currentChat = null;
let chatMessages = {};
let helperBotMessages = [];
let announcementBotMessages = [];
let groupMembersTemp = [];
let socket = null;

// ==================== API HELPER ====================
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

async function apiUpload(path, file) {
  const fd = new FormData();
  fd.append('photo', file);
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: fd
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// ==================== UI HELPERS ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function showToast(msg, dur) {
  dur = dur || 3000;
  const t = $('#toast');
  t.textContent = msg;
  show(t);
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { hide(t); }, dur);
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#f44336','#e91e63','#9c27b0','#673ab7','#2196f3',
    '#00bcd4','#009688','#4caf50','#8bc34a','#ff9800','#ff5722','#795548'
  ];
  return colors[Math.abs(hash) % colors.length];
}

function renderAvatar(name, photo, size) {
  size = size || 40;
  if (photo) {
    return '<div class="avatar" style="width:' + size + 'px;height:' + size + 'px">' +
      '<img src="' + photo + '" alt="' + name + '">' +
    '</div>';
  }
  const color = getAvatarColor(name);
  const initial = name.charAt(0).toUpperCase();
  return '<div class="avatar" style="width:' + size + 'px;height:' + size + 'px;background:' + color + ';font-size:' + Math.round(size * 0.4) + 'px">' + initial + '</div>';
}

function renderBadge(badge) {
  if (!badge) return '';
  let cls = 'badge';
  if (badge === 'Dev jir') cls += ' badge-admin';
  else if (badge === 'Pretty Girl') cls += ' badge-girl';
  else cls += ' badge-admin';
  return '<span class="' + cls + '">' + badge + '</span>';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ==================== AUTH ====================
function setupAuthTabs() {
  $$('.auth-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      $$('.auth-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      const target = tab.dataset.tab;
      if (target === 'login') {
        show($('#loginForm'));
        hide($('#registerForm'));
      } else {
        hide($('#loginForm'));
        show($('#registerForm'));
      }
      hide($('#authError'));
    });
  });
}

function showAuthError(msg) {
  const el = $('#authError');
  el.textContent = msg;
  show(el);
}

async function handleLogin(e) {
  e.preventDefault();
  const username = $('#loginUser').value.trim();
  const password = $('#loginPass').value;
  try {
    const data = await api('POST', '/login', { username: username, password: password });
    token = data.token;
    localStorage.setItem('tgram_token', token);
    currentUser = data;
    enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = $('#regUser').value.trim();
  const password = $('#regPass').value;
  const confirm = $('#regPassConfirm').value;
  if (password !== confirm) return showAuthError('Password tidak cocok');
  try {
    const data = await api('POST', '/register', { username: username, password: password });
    token = data.token;
    localStorage.setItem('tgram_token', token);
    currentUser = data;
    enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
}

// ==================== ENTER APP ====================
async function enterApp() {
  hide($('#authPage'));
  hide($('#banPage'));
  show($('#mainPage'));

  // Socket
  socket = io();
  socket.emit('authenticate', currentUser.username);

  socket.on('newMessage', function(msg) {
    if (currentChat && currentChat.type === 'private') {
      if (
        (msg.from === currentChat.id && msg.to === currentUser.username) ||
        (msg.to === currentChat.id && msg.from === currentUser.username)
      ) {
        appendMessage(msg);
        scrollToBottom();
      }
    }
    loadChatList();
  });

  socket.on('groupMessage', function(data) {
    if (currentChat && currentChat.type === 'group' && currentChat.id === data.groupId) {
      appendMessage(data.message);
      scrollToBottom();
    }
    loadChatList();
  });

  socket.on('chatUpdate', function() {
    loadChatList();
  });

  socket.on('announcement', function(ann) {
    showToast('Pengumuman: ' + ann.text, 5000);
    if (currentChat && currentChat.type === 'bot' && currentChat.id === 'announcement-bot') {
      appendBotMessage(ann);
      scrollToBottom();
    }
  });

  updateSettingsUI();
  loadChatList();
}

// ==================== CHAT LIST ====================
async function loadChatList() {
  try {
    const chats = await api('GET', '/chats');
    const list = $('#chatList');
    list.innerHTML = '';

    if (chats.length === 0) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-secondary);font-size:13px">' +
        'Belum ada chat. Cari username untuk mulai chat.</div>';
      return;
    }

    chats.forEach(function(chat) {
      const item = document.createElement('div');
      item.className = 'chat-item' + (currentChat && currentChat.id === chat.id ? ' active' : '');
      item.dataset.type = chat.type;
      item.dataset.id = chat.id;

      let avatarHTML = '';
      if (chat.type === 'private') {
        avatarHTML = renderAvatar(chat.username || chat.name, chat.profilePhoto, 48);
      } else if (chat.type === 'group') {
        avatarHTML = '<div class="avatar" style="width:48px;height:48px;background:var(--accent);font-size:18px"><i class="fa-solid fa-users" style="color:#fff"></i></div>';
      } else if (chat.type === 'bot') {
        avatarHTML = '<div class="avatar" style="width:48px;height:48px;background:#6366f1;font-size:18px"><i class="fa-solid fa-robot" style="color:#fff"></i></div>';
      }

      let nameRow = '';
      if (chat.badge) {
        nameRow = '<span class="chat-item-name">' + escapeHtml(chat.name || chat.id) + ' ' + renderBadge(chat.badge) + '</span>';
      } else {
        nameRow = '<span class="chat-item-name">' + escapeHtml(chat.name || chat.id) + '</span>';
      }

      item.innerHTML =
        '<div class="chat-item-avatar">' + avatarHTML + '</div>' +
        '<div class="chat-item-info">' +
          nameRow +
          '<div class="chat-item-last">' + escapeHtml(chat.lastMessage || '') + '</div>' +
        '</div>' +
        '<div class="chat-item-time">' + (chat.lastTime ? formatTime(chat.lastTime) : '') + '</div>';

      item.addEventListener('click', function() { openChat(chat); });
      list.appendChild(item);
    });
  } catch (err) {
    console.error('Load chat list error:', err);
  }
}

// ==================== OPEN CHAT ====================
async function openChat(chat) {
  currentChat = chat;
  hide($('#welcomeScreen'));
  show($('#activeChat'));

  // Header
  let avatarHTML = '';
  if (chat.type === 'private') {
    avatarHTML = renderAvatar(chat.username || chat.name, chat.profilePhoto, 40);
    $('#chatName').textContent = chat.name || chat.id;
    show($('#e2eInfo'));
    hide($('#botInfo'));
    hide($('#chatInfoBtn'));
    $('#chatStatus').textContent = '@' + (chat.username || chat.id);
    if (chat.badge) {
      $('#chatBadge').innerHTML = renderBadge(chat.badge);
      show($('#chatBadge'));
    } else {
      hide($('#chatBadge'));
    }
  } else if (chat.type === 'group') {
    avatarHTML = '<div class="avatar" style="width:40px;height:40px;background:var(--accent);font-size:16px"><i class="fa-solid fa-users" style="color:#fff"></i></div>';
    $('#chatName').textContent = chat.name;
    hide($('#e2eInfo'));
    hide($('#botInfo'));
    show($('#chatInfoBtn'));
    hide($('#chatBadge'));
    try {
      const g = await api('GET', '/groups/' + chat.id);
      $('#chatStatus').textContent = g.members.length + ' member';
    } catch(e) { $('#chatStatus').textContent = 'Grup'; }
  } else if (chat.type === 'bot') {
    avatarHTML = '<div class="avatar" style="width:40px;height:40px;background:#6366f1;font-size:16px"><i class="fa-solid fa-robot" style="color:#fff"></i></div>';
    $('#chatName').textContent = chat.name;
    hide($('#e2eInfo'));
    show($('#botInfo'));
    hide($('#chatInfoBtn'));
    hide($('#chatBadge'));
    $('#chatStatus').textContent = 'Bot';
    if (chat.id === 'helper-bot') {
      $('#botInfoText').textContent = 'Perintah: /ban (user), /unban (user), /alluser';
    } else {
      $('#botInfoText').textContent = 'Perintah: /cfd (text) — kirim pengumuman ke semua member';
    }
  }

  $('#chatAvatar').innerHTML = avatarHTML;

  // Load messages
  const container = $('#messagesContainer');
  container.innerHTML = '';

  if (chat.type === 'private') {
    try {
      const msgs = await api('GET', '/messages/' + chat.id);
      chatMessages[chat.id] = msgs;
      msgs.forEach(function(m) { appendMessage(m); });
    } catch(e) { chatMessages[chat.id] = []; }
  } else if (chat.type === 'group') {
    try {
      const msgs = await api('GET', '/groups/' + chat.id + '/messages');
      chatMessages[chat.id] = msgs;
      msgs.forEach(function(m) { appendMessage(m); });
    } catch(e) { chatMessages[chat.id] = []; }
  } else if (chat.type === 'bot') {
    if (chat.id === 'helper-bot') {
      if (helperBotMessages.length === 0) {
        helperBotMessages.push({
          from: 'Helper Bot',
          text: 'Halo admin! Saya Helper Bot. Perintah yang tersedia:\n/ban (username) — Ban user berbasis IP\n/unban (username) — Unban user\n/alluser — Lihat semua akun terdaftar',
          timestamp: Date.now()
        });
      }
      helperBotMessages.forEach(function(m) { appendBotMessage(m); });
    } else {
      try {
        const anns = await api('GET', '/announcements');
        announcementBotMessages = anns.slice();
        if (announcementBotMessages.length === 0) {
          announcementBotMessages.push({
            from: 'Announcement Bot',
            text: 'Halo admin! Gunakan /cfd (text) untuk mengirim pengumuman ke semua member.',
            timestamp: Date.now()
          });
        }
        announcementBotMessages.forEach(function(m) { appendBotMessage(m); });
      } catch(e) {
        announcementBotMessages.push({
          from: 'Announcement Bot',
          text: 'Gunakan /cfd (text) untuk mengirim pengumuman.',
          timestamp: Date.now()
        });
        announcementBotMessages.forEach(function(m) { appendBotMessage(m); });
      }
    }
  }

  scrollToBottom();
  loadChatList();

  // Mobile
  if (window.innerWidth <= 768) {
    $('#sidebar').classList.add('mobile-hidden');
  }
}

// ==================== MESSAGES RENDER ====================
function appendMessage(msg) {
  const container = $('#messagesContainer');
  const isSent = msg.from === currentUser.username;
  const row = document.createElement('div');
  row.className = 'message-row ' + (isSent ? 'sent' : 'received');

  let content = '';

  // Di grup, tampilkan pengirim
  if (currentChat && currentChat.type === 'group' && !isSent) {
    content += '<div class="message-sender">' + escapeHtml(msg.from) + '</div>';
  }

  if (msg.type === 'image') {
    content += '<img src="' + msg.text + '" alt="Foto" loading="lazy" style="max-width:100%;max-height:300px;border-radius:8px;display:block;margin-bottom:4px">';
  } else if (msg.type === 'announcement') {
    content += '<div style="font-weight:600;color:var(--accent);margin-bottom:4px">Pengumuman</div>' + escapeHtml(msg.text);
  } else {
    // Handle newlines
    content += escapeHtml(msg.text).replace(/\n/g, '<br>');
  }

  content += '<div class="message-time">' + formatTime(msg.timestamp) + '</div>';

  row.innerHTML = '<div class="message-bubble">' + content + '</div>';
  container.appendChild(row);
}

function appendBotMessage(msg) {
  const container = $('#messagesContainer');
  const isSent = msg.from === currentUser.username || msg.from === 'me';
  const row = document.createElement('div');
  row.className = 'message-row ' + (isSent ? 'sent' : 'received');

  let content = '';
  if (msg.type === 'announcement') {
    content += '<div style="font-weight:600;color:var(--accent);margin-bottom:4px">Pengumuman</div>';
  }
  content += escapeHtml(msg.text).replace(/\n/g, '<br>');
  content += '<div class="message-time">' + formatTime(msg.timestamp) + '</div>';

  row.innerHTML = '<div class="message-bubble">' + content + '</div>';
  container.appendChild(row);
}

function scrollToBottom() {
  const c = $('#messagesContainer');
  setTimeout(function() { c.scrollTop = c.scrollHeight; }, 50);
}

// ==================== SEND MESSAGE ====================
async function sendMessage() {
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text || !currentChat) return;

  input.value = '';

  if (currentChat.type === 'bot') {
    await handleBotCommand(text);
    return;
  }

  try {
    if (currentChat.type === 'private') {
      const msg = await api('POST', '/messages', { to: currentChat.id, text: text });
      appendMessage(msg);
      scrollToBottom();
    } else if (currentChat.type === 'group') {
      const msg = await api('POST', '/groups/message', { groupId: currentChat.id, text: text });
      appendMessage(msg);
      scrollToBottom();
    }
  } catch (err) {
    showToast('Gagal kirim: ' + err.message);
  }
}

// ==================== BOT COMMANDS ====================
async function handleBotCommand(text) {
  if (!currentChat || currentChat.type !== 'bot') return;

  // Tampilkan pesan user
  const userMsg = { from: 'me', text: text, timestamp: Date.now() };
  if (currentChat.id === 'helper-bot') helperBotMessages.push(userMsg);
  else announcementBotMessages.push(userMsg);
  appendBotMessage(userMsg);
  scrollToBottom();

  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  try {
    if (currentChat.id === 'helper-bot') {
      if (cmd === '/ban' && arg) {
        const res = await api('POST', '/ban', { username: arg });
        const botMsg = { from: 'Helper Bot', text: res.message, timestamp: Date.now() };
        helperBotMessages.push(botMsg);
        appendBotMessage(botMsg);
      } else if (cmd === '/unban' && arg) {
        const res = await api('POST', '/unban', { username: arg });
        const botMsg = { from: 'Helper Bot', text: res.message, timestamp: Date.now() };
        helperBotMessages.push(botMsg);
        appendBotMessage(botMsg);
      } else if (cmd === '/alluser') {
        const users = await api('GET', '/allusers');
        let listText = 'Daftar Akun Terdaftar:\n';
        users.forEach(function(u) {
          const status = u.banned ? ' [BANNED]' : '';
          listText += '\u2022 @' + u.username + ' (' + u.displayName + ') [' + u.role + ']' + status + '\n';
        });
        const botMsg = { from: 'Helper Bot', text: listText, timestamp: Date.now() };
        helperBotMessages.push(botMsg);
        appendBotMessage(botMsg);
      } else {
        const botMsg = {
          from: 'Helper Bot',
          text: 'Perintah tidak dikenali. Gunakan:\n/ban (username) — Ban user berbasis IP\n/unban (username) — Unban user\n/alluser — Lihat semua akun',
          timestamp: Date.now()
        };
        helperBotMessages.push(botMsg);
        appendBotMessage(botMsg);
      }
    } else if (currentChat.id === 'announcement-bot') {
      if (cmd === '/cfd' && arg) {
        const res = await api('POST', '/announce', { text: arg });
        const botMsg = {
          from: 'Announcement Bot',
          text: 'Pengumuman berhasil dikirim ke semua member!',
          type: 'announcement',
          timestamp: Date.now()
        };
        announcementBotMessages.push(botMsg);
        appendBotMessage(botMsg);
      } else {
        const botMsg = {
          from: 'Announcement Bot',
          text: 'Gunakan: /cfd (text) untuk mengirim pengumuman ke semua member.',
          timestamp: Date.now()
        };
        announcementBotMessages.push(botMsg);
        appendBotMessage(botMsg);
      }
    }
  } catch (err) {
    const botMsg = { from: 'Bot', text: 'Error: ' + err.message, timestamp: Date.now() };
    appendBotMessage(botMsg);
  }

  scrollToBottom();
}

// ==================== SEND PHOTO ====================
async function sendChatPhoto(file) {
  if (!currentChat || currentChat.type === 'bot') {
    return showToast('Tidak bisa kirim foto ke bot');
  }

  try {
    const data = await apiUpload('/upload', file);
    if (currentChat.type === 'private') {
      const msg = await api('POST', '/messages', {
        to: currentChat.id, text: data.url, type: 'image'
      });
      appendMessage(msg);
    } else if (currentChat.type === 'group') {
      const msg = await api('POST', '/groups/message', {
        groupId: currentChat.id, text: data.url, type: 'image'
      });
      appendMessage(msg);
    }
    scrollToBottom();
  } catch (err) {
    showToast('Gagal kirim foto: ' + err.message);
  }
}

// ==================== SEARCH ====================
let searchTimer = null;

async function handleSearch(query) {
  const resultsEl = $('#searchResults');
  if (!query.trim()) {
    hide(resultsEl);
    return;
  }

  try {
    const results = await api('GET', '/search?q=' + encodeURIComponent(query));
    if (results.length === 0) {
      resultsEl.innerHTML = '<div style="padding:12px;color:var(--text-secondary);font-size:13px">Tidak ditemukan</div>';
    } else {
      let html = '';
      results.forEach(function(u) {
        html += '<div class="search-result-item" data-username="' + u.username + '">' +
          renderAvatar(u.username, u.profilePhoto, 36) +
          '<div>' +
            '<div class="search-result-name">' + escapeHtml(u.displayName) + ' ' + renderBadge(u.badge) + '</div>' +
            '<div class="search-result-username">@' + escapeHtml(u.username) + '</div>' +
          '</div>' +
        '</div>';
      });
      resultsEl.innerHTML = html;

      resultsEl.querySelectorAll('.search-result-item').forEach(function(item) {
        item.addEventListener('click', function() {
          const username = item.dataset.username;
          const u = results.find(function(r) { return r.username === username; });
          openChat({
            type: 'private',
            id: username,
            name: u.displayName,
            username: u.username,
            badge: u.badge,
            profilePhoto: u.profilePhoto
          });
          $('#searchInput').value = '';
          hide(resultsEl);
        });
      });
    }
    show(resultsEl);
  } catch(e) {
    hide(resultsEl);
  }
}

// ==================== GROUPS ====================
function openGroupModal() {
  groupMembersTemp = [];
  $('#groupMembersList').innerHTML = '';
  $('#groupNameInput').value = '';
  show($('#groupModal'));
}

function closeGroupModal() {
  hide($('#groupModal'));
}

function addGroupMemberTemp() {
  const input = $('#addMemberInput');
  const username = input.value.trim();
  if (!username) return;
  if (groupMembersTemp.includes(username)) return showToast('Sudah ditambahkan');
  groupMembersTemp.push(username);
  renderGroupMembersTemp();
  input.value = '';
}

function removeGroupMemberTemp(username) {
  groupMembersTemp = groupMembersTemp.filter(function(m) { return m !== username; });
  renderGroupMembersTemp();
  }

function renderGroupMembersTemp() {
  const el = $('#groupMembersList');
  let html = '';
  groupMembersTemp.forEach(function(m) {
    html += '<span class="member-tag">@' + escapeHtml(m) +
      ' <span class="member-tag-remove" data-member="' + m + '"><i class="fa-solid fa-xmark"></i></span></span>';
  });
  el.innerHTML = html;
  el.querySelectorAll('.member-tag-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      removeGroupMemberTemp(btn.dataset.member);
    });
  });
}

async function createGroup() {
  const name = $('#groupNameInput').value.trim();
  if (!name) return showToast('Nama grup wajib diisi');

  try {
    const data = await api('POST', '/groups', { name: name, members: groupMembersTemp });
    closeGroupModal();
    showToast('Grup "' + name + '" berhasil dibuat!');
    loadChatList();
    openChat({ type: 'group', id: data.gid, name: name });
  } catch (err) {
    showToast('Gagal: ' + err.message);
  }
}

// Group Info
async function openGroupInfo() {
  if (!currentChat || currentChat.type !== 'group') return;
  try {
    const g = await api('GET', '/groups/' + currentChat.id);
    $('#groupInfoTitle').textContent = g.name;
    const membersEl = $('#groupInfoMembers');
    let html = '';
    g.members.forEach(function(m) {
      html += '<div class="member-list-item">' +
        renderAvatar(m, '', 28) +
        '<span>' + escapeHtml(m) + '</span>' +
        (m === g.creator ? '<span class="creator-label">CREATOR</span>' : '') +
      '</div>';
    });
    membersEl.innerHTML = html;
    show($('#groupInfoModal'));
    } catch (err) {
    showToast('Error: ' + err.message);
  }
}

async function addMemberToGroup() {
  const input = $('#groupAddMemberInput');
  const username = input.value.trim();
  if (!username || !currentChat) return;

  try {
    await api('POST', '/groups/addmember', { groupId: currentChat.id, username: username });
    input.value = '';
    showToast(username + ' ditambahkan ke grup');
    openGroupInfo();
    loadChatList();
  } catch (err) {
    showToast('Gagal: ' + err.message);
  }
}

// ==================== SETTINGS ====================
function openSettings() {
  updateSettingsUI();
  $('#settingsPanel').classList.add('open');
  show($('#settingsOverlay'));
}

function closeSettingsPanel() {
  $('#settingsPanel').classList.remove('open');
  hide($('#settingsOverlay'));
}

function updateSettingsUI() {
  if (!currentUser) return;
  $('#settingsAvatar').innerHTML = renderAvatar(currentUser.username, currentUser.profilePhoto, 56);
  $('#settingsDisplayName').textContent = currentUser.displayName;
  $('#settingsUsername').textContent = '@' + currentUser.username;
  if (currentUser.badge) {
    $('#settingsBadge').innerHTML = renderBadge(currentUser.badge);
    show($('#settingsBadge'));
  } else {
    hide($('#settingsBadge'));
    }
  $('#editDisplayName').value = currentUser.displayName;

  // Theme sync
  const theme = document.documentElement.getAttribute('data-theme');
  const isDark = theme === 'dark';
  $('#themeToggle').checked = isDark;
  $('#themeIcon').className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  $('#themeLabel').textContent = isDark ? 'Mode Gelap' : 'Mode Terang';
}

function toggleTheme() {
  const isDark = $('#themeToggle').checked;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  localStorage.setItem('tgram_theme', isDark ? 'dark' : 'light');
  $('#themeIcon').className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
  $('#themeLabel').textContent = isDark ? 'Mode Gelap' : 'Mode Terang';
}

async function saveDisplayName() {
  const newName = $('#editDisplayName').value.trim();
  if (!newName) return showToast('Display name wajib diisi');

  try {
    await api('POST', '/profile/displayname', { displayName: newName });
    currentUser.displayName = newName;
    updateSettingsUI();
    showToast('Display name diperbarui!');
  } catch (err) {
    showToast('Gagal: ' + err.message);
  }
}

async function changeProfilePhoto(file) {
  try {
    const data = await apiUpload('/profile/photo', file);
    currentUser.profilePhoto = data.url;
    updateSettingsUI();
    showToast('Foto profil diperbarui!');
  } catch (err) {
    showToast('Gagal: ' + err.message);
  }
}

async function logout() {
  try {
    await api('POST', '/logout');
  } catch(e) {}

  token = null;
  currentUser = null;
  currentChat = null;
  localStorage.removeItem('tgram_token');

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  hide($('#mainPage'));
  show($('#authPage'));
  hide($('#activeChat'));
  show($('#welcomeScreen'));
  $('#sidebar').classList.remove('mobile-hidden');

  // Reset forms
  $('#loginUser').value = '';
  $('#loginPass').value = '';
  $('#regUser').value = '';
  $('#regPass').value = '';
  $('#regPassConfirm').value = '';
  hide($('#authError'));
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
  // Auth tabs
  setupAuthTabs();

  // Auth forms
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#registerForm').addEventListener('submit', handleRegister);

  // Menu button -> Settings
  $('#menuBtn').addEventListener('click', openSettings);

  // Search
  $('#searchInput').addEventListener('input', function(e) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function() {
      handleSearch(e.target.value);
    }, 300);
  });

  $('#searchInput').addEventListener('focus', function() {
    if ($('#searchInput').value.trim()) {
      handleSearch($('#searchInput').value);
    }
  });

  // Send message
  $('#sendBtn').addEventListener('click', sendMessage);
  $('#messageInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Attach photo
  $('#attachBtn').addEventListener('click', function() {
    $('#chatPhotoInput').click();
  });

  $('#chatPhotoInput').addEventListener('change', function(e) {
    if (e.target.files && e.target.files[0]) {
      sendChatPhoto(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Back button (mobile)
  $('#backBtn').addEventListener('click', function() {
    $('#sidebar').classList.remove('mobile-hidden');
    currentChat = null;
    hide($('#activeChat'));
    show($('#welcomeScreen'));
  });

  // Group info button
  $('#chatInfoBtn').addEventListener('click', openGroupInfo);

  // Settings
  $('#closeSettings').addEventListener('click', closeSettingsPanel);
  $('#settingsOverlay').addEventListener('click', closeSettingsPanel);
  $('#themeToggle').addEventListener('change', toggleTheme);
  $('#saveDisplayName').addEventListener('click', saveDisplayName);
  $('#logoutBtn').addEventListener('click', logout);

  // Change photo
  $('#changePhotoBtn').addEventListener('click', function() {
    $('#profilePhotoInput').click();
  });

  $('#profilePhotoInput').addEventListener('change', function(e) {
    if (e.target.files && e.target.files[0]) {
      changeProfilePhoto(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Create group
  $('#createGroupBtn').addEventListener('click', openGroupModal);
  $('#closeGroupModal').addEventListener('click', closeGroupModal);
  $('#groupModal').querySelector('.modal-overlay').addEventListener('click', closeGroupModal);
  $('#addMemberBtn').addEventListener('click', addGroupMemberTemp);
  $('#addMemberInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addGroupMemberTemp();
    }
  });
  $('#createGroupSubmit').addEventListener('click', createGroup);

  // Group info modal
$('#closeGroupInfo').addEventListener('click', function() {
    hide($('#groupInfoModal'));
  });
  $('#groupInfoModal').querySelector('.modal-overlay').addEventListener('click', function() {
    hide($('#groupInfoModal'));
  });
  $('#groupAddMemberBtn').addEventListener('click', addMemberToGroup);
  $('#groupAddMemberInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addMemberToGroup();
    }
  });

  // Edit display name enter key
  $('#editDisplayName').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveDisplayName();
    }
  });
}

// ==================== INIT ====================
async function init() {
  // Load saved theme
  const savedTheme = localStorage.getItem('tgram_theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  setupEventListeners();

  // Check if banned
  try {
    const banCheck = await fetch('/api/check-ban');
    const banData = await banCheck.json();
    if (banData.banned) {
      hide($('#authPage'));
      show($('#banPage'));
      return;
    }
  } catch(e) {}

  // Check saved session
  if (token) {
    try {
      const data = await api('GET', '/me');
      currentUser = data;
      // Also get role from me
      enterApp();
    } catch(e) {
      // Token invalid
      token = null;
      localStorage.removeItem('tgram_token');
    }
  }
}

// Run
init();
