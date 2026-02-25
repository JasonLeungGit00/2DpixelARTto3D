// =========================
// 3D Pixel Studio V3 (Standalone)
// =========================

// ===== 可選：如要用 Drive（用 GAS 當 API），填入下面兩項 =====
const GAS_API_URL = ""; // 例：https://script.google.com/macros/s/xxxxx/exec
const API_KEY = "";     // 同 GAS backend 設定一致

function driveEnabled() {
  return Boolean(GAS_API_URL && API_KEY);
}

async function apiPost(payload) {
  const res = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ key: API_KEY, ...payload })
  });
  return await res.json();
}

// --- 全域變數 ---
var state = {
  gridW: 16, gridH: 16, pixels: {}, mmScale: 1, layerThickness: 1,
  tool: 'draw', color: '#3b82f6',
  brushSize: 1,
  symmetryX: false, symmetryY: false,
  pencilOnly: false,
  selection: null,
  clipboard: null,
  layers: [],
  activeLayerId: "",
  palettePresets: ['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#f97316', '#a855f7', '#0f172a', '#ffffff'],
  recentColors: [],
  text: { enabled: false, content: 'PIXEL', size: 8, thickness: 1, x: 0, y: 0, color: '#ffffff' },
  hanger: { enabled: false, x: 0, y: -10, radius: 3, thickness: 1, color: '#facc15', style: 'ring' },
  history: [], historyIndex: -1, is3DVisible: true
};

var projectSaveKey = 'pixelStudio_v3_draft';

function makeLayer(name) {
  return {
    id: 'layer_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    name: name,
    visible: true,
    locked: false,
    pixels: {}
  };
}

function ensureLayers() {
  if (!Array.isArray(state.layers) || state.layers.length === 0) {
    state.layers = [makeLayer('Layer 1')];
    state.activeLayerId = state.layers[0].id;
  }
  if (!state.activeLayerId || !state.layers.find(function (l) { return l.id === state.activeLayerId; })) {
    state.activeLayerId = state.layers[0].id;
  }
}

function getActiveLayer() {
  ensureLayers();
  return state.layers.find(function (l) { return l.id === state.activeLayerId; }) || state.layers[0];
}

function recomputePixelsFromLayers() {
  ensureLayers();
  var merged = {};
  state.layers.forEach(function (layer) {
    if (!layer.visible) return;
    for (var key in layer.pixels) merged[key] = layer.pixels[key];
  });
  state.pixels = merged;
}

// --- Split.js ---
var splitInstance = Split(['#split-left', '#split-right'], {
  sizes: [50, 50],
  minSize: [300, 0],
  gutterSize: 8,
  onDragEnd: function () { window.dispatchEvent(new Event('resize')); }
});

document.getElementById('btn-toggle-3d').addEventListener('click', function () {
  state.is3DVisible = !state.is3DVisible;
  if (state.is3DVisible) { splitInstance.setSizes([50, 50]); document.querySelector('.gutter').style.display = 'block'; }
  else { splitInstance.setSizes([100, 0]); document.querySelector('.gutter').style.display = 'none'; }
  window.dispatchEvent(new Event('resize'));
});

// --- 資料夾選擇 ---
var folderModal = document.getElementById('folder-modal');
var folderList = document.getElementById('folder-list');
var folderIdInput = document.getElementById('folder-id');
var folderNameDisplay = document.getElementById('folder-name-display');

document.getElementById('btn-select-folder').addEventListener('click', function () {
  folderModal.classList.remove('hidden');
  loadFolders();
});
document.getElementById('btn-close-folder').addEventListener('click', function () {
  folderModal.classList.add('hidden');
});
document.getElementById('btn-select-root').addEventListener('click', function () {
  folderIdInput.value = "";
  folderNameDisplay.textContent = "預設首頁";
  folderModal.classList.add('hidden');
});

async function loadFolders() {
  // 靜態版未配置 Drive
  if (!driveEnabled()) {
    folderList.innerHTML = '<div class="text-yellow-400 text-center py-4 text-sm"><i class="fas fa-triangle-exclamation"></i> 未配置 Drive API（仍可用本機下載）</div>';
    return;
  }

  folderList.innerHTML = '<div class="text-gray-400 text-center py-4 text-sm"><i class="fas fa-spinner fa-spin"></i> 讀取中...</div>';
  try {
    const data = await apiPost({ action: "getUserFolders" });
    const folders = data.folders || [];
    folderList.innerHTML = '';

    if (folders.length === 0) {
      folderList.innerHTML = '<div class="text-gray-500 text-center py-4 text-sm">無資料夾</div>';
      return;
    }

    folders.forEach(function (f) {
      var div = document.createElement('div');
      div.className = 'folder-item text-gray-200 text-sm';
      div.innerHTML = '<i class="fas fa-folder"></i> ' + f.name;
      div.onclick = function () {
        folderIdInput.value = f.id;
        folderNameDisplay.textContent = f.name;
        folderModal.classList.add('hidden');
      };
      folderList.appendChild(div);
    });
  } catch (err) {
    var msg = (err && err.message) ? err.message : err;
    folderList.innerHTML = '<div class="text-red-400 text-center text-sm">失敗: ' + msg + '</div>';
  }
}

// --- Init Canvas & Three.js ---
var canvas = document.getElementById('pixel-canvas');
var ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
var wrapper = document.getElementById('canvas-bg');

var threeContainer = document.getElementById('three-container');
var scene = new THREE.Scene();
scene.background = new THREE.Color(0x111827);

var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.shadowMap.enabled = true;
threeContainer.appendChild(renderer.domElement);

var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 40, 30);
dirLight.castShadow = true;
scene.add(dirLight);

var artGroup = new THREE.Group();
scene.add(artGroup);

var gridHelper = new THREE.GridHelper(100, 50, 0x444444, 0x222222);
gridHelper.position.y = -0.1;
scene.add(gridHelper);

var loadedFont = null;
var fontLoader = new THREE.FontLoader();
fontLoader.load(
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/fonts/helvetiker_bold.typeface.json',
  function (font) { loadedFont = font; if (state.text.enabled) update3D(); }
);

// 防止打字時 orbit controls 抢事件
document.getElementById('text-content').addEventListener('keydown', function (e) { e.stopPropagation(); });
document.getElementById('project-name').addEventListener('keydown', function (e) { e.stopPropagation(); });

// Export dropdown
var exportBtn = document.getElementById('btn-export-toggle');
var exportDropdown = document.getElementById('export-dropdown');
exportBtn.onclick = function (e) { e.stopPropagation(); exportDropdown.classList.toggle('hidden'); };
exportDropdown.onclick = function (e) { e.stopPropagation(); };
window.addEventListener('click', function () {
  if (!exportDropdown.classList.contains('hidden')) exportDropdown.classList.add('hidden');
});

// iPad：設定面板收合
var controlPanel = document.getElementById('control-panel');
var panelToggleBtn = document.getElementById('btn-panel-toggle');
var panelToggleDockBtn = document.getElementById('btn-panel-toggle-dock');
var controlModeBtn = document.getElementById('btn-control-mode');
var controlModeDockBtn = document.getElementById('btn-control-mode-dock');
var panelToggleLabel = document.getElementById('panel-toggle-label');
var layerListEl = document.getElementById('layer-list');
var paletteSwatchesEl = document.getElementById('palette-swatches');
var recentColorsEl = document.getElementById('recent-colors');
var brushSizeInput = document.getElementById('brush-size');
var symmetryXInput = document.getElementById('symmetry-x');
var symmetryYInput = document.getElementById('symmetry-y');
var pencilOnlyInput = document.getElementById('pencil-only');
var panelAutoManaged = false;
var panelManuallyToggled = false;
var sectionAutoManaged = false;
var controlMode = 'input';

function renderLayerList() {
  if (!layerListEl) return;
  ensureLayers();
  layerListEl.innerHTML = '';
  state.layers.forEach(function (layer) {
    var row = document.createElement('div');
    row.className = 'layer-row' + (layer.id === state.activeLayerId ? ' active' : '');
    row.dataset.layerId = layer.id;
    row.innerHTML =
      '<button class="layer-icon layer-visibility" title="顯示/隱藏"><i class="fas ' + (layer.visible ? 'fa-eye' : 'fa-eye-slash') + '"></i></button>' +
      '<button class="layer-icon layer-lock" title="鎖定"><i class="fas ' + (layer.locked ? 'fa-lock' : 'fa-lock-open') + '"></i></button>' +
      '<div class="truncate text-xs">' + layer.name + '</div>';
    layerListEl.appendChild(row);
  });
}

function renderPalette() {
  if (!paletteSwatchesEl || !recentColorsEl) return;
  paletteSwatchesEl.innerHTML = '';
  recentColorsEl.innerHTML = '';
  state.palettePresets.forEach(function (hex) {
    var b = document.createElement('button');
    b.className = 'swatch-btn';
    b.style.background = hex;
    b.onclick = function () { setCurrentColor(hex); };
    paletteSwatchesEl.appendChild(b);
  });
  state.recentColors.forEach(function (hex) {
    var b = document.createElement('button');
    b.className = 'swatch-btn';
    b.style.background = hex;
    b.onclick = function () { setCurrentColor(hex); };
    recentColorsEl.appendChild(b);
  });
}

function pushRecentColor(hex) {
  if (!hex) return;
  state.recentColors = [hex].concat(state.recentColors.filter(function (c) { return c !== hex; })).slice(0, 12);
  renderPalette();
}

function isTabletLikeViewport() {
  return window.matchMedia('(hover: none), (pointer: coarse), (max-width: 1180px)').matches;
}

function syncPanelToggleLabel() {
  if (!panelToggleLabel || !controlPanel) return;
  panelToggleLabel.textContent = controlPanel.classList.contains('collapsed') ? '展開設定面板' : '收合設定面板';
}

function syncControlModeUi() {
  var sliderMode = controlMode === 'slider';
  document.body.classList.toggle('slider-mode', sliderMode);
  if (controlModeBtn) {
    controlModeBtn.textContent = sliderMode ? '一般模式' : '拉桿模式';
    controlModeBtn.classList.toggle('active', sliderMode);
  }
  if (controlModeDockBtn) {
    controlModeDockBtn.classList.toggle('active', sliderMode);
  }
}

function togglePanel() {
  if (!controlPanel) return;
  panelManuallyToggled = true;
  controlPanel.classList.toggle('collapsed');
  syncPanelToggleLabel();
  window.dispatchEvent(new Event('resize'));
}

if (panelToggleBtn) {
  panelToggleBtn.addEventListener('click', function () {
    togglePanel();
  });
}
if (panelToggleDockBtn) {
  panelToggleDockBtn.addEventListener('click', function () {
    togglePanel();
  });
}
if (controlModeBtn) {
  controlModeBtn.addEventListener('click', function () {
    controlMode = controlMode === 'slider' ? 'input' : 'slider';
    syncControlModeUi();
  });
}
if (controlModeDockBtn) {
  controlModeDockBtn.addEventListener('click', function () {
    controlMode = controlMode === 'slider' ? 'input' : 'slider';
    syncControlModeUi();
  });
}

function getSliderConfig(input) {
  var id = input.id || '';
  var map = {
    'mm-scale': { min: 0.5, max: 20, step: 0.5 },
    'layer-thickness': { min: 0.5, max: 20, step: 0.5 },
    'brush-size': { min: 1, max: 10, step: 1 },
    'text-size': { min: 2, max: 30, step: 0.5 },
    'text-thickness': { min: 0.5, max: 10, step: 0.5 },
    'text-x': { min: -30, max: 30, step: 0.1 },
    'text-y': { min: -30, max: 30, step: 0.1 },
    'hanger-x': { min: -30, max: 30, step: 0.5 },
    'hanger-y': { min: -30, max: 30, step: 0.5 },
    'hanger-r': { min: 0.5, max: 20, step: 0.5 },
    'hanger-t': { min: 0.5, max: 10, step: 0.5 }
  };
  return map[id] || null;
}

function attachModeSliders() {
  if (!controlPanel) return;
  controlPanel.querySelectorAll('input[type="number"]').forEach(function (numInput) {
    var conf = getSliderConfig(numInput);
    if (!conf) return;
    if (numInput.dataset.sliderBound === '1') return;

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'mode-slider';
    slider.min = String(conf.min);
    slider.max = String(conf.max);
    slider.step = String(conf.step);
    slider.value = numInput.value;

    numInput.insertAdjacentElement('afterend', slider);

    slider.addEventListener('input', function () {
      numInput.value = slider.value;
      numInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    numInput.addEventListener('input', function () {
      slider.value = numInput.value;
    });

    numInput.dataset.sliderBound = '1';
  });
}

function refreshModeSliderValues() {
  if (!controlPanel) return;
  controlPanel.querySelectorAll('input[type="number"]').forEach(function (numInput) {
    var slider = numInput.nextElementSibling;
    if (slider && slider.classList && slider.classList.contains('mode-slider')) {
      slider.value = numInput.value;
    }
  });
}

if (layerListEl) {
  layerListEl.addEventListener('click', function (e) {
    var row = e.target.closest('.layer-row');
    if (!row) return;
    var layerId = row.dataset.layerId;
    var layer = state.layers.find(function (l) { return l.id === layerId; });
    if (!layer) return;

    if (e.target.closest('.layer-visibility')) {
      layer.visible = !layer.visible;
      recomputePixelsFromLayers();
      drawCanvas();
      update3D(false);
      renderLayerList();
      return;
    }
    if (e.target.closest('.layer-lock')) {
      layer.locked = !layer.locked;
      renderLayerList();
      return;
    }

    state.activeLayerId = layerId;
    renderLayerList();
  });
}

var btnLayerAdd = document.getElementById('btn-layer-add');
if (btnLayerAdd) btnLayerAdd.addEventListener('click', function () {
  var name = 'Layer ' + (state.layers.length + 1);
  var newLayer = makeLayer(name);
  state.layers.push(newLayer);
  state.activeLayerId = newLayer.id;
  renderLayerList();
  saveHistory();
});

var btnLayerDelete = document.getElementById('btn-layer-delete');
if (btnLayerDelete) btnLayerDelete.addEventListener('click', function () {
  if (state.layers.length <= 1) return;
  var idx = state.layers.findIndex(function (l) { return l.id === state.activeLayerId; });
  if (idx < 0) return;
  state.layers.splice(idx, 1);
  state.activeLayerId = state.layers[Math.max(0, idx - 1)].id;
  recomputePixelsFromLayers();
  renderLayerList();
  drawCanvas();
  update3D(false);
  saveHistory();
});

var btnLayerUp = document.getElementById('btn-layer-up');
if (btnLayerUp) btnLayerUp.addEventListener('click', function () {
  var idx = state.layers.findIndex(function (l) { return l.id === state.activeLayerId; });
  if (idx <= 0) return;
  var t = state.layers[idx - 1];
  state.layers[idx - 1] = state.layers[idx];
  state.layers[idx] = t;
  recomputePixelsFromLayers();
  renderLayerList();
  drawCanvas();
  update3D(false);
  saveHistory();
});

var btnLayerDown = document.getElementById('btn-layer-down');
if (btnLayerDown) btnLayerDown.addEventListener('click', function () {
  var idx = state.layers.findIndex(function (l) { return l.id === state.activeLayerId; });
  if (idx < 0 || idx >= state.layers.length - 1) return;
  var t = state.layers[idx + 1];
  state.layers[idx + 1] = state.layers[idx];
  state.layers[idx] = t;
  recomputePixelsFromLayers();
  renderLayerList();
  drawCanvas();
  update3D(false);
  saveHistory();
});

function setSectionCollapsed(targetId, collapsed) {
  var body = document.getElementById(targetId);
  if (!body) return;
  body.classList.toggle('collapsed', collapsed);
  var trigger = document.querySelector('.panel-section-toggle[data-target="' + targetId + '"]');
  if (trigger) trigger.classList.toggle('is-open', !collapsed);
}

document.querySelectorAll('.panel-section-toggle').forEach(function (btn) {
  btn.addEventListener('click', function () {
    panelManuallyToggled = true;
    var targetId = btn.getAttribute('data-target');
    var body = document.getElementById(targetId);
    if (!body) return;
    var nextCollapsed = !body.classList.contains('collapsed');
    setSectionCollapsed(targetId, nextCollapsed);
    window.dispatchEvent(new Event('resize'));
  });
});

function syncResponsiveUiState() {
  if (!controlPanel) return;
  var isTablet = isTabletLikeViewport();
  if (!isTablet) {
    controlPanel.classList.remove('collapsed');
    panelAutoManaged = false;
    sectionAutoManaged = false;
    setSectionCollapsed('section-canvas-body', false);
    setSectionCollapsed('section-text-body', false);
    setSectionCollapsed('section-hanger-body', false);
    setSectionCollapsed('section-layers-body', false);
    setSectionCollapsed('section-palette-body', false);
  } else if (!panelManuallyToggled && !panelAutoManaged) {
    controlPanel.classList.toggle('collapsed', window.innerHeight < 900);
    panelAutoManaged = true;
  }
  if (isTablet && !sectionAutoManaged) {
    setSectionCollapsed('section-canvas-body', false);
    setSectionCollapsed('section-text-body', true);
    setSectionCollapsed('section-hanger-body', true);
    setSectionCollapsed('section-layers-body', true);
    setSectionCollapsed('section-palette-body', true);
    sectionAutoManaged = true;
  }
  syncPanelToggleLabel();
}

// --- 繪圖邏輯 ---
function initCanvasSize() {
  var rect = wrapper.getBoundingClientRect();
  var size = Math.min(rect.width, rect.height) * 0.95;
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  drawCanvas();
}

function resizeThreeViewport() {
  if (threeContainer.clientWidth > 0 && threeContainer.clientHeight > 0) {
    camera.aspect = threeContainer.clientWidth / threeContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
  }
}

function drawCanvas() {
  var w = canvas.width;
  var cw = w / state.gridW;
  var ch = w / state.gridH;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, w);

  for (var key in state.pixels) {
    var coords = key.split(',');
    var x = parseInt(coords[0]);
    var y = parseInt(coords[1]);
    ctx.fillStyle = state.pixels[key];
    ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
  }

  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var i = 0; i <= state.gridW; i++) { var p = Math.floor(i * cw); ctx.moveTo(p, 0); ctx.lineTo(p, w); }
  for (var i = 0; i <= state.gridH; i++) { var p = Math.floor(i * ch); ctx.moveTo(0, p); ctx.lineTo(w, p); }
  ctx.stroke();

  // 對稱軸可視化
  ctx.setLineDash([6, 4]);
  if (state.symmetryX) {
    var vx = Math.floor((state.gridW / 2) * cw);
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(vx, 0);
    ctx.lineTo(vx, w);
    ctx.stroke();
  }
  if (state.symmetryY) {
    var hy = Math.floor((state.gridH / 2) * ch);
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(0, hy);
    ctx.lineTo(w, hy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 選區可視化
  if (state.selection) {
    var s = normalizeSelection(state.selection);
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(s.x1 * cw, s.y1 * ch, (s.x2 - s.x1 + 1) * cw, (s.y2 - s.y1 + 1) * ch);
    ctx.setLineDash([]);
  }

  // 線段 / 矩形預覽
  if (isDrawing && dragStartPos && drawPreviewPos && (state.tool === 'line' || state.tool === 'rect' || state.tool === 'circle')) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    if (state.tool === 'line') {
      ctx.beginPath();
      ctx.moveTo((dragStartPos.x + 0.5) * cw, (dragStartPos.y + 0.5) * ch);
      ctx.lineTo((drawPreviewPos.x + 0.5) * cw, (drawPreviewPos.y + 0.5) * ch);
      ctx.stroke();
    } else if (state.tool === 'rect') {
      var rx1 = Math.min(dragStartPos.x, drawPreviewPos.x);
      var ry1 = Math.min(dragStartPos.y, drawPreviewPos.y);
      var rx2 = Math.max(dragStartPos.x, drawPreviewPos.x);
      var ry2 = Math.max(dragStartPos.y, drawPreviewPos.y);
      ctx.strokeRect(rx1 * cw, ry1 * ch, (rx2 - rx1 + 1) * cw, (ry2 - ry1 + 1) * ch);
    } else {
      var rdx = drawPreviewPos.x - dragStartPos.x;
      var rdy = drawPreviewPos.y - dragStartPos.y;
      var rr = Math.max(1, Math.sqrt(rdx * rdx + rdy * rdy));
      ctx.beginPath();
      ctx.arc((dragStartPos.x + 0.5) * cw, (dragStartPos.y + 0.5) * ch, rr * cw, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 文字預覽
  if (state.text.enabled) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    var cx = (state.gridW / 2 + parseFloat(state.text.x)) * cw;
    var cy = (state.gridH / 2 + parseFloat(state.text.y)) * ch;
    ctx.strokeRect(cx - 15, cy - 8, 30, 16);
    ctx.setLineDash([]);
  }

  // 掛鉤預覽（radius 係 mm）
  if (state.hanger.enabled) {
    var hx = (state.gridW / 2 + parseFloat(state.hanger.x)) * cw;
    var hy = (state.gridH / 2 + parseFloat(state.hanger.y)) * ch;
    var hr = parseFloat(state.hanger.radius) * (cw / state.mmScale);

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    if (state.hanger.style === 'pixel-square') {
      var px = Math.max(2, parseFloat(state.hanger.thickness) * (cw / state.mmScale));
      ctx.strokeRect(hx - hr, hy - hr, hr * 2, hr * 2);
      ctx.strokeRect(hx - hr + px, hy - hr + px, Math.max(0, hr * 2 - px * 2), Math.max(0, hr * 2 - px * 2));
    } else if (state.hanger.style === 'pixel-diamond') {
      var pxd = Math.max(2, parseFloat(state.hanger.thickness) * (cw / state.mmScale));
      ctx.beginPath();
      ctx.moveTo(hx, hy - hr);
      ctx.lineTo(hx + hr, hy);
      ctx.lineTo(hx, hy + hr);
      ctx.lineTo(hx - hr, hy);
      ctx.closePath();
      ctx.stroke();
      var inr = Math.max(2, hr - pxd);
      ctx.beginPath();
      ctx.moveTo(hx, hy - inr);
      ctx.lineTo(hx + inr, hy);
      ctx.lineTo(hx, hy + inr);
      ctx.lineTo(hx - inr, hy);
      ctx.closePath();
      ctx.stroke();
    } else if (state.hanger.style === 'heart') {
      var s = hr * 0.95;
      ctx.beginPath();
      ctx.moveTo(hx, hy + s * 0.7);
      ctx.bezierCurveTo(hx + s * 1.2, hy - s * 0.1, hx + s * 0.8, hy - s * 1.1, hx, hy - s * 0.45);
      ctx.bezierCurveTo(hx - s * 0.8, hy - s * 1.1, hx - s * 1.2, hy - s * 0.1, hx, hy + s * 0.7);
      ctx.stroke();

      var is = s * 0.55;
      var oy = -0.02 * s;
      ctx.beginPath();
      ctx.moveTo(hx, hy + oy + is * 0.7);
      ctx.bezierCurveTo(hx + is * 1.2, hy + oy - is * 0.1, hx + is * 0.8, hy + oy - is * 1.1, hx, hy + oy - is * 0.45);
      ctx.bezierCurveTo(hx - is * 0.8, hy + oy - is * 1.1, hx - is * 1.2, hy + oy - is * 0.1, hx, hy + oy + is * 0.7);
      ctx.stroke();
    } else if (state.hanger.style === 'double-ring') {
      var gap = Math.max(2, parseFloat(state.hanger.thickness) * (cw / state.mmScale) * 1.5);
      var r2 = Math.max(2, hr - gap);
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, r2, 0, 2 * Math.PI);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
}

// --- 3D 更新 ---
function disposeObject3D(obj) {
  if (obj.geometry) obj.geometry.dispose();
  if (Array.isArray(obj.material)) obj.material.forEach(function (m) { if (m && m.dispose) m.dispose(); });
  else if (obj.material && obj.material.dispose) obj.material.dispose();
}

function clearArtGroup() {
  while (artGroup.children.length) {
    var c = artGroup.children[0];
    artGroup.remove(c);
    disposeObject3D(c);
  }
}

function createDiamondRingShape(outer, inner) {
  var shape = new THREE.Shape();
  shape.moveTo(0, -outer / 2);
  shape.lineTo(outer / 2, 0);
  shape.lineTo(0, outer / 2);
  shape.lineTo(-outer / 2, 0);
  shape.lineTo(0, -outer / 2);
  var hole = new THREE.Path();
  hole.moveTo(0, -inner / 2);
  hole.lineTo(inner / 2, 0);
  hole.lineTo(0, inner / 2);
  hole.lineTo(-inner / 2, 0);
  hole.lineTo(0, -inner / 2);
  shape.holes.push(hole);
  return shape;
}

function createSquareRingShape(outer, inner) {
  var shape = new THREE.Shape();
  shape.moveTo(-outer / 2, -outer / 2);
  shape.lineTo(outer / 2, -outer / 2);
  shape.lineTo(outer / 2, outer / 2);
  shape.lineTo(-outer / 2, outer / 2);
  shape.lineTo(-outer / 2, -outer / 2);
  var hole = new THREE.Path();
  hole.moveTo(-inner / 2, -inner / 2);
  hole.lineTo(inner / 2, -inner / 2);
  hole.lineTo(inner / 2, inner / 2);
  hole.lineTo(-inner / 2, inner / 2);
  hole.lineTo(-inner / 2, -inner / 2);
  shape.holes.push(hole);
  return shape;
}

function createHeartShape(size) {
  var s = size;
  function addHeart(path, hs, oy) {
    path.moveTo(0, (-0.2 * hs) + oy);
    path.bezierCurveTo(0.9 * hs, (-0.9 * hs) + oy, 1.25 * hs, (0.45 * hs) + oy, 0, (1.2 * hs) + oy);
    path.bezierCurveTo(-1.25 * hs, (0.45 * hs) + oy, -0.9 * hs, (-0.9 * hs) + oy, 0, (-0.2 * hs) + oy);
  }
  var shape = new THREE.Shape();
  addHeart(shape, s, 0);

  var hole = new THREE.Path();
  addHeart(hole, s * 0.55, -0.02 * s);
  shape.holes.push(hole);
  return shape;
}

function createHangerMeshes(mm, thick, material) {
  var meshes = [];
  var hRadius = parseFloat(state.hanger.radius);
  var hTube = parseFloat(state.hanger.thickness) / 2;
  var hx = parseFloat(state.hanger.x) * mm;
  var hz = parseFloat(state.hanger.y) * mm;
  var style = state.hanger.style || 'ring';

  if (style === 'pixel-square' || style === 'pixel-diamond') {
    var outer = hRadius * 2;
    var inner = Math.max(0.2, outer - (hTube * 2));
    var shape = style === 'pixel-square' ? createSquareRingShape(outer, inner) : createDiamondRingShape(outer, inner);
    var geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.4, parseFloat(state.hanger.thickness)), bevelEnabled: false });
    var mesh = new THREE.Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(hx, thick / 2, hz);
    meshes.push(mesh);
  } else if (style === 'heart') {
    var hShape = createHeartShape(hRadius * 0.9);
    var hGeo = new THREE.ExtrudeGeometry(hShape, { depth: Math.max(0.4, parseFloat(state.hanger.thickness)), bevelEnabled: false, curveSegments: 24 });
    var hMesh = new THREE.Mesh(hGeo, material);
    hMesh.rotation.x = -Math.PI / 2;
    hMesh.rotation.z = Math.PI;
    hMesh.position.set(hx, thick / 2, hz);
    meshes.push(hMesh);
  } else if (style === 'double-ring') {
    var outerGeo = new THREE.TorusGeometry(hRadius, hTube, 16, 48);
    var outerMesh = new THREE.Mesh(outerGeo, material);
    outerMesh.rotation.x = -Math.PI / 2;
    outerMesh.position.set(hx, thick / 2, hz);
    meshes.push(outerMesh);

    var innerRadius = Math.max(hTube + 0.2, hRadius - Math.max(hTube * 2, 0.8));
    var innerGeo = new THREE.TorusGeometry(innerRadius, hTube, 16, 48);
    var innerMesh = new THREE.Mesh(innerGeo, material);
    innerMesh.rotation.x = -Math.PI / 2;
    innerMesh.position.set(hx, thick / 2, hz);
    meshes.push(innerMesh);
  } else {
    var geo = new THREE.TorusGeometry(hRadius, hTube, 16, 32);
    var mesh = new THREE.Mesh(geo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(hx, thick / 2, hz);
    meshes.push(mesh);
  }

  return meshes;
}

function update3D(fit) {
  clearArtGroup();

  var mm = state.mmScale;
  var thick = state.layerThickness;
  var offX = (state.gridW * mm) / 2;
  var offZ = (state.gridH * mm) / 2;
  var byColor = {};

  // 像素層
  for (var key in state.pixels) {
    var coords = key.split(',');
    var x = parseInt(coords[0]);
    var y = parseInt(coords[1]);
    var hex = state.pixels[key];
    if (!byColor[hex]) byColor[hex] = [];
    byColor[hex].push([x, y]);
  }

  var m4 = new THREE.Matrix4();
  for (var color in byColor) {
    var list = byColor[color];
    var boxGeo = new THREE.BoxGeometry(mm, thick, mm);
    var mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3 });
    mat.name = 'mat_' + color.replace('#', '');
    var inst = new THREE.InstancedMesh(boxGeo, mat, list.length);
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      m4.makeTranslation((p[0] * mm) - offX + (mm / 2), thick / 2, (p[1] * mm) - offZ + (mm / 2));
      inst.setMatrixAt(i, m4);
    }
    inst.castShadow = true;
    inst.receiveShadow = true;
    artGroup.add(inst);
  }

  // 文字層
  if (state.text.enabled && loadedFont && state.text.content) {
    var tGeo = new THREE.TextGeometry(state.text.content, {
      font: loadedFont,
      size: parseFloat(state.text.size),
      height: parseFloat(state.text.thickness),
      curveSegments: 3
    });
    tGeo.computeBoundingBox();
    var tOffX = -0.5 * (tGeo.boundingBox.max.x - tGeo.boundingBox.min.x);
    var tOffZ = -0.5 * (tGeo.boundingBox.max.y - tGeo.boundingBox.min.y);

    var tMat = new THREE.MeshStandardMaterial({ color: state.text.color });
    tMat.name = 'mat_' + state.text.color.replace('#', '');

    var meshT = new THREE.Mesh(tGeo, tMat);
    meshT.rotation.x = -Math.PI / 2;
    meshT.position.set(tOffX + (parseFloat(state.text.x) * mm), thick, tOffZ + (parseFloat(state.text.y) * mm));
    artGroup.add(meshT);
  }

  // 掛鉤圈圈 (Torus) - radius(mm)
  if (state.hanger.enabled) {
    var hMat = new THREE.MeshStandardMaterial({ color: state.hanger.color });
    hMat.name = 'mat_' + state.hanger.color.replace('#', '');
    var hMeshes = createHangerMeshes(mm, thick, hMat);
    hMeshes.forEach(function (mesh) {
      mesh.castShadow = true;
      artGroup.add(mesh);
    });
  }

  if (fit) resetCamera();
}

function createExportGroup() {
  var group = new THREE.Group();
  var mm = state.mmScale;
  var thick = state.layerThickness;
  var offX = (state.gridW * mm) / 2;
  var offZ = (state.gridH * mm) / 2;
  var geo = new THREE.BoxGeometry(mm, thick, mm);
  var mats = {};

  for (var key in state.pixels) {
    var coords = key.split(',');
    var x = parseInt(coords[0], 10);
    var y = parseInt(coords[1], 10);
    var hex = state.pixels[key];
    if (!mats[hex]) {
      mats[hex] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.3 });
      mats[hex].name = 'mat_' + hex.replace('#', '');
    }
    var mesh = new THREE.Mesh(geo, mats[hex]);
    mesh.position.set((x * mm) - offX + (mm / 2), thick / 2, (y * mm) - offZ + (mm / 2));
    group.add(mesh);
  }

  if (state.text.enabled && loadedFont && state.text.content) {
    var tGeo = new THREE.TextGeometry(state.text.content, {
      font: loadedFont,
      size: parseFloat(state.text.size),
      height: parseFloat(state.text.thickness),
      curveSegments: 3
    });
    tGeo.computeBoundingBox();
    var tOffX = -0.5 * (tGeo.boundingBox.max.x - tGeo.boundingBox.min.x);
    var tOffZ = -0.5 * (tGeo.boundingBox.max.y - tGeo.boundingBox.min.y);
    var tMat = new THREE.MeshStandardMaterial({ color: state.text.color });
    tMat.name = 'mat_' + state.text.color.replace('#', '');
    var meshT = new THREE.Mesh(tGeo, tMat);
    meshT.rotation.x = -Math.PI / 2;
    meshT.position.set(tOffX + (parseFloat(state.text.x) * mm), thick, tOffZ + (parseFloat(state.text.y) * mm));
    group.add(meshT);
  }

  if (state.hanger.enabled) {
    var hMat = new THREE.MeshStandardMaterial({ color: state.hanger.color });
    hMat.name = 'mat_' + state.hanger.color.replace('#', '');
    var hMeshes = createHangerMeshes(mm, thick, hMat);
    hMeshes.forEach(function (mesh) { group.add(mesh); });
  }
  return group;
}

function resetCamera() {
  controls.target.set(0, 0, 0);
  var dist = Math.max(state.gridW, state.gridH) * state.mmScale * 1.5;
  camera.position.set(dist, dist * 1.2, dist);
  controls.update();
}

function setView(dir) {
  controls.target.set(0, 0, 0);
  var dist = Math.max(state.gridW, state.gridH) * state.mmScale * 2.5;
  if (dir === 'top') camera.position.set(0, dist, 0);
  if (dir === 'front') camera.position.set(0, 0, dist);
  if (dir === 'right') camera.position.set(dist, 0, 0);
  if (dir === 'left') camera.position.set(-dist, 0, 0);
  controls.update();
}

document.getElementById('view-top').onclick = function () { setView('top'); };
document.getElementById('view-front').onclick = function () { setView('front'); };
document.getElementById('view-right').onclick = function () { setView('right'); };
document.getElementById('view-left').onclick = function () { setView('left'); };
document.getElementById('view-home').onclick = function () { resetCamera(); };

// Canvas resize
document.getElementById('btn-resize').onclick = function () {
  var newW = parseInt(document.getElementById('grid-w').value);
  var newH = parseInt(document.getElementById('grid-h').value);
  if (newW && newH && confirm('重設畫布?')) {
    state.gridW = newW;
    state.gridH = newH;
    state.layers.forEach(function (l) { l.pixels = {}; });
    recomputePixelsFromLayers();
    saveHistory();
    initCanvasSize();
    update3D(true);
  }
};

document.getElementById('layer-thickness').addEventListener('input', function (e) {
  state.layerThickness = parseFloat(e.target.value) || 1;
  update3D(false);
  saveProjectDraft();
});

document.getElementById('mm-scale').addEventListener('input', function (e) {
  state.mmScale = parseFloat(e.target.value) || 1;
  update3D(true);
  saveProjectDraft();
});

// --- 工具切換（top bar + dock 同步）---
function refreshToolUi() {
  document.querySelectorAll('[data-tool]').forEach(function (btn) {
    var isActive = btn.getAttribute('data-tool') === state.tool;
    btn.classList.toggle('bg-blue-600', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-gray-300', !isActive);
    btn.classList.toggle('active', isActive);
  });
}

function setTool(tool) {
  state.tool = tool;
  if (tool !== 'select' && state.selection && !isDrawing) {
    // Keep selection visible only in select mode to reduce accidental move.
    state.selection = null;
    drawCanvas();
  }
  refreshToolUi();
}

document.querySelectorAll('[data-tool]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    setTool(btn.getAttribute('data-tool'));
  });
});

var topColorPicker = document.getElementById('color-picker');
var dockColorPicker = document.getElementById('color-picker-dock');

function setCurrentColor(hex) {
  state.color = hex;
  if (topColorPicker && topColorPicker.value !== hex) topColorPicker.value = hex;
  if (dockColorPicker && dockColorPicker.value !== hex) dockColorPicker.value = hex;
  pushRecentColor(hex);
  saveProjectDraft();
}

topColorPicker.addEventListener('input', function (e) { setCurrentColor(e.target.value); });
if (dockColorPicker) dockColorPicker.addEventListener('input', function (e) { setCurrentColor(e.target.value); });
if (brushSizeInput) brushSizeInput.addEventListener('input', function () {
  state.brushSize = Math.max(1, parseInt(brushSizeInput.value || '1'));
  saveProjectDraft();
});
if (symmetryXInput) symmetryXInput.addEventListener('change', function () {
  state.symmetryX = symmetryXInput.checked;
  saveProjectDraft();
});
if (symmetryYInput) symmetryYInput.addEventListener('change', function () {
  state.symmetryY = symmetryYInput.checked;
  saveProjectDraft();
});
if (pencilOnlyInput) pencilOnlyInput.addEventListener('change', function () {
  state.pencilOnly = pencilOnlyInput.checked;
  saveProjectDraft();
});

// --- 畫布輸入（mouse/touch/pencil） ---
var isDrawing = false;
var activePointerId = null;
var dragStartPos = null;
var drawPreviewPos = null;
var selectionMoveBase = null;

function getGridPos(e) {
  var point = e;
  if (e.touches && e.touches[0]) point = e.touches[0];
  if (e.changedTouches && e.changedTouches[0]) point = e.changedTouches[0];

  var rect = canvas.getBoundingClientRect();
  var gx = (point.clientX - rect.left) / rect.width;
  var gy = (point.clientY - rect.top) / rect.height;
  return { x: Math.floor(gx * state.gridW), y: Math.floor(gy * state.gridH) };
}

function normalizeSelection(sel) {
  return {
    x1: Math.min(sel.x1, sel.x2),
    y1: Math.min(sel.y1, sel.y2),
    x2: Math.max(sel.x1, sel.x2),
    y2: Math.max(sel.y1, sel.y2)
  };
}

function isInsideSelection(pos) {
  if (!state.selection) return false;
  var s = normalizeSelection(state.selection);
  return pos.x >= s.x1 && pos.x <= s.x2 && pos.y >= s.y1 && pos.y <= s.y2;
}

function cloneSelectionPixels(layer, sel) {
  var s = normalizeSelection(sel);
  var out = {};
  for (var y = s.y1; y <= s.y2; y++) {
    for (var x = s.x1; x <= s.x2; x++) {
      var k = x + ',' + y;
      if (k in layer.pixels) out[k] = layer.pixels[k];
    }
  }
  return out;
}

function cloneSelectionRelativePixels(layer, sel) {
  var s = normalizeSelection(sel);
  var out = {};
  for (var y = s.y1; y <= s.y2; y++) {
    for (var x = s.x1; x <= s.x2; x++) {
      var absKey = x + ',' + y;
      if (!(absKey in layer.pixels)) continue;
      out[(x - s.x1) + ',' + (y - s.y1)] = layer.pixels[absKey];
    }
  }
  return out;
}

function clearSelectionPixels(layer, sel) {
  var s = normalizeSelection(sel);
  for (var y = s.y1; y <= s.y2; y++) {
    for (var x = s.x1; x <= s.x2; x++) {
      delete layer.pixels[x + ',' + y];
    }
  }
}

function pasteSelection(layer, pixelsMap, dx, dy) {
  for (var key in pixelsMap) {
    var p = key.split(',');
    var x = parseInt(p[0], 10) + dx;
    var y = parseInt(p[1], 10) + dy;
    if (x < 0 || x >= state.gridW || y < 0 || y >= state.gridH) continue;
    layer.pixels[x + ',' + y] = pixelsMap[key];
  }
}

function copyCurrentSelection() {
  var layer = getActiveLayer();
  if (!layer || !state.selection) return;
  state.clipboard = cloneSelectionPixels(layer, state.selection);
}

function moveCurrentSelectionBy(dx, dy, duplicateOnly) {
  var layer = getActiveLayer();
  if (!layer || layer.locked || !state.selection) return;
  var sel = normalizeSelection(state.selection);
  var block = cloneSelectionPixels(layer, sel);
  if (!duplicateOnly) clearSelectionPixels(layer, sel);
  pasteSelection(layer, block, dx, dy);
  state.selection = { x1: sel.x1 + dx, y1: sel.y1 + dy, x2: sel.x2 + dx, y2: sel.y2 + dy };
  recomputePixelsFromLayers();
  drawCanvas();
  update3D(false);
  saveHistory();
}

function transformSelectionScale(factor) {
  var layer = getActiveLayer();
  if (!layer || layer.locked || !state.selection) return;
  var sel = normalizeSelection(state.selection);
  var rel = cloneSelectionRelativePixels(layer, sel);
  var width = sel.x2 - sel.x1 + 1;
  var height = sel.y2 - sel.y1 + 1;
  var newW = Math.max(1, Math.round(width * factor));
  var newH = Math.max(1, Math.round(height * factor));
  var scaled = {};
  for (var ny = 0; ny < newH; ny++) {
    for (var nx = 0; nx < newW; nx++) {
      var sx = Math.min(width - 1, Math.floor(nx / factor));
      var sy = Math.min(height - 1, Math.floor(ny / factor));
      var color = rel[sx + ',' + sy];
      if (!color) continue;
      scaled[nx + ',' + ny] = color;
    }
  }
  clearSelectionPixels(layer, sel);
  for (var k in scaled) {
    var p = k.split(',');
    var ax = sel.x1 + parseInt(p[0], 10);
    var ay = sel.y1 + parseInt(p[1], 10);
    if (ax < 0 || ax >= state.gridW || ay < 0 || ay >= state.gridH) continue;
    layer.pixels[ax + ',' + ay] = scaled[k];
  }
  state.selection = { x1: sel.x1, y1: sel.y1, x2: sel.x1 + newW - 1, y2: sel.y1 + newH - 1 };
  recomputePixelsFromLayers();
  drawCanvas();
  update3D(false);
  saveHistory();
}

function transformSelectionRotateCW() {
  var layer = getActiveLayer();
  if (!layer || layer.locked || !state.selection) return;
  var sel = normalizeSelection(state.selection);
  var rel = cloneSelectionRelativePixels(layer, sel);
  var width = sel.x2 - sel.x1 + 1;
  var height = sel.y2 - sel.y1 + 1;
  var rotated = {};
  for (var key in rel) {
    var p = key.split(',');
    var x = parseInt(p[0], 10);
    var y = parseInt(p[1], 10);
    var nx = height - 1 - y;
    var ny = x;
    rotated[nx + ',' + ny] = rel[key];
  }
  clearSelectionPixels(layer, sel);
  for (var k in rotated) {
    var rp = k.split(',');
    var ax = sel.x1 + parseInt(rp[0], 10);
    var ay = sel.y1 + parseInt(rp[1], 10);
    if (ax < 0 || ax >= state.gridW || ay < 0 || ay >= state.gridH) continue;
    layer.pixels[ax + ',' + ay] = rotated[k];
  }
  state.selection = { x1: sel.x1, y1: sel.y1, x2: sel.x1 + height - 1, y2: sel.y1 + width - 1 };
  recomputePixelsFromLayers();
  drawCanvas();
  update3D(false);
  saveHistory();
}

function copySelectionToNewLayer() {
  var sourceLayer = getActiveLayer();
  if (!sourceLayer || !state.selection) return;
  var copied = cloneSelectionPixels(sourceLayer, state.selection);
  var newLayer = makeLayer('Layer ' + (state.layers.length + 1));
  newLayer.pixels = copied;
  state.layers.push(newLayer);
  state.activeLayerId = newLayer.id;
  recomputePixelsFromLayers();
  renderLayerList();
  drawCanvas();
  update3D(false);
  saveHistory();
}

function drawLine(layer, from, to, erase) {
  var x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y;
  var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  var err = dx + dy;
  while (true) {
    applyBrush(layer, x0, y0, function (k) {
      if (erase) delete layer.pixels[k];
      else layer.pixels[k] = state.color;
    });
    if (x0 === x1 && y0 === y1) break;
    var e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function drawRect(layer, from, to, erase) {
  var x1 = Math.min(from.x, to.x), y1 = Math.min(from.y, to.y);
  var x2 = Math.max(from.x, to.x), y2 = Math.max(from.y, to.y);
  for (var x = x1; x <= x2; x++) {
    applyBrush(layer, x, y1, function (k) { if (erase) delete layer.pixels[k]; else layer.pixels[k] = state.color; });
    applyBrush(layer, x, y2, function (k) { if (erase) delete layer.pixels[k]; else layer.pixels[k] = state.color; });
  }
  for (var y = y1; y <= y2; y++) {
    applyBrush(layer, x1, y, function (k) { if (erase) delete layer.pixels[k]; else layer.pixels[k] = state.color; });
    applyBrush(layer, x2, y, function (k) { if (erase) delete layer.pixels[k]; else layer.pixels[k] = state.color; });
  }
}

function drawCircle(layer, from, to, erase) {
  var dx = to.x - from.x;
  var dy = to.y - from.y;
  var r = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
  var x = r, y = 0;
  var err = 1 - r;
  while (x >= y) {
    var pts = [
      [from.x + x, from.y + y], [from.x + y, from.y + x],
      [from.x - y, from.y + x], [from.x - x, from.y + y],
      [from.x - x, from.y - y], [from.x - y, from.y - x],
      [from.x + y, from.y - x], [from.x + x, from.y - y]
    ];
    pts.forEach(function (pt) {
      applyBrush(layer, pt[0], pt[1], function (k) {
        if (erase) delete layer.pixels[k];
        else layer.pixels[k] = state.color;
      });
    });
    y++;
    if (err < 0) err += 2 * y + 1;
    else { x--; err += 2 * (y - x + 1); }
  }
}

function startDrawing(e) {
  if (typeof e.isPrimary === 'boolean' && !e.isPrimary) return;
  if (state.pencilOnly && e.pointerType !== 'pen') return;
  e.preventDefault();
  isDrawing = true;
  dragStartPos = getGridPos(e);
  drawPreviewPos = dragStartPos;
  selectionMoveBase = null;
  activePointerId = e.pointerId || null;
  if (canvas.setPointerCapture && e.pointerId !== undefined) {
    canvas.setPointerCapture(e.pointerId);
  }
  if (state.tool === 'select') {
    if (state.selection && isInsideSelection(dragStartPos)) {
      selectionMoveBase = cloneSelectionPixels(getActiveLayer(), state.selection);
    } else {
      state.selection = { x1: dragStartPos.x, y1: dragStartPos.y, x2: dragStartPos.x, y2: dragStartPos.y };
      drawCanvas();
    }
    return;
  }
  saveHistory();
  if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'circle') return;
  handleAction(dragStartPos);
}

function moveDrawing(e) {
  if (!isDrawing) return;
  if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
  e.preventDefault();
  var pos = getGridPos(e);
  drawPreviewPos = pos;
  if (state.tool === 'select') {
    if (selectionMoveBase && state.selection && dragStartPos) {
      var layer = getActiveLayer();
      if (!layer || layer.locked) return;
      var s = normalizeSelection(state.selection);
      var dx = pos.x - dragStartPos.x;
      var dy = pos.y - dragStartPos.y;
      clearSelectionPixels(layer, s);
      pasteSelection(layer, selectionMoveBase, dx, dy);
      state.selection = { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
      recomputePixelsFromLayers();
      drawCanvas();
    } else if (state.selection) {
      state.selection.x2 = pos.x;
      state.selection.y2 = pos.y;
      drawCanvas();
    }
    return;
  }
  if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'circle') {
    drawCanvas();
    return;
  }
  if (state.tool === 'fill') return;
  handleAction(pos);
}

function endDrawing(e) {
  if (!isDrawing) return;
  if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
  var pos = e ? getGridPos(e) : drawPreviewPos;
  if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'circle') {
    var layer = getActiveLayer();
    if (layer && !layer.locked && dragStartPos && pos) {
      if (state.tool === 'line') drawLine(layer, dragStartPos, pos, false);
      if (state.tool === 'rect') drawRect(layer, dragStartPos, pos, false);
      if (state.tool === 'circle') drawCircle(layer, dragStartPos, pos, false);
      recomputePixelsFromLayers();
      drawCanvas();
      update3D(false);
    }
  } else if (state.tool === 'select') {
    if (selectionMoveBase) {
      recomputePixelsFromLayers();
      drawCanvas();
      update3D(false);
      saveHistory();
    } else if (state.selection) {
      state.selection = normalizeSelection(state.selection);
      drawCanvas();
    }
  }
  isDrawing = false;
  activePointerId = null;
  dragStartPos = null;
  drawPreviewPos = null;
  selectionMoveBase = null;
  if (state.tool !== 'fill' && state.tool !== 'select' && state.tool !== 'line' && state.tool !== 'rect' && state.tool !== 'circle') {
    update3D(false);
  }
  if (state.tool !== 'fill') saveProjectDraft();
}

canvas.addEventListener('pointerdown', startDrawing, { passive: false });
canvas.addEventListener('pointermove', moveDrawing, { passive: false });
window.addEventListener('pointerup', endDrawing);
window.addEventListener('pointercancel', endDrawing);

function handleAction(pos) {
  var x = pos.x, y = pos.y;
  if (x < 0 || x >= state.gridW || y < 0 || y >= state.gridH) return;
  var layer = getActiveLayer();
  if (!layer || layer.locked) return;

  if (state.tool === 'draw') {
    applyBrush(layer, x, y, function (k) { layer.pixels[k] = state.color; });
    recomputePixelsFromLayers();
    drawCanvas();
  } else if (state.tool === 'erase') {
    applyBrush(layer, x, y, function (k) { delete layer.pixels[k]; });
    recomputePixelsFromLayers();
    drawCanvas();
  } else if (state.tool === 'fill') {
    floodFillLayer(layer, x, y, state.color);
    recomputePixelsFromLayers();
    drawCanvas();
    update3D(false);
    isDrawing = false;
    saveProjectDraft();
  }
}

function getSymmetricPoints(x, y) {
  var out = [[x, y]];
  if (state.symmetryX) out.push([state.gridW - 1 - x, y]);
  if (state.symmetryY) out.push([x, state.gridH - 1 - y]);
  if (state.symmetryX && state.symmetryY) out.push([state.gridW - 1 - x, state.gridH - 1 - y]);
  var seen = {};
  return out.filter(function (p) {
    var k = p[0] + ',' + p[1];
    if (seen[k]) return false;
    seen[k] = true;
    return p[0] >= 0 && p[0] < state.gridW && p[1] >= 0 && p[1] < state.gridH;
  });
}

function applyBrush(layer, cx, cy, applyFn) {
  var size = Math.max(1, parseInt(state.brushSize || 1));
  getSymmetricPoints(cx, cy).forEach(function (point) {
    var ox = point[0], oy = point[1];
    var r = Math.floor(size / 2);
    for (var dx = -r; dx <= r; dx++) {
      for (var dy = -r; dy <= r; dy++) {
        var x = ox + dx;
        var y = oy + dy;
        if (x < 0 || x >= state.gridW || y < 0 || y >= state.gridH) continue;
        applyFn(x + ',' + y);
      }
    }
  });
}

// 更穩 fill：空白都當一種顏色（針對目前圖層）
function floodFillLayer(layer, sx, sy, tColor) {
  var startKey = sx + ',' + sy;
  var oldColor = (startKey in layer.pixels) ? layer.pixels[startKey] : '__EMPTY__';
  if (oldColor === tColor) return;

  getSymmetricPoints(sx, sy).forEach(function (seed) {
    floodFillSingle(layer, seed[0], seed[1], oldColor, tColor);
  });
}

function floodFillSingle(layer, sx, sy, oldColor, tColor) {
  var q = [[sx, sy]];
  var visited = new Set();
  while (q.length) {
    var curr = q.pop();
    var x = curr[0], y = curr[1];
    if (x < 0 || x >= state.gridW || y < 0 || y >= state.gridH) continue;

    var k = x + ',' + y;
    if (visited.has(k)) continue;
    visited.add(k);

    var curColor = (k in layer.pixels) ? layer.pixels[k] : '__EMPTY__';
    if (curColor !== oldColor) continue;

    layer.pixels[k] = tColor;
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

// --- Undo / Redo ---
function saveHistory() {
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }

  state.history.push(JSON.stringify({
    pixels: state.pixels,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    gridW: state.gridW, gridH: state.gridH,
    mmScale: state.mmScale, layerThickness: state.layerThickness,
    brushSize: state.brushSize,
    symmetryX: state.symmetryX,
    symmetryY: state.symmetryY,
    pencilOnly: state.pencilOnly,
    recentColors: state.recentColors,
    palettePresets: state.palettePresets,
    text: state.text, hanger: state.hanger,
    tool: state.tool, color: state.color
  }));

  state.historyIndex++;
  if (state.history.length > 30) { state.history.shift(); state.historyIndex--; }
  saveProjectDraft();
}

function loadHistory() {
  var d = JSON.parse(state.history[state.historyIndex]);
  state.selection = null;
  state.layers = d.layers || [makeLayer('Layer 1')];
  state.activeLayerId = d.activeLayerId || (state.layers[0] && state.layers[0].id);
  ensureLayers();
  state.pixels = d.pixels || {};
  state.gridW = d.gridW || 16;
  state.gridH = d.gridH || 16;
  state.mmScale = d.mmScale || 1;
  state.layerThickness = d.layerThickness || 1;
  state.brushSize = d.brushSize || 1;
  state.symmetryX = Boolean(d.symmetryX);
  state.symmetryY = Boolean(d.symmetryY);
  state.pencilOnly = Boolean(d.pencilOnly);
  state.recentColors = d.recentColors || state.recentColors || [];
  state.palettePresets = d.palettePresets || state.palettePresets;
  state.text = d.text || state.text;
  state.hanger = d.hanger || state.hanger;
  if (!state.hanger.style) state.hanger.style = 'ring';
  if (d.color) state.color = d.color;
  if (d.tool) state.tool = d.tool;
  recomputePixelsFromLayers();

  document.getElementById('grid-w').value = state.gridW;
  document.getElementById('grid-h').value = state.gridH;
  document.getElementById('mm-scale').value = state.mmScale;
  document.getElementById('layer-thickness').value = state.layerThickness;
  if (brushSizeInput) brushSizeInput.value = state.brushSize;
  if (symmetryXInput) symmetryXInput.checked = state.symmetryX;
  if (symmetryYInput) symmetryYInput.checked = state.symmetryY;
  if (pencilOnlyInput) pencilOnlyInput.checked = state.pencilOnly;
  document.getElementById('hanger-style').value = state.hanger.style || 'ring';

  syncEnableBoxes();
  setCurrentColor(state.color);
  setTool(state.tool);
  renderLayerList();
  renderPalette();
  refreshModeSliderValues();
  initCanvasSize();
  drawCanvas();
  update3D(false);
}

function undoAction() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    loadHistory();
  }
}

function redoAction() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    loadHistory();
  }
}

document.getElementById('btn-undo').onclick = undoAction;
document.getElementById('btn-redo').onclick = redoAction;
var btnUndoDock = document.getElementById('btn-undo-dock');
var btnRedoDock = document.getElementById('btn-redo-dock');
if (btnUndoDock) btnUndoDock.onclick = undoAction;
if (btnRedoDock) btnRedoDock.onclick = redoAction;

function copySelectionAction() {
  if (!state.selection) return;
  copyCurrentSelection();
  moveCurrentSelectionBy(1, 1, true);
}
function selectionScaleUpAction() { transformSelectionScale(2); }
function selectionScaleDownAction() { transformSelectionScale(0.5); }
function selectionRotateAction() { transformSelectionRotateCW(); }
function selectionToLayerAction() { copySelectionToNewLayer(); }

document.getElementById('btn-copy-selection').onclick = copySelectionAction;
document.getElementById('btn-selection-scale-up').onclick = selectionScaleUpAction;
document.getElementById('btn-selection-scale-down').onclick = selectionScaleDownAction;
document.getElementById('btn-selection-rotate').onclick = selectionRotateAction;
document.getElementById('btn-selection-to-layer').onclick = selectionToLayerAction;
var btnCopyDock = document.getElementById('btn-copy-selection-dock');
var btnScaleUpDock = document.getElementById('btn-selection-scale-up-dock');
var btnScaleDownDock = document.getElementById('btn-selection-scale-down-dock');
var btnRotateDock = document.getElementById('btn-selection-rotate-dock');
var btnToLayerDock = document.getElementById('btn-selection-to-layer-dock');
if (btnCopyDock) btnCopyDock.onclick = copySelectionAction;
if (btnScaleUpDock) btnScaleUpDock.onclick = selectionScaleUpAction;
if (btnScaleDownDock) btnScaleDownDock.onclick = selectionScaleDownAction;
if (btnRotateDock) btnRotateDock.onclick = selectionRotateAction;
if (btnToLayerDock) btnToLayerDock.onclick = selectionToLayerAction;

// --- 匯出/儲存 ---
function getFileName() {
  var name = document.getElementById('project-name').value;
  return name ? name : 'Untitled';
}

function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onloadend = function () { resolve(reader.result.split(',')[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function exportGlbBlob(group) {
  return new Promise(function (resolve, reject) {
    try {
      var exporter = new THREE.GLTFExporter();
      exporter.parse(
        group,
        function (result) {
          try {
            if (result instanceof ArrayBuffer) {
              resolve(new Blob([result], { type: 'model/gltf-binary' }));
            } else {
              // fallback, should be ArrayBuffer when binary:true
              resolve(new Blob([JSON.stringify(result)], { type: 'application/json' }));
            }
          } catch (e) { reject(e); }
        },
        function (err) { reject(err); },
        { binary: true }
      );
    } catch (e) {
      reject(e);
    }
  });
}

function saveProjectDraft() {
  try {
    var snapshot = JSON.stringify({
      gridW: state.gridW,
      gridH: state.gridH,
      mmScale: state.mmScale,
      layerThickness: state.layerThickness,
      brushSize: state.brushSize,
      symmetryX: state.symmetryX,
      symmetryY: state.symmetryY,
      pencilOnly: state.pencilOnly,
      tool: state.tool,
      color: state.color,
      layers: state.layers,
      activeLayerId: state.activeLayerId,
      text: state.text,
      hanger: state.hanger,
      recentColors: state.recentColors,
      palettePresets: state.palettePresets,
      updatedAt: Date.now()
    });
    localStorage.setItem(projectSaveKey, snapshot);
  } catch (e) {}
}

function restoreProjectDraft() {
  try {
    var raw = localStorage.getItem(projectSaveKey);
    if (!raw) return false;
    var d = JSON.parse(raw);
    state.gridW = d.gridW || state.gridW;
    state.gridH = d.gridH || state.gridH;
    state.mmScale = d.mmScale || state.mmScale;
    state.layerThickness = d.layerThickness || state.layerThickness;
    state.brushSize = d.brushSize || state.brushSize;
    state.symmetryX = Boolean(d.symmetryX);
    state.symmetryY = Boolean(d.symmetryY);
    state.pencilOnly = Boolean(d.pencilOnly);
    state.selection = null;
    state.tool = d.tool || state.tool;
    state.color = d.color || state.color;
    state.layers = d.layers || state.layers;
    state.activeLayerId = d.activeLayerId || state.activeLayerId;
    state.text = d.text || state.text;
    state.hanger = d.hanger || state.hanger;
    if (!state.hanger.style) state.hanger.style = 'ring';
    state.recentColors = d.recentColors || state.recentColors;
    state.palettePresets = d.palettePresets || state.palettePresets;
    ensureLayers();
    recomputePixelsFromLayers();
    return true;
  } catch (e) {
    return false;
  }
}

async function exportAllLocalZip() {
  if (Object.keys(state.pixels).length === 0) return alert('空畫布');
  document.getElementById('export-dropdown').classList.add('hidden');
  var loading = document.getElementById('loading');
  var loadingText = document.getElementById('loading-text');
  loading.classList.remove('hidden');
  loadingText.innerText = '打包全部格式...';
  try {
    var fname = getFileName();
    var zip = new JSZip();

    zip.file(fname + '.json', JSON.stringify(state));

    var exportGroup = createExportGroup();
    var stlData = new THREE.STLExporter().parse(exportGroup, { binary: true });
    zip.file(fname + '.stl', stlData);

    var glbBlob = await exportGlbBlob(exportGroup);
    zip.file(fname + '.glb', glbBlob);

    var exporter = new THREE.OBJExporter();
    var objContent = exporter.parse(exportGroup);
    objContent = "mtllib " + fname + ".mtl\n" + objContent;
    var usedColors = new Set();
    for (var key in state.pixels) usedColors.add(state.pixels[key]);
    if (state.text.enabled) usedColors.add(state.text.color);
    if (state.hanger.enabled) usedColors.add(state.hanger.color);
    var mtlContent = "";
    usedColors.forEach(function (hex) {
      var c = new THREE.Color(hex);
      var name = 'mat_' + hex.replace('#', '');
      mtlContent += "newmtl " + name + "\nKd " + c.r + " " + c.g + " " + c.b + "\nd 1.0\n\n";
    });
    zip.file(fname + '.obj', objContent);
    zip.file(fname + '.mtl', mtlContent);
    exportGroup.traverse(disposeObject3D);

    var blob = await zip.generateAsync({ type: 'blob' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fname + '_all.zip';
    link.click();
  } finally {
    loading.classList.add('hidden');
  }
}
window.exportAllLocalZip = exportAllLocalZip;

async function exportTo(destination, type) {
  if (Object.keys(state.pixels).length === 0) return alert('空畫布');

  document.getElementById('export-dropdown').classList.add('hidden');

  var loading = document.getElementById('loading');
  var loadingText = document.getElementById('loading-text');
  loading.classList.remove('hidden');
  loadingText.innerText = (destination === 'drive' ? '上傳到雲端...' : '準備下載...');

  var fname = getFileName();
  var contentBlob, filename, mime, isBinary = false;

  if (type === 'json') {
    var jsonStr = JSON.stringify(state);
    contentBlob = new Blob([jsonStr], { type: 'application/json' });
    filename = fname + '.json';
    mime = 'application/json';
  } else if (type === 'stl') {
    var stlGroup = createExportGroup();
    var stlData = new THREE.STLExporter().parse(stlGroup, { binary: true });
    stlGroup.traverse(disposeObject3D);
    contentBlob = new Blob([stlData], { type: 'application/octet-stream' });
    filename = fname + '.stl';
    mime = 'application/octet-stream';
    isBinary = true;
  } else if (type === 'obj') {
    var exporter = new THREE.OBJExporter();
    var objGroup = createExportGroup();
    var objContent = exporter.parse(objGroup);
    objGroup.traverse(disposeObject3D);

    // 加 mtllib，令 viewer 更易讀到 mtl
    objContent = "mtllib " + fname + ".mtl\n" + objContent;

    var usedColors = new Set();
    for (var key in state.pixels) usedColors.add(state.pixels[key]);
    if (state.text.enabled) usedColors.add(state.text.color);
    if (state.hanger.enabled) usedColors.add(state.hanger.color);

    var mtlContent = "";
    usedColors.forEach(function (hex) {
      var c = new THREE.Color(hex);
      var name = 'mat_' + hex.replace('#', '');
      mtlContent += "newmtl " + name + "\nKd " + c.r + " " + c.g + " " + c.b + "\nd 1.0\n\n";
    });

    var zip = new JSZip();
    zip.file(fname + ".obj", objContent);
    zip.file(fname + ".mtl", mtlContent);

    contentBlob = await zip.generateAsync({ type: "blob" });
    filename = fname + "_obj.zip";
    mime = 'application/zip';
    isBinary = true;
  } else if (type === 'glb') {
    var glbGroup = createExportGroup();
    contentBlob = await exportGlbBlob(glbGroup);
    glbGroup.traverse(disposeObject3D);
    filename = fname + '.glb';
    mime = 'model/gltf-binary';
    isBinary = true;
  }

  if (destination === 'local') {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(contentBlob);
    link.download = filename;
    link.click();
    loading.classList.add('hidden');
    return;
  }

  // Drive（可選）
  if (!driveEnabled()) {
    loading.classList.add('hidden');
    alert('未配置 Drive API（仍可用「下載到本機」）');
    return;
  }

  try {
    var folderId = document.getElementById('folder-id').value;
    var dataToSend = isBinary ? await blobToBase64(contentBlob) : await contentBlob.text();

    const res = await apiPost({
      action: "saveFileToDrive",
      data: dataToSend,
      filename: filename,
      mimeType: mime,
      isBase64: isBinary,
      folderId: folderId
    });

    loading.classList.add('hidden');
    if (res.status === 'success') alert('成功儲存到雲端！\n檔名: ' + res.name);
    else alert('儲存失敗: ' + res.message);
  } catch (err) {
    loading.classList.add('hidden');
    var msg = (err && err.message) ? err.message : err;
    alert('系統錯誤: ' + msg);
  }
}
window.exportTo = exportTo;

// --- 從電腦讀取 JSON ---
document.getElementById('file-input').onchange = function (e) {
  document.getElementById('export-dropdown').classList.add('hidden');
  var r = new FileReader();
  r.onload = function (evt) {
    try {
      var d = JSON.parse(evt.target.result);
      state.selection = null;

      state.layers = d.layers || [];
      state.activeLayerId = d.activeLayerId || '';
      if (!state.layers.length) {
        var base = makeLayer('Layer 1');
        base.pixels = d.pixels || {};
        state.layers = [base];
        state.activeLayerId = base.id;
      }
      ensureLayers();
      state.pixels = d.pixels || {};
      state.gridW = d.gridW || 16;
      state.gridH = d.gridH || 16;
      state.mmScale = d.mmScale || 1;
      state.layerThickness = d.layerThickness || 1;
      state.brushSize = d.brushSize || 1;
      state.symmetryX = Boolean(d.symmetryX);
      state.symmetryY = Boolean(d.symmetryY);
      state.pencilOnly = Boolean(d.pencilOnly);
      state.recentColors = d.recentColors || state.recentColors || [];
      state.palettePresets = d.palettePresets || state.palettePresets;
      state.text = d.text || state.text;
      if (d.hanger) state.hanger = d.hanger;
      if (!state.hanger.style) state.hanger.style = 'ring';
      if (d.color) state.color = d.color;
      if (d.tool) state.tool = d.tool;
      recomputePixelsFromLayers();

      document.getElementById('grid-w').value = state.gridW;
      document.getElementById('grid-h').value = state.gridH;
      document.getElementById('mm-scale').value = state.mmScale;
      document.getElementById('layer-thickness').value = state.layerThickness;
      if (brushSizeInput) brushSizeInput.value = state.brushSize;
      if (symmetryXInput) symmetryXInput.checked = state.symmetryX;
      if (symmetryYInput) symmetryYInput.checked = state.symmetryY;
      if (pencilOnlyInput) pencilOnlyInput.checked = state.pencilOnly;
      document.getElementById('hanger-style').value = state.hanger.style || 'ring';

      syncEnableBoxes();
      setCurrentColor(state.color);
      setTool(state.tool);
      renderLayerList();
      renderPalette();
      refreshModeSliderValues();
      initCanvasSize();
      update3D(true);
      saveHistory();
    } catch (err) {
      alert('JSON 讀取錯誤');
    }
  };
  if (e.target.files[0]) r.readAsText(e.target.files[0]);
  e.target.value = '';
};

// --- Text & Hanger UI Sync（修正：要 toggle pointer-events-none）---
function syncEnableBoxes() {
  var tBox = document.getElementById('text-controls');
  tBox.classList.toggle('opacity-50', !state.text.enabled);
  tBox.classList.toggle('pointer-events-none', !state.text.enabled);

  var hBox = document.getElementById('hanger-controls');
  hBox.classList.toggle('opacity-50', !state.hanger.enabled);
  hBox.classList.toggle('pointer-events-none', !state.hanger.enabled);
}

document.getElementById('text-enable').onchange = function (e) {
  state.text.enabled = e.target.checked;
  syncEnableBoxes();
  drawCanvas();
  update3D(false);
  saveProjectDraft();
};

['text-content', 'text-size', 'text-thickness', 'text-x', 'text-y', 'text-color'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', function () {
    state.text[id.replace('text-', '')] = document.getElementById(id).value;
    drawCanvas();
    update3D(false);
    saveProjectDraft();
  });
});

document.getElementById('hanger-enable').onchange = function (e) {
  state.hanger.enabled = e.target.checked;
  syncEnableBoxes();
  drawCanvas();
  update3D(false);
  saveProjectDraft();
};

['hanger-x', 'hanger-y', 'hanger-r', 'hanger-t'].forEach(function (id) {
  document.getElementById(id).addEventListener('input', function () {
    var prop = id.replace('hanger-', '');
    if (prop === 'r') prop = 'radius';
    if (prop === 't') prop = 'thickness';
    state.hanger[prop] = parseFloat(this.value);
    drawCanvas();
    update3D(false);
    saveProjectDraft();
  });
});
document.getElementById('hanger-style').addEventListener('change', function () {
  state.hanger.style = this.value || 'ring';
  drawCanvas();
  update3D(false);
  saveProjectDraft();
});

document.getElementById('hanger-color').addEventListener('input', function () {
  state.hanger.color = this.value;
  update3D(false);
  saveProjectDraft();
});

// --- resize / render loop ---
window.addEventListener('resize', function () {
  syncResponsiveUiState();
  initCanvasSize();
  resizeThreeViewport();
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// --- Init ---
(function init() {
  ensureLayers();
  var restored = restoreProjectDraft();
  if (!restored) {
    var cx = Math.floor(state.gridW / 2);
    var cy = Math.floor(state.gridH / 2);
    getActiveLayer().pixels[cx + ',' + cy] = state.color;
    recomputePixelsFromLayers();
  }

  saveHistory();
  syncResponsiveUiState();
  syncEnableBoxes();
  attachModeSliders();
  syncControlModeUi();
  renderLayerList();
  renderPalette();
  refreshModeSliderValues();
  if (brushSizeInput) brushSizeInput.value = state.brushSize;
  if (symmetryXInput) symmetryXInput.checked = state.symmetryX;
  if (symmetryYInput) symmetryYInput.checked = state.symmetryY;
  if (pencilOnlyInput) pencilOnlyInput.checked = state.pencilOnly;
  document.getElementById('hanger-style').value = state.hanger.style || 'ring';
  document.getElementById('grid-w').value = state.gridW;
  document.getElementById('grid-h').value = state.gridH;
  document.getElementById('mm-scale').value = state.mmScale;
  document.getElementById('layer-thickness').value = state.layerThickness;
  initCanvasSize();
  resizeThreeViewport();
  update3D(true);
  animate();

  setCurrentColor(state.color);
  setTool(state.tool);
})();
