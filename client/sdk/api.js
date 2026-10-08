// Game-client transport: REST calls with the launch token, plus the crash-room WebSocket.

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class Api {
  constructor(token) {
    this.token = token;
  }

  async req(method, path, body, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError('NETWORK', 'Connection lost. Check your network and try again.', 0);
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new ApiError(data.error?.code || `HTTP_${res.status}`, data.error?.message || 'Request failed', res.status);
    return data;
  }

  init() { return this.req('GET', '/api/v1/client/init'); }
  balance() { return this.req('GET', '/api/v1/client/balance'); }
  bet(amount, params) { return this.req('POST', '/api/v1/client/bet', { amount, params }); }
  roundStart(amount, params) { return this.req('POST', '/api/v1/client/round/start', { amount, params }); }
  roundAct(action) { return this.req('POST', '/api/v1/client/round/act', { action }); }
  roundCashout() { return this.req('POST', '/api/v1/client/round/cashout', {}); }
  history(limit = 25) { return this.req('GET', `/api/v1/client/history?limit=${limit}`); }
  seeds() { return this.req('GET', '/api/v1/client/seeds'); }
  rotate(clientSeed) { return this.req('POST', '/api/v1/client/seeds/rotate', { client_seed: clientSeed || null }); }
  verify(payload) { return this.req('POST', '/api/v1/fair/verify', payload, false); }
  crashRound(id) { return this.req('GET', `/api/v1/fair/crash/${id}`, undefined, false); }
}

// Reconnecting socket with request/reply correlation and server-clock offset tracking.
export class CrashSocket {
  constructor(token) {
    this.token = token;
    this.handlers = {};
    this.pending = new Map();
    this.seq = 0;
    this.offset = 0; // serverTime - localTime (seconds)
    this.retry = 0;
    this.closed = false;
    this.connect();
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  emit(type, msg) { (this.handlers[type] || []).forEach((fn) => fn(msg)); }
  now() { return Date.now() / 1000 + this.offset; }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/v1/client/crash/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.emit('open'); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.server_time) {
        const off = msg.server_time - Date.now() / 1000;
        this.offset = this.offset === 0 ? off : this.offset * 0.8 + off * 0.2;
      }
      if (msg.type === 'reply') {
        const p = this.pending.get(msg.req);
        if (p) { this.pending.delete(msg.req); msg.ok ? p.resolve(msg) : p.reject(new ApiError(msg.code, msg.message, 409)); }
        return;
      }
      this.emit(msg.type, msg);
    };
    ws.onclose = (ev) => {
      this.pending.forEach((p) => p.reject(new ApiError('NETWORK', 'Connection lost', 0)));
      this.pending.clear();
      this.emit('close', ev);
      if (this.closed || ev.code === 4401 || ev.code === 4403) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(action, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new ApiError('NETWORK', 'Not connected', 0)); return; }
      const req = ++this.seq;
      this.pending.set(req, { resolve, reject });
      this.ws.send(JSON.stringify({ action, req, ...data }));
      setTimeout(() => { if (this.pending.has(req)) { this.pending.delete(req); reject(new ApiError('TIMEOUT', 'Server did not answer in time', 0)); } }, 10000);
    });
  }
}

export function makeMoney(currency) {
  let f;
  try { f = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch (e) { f = { format: (v) => `${v.toFixed(2)} ${currency}` }; }
  return {
    currency,
    fmt: (minor) => f.format(minor / 100),
    plain: (minor) => (minor / 100).toFixed(2),
    toMinor: (v) => Math.round(parseFloat(String(v).replace(',', '.')) * 100),
  };
}

export const fmtMult = (m) => (m >= 1000 ? Math.round(m).toLocaleString() : m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2)) + '×';
