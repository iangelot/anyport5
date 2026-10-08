# AnyPort Studio 🎮⚡

> **Next-Gen PlayStation 5 Native PC Porter & Launcher for AnyPS5 Executable Relinking**

[![AnyPS5 Compatible](https://img.shields.io/badge/AnyPS5-Native_Relinker-0070d1?style=for-the-badge&logo=playstation)](https://github.com/boykopovar/AnyPS5)
[![Executable](https://img.shields.io/badge/Single_Binary-AnyPortStudio.exe-00a2ff?style=for-the-badge&logo=windows)](https://github.com/boykopovar/AnyPS5)
[![Native PRX](https://img.shields.io/badge/Sony_PRX_Modules-101_Linked-8b5cf6?style=for-the-badge)]()
[![Zero Emulation](https://img.shields.io/badge/Overhead-0%25%20(Pure%20Native)-10b981?style=for-the-badge)]()

AnyPort Studio turns the technical command-line [AnyPS5](https://github.com/boykopovar/AnyPS5) relinker into an ultra-clean, console-grade desktop application. Convert decrypted PlayStation 5 System V ELF executables into native Windows PE (`.exe`) binaries with **zero emulation overhead**.

---

## ✨ Features

- **🎮 Console UI/UX Design System**: Built with modern PlayStation 5 and Steam Big Picture aesthetics—featuring ambient dark glows, dynamic hero showcase with live backdrop transitions, side thumbnail stacks, and smooth card carousels.
- **⚡ 1-Click Standalone Desktop App (`AnyPortStudio.exe`)**: Zero-install standalone Windows executable that launches in a clean, frameless desktop window.
- **🔬 Hardware Telemetry & Architecture Lowering**: Live host CPU detection with automatic AMD Zen 2 to Intel opcode lowering (`--to-intel`), ensuring smooth 60 FPS boots on Intel processors.
- **📁 1-Click Game Source Inspector**: Automatically analyzes input ELF binaries (`input.elf`, `eboot.bin`), parses bundled PRX directories (`sce_module/`, `sce_modules/`, `prx/`), and detects format compliance.
- **📟 Live Relinker HUD & Terminal Pipeline**: Real-time 5-step visual stepper tracking ELF header parsing, Intel codegen lowering, SysV dynamic linking, PE generation, and process readiness with streaming logs over Server-Sent Events (SSE).
- **📦 Pre-Bundled with 101 Native PRX Libraries**: Ships with all 101 Sony Prospero system libraries from AnyPS5 (`libScePad`, `libSceAudioOut`, `libSceVideoOut`, `libSceAgcDriver`, `libSceSaveData`, etc.).
- **🚀 Verified Native Game Hub**: Launch games natively with isolated DLL search paths, open target directories, or export Steam Big Picture / Steam Deck `.vdf` shortcuts.

---

## 🕹️ Quick Start

### Option 1: Standalone Windows App
Double-click `AnyPortStudio.exe` in the application folder. The app will launch in a clean, frameless desktop console window.

### Option 2: Command Line / Node.js
```bash
npm start
```
Then navigate to `http://localhost:4567` in any web browser.

---

## 🛠️ How to Port a PlayStation 5 Game

1. **Open the Relink Studio tab** in AnyPort Studio (or click `+ Relink New Title`).
2. Point the source path to your decrypted game folder containing `input.elf` (or `eboot.bin`).
3. Click **Inspect** to check ELF headers and bundled PRX modules.
4. Toggle your optimization flags:
   - `--to-intel`: Lowers AMD Zen 2 instructions for Intel CPUs.
   - `--windows-gui`: Direct window rendering without cmd popups.
   - `--windows-diagnostics`: Early PRX module loading logs.
5. Click **COMPILE NATIVE WINDOWS EXECUTABLE**.
6. Watch the live 5-step compiler pipeline in the terminal HUD.
7. Return to the **Game Hub** and hit **PLAY NATIVE**!

---

## 🏗️ Architecture

```
anyport-studio/
├── AnyPortStudio.exe   # Standalone C# Desktop App Launcher
├── server.js           # Native execution & telemetry backend
├── package.json        # Node manifest
├── bin/
│   ├── relinker.exe    # Official AnyPS5 compiler binary
│   └── libs/           # 101 Sony Prospero PRX system libraries
├── public/
│   ├── index.html      # Console UI layout
│   ├── app.css         # PS5 & Steam Big Picture design system
│   └── app.js          # Dynamic frontend interaction engine
├── games/              # Relinked game library
│   └── dreaming-sarah/ # Verified native working game port
└── sample_game/        # Validated ELF test fixture
```

---

## 🤝 Powered by AnyPS5
AnyPort Studio utilizes the official [AnyPS5](https://github.com/boykopovar/AnyPS5) relinking toolchain created by Boyko Povar.
