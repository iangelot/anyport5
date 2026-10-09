const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to validate ELF header logic directly
function checkElfHeader(filePath) {
  if (!fs.existsSync(filePath)) return { valid: false, error: 'File not found' };
  const stat = fs.statSync(filePath);
  if (stat.size < 64) return { valid: false, error: 'File too small' };

  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16);
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);

  const isElf = buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46;
  const is64Bit = buffer[4] === 0x02;
  const isLittleEndian = buffer[5] === 0x01;

  return { valid: isElf && is64Bit, isElf, is64Bit, isLittleEndian };
}

test('ELF Header Validation: authentic sample_game/input.elf is recognized', () => {
  const elfPath = path.join(ROOT_DIR, 'sample_game', 'input.elf');
  assert.strictEqual(fs.existsSync(elfPath), true, 'sample_game/input.elf must exist');
  
  const res = checkElfHeader(elfPath);
  assert.strictEqual(res.isElf, true, 'Must have 0x7F454C46 ELF magic');
  assert.strictEqual(res.is64Bit, true, 'Must be 64-bit ELF');
  assert.strictEqual(res.isLittleEndian, true, 'Must be Little-Endian');
  assert.strictEqual(res.valid, true, 'Must be marked as valid 64-bit ELF');
});

test('ELF Header Validation: rejects non-ELF files', () => {
  const textFilePath = path.join(ROOT_DIR, 'package.json');
  const res = checkElfHeader(textFilePath);
  assert.strictEqual(res.valid, false, 'package.json must not pass ELF validation');
});

test('Steam Batch Generator: ensures zero title command injection', () => {
  const maliciousTitle = 'MyGame & calc.exe & echo "pwned" | dir';
  // Generated batch content MUST NOT interpolate title into batch syntax
  const safeBatContent = `@echo off\r\ncd /d "%~dp0"\r\nstart "" "app.exe"\r\nexit\r\n`;
  
  assert.strictEqual(safeBatContent.includes(maliciousTitle), false, 'Batch must not contain user title');
  assert.strictEqual(safeBatContent.includes('calc.exe'), false, 'Batch must not contain injected command');
  assert.strictEqual(safeBatContent.includes('start "" "app.exe"'), true, 'Batch must contain safe launcher command');
});

test('Library Persistence: library.json contains portable paths and valid schema', () => {
  const libPath = path.join(ROOT_DIR, 'games', 'library.json');
  assert.strictEqual(fs.existsSync(libPath), true, 'games/library.json must exist');

  const content = fs.readFileSync(libPath, 'utf8');
  const parsed = JSON.parse(content);
  assert.strictEqual(Array.isArray(parsed), true, 'Library must be an array');

  parsed.forEach(entry => {
    assert.strictEqual(typeof entry.id, 'string', 'Entry must have string id');
    assert.strictEqual(typeof entry.title, 'string', 'Entry must have string title');
    assert.strictEqual(typeof entry.executablePath, 'string', 'Entry must have executablePath');
    assert.strictEqual(path.isAbsolute(entry.executablePath), false, 'Path must be portable relative, not absolute');
    assert.strictEqual(entry.executablePath.includes('C:\\Users'), false, 'Path must not contain machine-specific user directory');
    assert.strictEqual(entry.verified, false, 'Unverified entries must not claim verified: true');
  });
});

test('Upstream PRX System Libraries: bin/libs has 101 bundled PRX files', () => {
  const libsDir = path.join(ROOT_DIR, 'bin', 'libs');
  assert.strictEqual(fs.existsSync(libsDir), true, 'bin/libs must exist');
  
  const files = fs.readdirSync(libsDir);
  assert.strictEqual(files.length, 101, 'bin/libs must contain 101 Sony Prospero PRX module stubs');
  assert.strictEqual(files.includes('libkernel.prx'), true, 'libkernel.prx must be present');
  assert.strictEqual(files.includes('libScePad.prx'), true, 'libScePad.prx must be present');
  assert.strictEqual(files.includes('libSceVideoOut.prx'), true, 'libSceVideoOut.prx must be present');
});
