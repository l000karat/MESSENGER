/* =====================================================
   PULSE MESSENGER — App Logic
   ===================================================== */

const socket = io();

// ── DOM refs ──────────────────────────────────────────
const messagesList  = document.getElementById('messagesList');
const messagesWrap  = document.getElementById('messagesWrap');
const messageInput  = document.getElementById('messageInput');
const sendBtn       = document.getElementById('sendBtn');
const usernameInput = document.getElementById('usernameInput');
const fileInput     = document.getElementById('fileInput');
const charCount     = document.getElementById('charCount');
const onlineCount   = document.getElementById('onlineCount');
const generalPreview= document.getElementById('generalPreview');
const generalTime   = document.getElementById('generalTime');
const themeToggle   = document.getElementById('themeToggle');
const sidebar       = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const mediaPreviewBar    = document.getElementById('mediaPreviewBar');
const mediaPreviewThumb  = document.getElementById('mediaPreviewThumb');
const mediaPreviewName   = document.getElementById('mediaPreviewName');
const mediaPreviewSize   = document.getElementById('mediaPreviewSize');
const mediaRemoveBtn     = document.getElementById('mediaRemoveBtn');
const lightbox      = document.getElementById('lightbox');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxContent = document.getElementById('lightboxContent');
const toastContainer = document.getElementById('toastContainer');

// ── State ─────────────────────────────────────────────
let pendingMedia = null; // { url, mediaType, originalName, file }
let isDark = true;
let onlineUsers = 1;
let lastSender = null;
let lastMsgTime = null;

// ── Theme ─────────────────────────────────────────────
function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  localStorage.setItem('pulse-theme', isDark ? 'dark' : 'light');
}

(function initTheme() {
  const saved = localStorage.getItem('pulse-theme');
  if (saved === 'light') { isDark = false; document.documentElement.setAttribute('data-theme', 'light'); }
})();

themeToggle.addEventListener('click', toggleTheme);

// ── Sidebar toggle (mobile) ───────────────────────────
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      e.target !== sidebarToggle) {
    sidebar.classList.remove('open');
  }
});

// ── Auto-resize textarea ──────────────────────────────
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';
  charCount.textContent = `${messageInput.value.length} / 2000`;
});

// ── Keyboard shortcut: Enter to send ─────────────────
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// ── Username persist ──────────────────────────────────
const savedUser = localStorage.getItem('pulse-username');
if (savedUser) usernameInput.value = savedUser;
usernameInput.addEventListener('change', () => {
  localStorage.setItem('pulse-username', usernameInput.value || 'Гость');
});

// ── File upload ───────────────────────────────────────
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 50 * 1024 * 1024) {
    showToast('Файл слишком большой (макс. 50 МБ)');
    return;
  }

  // Show preview bar
  mediaPreviewName.textContent = file.name;
  mediaPreviewSize.textContent = formatSize(file.size);
  mediaPreviewBar.classList.remove('hidden');

  if (file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      mediaPreviewThumb.innerHTML = `<img src="${ev.target.result}" alt="preview" />`;
    };
    reader.readAsDataURL(file);
  } else {
    mediaPreviewThumb.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }

  // Upload
  const progressEl = showUploadProgress(file.name);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    pendingMedia = { url: data.url, mediaType: data.mediaType, originalName: data.originalName };
    showToast('Файл готов к отправке');
  } catch (err) {
    showToast('Ошибка загрузки файла');
    clearMedia();
  } finally {
    removeUploadProgress(progressEl);
    fileInput.value = '';
  }
});

mediaRemoveBtn.addEventListener('click', clearMedia);

function clearMedia() {
  pendingMedia = null;
  mediaPreviewBar.classList.add('hidden');
  mediaPreviewThumb.innerHTML = '';
  mediaPreviewName.textContent = '';
  mediaPreviewSize.textContent = '';
}

// ── Send message ──────────────────────────────────────
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !pendingMedia) return;

  const user = (usernameInput.value || 'Гость').trim();

  const payload = {
    user,
    text: text || '',
    mediaUrl: pendingMedia?.url || null,
    mediaType: pendingMedia?.mediaType || null,
  };

  socket.emit('chat-message', payload);

  messageInput.value = '';
  messageInput.style.height = 'auto';
  charCount.textContent = '0 / 2000';
  clearMedia();
}

// ── Receive messages ──────────────────────────────────
socket.on('chat-message', (msg) => {
  appendMessage(msg);
  updateChatPreview(msg);
  scrollToBottom();
});

// ── Load history ──────────────────────────────────────
fetch('/api/messages')
  .then(r => r.json())
  .then(msgs => {
    msgs.forEach(m => appendMessage(m, false));
    scrollToBottom(false);
  })
  .catch(() => {});

// ── Append message bubble ─────────────────────────────
const myNames = new Set();

function appendMessage(msg, animate = true) {
  const username = (usernameInput.value || 'Гость').trim();
  if (msg.user === username) myNames.add(msg.user);

  const isOut = myNames.has(msg.user) || msg.user === username;
  const time = formatTime(new Date(msg.createdAt));
  const isSameSender = lastSender === msg.user && isSameMinute(msg.createdAt);
  const hue = stringToHue(msg.user);

  const row = document.createElement('div');
  row.className = `msg-row ${isOut ? 'out' : 'in'} ${!isSameSender ? 'first-in-group' : 'same-sender'}`;

  const avatarHTML = isOut ? '' : `
    <div class="msg-avatar-wrap">
      <div class="msg-avatar ${isSameSender ? 'hidden-avatar' : ''}" style="--hue:${hue}">
        ${msg.user.charAt(0).toUpperCase()}
      </div>
    </div>`;

  const senderHTML = (!isOut && !isSameSender)
    ? `<div class="msg-sender-name">${escHtml(msg.user)}</div>`
    : '';

  let contentHTML = '';

  if (msg.mediaUrl) {
    if (msg.mediaType === 'image') {
      contentHTML = `<img class="msg-img" src="${msg.mediaUrl}" alt="изображение" loading="lazy" />`;
    } else if (msg.mediaType === 'video') {
      contentHTML = `<video class="msg-video" src="${msg.mediaUrl}" controls preload="metadata"></video>`;
    } else {
      const fname = msg.mediaUrl.split('/').pop().replace(/^\d+-/, '');
      contentHTML = `
        <a class="msg-file" href="${msg.mediaUrl}" target="_blank" download>
          <div class="file-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div class="file-info">
            <div class="file-name">${escHtml(fname)}</div>
            <div class="file-size">Нажмите для скачивания</div>
          </div>
        </a>`;
    }
  }

  const textHTML = msg.text ? `<span>${escHtml(msg.text).replace(/\n/g, '<br>')}</span>` : '';

  const checkSvg = `<svg class="msg-read" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;

  row.innerHTML = `
    ${avatarHTML}
    <div class="msg-body">
      ${senderHTML}
      <div class="msg-bubble">
        ${contentHTML}
        ${textHTML}
      </div>
      <div class="msg-meta">
        <span class="msg-time">${time}</span>
        ${isOut ? checkSvg : ''}
      </div>
    </div>`;

  if (!animate) row.style.animation = 'none';

  messagesList.appendChild(row);

  // Image lightbox
  const img = row.querySelector('.msg-img');
  if (img) {
    img.addEventListener('click', () => openLightbox(`<img src="${msg.mediaUrl}" alt="img" />`));
  }

  const video = row.querySelector('.msg-video');
  if (video) {
    video.addEventListener('dblclick', () => openLightbox(`<video src="${msg.mediaUrl}" controls autoplay></video>`));
  }

  lastSender = msg.user;
  lastMsgTime = msg.createdAt;
}

// ── Update sidebar preview ────────────────────────────
function updateChatPreview(msg) {
  const preview = msg.text || (msg.mediaType === 'image' ? '📷 Изображение' : msg.mediaType === 'video' ? '🎬 Видео' : '📎 Файл');
  generalPreview.textContent = `${msg.user}: ${preview}`;
  generalTime.textContent = formatTime(new Date(msg.createdAt));
}

// ── Lightbox ──────────────────────────────────────────
function openLightbox(html) {
  lightboxContent.innerHTML = html;
  lightbox.classList.remove('hidden');
}

lightboxClose.addEventListener('click', () => lightbox.classList.add('hidden'));
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) lightbox.classList.add('hidden');
});

// ── Toast notifications ───────────────────────────────
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);

  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

// ── Upload progress ───────────────────────────────────
function showUploadProgress(name) {
  const el = document.createElement('div');
  el.className = 'upload-progress';
  el.innerHTML = `
    <div class="upload-progress-label">Загрузка: ${escHtml(name)}</div>
    <div class="upload-progress-bar-wrap">
      <div class="upload-progress-bar"></div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function removeUploadProgress(el) {
  if (el) el.remove();
}

// ── Scroll ────────────────────────────────────────────
function scrollToBottom(smooth = true) {
  messagesWrap.scrollTo({
    top: messagesWrap.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant'
  });
}

// ── Helpers ───────────────────────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function isSameMinute(isoStr) {
  if (!lastMsgTime) return false;
  const a = new Date(isoStr);
  const b = new Date(lastMsgTime);
  return Math.abs(a - b) < 60000 && a.getMinutes() === b.getMinutes();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
  return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

function stringToHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

// ── Online count simulation ───────────────────────────
socket.on('connect', () => {
  onlineUsers = Math.floor(Math.random() * 8) + 2;
  onlineCount.textContent = `${onlineUsers} участников онлайн`;
});

// Focus input on load
messageInput.focus();
