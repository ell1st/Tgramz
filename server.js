const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* ========== DATABASE ========== */
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function hashPwd(pwd) {
  return crypto.createHash('sha256').update(pwd + 'tgram_salt_2024').digest('hex');
}

function initDB() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const seed = {
      users: {
        ellnihbous: {
          password: hashPwd('122'),
          displayName: 'ellnihbous',
          badge: 'Dev jir',
          role: 'admin',
          ips: [],
          profilePhoto: '',
          createdAt: Date.now()
        },
        Salmaa: {
          password: hashPwd('1234'),
          displayName: 'Salmaa',
          badge: 'Pretty Girl',
          role: 'admin',
          ips: [],
          profilePhoto: '',
          createdAt: Date.now()
        }
      },
      bannedIPs: [],
      groups: {},
      privateMessages: {},
      announcements: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
}

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

initDB();

/* ========== SESSIONS (in-memory) ========== */
const sessions = {};

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { username, createdAt: Date.now() };
  return token;
}

/* ========== MIDDLEWARE ========== */
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function auth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
  req.user = sessions[token];
  next();
}

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}

/* ========== AUTH ROUTES ========== */

// Cek ban IP
app.get('/api/check-ban', (req, res) => {
  const ip = getIP(req);
  const db = readDB();
  res.json({ banned: db.bannedIPs.includes(ip) });
});

// Register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  const ip = getIP(req);

  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
  if (username.length < 3) return res.status(400).json({ error: 'Username minimal 3 karakter' });
  if (/[^a-zA-Z0-9_]/.test(username)) return res.status(400).json({ error: 'Username hanya huruf, angka, underscore' });
  if (password.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });

  const reserved = ['helperbot', 'announcementbot', 'helper_bot', 'announcement_bot'];
  if (reserved.includes(username.toLowerCase().replace(/ /g, ''))) return res.status(400).json({ error: 'Username reserved' });

  const db = readDB();
  if (db.bannedIPs.includes(ip)) return res.status(403).json({ error: 'IP Anda telah dibanned, tidak bisa register' });
  if (db.users[username]) return res.status(400).json({ error: 'Username sudah terdaftar' });

  db.users[username] = {
    password: hashPwd(password),
    displayName: username,
    badge: '',
    role: 'member',
    ips: [ip],
    profilePhoto: '',
    createdAt: Date.now()
  };
  writeDB(db);

  const token = createSession(username);
  res.json({ success: true, token, username, displayName: username, badge: '', role: 'member', profilePhoto: '' });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const ip = getIP(req);

  if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

  const db = readDB();
  if (db.bannedIPs.includes(ip)) return res.status(403).json({ error: 'IP Anda telah dibanned' });

  const user = db.users[username];
  if (!user) return res.status(400).json({ error: 'Username tidak ditemukan' });
  if (user.password !== hashPwd(password)) return res.status(400).json({ error: 'Password salah' });

  if (!user.ips.includes(ip)) { user.ips.push(ip); writeDB(db); }

  const token = createSession(username);
  res.json({
    success: true, token, username,
    displayName: user.displayName, badge: user.badge,
    role: user.role, profilePhoto: user.profilePhoto
  });
});

// Logout
app.post('/api/logout', auth, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  delete sessions[token];
  res.json({ ok: true });
});

// Info user saat ini
app.get('/api/me', auth, (req, res) => {
  const db = readDB();
  const u = db.users[req.user.username];
  res.json({
    username: req.user.username, displayName: u.displayName,
    badge: u.badge, role: u.role, profilePhoto: u.profilePhoto
  });
});

/* ========== CHAT LIST ========== */

app.get('/api/chats', auth, (req, res) => {
  const db = readDB();
  const me = req.user.username;
  const chats = [];

  // Chat private
  Object.entries(db.privateMessages).forEach(([key, msgs]) => {
    const parts = key.split('|');
    if (!parts.includes(me)) return;
    const other = parts.find(p => p !== me);
    if (!db.users[other]) return;
    const last = msgs[msgs.length - 1];
    chats.push({
      type: 'private', id: other,
      name: db.users[other].displayName, username: other,
      badge: db.users[other].badge, profilePhoto: db.users[other].profilePhoto,
      lastMessage: last ? (last.type === 'image' ? '\uD83D\uDCF7 Foto' : last.text) : '',
      lastTime: last ? last.timestamp : 0
    });
  });

  // Chat grup
  Object.entries(db.groups).forEach(([gid, g]) => {
    if (!g.members.includes(me)) return;
    const last = g.messages[g.messages.length - 1];
    chats.push({
      type: 'group', id: gid, name: g.name,
      lastMessage: last ? (last.type === 'image' ? '\uD83D\uDCF7 Foto' : last.text) : 'Grup dibuat',
      lastTime: last ? last.timestamp : g.createdAt
    });
  });

  // Bot chat khusus admin
  if (db.users[me].role === 'admin') {
    chats.push({
      type: 'bot', id: 'announcement-bot', name: 'Announcement Bot',
      lastMessage: '/cfd (text) - Kirim pengumuman', lastTime: Date.now() + 1
    });
    chats.push({
      type: 'bot', id: 'helper-bot', name: 'Helper Bot',
      lastMessage: '/ban, /unban, /alluser', lastTime: Date.now() + 2
    });
  }

  chats.sort((a, b) => b.lastTime - a.lastTime);
  res.json(chats);
});

/* ========== SEARCH ========== */

app.get('/api/search', auth, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const db = readDB();
  const results = Object.keys(db.users)
    .filter(u => u !== req.user.username)
    .filter(u => u.toLowerCase().includes(q.toLowerCase()) || db.users[u].displayName.toLowerCase().includes(q.toLowerCase()))
    .map(u => ({
      username: u, displayName: db.users[u].displayName,
      badge: db.users[u].badge, profilePhoto: db.users[u].profilePhoto
    }));
  res.json(results);
});

/* ========== PRIVATE MESSAGES ========== */

app.get('/api/messages/:with', auth, (req, res) => {
  const withUser = req.params.with;
  const me = req.user.username;
  const db = readDB();
  const key1 = me + '|' + withUser;
  const key2 = withUser + '|' + me;
  res.json(db.privateMessages[key1] || db.privateMessages[key2] || []);
});

app.post('/api/messages', auth, (req, res) => {
  const { to, text, type } = req.body;
  const from = req.user.username;
  const db = readDB();
  if (!db.users[to]) return res.status(404).json({ error: 'User tidak ditemukan' });

  const key1 = from + '|' + to;
  const key2 = to + '|' + from;
  const key = db.privateMessages[key1] ? key1 : (db.privateMessages[key2] ? key2 : key1);
  if (!db.privateMessages[key]) db.privateMessages[key] = [];

  const msg = { from, to, text, type: type || 'text', timestamp: Date.now() };
  db.privateMessages[key].push(msg);
  writeDB(db);

  io.to('user_' + to).emit('newMessage', msg);
  io.to('user_' + from).emit('newMessage', msg);
  io.to('user_' + to).emit('chatUpdate');
  io.to('user_' + from).emit('chatUpdate');
  res.json(msg);
});

/* ========== GROUPS ========== */

app.post('/api/groups', auth, (req, res) => {
  const { name, members } = req.body;
  const creator = req.user.username;
  const db = readDB();

  const gid = 'g_' + crypto.randomBytes(6).toString('hex');
  const allMembers = [creator, ...(members || []).filter(m => db.users[m] && m !== creator)];

  db.groups[gid] = { name, creator, members: allMembers, messages: [], createdAt: Date.now() };
  writeDB(db);

  allMembers.forEach(m => io.to('user_' + m).emit('chatUpdate'));
  res.json({ gid, group: db.groups[gid] });
});

app.get('/api/groups', auth, (req, res) => {
  const db = readDB();
  const groups = {};
  Object.entries(db.groups).forEach(([id, g]) => {
    if (g.members.includes(req.user.username)) groups[id] = g;
  });
  res.json(groups);
});

app.get('/api/groups/:id', auth, (req, res) => {
  const db = readDB();
  const g = db.groups[req.params.id];
  if (!g) return res.status(404).json({ error: 'Grup tidak ditemukan' });
  res.json(g);
});

app.post('/api/groups/addmember', auth, (req, res) => {
  const { groupId, username } = req.body;
  const db = readDB();
  const g = db.groups[groupId];
  if (!g) return res.status(404).json({ error: 'Grup tidak ditemukan' });
  if (!g.members.includes(req.user.username)) return res.status(403).json({ error: 'Bukan member grup' });
  if (!db.users[username]) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (g.members.includes(username)) return res.status(400).json({ error: 'Sudah di grup' });

  g.members.push(username);
  writeDB(db);
  g.members.forEach(m => io.to('user_' + m).emit('chatUpdate'));
  res.json({ ok: true, members: g.members });
});

app.post('/api/groups/message', auth, (req, res) => {
  const { groupId, text, type } = req.body;
  const from = req.user.username;
  const db = readDB();
  const g = db.groups[groupId];
  if (!g) return res.status(404).json({ error: 'Grup tidak ditemukan' });
  if (!g.members.includes(from)) return res.status(403).json({ error: 'Bukan member' });

  const msg = { from, text, type: type || 'text', timestamp: Date.now() };
  g.messages.push(msg);
  writeDB(db);
  g.members.forEach(m => io.to('user_' + m).emit('groupMessage', { groupId, message: msg }));
  res.json(msg);
});

/* ========== ADMIN ENDPOINTS ========== */

app.get('/api/allusers', auth, (req, res) => {
  const db = readDB();
  if (db.users[req.user.username].role !== 'admin') return res.status(403).json({ error: 'Hanya admin' });
  res.json(Object.entries(db.users).map(([u, d]) => ({
    username: u, displayName: d.displayName, badge: d.badge,
    role: d.role, ips: d.ips,
    banned: d.ips.some(ip => db.bannedIPs.includes(ip))
  })));
});

app.post('/api/ban', auth, (req, res) => {
  const { username } = req.body;
  const db = readDB();
  if (db.users[req.user.username].role !== 'admin') return res.status(403).json({ error: 'Hanya admin' });
  const target = db.users[username];
  if (!target) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Tidak bisa ban admin' });
  target.ips.forEach(ip => { if (!db.bannedIPs.includes(ip)) db.bannedIPs.push(ip); });
  writeDB(db);
  res.json({ ok: true, message: username + ' telah dibanned (IP-based)' });
});

app.post('/api/unban', auth, (req, res) => {
  const { username } = req.body;
  const db = readDB();
  if (db.users[req.user.username].role !== 'admin') return res.status(403).json({ error: 'Hanya admin' });
  const target = db.users[username];
  if (!target) return res.status(404).json({ error: 'User tidak ditemukan' });
  db.bannedIPs = db.bannedIPs.filter(ip => !target.ips.includes(ip));
  writeDB(db);
  res.json({ ok: true, message: username + ' telah di-unban' });
});

app.post('/api/announce', auth, (req, res) => {
  const { text } = req.body;
  const db = readDB();
  if (db.users[req.user.username].role !== 'admin') return res.status(403).json({ error: 'Hanya admin' });
  const ann = { from: 'Announcement Bot', text, type: 'announcement', timestamp: Date.now() };
  db.announcements.push(ann);
  writeDB(db);
  io.emit('announcement', ann);
  res.json(ann);
});

app.get('/api/announcements', auth, (req, res) => {
  const db = readDB();
  res.json(db.announcements);
});

/* ========== PROFILE ========== */

app.post('/api/profile/displayname', auth, (req, res) => {
  const { displayName } = req.body;
  if (!displayName || displayName.trim().length < 1) return res.status(400).json({ error: 'Display name wajib diisi' });
  const db = readDB();
  db.users[req.user.username].displayName = displayName.trim();
  writeDB(db);
  res.json({ ok: true, displayName: displayName.trim() });
});

app.post('/api/profile/photo', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = '/uploads/' + req.file.filename;
  const db = readDB();
  db.users[req.user.username].profilePhoto = url;
  writeDB(db);
  res.json({ url });
});

/* ========== FILE UPLOAD (chat) ========== */

app.post('/api/upload', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

/* ========== SOCKET.IO ========== */

io.on('connection', (socket) => {
  socket.on('authenticate', (username) => {
    socket.join('user_' + username);
    socket.username = username;
  });
  socket.on('disconnect', () => {});
});

/* ========== START ========== */

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════╗');
  console.log('  ║     T-Gram Server v1.0       ║');
  console.log('  ║  http://localhost:' + PORT + '        ║');
  console.log('  ╚══════════════════════════════╝');
  console.log('');
});
