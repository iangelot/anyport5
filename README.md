# ANYPORT 5 🎮⚡

> **GUI Game Porter & Native Windows Launcher for AnyPS5 Relinking**  
> Built with the open-source [AnyPS5](https://github.com/boykopovar/AnyPS5) toolchain by Boyko Povar.

[![GitHub Repo](https://img.shields.io/badge/GitHub-iangelot%2Fanyport5-BFFF00?style=for-the-badge&logo=github)](https://github.com/iangelot/anyport5)
[![AnyPS5 Core](https://img.shields.io/badge/Powered%20By-AnyPS5-7D39EB?style=for-the-badge&logo=playstation)](https://github.com/boykopovar/AnyPS5)
[![Desktop App](https://img.shields.io/badge/Desktop%20App-AnyPortStudio.exe-0A0A0A?style=for-the-badge&logo=windows)]()
[![License: GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

---

## 🌟 Overview

**AnyPort 5** provides a graphical desktop environment for the **AnyPS5** binary relinker. AnyPS5 enables translation of decrypted PlayStation 5 x86-64 System V ELF executables into native Windows PE (`.exe`) binaries by redirecting system calls and dynamically linking against native Windows implementations of PlayStation system modules (libkernel, libc, libScePad, libSceVideoOut, etc.).

Because binaries run natively on the host x86-64 processor rather than through an instruction-level CPU emulator, CPU execution overhead is minimized. Actual frame rates and compatibility are host-dependent and contingent on graphics API and module support in upstream AnyPS5.

---

## 🚀 Running AnyPort 5

### Option A: Standalone Windows Desktop App (Recommended)
Double-click **`AnyPortStudio.exe`** (or launch `launch-desktop.bat`).
- Uses Microsoft Edge WebView2 for native rendering.
- Automatically launches and manages the local backend process on `127.0.0.1:4567`.
- Shuts down cleanly when the window is closed.

### Option B: Local Browser Mode
1. Double-click **`start.bat`** (or run `npm start`).
2. Navigate to `http://127.0.0.1:4567` in any modern web browser.

---

## 🛠️ Step-by-Step Workflow

```
 ┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
 │   1. LAUNCH APP      │  ──► │   2. INSPECT INPUT   │  ──► │   3. RELINK & PLAY   │
 │  AnyPortStudio.exe   │      │  Drop folder / ELF   │      │  Execute Native PE   │
 └──────────────────────┘      └──────────────────────┘      └──────────────────────┘
```

1. **Input Inspection**: Select your decrypted PS5 game directory containing `input.elf` or `eboot.bin` and its module directory (`sce_module/`).
2. **Hardware Configuration**:
   - `--to-intel`: Automatically lowers AMD Zen 2 specific instruction encodings for flawless execution on Intel processors.
   - `--windows-gui`: Configures Windows subsystem for GUI window creation without a background console.
   - `--rpath`: Sets the runtime search directory for bundled PRX modules.
3. **Compile**: Click **COMPILE NATIVE WINDOWS EXECUTABLE**. The live terminal displays NID symbol resolution, dynamic relocation rewriting, and PE generation.
4. **Launch**: Launch directly from the Port Hub or export a launcher script to Steam.

---

## 📂 Repository Structure

```
anyport5/
├── AnyPortStudio.exe      # Standalone C# WebView2 Windows Desktop Launcher
├── Launcher.cs            # Source code for AnyPortStudio launcher
├── server.js              # Hardened Node.js backend API & process lifecycle manager
├── package.json           # Project manifest (scripts & dependencies)
├── launch-desktop.bat     # Helper script to launch desktop shell
├── start.bat              # Helper script to start backend & browser
├── bin/
│   ├── relinker.exe       # Upstream AnyPS5 relinker compiler
│   └── libs/              # 101 Native Sony Prospero PRX module stubs & DLLs
├── public/
│   ├── index.html         # Esports / Cyberpunk UI layout
│   ├── app.css            # Dark mode design tokens & styling
│   └── app.js             # Client logic, sanitization, and state recovery
├── games/
│   ├── library.json       # Portable game library metadata
│   └── dreaming-sarah/    # Community-tested native port fixture
└── sample_game/           # Minimal System V ELF fixture for pipeline validation
```

---

## 🔒 Security & Architecture Hardening

In accordance with our repository technical audit:
- **Command Injection Prevention**: All filesystem inspection, folder opening, and compiler invocations use `spawn()` with argument arrays and direct paths, with zero shell interpolation.
- **CORS Protection**: API access is restricted strictly to local origins (`localhost` / `127.0.0.1` and local desktop app contexts).
- **Process Management**: Relinker tasks are managed via a job queue with execution timeouts, cancel endpoints, and durable state recovery over Server-Sent Events.
- **Portability**: All paths in `games/library.json` use relative portable locations, validated against disk at startup. Missing executables are labeled as uncompiled.
- **DOM Sanitization**: User-controlled and dynamic strings in the UI are sanitized before rendering.

---

## 🧪 Clean-Machine Validation Checklist

To test AnyPort 5 on a fresh Windows 10/11 system:
1. Ensure the **Microsoft Edge WebView2 Runtime** is present (standard on Windows 10 20H1+ and Windows 11).
2. Ensure **Node.js** (v18+) is installed or `node.exe` is placed alongside `AnyPortStudio.exe`.
3. Launch `AnyPortStudio.exe`. Verify the splash screen initializes and the UI appears on port 4567.
4. Go to **1-CLICK PORTER**, load `sample_game`, click **INSPECT**, and confirm the binary is recognized.
5. Compile and verify that `games/dreaming-sarah/app.exe` can be launched.

---

## 📜 Licensing & Upstream Attribution

- **AnyPS5 Core & Relinker**: Developed by **Boyko Povar** ([github.com/boykopovar/AnyPS5](https://github.com/boykopovar/AnyPS5)) and contributors, licensed under the **GNU General Public License v2.0 (GPL-2.0)**.
- **AnyPort Studio**: Desktop launcher shell, backend management API, and frontend interface are licensed under **GPL-2.0-or-later** in compliance with upstream licensing.

### Legal Disclaimer
AnyPort 5 is an independent open-source toolchain GUI. It is not affiliated with, authorized, or endorsed by Sony Interactive Entertainment or Sony Corporation. AnyPort 5 does not circumvent digital rights management (DRM), decrypt encrypted packages (`.pkg`), or distribute proprietary game data. Users are solely responsible for obtaining and decrypting their own legally acquired game files on authorized hardware.
