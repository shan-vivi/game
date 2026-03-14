const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gameContainer = document.getElementById('game-container');

// Game state UI elements
const scoreEl = document.getElementById('score');
const turnsEl = document.getElementById('turns');
const gameOverModal = document.getElementById('game-over-modal');
const endTitleEl = document.getElementById('end-title');
const bonusInfoEl = document.getElementById('bonus-info');
const scoresSummaryEl = document.getElementById('scores-summary');
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

    const isLandscape = CANVAS_WIDTH > CANVAS_HEIGHT;

    // Chiều rộng đấu trường
    const maxByWidth  = CANVAS_WIDTH  * (isLandscape ? 0.35 : 0.42);
    const maxByHeight = CANVAS_HEIGHT * (isLandscape ? 0.28 : 0.32);
    ARENA_RADIUS = Math.round(Math.min(maxByWidth, maxByHeight, 280));

    ARENA_X = CANVAS_WIDTH / 2;
    
    // Ở màn hình ngang, đẩy tâm Arena lên một chút để chừa chỗ kéo bi ở dưới
    if (isLandscape) {
        ARENA_Y = CANVAS_HEIGHT * 0.42; 
    } else {
        ARENA_Y = CANVAS_HEIGHT / 2;
    }

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
let playerTurns = [MAX_TURNS, MAX_TURNS];

let mouseX = 0;
let mouseY = 0;
let isDragging = false;
let turnNotifyTimer = 0; // Timer for turn transition effect

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
    playerTurns = [MAX_TURNS, MAX_TURNS];
    marbles = [];
    calcDimensions();
    initBackground();
    
    // Pattern: 1 in center, 6 in hexagon
    const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
    marbles.push(new Marble(ARENA_X, ARENA_Y, colors[0]));
    
    // Vòng 1: 6 bi
    const hexRadius1 = MARBLE_RADIUS * 2.5;
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        marbles.push(new Marble(
            ARENA_X + Math.cos(angle) * hexRadius1,
            ARENA_Y + Math.sin(angle) * hexRadius1,
            colors[(i % 5) + 1]
        ));
    }

    // Nếu 2 người chơi, thêm vòng 2: 6 bi nữa (tổng 13 bi)
    if (numPlayers === 2) {
        const hexRadius2 = MARBLE_RADIUS * 4.5;
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i + (Math.PI / 6);
            marbles.push(new Marble(
                ARENA_X + Math.cos(angle) * hexRadius2,
                ARENA_Y + Math.sin(angle) * hexRadius2,
                colors[5 - (i % 5)]
            ));
        }
    }

    resetCueMarble();
    
    gameState = 'IDLE';
    updateUI();
    document.getElementById('mode-chooser').classList.add('hidden');
    gameOverModal.classList.add('hidden');
    
    if (numPlayers === 2) showTurnNotify(`Lượt: P${currentPlayer}`);
}

function resetCueMarble() {
    // Đặt bi cái cách tâm vòng tròn một khoảng tỉ lệ
    const distance = ARENA_RADIUS + MARBLE_RADIUS * 4.5;
    let cubeStartY = ARENA_Y + distance;
    
    // Đảm bảo bi cái luôn nằm trên mép dưới ít nhất một khoảng MAX_DRAG_DIST 
    // để người chơi có đủ room kéo lùi tăng lực bắn
    const minBottomMargin = MAX_DRAG_DIST + MARBLE_RADIUS * 2;
    if (cubeStartY > CANVAS_HEIGHT - minBottomMargin) {
        cubeStartY = CANVAS_HEIGHT - minBottomMargin;
    }
    
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
    
    // Tính toán hướng và lực kéo dựa trên cursor
    let dragDiff = new Vector(mouseX - cueMarble.pos.x, mouseY - cueMarble.pos.y);
    let currentDist = dragDiff.mag();
    let pullDist = (gameState === 'AIMING') ? Math.min(MAX_DRAG_DIST, currentDist) : 0;

    if (gameState === 'AIMING' && pullDist > 5) {
        // Đường dự báo (trajectory)
        let aimVector = dragDiff.mult(-1).normalize().mult(pullDist * 2);
        ctx.beginPath();
        ctx.moveTo(cueMarble.pos.x, cueMarble.pos.y);
        ctx.lineTo(cueMarble.pos.x + aimVector.x, cueMarble.pos.y + aimVector.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Vẽ tay mèo chầu chực (IDLE) hoặc đang kéo (AIMING)
    drawCatPaws(mouseX, mouseY, cueMarble.pos.x, cueMarble.pos.y, cueMarble.radius, pullDist);
}

function drawCatPaws(mx, my, cx, cy, radius, pullDist) {
    const angle = Math.atan2(cy - my, cx - mx);
    const s = radius;
    
    ctx.save();
    // 1. CHUẨN BỊ WORLD SPACE CHO BI CÁI
    const worldPullX = cx - Math.cos(angle) * pullDist;
    const worldPullY = cy - Math.sin(angle) * pullDist;
    
    // Vẽ Bi Cái tại vị trí đang kéo (hoặc vị trí gốc nếu pullDist=0)
    const originalPos = cueMarble.pos.copy();
    cueMarble.pos = new Vector(worldPullX, worldPullY);
    cueMarble.draw(ctx);
    cueMarble.pos = originalPos;

    // 2. VẼ TAY TRÁI (TAY TRẮNG - BRIDGE)
    // Tay này luôn ở vị trí bi cái gốc
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    
    // Dịch chuyển tay trái sang bên cạnh bi (lệch theo trục Y local)
    ctx.save();
    ctx.translate(0, s * 2.2);
    
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = s * 0.15;
    
    // Cánh tay
    ctx.beginPath();
    ctx.moveTo(-s * 4, s * 8); 
    ctx.lineTo(s * 2, s * 8); 
    ctx.lineTo(s * 1.5, 0); 
    ctx.lineTo(-s * 1.5, 0); 
    ctx.fill();
    
    // Lòng bàn chân
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.8, s * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Ngón tay duỗi (đặt lên bi)
    ctx.save();
    ctx.translate(0, -s * 2);
    ctx.beginPath();
    ctx.roundRect(-s * 0.5, 0, s, s * 1.5, s * 0.5);
    ctx.fill();
    ctx.stroke();
    // Đệm thịt
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.arc(0, s * 0.3, s * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Các ngón chân gập
    const drawToe = (tx, ty, tr) => {
        ctx.save();
        ctx.translate(tx, ty); ctx.rotate(tr);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(0, 0, s * 0.7, s * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffb6c1';
        ctx.beginPath(); ctx.arc(0, s * 0.1, s * 0.25, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    };
    drawToe(-s * 1.2, -s * 0.4, 0.4);
    drawToe(-s * 0.4, -s * 0.8, 0);
    drawToe( s * 0.6, -s * 0.7, -0.3);

    ctx.restore(); // Hết translate tay trái
    ctx.restore(); // Hết rotate/translate bi cái gốc

    // 3. VẼ TAY PHẢI (TAY CAM - PULL)
    // Tay này bám theo vị trí Bi Cái đang bị kéo
    ctx.save();
    ctx.translate(worldPullX, worldPullY);
    ctx.rotate(angle);
    
    ctx.fillStyle = '#f4a460';
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = s * 0.15;
    
    // Cánh tay cam (kéo dài ra sau)
    ctx.beginPath();
    ctx.rect(-s * 12, -s * 1.2, s * 11, s * 2.4);
    ctx.fill();
    
    // Bàn chân ôm bi
    ctx.beginPath();
    ctx.ellipse(-s * 1.5, 0, s * 1.6, s * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Đệm thịt lớn
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.ellipse(-s * 1.8, 0, s * 0.8, s * 1.2, 0, 0, Math.PI * 2); ctx.fill();

    // Ngón tay kẹp bi
    const drawClaw = (cx, cy) => {
        ctx.fillStyle = '#f4a460';
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffb6c1';
        ctx.beginPath(); ctx.arc(cx + s * 0.1, cy, s * 0.35, 0, Math.PI * 2); ctx.fill();
    };
    drawClaw(s * 0.2, -s * 1.3);
    drawClaw(-s * 0.8, -s * 1.8);
    drawClaw(s * 0.2, s * 1.3);
    drawClaw(-s * 0.8, s * 1.8);

    ctx.restore();
    ctx.restore(); // Back to world space
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
        
        const distToCenter = m.pos.dist(new Vector(ARENA_X, ARENA_Y));
        if (distToCenter > ARENA_RADIUS + m.radius) {
            if (!m.isCue) { 
                // Cộng điểm cho người chơi hiện tại khi bi con văng ra
                playerScores[currentPlayer - 1] += 100; 
                m.active = false; 
                updateUI(); 
            }
        }
        
        // Ranh giới màn hình (bật lại)
        if (m.pos.x < m.radius) { m.pos.x = m.radius; m.vel.x *= -0.6; }
        if (m.pos.x > CANVAS_WIDTH - m.radius) { m.pos.x = CANVAS_WIDTH - m.radius; m.vel.x *= -0.6; }
        if (m.pos.y < m.radius) { m.pos.y = m.radius; m.vel.y *= -0.6; }
        if (m.pos.y > CANVAS_HEIGHT - m.radius) { m.pos.y = CANVAS_HEIGHT - m.radius; m.vel.y *= -0.6; }
    });
}

function updateUI() {
    const p1s = playerScores[0], p2s = playerScores[1];
    turnsEl.innerText = playerTurns[currentPlayer - 1]; // Hiển thị lượt của người hiện tại
    const pi = document.getElementById('player-indicator');
    const p2r = document.getElementById('score-p2-row');
    const p1r = document.querySelector('#score-board p:nth-of-type(2)');
    
    if (numPlayers === 2) {
        pi.classList.remove('hidden'); 
        pi.textContent = `🎮 Lượt P${currentPlayer}`;
        pi.style.color = currentPlayer === 1 ? '#66ccff' : '#ff8844';
        
        p2r.classList.remove('hidden'); 
        document.getElementById('score-p2').innerText = p2s;
        
        if (p1r) {
            p1r.childNodes[0].textContent = "P1: ";
            // Highlight current player row
            p1r.style.background = currentPlayer === 1 ? 'rgba(102, 204, 255, 0.25)' : 'transparent';
            p1r.style.borderLeft = currentPlayer === 1 ? '4px solid #66ccff' : 'none';
            p1r.style.paddingLeft = currentPlayer === 1 ? '10px' : '0px';
        }
        
        if (p2r) {
            p2r.style.background = currentPlayer === 2 ? 'rgba(255, 136, 68, 0.25)' : 'transparent';
            p2r.style.borderLeft = currentPlayer === 2 ? '4px solid #ff8844' : 'none';
            p2r.style.paddingLeft = currentPlayer === 2 ? '10px' : '0px';
        }
        
        scoreEl.innerText = p1s;
    } else {
        pi.classList.add('hidden'); 
        p2r.classList.add('hidden');
        if (p1r) {
            p1r.childNodes[0].textContent = "Điểm: ";
            p1r.style.background = 'transparent';
            p1r.style.borderLeft = 'none';
            p1r.style.paddingLeft = '0';
        }
        scoreEl.innerText = p1s;
    }
}

function showTurnNotify(text) {
    let notify = document.getElementById('turn-notify');
    if (!notify) {
        notify = document.createElement('div');
        notify.id = 'turn-notify';
        notify.style.cssText = `
            position: fixed; top: 30%; left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.85);
            color: #ffcc00;
            padding: 20px 40px;
            border-radius: 60px;
            font-family: 'VT323', monospace;
            font-size: clamp(30px, 8vmin, 50px);
            border: 4px solid #ffcc00;
            z-index: 1000;
            pointer-events: none;
            text-shadow: 2px 2px 0 #000;
            box-shadow: 0 0 30px rgba(0,0,0,0.6);
            transition: opacity 0.4s, transform 0.4s;
            opacity: 0;
        `;
        document.body.appendChild(notify);
    }
    
    notify.textContent = text;
    notify.style.opacity = '1';
    notify.style.transform = 'translate(-50%, -50%) scale(1.1)';
    
    clearTimeout(turnNotifyTimer);
    turnNotifyTimer = setTimeout(() => {
        notify.style.opacity = '0';
        notify.style.transform = 'translate(-50%, -50%) scale(0.9)';
    }, 1500);
}

function gameLoop() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (gameState !== 'MENU') {
        drawArena();
        let moving = false;
        
        // Cập nhật và lọc bi còn hoạt động
        marbles = marbles.filter(m => m.active);
        
        for (let m of marbles) {
            if (gameState === 'MOVING') { 
                m.update(); 
                if (m.vel.mag() > 0.1) moving = true; 
            }
            
            // Nếu là bi cái và đang ở trạng thái ngắm/chờ, SKIP vì drawAimLine sẽ vẽ nó (để bi co giãn theo tay)
            if ((gameState === 'AIMING' || gameState === 'IDLE') && m.isCue) continue;
            
            m.draw(ctx);
        }

        if (gameState === 'MOVING') {
            checkCollisions(); 
            checkArenaBounds();
            
            if (!moving) {
                const activeMarbles = marbles.filter(m => m.active);
                
                playerTurns[currentPlayer - 1]--;
                
                // Kiểm tra bi cái
                const cue = activeMarbles.find(m => m.isCue);
                if (cue) {
                    const distToCenter = cue.pos.dist(new Vector(ARENA_X, ARENA_Y));
                    if (distToCenter > ARENA_RADIUS + cue.radius) {
                        playerScores[currentPlayer - 1] -= 50;
                        cue.active = false;
                    }
                }
                
                updateUI();

                const targetMarblesLeft = activeMarbles.filter(m => !m.isCue && m.active).length;
                const allOutTurns = numPlayers === 1 ? (playerTurns[0] <= 0) : (playerTurns[0] <= 0 && playerTurns[1] <= 0);
                
                if (targetMarblesLeft === 0 || allOutTurns) {
                    endGame();
                } else {
                    if (numPlayers === 2) {
                        const nextPlayer = (currentPlayer === 1) ? 2 : 1;
                        if (playerTurns[nextPlayer - 1] > 0) {
                            currentPlayer = nextPlayer;
                            showTurnNotify(`Đến lượt: P${currentPlayer}`);
                        } else {
                             showTurnNotify(`P${currentPlayer} bắn tiếp! (P${nextPlayer} hết lượt)`);
                        }
                    }
                    gameState = 'IDLE';
                    const stillActiveCue = marbles.find(m => m.isCue && m.active);
                    if (!stillActiveCue) resetCueMarble();
                    updateUI();
                }
            }
        }
        
        // Vẽ đường ngắm và tay mèo lên trên cùng
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
function saveScore(s, label = '') {
    let list = JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
    list.push({
        score: s, 
        label: label,
        date: new Date().toLocaleDateString()
    });
    list.sort((a, b) => b.score - a.score);
    list = list.slice(0, 5);
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
    return list;
}
function updateLeaderboardUI(list) {
    const html = list.map((e, i) => {
        return `<li>
            <span class="lb-idx">#${i+1}</span> 
            <span class="lb-label" style="color:#ffcc00">${e.label ? '('+e.label+')' : ''}</span>
            <span class="lb-score">${e.score}</span> 
            <span class="lb-date">${e.date}</span>
        </li>`;
    }).join('');
    leaderboardList.innerHTML = html; 
    standaloneLeaderboardList.innerHTML = html;
}

function endGame() {
    gameState = 'GAMEOVER';
    hideAllModals(); 
    
    const scoresSummary = document.getElementById('scores-summary');
    const allMarblesCleared = marbles.filter(m => !m.isCue && m.active).length === 0;

    if (numPlayers === 1) {
        const win = allMarblesCleared;
        const bonus = win ? playerTurns[0] * 50 : 0;
        playerScores[0] += bonus;
        
        endTitleEl.innerText = win ? "CHIẾN THẮNG!" : "HẾT LƯỢT!";
        endTitleEl.style.color = win ? "#44ff44" : "#ff4444";
        
        bonusInfoEl.innerText = win ? `Thưởng lượt dư: +${bonus}` : "";
        bonusInfoEl.classList.toggle('hidden', !win);
        
        scoresSummary.innerHTML = `<p style="font-size: 24px;">Tổng điểm: ${playerScores[0]}</p>`;
        updateLeaderboardUI(saveScore(playerScores[0]));
    } else {
        // Trong chế độ 2P:
        // - Người nào bắn văng viên bi cuối cùng (allMarblesCleared) sẽ được cộng điểm lượt dư của CHÍNH HỌ.
        // - Việc này khuyến khích người chơi tranh nhau bắn viên cuối cùng để lấy bonus.
        let bonusText = "";
        let bonus1 = 0, bonus2 = 0;
        
        if (allMarblesCleared) {
            // currentPlayer là người vừa thực hiện cú bắn thành công cuối cùng
            if (currentPlayer === 1) {
                bonus1 = playerTurns[0] * 50;
                playerScores[0] += bonus1;
                bonusText = `P1 được thưởng +${bonus1} điểm thắng sớm!`;
            } else {
                bonus2 = playerTurns[1] * 50;
                playerScores[1] += bonus2;
                bonusText = `P2 được thưởng +${bonus2} điểm thắng sớm!`;
            }
        } else {
            bonusText = "Cả hai đều đã hết lượt bắn!";
        }

        const p1 = playerScores[0];
        const p2 = playerScores[1];
        
        if (p1 > p2) {
            endTitleEl.innerText = "P1 CHIẾN THẮNG!";
            endTitleEl.style.color = "#66ccff";
        } else if (p2 > p1) {
            endTitleEl.innerText = "P2 CHIẾN THẮNG!";
            endTitleEl.style.color = "#ff8844";
        } else {
            endTitleEl.innerText = "HÒA NHAU!";
            endTitleEl.style.color = "#ffffff";
        }
        
        bonusInfoEl.innerText = bonusText;
        bonusInfoEl.classList.remove('hidden');
        
        scoresSummary.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; margin: 15px 0;">
                <div style="display:flex; justify-content:space-around; font-size:24px;">
                    <div style="color:#66ccff; text-align:center;">P1<br>${p1}</div>
                    <div style="color:#ff8844; text-align:center;">P2<br>${p2}</div>
                </div>
                ${bonus1 > 0 ? `<div style="color:#44ff44; font-size:16px;">(Đã bao gồm +${bonus1} của P1)</div>` : ""}
                ${bonus2 > 0 ? `<div style="color:#44ff44; font-size:16px;">(Đã bao gồm +${bonus2} của P2)</div>` : ""}
            </div>
        `;

        saveScore(p1, 'P1');
        const latestScores = saveScore(p2, 'P2');
        updateLeaderboardUI(latestScores);
    }
    
    gameOverModal.classList.remove('hidden');
}

// HÀM HỖ TRỢ ĐÓNG TẤT CẢ POPUP
function hideAllModals() {
    rulesModal.classList.add('hidden');
    leaderboardModalStandalone.classList.add('hidden');
    gameOverModal.classList.add('hidden');
}

document.getElementById('btn-1p').addEventListener('click', () => initGame(1));
document.getElementById('btn-2p').addEventListener('click', () => initGame(2));

restartBtn.addEventListener('click', () => { 
    hideAllModals();
    gameState = 'MENU'; 
    document.getElementById('mode-chooser').classList.remove('hidden'); 
});

rulesBtn.addEventListener('click', () => {
    hideAllModals();
    rulesModal.classList.remove('hidden');
});

closeRulesBtn.addEventListener('click', () => rulesModal.classList.add('hidden'));

leaderboardBtn.addEventListener('click', () => { 
    hideAllModals();
    updateLeaderboardUI(JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || []); 
    leaderboardModalStandalone.classList.remove('hidden'); 
});

closeLeaderboardBtn.addEventListener('click', () => leaderboardModalStandalone.classList.add('hidden'));

// Đóng popup bằng ESC
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideAllModals();
});

gameLoop();
