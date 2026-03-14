const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gameContainer = document.getElementById('game-container');

// Game state UI elements
const scoreEl = document.getElementById('score');
const turnsEl = document.getElementById('turns');
const gameOverModal = document.getElementById('game-over-modal');
const endTitleEl = document.getElementById('end-title');
const bonusInfoEl = document.getElementById('bonus-info');
const finalScoreEl = document.getElementById('final-score');
const leaderboardList = document.getElementById('leaderboard-list');
const restartBtn = document.getElementById('restart-btn');
const rulesBtn = document.getElementById('rules-btn');
const rulesModal = document.getElementById('rules-modal');
const closeRulesBtn = document.getElementById('close-rules-btn');
const leaderboardBtn = document.getElementById('leaderboard-btn');
const leaderboardModalStandalone = document.getElementById('leaderboard-modal-standalone');
const closeLeaderboardBtn = document.getElementById('close-leaderboard-btn');
const standaloneLeaderboardList = document.getElementById('standalone-leaderboard-list');

// ============================================================
// DYNAMIC DIMENSIONS — calculated from actual viewport
// ============================================================
let CANVAS_WIDTH, CANVAS_HEIGHT;
let ARENA_X, ARENA_Y, ARENA_RADIUS;
let MARBLE_RADIUS;
let MAX_DRAG_DIST;

const FRICTION = 0.985;
const POWER_MULTIPLIER = 0.15;
const MAX_TURNS = 10;

function calcDimensions() {
    CANVAS_WIDTH  = window.innerWidth;
    CANVAS_HEIGHT = window.innerHeight;
    canvas.width  = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    ARENA_X = CANVAS_WIDTH  / 2;
    ARENA_Y = CANVAS_HEIGHT / 2;

    const maxByWidth  = CANVAS_WIDTH  * 0.42;
    const maxByHeight = CANVAS_HEIGHT * 0.32;
    ARENA_RADIUS = Math.round(Math.min(maxByWidth, maxByHeight, 280));

    MARBLE_RADIUS = Math.max(8, Math.round(ARENA_RADIUS / 13));
    MAX_DRAG_DIST = ARENA_RADIUS * 0.85;
}

calcDimensions();

// ============================================================
// GAME STATE
// ============================================================
let gameState = 'MENU'; // MENU, IDLE, AIMING, MOVING, GAMEOVER
let marbles = [];
let cueMarble = null;
let numPlayers = 1;
let currentPlayer = 1;
let playerScores = [0, 0];
let turnsLeft = MAX_TURNS;

let mouseX = 0;
let mouseY = 0;
let isDragging = false;

// Vector helper
class Vector {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(v) { return new Vector(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vector(this.x - v.x, this.y - v.y); }
    mult(n) { return new Vector(this.x * n, this.y * n); }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    copy() { return new Vector(this.x, this.y); }
    normalize() {
        const m = this.mag();
        return m !== 0 ? new Vector(this.x / m, this.y / m) : new Vector(0, 0);
    }
    dist(v) { return this.sub(v).mag(); }
}

class Marble {
    constructor(x, y, color, isCue = false) {
        this.pos = new Vector(x, y);
        this.vel = new Vector(0, 0);
        this.radius = MARBLE_RADIUS;
        this.color = color;
        this.isCue = isCue;
        this.mass = 1;
        this.active = true;
    }

    update() {
        if (!this.active) return;
        this.pos = this.pos.add(this.vel);
        this.vel = this.vel.mult(FRICTION);
        if (this.vel.mag() < 0.1) this.vel = new Vector(0, 0);
    }

    draw(ctx) {
        if (!this.active) return;
        ctx.beginPath();
        ctx.arc(this.pos.x + 3, this.pos.y + 3, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();

        let gradient = ctx.createRadialGradient(
            this.pos.x - this.radius/3, this.pos.y - this.radius/3, this.radius/10,
            this.pos.x, this.pos.y, this.radius
        );
        if (this.isCue) {
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.3, '#eeeeee');
            gradient.addColorStop(1, '#999999');
        } else {
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.3, this.color);
            gradient.addColorStop(1, '#000000');
        }

        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(this.pos.x - this.radius/3, this.pos.y - this.radius/3, this.radius/3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function initGame(players = 1) {
    numPlayers = players;
    currentPlayer = 1;
    playerScores = [0, 0];
    turnsLeft = MAX_TURNS;
    marbles = [];
    calcDimensions();
    initBackground();
    
    // Pattern: 1 in center, 6 in hexagon
    const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
    marbles.push(new Marble(ARENA_X, ARENA_Y, colors[0]));
    const hexRadius = MARBLE_RADIUS * 2.5;
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        marbles.push(new Marble(
            ARENA_X + Math.cos(angle) * hexRadius,
            ARENA_Y + Math.sin(angle) * hexRadius,
            colors[(i % 5) + 1]
        ));
    }
    resetCueMarble();
    
    gameState = 'IDLE';
    updateUI();
    document.getElementById('mode-chooser').classList.add('hidden');
    gameOverModal.classList.add('hidden');
}

function resetCueMarble() {
    const cubeStartY = ARENA_Y + ARENA_RADIUS + MARBLE_RADIUS * 4;
    cueMarble = new Marble(ARENA_X, cubeStartY, '#fff', true);
    marbles.push(cueMarble);
}

// ============================================================
// BACKGROUND
// ============================================================
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');

function initBackground() {
    const W = CANVAS_WIDTH;
    const H = CANVAS_HEIGHT;
    bgCanvas.width  = W;
    bgCanvas.height = H;
    const TILE_SIZE = Math.round(Math.min(W, H) / 8);
    
    bgCtx.fillStyle = '#3a3a3a'; 
    bgCtx.fillRect(0, 0, W, H);
    
    for (let x = 0; x < W; x += TILE_SIZE) {
        for (let y = 0; y < H; y += TILE_SIZE) {
            const bv = Math.random() * 8 - 4;
            bgCtx.fillStyle = `rgb(${205 + bv}, ${100 + bv}, ${55 + bv})`;
            bgCtx.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            
            bgCtx.fillStyle = 'rgba(120, 100, 80, 0.15)';
            for (let j = 0; j < 4; j++) {
                bgCtx.beginPath();
                bgCtx.arc(x + 2 + Math.random()*(TILE_SIZE-10), y + 2 + Math.random()*(TILE_SIZE-10), Math.random()*(TILE_SIZE*0.25)+4, 0, Math.PI*2);
                bgCtx.fill();
            }
            bgCtx.fillStyle = 'rgba(0,0,0,0.2)';
            for (let i = 0; i < 40; i++) bgCtx.fillRect(x + 2 + Math.random()*(TILE_SIZE-4), y + 2 + Math.random()*(TILE_SIZE-4), 1.5, 1.5);
            bgCtx.strokeStyle = 'rgba(0,0,0,0.1)';
            bgCtx.lineWidth = 1.5;
            bgCtx.beginPath();
            for (let j = 0; j < 2; j++) {
                const sx = x + Math.random()*TILE_SIZE, sy = y + Math.random()*TILE_SIZE;
                bgCtx.moveTo(sx, sy);
                bgCtx.lineTo(sx + (Math.random()-0.5)*18, sy + (Math.random()-0.5)*18 + 8);
            }
            bgCtx.stroke();
            bgCtx.fillStyle = 'rgba(255,255,255,0.2)';
            bgCtx.fillRect(x+1, y+1, TILE_SIZE-2, 2);
            bgCtx.fillRect(x+1, y+1, 2, TILE_SIZE-2);
            bgCtx.fillStyle = 'rgba(0,0,0,0.3)';
            bgCtx.fillRect(x+1, y+TILE_SIZE-3, TILE_SIZE-2, 2);
            bgCtx.fillRect(x+TILE_SIZE-3, y+1, 2, TILE_SIZE-2);
        }
    }
}

function handleResize() {
    const oldR = ARENA_RADIUS, oldX = ARENA_X, oldY = ARENA_Y;
    calcDimensions();
    initBackground();
    if (gameState !== 'MENU') {
        const scale = ARENA_RADIUS / oldR;
        marbles.forEach(m => {
            m.pos.x = ARENA_X + (m.pos.x - oldX) * scale;
            m.pos.y = ARENA_Y + (m.pos.y - oldY) * scale;
            m.radius = MARBLE_RADIUS;
        });
        if (cueMarble && (gameState === 'IDLE' || gameState === 'AIMING')) {
            cueMarble.pos.x = ARENA_X;
            cueMarble.pos.y = ARENA_Y + ARENA_RADIUS + MARBLE_RADIUS * 4;
        }
    }
}

initBackground();
window.addEventListener('resize', () => {
    clearTimeout(window._resTimer);
    window._resTimer = setTimeout(handleResize, 150);
});

function drawArena() {
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.beginPath();
    ctx.arc(ARENA_X, ARENA_Y, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; 
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ARENA_X, ARENA_Y, ARENA_RADIUS - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawAimLine() {
    if ((gameState !== 'AIMING' && gameState !== 'IDLE') || !cueMarble) return;
    let dragDiff = new Vector(mouseX - cueMarble.pos.x, mouseY - cueMarble.pos.y);
    let dist = Math.min(MAX_DRAG_DIST, dragDiff.mag());
    if (gameState === 'AIMING' && dist > 5) {
        let aimVector = dragDiff.mult(-1).normalize().mult(dist * 2);
        ctx.beginPath();
        ctx.moveTo(cueMarble.pos.x, cueMarble.pos.y);
        ctx.lineTo(cueMarble.pos.x + aimVector.x, cueMarble.pos.y + aimVector.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    drawCatPaws(mouseX, mouseY, cueMarble.pos.x, cueMarble.pos.y, cueMarble.radius, dist);
}

function drawCatPaws(mx, my, cx, cy, radius, pullDist) {
    const angle = Math.atan2(cy - my, cx - mx);
    const s = radius;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Left Paw (Bridge)
    ctx.save();
    ctx.translate(0, s * 2.5);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-s*2.5, s*6); ctx.lineTo(s*1.5, s*6); ctx.lineTo(s*1.2, 0); ctx.lineTo(-s*1.2, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, s*1.5, s*1.1, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = s*0.15; ctx.stroke();
    // Grip
    ctx.save();
    ctx.translate(0, -s*1.8);
    ctx.beginPath(); ctx.roundRect(-s*0.5, -s*0.2, s, s*1.5, s*0.5); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();

    // Pulled Ball
    const px = -pullDist;
    const worldX = cx + Math.cos(angle)*px;
    const worldY = cy + Math.sin(angle)*px;
    ctx.restore(); // back to world
    ctx.save();
    const oldP = cueMarble.pos.copy();
    cueMarble.pos = new Vector(worldX, worldY);
    cueMarble.draw(ctx);
    cueMarble.pos = oldP;
    
    // Right Paw
    ctx.translate(worldX, worldY);
    ctx.rotate(angle);
    ctx.fillStyle = '#f4a460';
    ctx.beginPath(); ctx.rect(-s*8, -s*1.2, s*7.5, s*2.4); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-s*1.4, 0, s*1.15, s*1.6, 0, 0, Math.PI*2); ctx.fill();
    ctx.stroke();
    // Fingers
    const drawF = (bx, by) => {
        ctx.beginPath(); ctx.arc(bx, by, s*0.5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    };
    drawF(0, -s*1.2); drawF(0, s*1.2);
    ctx.restore();
}

function checkCollisions() {
    for (let i = 0; i < marbles.length; i++) {
        for (let j = i + 1; j < marbles.length; j++) {
            let m1 = marbles[i], m2 = marbles[j];
            if (!m1.active || !m2.active) continue;
            let dist = m1.pos.dist(m2.pos);
            if (dist < m1.radius + m2.radius) {
                // simple separation
                const overlap = (m1.radius + m2.radius) - dist;
                const push = m1.pos.sub(m2.pos).normalize().mult(overlap/2);
                m1.pos = m1.pos.add(push); m2.pos = m2.pos.sub(push);
                // resolve
                const normal = m1.pos.sub(m2.pos).normalize();
                const relVel = m1.vel.sub(m2.vel);
                const speed = relVel.x * normal.x + relVel.y * normal.y;
                if (speed < 0) {
                    const impulse = normal.mult(speed * 0.95);
                    m1.vel = m1.vel.sub(impulse); m2.vel = m2.vel.add(impulse);
                }
            }
        }
    }
}

function checkArenaBounds() {
    marbles.forEach(m => {
        if (!m.active) return;
        if (m.pos.dist(new Vector(ARENA_X, ARENA_Y)) > ARENA_RADIUS + m.radius) {
            if (!m.isCue) { playerScores[currentPlayer-1] += 100; m.active = false; updateUI(); }
        }
        if (m.pos.x < m.radius || m.pos.x > CANVAS_WIDTH - m.radius) m.vel.x *= -0.6;
        if (m.pos.y < m.radius || m.pos.y > CANVAS_HEIGHT - m.radius) m.vel.y *= -0.6;
    });
}

function updateUI() {
    const p1s = playerScores[0], p2s = playerScores[1];
    turnsEl.innerText = turnsLeft;
    const pi = document.getElementById('player-indicator');
    const p2r = document.getElementById('score-p2-row');
    const p1r = document.querySelector('#score-board p:nth-of-type(2)');
    if (numPlayers === 2) {
        pi.classList.remove('hidden'); pi.textContent = `\u{1F3AE} P${currentPlayer}`;
        p2r.classList.remove('hidden'); document.getElementById('score-p2').innerText = p2s;
        if (p1r) p1r.childNodes[0].textContent = "P1: ";
        scoreEl.innerText = p1s;
    } else {
        pi.classList.add('hidden'); p2r.classList.add('hidden');
        if (p1r) p1r.childNodes[0].textContent = "\u0110i\u1EC3m: ";
        scoreEl.innerText = p1s;
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (gameState !== 'MENU') {
        drawArena();
        let moving = false;
        marbles = marbles.filter(m => m.active);
        marbles.forEach(m => {
            if (gameState === 'MOVING') { m.update(); if (m.vel.mag() > 0.1) moving = true; }
            if (!((gameState === 'AIMING' || gameState === 'IDLE') && m.isCue)) m.draw(ctx);
        });
        if (gameState === 'MOVING') {
            checkCollisions(); checkArenaBounds();
            if (!moving) {
                turnsLeft--;
                const cue = marbles.find(m => m.isCue);
                if (cue && cue.pos.dist(new Vector(ARENA_X, ARENA_Y)) > ARENA_RADIUS + cue.radius) {
                    playerScores[currentPlayer-1] -= 50; cue.active = false;
                }
                updateUI();
                if (turnsLeft <= 0 || marbles.filter(m => !m.isCue).length === 0) endGame();
                else {
                    if (numPlayers === 2) currentPlayer = currentPlayer === 1 ? 2 : 1;
                    gameState = 'IDLE';
                    if (!marbles.find(m => m.isCue)) resetCueMarble();
                    updateUI();
                }
            }
        }
        drawAimLine();
    }
    requestAnimationFrame(gameLoop);
}

function handlePointerDown(cx, cy) {
    if (gameState !== 'IDLE' || !cueMarble) return;
    const rect = canvas.getBoundingClientRect();
    const x = (cx - rect.left) * (canvas.width/rect.width);
    const y = (cy - rect.top) * (canvas.height/rect.height);
    if (new Vector(x, y).dist(cueMarble.pos) < MARBLE_RADIUS * 4) {
        isDragging = true; gameState = 'AIMING'; mouseX = x; mouseY = y;
    }
}
function handlePointerMove(cx, cy) {
    const rect = canvas.getBoundingClientRect();
    mouseX = (cx - rect.left) * (canvas.width/rect.width);
    mouseY = (cy - rect.top) * (canvas.height/rect.height);
}
function handlePointerUp() {
    if (!isDragging || gameState !== 'AIMING') return;
    isDragging = false;
    let diff = new Vector(mouseX - cueMarble.pos.x, mouseY - cueMarble.pos.y);
    if (diff.mag() > MAX_DRAG_DIST) diff = diff.normalize().mult(MAX_DRAG_DIST);
    if (diff.mag() > 5) { cueMarble.vel = diff.mult(-POWER_MULTIPLIER); gameState = 'MOVING'; }
    else gameState = 'IDLE';
}

canvas.addEventListener('mousedown', e => handlePointerDown(e.clientX, e.clientY));
window.addEventListener('mousemove', e => handlePointerMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handlePointerUp);
canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; handlePointerDown(t.clientX, t.clientY); }, {passive:false});
canvas.addEventListener('touchmove', e => { e.preventDefault(); const t = e.touches[0]; handlePointerMove(t.clientX, t.clientY); }, {passive:false});
canvas.addEventListener('touchend', handlePointerUp);

const LEADERBOARD_KEY = 'banBiLeaderboard';
function saveScore(s) {
    let list = JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
    list.push({score: s, date: new Date().toLocaleDateString()});
    list.sort((a, b) => b.score - a.score);
    list = list.slice(0, 5);
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
    return list;
}
function updateLeaderboardUI(list) {
    const html = list.map((e, i) => `<li>\u003cspan\u003e#${i+1}\u003c/span\u003e \u003cspan\u003e${e.score}\u003c/span\u003e \u003cspan\u003e${e.date}\u003c/span\u003e</li>`).join('');
    leaderboardList.innerHTML = html; standaloneLeaderboardList.innerHTML = html;
}

function endGame() {
    gameState = 'GAMEOVER';
    if (numPlayers === 1) {
        const win = marbles.filter(m => !m.isCue).length === 0;
        const bonus = win ? turnsLeft * 50 : 0;
        playerScores[0] += bonus;
        endTitleEl.innerText = win ? "CHI\u1EBEN TH\u1EA0NG!" : "H\u1EBET L\u01AF\u1EE2T!";
        bonusInfoEl.innerText = win ? `Th\u01B0\u1EDFng l\u01B0\u1EE2t th\u1EEBa: +${bonus}` : "";
        bonusInfoEl.classList.toggle('hidden', !win);
        finalScoreEl.innerText = playerScores[0];
        updateLeaderboardUI(saveScore(playerScores[0]));
    } else {
        const p1 = playerScores[0], p2 = playerScores[1];
        endTitleEl.innerText = p1 > p2 ? "P1 TH\u1EA0NG!" : p2 > p1 ? "P2 TH\u1EA0NG!" : "H\u00D2A NHAU!";
        document.getElementById('scores-summary').innerHTML = `<p>P1: ${p1}</p><p>P2: ${p2}</p>`;
    }
    gameOverModal.classList.remove('hidden');
}

document.getElementById('btn-1p').addEventListener('click', () => initGame(1));
document.getElementById('btn-2p').addEventListener('click', () => initGame(2));
restartBtn.addEventListener('click', () => { gameState = 'MENU'; document.getElementById('mode-chooser').classList.remove('hidden'); gameOverModal.classList.add('hidden'); });
rulesBtn.addEventListener('click', () => rulesModal.classList.remove('hidden'));
closeRulesBtn.addEventListener('click', () => rulesModal.classList.add('hidden'));
leaderboardBtn.addEventListener('click', () => { updateLeaderboardUI(JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || []); leaderboardModalStandalone.classList.remove('hidden'); });
closeLeaderboardBtn.addEventListener('click', () => leaderboardModalStandalone.classList.add('hidden'));

gameLoop();
