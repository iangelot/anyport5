const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 4567;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const GAMES_DIR = path.join(ROOT_DIR, 'games');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const ANYPS5_REPO_DIR = path.resolve(ROOT_DIR, '..', 'AnyPS5');
const LIBRARY_FILE = path.join(GAMES_DIR, 'library.json');

// Generate per-run session token for authorization
const SESSION_TOKEN = crypto.randomBytes(24).toString('hex');

// Ensure base directories exist
if (!fs.existsSync(GAMES_DIR)) fs.mkdirSync(GAMES_DIR, { recursive: true });
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

// Track approved folder paths for /api/open-folder
const approvedPaths = new Set([
  path.normalize(ROOT_DIR),
  path.normalize(GAMES_DIR),
  path.normalize(BIN_DIR),
  path.normalize(path.join(ROOT_DIR, 'sample_game'))
]);

function registerApprovedPath(p) {
  if (p && typeof p === 'string') {
    approvedPaths.add(path.normalize(p));
  }
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

// In-Memory Job Manager
const activeJobs = new Map();

function transitionJobState(job, newStatus, details = {}) {
  if (!job || job.status !== 'running') {
    return false; // Prevent race conditions once a terminal state is reached
  }
  job.status = newStatus;
  job.endTime = Date.now();
  if (details.exitCode !== undefined) job.exitCode = details.exitCode;
  if (details.error) job.error = details.error;
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  return true;
}

function cleanupPartialOutput(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < 1024) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (os.platform() === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

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

  // Enforce 5-minute timeout
  const timeoutMs = 5 * 60 * 1000;
  job.timer = setTimeout(() => {
    if (transitionJobState(job, 'timed_out', { error: 'Relinker process timed out after 5 minutes.' })) {
      broadcastLog({ type: 'error', text: `Job ${jobId} timed out. Terminating process.` });
      killProcessTree(proc);
      cleanupPartialOutput(outputFile);
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

// Bounded JSON body reader (DoS prevention)
function readJsonBody(req, res, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (maximum 64KB)' }));
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        resolve(parsed);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed JSON payload' }));
        reject(err);
      }
    });
  });
}

// Binary ELF Header Validation
function validateElfBinary(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { valid: false, error: 'File does not exist' };
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { valid: false, error: 'Target path is not a file' };
    if (stat.size < 64) return { valid: false, error: 'File is smaller than a 64-byte ELF header' };

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    // Verify 0x7F, 'E', 'L', 'F'
    const isElf = buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46;
    if (!isElf) {
      return { valid: false, error: 'Not an ELF binary (missing 0x7F454C46 magic)' };
    }

    const is64Bit = buffer[4] === 0x02; // ELFCLASS64
    const isLittleEndian = buffer[5] === 0x01; // ELFDATA2LSB

    if (!is64Bit) {
      return { valid: false, error: 'ELF is not 64-bit (PlayStation 5 requires x86-64)' };
    }

    return {
      valid: true,
      is64Bit,
      isLittleEndian,
      size: stat.size
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// Copy directory recursively helper
function copyDirRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Resilient library reader and atomic writer
function readLibrarySafely() {
  try {
    if (!fs.existsSync(LIBRARY_FILE)) return [];
    const content = fs.readFileSync(LIBRARY_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading library.json:', err);
    if (fs.existsSync(LIBRARY_FILE)) {
      try {
        const backupPath = `${LIBRARY_FILE}.corrupt.${Date.now()}`;
        fs.copyFileSync(LIBRARY_FILE, backupPath);
        console.warn(`Corrupted library.json backed up to ${backupPath}`);
      } catch {}
    }
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

function isOriginAllowed(origin, host) {
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!origin || origin === 'null') {
    // Local app, electron, or curl. Check Host header.
    return allowedHosts.includes(host);
  }
  try {
    const parsed = new URL(origin);
    const originHost = parsed.host;
    return allowedHosts.includes(originHost);
  } catch {
    return false;
  }
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host || `127.0.0.1:${PORT}`;

  if (isOriginAllowed(origin, host)) {
    if (origin && origin !== 'null') {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', `http://${host}`);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AnyPort-Token');
}

function verifyRequestSecurity(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  if (!isOriginAllowed(origin, host)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: Untrusted origin or host' }));
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  const pathname = parsedUrl.pathname;

  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Session Token Handshake
  if (pathname === '/api/session' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: SESSION_TOKEN, port: PORT }));
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

  // Server-Sent Events
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    sseClients.push(res);

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

  // Library listing with disk verification
  if (pathname === '/api/library' && req.method === 'GET') {
    const rawLibrary = readLibrarySafely();
    const validatedLibrary = rawLibrary.map(item => {
      const resolvedExe = resolveExecutablePath(item.executablePath);
      let fileExists = false;
      let fileSize = 0;
      if (resolvedExe && fs.existsSync(resolvedExe)) {
        try {
          const stat = fs.statSync(resolvedExe);
          fileExists = stat.isFile() && stat.size >= 1024;
          fileSize = stat.size;
        } catch {}
      }

      const resolvedFolder = item.folderPath ? resolveExecutablePath(item.folderPath) : (resolvedExe ? path.dirname(resolvedExe) : '');
      const folderExists = resolvedFolder ? fs.existsSync(resolvedFolder) : false;
      const app0Exists = resolvedFolder ? fs.existsSync(path.join(resolvedFolder, 'app0')) : false;

      return {
        ...item,
        fileExists,
        fileSize,
        folderExists,
        hasApp0Assets: app0Exists,
        portableExecutablePath: toPortablePath(item.executablePath),
        portableFolderPath: item.folderPath ? toPortablePath(item.folderPath) : ''
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(validatedLibrary));
    return;
  }

  // Active relink job
  if (pathname === '/api/relink/active' && req.method === 'GET') {
    const active = getActiveJob();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      activeJob: active ? { id: active.id, gameSlug: active.gameSlug, gameTitle: active.gameTitle, startTime: active.startTime } : null 
    }));
    return;
  }

  // Job status
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
      error: job.error || null,
      logsCount: job.logs.length
    }));
    return;
  }

  // Cancel relinking job
  if (pathname === '/api/relink/cancel' && req.method === 'POST') {
    if (!verifyRequestSecurity(req, res)) return;
    try {
      const payload = await readJsonBody(req, res);
      const { jobId } = payload;
      const targetJob = jobId ? activeJobs.get(jobId) : getActiveJob();

      if (!targetJob || targetJob.status !== 'running') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No running job to cancel' }));
        return;
      }

      if (transitionJobState(targetJob, 'cancelled')) {
        killProcessTree(targetJob.process);
        cleanupPartialOutput(targetJob.outputFile);
        broadcastLog({ type: 'error', text: `Job "${targetJob.gameTitle}" was cancelled by user.` });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, jobId: targetJob.id }));
    } catch {
      // Body reader handles response on parse error
    }
    return;
  }

  // Scan path endpoint with ELF header inspection and module layout policy
  if (pathname === '/api/scan-path' && req.method === 'POST') {
    if (!verifyRequestSecurity(req, res)) return;
    try {
      const payload = await readJsonBody(req, res);
      const { targetPath } = payload;

      if (!targetPath || typeof targetPath !== 'string' || targetPath.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path parameter provided' }));
        return;
      }

      let resolvedPath = path.isAbsolute(targetPath) ? path.normalize(targetPath) : path.resolve(ROOT_DIR, targetPath);

      if (!fs.existsSync(resolvedPath)) {
        const altPath = path.resolve(ROOT_DIR, '..', targetPath);
        if (fs.existsSync(altPath)) resolvedPath = altPath;
      }

      if (!fs.existsSync(resolvedPath)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Directory not found: ${targetPath}` }));
        return;
      }

      registerApprovedPath(resolvedPath);

      const stats = fs.statSync(resolvedPath);
      let dirToScan = stats.isDirectory() ? resolvedPath : path.dirname(resolvedPath);
      registerApprovedPath(dirToScan);

      const files = fs.readdirSync(dirToScan);

      // Find all candidate ELF files and validate headers
      const elfCandidates = [];
      for (const f of files) {
        if (f.endsWith('.elf') || f === 'eboot.bin') {
          const fullCand = path.join(dirToScan, f);
          const elfValid = validateElfBinary(fullCand);
          elfCandidates.push({
            name: f,
            valid: elfValid.valid,
            size: elfValid.size || 0,
            error: elfValid.error || null
          });
        }
      }

      const hasInputElf = files.includes('input.elf');
      const hasEboot = files.includes('eboot.bin');

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

      // Check for app0 resources
      const hasApp0 = files.includes('app0') && fs.statSync(path.join(dirToScan, 'app0')).isDirectory();

      // Module layout policy according to upstream AnyPS5
      let validity = 'valid';
      let message = 'Ready for relinking';

      if (hasSceModule && hasSceModules) {
        validity = 'error';
        message = 'Layout Error: Both sce_module/ and sce_modules/ exist. AnyPS5 requires exactly one.';
      } else if (elfCandidates.length === 0) {
        validity = 'error';
        message = 'No ELF executable (input.elf or eboot.bin) found.';
      } else if (!moduleDirFound) {
        validity = 'error';
        message = 'Missing PlayStation module directory (sce_module/, sce_modules/, or prx/ is required by AnyPS5).';
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
        hasApp0,
        validity,
        message
      }));
    } catch {}
    return;
  }

  // Relink execution endpoint with strict validation & runtime layout preservation
  if (pathname === '/api/relink' && req.method === 'POST') {
    if (!verifyRequestSecurity(req, res)) return;
    try {
      const payload = await readJsonBody(req, res);
      const {
        sourcePath,
        selectedElf,
        gameTitle = 'Converted PS5 Game',
        targetOS = 'windows',
        toIntel = false,
        windowsGui = true,
        windowsDiagnostics = false,
        allowDebugSkipModules = false,
        rpath = '$ORIGIN/libs'
      } = payload;

      // Strict validation of targetOS
      if (targetOS !== 'windows' && targetOS !== 'linux') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Invalid targetOS: "${targetOS}". Must be 'windows' or 'linux'.` }));
        return;
      }

      // Strict validation of boolean flags
      if (typeof toIntel !== 'boolean' || typeof windowsGui !== 'boolean' || typeof windowsDiagnostics !== 'boolean') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Flags toIntel, windowsGui, and windowsDiagnostics must be booleans.' }));
        return;
      }

      // Strict validation of rpath
      if (typeof rpath !== 'string' || !/^\$ORIGIN([/\w.-]*)$|^([\w./-]+)$/.test(rpath) || rpath.length > 120) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid rpath format. Must be a safe relative or $ORIGIN path.' }));
        return;
      }

      if (!sourcePath || typeof sourcePath !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sourcePath is required.' }));
        return;
      }

      const runningJob = getActiveJob();
      if (runningJob) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `A relinking job is already active: "${runningJob.gameTitle}"` }));
        return;
      }

      const ext = os.platform() === 'win32' ? '.exe' : '';
      const relinkerBinary = path.join(BIN_DIR, `relinker${ext}`);
      if (!fs.existsSync(relinkerBinary)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'relinker binary not found in bin directory.' }));
        return;
      }

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

      let inputDir = resolvedSource;
      let inputFile = resolvedSource;

      if (fs.statSync(resolvedSource).isDirectory()) {
        inputDir = resolvedSource;
        if (selectedElf && fs.existsSync(path.join(resolvedSource, selectedElf))) {
          inputFile = path.join(resolvedSource, selectedElf);
        } else if (fs.existsSync(path.join(resolvedSource, 'input.elf'))) {
          inputFile = path.join(resolvedSource, 'input.elf');
        } else if (fs.existsSync(path.join(resolvedSource, 'eboot.bin'))) {
          inputFile = path.join(resolvedSource, 'eboot.bin');
        } else {
          const elfs = fs.readdirSync(resolvedSource).filter(f => f.endsWith('.elf'));
          if (elfs.length > 0) inputFile = path.join(resolvedSource, elfs[0]);
          else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No ELF or eboot.bin found in specified directory.' }));
            return;
          }
        }
      } else {
        inputDir = path.dirname(resolvedSource);
      }

      // Validate ELF binary magic header
      const elfCheck = validateElfBinary(inputFile);
      if (!elfCheck.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Input file is not a valid 64-bit ELF: ${elfCheck.error}` }));
        return;
      }

      // Check module directory policy
      const hasSceMod = fs.existsSync(path.join(inputDir, 'sce_module'));
      const hasSceMods = fs.existsSync(path.join(inputDir, 'sce_modules'));
      const hasPrx = fs.existsSync(path.join(inputDir, 'prx'));

      if (hasSceMod && hasSceMods) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Both sce_module/ and sce_modules/ exist. AnyPS5 requires exactly one.' }));
        return;
      }

      let useSkipSceModule = false;
      if (!hasSceMod && !hasSceMods && !hasPrx) {
        if (!allowDebugSkipModules) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Missing PlayStation module directory (sce_module/, sce_modules/, or prx/). Upstream AnyPS5 requires a valid module directory. For debugging without modules, explicitly enable the debug override.' 
          }));
          return;
        }
        useSkipSceModule = true;
      }

      const gameSlug = gameTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `game-${Date.now()}`;
      const outputGameDir = path.join(GAMES_DIR, gameSlug);
      if (!fs.existsSync(outputGameDir)) fs.mkdirSync(outputGameDir, { recursive: true });
      registerApprovedPath(outputGameDir);

      // Copy AnyPS5 target-OS system PRX libraries into output game's libs/
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

      // Preserve app0/ game resources and title modules if present
      const sourceApp0 = path.join(inputDir, 'app0');
      const destApp0 = path.join(outputGameDir, 'app0');
      if (fs.existsSync(sourceApp0) && fs.statSync(sourceApp0).isDirectory() && !fs.existsSync(destApp0)) {
        try {
          copyDirRecursiveSync(sourceApp0, destApp0);
          broadcastLog({ type: 'info', text: 'Preserved app0/ game resources in output bundle.' });
        } catch {}
      }

      const outName = targetOS === 'windows' ? 'app.exe' : 'app.elf';
      const outputFile = path.resolve(outputGameDir, outName);

      const args = [];
      if (targetOS === 'windows') args.push('--windows');
      if (windowsGui) args.push('--windows-gui');
      if (windowsDiagnostics) args.push('--windows-diagnostics');
      if (toIntel) args.push('--to-intel');
      if (useSkipSceModule) args.push('--skip-sce-module');

      args.push('--rpath', rpath);
      args.push(inputFile);
      args.push(outputFile);

      broadcastLog({ type: 'start', text: `=== Starting AnyPS5 Relinker: ${gameTitle} ===` });
      broadcastLog({ type: 'cmd', text: `$ relinker ${args.join(' ')}` });

      let proc;
      try {
        proc = spawn(relinkerBinary, args, { cwd: outputGameDir });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Failed to spawn relinker: ${err.message}` }));
        return;
      }

      const job = createJob(gameSlug, gameTitle, outputGameDir, outputFile, targetOS, proc);

      // Handle spawn error explicitly
      proc.on('error', err => {
        if (transitionJobState(job, 'failed', { error: err.message })) {
          broadcastLog({ type: 'error', text: `Failed to execute relinker binary: ${err.message}` });
          cleanupPartialOutput(outputFile);
        }
      });

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
        if (job.status !== 'running') {
          // If already cancelled or timed out, do not overwrite
          cleanupPartialOutput(outputFile);
          return;
        }

        if (code === 0) {
          transitionJobState(job, 'completed', { exitCode: 0 });
          const portableExe = toPortablePath(outputFile);
          const portableFolder = toPortablePath(outputGameDir);
          const isDebug = useSkipSceModule;
          finalizeGame(outputGameDir, gameSlug, gameTitle, targetOS, portableExe, portableFolder, isDebug);
          broadcastLog({ type: 'success', text: `✓ Relinking complete! Generated native executable: ${portableExe}` });
        } else {
          transitionJobState(job, 'failed', { exitCode: code });
          cleanupPartialOutput(outputFile);
          broadcastLog({ type: 'error', text: `✗ Relinker exited with error code ${code}. Inspect logs for missing NIDs or unsupported calls.` });
        }
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, jobId: job.id, gameSlug, outputPath: toPortablePath(outputFile) }));
    } catch {}
    return;
  }

  // Safe Launch Process endpoint
  if (pathname === '/api/launch' && req.method === 'POST') {
    if (!verifyRequestSecurity(req, res)) return;
    try {
      const payload = await readJsonBody(req, res);
      const { gameId } = payload;
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
      if (!exePath || !fs.existsSync(exePath) || fs.statSync(exePath).size < 1024) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: `Executable '${game.executablePath}' does not exist on disk or has not been compiled yet.` 
        }));
        return;
      }

      const gameDir = path.dirname(exePath);
      const libsDir = path.join(gameDir, 'libs');

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
    } catch {}
    return;
  }

  // Safe Steam Launcher Export (ZERO interpolation of gameTitle into batch commands)
  if (pathname === '/api/export-steam' && req.method === 'POST') {
    if (!verifyRequestSecurity(req, res)) return;
    try {
      const payload = await readJsonBody(req, res);
      const { gameId } = payload;
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
      // Strictly static batch command with NO string interpolation to prevent injection
      const batContent = `@echo off\r\ncd /d "%~dp0"\r\nstart "" "app.exe"\r\nexit\r\n`;
      fs.writeFileSync(batPath, batContent);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        scriptPath: toPortablePath(batPath),
        message: `Created Steam launcher at ${toPortablePath(batPath)}.`
      }));
    } catch {}
    return;
  }

  // Path-Restricted /api/open-folder
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    if (!verifyRequestSecurity(req, res)) return;
    try {
      const payload = await readJsonBody(req, res);
      const { targetPath } = payload;

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

      const normalizedDir = path.normalize(dir);
      const rootNormalized = path.normalize(ROOT_DIR);

      // Verify that target path is within project root or approved scan source
      const isApproved = normalizedDir.startsWith(rootNormalized) || approvedPaths.has(normalizedDir);
      if (!isApproved) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied: Directory is outside allowed application paths.' }));
        return;
      }

      let child;
      if (os.platform() === 'win32') {
        child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' });
      } else if (os.platform() === 'darwin') {
        child = spawn('open', [dir], { detached: true, stdio: 'ignore' });
      } else {
        child = spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' });
      }

      child.on('error', () => {});
      child.unref();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, openedPath: toPortablePath(dir) }));
    } catch {}
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

function finalizeGame(outputGameDir, gameSlug, gameTitle, targetOS, portableExePath, portableFolderPath, isDebug) {
  let library = readLibrarySafely();
  const existingIndex = library.findIndex(g => g.id === gameSlug || g.slug === gameSlug);

  const status = isDebug ? "Debug Build (Missing Modules)" : "Relinked PE (Untested Local Run)";
  const notes = isDebug 
    ? "Debug build relinked with --skip-sce-module. Not supported for full gameplay."
    : "Relinked binary. Runtime stability, graphics presentation, and frame rate require independent hardware verification.";

  const gameData = {
    id: gameSlug,
    slug: gameSlug,
    title: gameTitle,
    genre: "Native PlayStation Relink",
    status,
    fps: "Untested (Hardware Dependent)",
    targetOS: targetOS === 'windows' ? 'Windows PE' : 'Linux ELF',
    relinkedDate: new Date().toLocaleDateString(),
    executablePath: portableExePath,
    folderPath: portableFolderPath,
    banner: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=800&q=80",
    notes,
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
  console.log(` Session Security: Active`);
  console.log(`=======================================================`);
});
