import { clockEstimate } from "./timing.js";
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (v) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[v % 32]).join("");
class JamRoom extends EventTarget {
  constructor() {
    super();
    this.connections = /* @__PURE__ */ new Map();
    this.role = null;
    this.room = null;
    this.offset = 0;
    this.rtt = 0;
    this.samples = [];
    this.transfers = /* @__PURE__ */ new Map();
    this.retry = 0;
    this.snapshot = null;
    this.lastHostSeen = 0;
    this.syncTimer = setInterval(() => this.maintain(), 2e3);
    this.seen = /* @__PURE__ */ new Set();
    this.name = "Phone " + randomCode().slice(0, 3);
    this.device = crypto.randomUUID();
    try{this.device=sessionStorage.getItem('mobipad-device')||this.device;sessionStorage.setItem('mobipad-device',this.device);}catch{}
    this.config = {};
  }
  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  remember() {
    try{localStorage.setItem("mobipad-room", JSON.stringify({ room: this.room, role: this.role }));}catch{}
  }
  async create(role = "leader", room = null) {
    if (!globalThis.Peer) throw new Error("The connection library could not load. Refresh online and try again.");
    this.leave(false);
    this.role = role;
    this.room = (room || randomCode()).toUpperCase();
    this.offset = 0;
    this.samples = [];
    this.remember();
    const c = this.config;
    const options = { debug: 0, secure: true };
    if (c.host) {
      options.host = c.host;
      options.port = c.port || 443;
      options.path = c.path || "/";
    }
    if (c.turn) {
      options.config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: c.turn, username: c.user, credential: c.password }] };
    }
    const id = role === "leader" ? "mobipad-" + this.room : void 0;
    this.peer = new Peer(id, options);
    const peer=this.peer;
    this.emit("status", { message: "Connecting to signaling…" });
    return new Promise((resolve, reject) => {
      let opened=false;
      const fail=message=>{clearTimeout(timer);if(!opened&&this.peer===peer)this.leave(false);reject(new Error(message));};
      const timer = setTimeout(() => fail("Signaling took too long. Check internet or connection settings."), 18e3);
      this.peer.on("open", () => {
        if(this.peer!==peer)return;
        opened=true;
        clearTimeout(timer);
        this.retry = 0;
        if (role === "follower") this.connectHost();
        this.emit("room", { room: this.room, role });
        this.emit("status", { message: role === "leader" ? "Room is open. Invite another phone." : "Finding the leader…" });
        resolve(this.room);
      });
      this.peer.on("connection", (conn) => {
        if (this.peer===peer&&this.role === "leader") this.wire(conn);
        else conn.close();
      });
      this.peer.on("disconnected", () => {
        if(this.peer!==peer)return;
        this.emit("status", { message: "Signaling disconnected. Trying to reconnect…" });
      });
      this.peer.on("error", (err) => {
        if(this.peer!==peer)return;
        clearTimeout(timer);
        const message = err.type === "unavailable-id" ? "This room already has a leader. Join it as a follower." : err.type === "peer-unavailable" ? "Leader is offline. Retrying automatically…" : err.message;
        this.emit("status", { message, error: true });
        if(!opened)fail(message);
      });
    });
  }
  connectHost() {
    const id = "mobipad-" + this.room;
    if (!this.peer || this.peer.destroyed || this.peer.disconnected || this.connections.get(id)?.open || this.connecting) return;
    this.connecting = true;
    const attempt={peer:this.peer};this.connectAttempt=attempt;
    try{
      const conn = attempt.conn=this.peer.connect(id, { reliable: true, serialization: "binary", metadata: { name: this.name, device: this.device } });
      this.wire(conn);
      attempt.timer=setTimeout(()=>{if(this.connectAttempt!==attempt)return;this.finishConnect(conn);if(!conn.open)conn.close();},8e3);
    }catch(error){this.finishConnect(attempt.conn);this.emit('status',{message:error.message||'Connection failed. Retrying…',error:true});}
  }
  finishConnect(conn){
    if(this.connectAttempt?.conn!==conn)return;
    clearTimeout(this.connectAttempt?.timer);this.connectAttempt=null;this.connecting=false;
  }
  wire(conn) {
    const peer=this.peer;
    let closed=false;
    conn.on("open", () => {
      if(closed||this.peer!==peer||!this.role){conn.close();return;}
      const old = this.connections.get(conn.peer);
      this.connections.set(conn.peer, conn);
      if (old && old !== conn) old.close();
      this.finishConnect(conn);
      conn.lastSeen = Date.now();
      this.emitPeers();
      this.emit("status", { message: this.role === "leader" ? "Connected. Your room shares one clock." : "Connected. Measuring the shared clock…" });
      if (this.role === "leader") this.emit("welcome", { conn });
      else {
        this.lastHostSeen = Date.now();
        this.sync();
      }
    });
    conn.on("data", (data) => {
      if(this.peer!==peer||this.connections.get(conn.peer)!==conn)return;
      conn.lastSeen = Date.now();
      if (this.role === "follower") this.lastHostSeen = Date.now();
      this.receive(data, conn);
    });
    conn.on("close", () => {
      closed=true;
      if(this.peer!==peer||this.connections.get(conn.peer)!==conn&&this.connectAttempt?.conn!==conn)return;
      if (this.connections.get(conn.peer) === conn) this.connections.delete(conn.peer);
      this.finishConnect(conn);
      this.emitPeers();
      this.emit("status", { message: "A phone disconnected. Rejoins automatically when it returns." });
    });
    conn.on("error", () => {
      conn.close();
    });
  }
  send(conn, data) {
    if (!conn?.open) return false;
    try {
      conn.send(data);
      return true;
    } catch {
      this.emit("status", { message: "Connection interrupted. Retrying…", error: true });
      return false;
    }
  }
  broadcast(data, except = null) {
    for (const c of this.connections.values()) if (c !== except) this.send(c, data);
  }
  hostConnection() {
    return this.connections.get("mobipad-" + this.room);
  }
  command(action) {
    const packet = { type: "command", id: crypto.randomUUID(), action };
    if (this.role === "leader") {
      this.emit("command", { packet, remote: false });
    } else if (this.role === "follower") {
      if (!this.send(this.hostConnection(), packet)) throw new Error("Leader is disconnected. Wait for the room to reconnect.");
    } else this.emit("command", { packet, remote: false });
  }
  accept(packet) {
    this.broadcast({ ...packet, type: "accepted" });
  }
  sync() {
    if (this.role !== "follower") return;
    const peer=this.peer,conn=this.hostConnection();
    for (let i = 0; i < 8; i++) setTimeout(() => {if(this.peer===peer&&this.hostConnection()===conn)this.send(conn, { type: "ping", t0: Date.now() });}, i * 100);
  }
  receive(data, conn) {
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (data.type === "request-state" && this.role === "leader") {
      this.emit("welcome", { conn });
      return;
    }
    if (data.type === "ping" && this.role === "leader" && Number.isFinite(data.t0)) {
      this.send(conn, { type: "pong", t0: data.t0, host: Date.now() });
      return;
    }
    if (data.type === "pong" && this.role === "follower") {
      const t = Date.now(), rtt = t - data.t0;
      if (!Number.isFinite(data.t0) || !Number.isFinite(rtt) || rtt < 0 || rtt > 3e3 || !Number.isFinite(data.host)) return;
      this.samples.push({ rtt, offset: data.host - (data.t0 + t) / 2 });
      this.samples = this.samples.slice(-32);
      Object.assign(this, clockEstimate(this.samples));
      this.emit("clock", { offset: this.offset, rtt: this.rtt });
      return;
    }
    if (data.type === "heartbeat") {
      if (this.role === "follower") this.emit("heartbeat", data);
      return;
    }
    if (data.type === "command" && this.role === "leader") {
      if (typeof data.id !== "string" || this.seen.has(data.id)) return;
      this.seen.add(data.id);
      if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value);
      this.emit("command", { packet: data, remote: true, conn });
      return;
    }
    if (data.type === "accepted" && this.role === "follower") {
      this.emit("accepted", data);
      return;
    }
    if (data.type === "snapshot" && this.role === "follower") {
      this.snapshot = data;
      this.emit("snapshot", data);
      return;
    }
    if (data.type === "calibrate" && Number.isFinite(data.at)) {
      this.emit("calibrate", data);
      if (this.role === "leader") this.broadcast(data);
      return;
    }
    if (data.type === "audio-start") {
      if (typeof data.id !== "string" || data.id.length > 100 || !Number.isInteger(data.size) || data.size <= 0 || data.size > 25 * 1024 * 1024 || typeof data.name !== "string" || data.name.length > 100 || this.transfers.size >= 6) return;
      this.transfers.set(conn.peer + data.id, { ...data, parts: [], received: 0, expires: Date.now() + 12e4 });
      return;
    }
    if (data.type === "audio-chunk") {
      const key = conn.peer + data.id, t = this.transfers.get(key);
      if (!t || !(data.chunk instanceof ArrayBuffer)) return;
      t.received += data.chunk.byteLength;
      if (t.received > t.size) {
        this.transfers.delete(key);
        return;
      }
      t.parts.push(data.chunk);
      return;
    }
    if (data.type === "audio-end") {
      const key = conn.peer + data.id, t = this.transfers.get(key);
      if (!t) return;
      this.transfers.delete(key);
      if (t.received === t.size) {
        const blob = new Blob(t.parts, { type: t.mime || "audio/wav" });
        this.emit("audio", { id: t.id, name: t.name, blob, conn });
      }
      return;
    }
  }
  async sendAudio(sample, conn = null) {
    const data = await sample.blob.arrayBuffer();
    if (data.byteLength > 25 * 1024 * 1024) throw new Error("Jam samples are limited to 25 MB.");
    const targets = conn ? [conn] : [...this.connections.values()];
    for (const c of targets) {
      if (!c.open) continue;
      this.send(c, { type: "audio-start", id: sample.id, name: sample.name.slice(0, 100), size: data.byteLength, mime: sample.blob.type });
      for (let i = 0; i < data.byteLength; i += 16384) {
        let waited = 0;
        while (c.open && (c.dataChannel?.bufferedAmount || 0) > 262144) {
          await new Promise((r) => setTimeout(r, 20));
          if (++waited > 1e3) throw new Error("Audio transfer timed out.");
        }
        if (!c.open) break;
        this.send(c, { type: "audio-chunk", id: sample.id, chunk: data.slice(i, i + 16384) });
      }
      this.send(c, { type: "audio-end", id: sample.id });
    }
  }
  maintain() {
    for (const [key, t] of this.transfers) if (t.expires < Date.now()) this.transfers.delete(key);
    if (!this.role || !this.peer) return;
    if (this.peer.disconnected && !this.peer.destroyed) {
      try {
        this.peer.reconnect();
      } catch {
      }
    }
    if (this.role === "leader") {
      this.broadcast({ type: "heartbeat", time: Date.now() });
      for (const c of this.connections.values()) if (Date.now() - c.lastSeen > 15e3) {
        c.close();
      }
    } else {
      const c = this.hostConnection();
      if (c?.open && Date.now() - this.lastHostSeen > 1e4) c.close();
      if (!this.hostConnection()?.open) this.connectHost();
      else this.send(this.hostConnection(), { type: "ping", t0: Date.now() });
    }
  }
  emitPeers() {
    this.emit("peers", [...this.connections.values()].map((c) => ({ id: c.peer, name: this.role === "follower" ? "Room leader" : c.metadata?.name || "Guest phone", open: c.open })));
  }
  leave(forget = true) {
    const attempt=this.connectAttempt;this.connectAttempt=null;clearTimeout(attempt?.timer);
    const peer=this.peer;this.peer=null;this.role=null;
    attempt?.conn?.close();
    for (const c of this.connections.values()) c.close();
    this.connections.clear();
    peer?.destroy();
    this.room = null;
    this.offset = 0;
    this.rtt=0;this.samples=[];this.snapshot=null;this.lastHostSeen=0;this.seen.clear();
    this.transfers.clear();
    this.connecting = false;
    if (forget)try{localStorage.removeItem("mobipad-room");}catch{}
    this.emitPeers();
  }
}
export {
  JamRoom
};
