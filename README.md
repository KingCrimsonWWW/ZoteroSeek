# ZoteroSeek

<div align="right">

English | **[中文](README_zh-CN.md)**

</div>

> AI-powered research assistant for Zotero

[![Build and Test](https://github.com/KingCrimsonWWW/ZoteroSeek/actions/workflows/build.yml/badge.svg)](https://github.com/KingCrimsonWWW/ZoteroSeek/actions/workflows/build.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## Features

- 💬 **Chat with AI** - Natural language conversation with LLM
- 📚 **PDF Analysis** - Ask questions about your PDF documents
- 🔍 **Knowledge Base** - Build and search your research knowledge base
- 🤖 **Multi-Model Support** - OpenAI, DeepSeek, MiMo, and more
- 🌐 **Bilingual UI** - Chinese and English interface

## Installation

### Prerequisites

- Zotero 9.0 or later
- Node.js 18+ (for development)

### Install from Release

1. Download the latest `.xpi` file from [Releases](https://github.com/KingCrimsonWWW/ZoteroSeek/releases)
2. In Zotero, go to Tools → Add-ons
3. Click the gear icon → Install Add-on From File
4. Select the downloaded `.xpi` file

### Build from Source

```bash
# Clone the repository
git clone https://github.com/KingCrimsonWWW/ZoteroSeek.git
cd ZoteroSeek

# Install dependencies
npm install

# Build the plugin
npm run build

# The .xpi file will be in the .scaffold/build/ directory
```

## Development

```bash
# Start development mode
npm start

# Run linter
npm run lint

# Type check
npm run typecheck

# Format code
npm run format
```

## Debugging

### Quick Start

**Step 1: Start Backend** (Terminal 1)
```powershell
# Run from project root, NOT from backend/
uv run python -m backend.main
```
Expected: `INFO: Uvicorn running on http://0.0.0.0:20801`

**Step 2: Start Frontend** (Terminal 2)
```powershell
cd frontend
npm run dev
```
Expected: `VITE v5.x.x ready`

**Step 3: Open Browser**
- Frontend UI: http://localhost:5173
- Backend API: http://localhost:20801

### Verify API

```bash
# Health check
curl http://localhost:20801/api/v1/health
# Expected: {"status": "ok"}
```

### Install Plugin

1. Build: `npm run build`
2. Find XPI: `.scaffold/build/zotero-seek.xpi`
3. In Zotero: Tools → Add-ons → ⚙️ → Install From File
4. Select the `.xpi` file
5. Restart Zotero

### Verification Checklist

| Step | Command/Action | Expected Result |
|------|----------------|-----------------|
| Backend | `uv run python -m backend.main` | Uvicorn running |
| Frontend | `cd frontend && npm run dev` | VITE ready |
| Browser | http://localhost:5173 | Chat UI visible |
| API | http://localhost:20801/api/v1/health | `{"status":"ok"}` |
| Chat | Send a message | AI streaming response |

### Troubleshooting

#### Backend: ModuleNotFoundError

If you see `ModuleNotFoundError: No module named 'backend'`:
```powershell
# Wrong: running from inside backend/
cd backend
uv run python -m backend.main  # ❌

# Correct: running from project root
uv run python -m backend.main  # ✅
```

#### Plugin: Missing bootstrap method

If Zotero shows "Plugin is missing bootstrap method 'install'":
1. Close Zotero completely
2. Delete old XPI from Zotero extensions folder:
   ```
   %APPDATA%\Zotero\Zotero\Profiles\<profile>\extensions\zoteroseek@kingcrimsonwww.github.io.xpi
   ```
3. Copy new XPI manually:
   ```powershell
   copy .scaffold\build\zoteroseek.xpi "$env:APPDATA\Zotero\Zotero\Profiles\<profile>\extensions\zoteroseek@kingcrimsonwww.github.io.xpi"
   ```
4. Restart Zotero

#### Plugin: Not visible in Zotero

If you can't find ZoteroSeek in Zotero:
1. Go to Tools → Add-ons
2. Check if ZoteroSeek appears in the list
3. If not, try installing again from File
4. Check Error Console (Tools → Developer → Error Console) for errors

#### Frontend and Backend show same page

This is normal behavior:
- `http://localhost:5173` - Vite dev server (with hot reload)
- `http://localhost:20801` - FastAPI static file server (serves built frontend)

Both serve the same React app. Use 5173 for development, 20801 for production.

## Configuration

After installation, configure your API keys:

1. Go to Edit → Preferences → ZoteroSeek
2. Enter your API key for your preferred LLM provider
3. Select your default model

## Usage

### Keyboard Shortcuts

- `Ctrl/Cmd + Shift + S` - Toggle ZoteroSeek panel
- `Ctrl/Cmd + Shift + A` - Analyze selected items

### Chat Interface

1. Click the ZoteroSeek icon or use the keyboard shortcut
2. Type your question in the input box
3. Press Enter to send

## Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **State Management**: Zustand
- **Storage**: Dexie (IndexedDB)
- **LLM Integration**: OpenAI-compatible API
- **Build**: esbuild + zotero-plugin-scaffold

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Zotero](https://www.zotero.org/) - Reference management software
- [Aria](https://github.com/lifan0127/ai-research-assistant) - Reference architecture
- [Zotero-GPT](https://github.com/MuiseDestiny/zotero-gpt) - Inspiration
