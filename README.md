# ZoteroSeek

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

- Zotero 7.0 or later
- Node.js 18+ (for development)
- 你好啊！

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

# The .xpi file will be in the build/ directory
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
