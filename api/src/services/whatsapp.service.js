'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeSegment(value, label) {
  const text = String(value == null ? '' : value);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) throw new Error(label + ' is not a valid identifier');
  return text;
}

function normalizePhoneNumber(value, defaultCountryCode = '213') {
  let digits = String(value || '').trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (!digits) throw new Error('Customer phone number is missing.');
  if (digits.startsWith(defaultCountryCode + '0')) {
    digits = defaultCountryCode + digits.slice(defaultCountryCode.length + 1);
  } else if (String(value || '').trim().startsWith('+')) {
    // Explicit international number.
  } else if (digits.startsWith('0')) {
    digits = defaultCountryCode + digits.slice(1);
  } else if (digits.length === 9 && /^[5-7]/.test(digits)) {
    digits = defaultCountryCode + digits;
  }
  if (digits.length < 8 || digits.length > 15) throw new Error('Customer phone number is invalid.');
  return digits;
}

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.qrCodes = new Map();
    this.connectionStatus = new Map();
    this.phoneNumbers = new Map();
    this.connectionErrors = new Map();
    this.connecting = new Map();
    this.reconnectTimers = new Map();
    this.queues = new Map();
    this.lastSentAt = new Map();
    this.sessionRoot = path.join(
      process.env.POSNIC_USER_DATA_PATH ||
        (process.env.APPDATA ? path.join(process.env.APPDATA, 'POSNIC') : path.join(require('os').homedir(), '.posnic')),
      'whatsapp-auth'
    );
    fs.mkdirSync(this.sessionRoot, { recursive: true });
  }

  _key(deviceId, branchId) {
    return safeSegment(branchId, 'Branch ID') + '_' + safeSegment(deviceId, 'Device ID');
  }

  _authDir(deviceId, branchId) {
    return path.join(this.sessionRoot, this._key(deviceId, branchId));
  }

  _loadBaileys() {
    try {
      return require('@whiskeysockets/baileys');
    } catch (error) {
      const wrapped = new Error('WhatsApp WebSocket dependency is not installed. Reinstall POSNIC or update its API dependencies.');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  async initializeClient(deviceId, branchId) {
    const key = this._key(deviceId, branchId);
    if (this.connecting.has(key)) return this.connecting.get(key);
    if (this.clients.has(key) && this.getConnectionStatus(deviceId, branchId) === 'connected') {
      return { status: true, connected: true, message: 'WhatsApp is already connected.' };
    }
    const promise = (async () => {
      if (this.clients.has(key)) await this._destroySocket(key, false);
      // Ignore and replace incomplete, never-registered pairing credentials.
      if (!this.hasSavedSession(deviceId, branchId)) {
        fs.rmSync(this._authDir(deviceId, branchId), { recursive: true, force: true });
      }
      return this._connect(deviceId, branchId, null);
    })().finally(() => this.connecting.delete(key));
    this.connecting.set(key, promise);
    return promise;
  }

  async connectWithPairingCode(deviceId, branchId, phoneNumber) {
    const key = this._key(deviceId, branchId);
    const phone = normalizePhoneNumber(phoneNumber);
    if (this.connecting.has(key)) return this.connecting.get(key);
    if (this.clients.has(key) && this.getConnectionStatus(deviceId, branchId) === 'connected') {
      return { status: true, connected: true, message: 'WhatsApp is already connected.' };
    }

    const authDir = this._authDir(deviceId, branchId);
    let registered = false;
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(authDir, 'creds.json'), 'utf8'));
      registered = saved.registered === true;
    } catch (_) {}

    const promise = (async () => {
      if (this.clients.has(key)) await this._destroySocket(key, false);
      // A failed, unregistered pairing attempt leaves a partial creds.json.
      // Never reuse that half-created identity for the next code request.
      if (!registered) fs.rmSync(authDir, { recursive: true, force: true });
      return this._connect(deviceId, branchId, registered ? null : phone);
    })().finally(() => this.connecting.delete(key));
    this.connecting.set(key, promise);
    return promise;
  }

  async _connect(deviceId, branchId, pairingPhone) {
    const key = this._key(deviceId, branchId);
    let socket;
    let pairingTimer;
    let pairingCodeReady;
    try {
      const baileys = this._loadBaileys();
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { state, saveCreds } = await baileys.useMultiFileAuthState(this._authDir(deviceId, branchId));

      // Keep Baileys' package-pinned WhatsApp Web version. Fetching a version
      // at every launch can select a revision incompatible with the bundled
      // protobufs and cause WhatsApp to reject otherwise valid device links.
      socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        // WhatsApp rejects some pairing-code requests when the client
        // advertises a Windows/POSNIC browser identity. Use a valid desktop
        // browser identity for both linking methods.
        browser: (baileys.Browsers && baileys.Browsers.macOS && baileys.Browsers.macOS('Chrome')) || ['Mac OS', 'Chrome', '10.15.7'],
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined,
        logger: require('pino')({ level: 'silent' }),
      });

      this.clients.set(key, socket);
      this.connectionStatus.set(key, pairingPhone ? 'pairing_requested' : 'connecting');
      this.connectionErrors.delete(key);
      this.qrCodes.delete(key);

      let pairingRequested = false;
      let resolvePairingCode;
      let rejectPairingCode;
      if (pairingPhone && !state.creds.registered) {
        pairingCodeReady = new Promise((resolve, reject) => {
          resolvePairingCode = resolve;
          rejectPairingCode = reject;
        });
        // The socket must emit its first QR/connection.update before the
        // pairing-code IQ is sent. A fixed sleep is not a readiness signal.
        pairingTimer = setTimeout(() => {
          rejectPairingCode(new Error('WhatsApp did not become ready for pairing. Check the internet connection and try again.'));
        }, 30000);
      }

      // Serialize credential writes. A successful pairing is followed by a
      // restart-required close; reconnect only after the pair-success creds
      // have been durably written to disk.
      let credsSavePromise = Promise.resolve();
      socket.ev.on('creds.update', (update) => {
        credsSavePromise = credsSavePromise
          .then(() => saveCreds(update))
          .catch((error) => console.warn('[WhatsApp] Could not persist credentials:', error.message));
      });
      socket.ev.on('connection.update', (update) => {
        if (update.qr) {
          this.qrCodes.set(key, update.qr);
          this.connectionStatus.set(key, 'qr_ready');
          this.emit('qr', { deviceId, branchId, clientKey: key, qrCode: update.qr });

          if (pairingCodeReady && !pairingRequested) {
            pairingRequested = true;
            Promise.resolve(socket.requestPairingCode(pairingPhone)).then((code) => {
              clearTimeout(pairingTimer);
              this.connectionStatus.set(key, 'pairing_code_ready');
              resolvePairingCode(code);
            }).catch((error) => rejectPairingCode(error));
          }
        }

        if (update.connection === 'open') {
          const userId = socket.user && socket.user.id ? socket.user.id : '';
          const number = userId.split(':')[0].split('@')[0];
          this.phoneNumbers.set(key, number || '');
          this.connectionStatus.set(key, 'connected');
          this.qrCodes.delete(key);
          this.connectionErrors.delete(key);
          this.emit('ready', { deviceId, branchId, clientKey: key, phoneNumber: number });
        }

        if (update.connection === 'close') {
          const disconnectError = update.lastDisconnect && update.lastDisconnect.error;
          const statusCode = disconnectError && disconnectError.output && disconnectError.output.statusCode;
          const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
          const intentional = this.getConnectionStatus(deviceId, branchId) === 'closing';
          const reason = disconnectError && disconnectError.message ? disconnectError.message : 'WhatsApp connection closed';
          this.connectionErrors.set(key, { code: statusCode || null, message: reason });
          this.qrCodes.delete(key);
          this.clients.delete(key);

          if (pairingCodeReady && !pairingRequested) {
            rejectPairingCode(new Error(reason + (statusCode ? ' (code ' + statusCode + ')' : '')));
          }

          const hasCredentials = fs.existsSync(path.join(this._authDir(deviceId, branchId), 'creds.json'));
          if (!intentional && !loggedOut && hasCredentials) {
            this.connectionStatus.set(key, 'reconnecting');
            const existingTimer = this.reconnectTimers.get(key);
            if (existingTimer) clearTimeout(existingTimer);
            const timer = setTimeout(async () => {
              this.reconnectTimers.delete(key);
              await credsSavePromise;
              this.initializeClient(deviceId, branchId).catch((error) =>
                console.warn('[WhatsApp] Reconnect failed:', error.message)
              );
            }, statusCode === (baileys.DisconnectReason.restartRequired || 515) ? 1000 : 4000);
            if (timer.unref) timer.unref();
            this.reconnectTimers.set(key, timer);
          } else {
            this.connectionStatus.set(key, loggedOut ? 'logged_out' : 'disconnected');
          }
          this.emit('disconnected', { deviceId, branchId, clientKey: key, reason: statusCode });
        }
      });

      if (pairingCodeReady) {
        const code = await pairingCodeReady;
        return { status: true, connected: false, pairingCode: code, message: 'Enter this code in WhatsApp → Linked devices → Link with phone number instead.' };
      }
      return { status: true, connected: false, message: 'WhatsApp connection is starting.' };
    } catch (error) {
      if (pairingTimer) clearTimeout(pairingTimer);
      this.connectionStatus.set(key, 'error');
      this.connectionErrors.set(key, { code: error.output && error.output.statusCode || null, message: error.message });
      console.error('[WhatsApp] Connection initialization failed:', error.message);
      if (socket) {
        this.connectionStatus.set(key, 'closing');
        try { socket.end(new Error('POSNIC pairing initialization failed')); } catch (_) {}
        if (this.clients.get(key) === socket) this.clients.delete(key);
      }
      // A rejected pairing attempt must not leave corrupt/incomplete auth
      // material that can poison the next QR or pairing attempt.
      if (pairingPhone) {
        try { fs.rmSync(this._authDir(deviceId, branchId), { recursive: true, force: true }); } catch (_) {}
      }
      return { status: false, connected: false, message: error.message };
    }
  }

  getConnectionError(deviceId, branchId) {
    return this.connectionErrors.get(this._key(deviceId, branchId)) || null;
  }

  hasSavedSession(deviceId, branchId) {
    try {
      const creds = path.join(this._authDir(deviceId, branchId), 'creds.json');
      if (!fs.existsSync(creds) || !fs.statSync(creds).isFile()) return false;
      const saved = JSON.parse(fs.readFileSync(creds, 'utf8'));
      return saved.registered === true;
    } catch (_) { return false; }
  }

  getQRCode(deviceId, branchId) {
    return this.qrCodes.get(this._key(deviceId, branchId)) || null;
  }

  getConnectionStatus(deviceId, branchId) {
    return this.connectionStatus.get(this._key(deviceId, branchId)) || 'not_initialized';
  }

  getConnectedPhone(deviceId, branchId) {
    return this.phoneNumbers.get(this._key(deviceId, branchId)) || '';
  }

  async _destroySocket(key, logout) {
    const socket = this.clients.get(key);
    this.connectionStatus.set(key, 'closing');
    this.clients.delete(key);
    this.qrCodes.delete(key);
    const timer = this.reconnectTimers.get(key);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(key);
    if (socket) {
      try {
        if (logout && socket.logout) await socket.logout();
        else if (socket.end) socket.end(new Error('POSNIC WhatsApp socket closed'));
      } catch (_) {}
    }
  }

  async logout(deviceId, branchId) {
    const key = this._key(deviceId, branchId);
    await this._destroySocket(key, true);
    this.phoneNumbers.delete(key);
    this.connectionStatus.set(key, 'disconnected');
    try {
      fs.rmSync(this._authDir(deviceId, branchId), { recursive: true, force: true });
    } catch (error) {
      console.warn('[WhatsApp] Could not remove auth directory:', error.message);
      return { status: false, message: 'Could not remove the saved WhatsApp session.' };
    }
    return { status: true, message: 'WhatsApp disconnected. The saved linked-device session was removed.' };
  }

  async sendMessage(deviceId, branchId, phoneNumber, message) {
    if (require('../config/demo-mode').isDemoMode()) {
      return { status: false, message: require('../config/demo-mode').DEMO_BLOCKED_MESSAGE };
    }
    const key = this._key(deviceId, branchId);
    const socket = this.clients.get(key);
    if (!socket || this.getConnectionStatus(deviceId, branchId) !== 'connected') {
      return { status: false, message: 'WhatsApp is not connected. Open Settings → WhatsApp Connection and link the store account.' };
    }
    let phone;
    try { phone = normalizePhoneNumber(phoneNumber); }
    catch (error) { return { status: false, message: error.message }; }
    const jid = phone + '@s.whatsapp.net';
    const previous = this.queues.get(key) || Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      const active = this.clients.get(key);
      if (!active || this.getConnectionStatus(deviceId, branchId) !== 'connected') {
        throw new Error('WhatsApp connection was lost before sending.');
      }
      const lastSentAt = this.lastSentAt.get(key) || 0;
      if (lastSentAt) await wait(2000 + Math.floor(Math.random() * 2001));
      const sent = await active.sendMessage(jid, { text: String(message || '') });
      this.lastSentAt.set(key, Date.now());
      return { status: true, message: 'Message sent successfully', messageId: sent && sent.key && sent.key.id };
    });
    this.queues.set(key, task);
    try { return await task; }
    catch (error) { return { status: false, message: error.message }; }
    finally { if (this.queues.get(key) === task) this.queues.delete(key); }
  }
}

WhatsAppService.normalizePhoneNumber = normalizePhoneNumber;
module.exports = new WhatsAppService();
