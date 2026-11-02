# NoteX Studio

**NoteX, RAGX and CanvasX together on one PC, started with one command.**

- **CanvasX:** your canvases.
- **NoteX:** turns them into places that agents can read and write. It also has an inbox for files and photos, an agent chat on each canvas, and sync with your phone.
- **RAGX:** embeds your documents and canvases, then answers questions about them with every statement cited.

Each project lives in its own repository. NoteX Studio brings the three together as git submodules and gives them one page to run in. In this page, NoteX and RAGX open as tabs, and CanvasX opens in a tab of its own.

## What you need

| | What for | Required? |
|---|---|---|
| [Node.js](https://nodejs.org) **24 or newer** | Runs everything | Yes |
| [Git](https://git-scm.com) | Fetches the three projects | Yes |
| **Chrome or Edge** | The pages; CanvasX needs their folder access | Yes |
| [Ollama](https://ollama.com) | Embeds your documents (setup downloads embeddinggemma-2, about 670 MB; RAGX's Settings can download and switch to others) | For search by meaning. Without it, search is by keyword only |
| [Claude Code](https://claude.com/claude-code), signed in with your own account | Agents on your canvases and RAGX's answers | For chat and agents |
| An Android phone or tablet with USB debugging, and a USB cable | CanvasXP, synced with your canvases | Optional |
| Google Antigravity (`agy`), signed in | The Gemini models, as an alternative to Claude | Optional |

The agents use **your own** Claude or Google account. Nothing is shared with whoever sent you this.

## Getting started

```bash
git clone --recursive https://github.com/paveenpratheek/NoteX-Studio.git
cd NoteX-Studio
npm run setup
npm start
```

- **`npm run setup`** fetches the projects, installs RAGX's packages, and downloads the embedding model into Ollama. It then checks for Claude Code and Antigravity and tells you plainly what is still missing. You can run it again at any time.
- **`npm start`** starts both engines and opens the studio in your browser at `http://127.0.0.1:7075`. **Ctrl+C** in that terminal stops everything.

### The first time

The studio opens on a setup screen and walks you through:

1. **Folders:** one for your canvases, one for RAGX's and NoteX's files. **Browse…** opens your computer's own folder picker.
2. **Setting up:** the embedding model downloads, unless Ollama already has it. You can choose another model there. NoteX and RAGX are then pointed at your folders. Then **Open CanvasX** and choose the same canvas folder there once, so your browser lets CanvasX use it.
3. **Phone or tablet** (optional, Android):
   - Connect it with a USB cable and click **OK**. The first time, turn on USB debugging; the screen says how.
   - If this PC has no `adb`, the setup offers to download Google's platform tools (about 7 MB) into `tools/`.
   - CanvasXP then opens in the phone's browser at `localhost:8080`. Choose a target folder there and press **Set up USB sync**.
   - The studio finds that folder by itself, links NoteX to it, and runs the first sync.
4. **NoteX checks your files**, and RAGX takes in what NoteX writes. Then: **Ready, Steady… Note**.

The **Setup** button at the top opens it again at any time.

### Then

- In the **RAGX** tab, drop documents into **Library**, then ask about them in **Ask**. To make a canvas searchable in RAGX, open it in NoteX and press **Keep in RAGX**.
- To give a canvas to the agent, assign it to the agent in CanvasX or NoteX, then chat with the agent from CanvasX's agent panel.
- With the phone plugged in, press **Phone attached - sync** in NoteX's Phone view.

## Settings

Everything is kept in **`~/NoteX Studio`**:
- `plugins/notex` for NoteX;
- `plugins/rag` for RAGX's index;
- `logs` for each engine's log.

To change the data folder or the ports, create `studio.config.json` next to `package.json`:

```json
{ "dataDir": "D:/NoteX data", "ports": { "studio": 7075, "ragx": 7780, "notex": 7781, "canvasx": 9075 }, "open": true }
```

You can also set them for one run: `npm start -- --data <folder> --no-open --notex-port 7881`. `ports.phone` (8080) is where CanvasXP is served for the phone.

If you change the CanvasX port, also add its address to `canvasxOrigins` in NoteX's `config.json`. That is the only address NoteX's CanvasX link accepts.

## When something is wrong

- **An engine dot is red.** Click its name in the top bar. Its log opens, with **Restart** and **Stop**.
- **"Port … is in use".** Something else, perhaps another copy, already uses that port. Stop it, or choose another port as described above.
- **RAGX says Ollama is not running.** Use the button RAGX shows. It opens Ollama in a terminal window you can watch.

## How it works

```
 browser ── http://127.0.0.1:7075 ── studio page ── NoteX tab ── NoteX engine :7781
                                     (host API)  └─ RAGX tab  ── RAGX engine  :7780 ── Ollama
         ── http://127.0.0.1:9075 ── CanvasX
```

The pages were written for ter-manager, a terminal and workspace manager that is not public yet. They talk to their host only through a small message API: host info, a terminal, storage, the theme and a data folder. `studio/public/studio.js` answers that API the way ter-manager does, so the pages and engines run unchanged.

- When a page asks a terminal to start its own engine, the studio restarts the engine it manages.
- Any other command, such as `ollama pull`, opens in a terminal window you can see.

Both servers listen on 127.0.0.1 only. The studio's own API needs the token written into its page, so no website can use it.

| Path | What it is |
|---|---|
| `studio/start.js` | `npm start`: the servers, the engines, the browser |
| `studio/setup.js` | `npm run setup` |
| `studio/host.js` | the studio and CanvasX servers |
| `studio/engines.js` | starts, watches and stops each engine |
| `studio/terminal.js` | `terminal.open`: an engine restart, or a terminal window |
| `studio/firstrun.js` | the setup screen's work: folder picker, data folder, engine calls, adb and the phone |
| `studio/public/setup.js` | the setup screen |
| `studio/public/` | the studio page and `plugin-host.js` |
| `notex/`, `ragx/`, `canvasx/` | the three projects (git submodules) |

```bash
npm test
```

## Updating

```bash
git pull
git submodule update --init --recursive
npm run setup
```

## License

AGPL-3.0-or-later. See `LICENSE` and `NOTICE`.
