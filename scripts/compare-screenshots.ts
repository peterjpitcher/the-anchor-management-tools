import { promises as fs } from 'fs';
import path from 'path';

const SCREENSHOT_BASE = path.join(process.cwd(), 'screenshots');
const COMPARISON_DIR = path.join(SCREENSHOT_BASE, 'comparison');

const PAGES = [
  'login',
  'dashboard',
  'events-list',
  'events-new',
  'customers-list',
  'customers-new',
  'employees-list',
  'invoices-list',
  'private-bookings-list',
  'messages',
  'settings',
  'dashboard-mobile',
  'events-list-mobile',
  'customers-list-mobile',
];

async function ensureDirectoryExists(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function generateComparison() {
  console.log('🔄 Generating screenshot comparison...');
  
  await ensureDirectoryExists(COMPARISON_DIR);

  // Check which screenshots exist
  const availableScreenshots = [];
  for (const page of PAGES) {
    const prodPath = path.join(SCREENSHOT_BASE, 'production', `${page}.png`);
    const devPath = path.join(SCREENSHOT_BASE, 'development', `${page}.png`);
    
    const prodExists = await fileExists(prodPath);
    const devExists = await fileExists(devPath);
    
    if (prodExists || devExists) {
      availableScreenshots.push({
        name: page,
        production: prodExists,
        development: devExists
      });
    }
  }

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Screenshot Comparison - Production vs Development</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
      background: #f5f5f5;
    }
    .header {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 20px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header h1 {
      margin: 0 0 10px 0;
      color: #333;
    }
    .controls {
      display: flex;
      gap: 15px;
      align-items: center;
      margin-top: 15px;
    }
    .controls button {
      background: #4A90E2;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .controls button:hover {
      background: #357ABD;
    }
    .controls select {
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }
    .comparison-container {
      padding: 20px;
    }
    .comparison-section {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 30px;
      overflow: hidden;
    }
    .section-header {
      background: #f8f9fa;
      padding: 15px 20px;
      border-bottom: 1px solid #e9ecef;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #495057;
      margin: 0;
    }
    .view-mode {
      display: flex;
      gap: 10px;
    }
    .view-mode button {
      background: transparent;
      border: 1px solid #ddd;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      color: #666;
    }
    .view-mode button.active {
      background: #4A90E2;
      color: white;
      border-color: #4A90E2;
    }
    .comparison-content {
      position: relative;
      display: flex;
      align-items: flex-start;
      overflow-x: auto;
      background: #fafafa;
    }
    .comparison-content.side-by-side {
      justify-content: space-around;
      padding: 20px;
      gap: 20px;
    }
    .comparison-content.overlay {
      justify-content: center;
      padding: 20px;
    }
    .comparison-content.slider {
      justify-content: center;
      padding: 20px;
    }
    .screenshot-wrapper {
      position: relative;
      flex-shrink: 0;
    }
    .screenshot-label {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      z-index: 10;
    }
    .screenshot-wrapper img {
      max-width: 100%;
      height: auto;
      display: block;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .side-by-side .screenshot-wrapper {
      max-width: 48%;
    }
    .overlay-container {
      position: relative;
      display: inline-block;
    }
    .overlay-container img {
      position: absolute;
      top: 0;
      left: 0;
      transition: opacity 0.3s;
    }
    .overlay-container img:first-child {
      position: relative;
    }
    .slider-container {
      position: relative;
      display: inline-block;
      overflow: hidden;
    }
    .slider-handle {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 4px;
      background: #4A90E2;
      cursor: ew-resize;
      z-index: 10;
      left: 50%;
      transform: translateX(-50%);
    }
    .slider-handle::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 30px;
      height: 30px;
      background: #4A90E2;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .missing-screenshot {
      padding: 100px 50px;
      text-align: center;
      color: #999;
      background: #f5f5f5;
      border: 2px dashed #ddd;
      border-radius: 4px;
    }
    .mobile-section {
      background: #f0f8ff;
    }
    .legend {
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      padding: 15px;
      margin: 20px;
      color: #856404;
    }
    .legend h3 {
      margin-top: 0;
    }
    .legend ul {
      margin: 10px 0;
      padding-left: 25px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Screenshot Comparison - Production vs Development</h1>
    <div class="controls">
      <button onclick="setAllViews('side-by-side')">All Side by Side</button>
      <button onclick="setAllViews('overlay')">All Overlay</button>
      <button onclick="setAllViews('slider')">All Slider</button>
      <select onchange="filterSections(this.value)">
        <option value="all">Show All Pages</option>
        <option value="desktop">Desktop Only</option>
        <option value="mobile">Mobile Only</option>
      </select>
    </div>
  </div>

  <div class="legend">
    <h3>📊 Comparison Guide</h3>
    <ul>
      <li><strong>Side by Side:</strong> View both versions next to each other</li>
      <li><strong>Overlay:</strong> Hover to toggle between versions</li>
      <li><strong>Slider:</strong> Drag the handle to reveal differences</li>
    </ul>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  </div>

  <div class="comparison-container">
    ${availableScreenshots.map(screenshot => {
      const isMobile = screenshot.name.includes('mobile');
      const sectionClass = isMobile ? 'comparison-section mobile-section' : 'comparison-section';
      const displayName = screenshot.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      return `
        <div class="${sectionClass}" data-type="${isMobile ? 'mobile' : 'desktop'}">
          <div class="section-header">
            <h2 class="section-title">${displayName}</h2>
            <div class="view-mode">
              <button class="active" onclick="setViewMode(this, 'side-by-side')">Side by Side</button>
              <button onclick="setViewMode(this, 'overlay')">Overlay</button>
              <button onclick="setViewMode(this, 'slider')">Slider</button>
            </div>
          </div>
          <div class="comparison-content side-by-side" data-page="${screenshot.name}">
            ${screenshot.production ? `
              <div class="screenshot-wrapper">
                <div class="screenshot-label">Production</div>
                <img src="../production/${screenshot.name}.png" alt="Production ${displayName}" />
              </div>
            ` : '<div class="missing-screenshot">No production screenshot available</div>'}
            
            ${screenshot.development ? `
              <div class="screenshot-wrapper">
                <div class="screenshot-label">Development</div>
                <img src="../development/${screenshot.name}.png" alt="Development ${displayName}" />
              </div>
            ` : '<div class="missing-screenshot">No development screenshot available</div>'}
          </div>
        </div>
      `;
    }).join('')}
  </div>

  <script>
    function setViewMode(button, mode) {
      const section = button.closest('.comparison-section');
      const content = section.querySelector('.comparison-content');
      const buttons = section.querySelectorAll('.view-mode button');
      
      buttons.forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      
      content.className = 'comparison-content ' + mode;
      
      if (mode === 'overlay') {
        setupOverlay(content);
      } else if (mode === 'slider') {
        setupSlider(content);
      }
    }
    
    function setAllViews(mode) {
      document.querySelectorAll('.view-mode button').forEach(button => {
        if (button.textContent.toLowerCase().includes(mode.replace('-', ' '))) {
          button.click();
        }
      });
    }
    
    function filterSections(type) {
      document.querySelectorAll('.comparison-section').forEach(section => {
        if (type === 'all') {
          section.style.display = 'block';
        } else if (type === 'desktop' && section.dataset.type === 'desktop') {
          section.style.display = 'block';
        } else if (type === 'mobile' && section.dataset.type === 'mobile') {
          section.style.display = 'block';
        } else {
          section.style.display = 'none';
        }
      });
    }
    
    function setupOverlay(content) {
      const page = content.dataset.page;
      const prodImg = content.querySelector('img[alt*="Production"]');
      const devImg = content.querySelector('img[alt*="Development"]');
      
      if (!prodImg || !devImg) return;
      
      content.innerHTML = \`
        <div class="overlay-container" onmouseover="toggleOverlay(this, true)" onmouseout="toggleOverlay(this, false)">
          <img src="../production/\${page}.png" alt="Production" />
          <img src="../development/\${page}.png" alt="Development" style="opacity: 0;" />
          <div class="screenshot-label">Hover to toggle</div>
        </div>
      \`;
    }
    
    function toggleOverlay(container, showDev) {
      const devImg = container.querySelector('img:last-child');
      devImg.style.opacity = showDev ? '1' : '0';
    }
    
    function setupSlider(content) {
      const page = content.dataset.page;
      const prodImg = content.querySelector('img[alt*="Production"]');
      const devImg = content.querySelector('img[alt*="Development"]');
      
      if (!prodImg || !devImg) return;
      
      content.innerHTML = \`
        <div class="slider-container">
          <img src="../production/\${page}.png" alt="Production" />
          <div style="position: absolute; top: 0; left: 0; width: 50%; overflow: hidden;">
            <img src="../development/\${page}.png" alt="Development" />
          </div>
          <div class="slider-handle" onmousedown="startSliderDrag(event, this)"></div>
          <div class="screenshot-label">Drag to compare</div>
        </div>
      \`;
    }
    
    function startSliderDrag(e, handle) {
      e.preventDefault();
      const container = handle.closest('.slider-container');
      const overlay = container.querySelector('div[style*="overflow"]');
      const rect = container.getBoundingClientRect();
      
      function onMouseMove(e) {
        const x = e.clientX - rect.left;
        const percent = (x / rect.width) * 100;
        const clampedPercent = Math.max(0, Math.min(100, percent));
        
        handle.style.left = clampedPercent + '%';
        overlay.style.width = clampedPercent + '%';
      }
      
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  </script>
</body>
</html>
  `;

  await fs.writeFile(path.join(COMPARISON_DIR, 'index.html'), htmlContent);
  console.log(`\n✅ Comparison page generated!`);
  console.log(`📄 Open: ${path.join(COMPARISON_DIR, 'index.html')}`);
}

// Run the script
generateComparison().catch(console.error);