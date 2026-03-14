import './style.css';
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000'); // Kết nối tới server local
let myPlayerId = null;
let currentRoom = null;
let isOnlineMode = false;
let remoteAimingData = { active: false, x: 0, y: 0 }; // Dữ liệu ngắm của đối thủ

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gameContainer = document.getElementById('game-container');

// Game state UI elements
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

// New UI Elements
const modeSelection = document.getElementById('mode-selection');
const playerCountSetup = document.getElementById('player-count-setup');
const playerNamesSetup = document.getElementById('player-names-setup');
const playerCountSlider = document.getElementById('player-count-slider');
const countDisplay = document.getElementById('count-display');
const btnNextToNames = document.getElementById('btn-next-to-names');
const btnBackToMode = document.getElementById('btn-back-to-mode');
const btnStartGame = document.getElementById('btn-start-game');
const btnBackToCount = document.getElementById('btn-back-to-count');
const nameInputsContainer = document.getElementById('name-inputs-container');
const playerScoresList = document.getElementById('player-scores-list');
const btnMulti = document.getElementById('btn-multi');
const btnOnline = document.getElementById('btn-online');
const onlineSetup = document.getElementById('online-setup');
const btnBackFromOnline = document.getElementById('btn-back-from-online');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const roomIdInput = document.getElementById('room-id-input');
const onlineLobby = document.getElementById('online-lobby');
const lobbyRoomIdDisplay = document.getElementById('lobby-room-id');
const lobbyPlayersList = document.getElementById('lobby-players-list');
const btnStartOnlineGame = document.getElementById('btn-start-online-game');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');
const lobbyStatus = document.getElementById('lobby-status');

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
let playerScores = [];
let playerTurns = [];
let playerNames = [];
let playerColors = ['#66ccff', '#ff8844', '#ffcc00', '#44ff44', '#ff44ff', '#44ffff', '#ff5555', '#aaff00', '#00ffaa', '#ffaaff'];
let playerBoards = []; // To store marbles for each player
let playerCues = [];   // To store cueMarble reference for each player

let mouseX = 0;
let mouseY = 0;
let isDragging = false;
let turnNotifyTimer = 0; // Timer for turn transition effect
let isPlayoff = false;    // Whether we are in a tie-breaker round
let masterResults = [];   // To keep track of all players across rounds

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

// HELPER: Chuẩn hóa tọa độ để đồng bộ giữa các màn hình khác nhau
function getNormalized(v) {
    if (!v) return { nx: 0, ny: 0 };
    return {
        nx: (v.x - ARENA_X) / ARENA_RADIUS,
        ny: (v.y - ARENA_Y) / ARENA_RADIUS
    };
}
function fromNormalized(n) {
    return new Vector(
        ARENA_X + n.nx * ARENA_RADIUS,
        ARENA_Y + n.ny * ARENA_RADIUS
    );
}

class Marble {
    constructor(id, x, y, color, isCue = false) {
        this.id = id; // Unique ID for sync
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

function initGame(players = 1, names = []) {
    numPlayers = players;
    currentPlayer = 1;
    playerScores = new Array(numPlayers).fill(0);
    playerTurns = new Array(numPlayers).fill(MAX_TURNS);
    playerNames = names.length > 0 ? names : Array.from({length: numPlayers}, (_, i) => `P${i+1}`);
    
    playerBoards = [];
    playerCues = [];
    
    // Create a separate board for each player
    for (let p = 0; p < numPlayers; p++) {
        let currentMarbles = [];
        calcDimensions();
        
        // Use 1P layout (7 marbles total)
        const marbleColors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
        currentMarbles.push(new Marble(`${p}_target_0`, ARENA_X, ARENA_Y, marbleColors[0]));
        
        const ringRadius = MARBLE_RADIUS * 2.5;
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            currentMarbles.push(new Marble(
                `${p}_target_${i+1}`,
                ARENA_X + Math.cos(angle) * ringRadius,
                ARENA_Y + Math.sin(angle) * ringRadius,
                marbleColors[(i % 5) + 1]
            ));
        }

        const distance = ARENA_RADIUS + MARBLE_RADIUS * 4.5;
        let startY = ARENA_Y + distance;
        const minBottomMargin = MAX_DRAG_DIST + MARBLE_RADIUS * 2;
        if (startY > CANVAS_HEIGHT - minBottomMargin) startY = CANVAS_HEIGHT - minBottomMargin;
        
        const cue = new Marble(`${p}_cue`, ARENA_X, startY, '#fff', true);
        currentMarbles.push(cue);
        
        playerBoards[p] = currentMarbles;
        playerCues[p] = cue;
    }

    // Set initial active state to P1's board
    marbles = playerBoards[0];
    cueMarble = playerCues[0];
    
    initBackground();
    gameState = 'IDLE';
    updateUI();
    document.getElementById('mode-chooser').classList.add('hidden');
    gameOverModal.classList.add('hidden');
    
    showTurnNotify(isPlayoff ? `VÒNG PHỤ: ${playerNames[0]}` : `Lượt: ${playerNames[0]} (Sân riêng)`);
}

function startPlayoff(tiedNames, tiedColors) {
    isPlayoff = true;
    showTurnNotify("VÒNG ĐẤU PHỤ!");
    
    // In playoff, we only use the players who tied
    setTimeout(() => {
        initGame(tiedNames.length, tiedNames);
        // Overwrite colors to keep them consistent with original players
        playerColors = tiedColors;
        updateUI();
    }, 1600);
}

// Function to handle board switching
function switchPlayerBoard(nextIdxPlusOne) {
    const nextIdx = nextIdxPlusOne - 1;
    marbles = playerBoards[nextIdx];
    cueMarble = playerCues[nextIdx];
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
    if (gameState !== 'IDLE' && gameState !== 'AIMING') return;
    if (!cueMarble) return;

    const isMyTurn = !isOnlineMode || (currentPlayer - 1) === window.mySlotIndex;
    
    // Nếu là Online và không phải lượt mình, và đối thủ đang không ngắm -> Không vẽ gì
    if (isOnlineMode && !isMyTurn && !remoteAimingData.active) return;

    // Chọn dữ liệu tọa độ (từ mình hoặc từ đối thủ qua socket - đã giải mã chuẩn hóa)
    const targetX = isMyTurn ? mouseX : (ARENA_X + remoteAimingData.nx * ARENA_RADIUS);
    const targetY = isMyTurn ? mouseY : (ARENA_Y + remoteAimingData.ny * ARENA_RADIUS);
    const activeAiming = isMyTurn ? (gameState === 'AIMING') : remoteAimingData.active;

    // Tính toán hướng và lực kéo
    let dragDiff = new Vector(targetX - cueMarble.pos.x, targetY - cueMarble.pos.y);
    let currentDist = dragDiff.mag();
    let pullDist = activeAiming ? Math.min(MAX_DRAG_DIST, currentDist) : 0;

    if (activeAiming && pullDist > 5) {
        // Đường dự báo (trajectory)
        let aimVector = dragDiff.mult(-1).normalize().mult(pullDist * 2);
        ctx.beginPath();
        ctx.moveTo(cueMarble.pos.x, cueMarble.pos.y);
        ctx.lineTo(cueMarble.pos.x + aimVector.x, cueMarble.pos.y + aimVector.y);
        ctx.strokeStyle = isMyTurn ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 204, 0, 0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Vẽ tay mèo
    drawCatPaws(targetX, targetY, cueMarble.pos.x, cueMarble.pos.y, cueMarble.radius, pullDist);
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
    // Nếu hết game, hiển thị lượt là 0
    turnsEl.innerText = gameState === 'GAMEOVER' ? '0' : playerTurns[currentPlayer - 1];
    const pi = document.getElementById('player-indicator');
    
    if (numPlayers > 1) {
        pi.classList.remove('hidden'); 
        pi.textContent = `🎮 Đang bắn: ${playerNames[currentPlayer - 1]}`;
        pi.style.color = playerColors[(currentPlayer - 1) % playerColors.length];
        
        // Render score list
        let html = '';
        playerScores.forEach((score, idx) => {
            const isCurrent = (idx + 1) === currentPlayer;
            const color = playerColors[idx % playerColors.length];
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; 
                            gap: 15px; padding: 4px 8px; border-radius:4px; 
                            background: ${isCurrent ? 'rgba(255,204,0,0.2)' : 'transparent'};
                            border-left: ${isCurrent ? '4px solid ' + color : 'none'}">
                    <span style="color:${color}; font-weight:${isCurrent ? 'bold' : 'normal'}; 
                                 white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
                                 max-width: 100px; flex-shrink: 1;">${playerNames[idx]}</span>
                    <span style="font-weight:bold; flex-shrink: 0;">${score}</span>
                </div>
            `;
        });
        playerScoresList.innerHTML = html;
    } else {
        pi.classList.add('hidden'); 
        playerScoresList.innerHTML = `
            <div style="font-size: 24px;">Điểm: <span style="color:#ffcc00">${playerScores[0]}</span></div>
        `;
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
            
            // SKIP drawing cue marble here if it's being drawn by drawCatPaws (IDLE/AIMING)
            // This fixes the "double cue marble" bug.
            if ((gameState === 'IDLE' || gameState === 'AIMING') && m.isCue) continue;

            m.draw(ctx);
        }

        // PHÁT SÓNG VẬT LÝ: Gửi vị trí bi mượt mà theo ID
        if (isOnlineMode && gameState === 'MOVING' && moving && (currentPlayer - 1) === window.mySlotIndex) {
            const data = marbles.map(m => ({
                id: m.id,
                ...getNormalized(m.pos),
                nvx: m.vel.x / ARENA_RADIUS,
                nvy: m.vel.y / ARENA_RADIUS,
                active: m.active
            }));
            socket.emit('update-marbles', { 
                roomId: currentRoom, 
                marbles: data,
                currentScore: playerScores[currentPlayer - 1] // Gửi kèm điểm hiện tại
            });
        }

        if (gameState === 'MOVING') {
            checkCollisions(); 
            checkArenaBounds();
            
            if (!moving) {
                const oldPlayerIdx = currentPlayer; // Lưu lại để biết ai vừa bắn
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
                const outOfTurns = playerTurns[currentPlayer - 1] <= 0;
                const playerDone = (targetMarblesLeft === 0 || outOfTurns);

                function ensureCueExists() {
                    const stillActiveCue = marbles.find(m => m.isCue && m.active);
                    if (!stillActiveCue) {
                        const distance = ARENA_RADIUS + MARBLE_RADIUS * 4.5;
                        let startY = ARENA_Y + distance;
                        if (startY > CANVAS_HEIGHT - (MAX_DRAG_DIST + MARBLE_RADIUS * 2)) {
                            startY = CANVAS_HEIGHT - (MAX_DRAG_DIST + MARBLE_RADIUS * 2);
                        }
                        const cueId = `${currentPlayer-1}_cue`;
                        cueMarble = new Marble(cueId, ARENA_X, startY, '#fff', true);
                        marbles.push(cueMarble);
                        playerCues[currentPlayer - 1] = cueMarble;
                    }
                }

                if (numPlayers === 1) {
                    if (playerDone) {
                        endGame();
                    } else {
                        gameState = 'IDLE';
                        ensureCueExists();
                        updateUI();
                    }
                } else {
                    // Cập nhật board state cục bộ
                    playerBoards[currentPlayer - 1] = marbles;
                    playerCues[currentPlayer - 1] = cueMarble;

                    // Tìm người chơi tiếp theo
                    let nextPlayerIdx = currentPlayer; 
                    let found = false;
                    for (let i = 0; i < numPlayers; i++) {
                        const pIdx = (nextPlayerIdx % numPlayers); 
                        const pMarbles = playerBoards[pIdx];
                        const pTargets = pMarbles.filter(m => !m.isCue && m.active).length;
                        const pHasTurns = playerTurns[pIdx] > 0;

                        if (pHasTurns && pTargets > 0) {
                            currentPlayer = pIdx + 1;
                            switchPlayerBoard(currentPlayer);
                            found = true;
                            break;
                        }
                        nextPlayerIdx++;
                    }

                    if (!found) {
                        endGame();
                    } else {
                        gameState = 'IDLE';
                        ensureCueExists();
                        updateUI();
                    }
                }

                // GỬI ĐỒNG BỘ: Chỉ người vừa bắn mới được gửi kết quả chuẩn đi
                if (isOnlineMode && (oldPlayerIdx - 1) === window.mySlotIndex) {
                    const marblesState = marbles.map(m => ({
                        nx: (m.pos.x - ARENA_X) / ARENA_RADIUS,
                        ny: (m.pos.y - ARENA_Y) / ARENA_RADIUS,
                        active: m.active,
                        isCue: m.isCue,
                        color: m.color
                    }));

                    socket.emit('game-state-update', {
                        roomId: currentRoom,
                        scores: playerScores,
                        turns: playerTurns,
                        currentPlayer: currentPlayer,
                        gameState: gameState, // Sync even if it's GAMEOVER
                        marbles: marblesState
                    });
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

    // ONLINE LOCK: Chỉ cho phép bắn nếu đến lượt mình
    if (isOnlineMode && (currentPlayer - 1) !== window.mySlotIndex) {
        return; 
    }

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

    // Gửi dữ liệu ngắm đã chuẩn hóa
    if (isOnlineMode && (currentPlayer - 1) === window.mySlotIndex && (gameState === 'IDLE' || gameState === 'AIMING')) {
        const norm = getNormalized(new Vector(mouseX, mouseY));
        socket.emit('aim', {
            roomId: currentRoom,
            nx: norm.nx,
            ny: norm.ny,
            active: isDragging
        });
    }
}
function handlePointerUp() {
    if (!isDragging || gameState !== 'AIMING') return;
    isDragging = false;
    
    // Reset ngắm online
    if (isOnlineMode) {
        socket.emit('aim', { roomId: currentRoom, active: false });
    }

    let diff = new Vector(mouseX - cueMarble.pos.x, mouseY - cueMarble.pos.y);
    if (diff.mag() > MAX_DRAG_DIST) diff = diff.normalize().mult(MAX_DRAG_DIST);
    if (diff.mag() > 5) { 
        cueMarble.vel = diff.mult(-POWER_MULTIPLIER); 
        gameState = 'MOVING'; 

        // Gửi thông tin bắn (Lực chuẩn hóa theo ARENA_RADIUS)
        if (isOnlineMode) {
            socket.emit('shoot', {
                roomId: currentRoom,
                forceNX: (cueMarble.vel.x / ARENA_RADIUS),
                forceNY: (cueMarble.vel.y / ARENA_RADIUS),
                startNX: (cueMarble.pos.x - ARENA_X) / ARENA_RADIUS,
                startNY: (cueMarble.pos.y - ARENA_Y) / ARENA_RADIUS,
                playerId: myPlayerId
            });
        }
    }
    else gameState = 'IDLE';
}

canvas.addEventListener('mousedown', e => handlePointerDown(e.clientX, e.clientY));
window.addEventListener('mousemove', e => handlePointerMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handlePointerUp);
canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; handlePointerDown(t.clientX, t.clientY); }, {passive:false});
canvas.addEventListener('touchmove', e => { e.preventDefault(); const t = e.touches[0]; handlePointerMove(t.clientX, t.clientY); }, {passive:false});
canvas.addEventListener('touchend', handlePointerUp);

const LEADERBOARD_KEY = 'banBiLeaderboard';
function saveScores(results) {
    let list = JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
    const now = Date.now();
    
    // kết hợp các kết quả mới vào danh sách cũ
    results.forEach(res => {
        // Kiểm tra trùng lặp (nếu cùng tên, cùng điểm và lưu cách nhau dưới 2 giây -> coi là 1 ván)
        const isDuplicate = list.some(item => 
            item.label === res.name && 
            item.score === res.score && 
            (now - (item.timestamp || 0)) < 2000
        );

        if (!isDuplicate) {
            list.push({
                score: res.score,
                label: res.name,
                date: new Date().toLocaleDateString(),
                timestamp: now
            });
        }
    });

    // Sắp xếp giảm dần theo điểm
    list.sort((a, b) => b.score - a.score);
    // Chỉ lấy Top 5
    list = list.slice(0, 5);
    
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
    return list;
}
function updateLeaderboardUI(list) {
    const html = list.map((e, i) => {
        let medal = '';
        if (i === 0) medal = '🥇 ';
        else if (i === 1) medal = '🥈 ';
        else if (i === 2) medal = '🥉 ';
        else medal = `#${i+1} `;

        return `<li style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:6px 10px; background:rgba(255,255,255,0.05); border-radius:6px; margin-bottom:5px;">
            <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                <span style="color:#ffcc00; font-weight:bold; flex-shrink:0;">${medal}</span> 
                <span style="color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;">${e.label || 'Vô danh'}</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
                <span style="color:#44ff44; font-weight:bold;">${e.score} pts</span> 
            </div>
        </li>`;
    }).join('');
    
    const emptyMsg = '<p style="text-align:center; color:#888;">Chưa có dữ liệu</p>';
    leaderboardList.innerHTML = list.length ? html : emptyMsg; 
    standaloneLeaderboardList.innerHTML = list.length ? html : emptyMsg;
}

function endGame(skipBonus = false) {
    gameState = 'GAMEOVER';
    hideAllModals(); 
    
    const scoresSummary = document.getElementById('scores-summary');
    const allMarblesCleared = marbles.filter(m => !m.isCue && m.active).length === 0;

    if (numPlayers === 1) {
        const win = allMarblesCleared;
        const bonus = win ? playerTurns[0] * 50 : 0;
        
        // Chỉ cộng vào biến score nếu chưa được cộng (máy Master)
        if (!skipBonus && bonus > 0) playerScores[0] += bonus;
        
        endTitleEl.innerText = win ? "CHIẾN THẮNG!" : "HẾT LƯỢT!";
        endTitleEl.style.color = win ? "#44ff44" : "#ff4444";
        
        bonusInfoEl.innerText = win ? `Thưởng lượt dư: +${bonus}` : "";
        bonusInfoEl.classList.toggle('hidden', !win);
        
        scoresSummary.innerHTML = `<p style="font-size: 28px; color:#ffcc00; text-align:center;">TỔNG ĐIỂM: ${playerScores[0]}</p>`;
        
        const finalResults = [{ name: playerNames[0] || 'Bạn', score: playerScores[0] }];
        updateLeaderboardUI(saveScores(finalResults));
        gameOverModal.classList.remove('hidden');
    } else {
        // Multi-player mode: Calculate bonus for each player
        let bonusReports = [];
        playerBoards.forEach((board, i) => {
            const cleared = board.filter(m => !m.isCue && m.active).length === 0;
            if (cleared) {
                const bonus = playerTurns[i] * 50;
                if (bonus > 0) {
                    // Chỉ cộng toán học nếu là máy Master (skipBonus=false)
                    if (!skipBonus) playerScores[i] += bonus;
                    bonusReports.push(`${playerNames[i]} +${bonus}`);
                }
            }
        });

        // Store or update in masterResults
        if (!isPlayoff) {
            masterResults = playerNames.map((name, i) => ({
                name: name,
                color: playerColors[i % playerColors.length],
                score: playerScores[i],
                playoffScore: 0
            }));
        } else {
            // Update playoff scores for participants
            playerNames.forEach((name, i) => {
                const entry = masterResults.find(r => r.name === name);
                if (entry) entry.playoffScore = playerScores[i];
            });
        }

        if (bonusReports.length > 0) {
            bonusInfoEl.innerText = "Thưởng lượt dư: " + bonusReports.join(", ");
        } else {
            bonusInfoEl.innerText = "Không có thưởng lượt dư (chưa dọn sạch bi)";
        }
        bonusInfoEl.classList.remove('hidden');

        // Find winner based on CURRENT round's scores
        let maxScore = -9999;
        let winners = [];
        playerScores.forEach((s, i) => {
            if (s > maxScore) {
                maxScore = s;
                winners = [playerNames[i]];
            } else if (s === maxScore) {
                winners.push(playerNames[i]);
            }
        });

        if (winners.length === 1) {
            // WE HAVE A SINGLE CHAMPION
            endTitleEl.innerText = isPlayoff ? `VÔ ĐỊCH: ${winners[0]}!` : `${winners[0]} CHIẾN THẮNG!`;
            
            const champEntry = masterResults.find(r => r.name === winners[0]);
            endTitleEl.style.color = champEntry ? champEntry.color : "#ffcc00";
            
            // Render ALL original players in summary with improved table
            let summaryHtml = '<div style="display:flex; flex-direction:column; gap:10px; margin: 20px 0; background:rgba(0,0,0,0.2); padding:15px; border-radius:12px;">';
            masterResults.sort((a,b) => b.score - a.score).forEach((res) => {
                // Hiển thị điểm playoff nếu có tham gia (kể cả 0 điểm)
                const inPlayoff = isPlayoff || winners.length > 1; // context logic
                const hasPlayoffScore = isPlayoff && res.playoffScore !== undefined;
                const scoreDisplay = `<span>${res.score}</span>` + 
                    (res.playoffScore > 0 || (isPlayoff && res.playoffScore === 0) ? 
                     `<span style="color:#aaa; font-size:0.8em; margin-left:8px;">(Phụ: ${res.playoffScore})</span>` : '');

                summaryHtml += `
                    <div style="color:${res.color}; font-size:20px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">
                        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${res.name}</span>
                        <div style="font-weight:bold;">${scoreDisplay}</div>
                    </div>`;
            });
            summaryHtml += '</div>';
            scoresSummary.innerHTML = summaryHtml;

            // Lưu vào bảng xếp hạng: Mọi trình duyệt đều lưu để cập nhật kỷ lục cá nhân
            const finalResultsToSave = masterResults.map(r => ({ name: r.name, score: r.score }));
            updateLeaderboardUI(saveScores(finalResultsToSave));
            
            gameOverModal.classList.remove('hidden');
        } else {
            // TIE BREAKER! ... (existing logic)
            // (Không thay đổi phần này)
            const tiedWinnersNames = winners;
            const tiedWinnersColors = winners.map(name => {
                 const res = masterResults.find(r => r.name === name);
                 return res ? res.color : '#fff';
            });
            
            showTurnNotify("HÒA ĐIỂM! BẮT ĐẦU VÒNG PHỤ...");
            startPlayoff(tiedWinnersNames, tiedWinnersColors);
            return; 
        }
    }
    updateUI(); // Cập nhật lại thanh điểm góc trái và lượt (phải gọi sau khi cộng bonus)
}

// HÀM HỖ TRỢ ĐÓNG TẤT CẢ POPUP
function hideAllModals() {
    rulesModal.classList.add('hidden');
    leaderboardModalStandalone.classList.add('hidden');
    gameOverModal.classList.add('hidden');
}

document.getElementById('btn-1p').addEventListener('click', () => {
    setupPlayerNames(1);
});

document.getElementById('btn-2p').addEventListener('click', () => {
    // For 2P, we also allow custom names for consistency, or just start
    setupPlayerNames(2);
});

btnMulti.addEventListener('click', () => {
    modeSelection.classList.add('hidden');
    playerCountSetup.classList.remove('hidden');
});

playerCountSlider.addEventListener('input', () => {
    countDisplay.innerText = playerCountSlider.value;
});

btnNextToNames.addEventListener('click', () => {
    setupPlayerNames(parseInt(playerCountSlider.value));
});

btnBackToMode.addEventListener('click', () => {
    playerCountSetup.classList.add('hidden');
    modeSelection.classList.remove('hidden');
});

btnBackToCount.addEventListener('click', () => {
    playerNamesSetup.classList.add('hidden');
    playerCountSetup.classList.remove('hidden');
});

// ONLINE MODE HANDLERS
btnOnline.addEventListener('click', () => {
    modeSelection.classList.add('hidden');
    onlineSetup.classList.remove('hidden');
    isOnlineMode = true;
});

btnBackFromOnline.addEventListener('click', () => {
    onlineSetup.classList.add('hidden');
    modeSelection.classList.remove('hidden');
    isOnlineMode = false;
});

btnCreateRoom.addEventListener('click', () => {
    const randomRoom = Math.floor(1000 + Math.random() * 9000).toString();
    socket.emit('create-room', { roomId: randomRoom, name: "Người chơi 1" });
    showTurnNotify("ĐANG TẠO PHÒNG...");
});

btnJoinRoom.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) return alert("Vui lòng nhập mã phòng!");
    socket.emit('join-room', { roomId, name: "Người chơi mới" });
});

roomIdInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
        btnJoinRoom.click();
    }
});

socket.on('error', (msg) => {
    alert("❌ LỖI: " + msg);
});

socket.on('room-joined', (data) => {
    currentRoom = data.roomId;
    myPlayerId = data.playerId;
    
    // Chuyển từ màn hình Setup sang màn hình Lobby
    onlineSetup.classList.add('hidden');
    onlineLobby.classList.remove('hidden');
    lobbyRoomIdDisplay.textContent = currentRoom;
    
    showTurnNotify(`VÀO PHÒNG: ${currentRoom}`);
});

socket.on('player-list-update', (players) => {
    console.log("Cập nhật danh sách người chơi:", players);
    lobbyPlayersList.innerHTML = '';
    
    // Đảm bảo myPlayerId khớp với socket.id hiện tại
    if (socket.id) myPlayerId = socket.id;

    let allReady = players.length >= 2;
    
    players.forEach(p => {
        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.background = 'rgba(255,255,255,0.08)';
        div.style.borderRadius = '10px';
        div.style.marginBottom = '8px';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.border = '1px solid rgba(255,255,255,0.1)';
        
        const isMe = p.id === myPlayerId || p.id === socket.id;
        const readyText = p.ready ? '<span style="color:#44ff44; font-weight:bold;">SẴN SÀNG ✓</span>' : '<span style="color:#ff4444;">ĐANG ĐỢI...</span>';
        
        div.innerHTML = `
            <span style="font-size:18px;">👤 ${p.name} ${isMe ? '<span style="color:#44ff44; font-size:0.8em; font-weight:bold;">(BẠN)</span>' : ''}</span>
            <div style="font-size:16px;">${readyText}</div>
        `;
        lobbyPlayersList.appendChild(div);
        
        if (!p.ready) allReady = false;
    });

    const isOwner = players.length > 0 && (players[0].id === myPlayerId || players[0].id === socket.id);
    const btnReady = document.getElementById('btn-toggle-ready');
    const me = players.find(p => p.id === myPlayerId || p.id === socket.id);

    if (isOwner) {
        btnStartOnlineGame.classList.remove('hidden');
        btnReady.classList.add('hidden');
        
        if (allReady) {
            btnStartOnlineGame.disabled = false;
            btnStartOnlineGame.style.opacity = '1';
            btnStartOnlineGame.style.filter = 'none';
            btnStartOnlineGame.style.cursor = 'pointer';
            lobbyStatus.textContent = "Bạn có thể bắt đầu trận đấu!";
            lobbyStatus.style.color = "#44ff44";
        } else {
            btnStartOnlineGame.disabled = true;
            btnStartOnlineGame.style.opacity = '0.5';
            btnStartOnlineGame.style.filter = 'grayscale(1)';
            btnStartOnlineGame.style.cursor = 'not-allowed';
            lobbyStatus.textContent = players.length < 2 ? "Chờ người chơi khác tham gia..." : "Chờ tất cả sẵn sàng...";
            lobbyStatus.style.color = "#aaa";
        }
    } else {
        btnStartOnlineGame.classList.add('hidden');
        btnReady.classList.remove('hidden');
        
        if (me) {
            btnReady.textContent = me.ready ? "HỦY SẴN SÀNG" : "SẴN SÀNG!";
            btnReady.style.background = me.ready ? "#ff4444" : "#ffcc00";
            btnReady.style.boxShadow = me.ready ? "0 5px 0 #990000" : "0 5px 0 #cc9900";
            lobbyStatus.textContent = me.ready ? (allReady ? "Sắp bắt đầu..." : "Đã sẵn sàng, chờ mọi người...") : "Bạn chưa sẵn sàng!";
            lobbyStatus.style.color = me.ready ? "#44ff44" : "#ff4444";
        }
    }
});

// Listener cho nút sẵn sàng - dùng delegate hoặc attach 1 lần duy nhất
if (!window._readyListenerAttached) {
    document.getElementById('btn-toggle-ready').addEventListener('click', () => {
        if (currentRoom) {
            console.log("Emit toggle-ready cho phòng:", currentRoom);
            socket.emit('toggle-ready', { roomId: currentRoom });
        }
    });
    window._readyListenerAttached = true;
}

btnLeaveLobby.addEventListener('click', () => {
    location.reload(); // Cách nhanh nhất để reset socket và state
});

btnStartOnlineGame.addEventListener('click', () => {
    socket.emit('start-game', { roomId: currentRoom });
});

socket.on('init-online-game', (data) => {
    isOnlineMode = true;
    onlineLobby.classList.add('hidden');
    document.body.style.overflow = 'hidden'; // Tránh scroll

    document.getElementById('mode-chooser').classList.add('hidden');
    
    const names = data.players.map(p => p.name);
    initGame(names.length, names);
    
    for (let p = 0; p < numPlayers; p++) {
        const boardMarbles = data.initialMarbles.filter(m => Number(m.pid) === p);
        
        playerBoards[p] = boardMarbles.map(m => {
            const marble = new Marble(
                m.id,
                ARENA_X + m.nx * ARENA_RADIUS,
                ARENA_Y + m.ny * ARENA_RADIUS,
                m.color,
                !!m.isCue
            );
            marble.active = m.active;
            return marble;
        });
        playerCues[p] = playerBoards[p].find(m => m.isCue);
    }


    marbles = playerBoards[0];
    cueMarble = playerCues[0];
    currentPlayer = 1;
    
    const myIndex = data.players.findIndex(p => p.id === myPlayerId);
    if (myIndex !== -1) window.mySlotIndex = myIndex;
    
    updateUI();
    showTurnNotify(`BẮT ĐẦU: ${playerNames[0]}`);
});

socket.on('opponent-marbles-sync', (data) => {
    if (isOnlineMode && (currentPlayer - 1) !== window.mySlotIndex) {
        // Cập nhật điểm thời gian thực từ đối thủ
        if (data.currentScore !== undefined) {
            playerScores[currentPlayer - 1] = data.currentScore;
            updateUI();
        }

        data.marbles.forEach(remoteM => {
            const localM = marbles.find(m => m.id === remoteM.id);
            if (localM) {
                localM.pos.x = ARENA_X + remoteM.nx * ARENA_RADIUS;
                localM.pos.y = ARENA_Y + remoteM.ny * ARENA_RADIUS;
                localM.vel.x = remoteM.nvx * ARENA_RADIUS;
                localM.vel.y = remoteM.nvy * ARENA_RADIUS;
                localM.active = remoteM.active;
            }
        });
        if (gameState !== 'MOVING') gameState = 'MOVING';
    }
});

socket.on('opponent-shoot', (data) => {
    if (gameState === 'IDLE' && cueMarble) {
        remoteAimingData.active = false;
        cueMarble.pos = new Vector(ARENA_X + data.startNX * ARENA_RADIUS, ARENA_Y + data.startNY * ARENA_RADIUS);
        cueMarble.vel = new Vector(data.forceNX * ARENA_RADIUS, data.forceNY * ARENA_RADIUS);
        gameState = 'MOVING';
    }
});

socket.on('opponent-aim', (data) => {
    remoteAimingData = data;
});

socket.on('sync-game-state', (data) => {
    playerScores = data.scores;
    playerTurns = data.turns;
    const oldPlayer = currentPlayer;
    currentPlayer = data.currentPlayer;
    
    if (data.marbles && isOnlineMode) {
        data.marbles.forEach(remoteM => {
            const localM = marbles.find(m => m.id === remoteM.id);
            if (localM) {
                localM.pos.x = ARENA_X + remoteM.nx * ARENA_RADIUS;
                localM.pos.y = ARENA_Y + remoteM.ny * ARENA_RADIUS;
                localM.active = remoteM.active;
                localM.vel = new Vector(0,0);
            }
        });
    }

    if (data.gameState === 'GAMEOVER') {
        endGame(true); // QUAN TRỌNG: skipBonus = true vì Master đã cộng rồi
        return;
    }

    if (oldPlayer !== currentPlayer) {
        switchPlayerBoard(currentPlayer);
        showTurnNotify(`Lượt: ${playerNames[currentPlayer - 1]}`);
    }
    
    gameState = 'IDLE';
    updateUI();
});


function setupPlayerNames(count) {
    playerCountSetup.classList.add('hidden');
    modeSelection.classList.add('hidden');
    playerNamesSetup.classList.remove('hidden');
    
    nameInputsContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div');
        div.style.marginBottom = '10px';
        let defaultName = `Người chơi ${i + 1}`;
        if (count === 1) defaultName = 'Bạn';
        else if (count === 2) defaultName = `P${i + 1}`;
        
        div.innerHTML = `
            <input type="text" class="player-name-input" placeholder="Tên người chơi ${i + 1}" value="${defaultName}" maxlength="15">
        `;
        nameInputsContainer.appendChild(div);
    }
}

btnStartGame.addEventListener('click', () => {
    isPlayoff = false;
    masterResults = [];
    const inputs = document.querySelectorAll('.player-name-input');
    const names = Array.from(inputs).map((input, idx) => input.value.trim() || `P${idx + 1}`);
    playerNamesSetup.classList.add('hidden');
    // Reset standard colors
    playerColors = ['#66ccff', '#ff8844', '#ffcc00', '#44ff44', '#ff44ff', '#44ffff', '#ff5555', '#aaff00', '#00ffaa', '#ffaaff'];
    initGame(names.length, names);
});

restartBtn.addEventListener('click', () => { 
    hideAllModals();
    isPlayoff = false;
    gameState = 'MENU'; 
    document.getElementById('mode-chooser').classList.remove('hidden'); 
    modeSelection.classList.remove('hidden');
    playerCountSetup.classList.add('hidden');
    playerNamesSetup.classList.add('hidden');
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
