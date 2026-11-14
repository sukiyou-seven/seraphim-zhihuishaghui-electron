const { app, BrowserWindow, Menu, dialog, ipcMain, net, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow = null;

function tokenPath() {
  return path.join(app.getPath('userData'), 'token.bin');
}

function readToken() {
  try {
    if (!fs.existsSync(tokenPath())) return '';
    const raw = fs.readFileSync(tokenPath());
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(raw);
    }
    return raw.toString('utf8');
  } catch {
    return '';
  }
}

function writeToken(token) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token || '')
      : Buffer.from(token || '', 'utf8');
    fs.writeFileSync(tokenPath(), data);
    return true;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    title: '企通宝',
    autoHideMenuBar: true,
    backgroundColor: '#10100f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Electron 默认会生成 File/Edit/View 等应用菜单，桌面客户端不需要。
  // macOS 的菜单栏属于系统，保留系统 App 菜单；Windows/Linux 直接移除。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    mainWindow.removeMenu();
  }
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

async function downloadUpdate(event, payload) {
  const url = String(payload?.url || '');
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('无效的下载地址');
  }

  const downloads = app.getPath('downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const safeName = path.basename(String(payload?.fileName || 'qitongbao-update.bin'));
  let target = path.join(downloads, safeName);
  if (fs.existsSync(target)) {
    const parsed = path.parse(safeName);
    target = path.join(downloads, `${parsed.name}-${Date.now()}${parsed.ext}`);
  }

  const response = await net.fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('content-length') || 0);
  const reader = response.body.getReader();
  const output = fs.createWriteStream(target);
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.byteLength;
      if (!output.write(chunk)) {
        await new Promise((resolve) => output.once('drain', resolve));
      }
      event.sender.send('update:progress', {
        received,
        total,
        percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
      });
    }
    await new Promise((resolve, reject) => {
      output.once('error', reject);
      output.end(resolve);
    });
  } catch (error) {
    output.destroy();
    try { fs.unlinkSync(target); } catch { /* ignore */ }
    throw error;
  }

  return { path: target, size: received };
}

app.whenReady().then(() => {
  ipcMain.handle('auth:get-token', () => readToken());
  ipcMain.handle('auth:set-token', (_event, token) => writeToken(token));
  ipcMain.handle('auth:clear-token', () => writeToken(''));
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:open-external', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('update:download', (event, payload) => downloadUpdate(event, payload));
  ipcMain.handle('app:open-path', async (_event, target) => {
    const resolved = path.resolve(String(target || ''));
    const allowed = [app.getPath('downloads'), app.getPath('temp')]
      .map((dir) => `${path.resolve(dir)}${path.sep}`);
    if (!allowed.some((prefix) => resolved.startsWith(prefix))) {
      return { ok: false, error: '不允许打开该路径' };
    }
    const error = await shell.openPath(resolved);
    return { ok: !error, error };
  });
  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: '文档', extensions: ['txt', 'md', 'pdf', 'docx'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.pdf'
      ? 'application/pdf'
      : ext === '.docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : ext === '.md'
          ? 'text/markdown'
          : ext === '.txt'
            ? 'text/plain'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.webp'
                ? 'image/webp'
                : 'image/png';
    return {
      name: path.basename(filePath),
      mime,
      base64: data.toString('base64')
    };
  });

  ipcMain.handle('api:request', async (_event, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 30000);
    try {
      const response = await fetch(options.url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body,
        signal: controller.signal
      });
      const text = await response.text();
      return { status: response.status, text };
    } catch (error) {
      return { status: 0, text: '', error: error.name === 'AbortError' ? '请求超时，请重试' : error.message };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('api:stream', async (ipcEvent, options) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 300000);
    try {
      const response = await fetch(options.url, {
        method: options.method || 'POST',
        headers: options.headers || {},
        body: options.body,
        signal: controller.signal
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('text/event-stream')) {
        const text = await response.text();
        return { status: response.status, text: '', error: text.slice(0, 300) || `HTTP ${response.status}` };
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const event = JSON.parse(payload);
            if (event.content) {
              answer += event.content;
              ipcEvent.sender.send('ai:chunk', { content: event.content });
            }
            if (event.type === 'error' && event.message) return { status: 200, text: answer, error: event.message };
          } catch {
            // 忽略不完整片段
          }
        }
      }
      return { status: 200, text: answer };
    } catch (error) {
      return { status: 0, text: '', error: error.name === 'AbortError' ? 'AI 请求超时' : error.message };
    } finally {
      clearTimeout(timer);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
