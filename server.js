const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 4567;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const GAMES_DIR = path.join(ROOT_DIR, 'games');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const ANYPS5_REPO_DIR = path.resolve(ROOT_DIR, '..', 'AnyPS5');
const LIBRARY_FILE = path.join(GAMES_DIR, 'library.json');

// Ensure base directories exist
if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

// Initialize clean library if not present
if (!fs.existsSync(LIBRARY_FILE)) {
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify([], null, 2));
}

// Global SSE clients
let sseClients = [];

function broadcastLog(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try {
      res.write(msg);
    } catch {}
  });
}

// In-Memory Job Manager for Relinker operations
const activeJobs = new Map();

function createJob(gameSlug, gameTitle, outputGameDir, outputFile, targetOS, proc) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job = {
    id: jobId,
    gameSlug,
    gameTitle,
    outputGameDir,
    outputFile,
    targetOS,
    status: 'running',
    startTime: Date.now(),
    endTime: null,
    exitCode: null,
    process: proc,
    logs: []
  };

  activeJobs.set(jobId, job);

  // Set maximum execution timeout (5 minutes)
  const timeoutMs = 5 * 60 * 1000;
  job.timer = setTimeout(() => {
    if (job.status === 'running') {
      broadcastLog({ type: 'error', text: `Relinker job ${jobId} timed out after 5 minutes. Terminating process.` });
      try {
        proc.kill('SIGKILL');
      } catch {}
      job.status = 'failed';
      job.endTime = Date.now();
      job.error = 'Process timed out';
    }
  }, timeoutMs);

  return job;
}

function getActiveJob() {
  for (const job of activeJobs.values()) {
    if (job.status === 'running') return job;
  }
  return null;
}

function readLibrarySafely() {
  try {
    if (!fs.existsSync(LIBRARY_FILE)) return [];
    const content = fs.readFileSync(LIBRARY_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading library.json:', err);
    return [];
  }
}

function saveLibrarySafely(libraryData) {
  try {
    const tmpFile = `${LIBRARY_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(libraryData, null, 2), 'utf8');
    fs.renameSync(tmpFile, LIBRARY_FILE);
    return true;
  } catch (err) {
    console.error('Error saving library.json:', err);
    return false;
  }
}

function resolveExecutablePath(execPath) {
  if (!execPath) return null;
  if (path.isAbsolute(execPath)) return execPath;
  return path.resolve(ROOT_DIR, execPath);
}

function toPortablePath(targetPath) {
  if (!targetPath) return '';
  const normalized = path.normalize(targetPath);
  const rootNormalized = path.normalize(ROOT_DIR);
  if (normalized.startsWith(rootNormalized)) {
    let rel = path.relative(rootNormalized, normalized);
    return rel.split(path.sep).join('/');
  }
  return targetPath.split(path.sep).join('/');
}

function getSystemSpecs() {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown Processor';
  const isIntel = cpuModel.toLowerCase().includes('intel');
  const isAMD = cpuModel.toLowerCase().includes('amd');
  const totalRamGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const freeRamGB = Math.round(os.freemem() / (1024 * 1024 * 1024));

  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuModel,
    isIntel,
    isAMD,
    cpuCores: cpus.length,
    totalRamGB,
    freeRamGB,
    recommendedToIntel: isIntel
  };
}

function getRelinkerInfo() {
  const ext = os.platform() === 'win32' ? '.exe' : '';
  const localRelinker = path.join(BIN_DIR, `relinker${ext}`);
  const hasLocal = fs.existsSync(localRelinker);

  const libsDir = path.join(BIN_DIR, 'libs');
  let prxCount = 0;
  if (fs.existsSync(libsDir)) {
    try {
      prxCount = fs.readdirSync(libsDir).filter(f => f.endsWith('.prx') || f.endsWith('.dll') || f.endsWith('.so')).length;
    } catch {}
  }

  return {
    installed: hasLocal,
    relinkerPath: hasLocal ? toPortablePath(localRelinker) : 'Not Found',
    absoluteRelinkerPath: hasLocal ? localRelinker : null,
    isSimulationMode: false,
    prxCount,
    binDirectory: toPortablePath(BIN_DIR),
    repoDirectory: toPortablePath(ANYPS5_REPO_DIR)
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  // Secure CORS policy: Allow null/missing origin (desktop app, local webview, electron, curl)
  // or origins strictly matching localhost or 127.0.0.1
  if (!origin || origin === 'null') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1') {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    } catch {}
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1:4567'}`);
  const pathname = parsedUrl.pathname;

  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Server-Sent Events for real-time logs
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    sseClients.push(res);

    // Heartbeat ping to keep connection alive
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(pingInterval);
      sseClients = sseClients.filter(client => client !== res);
    });

    const activeJob = getActiveJob();
    res.write(`data: ${JSON.stringify({ 
      type: 'connected', 
      text: 'Connected to AnyPort Studio Backend Engine',
      activeJobId: activeJob ? activeJob.id : null
    })}\n\n`);
    return;
  }

  // Ping endpoint
  if (pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', engine: 'AnyPS5', timestamp: Date.now() }));
    return;
  }

  // Specs endpoint
  if (pathname === '/api/specs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSystemSpecs()));
    return;
  }

  // Relinker status endpoint
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getRelinkerInfo()));
    return;
  }

  // Library endpoint with validation and portable path resolution
  if (pathname === '/api/library' && req.method === 'GET') {
    const rawLibrary = readLibrarySafely();
    const validatedLibrary = rawLibrary.map(item => {
      const resolvedExe = resolveExecutablePath(item.executablePath);
      let fileExists = false;
      let fileSize = 0;
      if (resolvedExe && fs.existsSync(resolvedExe)) {
        try {
          const stat = fs.statSync(resolvedExe);
          fileExists = stat.isFile() && stat.size >= 1000;
          fileSize = stat.size;
        } catch {}
      }

      const resolvedFolder = item.folderPath ? resolveExecutablePath(item.folderPath) : (resolvedExe ? path.dirname(resolvedExe) : '');
      const folderExists = resolvedFolder ? fs.existsSync(resolvedFolder) : false;

      return {
        ...item,
        fileExists,
        fileSize,
        folderExists,
        portableExecutablePath: toPortablePath(item.executablePath),
        portableFolderPath: item.folderPath ? toPortablePath(item.folderPath) : ''
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(validatedLibrary));
    return;
  }

  // Active job status endpoint
  if (pathname === '/api/relink/active' && req.method === 'GET') {
    const active = getActiveJob();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ activeJob: active ? { id: active.id, gameSlug: active.gameSlug, gameTitle: active.gameTitle, startTime: active.startTime } : null }));
    return;
  }

  // Job status inquiry by ID
  if (pathname === '/api/relink/status' && req.method === 'GET') {
    const jobId = parsedUrl.searchParams.get('jobId');
    const job = activeJobs.get(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: job.id,
      gameSlug: job.gameSlug,
      status: job.status,
      startTime: job.startTime,
      endTime: job.endTime,
      exitCode: job.exitCode,
      logsCount: job.logs.length
    }));
    return;
  }

  // Cancel relinking job
  if (pathname === '/api/relink/cancel' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { jobId } = JSON.parse(body || '{}');
        const targetJob = jobId ? activeJobs.get(jobId) : getActiveJob();
        if (!targetJob || targetJob.status !== 'running') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No running job to cancel' }));
          return;
        }

        try {
          targetJob.process.kill('SIGTERM');
        } catch {}
        targetJob.status = 'cancelled';
        targetJob.endTime = Date.now();
        clearTimeout(targetJob.timer);

        broadcastLog({ type: 'error', text: `Job "${targetJob.gameTitle}" was cancelled by user.` });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, jobId: targetJob.id }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Scan path endpoint with security sanitization
  if (pathname === '/api/scan-path' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { targetPath } = JSON.parse(body || '{}');
        if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path parameter provided' }));
          return;
        }

        let resolvedPath = path.isAbsolute(targetPath) ? path.normalize(targetPath) : path.resolve(ROOT_DIR, targetPath);

        if (!fs.existsSync(resolvedPath)) {
          // Check relative to parent directory
          const altPath = path.resolve(ROOT_DIR, '..', targetPath);
          if (fs.existsSync(altPath)) resolvedPath = altPath;
        }

        if (!fs.existsSync(resolvedPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Directory not found: ${targetPath}` }));
          return;
        }

        const stats = fs.statSync(resolvedPath);
        let dirToScan = stats.isDirectory() ? resolvedPath : path.dirname(resolvedPath);

        const files = fs.readdirSync(dirToScan);
        const hasInputElf = files.includes('input.elf');
        const hasEboot = files.includes('eboot.bin');
        const elfCandidates = files.filter(f => f.endsWith('.elf') || f === 'eboot.bin');

        const hasSceModule = files.includes('sce_module') && fs.statSync(path.join(dirToScan, 'sce_module')).isDirectory();
        const hasSceModules = files.includes('sce_modules') && fs.statSync(path.join(dirToScan, 'sce_modules')).isDirectory();
        const hasPrx = files.includes('prx') && fs.statSync(path.join(dirToScan, 'prx')).isDirectory();

        let modulesCount = 0;
        let moduleDirFound = null;

        if (hasSceModule) {
          moduleDirFound = 'sce_module';
          modulesCount = fs.readdirSync(path.join(dirToScan, 'sce_module')).length;
        } else if (hasSceModules) {
          moduleDirFound = 'sce_modules';
          modulesCount = fs.readdirSync(path.join(dirToScan, 'sce_modules')).length;
        } else if (hasPrx) {
          moduleDirFound = 'prx';
          modulesCount = fs.readdirSync(path.join(dirToScan, 'prx')).length;
        }

        let validity = 'valid';
        let message = 'Ready for relinking';

        if (hasSceModule && hasSceModules) {
          validity = 'error';
          message = 'Error: Both sce_module/ and sce_modules/ exist. AnyPS5 requires only one.';
        } else if (!hasInputElf && !hasEboot && elfCandidates.length === 0) {
          validity = 'error';
          message = 'No ELF executable (input.elf or eboot.bin) found in target folder.';
        } else if (!moduleDirFound) {
          validity = 'warning';
          message = 'No bundled module directory found (will use --skip-sce-module).';
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resolvedPath: toPortablePath(dirToScan),
          absolutePath: dirToScan,
          hasInputElf,
          hasEboot,
          elfCandidates,
          hasSceModule,
          hasSceModules,
          hasPrx,
          moduleDirFound,
          modulesCount,
          validity,
          message
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Relink execution endpoint with lifecycle tracking
  if (pathname === '/api/relink' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const {
          sourcePath,
          gameTitle = 'Converted PS5 Game',
          targetOS = 'windows',
          toIntel = false,
          windowsGui = true,
          windowsDiagnostics = false,
          rpath = '$ORIGIN/libs'
        } = payload;

        if (!sourcePath || typeof sourcePath !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'sourcePath is required.' }));
          return;
        }

        const runningJob = getActiveJob();
        if (runningJob) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `A relinking job is already running: "${runningJob.gameTitle}" (ID: ${runningJob.id})` }));
          return;
        }

        const ext = os.platform() === 'win32' ? '.exe' : '';
        const relinkerBinary = path.join(BIN_DIR, `relinker${ext}`);
        if (!fs.existsSync(relinkerBinary)) {
          broadcastLog({ type: 'error', text: `FAIL: relinker executable not found at ${relinkerBinary}` });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'relinker.exe not found in bin directory' }));
          return;
        }

        // Determine input file
        let resolvedSource = path.isAbsolute(sourcePath) ? path.normalize(sourcePath) : path.resolve(ROOT_DIR, sourcePath);
        if (!fs.existsSync(resolvedSource)) {
          const alt = path.resolve(ROOT_DIR, '..', sourcePath);
          if (fs.existsSync(alt)) resolvedSource = alt;
        }

        if (!fs.existsSync(resolvedSource)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Source path does not exist: ${sourcePath}` }));
          return;
        }

        let inputFile = resolvedSource;
        if (fs.statSync(resolvedSource).isDirectory()) {
          if (fs.existsSync(path.join(resolvedSource, 'input.elf'))) {
            inputFile = path.join(resolvedSource, 'input.elf');
          } else if (fs.existsSync(path.join(resolvedSource, 'eboot.bin'))) {
            inputFile = path.join(resolvedSource, 'eboot.bin');
          } else {
            const elfs = fs.readdirSync(resolvedSource).filter(f => f.endsWith('.elf'));
            if (elfs.length > 0) inputFile = path.join(resolvedSource, elfs[0]);
            else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `No .elf or eboot.bin found inside directory ${sourcePath}` }));
              return;
            }
          }
        }

        const gameSlug = gameTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `game-${Date.now()}`;
        const outputGameDir = path.join(GAMES_DIR, gameSlug);
        if (!fs.existsSync(outputGameDir)) fs.mkdirSync(outputGameDir, { recursive: true });

        // Copy native PRX libraries into output game's libs/ folder
        const libsSource = path.join(BIN_DIR, 'libs');
        const libsDest = path.join(outputGameDir, 'libs');
        if (!fs.existsSync(libsDest)) fs.mkdirSync(libsDest, { recursive: true });
        if (fs.existsSync(libsSource)) {
          try {
            const prxFiles = fs.readdirSync(libsSource);
            prxFiles.forEach(f => {
              const srcF = path.join(libsSource, f);
              const dstF = path.join(libsDest, f);
              if (!fs.existsSync(dstF)) {
                try { fs.copyFileSync(srcF, dstF); } catch {}
              }
            });
          } catch {}
        }

        const outName = targetOS === 'windows' ? 'app.exe' : 'app.elf';
        const outputFile = path.resolve(outputGameDir, outName);

        const args = [];
        if (targetOS === 'windows') args.push('--windows');
        if (windowsGui) args.push('--windows-gui');
        if (windowsDiagnostics) args.push('--windows-diagnostics');
        if (toIntel) args.push('--to-intel');

        const inputDir = path.dirname(inputFile);
        const hasSceMod = fs.existsSync(path.join(inputDir, 'sce_module')) ||
                          fs.existsSync(path.join(inputDir, 'sce_modules')) ||
                          fs.existsSync(path.join(inputDir, 'prx'));
        if (!hasSceMod) {
          args.push('--skip-sce-module');
        }

        args.push('--rpath');
        args.push(rpath);
        args.push(inputFile);
        args.push(outputFile);

        broadcastLog({ type: 'start', text: `=== Starting AnyPS5 Relinker: ${gameTitle} ===` });
        broadcastLog({ type: 'cmd', text: `$ relinker ${args.join(' ')}` });

        const proc = spawn(relinkerBinary, args, { cwd: outputGameDir });
        const job = createJob(gameSlug, gameTitle, outputGameDir, outputFile, targetOS, proc);

        proc.stdout.on('data', data => {
          const lines = data.toString().split('\n');
          lines.forEach(l => {
            const trimmed = l.trim();
            if (trimmed) {
              job.logs.push({ type: 'stdout', text: trimmed, timestamp: Date.now() });
              broadcastLog({ type: 'stdout', text: trimmed });
            }
          });
        });

        proc.stderr.on('data', data => {
          const lines = data.toString().split('\n');
          lines.forEach(l => {
            const trimmed = l.trim();
            if (trimmed) {
              job.logs.push({ type: 'stderr', text: trimmed, timestamp: Date.now() });
              broadcastLog({ type: 'stderr', text: trimmed });
            }
          });
        });

        proc.on('close', code => {
          clearTimeout(job.timer);
          job.exitCode = code;
          job.endTime = Date.now();

          if (code === 0) {
            job.status = 'completed';
            const portableExe = toPortablePath(outputFile);
            const portableFolder = toPortablePath(outputGameDir);
            finalizeGame(outputGameDir, gameSlug, gameTitle, targetOS, portableExe, portableFolder);
            broadcastLog({ type: 'success', text: `✓ Relinking complete! Generated native executable: ${portableExe}` });
          } else {
            job.status = 'failed';
            // Cleanup partial zero/tiny binary on failure
            if (fs.existsSync(outputFile)) {
              try {
                const stat = fs.statSync(outputFile);
                if (stat.size < 1000) fs.unlinkSync(outputFile);
              } catch {}
            }
            broadcastLog({ type: 'error', text: `✗ Relinker exited with error code ${code}. Inspect logs for missing NIDs or unsupported calls.` });
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, jobId: job.id, gameSlug, outputPath: toPortablePath(outputFile) }));
      } catch (err) {
        broadcastLog({ type: 'error', text: `Failed to initiate relink: ${err.message}` });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Safe Launch Process endpoint
  if (pathname === '/api/launch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { gameId } = JSON.parse(body || '{}');
        if (!gameId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gameId is required' }));
          return;
        }

        const library = readLibrarySafely();
        const game = library.find(g => g.id === gameId || g.slug === gameId);

        if (!game) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Game '${gameId}' not found in library` }));
          return;
        }

        const exePath = resolveExecutablePath(game.executablePath);
        if (!exePath || !fs.existsSync(exePath) || fs.statSync(exePath).size < 1000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: `Executable '${game.executablePath}' does not exist on disk or has not been compiled yet.` 
          }));
          return;
        }

        const gameDir = path.dirname(exePath);
        const libsDir = path.join(gameDir, 'libs');

        // Configure environment DLL search path so Windows finds runtime dependencies
        const env = Object.assign({}, process.env, {
          PATH: `${libsDir};${BIN_DIR};${process.env.PATH}`
        });

        const gameProc = spawn(exePath, [], {
          cwd: gameDir,
          env,
          detached: true,
          stdio: 'ignore'
        });
        gameProc.unref();

        broadcastLog({ type: 'cmd', text: `[RUN] Launched native process: ${toPortablePath(exePath)} (PID: ${gameProc.pid})` });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, pid: gameProc.pid }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Export Steam Shortcut Script endpoint
  if (pathname === '/api/export-steam' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { gameId } = JSON.parse(body || '{}');
        const library = readLibrarySafely();
        const game = library.find(g => g.id === gameId || g.slug === gameId);

        if (!game) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Game not found' }));
          return;
        }

        const exePath = resolveExecutablePath(game.executablePath);
        const gameDir = exePath ? path.dirname(exePath) : path.join(GAMES_DIR, game.slug || game.id);
        if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

        const batPath = path.join(gameDir, 'launch_steam.bat');
        const batContent = `@echo off\r\ncd /d "%~dp0"\r\necho Starting ${game.title} via AnyPort 5 Native Runtime...\r\nstart "" "app.exe"\r\nexit\r\n`;
        fs.writeFileSync(batPath, batContent);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          scriptPath: toPortablePath(batPath),
          message: `Created Steam launcher at ${toPortablePath(batPath)}. In Steam: Click 'Add a Non-Steam Game' and select this file.`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // P0 Fix: Safe folder opening with NO shell interpolation or command execution
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { targetPath } = JSON.parse(body || '{}');
        if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'targetPath must be a valid string' }));
          return;
        }

        let resolved = path.isAbsolute(targetPath) ? path.normalize(targetPath) : path.resolve(ROOT_DIR, targetPath);
        if (!fs.existsSync(resolved)) {
          const alt = path.resolve(ROOT_DIR, '..', targetPath);
          if (fs.existsSync(alt)) resolved = alt;
          else resolved = ROOT_DIR;
        }

        let dir = resolved;
        try {
          const st = fs.statSync(resolved);
          if (!st.isDirectory()) dir = path.dirname(resolved);
        } catch {
          dir = ROOT_DIR;
        }

        // Safe child process spawn without shell interpolation
        let child;
        if (os.platform() === 'win32') {
          child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
        } else if (os.platform() === 'darwin') {
          child = spawn('open', [dir], { detached: true, stdio: 'ignore' });
        } else {
          child = spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' });
        }

        child.on('error', (err) => {
          console.error('Failed to open explorer:', err);
        });
        child.unref();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, openedPath: toPortablePath(dir) }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files safely
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);
  const ext = path.extname(filePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }
});

function finalizeGame(outputGameDir, gameSlug, gameTitle, targetOS, portableExePath, portableFolderPath) {
  let library = readLibrarySafely();
  const existingIndex = library.findIndex(g => g.id === gameSlug || g.slug === gameSlug);

  const gameData = {
    id: gameSlug,
    slug: gameSlug,
    title: gameTitle,
    genre: "Native PlayStation Relink",
    status: "Relinked Native PE",
    fps: "Target 60 FPS",
    targetOS: targetOS === 'windows' ? 'Windows PE' : 'Linux ELF',
    relinkedDate: new Date().toLocaleDateString(),
    executablePath: portableExePath,
    folderPath: portableFolderPath,
    banner: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=800&q=80",
    notes: `Compiled with official AnyPS5 relinker.exe and native PRX libraries.`,
    isFixture: false,
    verified: false
  };

  if (existingIndex >= 0) {
    library[existingIndex] = { ...library[existingIndex], ...gameData };
  } else {
    library.unshift(gameData);
  }

  saveLibrarySafely(library);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`=======================================================`);
  console.log(` AnyPort Studio - 1-Click AnyPS5 Native Porter Engine`);
  console.log(` Running at: http://127.0.0.1:${PORT}`);
  console.log(` AnyPS5 Core: ${toPortablePath(ANYPS5_REPO_DIR)}`);
  console.log(`=======================================================`);
});
