/**
 * Creates an HTML preview page with accurate TikTok UI overlay
 */

import fs from 'fs';
import path from 'path';

/**
 * Generate HTML preview page for a slideshow
 */
export function createPreviewHTML(outputFolder, content, slides) {
  const slidesHTML = slides.map((slide, i) => {
    const imageBase64 = slide.processedImage.toString('base64');
    return `
      <div class="slide" data-slide="${i + 1}">
        <img src="data:image/jpeg;base64,${imageBase64}" alt="Slide ${i + 1}">
        <div class="slide-info">
          <span class="slide-number">${i + 1}</span>
          <span class="slide-text">${slide.text_overlay}</span>
        </div>
      </div>
    `;
  }).join('\n');

  const hashtagsHTML = content.hashtags.map(h => `<span class="hashtag">#${h}</span>`).join(' ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TikTok Preview: ${content.topic}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fff;
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: linear-gradient(135deg, #fe2c55, #25f4ee);
      border-radius: 16px;
    }

    header h1 { font-size: 24px; margin-bottom: 8px; }
    header p { opacity: 0.9; font-size: 14px; }

    .preview-section {
      display: flex;
      gap: 30px;
      flex-wrap: wrap;
    }

    /* Accurate iPhone/TikTok mockup */
    .phone-container {
      flex: 0 0 auto;
      position: sticky;
      top: 20px;
      height: fit-content;
    }

    .phone {
      width: 270px;
      height: 540px; /* 9:16 actual screen ratio (270 * 16/9 = 480) + bezels */
      background: #1a1a1a;
      border-radius: 40px;
      padding: 10px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      position: relative;
      border: 2px solid #333;
    }

    .phone-screen {
      width: 250px;
      height: 520px;
      background: #000;
      border-radius: 32px;
      overflow: hidden;
      position: relative;
    }

    .phone-screen img {
      width: 100%;
      height: 100%;
      object-fit: contain; /* Show full image without cropping */
      background: #000;
    }

    /* Dynamic Island */
    .dynamic-island {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      width: 90px;
      height: 28px;
      background: #000;
      border-radius: 20px;
      z-index: 20;
    }

    /* TikTok UI Overlay */
    .tiktok-ui {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 10;
    }

    /* Right side buttons - positioned at 85% from left, starting 55% down */
    .tiktok-buttons {
      position: absolute;
      right: 10px;
      top: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
    }

    .tiktok-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .tiktok-btn-icon {
      width: 40px;
      height: 40px;
      background: rgba(255,255,255,0.15);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .tiktok-btn-count {
      font-size: 10px;
      color: #fff;
      font-weight: 600;
    }

    /* Profile pic */
    .tiktok-profile {
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, #fe2c55, #25f4ee);
      border-radius: 50%;
      border: 2px solid #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 8px;
    }

    .tiktok-profile-plus {
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 18px;
      height: 18px;
      background: #fe2c55;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
    }

    /* Bottom area - caption, music, etc */
    .tiktok-bottom {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 50px;
      padding: 12px;
      background: linear-gradient(transparent, rgba(0,0,0,0.7));
      padding-bottom: 70px;
    }

    .tiktok-username {
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 6px;
    }

    .tiktok-caption {
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .tiktok-music {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }

    .tiktok-music-icon {
      font-size: 12px;
    }

    .tiktok-music-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 150px;
    }

    /* Bottom nav bar */
    .tiktok-nav {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 50px;
      background: #000;
      display: flex;
      justify-content: space-around;
      align-items: center;
      padding: 0 10px;
    }

    .tiktok-nav-item {
      font-size: 10px;
      text-align: center;
      opacity: 0.7;
    }

    .tiktok-nav-item.active { opacity: 1; }

    .tiktok-nav-icon {
      font-size: 20px;
      margin-bottom: 2px;
    }

    .tiktok-create-btn {
      width: 38px;
      height: 26px;
      background: linear-gradient(90deg, #25f4ee, #fe2c55);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .tiktok-create-btn::before {
      content: '+';
      font-size: 20px;
      font-weight: bold;
      color: #000;
    }

    /* Music disc */
    .tiktok-disc {
      position: absolute;
      right: 10px;
      bottom: 70px;
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #333, #666);
      border-radius: 50%;
      border: 2px solid #444;
      animation: spin 3s linear infinite;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .tiktok-disc::after {
      content: '';
      width: 14px;
      height: 14px;
      background: #000;
      border-radius: 50%;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Slide progress dots */
    .tiktok-progress {
      position: absolute;
      top: 50px;
      left: 12px;
      right: 12px;
      display: flex;
      gap: 4px;
    }

    .tiktok-progress-dot {
      flex: 1;
      height: 2px;
      background: rgba(255,255,255,0.3);
      border-radius: 1px;
    }

    .tiktok-progress-dot.active {
      background: #fff;
    }

    /* Control buttons below phone */
    .phone-controls {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 16px;
    }

    .ctrl-btn {
      padding: 10px 20px;
      background: #222;
      border: none;
      color: #fff;
      border-radius: 20px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
    }

    .ctrl-btn:hover { background: #333; }
    .ctrl-btn.active { background: #fe2c55; }

    /* Toggle UI button */
    .toggle-ui {
      margin-top: 12px;
      text-align: center;
    }

    .toggle-ui label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 12px;
      color: #888;
      cursor: pointer;
    }

    /* Slides grid */
    .slides-section {
      flex: 1;
      min-width: 300px;
    }

    .slides-section h2 {
      margin-bottom: 16px;
      font-size: 18px;
      color: #888;
    }

    .slides-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 30px;
    }

    .slide {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      aspect-ratio: 9/16;
    }

    .slide:hover, .slide.active {
      transform: scale(1.03);
      box-shadow: 0 0 0 3px #fe2c55;
    }

    .slide img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .slide-info {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 8px;
      background: linear-gradient(transparent, rgba(0,0,0,0.8));
      font-size: 10px;
    }

    .slide-number {
      background: #fe2c55;
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: bold;
      margin-right: 6px;
    }

    .slide-text { opacity: 0.8; }

    /* Caption section */
    .caption-section {
      background: #161616;
      border-radius: 16px;
      padding: 20px;
      margin-top: 20px;
    }

    .caption-section h2 {
      font-size: 16px;
      color: #888;
      margin-bottom: 12px;
    }

    .caption-text {
      white-space: pre-wrap;
      line-height: 1.6;
      font-size: 14px;
      margin-bottom: 16px;
    }

    .hashtags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .hashtag {
      background: rgba(37, 244, 238, 0.1);
      color: #25f4ee;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 13px;
    }

    .stats {
      display: flex;
      gap: 20px;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #333;
    }

    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #fe2c55; }
    .stat-label { font-size: 12px; color: #888; }

    /* Action buttons */
    .action-buttons {
      display: flex;
      gap: 12px;
      margin: 20px 0;
      flex-wrap: wrap;
    }

    .action-btn {
      padding: 14px 24px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .copy-btn {
      background: linear-gradient(135deg, #25f4ee, #00d4aa);
      color: #000;
    }

    .copy-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(37, 244, 238, 0.4);
    }

    .download-btn {
      background: linear-gradient(135deg, #fe2c55, #ff6b6b);
      color: #fff;
    }

    .download-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(254, 44, 85, 0.4);
    }

    .action-btn.success {
      background: #22c55e !important;
      color: #fff !important;
    }

    .toast {
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      background: #22c55e;
      color: #fff;
      padding: 14px 28px;
      border-radius: 12px;
      font-weight: 600;
      z-index: 1000;
      animation: fadeInUp 0.3s ease;
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translate(-50%, 20px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }

    footer {
      text-align: center;
      padding: 40px 20px;
      color: #666;
      font-size: 12px;
    }

    footer a { color: #25f4ee; }

    /* Safe zone visualization */
    .safe-zone-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      display: none;
    }

    .safe-zone-overlay.visible {
      display: block;
    }

    .safe-zone-top {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 6.25%; /* 120px / 1920 */
      background: rgba(255, 0, 0, 0.3);
      border-bottom: 2px dashed #ff0000;
    }

    .safe-zone-bottom {
      position: absolute;
      bottom: 50px; /* above nav */
      left: 0;
      right: 0;
      height: 18.2%; /* 350px / 1920 */
      background: rgba(255, 0, 0, 0.3);
      border-top: 2px dashed #ff0000;
    }

    .safe-zone-right {
      position: absolute;
      top: 6.25%;
      right: 0;
      width: 14%; /* ~150px / 1080 */
      bottom: calc(50px + 18.2%);
      background: rgba(255, 165, 0, 0.2);
      border-left: 2px dashed #ffa500;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${content.topic}</h1>
      <p>TikTok Slideshow Preview</p>
    </header>

    <div class="preview-section">
      <div class="phone-container">
        <div class="phone">
          <div class="phone-screen">
            <img id="phone-image" src="data:image/jpeg;base64,${slides[0].processedImage.toString('base64')}" alt="Preview">

            <!-- Dynamic Island -->
            <div class="dynamic-island"></div>

            <!-- TikTok UI Overlay -->
            <div class="tiktok-ui" id="tiktok-ui">
              <!-- Slide progress -->
              <div class="tiktok-progress">
                ${slides.map((_, i) => `<div class="tiktok-progress-dot ${i === 0 ? 'active' : ''}" data-dot="${i}"></div>`).join('')}
              </div>

              <!-- Right side buttons -->
              <div class="tiktok-buttons">
                <div class="tiktok-btn" style="position: relative;">
                  <div class="tiktok-profile">P</div>
                </div>
                <div class="tiktok-btn">
                  <div class="tiktok-btn-icon">❤️</div>
                  <span class="tiktok-btn-count">42.5K</span>
                </div>
                <div class="tiktok-btn">
                  <div class="tiktok-btn-icon">💬</div>
                  <span class="tiktok-btn-count">892</span>
                </div>
                <div class="tiktok-btn">
                  <div class="tiktok-btn-icon">🔖</div>
                  <span class="tiktok-btn-count">2,341</span>
                </div>
                <div class="tiktok-btn">
                  <div class="tiktok-btn-icon">↗️</div>
                  <span class="tiktok-btn-count">Share</span>
                </div>
              </div>

              <!-- Music disc -->
              <div class="tiktok-disc"></div>

              <!-- Bottom caption area -->
              <div class="tiktok-bottom">
                <div class="tiktok-username">@yourbrand</div>
                <div class="tiktok-caption">${content.caption.substring(0, 80)}...</div>
                <div class="tiktok-music">
                  <span class="tiktok-music-icon">🎵</span>
                  <span class="tiktok-music-text">Original sound - generated content</span>
                </div>
              </div>

              <!-- Bottom nav -->
              <div class="tiktok-nav">
                <div class="tiktok-nav-item active">
                  <div class="tiktok-nav-icon">🏠</div>
                  <div>Home</div>
                </div>
                <div class="tiktok-nav-item">
                  <div class="tiktok-nav-icon">🔍</div>
                  <div>Discover</div>
                </div>
                <div class="tiktok-nav-item">
                  <div class="tiktok-create-btn"></div>
                </div>
                <div class="tiktok-nav-item">
                  <div class="tiktok-nav-icon">📥</div>
                  <div>Inbox</div>
                </div>
                <div class="tiktok-nav-item">
                  <div class="tiktok-nav-icon">👤</div>
                  <div>Profile</div>
                </div>
              </div>
            </div>

            <!-- Safe zone overlay (hidden by default) -->
            <div class="safe-zone-overlay" id="safe-zone-overlay">
              <div class="safe-zone-top" title="Top danger zone (120px)"></div>
              <div class="safe-zone-bottom" title="Bottom danger zone (350px)"></div>
              <div class="safe-zone-right" title="Right buttons zone (150px)"></div>
            </div>
          </div>
        </div>

        <div class="phone-controls">
          <button class="ctrl-btn" onclick="prevSlide()">← Prev</button>
          <button class="ctrl-btn active" onclick="playSlides()">▶ Play</button>
          <button class="ctrl-btn" onclick="nextSlide()">Next →</button>
        </div>

        <div class="toggle-ui">
          <label>
            <input type="checkbox" id="toggle-ui-check" checked onchange="toggleUI()">
            Show TikTok UI
          </label>
          <label style="margin-left: 16px;">
            <input type="checkbox" id="toggle-safe-zone" onchange="toggleSafeZone()">
            Show Safe Zones
          </label>
        </div>
      </div>

      <div class="slides-section">
        <h2>All Slides (${slides.length})</h2>
        <div class="slides-grid">
          ${slidesHTML}
        </div>

        <div class="caption-section">
          <h2>Caption</h2>
          <div class="caption-text" id="caption-text">${content.caption}</div>
          <div class="hashtags">${hashtagsHTML}</div>

          <div class="action-buttons">
            <button class="action-btn copy-btn" onclick="copyCaption()">
              📋 Copy Caption + Hashtags
            </button>
            <button class="action-btn download-btn" onclick="downloadAllImages()">
              ⬇️ Download All Images
            </button>
          </div>

          <div class="stats">
            <div class="stat">
              <div class="stat-value">${slides.length}</div>
              <div class="stat-label">Slides</div>
            </div>
            <div class="stat">
              <div class="stat-value">${content.caption.length}</div>
              <div class="stat-label">Caption chars</div>
            </div>
            <div class="stat">
              <div class="stat-value">${content.hashtags.length}</div>
              <div class="stat-label">Hashtags</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer>
      Generated by the Content Gen preview renderer
    </footer>
  </div>

  <script>
    const slides = document.querySelectorAll('.slide');
    const phoneImage = document.getElementById('phone-image');
    const progressDots = document.querySelectorAll('.tiktok-progress-dot');
    let currentSlide = 0;
    let isPlaying = false;
    let playInterval;

    const imageSources = Array.from(slides).map(slide => slide.querySelector('img').src);

    function showSlide(index) {
      currentSlide = index;
      phoneImage.src = imageSources[index];
      slides.forEach((s, i) => s.classList.toggle('active', i === index));
      progressDots.forEach((d, i) => d.classList.toggle('active', i === index));
    }

    function nextSlide() {
      showSlide((currentSlide + 1) % slides.length);
    }

    function prevSlide() {
      showSlide((currentSlide - 1 + slides.length) % slides.length);
    }

    function playSlides() {
      const btn = document.querySelector('.ctrl-btn.active');
      if (isPlaying) {
        clearInterval(playInterval);
        isPlaying = false;
        btn.textContent = '▶ Play';
      } else {
        isPlaying = true;
        btn.textContent = '⏸ Pause';
        playInterval = setInterval(nextSlide, 2500);
      }
    }

    function toggleUI() {
      const ui = document.getElementById('tiktok-ui');
      const checked = document.getElementById('toggle-ui-check').checked;
      ui.style.display = checked ? 'block' : 'none';
    }

    function toggleSafeZone() {
      const overlay = document.getElementById('safe-zone-overlay');
      const checked = document.getElementById('toggle-safe-zone').checked;
      overlay.classList.toggle('visible', checked);
    }

    slides.forEach((slide, i) => {
      slide.addEventListener('click', () => showSlide(i));
    });

    progressDots.forEach((dot, i) => {
      dot.style.cursor = 'pointer';
      dot.style.pointerEvents = 'auto';
      dot.addEventListener('click', () => showSlide(i));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
      if (e.key === ' ') { e.preventDefault(); playSlides(); }
    });

    showSlide(0);

    // Copy caption to clipboard
    function copyCaption() {
      const captionText = document.getElementById('caption-text').innerText;
      navigator.clipboard.writeText(captionText).then(() => {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ Copied!';
        btn.classList.add('success');
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.classList.remove('success');
        }, 2000);
      });
    }

    // Download all images
    function downloadAllImages() {
      const btn = document.querySelector('.download-btn');
      btn.innerHTML = '⏳ Preparing...';

      // Download each slide
      imageSources.forEach((src, index) => {
        const link = document.createElement('a');
        link.href = src;
        link.download = 'slide_' + (index + 1) + '.jpg';
        document.body.appendChild(link);
        setTimeout(() => {
          link.click();
          document.body.removeChild(link);
        }, index * 300); // Stagger downloads
      });

      setTimeout(() => {
        btn.innerHTML = '✅ Downloaded!';
        btn.classList.add('success');
        setTimeout(() => {
          btn.innerHTML = '⬇️ Download All Images';
          btn.classList.remove('success');
        }, 2000);
      }, imageSources.length * 300 + 500);
    }
  </script>
</body>
</html>`;

  const previewPath = path.join(outputFolder, 'preview.html');
  fs.writeFileSync(previewPath, html);

  return previewPath;
}
