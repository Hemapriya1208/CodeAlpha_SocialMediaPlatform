/* ================= Helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let me = JSON.parse(localStorage.getItem('user') || 'null');

async function api(path, opts = {}) {
  const t = localStorage.getItem('token');
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && t) logout();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
function logout() { localStorage.clear(); location.href = '/index.html'; }
function timeAgo(d) {
  const t = new Date(d.replace(' ', 'T') + 'Z'), s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return t.toLocaleDateString();
}
const avatar = (u, cls = '') =>
  `<a class="avatar ${cls}" href="/profile.html?u=${esc(u.username)}" style="background:${esc(u.color)}" aria-label="${esc(u.username)}">${esc((u.display_name || u.username)[0].toUpperCase())}</a>`;

function renderNav() {
  $('#nav').innerHTML = `<div class="nav-in"><a class="logo" href="/feed.html">Pulse</a>
    <nav class="nav-links"><a href="/feed.html">Home</a><a href="/profile.html?u=${esc(me.username)}">Profile</a>
    <button class="btn ghost sm" id="logoutBtn">Log out</button></nav></div>`;
  $('#logoutBtn').onclick = logout;
}

/* ================= Reusable pieces ================= */
const followBtn = (u, following) =>
  `<button class="btn sm ${following ? 'following' : ''}" data-act="follow" data-id="${u.id}">${following ? 'Following' : 'Follow'}</button>`;

const userRow = (u, following = false) => `<div class="row">${avatar(u, 'sm')}
  <a class="who" href="/profile.html?u=${esc(u.username)}"><b>${esc(u.display_name || u.username)}</b><span class="muted">@${esc(u.username)}</span></a>
  ${followBtn(u, following)}</div>`;

function postCard(p) {
  return `<article class="post" id="post-${p.id}">
    ${avatar(p)}
    <div class="post-body">
      <div class="post-head">
        <a href="/profile.html?u=${esc(p.username)}"><b>${esc(p.display_name || p.username)}</b></a>
        <span class="muted">@${esc(p.username)} · ${timeAgo(p.created_at)}</span>
        ${p.user_id === me.id ? `<button class="icon del" data-act="delete" data-id="${p.id}" aria-label="Delete post">✕</button>` : ''}
      </div>
      <p class="content">${esc(p.content)}</p>
      <div class="actions">
        <button class="act ${p.liked ? 'liked' : ''}" data-act="like" data-id="${p.id}" aria-label="Like"><span class="heart">${p.liked ? '♥' : '♡'}</span><span class="n">${p.likes}</span></button>
        <button class="act" data-act="comments" data-id="${p.id}" aria-label="Comments">💬 <span class="n">${p.comments}</span></button>
      </div>
      <div class="comments hidden"></div>
    </div></article>`;
}
const commentHTML = c => `<div class="comment">${avatar(c, 'sm')}<div><b>${esc(c.display_name || c.username)}</b>
  <span class="muted">${timeAgo(c.created_at)}</span><div>${esc(c.content)}</div></div></div>`;

function showPosts(list, emptyTitle, emptyHint) {
  $('#feed').innerHTML = list.length ? list.map(postCard).join('')
    : `<div class="empty"><b>${emptyTitle}</b>${emptyHint}</div>`;
}
async function loadSuggestions() {
  const box = $('#suggest'); if (!box) return;
  const list = await api('/suggestions');
  box.innerHTML = list.length ? list.map(u => userRow(u)).join('') : '<p class="muted">You’re following everyone.</p>';
}

async function toggleComments(post, id) {
  const box = $('.comments', post);
  box.classList.toggle('hidden');
  if (box.classList.contains('hidden')) return;
  const list = await api(`/posts/${id}/comments`);
  box.innerHTML = `${list.map(commentHTML).join('')}
    <form class="cform"><input maxlength="280" placeholder="Write a comment" aria-label="Comment" required><button class="btn sm">Reply</button></form>`;
  $('input', box).focus();
  $('form', box).onsubmit = async e => {
    e.preventDefault();
    const input = $('input', e.target);
    try {
      const c = await api(`/posts/${id}/comments`, { method: 'POST', body: { content: input.value } });
      e.target.insertAdjacentHTML('beforebegin', commentHTML(c));
      input.value = '';
      const n = $('[data-act=comments] .n', post); n.textContent = +n.textContent + 1;
    } catch (err) { toast(err.message, true); }
  };
}

/* One click handler for like / delete / comments / follow */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id } = b.dataset, post = b.closest('.post');
  try {
    if (act === 'like') {
      const r = await api(`/posts/${id}/like`, { method: 'POST' });
      b.classList.toggle('liked', r.liked);
      $('.heart', b).textContent = r.liked ? '♥' : '♡';
      $('.n', b).textContent = r.likes;
    } else if (act === 'delete') {
      if (!confirm('Delete this post?')) return;
      await api(`/posts/${id}`, { method: 'DELETE' });
      post.remove(); toast('Post deleted');
    } else if (act === 'comments') {
      await toggleComments(post, id);
    } else if (act === 'follow') {
      const r = await api(`/users/${id}/follow`, { method: 'POST' });
      b.textContent = r.following ? 'Following' : 'Follow';
      b.classList.toggle('following', r.following);
      const fc = $('#followers'); if (fc && b.id === 'profileFollow') fc.textContent = r.followers;
    }
  } catch (err) { toast(err.message, true); }
});

/* ================= Pages ================= */
function initAuth(isRegister) {
  if (localStorage.getItem('token')) return (location.href = '/feed.html');
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api(isRegister ? '/register' : '/login', { method: 'POST', body });
      localStorage.setItem('token', r.token);
      localStorage.setItem('user', JSON.stringify(r.user));
      location.href = '/feed.html';
    } catch (err) { $('#err').textContent = err.message; }
  };
}

function initFeed() {
  renderNav();
  let scope = 'following';
  $('#meAvatar').innerHTML = avatar(me);
  const text = $('#postText'), btn = $('#postBtn');
  text.oninput = () => { $('#count').textContent = 280 - text.value.length; btn.disabled = !text.value.trim(); };

  async function load() {
    const list = await api('/posts?scope=' + scope);
    showPosts(list, scope === 'following' ? 'Your feed is quiet' : 'No posts yet',
      scope === 'following' ? 'Follow people or switch to Explore to see posts.' : 'Write the first post.');
  }
  $('#composer').onsubmit = async e => {
    e.preventDefault();
    try {
      const p = await api('/posts', { method: 'POST', body: { content: text.value } });
      text.value = ''; text.oninput();
      if ($('#feed .empty')) $('#feed').innerHTML = '';
      $('#feed').insertAdjacentHTML('afterbegin', postCard(p));
      toast('Posted');
    } catch (err) { toast(err.message, true); }
  };
  document.querySelectorAll('.tabs button').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === t));
    scope = t.dataset.scope; load();
  });
  let timer;
  $('#search').oninput = e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) return ($('#results').innerHTML = '');
    timer = setTimeout(async () => {
      const r = await api('/search?q=' + encodeURIComponent(q));
      $('#results').innerHTML = r.length ? r.map(u => userRow(u, !!u.is_following)).join('') : '<p class="muted">No people found.</p>';
    }, 250);
  };
  load(); loadSuggestions();
}

async function initProfile() {
  renderNav();
  const username = new URLSearchParams(location.search).get('u') || me.username;
  try {
    const u = await api('/users/' + encodeURIComponent(username));
    const render = () => {
      $('#profile').innerHTML = `<div class="cover" style="background:${esc(u.color)}"></div>
      <div class="p-head">
        <div class="p-top">${avatar(u, 'lg')}
          ${u.is_me ? '<button class="btn ghost sm" id="editBtn">Edit profile</button>'
            : `<button class="btn sm ${u.is_following ? 'following' : ''}" id="profileFollow" data-act="follow" data-id="${u.id}">${u.is_following ? 'Following' : 'Follow'}</button>`}
        </div>
        <h1>${esc(u.display_name || u.username)}</h1>
        <div class="muted">@${esc(u.username)} · Joined ${new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        <p class="p-bio">${esc(u.bio) || '<span class="muted">No bio yet.</span>'}</p>
        <div class="stats"><span><b>${u.posts}</b> posts</span><span><b id="followers">${u.followers}</b> followers</span><span><b>${u.following}</b> following</span></div>
        <form class="edit hidden" id="editForm">
          <input name="display_name" maxlength="40" value="${esc(u.display_name)}" aria-label="Display name" required>
          <textarea name="bio" rows="2" maxlength="160" placeholder="Write a short bio" aria-label="Bio">${esc(u.bio)}</textarea>
          <button class="btn sm" style="justify-self:start">Save changes</button>
        </form>
      </div>`;
      if (u.is_me) {
        $('#editBtn').onclick = () => $('#editForm').classList.toggle('hidden');
        $('#editForm').onsubmit = async e => {
          e.preventDefault();
          try {
            const r = await api('/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
            u.display_name = r.display_name; u.bio = e.target.bio.value.trim();
            me = r; localStorage.setItem('user', JSON.stringify(r));
            render(); renderNav(); toast('Profile saved');
          } catch (err) { toast(err.message, true); }
        };
      }
    };
    render();
    const posts = await api(`/users/${encodeURIComponent(username)}/posts`);
    showPosts(posts, 'No posts yet', u.is_me ? 'Share your first thought from the Home page.' : 'Nothing here yet.');
    document.title = `Pulse – ${u.display_name || u.username}`;
  } catch (err) {
    $('#profile').innerHTML = `<div class="empty"><b>Profile not found</b>${esc(err.message)}</div>`;
  }
  loadSuggestions();
}

/* ================= Boot ================= */
const page = document.body.dataset.page;
if (page === 'login') initAuth(false);
else if (page === 'register') initAuth(true);
else if (!me || !localStorage.getItem('token')) location.href = '/index.html';
else if (page === 'feed') initFeed();
else if (page === 'profile') initProfile();