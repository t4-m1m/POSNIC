const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.qrCodes = new Map();
    this.connectionStatus = new Map();
    const legacySessionPath = path.join(__dirname, '../../.wwebjs_auth');
    // Keep WhatsApp authentication outside the application install directory so
    // updates/reinstalls do not replace the user's LocalAuth session.
    const persistentRoot = process.env.POSNIC_WHATSAPP_SESSION_PATH ||
      (process.env.APPDATA
        ? path.join(process.env.APPDATA, 'POSNIC', '.wwebjs_auth')
        : path.join(require('os').homedir(), '.posnic', '.wwebjs_auth'));
    this.sessionPath = persistentRoot;

    try {
      if (!fs.existsSync(this.sessionPath)) {
        fs.mkdirSync(path.dirname(this.sessionPath), { recursive: true });
        if (fs.existsSync(legacySessionPath)) {
          fs.cpSync(legacySessionPath, this.sessionPath, { recursive: true, errorOnExist: false });
        } else {
          fs.mkdirSync(this.sessionPath, { recursive: true });
        }
      }
    } catch (error) {
      // Fall back to the legacy directory if migration/persistent storage fails.
      console.warn('[WHATSAPP INIT] Could not prepare persistent session directory:', error?.message || error);
      this.sessionPath = legacySessionPath;
      if (!fs.existsSync(this.sessionPath)) fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

  /*
   * The session key, and the only place it is built.
   *
   * clientKey becomes a directory name: path.join(sessionPath,
   * `session-${clientKey}`), and logout() calls fs.rmSync on that path with
   * recursive and force. deviceId arrives from req.body, so a device id of
   * "../../.." resolved to somewhere outside the session folder and deleted
   * it - an authenticated request able to remove an arbitrary directory tree,
   * which is as bad as this application gets.
   *
   * An allowlist rather than stripping "..": stripping is a filter somebody
   * has to get exactly right, and "....//" defeats the obvious version. These
   * are ids we generate, so they can be required to look like ids.
   */
  _clientKey(deviceId, branchId) {
    const safe = (value, what) => {
      const text = String(value == null ? '' : value);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) {
        throw new Error(`${what} is not a valid identifier`);
      }
      return text;
    };
    return `${safe(branchId, 'branch id')}_${safe(deviceId, 'device id')}`;
  }

  resolveBrowserExecutable() {
    const candidates = [];
    const add = (value) => {
      if (typeof value === 'string' && value.trim()) {
        candidates.push(value.trim().replace(/^"|"$/g, ''));
      }
    };

    // Explicit paths are useful for managed, portable, or non-standard installs.
    add(process.env.PUPPETEER_EXECUTABLE_PATH);
    add(process.env.CHROME_PATH);
    add(process.env.CHROMIUM_PATH);
    add(process.env.EDGE_PATH);

    if (process.platform === 'win32') {
      const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env.LOCALAPPDATA || '';
      const userProfile = process.env.USERPROFILE || '';
      [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ].forEach(add);

      // Chrome/Edge may be installed in a per-user or custom location. Read
      // Windows App Paths registration instead of assuming the standard folder.
      for (const key of [
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
        'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
        'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
        'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
        'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
      ]) {
        try {
          const output = execFileSync('reg.exe', ['query', key, '/ve'], {
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          const match = output.match(/REG_SZ\\s+(.+?)\\s*$/im);
          if (match) add(match[1]);
        } catch (_) {}
      }

      // Also honor browser executables available on PATH.
      for (const executable of ['chrome.exe', 'msedge.exe', 'chromium.exe']) {
        try {
          const output = execFileSync('where.exe', [executable], {
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          output.split(/\\r?\\n/).forEach(add);
        } catch (_) {}
      }
    } else if (process.platform === 'darwin') {
      [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ].forEach(add);
    } else {
      [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ].forEach(add);
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch (_) {}
    }

    // Use Puppeteer's managed browser only when it actually exists. Do not
    // silently pass a missing cache path through to whatsapp-web.js.
    try {
      const puppeteer = require('puppeteer');
      const bundled = puppeteer.executablePath();
      if (bundled && fs.existsSync(bundled)) return bundled;
    } catch (_) {}

    return null;
  }

  async initializeClient(deviceId, branchId) {
    try {
      const { Client, LocalAuth } = require('whatsapp-web.js');
      const qrcode = require('qrcode');
      const browserExecutable = this.resolveBrowserExecutable();
      if (browserExecutable) console.log('[WHATSAPP INIT] Using browser executable:', browserExecutable);
      else console.warn('[WHATSAPP INIT] No system Chrome/Edge found; checking Puppeteer-managed browser fallback.');

      const clientKey = this._clientKey(deviceId, branchId);

      if (this.clients.has(clientKey)) {
        const existingClient = this.clients.get(clientKey);
        try {
          const state = await existingClient.getState();
          if (state === 'CONNECTED') {
            return { status: true, message: 'Already connected', connected: true };
          }
        } catch (err) {
          console.warn(
            `[WHATSAPP INIT] Existing client state check failed for ${clientKey}, recreating:`,
            err?.message || err
          );
        }

        // Replace stale/inactive client sessions so a fresh QR can be generated.
        try {
          await existingClient.destroy();
        } catch (err) {
          console.warn(
            `[WHATSAPP INIT] Existing client destroy failed for ${clientKey}, continuing:`,
            err?.message || err
          );
        }

        // Do not clear LocalAuth data when replacing a stale client. A transport
        // or browser startup failure must never force the user to scan a new QR.
        this.clients.delete(clientKey);
      }

      // Ensure we don't have leftover QR/status from a prior attempt.
      this.qrCodes.delete(clientKey);
      this.connectionStatus.delete(clientKey);

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: clientKey,
          dataPath: this.sessionPath,
        }),
        puppeteer: {
          headless: true,
          ...(browserExecutable ? { executablePath: browserExecutable } : {}),
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
      });

      client.on('qr', async (qr) => {
        console.log(`QR Code received for device: ${deviceId}`);
        this.connectionStatus.set(clientKey, 'qr_ready');
        this.qrCodes.set(clientKey, qr);
        this.emit('qr', { deviceId, clientKey, qrCode: qr });
      });

      client.on('ready', () => {
        console.log(`WhatsApp ready for device: ${deviceId}`);
        this.connectionStatus.set(clientKey, 'connected');
        this.qrCodes.delete(clientKey);
        this.emit('ready', { deviceId, clientKey });
      });

      client.on('authenticated', () => {
        this.connectionStatus.set(clientKey, 'authenticated');
        this.emit('authenticated', { deviceId, clientKey });
      });

      client.on('auth_failure', (msg) => {
        console.error(`Auth failure for ${deviceId}:`, msg);
        this.connectionStatus.set(clientKey, 'auth_failed');
        this.qrCodes.delete(clientKey);
        this.emit('auth_failure', { deviceId, clientKey, error: msg });
      });

      client.on('disconnected', (reason) => {
        console.log(`Disconnected ${deviceId}:`, reason);
        this.connectionStatus.set(clientKey, 'disconnected');
        this.qrCodes.delete(clientKey);
        // A transport disconnect must not erase persisted LocalAuth login data.
        // Explicit logout/removeDevice still calls _safeCleanupClient and clears it.
        this.clients.delete(clientKey);
        this.emit('disconnected', { deviceId, clientKey, reason });
      });

      this.clients.set(clientKey, client);
      this.connectionStatus.set(clientKey, 'initializing');

      await client.initialize();
      return {
        status: true,
        message: 'Client initialized',
        connected: false,
      };
    } catch (error) {
      console.error('Error initializing WhatsApp:', error);
      const message = /could not find chrome|couldn't find chrome|executable doesn't exist|browser was not found/i.test(String(error && error.message))
        ? 'WhatsApp could not locate a Chrome/Chromium browser. POSNIC now checks common Chrome and Edge install paths; set CHROME_PATH to the browser executable if it is installed elsewhere.'
        : (error && error.message ? error.message : 'WhatsApp initialization failed.');
      return { status: false, message, connected: false };
    }
  }

  hasSavedSession(deviceId, branchId) {
    try {
      const clientKey = this._clientKey(deviceId, branchId);
      const sessionDir = path.join(this.sessionPath, `session-${clientKey}`);
      return fs.existsSync(sessionDir) && fs.statSync(sessionDir).isDirectory();
    } catch (_) { return false; }
  }

  getQRCode(deviceId, branchId) {
    const clientKey = this._clientKey(deviceId, branchId);
    return this.qrCodes.get(clientKey) || null;
  }

  getConnectionStatus(deviceId, branchId) {
    const clientKey = this._clientKey(deviceId, branchId);
    return this.connectionStatus.get(clientKey) || 'not_initialized';
  }

  async logout(deviceId, branchId) {
    const clientKey = this._clientKey(deviceId, branchId);
    const client = this.clients.get(clientKey);

    try {
      if (client) {
        // whatsapp-web.js / puppeteer can throw errors like
        // "Attempted to use detached Frame" or "Target closed" if the
        // underlying Chromium page is already gone. For a "Disconnect"
        // action in the UI, these are safe to ignore - the user simply
        // wants the session cleared.
        try {
          await client.logout();
        } catch (err) {
          console.warn(
            '[WHATSAPP LOGOUT] Error during client.logout(), ignoring:',
            err?.message || err
          );
        }

        try {
          await client.destroy();
        } catch (err) {
          console.warn(
            '[WHATSAPP LOGOUT] Error during client.destroy(), ignoring:',
            err?.message || err
          );
        }
      }
    } finally {
      this._safeCleanupClient(clientKey);
    }

    // From a UX perspective, clicking "Disconnect" should succeed even if
    // the client was already disconnected or its frame was detached. We
    // therefore return a success status as long as our cleanup completed.
    return { status: true, message: 'Logged out successfully' };
  }

  _safeCleanupClient(clientKey) {
    // Always clean up our in-memory maps regardless of errors so that
    // the system sees this device as disconnected.
    this.clients.delete(clientKey);
    this.qrCodes.delete(clientKey);
    this.connectionStatus.delete(clientKey);

    // Also attempt to remove the on-disk session folder. Any failure
    // here is logged but not surfaced to the user.
    try {
      const sessionDir = path.join(this.sessionPath, `session-${clientKey}`);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn(
        '[WHATSAPP LOGOUT] Error removing session directory, ignoring:',
        err?.message || err
      );
    }
  }

  async sendMessage(deviceId, branchId, phoneNumber, message) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { status: false, message: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }
    const clientKey = this._clientKey(deviceId, branchId);
    const client = this.clients.get(clientKey);

    if (!client) {
      return {
        status: false,
        message:
          'WhatsApp is not connected. Please go to Settings → WhatsApp Connection and connect your WhatsApp first.',
      };
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
      return {
        status: false,
        message: 'WhatsApp connection lost. Please reconnect from Settings → WhatsApp Connection.',
      };
    }

    try {
      const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
      const sent = await client.sendMessage(chatId, message);
      return {
        status: true,
        message: 'Message sent successfully',
        messageId: sent?.id?._serialized,
      };
    } catch (error) {
      console.error('Error sending message:', error);
      return { status: false, message: error.message };
    }
  }
}

module.exports = new WhatsAppService();
