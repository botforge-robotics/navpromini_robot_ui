// NavPro Mini - Image Viewer & Video Player (DND Screen Controller)
// Handles:
// - Media Gallery (Images & Videos)
// - Do Not Disturb (DND) Fullscreen Display
// - Autoplay Slideshow & Video Playlist
// - Swipe-to-Delete (Card & Fullscreen Preview)
// - Client & Kiosk File Uploads

(function() {
  'use strict';

  const API_BASE = window.API_BASE || 'http://' + window.location.hostname + ':8090';

  let mediaItems = [];
  let currentMediaIndex = 0;
  let isAutoplay = true;
  let autoplayTimer = null;
  let isFitCover = false;
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
      .replace(/"/g, '&quot;');
  }

  // --- Initialization ---
  window.initMediaPlayer = function() {
    fetchMediaList();
    setupStageGestures();
  };

  // --- Fetch & Render List ---
  window.fetchMediaList = async function() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/media`);
      const data = await res.json();
      mediaItems = (data && data.media) ? data.media : [];
      
      const countEl = document.getElementById('media-file-count');
      if (countEl) countEl.textContent = mediaItems.length;

      renderPlaylistTrack();

      if (mediaItems.length > 0) {
        if (currentMediaIndex >= mediaItems.length) currentMediaIndex = 0;
        playMediaItem(currentMediaIndex);
      } else {
        showEmptyState();
      }
    } catch (err) {
      console.warn('Failed to fetch media list:', err);
      showEmptyState();
    }
  };

  function showEmptyState() {
    clearAutoplayTimer();
    const emptyEl = document.getElementById('media-empty-state');
    const imgEl = document.getElementById('media-img-viewer');
    const vidEl = document.getElementById('media-video-viewer');
    const nameEl = document.getElementById('media-current-name');
    const iconEl = document.getElementById('media-current-icon');

    if (emptyEl) emptyEl.style.display = 'flex';
    if (imgEl) imgEl.style.display = 'none';
    if (vidEl) {
      vidEl.pause();
      vidEl.style.display = 'none';
    }
    if (nameEl) nameEl.textContent = 'No Media Loaded';
    if (iconEl) iconEl.textContent = '🖼️';

    const track = document.getElementById('media-playlist-track');
    if (track) {
      track.innerHTML = '<div class="playlist-empty-hint">No images or videos uploaded yet. Share from Mission Planner or tap Upload.</div>';
    }
  }

  function renderPlaylistTrack() {
    const track = document.getElementById('media-playlist-track');
    if (!track) return;

    if (mediaItems.length === 0) {
      track.innerHTML = '<div class="playlist-empty-hint">No media files. Tap "+ Upload" to add items.</div>';
      return;
    }

    track.innerHTML = '';
    mediaItems.forEach((item, idx) => {
      const cardContainer = document.createElement('div');
      cardContainer.className = 'playlist-card-container';
      cardContainer.dataset.index = idx;
      cardContainer.dataset.filename = item.filename;

      const isVideo = item.type === 'video' || item.filename.endsWith('.mp4') || item.filename.endsWith('.webm');
      const icon = isVideo ? '🎬' : '🖼️';
      const badgeClass = isVideo ? 'badge-video' : 'badge-image';
      const typeLabel = isVideo ? 'VIDEO' : 'IMAGE';

      cardContainer.innerHTML = `
        <div class="playlist-card-delete-bg" title="Delete">
          <button class="card-delete-btn" onclick="confirmDeleteMedia('${escapeHtml(item.filename)}')">
            <span>🗑️ Delete</span>
          </button>
        </div>
        <div class="playlist-card-content ${idx === currentMediaIndex ? 'active-card' : ''}" onclick="playMediaItem(${idx})">
          <div class="card-thumb-box">
            ${isVideo 
              ? `<video src="${escapeHtml(item.url)}#t=0.5" preload="metadata" muted playsinline></video><span class="thumb-play-icon">▶</span>` 
              : `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name || item.filename)}" loading="lazy">`
            }
          </div>
          <div class="card-info-box">
            <div class="card-title" title="${escapeHtml(item.name || item.filename)}">${escapeHtml(item.name || item.filename)}</div>
            <div class="card-meta">
              <span class="card-badge ${badgeClass}">${typeLabel}</span>
              <span class="card-size">${formatBytes(item.size)}</span>
            </div>
          </div>
        </div>
      `;

      // Setup touch swipe left on card
      setupCardSwipeGesture(cardContainer);
      track.appendChild(cardContainer);
    });
  }

  // --- Touch Swipe Left on Playlist Card to Reveal Delete ---
  function setupCardSwipeGesture(container) {
    const content = container.querySelector('.playlist-card-content');
    if (!content) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isSwipingCard = false;
    let currentX = 0;

    content.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwipingCard = true;
      }
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
      if (!isSwipingCard || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          // Swiping left: slide card left to reveal delete action
          currentX = Math.max(-85, deltaX);
          content.style.transform = `translateX(${currentX}px)`;
          content.style.transition = 'none';
        } else if (currentX < 0) {
          // Swiping back right
          currentX = Math.min(0, currentX + deltaX);
          content.style.transform = `translateX(${currentX}px)`;
          content.style.transition = 'none';
        }
      }
    }, { passive: true });

    content.addEventListener('touchend', (e) => {
      if (!isSwipingCard) return;
      isSwipingCard = false;
      content.style.transition = 'transform 0.25s ease';

      if (currentX < -40) {
        // Snap open
        content.style.transform = 'translateX(-80px)';
        container.classList.add('delete-revealed');
      } else {
        // Snap closed
        content.style.transform = 'translateX(0)';
        container.classList.remove('delete-revealed');
      }
    });

    // Close on tap outside
    document.addEventListener('touchstart', (e) => {
      if (!container.contains(e.target) && container.classList.contains('delete-revealed')) {
        content.style.transition = 'transform 0.25s ease';
        content.style.transform = 'translateX(0)';
        container.classList.remove('delete-revealed');
      }
    }, { passive: true });
  }

  // --- Play/Display Active Media ---
  window.playMediaItem = function(index) {
    if (!mediaItems || mediaItems.length === 0) {
      showEmptyState();
      return;
    }

    clearAutoplayTimer();
    currentMediaIndex = Math.max(0, Math.min(mediaItems.length - 1, index));
    const item = mediaItems[currentMediaIndex];

    const emptyEl = document.getElementById('media-empty-state');
    const imgEl = document.getElementById('media-img-viewer');
    const vidEl = document.getElementById('media-video-viewer');
    const nameEl = document.getElementById('media-current-name');
    const iconEl = document.getElementById('media-current-icon');

    if (emptyEl) emptyEl.style.display = 'none';

    // Update active highlight in playlist
    document.querySelectorAll('.playlist-card-content').forEach((el, i) => {
      el.classList.toggle('active-card', i === currentMediaIndex);
      // Auto-scroll active card into view
      if (i === currentMediaIndex) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });

    const isVideo = item.type === 'video' || item.filename.endsWith('.mp4') || item.filename.endsWith('.webm');
    if (nameEl) nameEl.textContent = item.name || item.filename;
    if (iconEl) iconEl.textContent = isVideo ? '🎬' : '🖼️';

    if (isVideo) {
      if (imgEl) imgEl.style.display = 'none';
      if (vidEl) {
        vidEl.style.display = 'block';
        vidEl.src = item.url;
        vidEl.style.objectFit = isFitCover ? 'cover' : 'contain';
        vidEl.currentTime = 0;
        vidEl.play().catch(e => console.log('Video autoplay prevented:', e));

        // When video finishes, advance if autoplay is enabled
        vidEl.onended = () => {
          if (isAutoplay) {
            nextMediaItem();
          }
        };
      }
    } else {
      if (vidEl) {
        vidEl.pause();
        vidEl.style.display = 'none';
      }
      if (imgEl) {
        imgEl.style.display = 'block';
        imgEl.src = item.url;
        imgEl.style.objectFit = isFitCover ? 'cover' : 'contain';

        // For images, advance after 7 seconds if autoplay is on
        if (isAutoplay && mediaItems.length > 1) {
          autoplayTimer = setTimeout(() => {
            nextMediaItem();
          }, 7000);
        }
      }
    }
  };

  window.nextMediaItem = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (mediaItems.length === 0) return;
    const nextIdx = (currentMediaIndex + 1) % mediaItems.length;
    playMediaItem(nextIdx);
  };

  window.prevMediaItem = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (mediaItems.length === 0) return;
    const prevIdx = (currentMediaIndex - 1 + mediaItems.length) % mediaItems.length;
    playMediaItem(prevIdx);
  };

  function clearAutoplayTimer() {
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }
  }

  // --- Autoplay Toggle ---
  window.toggleMediaAutoplay = function() {
    isAutoplay = !isAutoplay;
    const btn = document.getElementById('btn-media-autoplay');
    const icon = document.getElementById('media-autoplay-icon');
    const text = document.getElementById('media-autoplay-text');

    if (btn) btn.classList.toggle('btn-primary', isAutoplay);
    if (icon) icon.textContent = isAutoplay ? '⏸' : '▶';
    if (text) text.textContent = isAutoplay ? 'Autoplaying' : 'Autoplay';

    if (isAutoplay) {
      playMediaItem(currentMediaIndex);
      if (window.showToast) window.showToast('Autoplay slideshow started');
    } else {
      clearAutoplayTimer();
      const vidEl = document.getElementById('media-video-viewer');
      if (vidEl) vidEl.onended = null;
      if (window.showToast) window.showToast('Autoplay paused');
    }
  };

  // --- Fit Mode Toggle (Contain vs Cover) ---
  window.toggleMediaFit = function() {
    isFitCover = !isFitCover;
    const imgEl = document.getElementById('media-img-viewer');
    const vidEl = document.getElementById('media-video-viewer');
    const text = document.getElementById('media-fit-text');

    const fitVal = isFitCover ? 'cover' : 'contain';
    if (imgEl) imgEl.style.objectFit = fitVal;
    if (vidEl) vidEl.style.objectFit = fitVal;
    if (text) text.textContent = isFitCover ? 'Fill' : 'Fit';

    if (window.showToast) window.showToast(isFitCover ? 'Display mode: Fill Screen' : 'Display mode: Fit Entire Media');
  };

  // --- Fullscreen Toggle ---
  window.toggleMediaFullscreen = function() {
    const stage = document.getElementById('media-stage-wrapper');
    const icon = document.getElementById('media-fullscreen-icon');
    if (!stage) return;

    stage.classList.toggle('stage-fullscreen');
    const isFull = stage.classList.contains('stage-fullscreen');
    if (icon) icon.textContent = isFull ? '✕' : '⛶';

    if (isFull) {
      if (window.showToast) window.showToast('Fullscreen Preview (Swipe Left to Delete, Tap to Exit)');
    }
  };

  // --- Stage Gestures (Swipe Left to Delete / Prev / Next) ---
  function setupStageGestures() {
    const stage = document.getElementById('media-stage-wrapper');
    if (!stage) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    stage.addEventListener('touchstart', (e) => {
      // Don't intercept button clicks
      if (e.target.closest('button') || e.target.closest('.media-delete-dialog')) return;
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = true;
      }
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
      if (!isSwiping || !e.changedTouches || e.changedTouches.length === 0) return;
      isSwiping = false;

      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;

      if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          // Swipe Left gesture on fullscreen stage:
          // User asked: "screen show to oreviw fullscreena dn swupe left to deleet that file implement"
          if (stage.classList.contains('stage-fullscreen')) {
            confirmDeleteActiveMedia();
          } else {
            nextMediaItem();
          }
        } else {
          // Swipe Right: Previous item
          prevMediaItem();
        }
      }
    });

    // Double tap stage to toggle fullscreen
    let lastTap = 0;
    stage.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.media-delete-dialog')) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        toggleMediaFullscreen();
      }
      lastTap = now;
    });
  }

  // --- Delete File Operations ---
  window.confirmDeleteActiveMedia = function() {
    if (!mediaItems || mediaItems.length === 0) return;
    const item = mediaItems[currentMediaIndex];
    if (item && item.filename) {
      confirmDeleteMedia(item.filename);
    }
  };

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
        // Reload list
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
        // Switch to the newly uploaded item
        playMediaItem(0);
      } else {
        if (window.showToast) window.showToast(`Upload error: ${data.message || 'Failed to upload'}`, true);
      }
    } catch (err) {
      console.error('Upload error:', err);
      if (window.showToast) window.showToast(`Upload failed: ${err.message}`, true);
    } finally {
      // Clear file input so same file can be selected again if needed
      const input = document.getElementById('kiosk-media-upload-input');
      if (input) input.value = '';
    }
  };

})();
