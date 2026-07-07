const DEFAULT_TIMEOUT_MS = 15_000;

export class DerivClient {
  constructor({ appId }) {
    this.appId = appId;
    this.ws = null;
    this.nextReqId = 1;
    this.pending = new Map();
    this.subscriptions = new Map();
    this.keepAlive = null;
    this.closedPromise = null;
    this.resolveClosed = null;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const url = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(this.appId)}`;
    this.ws = new WebSocket(url);
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WebSocket connection timed out')), DEFAULT_TIMEOUT_MS);
      this.ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      }, { once: true });
    });

    this.ws.addEventListener('message', (event) => this.#onMessage(event));
    this.ws.addEventListener('close', () => this.#onClose());
    this.ws.addEventListener('error', () => {});

    this.keepAlive = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 30_000);
  }

  async waitUntilClosed() {
    return this.closedPromise;
  }

  async request(payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#ensureOpen();
    const reqId = this.nextReqId++;
    const message = { ...payload, req_id: reqId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Deriv request timed out: ${Object.keys(payload)[0]}`));
      }, timeoutMs);

      this.pending.set(reqId, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(message));
    });
  }

  async subscribe(payload, handler, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#ensureOpen();
    const reqId = this.nextReqId++;
    const message = { ...payload, subscribe: 1, req_id: reqId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Deriv subscription timed out: ${Object.keys(payload)[0]}`));
      }, timeoutMs);

      this.pending.set(reqId, {
        timeout,
        reject,
        resolve: (response) => {
          const subscriptionId = response.subscription?.id;
          if (!subscriptionId) {
            reject(new Error('Subscription response did not contain an ID'));
            return;
          }
          this.subscriptions.set(subscriptionId, handler);
          handler(response);
          resolve(subscriptionId);
        },
      });
      this.ws.send(JSON.stringify(message));
    });
  }

  async forget(subscriptionId) {
    if (!subscriptionId || this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      await this.request({ forget: subscriptionId });
    } finally {
      this.subscriptions.delete(subscriptionId);
    }
  }

  close() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) this.ws.close();
  }

  #ensureOpen() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Deriv WebSocket is not open');
    }
  }

  #onMessage(event) {
    let response;
    try {
      response = JSON.parse(event.data);
    } catch {
      return;
    }

    const reqId = response.req_id;
    if (reqId && this.pending.has(reqId)) {
      const pending = this.pending.get(reqId);
      this.pending.delete(reqId);
      clearTimeout(pending.timeout);
      if (response.error) {
        pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
      } else {
        pending.resolve(response);
      }
      return;
    }

    const subscriptionId = response.subscription?.id;
    if (subscriptionId && this.subscriptions.has(subscriptionId)) {
      if (!response.error) this.subscriptions.get(subscriptionId)(response);
    }
  }

  #onClose() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    const error = new Error('Deriv WebSocket closed');
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.subscriptions.clear();
    this.resolveClosed?.();
  }
}
