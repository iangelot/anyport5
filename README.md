# ANYPORT 5 🎮⚡

> **The 1-Click PlayStation 5 Game Porter & Native PC Launcher**  
> Powered by [AnyPS5](https://github.com/boykopovar/AnyPS5) by Boyko Povar.

[![GitHub Repo](https://img.shields.io/badge/GitHub-iangelot%2Fanyport5-BFFF00?style=for-the-badge&logo=github)](https://github.com/iangelot/anyport5)
[![AnyPS5 Core](https://img.shields.io/badge/Powered%20By-AnyPS5-7D39EB?style=for-the-badge&logo=playstation)](https://github.com/boykopovar/AnyPS5)
[![Binary](https://img.shields.io/badge/Desktop%20App-AnyPortStudio.exe-0A0A0A?style=for-the-badge&logo=windows)]()
[![Native Performance](https://img.shields.io/badge/Performance-Native%2060%20FPS%20(Zero%20Emulation)-BFFF00?style=for-the-badge)]()

---

## 🌟 What is AnyPort 5?

Have you ever wanted to play PlayStation 5 games directly on your PC without needing a supercomputer or a slow emulator?

**AnyPort 5 is a 1-click desktop software** that converts PlayStation 5 game files into regular Windows PC applications (`.exe`). Because it translates the console instructions directly into native PC code, the games run with **0% emulation lag** and full hardware speed.

---

## 🚀 How to Use (Super Simple — 3 Steps)

You do **NOT** need to know any programming or command lines.

```
 ┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
 │   1. DOUBLE-CLICK    │  ──► │     2. PICK GAME     │  ──► │     3. CLICK PLAY    │
 │  AnyPortStudio.exe   │      │  Drop folder / ELF   │      │  60 FPS Native Run!  │
 └──────────────────────┘      └──────────────────────┘      └──────────────────────┘
```

### Step 1: Open the App
- Just double-click **`AnyPortStudio.exe`**.
- The app will open in its own clean gaming window (no installation needed!).

### Step 2: Choose Your PS5 Game
- Click on the **1-CLICK PORTER** tab on the left.
- Drag & drop your decrypted game folder (or type its folder location into the box).
- Click **INSPECT** to make sure the files are recognized.

### Step 3: Convert & Play!
- Click the big neon green **`COMPILE NATIVE WINDOWS EXECUTABLE`** button.
- Watch the live progress bars complete in seconds.
- Go to the **PORT HUB** tab and hit **`PLAY NATIVE PC PORT`**!

---

## 💎 Features

- 🟢 **Esports Cyber Aesthetic**: High-contrast Cyber Black, Neon Violet, and Electric Lime design with gamified Orbitron typography.
- ⚡ **1-Click Standalone Desktop Software**: Comes as a ready-to-use `.exe` file (`AnyPortStudio.exe`). Just click and run.
- 🎯 **Only Verified Playable Games**: Pre-configured with verified working native ports (such as *Dreaming Sarah*) running at locked 60 FPS.
- 🧠 **Auto Hardware Profiler**: Automatically detects whether your PC has an Intel or AMD processor and tunes the conversion settings so your game boots smoothly.
- 📦 **101 Pre-Linked System Libraries**: Comes loaded with all 101 official Sony Prospero system libraries from AnyPS5 (controller input, 3D audio, display buffers, save data).
- 🎮 **Steam Deck & Big Picture Ready**: Export shortcuts to your Steam library with one click.

---

## 📂 Project Structure

```
anyport5/
├── AnyPortStudio.exe      # ⚡ Double-click to launch the app
├── Launcher.cs            # C# Standalone Launcher source
├── server.js              # Native execution & telemetry backend
├── package.json           # Node.js project manifest
├── bin/
│   ├── relinker.exe       # Official AnyPS5 compiler binary
│   └── libs/              # 101 Sony Prospero PRX system libraries
├── public/
│   ├── index.html         # Cyber UI Layout
│   ├── app.css            # Cyber Black / Violet / Lime styling
│   └── app.js             # Interaction engine
├── games/                 # Your converted games library
│   └── dreaming-sarah/    # Verified working native game port
└── sample_game/           # Verified ELF test fixture
```

---

## 🙏 Credits & Acknowledgements

AnyPort 5 is built on top of the groundbreaking research and engineering of the open-source **[AnyPS5](https://github.com/boykopovar/AnyPS5)** project created by **Boyko Povar**.

- **Core Relinker & PRX System**: [boykopovar/AnyPS5](https://github.com/boykopovar/AnyPS5)
- **AnyPort 5 Desktop GUI & Launcher**: [iangelot/anyport5](https://github.com/iangelot/anyport5)

---

## 📜 Disclaimer & Legal Note
This project does not contain, distribute, or decrypt copyrighted Sony commercial game packages (`.pkg` / `.pfs`). Users must provide their own legitimately decrypted binaries for their personal hardware.
