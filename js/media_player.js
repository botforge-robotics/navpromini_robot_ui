// NavPro Mini - Image Viewer & Video Player (DND Screen Controller)
// Features:
// - Clean file list screen matching Locations layout (swipe-left to delete)
// - Click row to preview in immersive fullscreen player
// - Top-center floating circular close button (✕) to dismiss fullscreen
// - Swipe-down touch gesture to dismiss fullscreen
// - Swipe left/right touch gestures to cycle between media files in fullscreen
// - DND Mode: navigation & mission popups are silenced on this screen
// - Upload media files directly or receive from Mission Planner app

(function() {
  'use strict';

  const API_BASE = window.API_BASE || 'http://' + window.location.hostname + ':8090';

  let mediaItems = [];
  let currentMediaIndex = 0;
  let isFullscreenActive = false;
  let pendingDeleteFilename = null;

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeQuotes(str) {
    if (!str) return '';
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }

  // --- Initialization ---
  window.initMediaPlayer = function() {
    fetchMediaList();
    setupFullscreenGestures();
  };

  // --- Fetch & Render Media List ---
  window.fetchMediaList = async function() {
    const listEl = document.getElementById('media-full-list');
    if (listEl && mediaItems.length === 0) {
      listEl.innerHTML = '<div class="loading-spinner">Loading media gallery...</div>';
    }

    try {
      const res = await fetch(`${API_BASE}/api/v1/media`);
      const data = await res.json();
      mediaItems = (data && data.media) ? data.media : [];

      renderMediaList();
    } catch (err) {
      console.warn('Failed to fetch media list:', err);
      if (listEl) {
        listEl.innerHTML = `<div class="media-empty-list">
          <div class="media-empty-icon-circle">⚠️</div>
          <h3>Unable to Load Media</h3>
          <p>Could not connect to media service: ${escapeHtml(err.message)}</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="fetchMediaList()">⟳ Try Again</button>
        </div>`;
      }
    }
  };

  function renderMediaList() {
    const listEl = document.getElementById('media-full-list');
    if (!listEl) return;

    const subtitleEl = document.getElementById('media-list-subtitle');
    if (subtitleEl) {
      if (mediaItems.length === 0) {
        subtitleEl.textContent = 'No media files stored on robot';
      } else {
        subtitleEl.textContent = `${mediaItems.length} file${mediaItems.length === 1 ? '' : 's'} • Tap to preview fullscreen • Swipe left to delete`;
      }
    }

    if (mediaItems.length === 0) {
      listEl.innerHTML = `
        <div class="media-empty-list">
          <div class="media-empty-icon-circle">🖼️</div>
          <h3>No Media Files Uploaded</h3>
          <p>Share photos and videos from Mission Planner desktop/mobile app, or upload directly here.</p>
          <button type="button" class="btn btn-primary" onclick="triggerMediaUpload()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Upload Media Files</span>
          </button>
        </div>
      `;
      return;
    }

    listEl.innerHTML = mediaItems.map((item, idx) => {
      const isVideo = item.type === 'video' || item.filename.endsWith('.mp4') || item.filename.endsWith('.webm') || item.filename.endsWith('.mov');
      const badgeClass = isVideo ? 'badge-video' : 'badge-image';
      const typeLabel = isVideo ? 'VIDEO' : 'IMAGE';

      return `
        <div class="swipeable-wrapper">
          <div class="swipe-delete-action">
            <button type="button" class="btn-swipe-delete" onclick="confirmDeleteMedia('${escapeQuotes(item.filename)}')">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              <span>Delete</span>
            </button>
          </div>
          <div class="swipeable-content location-item media-row-card" onclick="openFullscreenMedia(${idx})">
            <div class="media-row-leading">
              ${isVideo 
                ? `<div class="media-row-thumb"><video src="${escapeQuotes(item.url)}#t=0.5" preload="metadata" muted playsinline></video><span class="thumb-play-tag">▶</span></div>`
                : `<div class="media-row-thumb"><img src="${escapeQuotes(item.url)}" alt="${escapeQuotes(item.name || item.filename)}" loading="lazy"></div>`
              }
            </div>
            <div class="location-item-info media-row-info">
              <h3 title="${escapeQuotes(item.name || item.filename)}">${escapeHtml(item.name || item.filename)}</h3>
              <p class="media-row-meta">
                <span class="media-type-badge ${badgeClass}">${typeLabel}</span>
                <span class="media-row-size">${formatBytes(item.size)}</span>
              </p>
            </div>
            <div class="media-row-actions">
              <button type="button" class="btn btn-outline btn-sm btn-preview-file" onclick="event.stopPropagation(); openFullscreenMedia(${idx})">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                <span>Preview</span>
              </button>
              <button type="button" class="btn btn-outline btn-sm btn-delete-row" onclick="event.stopPropagation(); confirmDeleteMedia('${escapeQuotes(item.filename)}')" title="Delete File">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach native touch swipe-left gesture to reveal delete
    if (typeof makeSwipeable === 'function') {
      makeSwipeable(listEl);
    }
  }

  // --- Fullscreen Preview / Video Player ---
  window.openFullscreenMedia = function(index) {
    if (!mediaItems || mediaItems.length === 0) return;
    currentMediaIndex = Math.max(0, Math.min(mediaItems.length - 1, index));
    const item = mediaItems[currentMediaIndex];
    if (!item) return;

    isFullscreenActive = true;
    const overlay = document.getElementById('fullscreen-media-overlay');
    const imgEl = document.getElementById('fullscreen-img-viewer');
    const vidEl = document.getElementById('fullscreen-video-viewer');
    const filenameEl = document.getElementById('fullscreen-filename');
    const counterEl = document.getElementById('fullscreen-counter');

    if (!overlay) return;

    // Reset overlay transform & opacity
    overlay.style.transition = 'none';
    overlay.style.transform = 'translateY(0)';
    overlay.style.opacity = '1';
    overlay.style.display = 'flex';

    if (filenameEl) filenameEl.textContent = item.name || item.filename;
    if (counterEl) counterEl.textContent = `${currentMediaIndex + 1} / ${mediaItems.length}`;

    const isVideo = item.type === 'video' || item.filename.endsWith('.mp4') || item.filename.endsWith('.webm') || item.filename.endsWith('.mov');

    if (isVideo) {
      if (imgEl) imgEl.style.display = 'none';
      if (vidEl) {
        vidEl.style.display = 'block';
        vidEl.src = item.url;
        vidEl.currentTime = 0;
        vidEl.play().catch(e => console.log('Fullscreen video autoplay:', e));
      }
    } else {
      if (vidEl) {
        vidEl.pause();
        vidEl.src = '';
        vidEl.style.display = 'none';
      }
      if (imgEl) {
        imgEl.style.display = 'block';
        imgEl.src = item.url;
      }
    }
  };

  window.isMediaFullscreenActive = function() {
    return isFullscreenActive;
  };

  window.showMissionMediaFullscreen = function(url, filename, isVideo, onClosed) {
    isFullscreenActive = true;
    const overlay = document.getElementById('fullscreen-media-overlay');
    const imgEl = document.getElementById('fullscreen-img-viewer');
    const vidEl = document.getElementById('fullscreen-video-viewer');
    const filenameEl = document.getElementById('fullscreen-filename');
    const counterEl = document.getElementById('fullscreen-counter');
    const prevBtn = document.getElementById('btn-fullscreen-prev');
    const nextBtn = document.getElementById('btn-fullscreen-next');

    if (!overlay) return;
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (counterEl) counterEl.textContent = 'Mission Display';
    if (filenameEl) filenameEl.textContent = filename || 'Photo / Video';

    overlay.style.transition = 'none';
    overlay.style.transform = 'translateY(0)';
    overlay.style.opacity = '1';
    overlay.style.display = 'flex';

    window._missionMediaOnClosed = onClosed;

    if (isVideo) {
      if (imgEl) {
        imgEl.src = '';
        imgEl.style.display = 'none';
      }
      if (vidEl) {
        vidEl.style.display = 'block';
        vidEl.loop = false;
        vidEl.controls = true;
        vidEl.muted = false;
        vidEl.volume = 1.0;
        vidEl.src = url;
        vidEl.currentTime = 0;
        vidEl.onended = () => {
          console.log('[Media] Video finished playing naturally -> advancing mission');
          window.closeFullscreenMedia(true);
        };
        const playPromise = vidEl.play();
        if (playPromise !== undefined) {
          playPromise.catch(err => {
            console.warn('[Media] Autoplay unmuted failed, falling back to muted play:', err);
            vidEl.muted = true;
            vidEl.play().catch(e => console.error('[Media] Video play completely failed:', e));
          });
        }
      }
    } else {
      if (vidEl) {
        vidEl.pause();
        vidEl.onended = null;
        vidEl.src = '';
        vidEl.style.display = 'none';
      }
      if (imgEl) {
        imgEl.style.display = 'block';
        imgEl.src = url;
      }
    }
  };

  window.closeFullscreenMedia = function(isUserDismiss = false) {
    isFullscreenActive = false;
    const overlay = document.getElementById('fullscreen-media-overlay');
    const vidEl = document.getElementById('fullscreen-video-viewer');
    const imgEl = document.getElementById('fullscreen-img-viewer');
    const prevBtn = document.getElementById('btn-fullscreen-prev');
    const nextBtn = document.getElementById('btn-fullscreen-next');

    if (prevBtn) prevBtn.style.display = '';
    if (nextBtn) nextBtn.style.display = '';

    if (vidEl) {
      vidEl.pause();
      vidEl.onended = null;
      vidEl.src = '';
      vidEl.style.display = 'none';
    }
    if (imgEl) {
      imgEl.src = '';
      imgEl.style.display = 'none';
    }

    if (overlay) {
      overlay.style.display = 'none';
      overlay.style.transform = '';
      overlay.style.transition = '';
      overlay.style.opacity = '1';
    }

    if (isUserDismiss && window._missionMediaOnClosed) {
      const cb = window._missionMediaOnClosed;
      window._missionMediaOnClosed = null;
      try { cb(); } catch (_) {}
    } else {
      window._missionMediaOnClosed = null;
    }
  };

  window.nextMediaItem = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (mediaItems.length === 0) return;
    const nextIdx = (currentMediaIndex + 1) % mediaItems.length;
    openFullscreenMedia(nextIdx);
  };

  window.prevMediaItem = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (mediaItems.length === 0) return;
    const prevIdx = (currentMediaIndex - 1 + mediaItems.length) % mediaItems.length;
    openFullscreenMedia(prevIdx);
  };

  // --- Fullscreen Gestures (Swipe Down to Dismiss, Swipe Left/Right to Navigate) ---
  let fullscreenGesturesBound = false;
  function setupFullscreenGestures() {
    if (fullscreenGesturesBound) return;
    const overlay = document.getElementById('fullscreen-media-overlay');
    if (!overlay) return;
    fullscreenGesturesBound = true;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isTracking = false;

    overlay.addEventListener('touchstart', (e) => {
      // Don't intercept close or nav buttons
      if (e.target.closest('button') || e.target.closest('.media-delete-dialog')) return;
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        isTracking = true;
        overlay.style.transition = 'none';
      }
    }, { passive: true });

    overlay.addEventListener('touchmove', (e) => {
      if (!isTracking || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;

      // When dragging downwards to dismiss
      if (deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX)) {
        overlay.style.transform = `translateY(${deltaY}px)`;
        const opacity = Math.max(0.4, 1 - (deltaY / 600));
        overlay.style.opacity = opacity.toFixed(2);
      }
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
      if (!isTracking || !e.changedTouches || e.changedTouches.length === 0) return;
      isTracking = false;

      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const elapsed = Math.max(1, Date.now() - touchStartTime);
      const velocityY = deltaY / elapsed;

      // 1. Swipe Down to Dismiss (deltaY > 60 or fast downward flick)
      if ((deltaY > 60 || velocityY > 0.35) && Math.abs(deltaY) > Math.abs(deltaX)) {
        overlay.style.transition = 'transform 0.22s ease-out, opacity 0.2s ease-out';
        overlay.style.transform = 'translateY(100vh)';
        overlay.style.opacity = '0';
        setTimeout(() => {
          closeFullscreenMedia(true);
        }, 220);
        return;
      }

      // Reset overlay position if not dismissed
      overlay.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.2s ease';
      overlay.style.transform = 'translateY(0)';
      overlay.style.opacity = '1';

      // 2. Horizontal swipe (left = next, right = prev)
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          nextMediaItem();
        } else {
          prevMediaItem();
        }
      }
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (!isFullscreenActive) return;
      if (e.key === 'Escape') {
        closeFullscreenMedia(true);
      } else if (e.key === 'ArrowRight') {
        nextMediaItem();
      } else if (e.key === 'ArrowLeft') {
        prevMediaItem();
      }
    });
  }

  // --- Delete File Operations ---
  window.confirmDeleteMedia = function(filename) {
    pendingDeleteFilename = filename;
    const overlay = document.getElementById('media-delete-overlay');
    const filenameEl = document.getElementById('media-delete-dialog-filename');
    const confirmBtn = document.getElementById('btn-confirm-delete-media');

    if (filenameEl) filenameEl.textContent = filename;
    if (confirmBtn) {
      confirmBtn.onclick = () => executeDeleteMedia(filename);
    }
    if (overlay) overlay.style.display = 'flex';
  };

  window.dismissDeleteMediaModal = function() {
    pendingDeleteFilename = null;
    const overlay = document.getElementById('media-delete-overlay');
    if (overlay) overlay.style.display = 'none';
  };

  window.executeDeleteMedia = async function(filename) {
    dismissDeleteMediaModal();
    if (!filename) return;

    try {
      if (window.showToast) window.showToast(`Deleting ${filename}...`);
      const res = await fetch(`${API_BASE}/api/v1/media/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (data && data.ok) {
        if (window.showToast) window.showToast(`Deleted ${filename} from robot.`);
        
        // If the deleted file was open in fullscreen, close fullscreen
        if (isFullscreenActive && mediaItems[currentMediaIndex] && mediaItems[currentMediaIndex].filename === filename) {
          closeFullscreenMedia(true);
        }

        await fetchMediaList();
      } else {
        if (window.showToast) window.showToast(`Failed to delete: ${data.message || 'Unknown error'}`, true);
      }
    } catch (err) {
      console.error('Delete error:', err);
      if (window.showToast) window.showToast(`Delete failed: ${err.message}`, true);
    }
  };

  // --- Upload Operations ---
  window.triggerMediaUpload = function() {
    const input = document.getElementById('kiosk-media-upload-input');
    if (input) input.click();
  };

  window.handleMediaFilesSelected = async function(files) {
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('file', files[i]);
    }

    try {
      if (window.showToast) window.showToast(`Uploading ${files.length} media file(s)...`);
      const res = await fetch(`${API_BASE}/api/v1/media/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        if (window.showToast) window.showToast(`Upload complete! Added ${data.count || 1} file(s).`);
        await fetchMediaList();
      } else {
        if (window.showToast) window.showToast(`Upload error: ${data.message || 'Failed to upload'}`, true);
      }
    } catch (err) {
      console.error('Upload error:', err);
      if (window.showToast) window.showToast(`Upload failed: ${err.message}`, true);
    } finally {
      const input = document.getElementById('kiosk-media-upload-input');
      if (input) input.value = '';
    }
  };

})();
