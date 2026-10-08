const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');

const PORT = process.env.PORT || 4567;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const GAMES_DIR = path.join(ROOT_DIR, 'games');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const ANYPS5_REPO_DIR = path.resolve(ROOT_DIR, '..', 'AnyPS5');
const LIBRARY_FILE = path.join(GAMES_DIR, 'library.json');

// Ensure directories exist
if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

// Initialize clean library
if (!fs.existsSync(LIBRARY_FILE)) {
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify([], null, 2));
}

let sseClients = [];

function broadcastLog(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(msg));
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
    relinkerPath: hasLocal ? localRelinker : 'Not Found',
    isSimulationMode: false,
    prxCount,
    binDirectory: BIN_DIR,
    repoDirectory: ANYPS5_REPO_DIR
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

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(client => client !== res);
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', text: 'Connected to AnyPS5 Native Engine' })}\n\n`);
    return;
  }

  if (pathname === '/api/specs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getSystemSpecs()));
    return;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getRelinkerInfo()));
    return;
  }

  if (pathname === '/api/library' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(LIBRARY_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
    }
    return;
  }

  if (pathname === '/api/scan-path' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { targetPath } = JSON.parse(body);
        let resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(ROOT_DIR, targetPath);

        if (!fs.existsSync(resolvedPath)) {
          // Check relative to scratch or AnyPS5
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
          message = 'No ELF executable (input.elf or eboot.bin) found.';
        } else if (!moduleDirFound) {
          validity = 'warning';
          message = 'No bundled module directory found (sce_module, sce_modules, or prx).';
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resolvedPath: dirToScan,
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

  // Real Execution Relinking API
  if (pathname === '/api/relink' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const {
          sourcePath,
          gameTitle = 'Converted PS5 Game',
          targetOS = 'windows',
          toIntel = false,
          windowsGui = true,
          windowsDiagnostics = false,
          rpath = '$ORIGIN/libs',
          unusedFilter = 0
        } = payload;

        broadcastLog({ type: 'start', text: `=== Starting Real AnyPS5 Relinker: ${gameTitle} ===` });
        const relinkerInfo = getRelinkerInfo();

        if (!relinkerInfo.installed) {
          broadcastLog({ type: 'error', text: `FAIL: relinker.exe binary not found at ${relinkerInfo.relinkerPath}` });
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'relinker.exe not found' }));
          return;
        }

        const gameSlug = gameTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game-' + Date.now();
        const outputGameDir = path.join(GAMES_DIR, gameSlug);
        if (!fs.existsSync(outputGameDir)) fs.mkdirSync(outputGameDir, { recursive: true });

        // Copy native PRX libraries into output game's libs/ folder
        const libsSource = path.join(BIN_DIR, 'libs');
        const libsDest = path.join(outputGameDir, 'libs');
        if (!fs.existsSync(libsDest)) fs.mkdirSync(libsDest, { recursive: true });
        if (fs.existsSync(libsSource)) {
          const prxFiles = fs.readdirSync(libsSource);
          prxFiles.forEach(f => {
            const srcF = path.join(libsSource, f);
            const dstF = path.join(libsDest, f);
            if (!fs.existsSync(dstF)) {
              try { fs.copyFileSync(srcF, dstF); } catch {}
            }
          });
        }

        // Determine input file (always absolute path)
        let resolvedSource = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(ROOT_DIR, sourcePath);
        if (!fs.existsSync(resolvedSource)) {
          const alt = path.resolve(ROOT_DIR, '..', sourcePath);
          if (fs.existsSync(alt)) resolvedSource = alt;
        }

        let inputFile = resolvedSource;
        if (fs.existsSync(resolvedSource) && fs.statSync(resolvedSource).isDirectory()) {
          if (fs.existsSync(path.join(resolvedSource, 'input.elf'))) {
            inputFile = path.join(resolvedSource, 'input.elf');
          } else if (fs.existsSync(path.join(resolvedSource, 'eboot.bin'))) {
            inputFile = path.join(resolvedSource, 'eboot.bin');
          } else {
            const elfs = fs.readdirSync(resolvedSource).filter(f => f.endsWith('.elf'));
            if (elfs.length > 0) inputFile = path.join(resolvedSource, elfs[0]);
          }
        }

        const outName = targetOS === 'windows' ? 'app.exe' : 'app.elf';
        const outputFile = path.resolve(outputGameDir, outName);

        const args = [];
        if (targetOS === 'windows') args.push('--windows');
        if (windowsGui) args.push('--windows-gui');
        if (windowsDiagnostics) args.push('--windows-diagnostics');
        if (toIntel) args.push('--to-intel');
        const inputDir = path.dirname(inputFile);
        const hasSceMod = fs.existsSync(path.join(inputDir, 'sce_module')) || fs.existsSync(path.join(inputDir, 'sce_modules')) || fs.existsSync(path.join(inputDir, 'prx'));
        if (!hasSceMod) {
          args.push('--skip-sce-module');
        }
        args.push(`--rpath`);
        args.push(rpath);
        args.push(inputFile);
        args.push(outputFile);

        broadcastLog({ type: 'cmd', text: `$ relinker.exe ${args.join(' ')}` });

        const proc = spawn(relinkerInfo.relinkerPath, args, { cwd: outputGameDir });

        proc.stdout.on('data', data => {
          const lines = data.toString().split('\n');
          lines.forEach(l => {
            if (l.trim()) broadcastLog({ type: 'stdout', text: l.trim() });
          });
        });

        proc.stderr.on('data', data => {
          const lines = data.toString().split('\n');
          lines.forEach(l => {
            if (l.trim()) broadcastLog({ type: 'stderr', text: l.trim() });
          });
        });

        proc.on('close', code => {
          if (code === 0) {
            finalizeGame(outputGameDir, gameSlug, gameTitle, targetOS, outputFile);
            broadcastLog({ type: 'success', text: `✓ Relinking complete! Generated native: ${outputFile}` });
          } else {
            broadcastLog({ type: 'error', text: `✗ Relinker exited with code ${code}. Check the logs above for missing NIDs or format issues.` });
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, gameSlug }));
      } catch (err) {
        broadcastLog({ type: 'error', text: `Failed: ${err.message}` });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Launch Real Process
  if (pathname === '/api/launch' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { gameId } = JSON.parse(body);
        let library = [];
        try { library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')); } catch {}
        const game = library.find(g => g.id === gameId);

        if (!game) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Game '${gameId}' not found in library` }));
          return;
        }

        const exePath = game.executablePath;
        if (!fs.existsSync(exePath) || fs.statSync(exePath).size < 1000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: `Executable '${exePath}' does not exist or has not been relinked from a real game binary yet.` 
          }));
          return;
        }

        const gameDir = path.dirname(exePath);
        const libsDir = path.join(gameDir, 'libs');

        // Set DLL search path so Windows loads the PRX and MinGW DLLs
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

        broadcastLog({ type: 'cmd', text: `[RUN] Launched real native process: ${exePath} (PID: ${gameProc.pid})` });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, pid: gameProc.pid }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/open-folder' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { targetPath } = JSON.parse(body);
        const dir = fs.existsSync(targetPath) ? (fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath)) : ROOT_DIR;
        if (os.platform() === 'win32') {
          exec(`explorer.exe "${dir}"`);
        } else {
          exec(`xdg-open "${dir}"`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
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

function finalizeGame(outputGameDir, gameSlug, gameTitle, targetOS, exePath) {
  let library = [];
  try {
    library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
  } catch {}

  const existingIndex = library.findIndex(g => g.id === gameSlug);
  const gameData = {
    id: gameSlug,
    title: gameTitle,
    genre: "Native PlayStation Relink",
    status: "Native Executable",
    fps: 60,
    targetOS: targetOS === 'windows' ? 'Windows PE' : 'Linux ELF',
    relinkedDate: new Date().toLocaleDateString(),
    executablePath: exePath,
    banner: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=800&q=80",
    notes: `Compiled with official AnyPS5 relinker.exe and native PRX libraries.`
  };

  if (existingIndex >= 0) {
    library[existingIndex] = gameData;
  } else {
    library.unshift(gameData);
  }

  fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2));
}

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` AnyPort Studio - 1-Click AnyPS5 Native Porter`);
  console.log(` Running at: http://localhost:${PORT}`);
  console.log(` AnyPS5 Core: ${ANYPS5_REPO_DIR}`);
  console.log(`=======================================================`);
});
