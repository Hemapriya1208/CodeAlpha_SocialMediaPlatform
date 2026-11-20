const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const SECRET = process.env.JWT_SECRET || 'change-this-secret';
const ROOT = path.join(__dirname, '..');
const db = new Database(path.join(ROOT, 'socialmedia.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ---------- Database schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password TEXT NOT NULL,
  display_name TEXT,
  bio TEXT DEFAULT '',
  color TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS likes(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, post_id)
);
CREATE TABLE IF NOT EXISTS follows(
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(follower_id, following_id),
  CHECK(follower_id != following_id)
);`);

const COLORS = [
  'linear-gradient(135deg,#3b3bff,#8a5cff)', 'linear-gradient(135deg,#ff5c8a,#ff9a5c)',
  'linear-gradient(135deg,#1fcb9a,#2f9bff)', 'linear-gradient(135deg,#ffb020,#ff5c5c)',
  'linear-gradient(135deg,#14142b,#4a4a8a)'
];
const rndColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

/* ---------- Demo data (only on an empty database) ---------- */
if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) {
  const hash = bcrypt.hashSync('demo1234', 10);
  const ins = db.prepare('INSERT INTO users(username,email,password,display_name,bio,color) VALUES(?,?,?,?,?,?)');
  const post = db.prepare('INSERT INTO posts(user_id,content) VALUES(?,?)');
  ins.run('ava', 'ava@demo.io', hash, 'Ava Reyes', 'Designer. Coffee first, pixels second.', COLORS[1]);
  ins.run('liam', 'liam@demo.io', hash, 'Liam Chen', 'Building things on the web.', COLORS[2]);
  ins.run('noor', 'noor@demo.io', hash, 'Noor Hadid', 'Photographer chasing golden hour.', COLORS[3]);
  post.run(1, 'Just shipped a new design system. Spacing tokens are a love language.');
  post.run(2, 'Hot take: the best database is the one you already know how to query.');
  post.run(3, 'Golden hour over the harbour today. No filter needed.');
}

/* ---------- Middleware ---------- */
app.use(express.json());
app.use(express.static(path.join(ROOT, 'frontend')));
app.get('/profile.html', (_, res) => res.sendFile(path.join(ROOT, 'profile.html')));

const auth = (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    req.user = jwt.verify(t, SECRET);
    next();
  } catch { res.status(401).json({ error: 'Please log in again.' }); }
};
const publicUser = u => ({ id: u.id, username: u.username, display_name: u.display_name, color: u.color });
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });

/* ---------- Auth ---------- */
app.post('/api/register', (req, res) => {
  const { username, email, password, display_name } = req.body;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores.' });
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'Enter a valid email address.' });
  if ((password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const r = db.prepare('INSERT INTO users(username,email,password,display_name,color) VALUES(?,?,?,?,?)')
      .run(username, email, bcrypt.hashSync(password, 10), (display_name || username).trim(), rndColor());
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    res.json({ token: sign(u), user: publicUser(u) });
  } catch (err) {
  console.error('REGISTER ERROR:', err.message);
  if (String(err.code).startsWith('SQLITE_CONSTRAINT'))
    return res.status(409).json({ error: 'That username or email is already taken.' });
  res.status(500).json({ error: 'Server error: ' + err.message });
}
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(username || '', username || '');
  if (!u || !bcrypt.compareSync(password || '', u.password)) return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ token: sign(u), user: publicUser(u) });
});

/* ---------- Profiles & follows ---------- */
app.get('/api/users/:username', auth, (req, res) => {
  const u = db.prepare('SELECT id,username,display_name,bio,color,created_at FROM users WHERE username=?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const n = (sql) => db.prepare(sql).get(u.id).c;
  res.json({
    ...u,
    posts: n('SELECT COUNT(*) c FROM posts WHERE user_id=?'),
    followers: n('SELECT COUNT(*) c FROM follows WHERE following_id=?'),
    following: n('SELECT COUNT(*) c FROM follows WHERE follower_id=?'),
    is_following: !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, u.id),
    is_me: u.id === req.user.id
  });
});

app.put('/api/me', auth, (req, res) => {
  const name = (req.body.display_name || '').trim().slice(0, 40);
  const bio = (req.body.bio || '').trim().slice(0, 160);
  if (!name) return res.status(400).json({ error: 'Display name can’t be empty.' });
  db.prepare('UPDATE users SET display_name=?, bio=? WHERE id=?').run(name, bio, req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
});

app.post('/api/users/:id/follow', auth, (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'You can’t follow yourself.' });
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) return res.status(404).json({ error: 'User not found.' });
  const has = db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.user.id, id);
  if (has) db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(req.user.id, id);
  else db.prepare('INSERT INTO follows VALUES(?,?)').run(req.user.id, id);
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id=?').get(id).c;
  res.json({ following: !has, followers });
});

app.get('/api/suggestions', auth, (req, res) => {
  res.json(db.prepare(`SELECT id,username,display_name,color FROM users
    WHERE id!=? AND id NOT IN (SELECT following_id FROM follows WHERE follower_id=?)
    ORDER BY RANDOM() LIMIT 5`).all(req.user.id, req.user.id));
});

app.get('/api/search', auth, (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  res.json(db.prepare(`SELECT id,username,display_name,color,
    EXISTS(SELECT 1 FROM follows WHERE follower_id=? AND following_id=users.id) is_following
    FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id!=? LIMIT 8`).all(req.user.id, q, q, req.user.id));
});

/* ---------- Posts ---------- */
const POST_SQL = `SELECT p.id,p.content,p.created_at,u.id user_id,u.username,u.display_name,u.color,
  (SELECT COUNT(*) FROM likes WHERE post_id=p.id) likes,
  (SELECT COUNT(*) FROM comments WHERE post_id=p.id) comments,
  EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) liked
  FROM posts p JOIN users u ON u.id=p.user_id`;

app.get('/api/posts', auth, (req, res) => {
  const me = req.user.id;
  if (req.query.scope === 'all')
    return res.json(db.prepare(`${POST_SQL} ORDER BY p.id DESC LIMIT 50`).all(me));
  res.json(db.prepare(`${POST_SQL} WHERE p.user_id=? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?)
    ORDER BY p.id DESC LIMIT 50`).all(me, me, me));
});

app.get('/api/users/:username/posts', auth, (req, res) => {
  res.json(db.prepare(`${POST_SQL} WHERE u.username=? ORDER BY p.id DESC`).all(req.user.id, req.params.username));
});

app.post('/api/posts', auth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content || content.length > 280) return res.status(400).json({ error: 'Posts need 1-280 characters.' });
  const r = db.prepare('INSERT INTO posts(user_id,content) VALUES(?,?)').run(req.user.id, content);
  res.json(db.prepare(`${POST_SQL} WHERE p.id=?`).get(req.user.id, r.lastInsertRowid));
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  r.changes ? res.json({ ok: true }) : res.status(403).json({ error: 'You can only delete your own posts.' });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  const id = +req.params.id;
  if (!db.prepare('SELECT 1 FROM posts WHERE id=?').get(id)) return res.status(404).json({ error: 'Post not found.' });
  const has = db.prepare('SELECT 1 FROM likes WHERE user_id=? AND post_id=?').get(req.user.id, id);
  if (has) db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.user.id, id);
  else db.prepare('INSERT INTO likes VALUES(?,?)').run(req.user.id, id);
  res.json({ liked: !has, likes: db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=?').get(id).c });
});

/* ---------- Comments ---------- */
const COMMENT_SQL = `SELECT c.id,c.content,c.created_at,u.username,u.display_name,u.color
  FROM comments c JOIN users u ON u.id=c.user_id`;

app.get('/api/posts/:id/comments', auth, (req, res) => {
  res.json(db.prepare(`${COMMENT_SQL} WHERE c.post_id=? ORDER BY c.id`).all(req.params.id));
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content || content.length > 280) return res.status(400).json({ error: 'Comments need 1-280 characters.' });
  if (!db.prepare('SELECT 1 FROM posts WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
  const r = db.prepare('INSERT INTO comments(post_id,user_id,content) VALUES(?,?,?)').run(req.params.id, req.user.id, content);
  res.json(db.prepare(`${COMMENT_SQL} WHERE c.id=?`).get(r.lastInsertRowid));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pulse running → http://localhost:${PORT}`));