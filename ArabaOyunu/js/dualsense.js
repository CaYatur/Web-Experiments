// DualSense WebHID kontrol modülü
// Işık çubuğu (lightbar), adaptive trigger'lar ve haptic titreşim çıkışını yönetir.
// Girdi okuma (stick/tuş) için oyun tarafı standart Gamepad API'sini kullanır.
// Çalışması için: Chrome/Edge + http://localhost (file:// üzerinde WebHID kapalıdır).

const SONY_VID = 0x054c;
const PID_DUALSENSE = 0x0ce6;
const PID_DUALSENSE_EDGE = 0x0df2;

// ---- Adaptive Trigger efekt üreticileri (Nielk1 TriggerEffectGenerator portu) ----
// Her efekt 11 baytlık dizi döndürür: [mode, p1..p10]
export const TriggerFX = {
  off() {
    return [0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  },
  // Belirli bir konumdan itibaren sabit direnç. position 0..9, strength 0..8
  feedback(position, strength) {
    position = clampInt(position, 0, 9);
    strength = clampInt(strength, 0, 8);
    if (strength === 0) return this.off();
    const forceValue = (strength - 1) & 0x07;
    let forceZones = 0, activeZones = 0;
    for (let i = position; i < 10; i++) {
      forceZones |= (forceValue << (3 * i));
      activeZones |= (1 << i);
    }
    forceZones >>>= 0;
    return [
      0x21,
      activeZones & 0xff, (activeZones >> 8) & 0xff,
      forceZones & 0xff, (forceZones >> 8) & 0xff, (forceZones >> 16) & 0xff, (forceZones >> 24) & 0xff,
      0, 0, 0, 0
    ];
  },
  // Silah benzeri "tetikleme" direnci. start 2..7, end (start+1)..8, strength 0..8
  weapon(start, end, strength) {
    start = clampInt(start, 2, 7);
    end = clampInt(end, start + 1, 8);
    strength = clampInt(strength, 0, 8);
    if (strength === 0) return this.off();
    const zones = ((1 << start) | (1 << end)) & 0xffff;
    return [
      0x25,
      zones & 0xff, (zones >> 8) & 0xff,
      (strength - 1) & 0x07,
      0, 0, 0, 0, 0, 0, 0
    ];
  },
  // Otomatik titreşim. position 0..9, amplitude 0..8, frequency 0..255 (Hz benzeri)
  vibration(position, amplitude, frequency) {
    position = clampInt(position, 0, 9);
    amplitude = clampInt(amplitude, 0, 8);
    frequency = clampInt(frequency, 0, 255);
    if (amplitude === 0 || frequency === 0) return this.off();
    const strengthValue = (amplitude - 1) & 0x07;
    let strengthZones = 0, activeZones = 0;
    for (let i = position; i < 10; i++) {
      strengthZones |= (strengthValue << (3 * i));
      activeZones |= (1 << i);
    }
    strengthZones >>>= 0;
    return [
      0x26,
      activeZones & 0xff, (activeZones >> 8) & 0xff,
      strengthZones & 0xff, (strengthZones >> 8) & 0xff, (strengthZones >> 16) & 0xff, (strengthZones >> 24) & 0xff,
      0, 0, frequency & 0xff, 0
    ];
  }
};

function clampInt(v, lo, hi) {
  v = Math.round(v);
  return v < lo ? lo : (v > hi ? hi : v);
}
function dz(v, dead = 0.09) {
  if (Math.abs(v) < dead) return 0;
  const s = Math.sign(v);
  return s * (Math.abs(v) - dead) / (1 - dead);
}

// ---- CRC32 (Bluetooth çıkış raporu için) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export class DualSense {
  constructor() {
    this.device = null;
    this.connected = false;
    this.bluetooth = false;       // bağlantı türü (USB önerilir)
    this.onStatus = null;         // (text) => void
    // çıkış durumu
    this._lr = 0; this._lg = 0; this._lb = 0;     // lightbar RGB
    this._rumbleStrong = 0; this._rumbleWeak = 0; // 0..255
    this._rTrig = TriggerFX.off();
    this._lTrig = TriggerFX.off();
    this._playerLeds = 0x00;
    this._dirty = true;
    this._failCount = 0;
    // girdi durumu (WebHID input raporundan okunur)
    this.input = {
      lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0,
      cross: false, circle: false, square: false, triangle: false,
      l1: false, r1: false, l3: false, r3: false,
      options: false, create: false, dpad: 8,
      fresh: false
    };
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  async connect() {
    if (!this.supported) throw new Error('Bu tarayıcı WebHID desteklemiyor (Chrome/Edge kullanın).');
    const filters = [
      { vendorId: SONY_VID, productId: PID_DUALSENSE },
      { vendorId: SONY_VID, productId: PID_DUALSENSE_EDGE }
    ];
    const devices = await navigator.hid.requestDevice({ filters });
    if (!devices.length) throw new Error('Kumanda seçilmedi.');
    this.device = devices[0];
    if (!this.device.opened) await this.device.open();

    this.device.addEventListener('inputreport', (e) => this._onInput(e));
    navigator.hid.addEventListener('disconnect', (e) => {
      if (e.device === this.device) this._handleDisconnect();
    });

    this.connected = true;
    this._status('Bağlandı: ' + this.device.productName);
    // Bluetooth tam rapor modunu tetiklemeyi dene (calibration feature 0x05)
    try { await this.device.receiveFeatureReport(0x05); } catch (_) {}
    // ilk raporu gönder (USB varsayımıyla; gerekirse BT'ye düşer)
    this._dirty = true;
    await this.flush(true);
    return true;
  }

  _onInput(e) {
    const dv = e.data;
    // Bağlantı türü: BT raporu 0x31 ve daha uzundur, veride 1 baytlık ofset vardır
    const bt = (e.reportId === 0x31) || dv.byteLength >= 70;
    this.bluetooth = bt;
    const o = bt ? 1 : 0;
    if (dv.byteLength < o + 10) return;
    const i = this.input;
    i.lx = dz((dv.getUint8(o + 0) - 128) / 128);
    i.ly = dz((dv.getUint8(o + 1) - 128) / 128);
    i.rx = dz((dv.getUint8(o + 2) - 128) / 128);
    i.ry = dz((dv.getUint8(o + 3) - 128) / 128);
    i.l2 = dv.getUint8(o + 4) / 255;
    i.r2 = dv.getUint8(o + 5) / 255;
    const b0 = dv.getUint8(o + 7);  // dpad + yüz tuşları
    const b1 = dv.getUint8(o + 8);  // omuz / sistem tuşları
    i.dpad = b0 & 0x0f;
    i.square = !!(b0 & 0x10);
    i.cross = !!(b0 & 0x20);
    i.circle = !!(b0 & 0x40);
    i.triangle = !!(b0 & 0x80);
    i.l1 = !!(b1 & 0x01);
    i.r1 = !!(b1 & 0x02);
    i.create = !!(b1 & 0x10);
    i.options = !!(b1 & 0x20);
    i.l3 = !!(b1 & 0x40);
    i.r3 = !!(b1 & 0x80);
    i.fresh = true;
  }

  _handleDisconnect() {
    this.connected = false;
    this.device = null;
    this._status('Kumanda bağlantısı kesildi.');
  }

  _status(t) { if (this.onStatus) this.onStatus(t); }

  // ---- Genel API ----
  setLightbar(r, g, b) {
    r = clampInt(r, 0, 255); g = clampInt(g, 0, 255); b = clampInt(b, 0, 255);
    if (r !== this._lr || g !== this._lg || b !== this._lb) {
      this._lr = r; this._lg = g; this._lb = b; this._dirty = true;
    }
  }
  // strong: düşük frekanslı ağır motor, weak: yüksek frekanslı hafif motor (0..1)
  setRumble(strong, weak) {
    const s = clampInt(strong * 255, 0, 255);
    const w = clampInt(weak * 255, 0, 255);
    if (s !== this._rumbleStrong || w !== this._rumbleWeak) {
      this._rumbleStrong = s; this._rumbleWeak = w; this._dirty = true;
    }
  }
  setRightTrigger(fx) { this._rTrig = fx || TriggerFX.off(); this._dirty = true; }
  setLeftTrigger(fx) { this._lTrig = fx || TriggerFX.off(); this._dirty = true; }
  setPlayerLeds(mask) {
    mask &= 0x1f;
    if (mask !== this._playerLeds) { this._playerLeds = mask; this._dirty = true; }
  }

  // 47 baytlık ortak çıkış yükünü oluştur
  _buildPayload() {
    const p = new Uint8Array(47);
    p[0] = 0xff;                                  // flag0: rumble + trigger motorlarını etkinleştir
    p[1] = 0x04 | 0x10 | 0x01 | 0x02 | 0x40;      // flag1: lightbar + player led + mic/mute + güç
    p[2] = this._rumbleWeak;                       // sağ (hafif) motor
    p[3] = this._rumbleStrong;                     // sol (ağır) motor
    // sağ trigger: mode @10, params @11..20
    p[10] = this._rTrig[0];
    for (let i = 0; i < 10; i++) p[11 + i] = this._rTrig[1 + i] || 0;
    // sol trigger: mode @21, params @22..31
    p[21] = this._lTrig[0];
    for (let i = 0; i < 10; i++) p[22 + i] = this._lTrig[1 + i] || 0;
    // LED ayarları
    p[38] = 0x02;            // led option: kesintisiz (anında renk)
    p[41] = 0x00;            // pulse kapalı
    p[42] = 0x00;            // parlaklık: yüksek
    p[43] = this._playerLeds;
    p[44] = this._lr;
    p[45] = this._lg;
    p[46] = this._lb;
    return p;
  }

  async flush(force = false) {
    if (!this.connected || !this.device) return;
    if (!this._dirty && !force) return;
    const payload = this._buildPayload();
    try {
      if (this.bluetooth) {
        await this._sendBt(payload);
      } else {
        await this.device.sendReport(0x02, payload);
      }
      this._dirty = false;
      this._failCount = 0;
    } catch (err) {
      // yanlış bağlantı türü tahmin edildiyse bir kez ters dene
      this._failCount++;
      if (this._failCount <= 2) {
        this.bluetooth = !this.bluetooth;
      } else {
        this._status('Çıkış raporu gönderilemedi: ' + err.message);
      }
    }
  }

  async _sendBt(payload) {
    // BT çıkış raporu 0x31: [tag(0x02)] + payload + padding + CRC32(LE)
    const data = new Uint8Array(77);
    data[0] = 0x02;
    data.set(payload, 1);                 // 1..47
    // 48..72 dolgu (0)
    // CRC: 0xA2 (BT çıkış başlığı) + reportId(0x31) + data[0..72]
    const crcBuf = new Uint8Array(2 + 73);
    crcBuf[0] = 0xa2;
    crcBuf[1] = 0x31;
    crcBuf.set(data.subarray(0, 73), 2);
    const crc = crc32(crcBuf);
    data[73] = crc & 0xff;
    data[74] = (crc >> 8) & 0xff;
    data[75] = (crc >> 16) & 0xff;
    data[76] = (crc >> 24) & 0xff;
    await this.device.sendReport(0x31, data);
  }

  async resetOutputs() {
    this.setLightbar(0, 0, 0);
    this.setRumble(0, 0);
    this.setRightTrigger(TriggerFX.off());
    this.setLeftTrigger(TriggerFX.off());
    this.setPlayerLeds(0);
    await this.flush(true);
  }
}
