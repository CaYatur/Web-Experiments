const canvas = document.getElementById('trafficCanvas');
const ctx = canvas.getContext('2d');

const width = 1000;
const height = 1000;
canvas.width = width;
canvas.height = height;

const LANE_WIDTH = 30;
const LANE_COUNT = 3;
const ROAD_WIDTH = LANE_WIDTH * LANE_COUNT * 2; // Incoming + Outgoing
const ARM_WIDTH = LANE_WIDTH * LANE_COUNT; // Width of one side (incoming or outgoing)
const CAR_WIDTH = 22;
const CAR_LENGTH = 44;

const cx = width / 2;
const cy = height / 2;

// Directions: 0: Bottom, 1: Right, 2: Top, 3: Left
// Traffic Light States
const RED = 0;
const YELLOW = 1;
const GREEN = 2;

// ==================== AYARLANABILIR PARAMETRELER ====================
let settings = {
    trafficDensity: 0.02,      // Trafik yoğunluğu (0.01 - 1.0)
    lightDuration: 10000,       // Işık süresi (ms)
    carSpeedMultiplier: 1.0,    // Araç hız çarpanı
    acceleration: 0.05,         // Hızlanma
    collisionDistance: 150      // Çarpışma mesafesi
};

let trafficLights = [
    { state: GREEN, timer: 0 }, // Bottom
    { state: RED, timer: 0 },   // Right
    { state: RED, timer: 0 },   // Top
    { state: RED, timer: 0 }    // Left
];

let currentGreen = 0;
let lastTime = Date.now();
let emergencyActive = false; // Acil durum aktif mi?
let emergencyDirection = -1; // Hangi yönde acil durum var?
let pendingEmergencyType = null; // Seçilen acil durum aracı tipi (yerleştirme bekleyen)

// Simülasyon kontrolü
let isPaused = false;
let frameCount = 0;
let lastFpsTime = Date.now();
let fps = 0;

// Cars
let cars = [];
let carIdCounter = 0;

const SIREN_PROFILES = {
    ambulance: { minFreq: 700, maxFreq: 1100, sweepDuration: 0.9, volume: 0.18 },
    firetruck: { minFreq: 450, maxFreq: 800, sweepDuration: 1.2, volume: 0.16 },
    police: { minFreq: 550, maxFreq: 950, sweepDuration: 0.5, volume: 0.14 },
    default: { minFreq: 600, maxFreq: 900, sweepDuration: 1.0, volume: 0.15 }
};

class SirenInstance {
    constructor(context, profile) {
        this.context = context;
        this.profile = profile;
        this.oscillator = null;
        this.gainNode = null;
        this.sweepTimeout = null;
        this.targetVolume = profile.volume;
        this.muted = false;
    }

    start(muted = false) {
        if (!this.context) return;
        this.oscillator = this.context.createOscillator();
        this.oscillator.type = 'triangle';
        this.gainNode = this.context.createGain();
        this.gainNode.gain.value = 0;
        this.oscillator.connect(this.gainNode);
        this.gainNode.connect(this.context.destination);
        this.oscillator.start();
        this.setMuted(muted, true);
        this.scheduleSweep();
    }

    scheduleSweep() {
        if (!this.oscillator || !this.context) return;
        const { minFreq, maxFreq, sweepDuration } = this.profile;
        const now = this.context.currentTime;
        this.oscillator.frequency.cancelScheduledValues(now);
        this.oscillator.frequency.setValueAtTime(minFreq, now);
        this.oscillator.frequency.linearRampToValueAtTime(maxFreq, now + sweepDuration / 2);
        this.oscillator.frequency.linearRampToValueAtTime(minFreq, now + sweepDuration);
        if (this.sweepTimeout) clearTimeout(this.sweepTimeout);
        this.sweepTimeout = setTimeout(() => this.scheduleSweep(), sweepDuration * 1000);
    }

    setMuted(mute, immediate = false) {
        this.muted = mute;
        if (!this.gainNode || !this.context) return;
        const now = this.context.currentTime;
        const target = mute ? 0 : this.targetVolume;
        this.gainNode.gain.cancelScheduledValues(now);
        const ramp = immediate ? 0.05 : 0.2;
        this.gainNode.gain.linearRampToValueAtTime(target, now + ramp);
    }

    stop() {
        if (this.sweepTimeout) {
            clearTimeout(this.sweepTimeout);
            this.sweepTimeout = null;
        }
        if (this.gainNode && this.context) {
            const now = this.context.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.linearRampToValueAtTime(0, now + 0.2);
        }
        if (this.oscillator) {
            const osc = this.oscillator;
            setTimeout(() => {
                try { osc.stop(); } catch (_) {}
                osc.disconnect();
            }, 250);
        }
        if (this.gainNode) this.gainNode.disconnect();
        this.oscillator = null;
        this.gainNode = null;
    }
}

const sirenController = {
    context: null,
    sirens: new Map(),

    init() {
        if (this.context) return true;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        this.context = new AudioCtx();
        return true;
    },

    start(carId, type, muted = false) {
        if (!this.init()) return;
        const profile = SIREN_PROFILES[type] || SIREN_PROFILES.default;
        const existing = this.sirens.get(carId);
        if (existing) existing.stop();
        if (this.context.state === 'suspended') this.context.resume();
        const siren = new SirenInstance(this.context, profile);
        siren.start(muted);
        this.sirens.set(carId, siren);
    },

    stop(carId) {
        const siren = this.sirens.get(carId);
        if (!siren) return;
        siren.stop();
        this.sirens.delete(carId);
    },

    stopAll() {
        this.sirens.forEach((siren) => siren.stop());
        this.sirens.clear();
    },

    setPaused(paused) {
        this.sirens.forEach((siren) => siren.setMuted(paused));
    }
};

class Car {
    constructor(direction, lane, type = 'normal') {
        this.id = ++carIdCounter;
        this.direction = direction; // 0: Bottom, 1: Right, 2: Top, 3: Left
        this.lane = lane; // 0: Left Turn, 1: Straight, 2: Right Turn
        this.type = type; // 'normal', 'ambulance', 'firetruck', 'police'
        this.isEmergency = type !== 'normal';
        this.speed = 0;
        this.maxSpeed = (this.isEmergency ? 4 : 2 + Math.random()) * settings.carSpeedMultiplier;
        this.acceleration = this.isEmergency ? 0.1 : settings.acceleration;
        this.progress = 0;
        this.distance = 0; 
        this.totalDistance = 0;
        this.path = this.generatePath();
        
        if (this.type === 'ambulance') this.color = '#FFFFFF';
        else if (this.type === 'firetruck') this.color = '#FF0000';
        else if (this.type === 'police') this.color = '#0000FF';
        else this.color = `hsl(${Math.random() * 360}, 70%, 50%)`;
        
        this.removed = false;
        this.stopped = false;
    }

    generatePath() {
        // Define path points based on direction and lane
        // We will use a simple set of segments: [Start -> Intersection Entry], [Intersection Curve/Line], [Intersection Exit -> End]
        
        let startX, startY, entryX, entryY, exitX, exitY, endX, endY;
        let controlX, controlY; // For Bezier

        // Incoming Lane Offsets (from center line)
        // Lane 0: 0.5 * LW
        // Lane 1: 1.5 * LW
        // Lane 2: 2.5 * LW
        let offset = (this.lane + 0.5) * LANE_WIDTH;

        // Outgoing Lane Offsets (mirrored)
        // We usually turn into the corresponding lane.
        // Left turn (Lane 0) -> Outgoing Lane 0
        // Right turn (Lane 2) -> Outgoing Lane 2
        // Straight (Lane 1) -> Outgoing Lane 1
        let outOffset = offset;

        // 0: Bottom (Moving Up)
        if (this.direction === 0) {
            startX = cx + offset; startY = height;
            entryX = cx + offset; entryY = cy + ARM_WIDTH;
            
            if (this.lane === 1) { // Straight
                exitX = cx + offset; exitY = cy - ARM_WIDTH;
                endX = cx + offset; endY = 0;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 2) { // Right Turn
                // Target: Right Road (Direction 1), Outgoing side (Bottom half)
                // Right Road Outgoing y is [cy, cy+ARM_WIDTH]
                // Lane 2 is closest to curb, so largest offset from center line.
                // Right Road Outgoing Lane 2 y = cy + 2.5*LW
                exitX = cx + ARM_WIDTH; exitY = cy + outOffset;
                endX = width; endY = cy + outOffset;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx + ARM_WIDTH, cy: cy + ARM_WIDTH, x2: exitX, y2: exitY},
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 0) { // Left Turn
                // Target: Left Road (Direction 3), Outgoing side (Top half)
                // Left Road Outgoing y is [cy-ARM_WIDTH, cy]
                // Lane 0 is closest to center line.
                // Left Road Outgoing Lane 0 y = cy - 0.5*LW
                exitX = cx - ARM_WIDTH; exitY = cy - outOffset;
                endX = 0; endY = cy - outOffset;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx + 10, cy: cy - 10, x2: exitX, y2: exitY}, // Simple curve
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            }
        }
        // 1: Right (Moving Left)
        else if (this.direction === 1) {
            // Right Hand Traffic: Right incoming is on the Top half (y < cy)
            // Lane 0 (Left Turn) is closest to center (largest y in this half) -> cy - 0.5*LW
            // Lane 2 (Right Turn) is furthest from center (smallest y) -> cy - 2.5*LW
            // My offset calculation: (lane + 0.5) * LW.
            // So y = cy - offset.
            
            startX = width; startY = cy - offset;
            entryX = cx + ARM_WIDTH; entryY = cy - offset;

            if (this.lane === 1) { // Straight
                exitX = cx - ARM_WIDTH; exitY = cy - offset;
                endX = 0; endY = cy - offset;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 2) { // Right Turn (Up)
                // Target: Top Road (Direction 2), Outgoing side (Right half)
                // Top Road Outgoing x is [cx, cx+ARM_WIDTH]
                // Lane 2 x = cx + 2.5*LW
                exitX = cx + outOffset; exitY = cy - ARM_WIDTH;
                endX = cx + outOffset; endY = 0;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx + ARM_WIDTH, cy: cy - ARM_WIDTH, x2: exitX, y2: exitY},
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 0) { // Left Turn (Down)
                // Target: Bottom Road (Direction 0), Outgoing side (Left half)
                // Bottom Road Outgoing x is [cx-ARM_WIDTH, cx]
                // Lane 0 x = cx - 0.5*LW
                exitX = cx - outOffset; exitY = cy + ARM_WIDTH;
                endX = cx - outOffset; endY = height;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx - 10, cy: cy - 10, x2: exitX, y2: exitY},
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            }
        }
        // 2: Top (Moving Down)
        else if (this.direction === 2) {
            startX = cx - offset; startY = 0;
            entryX = cx - offset; entryY = cy - ARM_WIDTH;

            if (this.lane === 1) { // Straight
                exitX = cx - offset; exitY = cy + ARM_WIDTH;
                endX = cx - offset; endY = height;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 2) { // Right Turn (Left)
                // Target: Left Road (Direction 3), Outgoing side (Top half)
                // Left Road Outgoing y is [cy-ARM_WIDTH, cy] -> Wait, Left Road Outgoing is Top Half?
                // Left Road Incoming is Bottom Half (y > cy).
                // Left Road Outgoing is Top Half (y < cy).
                // Lane 2 y = cy - 2.5*LW.
                exitX = cx - ARM_WIDTH; exitY = cy - outOffset;
                endX = 0; endY = cy - outOffset;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx - ARM_WIDTH, cy: cy - ARM_WIDTH, x2: exitX, y2: exitY},
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 0) { // Left Turn (Right)
                // Target: Right Road (Direction 1), Outgoing side (Bottom half)
                // Right Road Outgoing y is [cy, cy+ARM_WIDTH]
                // Lane 0 y = cy + 0.5*LW
                exitX = cx + ARM_WIDTH; exitY = cy + outOffset;
                endX = width; endY = cy + outOffset;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx + 10, cy: cy + 10, x2: exitX, y2: exitY},
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            }
        }
        // 3: Left (Moving Right)
        else if (this.direction === 3) {
            // Right Hand Traffic: Left incoming is on the Bottom half (y > cy)
            // Lane 0 (Left Turn) is closest to center (smallest y in this half) -> cy + 0.5*LW
            // Lane 2 (Right Turn) is furthest from center (largest y) -> cy + 2.5*LW
            // y = cy + offset.
            
            startX = 0; startY = cy + offset;
            entryX = cx - ARM_WIDTH; entryY = cy + offset;

            if (this.lane === 1) { // Straight
                exitX = cx + ARM_WIDTH; exitY = cy + offset;
                endX = width; endY = cy + offset;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'line', x1: entryX, y1: entryY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 2) { // Right Turn (Down)
                // Target: Bottom Road (Direction 0), Outgoing side (Left half)
                // Bottom Road Outgoing x is [cx-ARM_WIDTH, cx]
                // Lane 2 x = cx - 2.5*LW
                exitX = cx - outOffset; exitY = cy + ARM_WIDTH;
                endX = cx - outOffset; endY = height;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx - ARM_WIDTH, cy: cy + ARM_WIDTH, x2: exitX, y2: exitY},
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            } else if (this.lane === 0) { // Left Turn (Up)
                // Target: Top Road (Direction 2), Outgoing side (Right half)
                // Top Road Outgoing x is [cx, cx+ARM_WIDTH]
                // Lane 0 x = cx + 0.5*LW
                exitX = cx + outOffset; exitY = cy - ARM_WIDTH;
                endX = cx + outOffset; endY = 0;
                return [
                    {type: 'line', x1: startX, y1: startY, x2: entryX, y2: entryY},
                    {type: 'quadratic', x1: entryX, y1: entryY, cx: cx + 10, cy: cy - 10, x2: exitX, y2: exitY},
                    {type: 'line', x1: exitX, y1: exitY, x2: endX, y2: endY}
                ];
            }
        }
        return [];
    }

    update() {
        // Calculate distance to intersection entry (stop line)
        let distToEntry = this.getDistanceToEntry();
        
        let targetSpeed = this.maxSpeed;

        // Traffic Light Logic
        // If light is not GREEN, we must stop at the entry line.
        if (trafficLights[this.direction].state !== GREEN) {
            // If we are approaching the line (distToEntry > 0)
            if (distToEntry > 0 && distToEntry < 300) {
                if (distToEntry < 20) {
                    targetSpeed = 0;
                } else {
                    // Decelerate smoothly
                    targetSpeed = Math.min(targetSpeed, (distToEntry - 20) * 0.05);
                }
            }
        }

        // Collision Avoidance Logic
        // Check all other cars
        for (let other of cars) {
            if (other === this) continue;

            // Calculate distance to other car
            let dx = other.x - this.x;
            let dy = other.y - this.y;
            let dist = Math.sqrt(dx*dx + dy*dy);

            // Direction vector of this car
            let dirX = Math.cos(this.rotation);
            let dirY = Math.sin(this.rotation);
            
            // Perpendicular vector (to the side)
            let perpX = -dirY;
            let perpY = dirX;
            
            // Vector to other car
            let toOtherX = dx;
            let toOtherY = dy;
            
            // Normalize toOther
            let toOtherLen = Math.sqrt(toOtherX*toOtherX + toOtherY*toOtherY);
            if (toOtherLen === 0) continue;
            
            toOtherX /= toOtherLen;
            toOtherY /= toOtherLen;
            
            // Dot product with direction (forward/backward)
            let dotForward = dirX * toOtherX + dirY * toOtherY;
            
            // Dot product with perpendicular (side to side)
            let dotSide = Math.abs(perpX * toOtherX + perpY * toOtherY);

            // Same lane/direction collision avoidance (front/back)
            if (other.direction === this.direction && other.lane === this.lane) {
                if (dotForward > 0.7 && dist < settings.collisionDistance) { // Car ahead
                    if (dist < 80) {
                        targetSpeed = 0;
                    } else {
                        targetSpeed = Math.min(targetSpeed, (dist - 80) * 0.06);
                    }
                }
            }
        }

        // Apply speed change
        if (this.speed < targetSpeed) {
            this.speed += this.acceleration;
        } else {
            this.speed -= this.acceleration * 2; // Brake faster
        }
        
        if (this.speed < 0) this.speed = 0;

        this.distance += this.speed;
        
        // Calculate x, y, rotation based on distance
        let pos = this.getPositionAt(this.distance);
        if (!pos) {
            this.removed = true;
            return;
        }
        this.x = pos.x;
        this.y = pos.y;
        this.rotation = pos.angle;
        
        // Check if car is way outside the canvas
        if (this.x < -100 || this.x > width + 100 || this.y < -100 || this.y > height + 100) {
            this.removed = true;
        }
    }

    getDistanceToEntry() {
        // Entry distance is roughly (height/2 - ARM_WIDTH) for vertical, etc.
        // Let's calculate total length of first segment.
        let seg = this.path[0];
        let len = Math.sqrt(Math.pow(seg.x2 - seg.x1, 2) + Math.pow(seg.y2 - seg.y1, 2));
        return len - this.distance;
    }

    getPositionAt(dist) {
        let currentDist = 0;
        for (let seg of this.path) {
            let len;
            if (seg.type === 'line') {
                len = Math.sqrt(Math.pow(seg.x2 - seg.x1, 2) + Math.pow(seg.y2 - seg.y1, 2));
                if (dist <= currentDist + len) {
                    let t = (dist - currentDist) / len;
                    return {
                        x: seg.x1 + (seg.x2 - seg.x1) * t,
                        y: seg.y1 + (seg.y2 - seg.y1) * t,
                        angle: Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1)
                    };
                }
            } else if (seg.type === 'quadratic') {
                // Approximate length for quadratic bezier?
                // For simplicity, let's just step through t.
                // Or just use t directly if we don't care about constant speed perfectly.
                // Let's assume length is roughly straight line distance for now to find t, 
                // or better, just treat 'dist' as 't' mapped to length.
                // Let's do a simple approximation: 
                // We need a better way to handle curves.
                // For now, let's assume the curve length is roughly 1.5x linear distance?
                // Let's just use a fixed number of steps for the curve to find position.
                // This is getting complicated for a single file script.
                // Simplified: Just use t from 0 to 1 for the curve segment, mapped to a fixed length.
                // Curve length approx:
                let chord = Math.sqrt(Math.pow(seg.x2 - seg.x1, 2) + Math.pow(seg.y2 - seg.y1, 2));
                len = chord * 1.2; // Approximation
                
                if (dist <= currentDist + len) {
                    let t = (dist - currentDist) / len;
                    // Quadratic Bezier: (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
                    let mt = 1 - t;
                    let x = mt*mt*seg.x1 + 2*mt*t*seg.cx + t*t*seg.x2;
                    let y = mt*mt*seg.y1 + 2*mt*t*seg.cy + t*t*seg.y2;
                    
                    // Derivative for angle: 2(1-t)(P1-P0) + 2t(P2-P1)
                    let dx = 2*mt*(seg.cx - seg.x1) + 2*t*(seg.x2 - seg.cx);
                    let dy = 2*mt*(seg.cy - seg.y1) + 2*t*(seg.y2 - seg.cy);
                    
                    return { x: x, y: y, angle: Math.atan2(dy, dx) };
                }
            }
            currentDist += len;
        }
        return null; // End of path
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        
        // Body
        ctx.fillStyle = this.color;
        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 5;
        
        // Acil durum araçları için boyut ayarı
        let length = this.isEmergency ? CAR_LENGTH * 1.2 : CAR_LENGTH;
        let width = this.isEmergency ? CAR_WIDTH * 1.1 : CAR_WIDTH;

        ctx.fillRect(-length/2, -width/2, length, width);
        ctx.shadowBlur = 0;

        // Roof & Details
        if (this.type === 'ambulance') {
            // Red Cross
            ctx.fillStyle = '#FF0000';
            ctx.fillRect(-5, -width/2 + 4, 10, width - 8);
            ctx.fillRect(-length/4, -2, length/2, 4);
        } else if (this.type === 'police') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(-length/4, -width/2 + 2, length/2, width - 4);
        } else if (this.type === 'firetruck') {
            ctx.fillStyle = '#CCCCCC'; // Ladder or equipment
            ctx.fillRect(-length/3, -width/4, length/1.5, width/2);
        } else {
            // Normal car roof
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(-length/4, -width/2 + 2, length/2, width - 4);
        }

        // Windshield
        ctx.fillStyle = '#88CCFF';
        ctx.fillRect(length/4, -width/2 + 2, 5, width - 4);
        
        // Rear window
        ctx.fillRect(-length/4 - 5, -width/2 + 2, 5, width - 4);

        // Headlights
        ctx.fillStyle = '#FFFF00';
        ctx.beginPath();
        ctx.arc(length/2, -width/2 + 4, 3, 0, Math.PI*2);
        ctx.arc(length/2, width/2 - 4, 3, 0, Math.PI*2);
        ctx.fill();

        // Taillights
        ctx.fillStyle = '#FF0000';
        ctx.beginPath();
        ctx.arc(-length/2, -width/2 + 4, 3, 0, Math.PI*2);
        ctx.arc(-length/2, width/2 - 4, 3, 0, Math.PI*2);
        ctx.fill();

        // Emergency Lights (Flashing)
        if (this.isEmergency) {
            let time = Date.now();
            let flash = Math.floor(time / 200) % 2 === 0;
            
            if (this.type === 'police') {
                // Red and Blue
                ctx.fillStyle = flash ? '#FF0000' : '#0000FF';
                ctx.beginPath(); ctx.arc(0, -width/2, 5, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = !flash ? '#FF0000' : '#0000FF';
                ctx.beginPath(); ctx.arc(0, width/2, 5, 0, Math.PI*2); ctx.fill();
            } else {
                // Red flashing
                if (flash) {
                    ctx.fillStyle = '#FF0000';
                    ctx.shadowColor = '#FF0000';
                    ctx.shadowBlur = 10;
                    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI*2); ctx.fill();
                    ctx.shadowBlur = 0;
                }
            }
        }

        ctx.restore();
    }
}

function spawnCar() {
    let dir = Math.floor(Math.random() * 4);
    let lane = Math.floor(Math.random() * 3);
    
    // Check if spawn point is clear
    // Simplified: just check if any car is very close to start (distance < 120)
    let clear = true;
    for (let c of cars) {
        if (c.direction === dir && c.lane === lane && c.distance < 120) {
            clear = false;
            break;
        }
    }
    
    if (clear) {
        cars.push(new Car(dir, lane));
    }
}

function prepareSpawnEmergencyVehicle(type) {
    pendingEmergencyType = type;
    canvas.style.cursor = 'crosshair';
    // Kullanıcıya bilgi verilebilir (console veya UI)
    console.log(type + " seçildi. Lütfen haritada bir şeride tıklayın.");
}

// Canvas tıklama olayını dinle
canvas.addEventListener('mousedown', (e) => {
    if (!pendingEmergencyType) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Hangi yola tıklandığını bul
    let selectedDir = -1;
    let selectedLane = -1;

    // Koordinat sınırları
    // cx, cy, ARM_WIDTH, LANE_WIDTH global değişkenler
    
    // 0: Bottom (Aşağıdan gelenler sağ şeritte) -> x: [cx, cx+ARM], y: [cy+ARM, height]
    if (x >= cx && x <= cx + ARM_WIDTH && y >= cy + ARM_WIDTH) {
        selectedDir = 0;
        selectedLane = Math.floor((x - cx) / LANE_WIDTH);
    }
    // 1: Right (Sağdan gelenler üst şeritte) -> x: [cx+ARM, width], y: [cy-ARM, cy]
    else if (x >= cx + ARM_WIDTH && y >= cy - ARM_WIDTH && y <= cy) {
        selectedDir = 1;
        selectedLane = Math.floor((cy - y) / LANE_WIDTH);
    }
    // 2: Top (Yukarıdan gelenler sol şeritte) -> x: [cx-ARM, cx], y: [0, cy-ARM]
    else if (x >= cx - ARM_WIDTH && x <= cx && y <= cy - ARM_WIDTH) {
        selectedDir = 2;
        selectedLane = Math.floor((cx - x) / LANE_WIDTH);
    }
    // 3: Left (Soldan gelenler alt şeritte) -> x: [0, cx-ARM], y: [cy, cy+ARM]
    else if (x <= cx - ARM_WIDTH && y >= cy && y <= cy + ARM_WIDTH) {
        selectedDir = 3;
        selectedLane = Math.floor((y - cy) / LANE_WIDTH);
    }

    if (selectedDir !== -1 && selectedLane >= 0 && selectedLane < 3) {
        spawnEmergencyVehicle(selectedDir, selectedLane, pendingEmergencyType);
        pendingEmergencyType = null;
        canvas.style.cursor = 'default';
    } else {
        console.log("Geçersiz alan. Lütfen bir giriş şeridine tıklayın.");
    }
});

function spawnEmergencyVehicle(dir, lane, type) {
    // Spawn point check
    let clear = true;
    for (let c of cars) {
        if (c.direction === dir && c.lane === lane && c.distance < 150) {
            // Eğer doluysa, diğer araçları biraz ileri ışınlayamayız ama
            // acil durum aracı üstüne binebilir simülasyon hatası olmasın diye bekletmeyelim
        }
    }

    // Acil durum modunu başlat
    emergencyActive = true;
    emergencyDirection = dir;
    
    // Işıkları ayarla: Acil durum yönü YEŞİL, diğerleri KIRMIZI
    for(let i=0; i<4; i++) {
        if (i === dir) {
            trafficLights[i].state = GREEN;
        } else {
            trafficLights[i].state = RED;
        }
    }
    
    // Aracı oluştur
    let emergencyCar = new Car(dir, lane, type);
    cars.push(emergencyCar);

    sirenController.start(emergencyCar.id, type, isPaused);
}

function drawRoads() {
    ctx.fillStyle = '#555';
    
    // Vertical Road
    ctx.fillRect(cx - ARM_WIDTH, 0, ARM_WIDTH * 2, height);
    // Horizontal Road
    ctx.fillRect(0, cy - ARM_WIDTH, width, ARM_WIDTH * 2);
    
    // Intersection center
    ctx.fillRect(cx - ARM_WIDTH, cy - ARM_WIDTH, ARM_WIDTH * 2, ARM_WIDTH * 2);

    // Markings
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 20]);

    // Vertical Lanes
    for (let i = 1; i < LANE_COUNT * 2; i++) {
        let x = cx - ARM_WIDTH + i * LANE_WIDTH;
        if (i === LANE_COUNT) {
            ctx.strokeStyle = '#FFD700'; // Double Yellow
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, cy - ARM_WIDTH);
            ctx.moveTo(x, cy + ARM_WIDTH); ctx.lineTo(x, height);
            ctx.stroke();
            ctx.strokeStyle = '#FFF';
            ctx.setLineDash([20, 20]);
        } else {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, cy - ARM_WIDTH);
            ctx.moveTo(x, cy + ARM_WIDTH); ctx.lineTo(x, height);
            ctx.stroke();
        }
    }

    // Horizontal Lanes
    for (let i = 1; i < LANE_COUNT * 2; i++) {
        let y = cy - ARM_WIDTH + i * LANE_WIDTH;
        if (i === LANE_COUNT) {
            ctx.strokeStyle = '#FFD700';
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(cx - ARM_WIDTH, y);
            ctx.moveTo(cx + ARM_WIDTH, y); ctx.lineTo(width, y);
            ctx.stroke();
            ctx.strokeStyle = '#FFF';
            ctx.setLineDash([20, 20]);
        } else {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(cx - ARM_WIDTH, y);
            ctx.moveTo(cx + ARM_WIDTH, y); ctx.lineTo(width, y);
            ctx.stroke();
        }
    }
    
    ctx.setLineDash([]);
    
    // Stop lines
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 4;
    
    // Bottom Incoming Stop Line
    ctx.beginPath();
    ctx.moveTo(cx, cy + ARM_WIDTH);
    ctx.lineTo(cx + ARM_WIDTH, cy + ARM_WIDTH);
    ctx.stroke();

    // Right Incoming Stop Line (Top Half)
    ctx.beginPath();
    ctx.moveTo(cx + ARM_WIDTH, cy);
    ctx.lineTo(cx + ARM_WIDTH, cy - ARM_WIDTH);
    ctx.stroke();

    // Top Incoming Stop Line
    ctx.beginPath();
    ctx.moveTo(cx, cy - ARM_WIDTH);
    ctx.lineTo(cx - ARM_WIDTH, cy - ARM_WIDTH);
    ctx.stroke();

    // Left Incoming Stop Line (Bottom Half)
    ctx.beginPath();
    ctx.moveTo(cx - ARM_WIDTH, cy);
    ctx.lineTo(cx - ARM_WIDTH, cy + ARM_WIDTH);
    ctx.stroke();
}

function drawLights() {
    // Positions for lights
    // 0: Bottom (Bottom-Right corner)
    drawLight(cx + ARM_WIDTH + 20, cy + ARM_WIDTH + 20, trafficLights[0].state);
    // 1: Right (Top-Right corner)
    drawLight(cx + ARM_WIDTH + 20, cy - ARM_WIDTH - 120, trafficLights[1].state);
    // 2: Top (Top-Left corner)
    drawLight(cx - ARM_WIDTH - 60, cy - ARM_WIDTH - 120, trafficLights[2].state);
    // 3: Left (Bottom-Left corner)
    drawLight(cx - ARM_WIDTH - 60, cy + ARM_WIDTH + 20, trafficLights[3].state);
}

function drawLight(x, y, state) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, 40, 100);
    
    // Red
    ctx.fillStyle = state === RED ? '#F00' : '#500';
    ctx.beginPath(); ctx.arc(x + 20, y + 20, 10, 0, Math.PI*2); ctx.fill();
    
    // Yellow
    ctx.fillStyle = state === YELLOW ? '#FF0' : '#550';
    ctx.beginPath(); ctx.arc(x + 20, y + 50, 10, 0, Math.PI*2); ctx.fill();
    
    // Green
    ctx.fillStyle = state === GREEN ? '#0F0' : '#050';
    ctx.beginPath(); ctx.arc(x + 20, y + 80, 10, 0, Math.PI*2); ctx.fill();
}

function updateLights() {
    // Acil durum kontrolü
    if (emergencyActive) {
        // Acil durum aracı hala sahnede mi kontrol et
        let emergencyCarExists = cars.some(c => c.isEmergency);
        
        if (!emergencyCarExists) {
            // Araç sahneden çıktı, normal döngüye dön
            emergencyActive = false;
            emergencyDirection = -1;
            lastTime = Date.now(); // Sayacı sıfırla
            sirenController.stopAll();
            
            // Mevcut yeşil ışığı ayarla (kaldığımız yerden veya sıfırdan)
            // Güvenlik için hepsini kırmızı yapıp döngüyü baştan başlatabiliriz
            for(let i=0; i<4; i++) trafficLights[i].state = RED;
            trafficLights[currentGreen].state = GREEN;
        } else {
            // Acil durum devam ediyor, ışıkları zorla
            for(let i=0; i<4; i++) {
                if (i === emergencyDirection) {
                    trafficLights[i].state = GREEN;
                } else {
                    trafficLights[i].state = RED;
                }
            }
            return; // Normal döngüyü atla
        }
    }

    let now = Date.now();
    if (now - lastTime > settings.lightDuration) {
        lastTime = now;
        
        // Rotate Green: 0 -> 1 -> 2 -> 3 (Counter-clockwise around intersection)
        // Bottom -> Right -> Top -> Left
        
        // Set current to Red
        trafficLights[currentGreen].state = RED;
        
        // Move to next
        currentGreen = (currentGreen + 1) % 4;
        
        // Set next to Green
        trafficLights[currentGreen].state = GREEN;
    }
}

function updateStats() {
    document.getElementById('car-count').textContent = cars.length;
    document.getElementById('fps').textContent = fps;
}

function loop() {
    if (!isPaused) {
        ctx.clearRect(0, 0, width, height);
        
        drawRoads();
        drawLaneHighlights(); // Tıklanabilir alanları göster
        updateLights();
        drawLights();
        
        if (Math.random() < settings.trafficDensity) spawnCar();
        
        for (let i = cars.length - 1; i >= 0; i--) {
            const car = cars[i];
            car.update();
            if (!car.removed) {
                car.draw();
            }
            if (car.removed) {
                if (car.isEmergency) {
                    sirenController.stop(car.id);
                }
                cars.splice(i, 1);
            }
        }

        // Seçim modu görselleştirmesi
        if (pendingEmergencyType) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.font = '30px Arial';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFF';
            ctx.fillText('Lütfen aracın geleceği şeride tıklayın', width/2, height/2);
            ctx.restore();
        }
    }

    // FPS Calculation
    frameCount++;
    let now = Date.now();
    if (now - lastFpsTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsTime = now;
        updateStats();
    }
    
    requestAnimationFrame(loop);
}

// ==================== UI KONTROL PANELİ ====================

// Trafik Yoğunluğu
document.getElementById('traffic-density').addEventListener('input', (e) => {
    settings.trafficDensity = e.target.value / 100;
    document.getElementById('density-value').textContent = e.target.value + '%';
});

// Işık Süresi
document.getElementById('light-duration').addEventListener('input', (e) => {
    settings.lightDuration = e.target.value * 1000;
    document.getElementById('duration-value').textContent = e.target.value + 's';
});

// Araç Hızı
document.getElementById('car-speed').addEventListener('input', (e) => {
    settings.carSpeedMultiplier = parseFloat(e.target.value);
    document.getElementById('speed-value').textContent = e.target.value + 'x';
});

// Hızlanma
document.getElementById('car-acceleration').addEventListener('input', (e) => {
    settings.acceleration = parseFloat(e.target.value);
    document.getElementById('acceleration-value').textContent = e.target.value;
});

// Çarpışma Mesafesi
document.getElementById('collision-distance').addEventListener('input', (e) => {
    settings.collisionDistance = parseInt(e.target.value);
    document.getElementById('collision-value').textContent = e.target.value + 'px';
});

// Duraklat/Devam Et
document.getElementById('pause-btn').addEventListener('click', () => {
    isPaused = !isPaused;
    const btn = document.getElementById('pause-btn');
    if (isPaused) {
        btn.textContent = 'Devam Et';
        btn.classList.add('paused');
        sirenController.setPaused(true);
    } else {
        btn.textContent = 'Duraklat';
        btn.classList.remove('paused');
        sirenController.setPaused(false);
    }
});

// Sıfırla
document.getElementById('reset-btn').addEventListener('click', () => {
    cars = [];
    trafficLights = [
        { state: GREEN, timer: 0 },
        { state: RED, timer: 0 },
        { state: RED, timer: 0 },
        { state: RED, timer: 0 }
    ];
    currentGreen = 0;
    lastTime = Date.now();
    isPaused = false;
    document.getElementById('pause-btn').textContent = 'Duraklat';
    document.getElementById('pause-btn').classList.remove('paused');
    pendingEmergencyType = null;
    canvas.style.cursor = 'default';
    sirenController.stopAll();
    updateStats();
});

loop();

function drawLaneHighlights() {
    if (!pendingEmergencyType) return;

    ctx.save();
    // Yanıp sönen efekt
    let alpha = 0.3 + Math.sin(Date.now() / 150) * 0.15;
    
    // Seçilen araca göre renk
    if (pendingEmergencyType === 'ambulance') {
        ctx.fillStyle = `rgba(231, 76, 60, ${alpha})`; // Kırmızımsı
        ctx.strokeStyle = `rgba(231, 76, 60, ${alpha + 0.3})`;
    } else if (pendingEmergencyType === 'police') {
        ctx.fillStyle = `rgba(52, 152, 219, ${alpha})`; // Mavi
        ctx.strokeStyle = `rgba(52, 152, 219, ${alpha + 0.3})`;
    } else {
        ctx.fillStyle = `rgba(243, 156, 18, ${alpha})`; // Turuncu
        ctx.strokeStyle = `rgba(243, 156, 18, ${alpha + 0.3})`;
    }
    
    ctx.lineWidth = 3;

    // Helper
    function highlight(x, y, w, h) {
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    }

    // 0: Bottom Incoming (Right side)
    highlight(cx, cy + ARM_WIDTH, ARM_WIDTH, height - (cy + ARM_WIDTH));

    // 1: Right Incoming (Top side)
    highlight(cx + ARM_WIDTH, cy - ARM_WIDTH, width - (cx + ARM_WIDTH), ARM_WIDTH);

    // 2: Top Incoming (Left side)
    highlight(cx - ARM_WIDTH, 0, ARM_WIDTH, cy - ARM_WIDTH);

    // 3: Left Incoming (Bottom side)
    highlight(0, cy, cx - ARM_WIDTH, ARM_WIDTH);

    // Şerit çizgilerini belirginleştir
    ctx.beginPath();
    // Bottom
    for(let i=1; i<3; i++) {
        let x = cx + i * LANE_WIDTH;
        ctx.moveTo(x, cy + ARM_WIDTH); ctx.lineTo(x, height);
    }
    // Right
    for(let i=1; i<3; i++) {
        let y = cy - i * LANE_WIDTH;
        ctx.moveTo(cx + ARM_WIDTH, y); ctx.lineTo(width, y);
    }
    // Top
    for(let i=1; i<3; i++) {
        let x = cx - i * LANE_WIDTH;
        ctx.moveTo(x, 0); ctx.lineTo(x, cy - ARM_WIDTH);
    }
    // Left
    for(let i=1; i<3; i++) {
        let y = cy + i * LANE_WIDTH;
        ctx.moveTo(0, y); ctx.lineTo(cx - ARM_WIDTH, y);
    }
    ctx.stroke();
    ctx.restore();
}

