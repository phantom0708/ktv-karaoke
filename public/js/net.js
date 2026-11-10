// WebSocket connection with auto-reconnect, a tiny event bus and server clock sync.
export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.offset = 0; // serverNow ≈ Date.now() + offset
    this.bestRtt = Infinity;
    this.hello = null;
    this.queue = [];
  }

  connect(hello) {
    this.hello = hello;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', ...this.hello }));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.#sync();
      this.pinger = setInterval(() => this.#sync(), 5000);
      this.emit('open');
    };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'pong') {
        const rtt = Date.now() - msg.t;
        if (rtt < this.bestRtt * 1.5) { this.bestRtt = Math.min(this.bestRtt, rtt); this.offset = msg.now + rtt / 2 - Date.now(); }
        return;
      }
      if ((msg.type === 'me' || msg.type === 'wait') && msg.token) this.hello.token = msg.token;
      this.emit(msg.type, msg);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      this.emit('close');
      setTimeout(() => this.connect(this.hello), this.retryDelay ?? 1500); this.retryDelay = null; // server full: back off
    };
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  serverNow() { return Date.now() + this.offset; }
  #sync() { this.send({ type: 'ping', t: Date.now() }); }
}
