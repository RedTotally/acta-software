const { app, BrowserWindow, Menu } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "..");
const host = process.env.ACTA_HOST || "127.0.0.1";
const port = process.env.ACTA_PORT || "4730";
const base = `http://${host}:${port}`;

let child = null;

const looseSandbox = process.env.ACTA_ELECTRON_NO_SANDBOX === "1";
if (looseSandbox) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.disableHardwareAcceleration();
}

function health() {
  return new Promise((resolve) => {
    const request = http.get(`${base}/api/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    if (await health()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Acta did not start");
}

async function ensureServer() {
  if (await health()) return;
  child = spawn(
    process.env.ACTA_NODE || "node",
    ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server/index.ts"],
    { cwd: root, env: process.env, stdio: "inherit" },
  );
  await waitForServer();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 800,
    title: "Acta",
    backgroundColor: "#f4f4f4",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !looseSandbox,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void win.loadURL(base);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]),
  );
  try {
    await ensureServer();
  } catch (error) {
    console.error(error);
    app.quit();
    return;
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  app.quit();
});
