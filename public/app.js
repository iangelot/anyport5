// ===================================================================
// AnyPort Studio — 1-Click PlayStation 5 PC Porting Engine
// Gaming & Esports Color Harmony: Cyber Black, Neon Violet, Electric Lime
// Typography: Orbitron, Rajdhani, Exo 2
// ===================================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const DEFAULT_GAMES_METADATA = [
  {
    id: 'dreaming-sarah',
    slug: 'dreaming-sarah',
    title: 'Dreaming Sarah',
    genre: 'Surreal Adventure / Platformer',
    synopsis: 'PlayStation 5 surreal adventure converted into a native Windows x86-64 binary. System V ELF system calls redirected directly into native OS threads.',
    statusBadge: '★ COMMUNITY TESTED',
    tags: ['NATIVE WINDOWS PE', 'AMD ZEN 2 → INTEL LOWERED', 'HOST-DEPENDENT 60 FPS'],
    backdrop: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1600&q=80',
    thumb: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=400&q=80',
    stackBadge: 'PORTED PE',
    executablePath: 'games/dreaming-sarah/app.exe',
    folderPath: 'games/dreaming-sarah',
    isFixture: false,
    verified: true,
    fps: 'Target 60 FPS'
  },
  {
    id: 'sample-game-fixture',
    slug: 'sample_game',
    title: 'AnyPS5 Native Test Runner',
    genre: 'Sony Prospero ABI Test Fixture',
    synopsis: 'Upstream AnyPS5 test suite binary verifying POSIX dynamic linker tables, libScePad gamepad mappings, and dynamic section translation without emulation layers.',
    statusBadge: '✓ TEST FIXTURE',
    tags: ['PROSPERO SYSV', 'LIBSCEPAD', 'TEST FIXTURE'],
    backdrop: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1600&q=80',
    thumb: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
    stackBadge: 'TEST FIXTURE',
    executablePath: 'sample_game/input.elf',
    folderPath: 'sample_game',
    isFixture: true,
    verified: false,
    fps: 'Test Binary'
  }
];

let state = {
  activeView: 'library',
  activeHero: DEFAULT_GAMES_METADATA[0],
  allGames: [...DEFAULT_GAMES_METADATA],
  libraryGames: [],
  systemSpecs: null,
  relinkerStatus: null,
  isRelinking: false,
  activeJobId: null,
  relinkStartTime: null,
  relinkTimerInterval: null,
  logLines: [],
  eventSource: null
};

// DOM References
const dom = {
  // Navigation
  dockBtns: document.querySelectorAll('.dock-item'),
  viewPanels: document.querySelectorAll('.view-panel'),
  globalSearch: document.getElementById('global-search'),
  topCpuLabel: document.getElementById('top-cpu-label'),
  btnOpenTerminal: document.getElementById('btn-open-terminal'),
  terminalPulseDot: document.getElementById('terminal-pulse-dot'),

  // Hero Showcase
  heroBackdrop: document.getElementById('hero-backdrop-img'),
  heroStatusBadge: document.getElementById('hero-status-badge'),
  heroTitle: document.getElementById('hero-title'),
  heroSynopsis: document.getElementById('hero-synopsis'),
  heroPillRow: document.querySelector('.hero-pill-row'),
  btnHeroPlay: document.getElementById('btn-hero-play-action'),
  btnHeroRecompile: document.getElementById('btn-hero-recompile'),
  btnHeroSteam: document.getElementById('btn-hero-steam'),
  btnHeroFolder: document.getElementById('btn-hero-folder'),
  heroStackThumbs: document.getElementById('hero-stack-thumbs'),

  // Game Deck
  gamesGrid: document.getElementById('games-grid-container'),
  btnQuickPort: document.getElementById('btn-quick-port'),

  // Relink Studio
  btnLoadSample: document.getElementById('btn-load-verified-sample'),
  dropzone: document.getElementById('console-dropzone'),
  sourcePathInput: document.getElementById('studio-source-path'),
  btnInspect: document.getElementById('btn-studio-inspect'),
  hudFormat: document.getElementById('hud-format'),
  hudModules: document.getElementById('hud-modules'),
  hudStatus: document.getElementById('hud-status'),
  gameTitleInput: document.getElementById('studio-game-title'),
  flagToIntel: document.getElementById('flag-to-intel'),
  flagGui: document.getElementById('flag-gui'),
  flagDiag: document.getElementById('flag-diag'),
  flagRpath: document.getElementById('flag-rpath'),
  previewOutput: document.getElementById('preview-output-path'),
  btnExecuteRelink: document.getElementById('btn-execute-relink'),

  // Terminal Modal
  terminalModal: document.getElementById('terminal-modal'),
  terminalCloseBackdrop: document.getElementById('terminal-modal-close'),
  btnCloseTermX: document.getElementById('btn-close-term-x'),
  liveConsoleBody: document.getElementById('live-console-body'),
  terminalTimer: document.getElementById('terminal-timer'),
  btnCancelRelink: document.getElementById('btn-cancel-relink'),
  btnCopyLogs: document.getElementById('btn-copy-terminal-logs'),
  btnClearLogs: document.getElementById('btn-clear-terminal-logs'),
  steps: [1, 2, 3, 4, 5].map(i => document.getElementById(`h-step-${i}`)),

  // Settings Dashboard
  dashRelinkerStatus: document.getElementById('dash-relinker-status'),
  dashRelinkerPath: document.getElementById('dash-relinker-path'),
  dashPrxCount: document.getElementById('dash-prx-count'),
  dashCpuModel: document.getElementById('dash-cpu-model'),
  dashCpuDetails: document.getElementById('dash-cpu-details')
};

// ===================================================================
// Startup Lifecycle
// ===================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupHeroInteractions();
  setupPorterControls();
  setupDragAndDrop();
  setupTerminalModal();
  setupSearch();
  initEventStream();

  await loadSystemSpecs();
  await loadRelinkerStatus();
  await refreshLibrary();
  await checkActiveRelinkJob();

  // Inspect default fixture directory on startup
  inspectPath('sample_game');
});

// ===================================================================
// Dock Navigation
// ===================================================================

function setupNavigation() {
  dom.dockBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  if (dom.btnQuickPort) {
    dom.btnQuickPort.addEventListener('click', () => switchView('porter'));
  }
}

function switchView(viewName) {
  state.activeView = viewName;
  dom.dockBtns.forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });
  dom.viewPanels.forEach(p => {
    p.classList.toggle('active', p.id === `view-${viewName}`);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===================================================================
// Hero Showcase & Side Thumbnail Stack
// ===================================================================

function setupHeroInteractions() {
  renderHeroStackThumbs();

  if (dom.btnHeroPlay) {
    dom.btnHeroPlay.addEventListener('click', () => {
      if (!state.activeHero) return;
      if (state.activeHero.isFixture || state.activeHero.fileExists === false) {
        // Redirect to compiler workspace
        switchView('porter');
        if (dom.sourcePathInput) dom.sourcePathInput.value = state.activeHero.folderPath || 'sample_game';
        if (dom.gameTitleInput) dom.gameTitleInput.value = state.activeHero.title;
        updateOutputPathPreview();
        inspectPath(dom.sourcePathInput.value);
        showToast('Please compile this title before launching.');
        return;
      }
      launchGame(state.activeHero.id || state.activeHero.slug);
    });
  }

  if (dom.btnHeroRecompile) {
    dom.btnHeroRecompile.addEventListener('click', () => {
      switchView('porter');
      if (dom.sourcePathInput) dom.sourcePathInput.value = state.activeHero.folderPath || 'sample_game';
      if (dom.gameTitleInput) dom.gameTitleInput.value = state.activeHero.title;
      updateOutputPathPreview();
      inspectPath(dom.sourcePathInput.value);
    });
  }

  if (dom.btnHeroFolder) {
    dom.btnHeroFolder.addEventListener('click', () => {
      if (state.activeHero) {
        openFolder(state.activeHero.folderPath || 'games');
      }
    });
  }

  if (dom.btnHeroSteam) {
    dom.btnHeroSteam.addEventListener('click', async () => {
      if (!state.activeHero) return;
      const gameId = state.activeHero.id || state.activeHero.slug;
      try {
        const res = await fetch('/api/export-steam', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast(`✓ Steam launcher created at ${data.scriptPath}`);
          addLogLine('success', `[STEAM] Launcher generated at: ${data.scriptPath}`);
        } else {
          showToast(data.error || 'Failed to export Steam launcher');
        }
      } catch (err) {
        showToast(`Steam Export Error: ${err.message}`);
      }
    });
  }
}

function renderHeroStackThumbs() {
  if (!dom.heroStackThumbs) return;
  dom.heroStackThumbs.innerHTML = '';

  state.allGames.forEach(game => {
    const card = document.createElement('div');
    card.className = `stack-card ${game.id === state.activeHero.id ? 'active' : ''}`;
    card.dataset.game = game.id;

    const img = document.createElement('img');
    img.src = game.thumb || game.backdrop;
    img.alt = game.title;
    img.onerror = () => {
      img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="%23111116"/><text x="50%" y="50%" fill="%237d39eb" font-family="sans-serif" font-size="16" text-anchor="middle">ANYPORT 5</text></svg>';
    };

    const chip = document.createElement('span');
    chip.className = 'stack-chip';
    chip.textContent = game.stackBadge || (game.isFixture ? 'FIXTURE' : (game.fileExists ? 'READY' : 'UNCOMPILED'));

    card.appendChild(img);
    card.appendChild(chip);

    card.addEventListener('click', () => {
      selectHeroGame(game);
    });
    dom.heroStackThumbs.appendChild(card);
  });
}

function selectHeroGame(game) {
  state.activeHero = game;

  if (dom.heroBackdrop) {
    dom.heroBackdrop.style.opacity = '0.3';
    setTimeout(() => {
      dom.heroBackdrop.style.backgroundImage = `url('${game.backdrop}')`;
      dom.heroBackdrop.style.opacity = '1';
    }, 150);
  }

  if (dom.heroTitle) dom.heroTitle.textContent = game.title;
  if (dom.heroSynopsis) dom.heroSynopsis.textContent = game.synopsis || '';

  if (dom.heroPillRow) {
    dom.heroPillRow.innerHTML = '';

    const statusPill = document.createElement('span');
    statusPill.className = game.isFixture ? 'pill-violet' : (game.fileExists === false ? 'pill-dark' : 'pill-verified');
    statusPill.textContent = game.isFixture ? 'TEST FIXTURE' : (game.fileExists === false ? '★ SOURCE READY (UNCOMPILED)' : (game.statusBadge || '★ COMMUNITY TESTED'));
    dom.heroPillRow.appendChild(statusPill);

    (game.tags || []).forEach(t => {
      const tagPill = document.createElement('span');
      tagPill.className = 'pill-dark';
      tagPill.textContent = t;
      dom.heroPillRow.appendChild(tagPill);
    });
  }

  // Update Hero Play button label based on file availability
  if (dom.btnHeroPlay) {
    if (game.isFixture) {
      dom.btnHeroPlay.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> RELINK TEST FIXTURE`;
    } else if (game.fileExists === false) {
      dom.btnHeroPlay.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> COMPILE TO PLAY`;
    } else {
      dom.btnHeroPlay.innerHTML = `<svg class="cta-svg" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> PLAY NATIVE PC PORT`;
    }
  }

  const stackCards = document.querySelectorAll('.stack-card');
  stackCards.forEach(c => {
    c.classList.toggle('active', c.dataset.game === game.id);
  });
}

// ===================================================================
// Games Deck
// ===================================================================

function renderGamesDeck(filter = '') {
  if (!dom.gamesGrid) return;
  dom.gamesGrid.innerHTML = '';

  const q = filter.trim().toLowerCase();
  const filtered = state.allGames.filter(g => {
    if (!q) return true;
    return (g.title && g.title.toLowerCase().includes(q)) ||
           (g.genre && g.genre.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'grid-column: 1/-1; padding: 3rem; text-align: center; color: var(--text-dim);';
    emptyMsg.innerHTML = `
      <p style="font-family: var(--font-primary); font-size: 1.1rem; margin-bottom: 0.5rem;">No games matching "${escapeHtml(filter)}".</p>
      <button class="btn-lime-action" id="btn-empty-port">PORT NEW TITLE</button>
    `;
    dom.gamesGrid.appendChild(emptyMsg);
    const emptyBtn = emptyMsg.querySelector('#btn-empty-port');
    if (emptyBtn) emptyBtn.addEventListener('click', () => switchView('porter'));
    return;
  }

  filtered.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-port-card';

    // Poster container
    const poster = document.createElement('div');
    poster.className = 'card-poster';
    poster.style.backgroundImage = `url('${game.thumb || game.backdrop}')`;

    const dim = document.createElement('div');
    dim.className = 'card-poster-dim';
    poster.appendChild(dim);

    const chips = document.createElement('div');
    chips.className = 'card-chips';

    const statusBadge = document.createElement('span');
    statusBadge.className = 'card-status-badge';
    statusBadge.textContent = game.isFixture ? 'TEST FIXTURE' : (game.fileExists === false ? 'UNCOMPILED' : (game.fps || 'READY'));
    chips.appendChild(statusBadge);
    poster.appendChild(chips);

    // Body content
    const body = document.createElement('div');
    body.className = 'card-body-content';

    const titleEl = document.createElement('h3');
    titleEl.textContent = game.title;

    const genreEl = document.createElement('span');
    genreEl.className = 'card-genre-tag';
    genreEl.textContent = game.genre || 'PlayStation 5 Native Port';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'card-actions-row';

    const launchBtn = document.createElement('button');
    launchBtn.className = 'btn-card-launch';
    launchBtn.dataset.gameId = game.id;

    if (game.isFixture) {
      launchBtn.textContent = '⚡ RELINK FIXTURE';
      launchBtn.classList.add('btn-need-compile');
    } else if (game.fileExists === false) {
      launchBtn.textContent = '⚡ COMPILE TO PLAY';
      launchBtn.classList.add('btn-need-compile');
    } else {
      launchBtn.textContent = '▶ PLAY NATIVE PC';
    }

    actionsRow.appendChild(launchBtn);
    body.appendChild(titleEl);
    body.appendChild(genreEl);
    body.appendChild(actionsRow);

    card.appendChild(poster);
    card.appendChild(body);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-card-launch')) return;
      selectHeroGame(game);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    launchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (game.isFixture || game.fileExists === false) {
        switchView('porter');
        if (dom.sourcePathInput) dom.sourcePathInput.value = game.folderPath || 'sample_game';
        if (dom.gameTitleInput) dom.gameTitleInput.value = game.title;
        updateOutputPathPreview();
        inspectPath(dom.sourcePathInput.value);
        showToast('Configure options and click Compile Native Executable.');
      } else {
        launchGame(game.id);
      }
    });

    dom.gamesGrid.appendChild(card);
  });
}

// ===================================================================
// 1-Click Porter Controls
// ===================================================================

function setupPorterControls() {
  if (dom.btnLoadSample) {
    dom.btnLoadSample.addEventListener('click', () => {
      dom.sourcePathInput.value = 'sample_game';
      dom.gameTitleInput.value = 'Dreaming Sarah (Native PC Port)';
      updateOutputPathPreview();
      inspectPath('sample_game');
    });
  }

  if (dom.btnInspect) {
    dom.btnInspect.addEventListener('click', () => {
      const p = dom.sourcePathInput.value.trim();
      if (p) inspectPath(p);
    });
  }

  if (dom.gameTitleInput) {
    dom.gameTitleInput.addEventListener('input', updateOutputPathPreview);
  }

  if (dom.btnExecuteRelink) {
    dom.btnExecuteRelink.addEventListener('click', startRelinking);
  }
}

function setupDragAndDrop() {
  const dropzone = dom.dropzone;
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      const targetPath = file.path || file.name;
      if (targetPath) {
        dom.sourcePathInput.value = targetPath;
        updateOutputPathPreview();
        inspectPath(targetPath);
        showToast(`Loaded path: ${targetPath}`);
      }
    }
  });
}

function updateOutputPathPreview() {
  if (!dom.previewOutput || !dom.gameTitleInput) return;
  const title = dom.gameTitleInput.value.trim();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'new-port';
  dom.previewOutput.textContent = `games/${slug}/app.exe`;
}

async function inspectPath(targetPath) {
  if (!targetPath) return;
  dom.hudStatus.textContent = 'Inspecting binary...';
  dom.hudStatus.className = 'cell-val';

  try {
    const res = await fetch('/api/scan-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath })
    });
    const data = await res.json();

    if (!res.ok) {
      dom.hudFormat.textContent = 'Not Found';
      dom.hudModules.textContent = '0 modules';
      dom.hudStatus.textContent = data.error || 'Invalid Path';
      dom.hudStatus.className = 'cell-val';
      return;
    }

    if (data.hasInputElf || data.hasEboot || (data.elfCandidates && data.elfCandidates.length > 0)) {
      const elfName = data.hasInputElf ? 'input.elf' : (data.hasEboot ? 'eboot.bin' : data.elfCandidates[0]);
      dom.hudFormat.textContent = `PS5 ELF (${elfName})`;
    } else {
      dom.hudFormat.textContent = 'No ELF Binary';
    }

    if (data.moduleDirFound) {
      dom.hudModules.textContent = `${data.moduleDirFound}/ (${data.modulesCount} PRX)`;
    } else {
      dom.hudModules.textContent = 'None (--skip-sce-module)';
    }

    dom.hudStatus.textContent = data.validity === 'valid' ? 'Ready to Compile' : data.message;
    dom.hudStatus.className = data.validity === 'valid' ? 'cell-val lime' : 'cell-val';

  } catch (err) {
    dom.hudStatus.textContent = `Error: ${err.message}`;
  }
}

// ===================================================================
// Compiler Pipeline Execution
// ===================================================================

async function startRelinking() {
  if (state.isRelinking) {
    openTerminalModal();
    return;
  }

  const sourcePath = dom.sourcePathInput.value.trim();
  const gameTitle = dom.gameTitleInput.value.trim() || 'Custom PS5 Port';

  if (!sourcePath) {
    showToast('Please specify a valid game directory or ELF path.');
    return;
  }

  state.isRelinking = true;
  openTerminalModal();
  setStepperStep(1);
  startTerminalTimer();
  if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'inline-block';

  addLogLine('cmd', `=== Starting AnyPS5 Relinker: ${gameTitle} ===`);
  addLogLine('info', `Source: ${sourcePath}`);

  try {
    const payload = {
      sourcePath,
      gameTitle,
      targetOS: 'windows',
      toIntel: dom.flagToIntel ? dom.flagToIntel.checked : false,
      windowsGui: dom.flagGui ? dom.flagGui.checked : true,
      windowsDiagnostics: dom.flagDiag ? dom.flagDiag.checked : false,
      rpath: dom.flagRpath ? (dom.flagRpath.value.trim() || '$ORIGIN/libs') : '$ORIGIN/libs'
    };

    const res = await fetch('/api/relink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      addLogLine('error', `Error: ${data.error}`);
      stopTerminalTimer();
      state.isRelinking = false;
      if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'none';
      return;
    }

    state.activeJobId = data.jobId;
  } catch (err) {
    addLogLine('error', `Relink initiation error: ${err.message}`);
    stopTerminalTimer();
    state.isRelinking = false;
    if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'none';
  }
}

async function cancelActiveRelink() {
  if (!state.isRelinking && !state.activeJobId) return;
  try {
    const res = await fetch('/api/relink/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: state.activeJobId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Relinking job cancelled.');
      addLogLine('error', 'Job cancelled by user.');
    }
  } catch (err) {
    showToast(`Cancel error: ${err.message}`);
  } finally {
    state.isRelinking = false;
    state.activeJobId = null;
    stopTerminalTimer();
    if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'none';
    if (dom.terminalPulseDot) dom.terminalPulseDot.style.display = 'none';
  }
}

async function checkActiveRelinkJob() {
  try {
    const res = await fetch('/api/relink/active');
    const data = await res.json();
    if (data.activeJob) {
      state.isRelinking = true;
      state.activeJobId = data.activeJob.id;
      state.relinkStartTime = data.activeJob.startTime;
      startTerminalTimer();
      if (dom.terminalPulseDot) dom.terminalPulseDot.style.display = 'block';
      if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'inline-block';
      addLogLine('info', `Reattached to ongoing compilation job: ${data.activeJob.gameTitle}`);
    }
  } catch {}
}

function setStepperStep(stepNum) {
  dom.steps.forEach((step, idx) => {
    if (!step) return;
    const s = idx + 1;
    step.classList.remove('active', 'done');
    if (s < stepNum) step.classList.add('done');
    else if (s === stepNum) step.classList.add('active');
  });
}

// ===================================================================
// Live Terminal Modal
// ===================================================================

function setupTerminalModal() {
  if (dom.btnOpenTerminal) dom.btnOpenTerminal.addEventListener('click', openTerminalModal);
  if (dom.terminalCloseBackdrop) dom.terminalCloseBackdrop.addEventListener('click', closeTerminalModal);
  if (dom.btnCloseTermX) dom.btnCloseTermX.addEventListener('click', closeTerminalModal);

  if (dom.btnCancelRelink) {
    dom.btnCancelRelink.addEventListener('click', cancelActiveRelink);
  }

  if (dom.btnCopyLogs) {
    dom.btnCopyLogs.addEventListener('click', () => {
      const text = state.logLines.join('\n');
      navigator.clipboard.writeText(text);
      showToast('Logs copied to clipboard.');
    });
  }

  if (dom.btnClearLogs) {
    dom.btnClearLogs.addEventListener('click', () => {
      state.logLines = [];
      if (dom.liveConsoleBody) dom.liveConsoleBody.innerHTML = '';
    });
  }
}

function openTerminalModal() {
  if (dom.terminalModal) dom.terminalModal.classList.add('active');
}

function closeTerminalModal() {
  if (dom.terminalModal) dom.terminalModal.classList.remove('active');
}

function addLogLine(type, text) {
  state.logLines.push(`[${type.toUpperCase()}] ${text}`);
  if (!dom.liveConsoleBody) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = text;
  dom.liveConsoleBody.appendChild(entry);
  dom.liveConsoleBody.scrollTop = dom.liveConsoleBody.scrollHeight;

  const lower = text.toLowerCase();
  if (lower.includes('parsing elf') || lower.includes('header')) {
    setStepperStep(1);
  } else if (lower.includes('intel') || lower.includes('lowering') || lower.includes('to-intel')) {
    setStepperStep(2);
  } else if (lower.includes('reloc') || lower.includes('nid') || lower.includes('sysv')) {
    setStepperStep(3);
  } else if (lower.includes('writing pe') || lower.includes('.exe')) {
    setStepperStep(4);
  } else if (lower.includes('complete') || lower.includes('success')) {
    setStepperStep(5);
  }
}

function startTerminalTimer() {
  if (!state.relinkStartTime) state.relinkStartTime = Date.now();
  if (state.relinkTimerInterval) clearInterval(state.relinkTimerInterval);
  state.relinkTimerInterval = setInterval(() => {
    const elapsed = ((Date.now() - state.relinkStartTime) / 1000).toFixed(1);
    if (dom.terminalTimer) dom.terminalTimer.textContent = `${elapsed}s`;
  }, 100);
}

function stopTerminalTimer() {
  if (state.relinkTimerInterval) {
    clearInterval(state.relinkTimerInterval);
    state.relinkTimerInterval = null;
  }
}

// ===================================================================
// Server-Sent Events with Auto-Recovery
// ===================================================================

function initEventStream() {
  if (state.eventSource) {
    try { state.eventSource.close(); } catch {}
  }

  const es = new EventSource('/api/stream');
  state.eventSource = es;

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') return;

      if (data.type === 'start') {
        setStepperStep(1);
        state.isRelinking = true;
        if (dom.terminalPulseDot) dom.terminalPulseDot.style.display = 'block';
        if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'inline-block';
      } else if (data.type === 'success') {
        setStepperStep(5);
        stopTerminalTimer();
        state.isRelinking = false;
        state.activeJobId = null;
        if (dom.terminalPulseDot) dom.terminalPulseDot.style.display = 'none';
        if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'none';
        refreshLibrary();
        showToast('✓ Native Windows executable generated successfully!');
      } else if (data.type === 'error') {
        stopTerminalTimer();
        state.isRelinking = false;
        state.activeJobId = null;
        if (dom.terminalPulseDot) dom.terminalPulseDot.style.display = 'none';
        if (dom.btnCancelRelink) dom.btnCancelRelink.style.display = 'none';
      }

      addLogLine(data.type, data.text);
    } catch {}
  };

  es.onerror = () => {
    es.close();
    // Auto reconnect after 3 seconds
    setTimeout(initEventStream, 3000);
  };
}

// ===================================================================
// Process Launching & Folder Opening
// ===================================================================

async function launchGame(gameId) {
  addLogLine('cmd', `Attempting launch for: ${gameId}...`);

  try {
    const res = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(`Launch failed: ${data.error}`);
      addLogLine('error', `Launch failed: ${data.error}`);
      return;
    }

    showToast(`✓ Game launched natively! PID: ${data.pid}`);
    addLogLine('success', `✓ Process active with PID ${data.pid}`);
  } catch (err) {
    showToast(`Could not launch game: ${err.message}`);
  }
}

async function openFolder(targetPath) {
  try {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath })
    });
  } catch (err) {}
}

// ===================================================================
// Telemetry & Library Refresh
// ===================================================================

async function loadSystemSpecs() {
  try {
    const res = await fetch('/api/specs');
    const data = await res.json();
    state.systemSpecs = data;

    if (dom.topCpuLabel) {
      dom.topCpuLabel.textContent = data.isIntel ? 'Intel Zen 2 Lowering Active' : `${data.arch} Native Execution`;
    }

    if (dom.dashCpuModel) dom.dashCpuModel.textContent = data.cpuModel;
    if (dom.dashCpuDetails) {
      dom.dashCpuDetails.textContent = `${data.cpuCores} Cores | ${data.totalRamGB} GB RAM | ${data.platform.toUpperCase()}`;
    }

    if (dom.flagToIntel) {
      dom.flagToIntel.checked = data.isIntel;
    }
  } catch (err) {}
}

async function loadRelinkerStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.relinkerStatus = data;

    if (dom.dashRelinkerStatus) {
      dom.dashRelinkerStatus.textContent = data.installed ? 'Active (Official AnyPS5)' : 'Missing Relinker';
    }

    if (dom.dashRelinkerPath) {
      dom.dashRelinkerPath.textContent = data.relinkerPath;
    }

    if (dom.dashPrxCount) {
      dom.dashPrxCount.textContent = `${data.prxCount} Linked`;
    }
  } catch (err) {}
}

async function refreshLibrary() {
  try {
    const res = await fetch('/api/library');
    const libData = await res.json();
    state.libraryGames = libData;

    // Build merged view honoring backend filesystem validation
    const merged = [];

    // Map backend library items first
    libData.forEach(item => {
      merged.push({
        id: item.id || item.slug,
        slug: item.slug || item.id,
        title: item.title,
        genre: item.genre || 'PlayStation 5 Native Port',
        synopsis: item.notes || `Relinked PS5 title at ${item.executablePath}`,
        statusBadge: item.status || (item.isFixture ? 'TEST FIXTURE' : (item.fileExists ? 'COMMUNITY TESTED' : 'UNCOMPILED')),
        tags: item.isFixture ? ['TEST FIXTURE', 'PROSPERO SYSV'] : ['NATIVE PE', 'CONVERTED'],
        backdrop: item.banner || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1600&q=80',
        thumb: item.banner || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=400&q=80',
        stackBadge: item.isFixture ? 'FIXTURE' : (item.fileExists ? 'READY' : 'COMPILE'),
        executablePath: item.executablePath,
        folderPath: item.folderPath,
        fileExists: item.fileExists,
        isFixture: Boolean(item.isFixture),
        verified: Boolean(item.verified),
        fps: item.fps || (item.isFixture ? 'Fixture' : 'Target 60 FPS')
      });
    });

    // Ensure defaults exist if library was empty
    if (merged.length === 0) {
      DEFAULT_GAMES_METADATA.forEach(d => merged.push(d));
    }

    state.allGames = merged;
    if (merged.length > 0) {
      const currentActiveId = state.activeHero ? state.activeHero.id : null;
      const found = merged.find(g => g.id === currentActiveId) || merged[0];
      selectHeroGame(found);
    }

    renderGamesDeck();
    renderHeroStackThumbs();
  } catch (err) {
    console.error('Error refreshing library:', err);
  }
}

// ===================================================================
// Search & Shortcuts
// ===================================================================

function setupSearch() {
  if (dom.globalSearch) {
    dom.globalSearch.addEventListener('input', (e) => {
      renderGamesDeck(e.target.value);
    });
  }

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dom.globalSearch) {
        dom.globalSearch.focus();
        dom.globalSearch.select();
      }
    }
  });
}

function showToast(msg) {
  let toast = document.getElementById('cyber-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cyber-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #111116;
      border: 1px solid var(--border-lime);
      color: #fff;
      padding: 12px 24px;
      border-radius: var(--radius-sm);
      font-family: var(--font-secondary);
      font-size: 0.95rem;
      font-weight: 700;
      box-shadow: 0 0 25px rgba(191, 255, 0, 0.35);
      z-index: 999;
      transition: all 0.25s ease;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 3500);
}
