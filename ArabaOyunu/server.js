// Çok oyunculu relay sunucusu (WebSocket).
// Çalıştırma:  npm install   sonra   node server.js
// Oyunda "Çok oyunculu sunucu" alanına ws://localhost:8090 yazıp bağlan.
// Arkadaşların aynı ağdaysa onlar ws://<senin-LAN-IP>:8090 yazar.

import { WebSocketServer } from 'ws';
import os from 'os';

const PORT = process.env.PORT || 8090;
const wss = new WebSocketServer({ port: PORT });

let nextId = 1;
const players = new Map(); // ws -> {id, name, color, model, x, z, h, hp}

function broadcast(obj, exceptWs) {
  const data = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws !== exceptWs && ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const p = { id, name: 'Oyuncu' + id, color: 0x888888, model: 'klasik', x: 0, z: 0, h: 0, hp: 100 };
  players.set(ws, p);
  console.log(`[+] Oyuncu ${id} bağlandı (toplam ${players.size})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      p.name = ('' + (msg.name || p.name)).slice(0, 14);
      if (typeof msg.color === 'number') p.color = msg.color;
      if (typeof msg.model === 'string') p.model = msg.model;
      // yeni oyuncuya mevcut listeyi gönder
      const roster = [];
      for (const other of players.values()) if (other.id !== id) roster.push(snapshot(other));
      ws.send(JSON.stringify({ type: 'welcome', id, players: roster }));
      // diğerlerine yeni katılımı bildir
      broadcast({ type: 'join', ...snapshot(p) }, ws);
    } else if (msg.type === 'state') {
      p.x = msg.x; p.z = msg.z; p.h = msg.h; if (typeof msg.hp === 'number') p.hp = msg.hp;
      broadcast({ type: 'state', id, x: p.x, z: p.z, h: p.h, hp: p.hp }, ws);
    }
  });

  ws.on('close', () => {
    players.delete(ws);
    broadcast({ type: 'leave', id });
    console.log(`[-] Oyuncu ${id} ayrıldı (toplam ${players.size})`);
  });
  ws.on('error', () => {});
});

function snapshot(p) {
  return { id: p.id, name: p.name, color: p.color, model: p.model, x: p.x, z: p.z, h: p.h, hp: p.hp };
}

// LAN IP'lerini yazdır (arkadaşların bağlanabilsin)
const nets = os.networkInterfaces();
const ips = [];
for (const name of Object.keys(nets)) for (const ni of nets[name]) if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
console.log(`\n🌐 Çok oyunculu sunucu çalışıyor: ws://localhost:${PORT}`);
if (ips.length) console.log(`   Aynı ağdaki arkadaşların için: ${ips.map(ip => `ws://${ip}:${PORT}`).join('  ')}`);
console.log('   Durdurmak için Ctrl+C\n');
