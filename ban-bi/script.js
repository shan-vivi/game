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

    ARENA_X      = CANVAS_WIDTH  / 2;
    ARENA_Y      = CANVAS_HEIGHT / 2;
    // Arena radius ~ 30% of shorter side, capped nicely
    ARENA_RADIUS = Math.round(Math.min(CANVAS_WIDTH, CANVAS_HEIGHT) * 0.28);
    // Marble radius proportional to arena
    MARBLE_RADIUS = Math.round(ARENA_RADIUS / 14);
    // Max drag distance proportional to arena
    MAX_DRAG_DIST = ARENA_RADIUS * 0.85;
}

calcDimensions();


// Game State
let score = 0;
let turnsLeft = MAX_TURNS;
let gameState = 'IDLE'; // IDLE, AIMING, MOVING, GAMEOVER
let marbles = []; // Array of marble objects
let cueMarble = null;

// Interaction state
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
        if (m !== 0) {
            return new Vector(this.x / m, this.y / m);
        }
        return new Vector(0, 0);
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

        // Stop completely if moving very slowly
        if (this.vel.mag() < 0.1) {
            this.vel = new Vector(0, 0);
        }
    }

    draw(ctx) {
        if (!this.active) return;

        // Shadow
        ctx.beginPath();
        ctx.arc(this.pos.x + 3, this.pos.y + 3, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fill();

        // Marble body (radial gradient for 3D glass effect)
        let gradient = ctx.createRadialGradient(
            this.pos.x - this.radius/3, this.pos.y - this.radius/3, this.radius/10,
            this.pos.x, this.pos.y, this.radius
        );
        
        if (this.isCue) { // Bi cái usually white/transparentish
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

        // Highlight
        ctx.beginPath();
        ctx.arc(this.pos.x - this.radius/3, this.pos.y - this.radius/3, this.radius/3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
        
        // Outline
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function initGame() {
    marbles = [];
    score = 0;
    turnsLeft = MAX_TURNS;
    gameState = 'IDLE';
    updateUI();
    gameOverModal.classList.add('hidden');

    // Create target marbles in the center
    const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
    
    // Pattern: 1 in center, 6 in hexagon around it
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

    // Create Cue Marble outside the arena
    resetCueMarble();
}

function resetCueMarble() {
    // Đặt bi cái nằm gần cạnh dưới, căn giữa theo x
    cueMarble = new Marble(CANVAS_WIDTH / 2, CANVAS_HEIGHT - MARBLE_RADIUS * 6, '#fff', true);
    marbles.push(cueMarble);
}

// ============================================================
// BACKGROUND — off-screen canvas, redrawn on resize
// ============================================================
const bgCanvas = document.createElement('canvas');
const bgCtx = bgCanvas.getContext('2d');

function initBackground() {
    const W = CANVAS_WIDTH;
    const H = CANVAS_HEIGHT;
    bgCanvas.width  = W;
    bgCanvas.height = H;
    
    const TILE_SIZE = Math.round(Math.min(W, H) / 8); // ~8 tiles across shorter side
    
    // Nền mạch xi măng
    bgCtx.fillStyle = '#3a3a3a'; 
    bgCtx.fillRect(0, 0, W, H);
    
    for (let x = 0; x < W; x += TILE_SIZE) {
        for (let y = 0; y < H; y += TILE_SIZE) {
            const baseVariance = Math.random() * 8 - 4;
            const r = 205 + baseVariance, g = 100 + baseVariance, b = 55 + baseVariance;
            bgCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            bgCtx.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            
            // Vân mốc/ố mờ
            bgCtx.fillStyle = 'rgba(120, 100, 80, 0.15)';
            for (let j = 0; j < 4; j++) {
                bgCtx.beginPath();
                bgCtx.arc(
                    x + 2 + Math.random() * (TILE_SIZE - 10),
                    y + 2 + Math.random() * (TILE_SIZE - 10),
                    Math.random() * (TILE_SIZE * 0.25) + 4, 0, Math.PI * 2
                );
                bgCtx.fill();
            }
            // Rỗ tổ ong
            bgCtx.fillStyle = 'rgba(0,0,0,0.2)';
            for (let i = 0; i < 50; i++) {
                bgCtx.fillRect(x + 2 + Math.random()*(TILE_SIZE-4), y + 2 + Math.random()*(TILE_SIZE-4), 1.5, 1.5);
            }
            bgCtx.fillStyle = 'rgba(0,0,0,0.15)';
            for (let i = 0; i < 20; i++) {
                bgCtx.fillRect(x + 2 + Math.random()*(TILE_SIZE-5), y + 2 + Math.random()*(TILE_SIZE-5), 2, 2);
            }
            // Hạt sáng
            bgCtx.fillStyle = 'rgba(255,255,255,0.1)';
            for (let i = 0; i < 80; i++) {
                bgCtx.fillRect(x + 2 + Math.random()*(TILE_SIZE-4), y + 2 + Math.random()*(TILE_SIZE-4), 1.5, 1.5);
            }
            // Vết xước
            bgCtx.strokeStyle = 'rgba(0,0,0,0.1)';
            bgCtx.lineWidth = 1.5;
            bgCtx.beginPath();
            for (let j = 0; j < 3; j++) {
                const sx = x + Math.random() * TILE_SIZE, sy = y + Math.random() * TILE_SIZE;
                bgCtx.moveTo(sx, sy);
                bgCtx.lineTo(sx + (Math.random()-0.5)*18, sy + (Math.random()-0.5)*18 + 8);
            }
            bgCtx.stroke();
            // Bevel
            bgCtx.fillStyle = 'rgba(255,255,255,0.3)';
            bgCtx.fillRect(x+1, y+1, TILE_SIZE-2, 2.5);
            bgCtx.fillRect(x+1, y+1, 2.5, TILE_SIZE-2);
            bgCtx.fillStyle = 'rgba(0,0,0,0.4)';
            bgCtx.fillRect(x+1, y+TILE_SIZE-3.5, TILE_SIZE-2, 2.5);
            bgCtx.fillRect(x+TILE_SIZE-3.5, y+1, 2.5, TILE_SIZE-2);
        }
    }
}

// Đặt lại background khi thay đổi kích thước
function handleResize() {
    const oldArenaX = ARENA_X, oldArenaY = ARENA_Y, oldArenaR = ARENA_RADIUS;
    const oldCueX = cueMarble ? cueMarble.pos.x : null;
    const oldCueY = cueMarble ? cueMarble.pos.y : null;
    
    calcDimensions();
    initBackground();
    
    // Scale lại vị trí các viên bi theo tỷ lệ arena mới
    const scaleR = ARENA_RADIUS / oldArenaR;
    for (let m of marbles) {
        m.pos.x = ARENA_X + (m.pos.x - oldArenaX) * scaleR;
        m.pos.y = ARENA_Y + (m.pos.y - oldArenaY) * scaleR;
        m.radius = MARBLE_RADIUS;
    }
    // Bi cái: giữ khoảng cách tương đối tới arena
    if (cueMarble) {
        cueMarble.pos.x = CANVAS_WIDTH / 2;
        cueMarble.pos.y = CANVAS_HEIGHT - MARBLE_RADIUS * 6;
    }
}

// Khởi tạo background lần đầu
initBackground();

window.addEventListener('resize', () => {
    clearTimeout(window._resizeTimer);
    window._resizeTimer = setTimeout(handleResize, 120);
});
window.addEventListener('orientationchange', () => {
    setTimeout(handleResize, 200);
});

function drawArena() {
    // Draw the pre-rendered terrazzo tile background
    ctx.drawImage(bgCanvas, 0, 0);

    // 3. Draw Target Circle (Vòng ranh giới phấn trắng vẽ trên gạch)
    ctx.beginPath();
    ctx.arc(ARENA_X, ARENA_Y, ARENA_RADIUS, 0, Math.PI * 2);
    // Vòng phấn ngoài
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'; 
    ctx.lineWidth = 6;
    ctx.stroke();
    
    // Bụi phấn nhỏ bên trong
    ctx.beginPath();
    ctx.arc(ARENA_X, ARENA_Y, ARENA_RADIUS - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawAimLine() {
    if ((gameState !== 'AIMING' && gameState !== 'IDLE') || !cueMarble) return;

    let dragDiff = new Vector(mouseX - cueMarble.pos.x, mouseY - cueMarble.pos.y);
    let dist = 0;
    
    let mx = mouseX;
    let my = mouseY;
    
    // Khởi tạo hướng tay ban đầu nếu chưa rê chuột (hoặc chuột ở đúng vị trí bi cái)
    if ((mx === 0 && my === 0) || (mx === cueMarble.pos.x && my === cueMarble.pos.y)) {
        mx = cueMarble.pos.x;
        my = cueMarble.pos.y + 100; // Mặc định hướng tay xuống dưới
    }

    if (gameState === 'AIMING') {
        dist = dragDiff.mag();
        
        if (dist > 0) {
            if (dist > MAX_DRAG_DIST) {
                dragDiff = dragDiff.normalize().mult(MAX_DRAG_DIST);
                dist = MAX_DRAG_DIST;
            }

            // Draw dotted line in OPPOSITE direction of drag
            let aimVector = dragDiff.mult(-1);
            let endPoint = cueMarble.pos.add(aimVector.mult(2)); // Show trajectory further out

            ctx.beginPath();
            ctx.moveTo(cueMarble.pos.x, cueMarble.pos.y);
            ctx.lineTo(endPoint.x, endPoint.y);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 8]);
            ctx.stroke();
            ctx.setLineDash([]); // Reset
        }
    }

    // Luôn vẽ tay mèo chầu chực ở trạng thái IDLE hoặc AIMING
    drawCatPaws(mx, my, cueMarble.pos.x, cueMarble.pos.y, cueMarble.radius, dist);
}

function drawCatPaws(mx, my, cx, cy, radius, realDist) {
    const angle = Math.atan2(cy - my, cx - mx);
    const pullDist = Math.max(0, Math.min(MAX_DRAG_DIST, realDist));
    
    ctx.save(); // WORLD SPACE SAVE
    
    // Chuyển trục toạ độ đến tâm viên bi GỐC (chưa kéo)
    // Hệ trục mới: Chiều dương X hướng vào mục tiêu, chiều âm X hướng về phía chuột.
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    
    // TAY TRÁI (MÈO TRẮNG) - LÀM TRỤ (BRIDGE)
    ctx.save();
    // Đặt bàn chân trái nằm kế bên gốc bắn (lệch sang phải 20px)
    ctx.translate(0, radius + 20);
    
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    
    // Cánh tay mèo vươn ra (từ đằng sau lên)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-30, 80);
    ctx.lineTo(20, 80);
    ctx.lineTo(15, 0);
    ctx.lineTo(-15, 0);
    ctx.fill();
    
    // Lòng bàn chân (úp xuống đất)
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 14, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    
    // Ngón tay duỗi thẳng vươn tới (0,0) làm trụ đạn
    ctx.save();
    ctx.translate(0, -radius - 10); // Tịnh tiến lên sát mép viên bi gốc
    // Vẽ ngón duỗi
    ctx.beginPath();
    ctx.roundRect(-6, -2, 12, 18, 6);
    ctx.fill();
    ctx.stroke();
    // Đệm thịt hồng đầu ngón
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.arc(0, 2, 4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    
    // Các ngón khác gập úp xuống đất (tạo cảm giác bàn chân đang chống đất)
    const drawGripBean = (bx, by, rot) => {
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(rot);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(0, 0, 7, 5, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffb6c1';
        ctx.beginPath(); ctx.arc(0, 2, 2.5, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    };
    drawGripBean(-12, -4, 0.4);
    drawGripBean(-4,  -8, 0);
    drawGripBean(6,   -7, -0.3);
    
    // Đệm lòng bàn chân
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.ellipse(0, 3, 10, 6, 0, 0, Math.PI*2); ctx.fill();

    ctx.restore(); // KẾT THÚC TAY TRÁI TRỤ
    
    // VIÊN BI ĐANG KÉO (RIGHT PAW)
    // Viên bi thực tế sẽ dịch chuyển về -pullDist (hướng về con chuột)
    const pullyX = -pullDist;
    
    // Vẽ viên bi (Thay vì tính toạ độ phức tạp, ta chỉ cần thay local coords và vẽ)
    // Chú ý: ctx đang rotate/translate, cueMarble.draw giả định toạ độ tuyệt đối,
    // nên ta vẽ bi bằng toạ độ TÍNH RA TOÀN CỤC.
    const pulledWorldX = cx - Math.cos(angle) * pullDist;
    const pulledWorldY = cy - Math.sin(angle) * pullDist;
    
    // Tạm thời set toạ độ mới cho bi
    const origPos = cueMarble.pos.copy();
    cueMarble.pos = new Vector(pulledWorldX, pulledWorldY);

    // Huỷ bỏ tịnh tiến cục bộ để vẽ bi và bóng râm không bị méo lệch
    ctx.restore(); // Giải phóng ctx về mặc định WORLD SPACE
    ctx.save(); // Lưu lại chuẩn WORLD SPACE để dùng vẽ bi
    cueMarble.draw(ctx);
    cueMarble.pos = origPos; // Trả lại vị trí cho hệ vật lý ngay lập tức
    
    // Bắt đầu vẽ TAY PHẢI KÉO BI (MÈO CAM)
    // Tái thiết lập Hệ trục nằm ngay tại TÂM VIÊN BI ĐANG KÉO
    ctx.translate(pulledWorldX, pulledWorldY);
    ctx.rotate(angle);
    
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    
    // Tay cam kéo giãn về phía âm X
    ctx.fillStyle = '#f4a460';
    ctx.beginPath();
    ctx.rect(-100, -14, 100 - radius - 5, 28); // Kéo dài từ ngực nối cổ tay
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(-100, -14); ctx.lineTo(-radius-5, -14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-100, 14); ctx.lineTo(-radius-5, 14); ctx.stroke();
    
    // Gốc bàn tay bao quanh mặt sau viên bi
    ctx.beginPath();
    ctx.ellipse(-radius - 5, 0, 14, 20, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Đệm thịt to lòng bàn tay bóp
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath(); ctx.ellipse(-radius - 8, 0, 6, 10, 0, 0, Math.PI*2); ctx.fill();
    
    // Vẽ các ngón tay nhỏ (đệm thịt) đang quặp/kẹp viên bi thuỷ tinh
    // Viên bi đang nằm ở (0,0) nên kẹp từ trên (radius) và dưới (radius)
    const drawPinchBean = (bx, by) => {
        ctx.fillStyle = '#f4a460';
        ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffb6c1';
        ctx.beginPath(); ctx.arc(bx + 1.5, by, 3.5, 0, Math.PI*2); ctx.fill();
    };
    
    drawPinchBean(0, -radius - 2);  // Kẹp đè bi từ trên
    drawPinchBean(-radius + 2, -14); // Rìa trên phụ
    drawPinchBean(0, radius + 2);   // Kẹp giữ bi từ dưới
    drawPinchBean(-radius + 2, 14);  // Rìa dưới phụ
    
    ctx.restore(); // RELEASE RIGHT PAW
    // Không cần release thêm vì đã release block WORLD SPACE ở giữa rồi
}

// Elastic collision resolution
function resolveCollision(m1, m2) {
    const xVelocityDiff = m1.vel.x - m2.vel.x;
    const yVelocityDiff = m1.vel.y - m2.vel.y;

    const xDist = m2.pos.x - m1.pos.x;
    const yDist = m2.pos.y - m1.pos.y;

    // Prevent accidental overlap from sticking
    if (xVelocityDiff * xDist + yVelocityDiff * yDist >= 0) {
        const angle = -Math.atan2(m2.pos.y - m1.pos.y, m2.pos.x - m1.pos.x);

        // Mass is 1 for both
        const m1Mass = m1.mass;
        const m2Mass = m2.mass;

        // Velocity components along the collision axis
        const u1 = rotate(m1.vel, angle);
        const u2 = rotate(m2.vel, angle);

        // 1D Collision equations
        const v1 = { x: u2.x, y: u1.y };
        const v2 = { x: u1.x, y: u2.y };

        // Rotate back
        const vFinal1 = rotate(v1, -angle);
        const vFinal2 = rotate(v2, -angle);

        // Apply new velocities (add some dampening to simulate imperfect collision)
        let bounceDampening = 0.95;
        m1.vel = new Vector(vFinal1.x * bounceDampening, vFinal1.y * bounceDampening);
        m2.vel = new Vector(vFinal2.x * bounceDampening, vFinal2.y * bounceDampening);
    }
}

function rotate(velocity, angle) {
    return {
        x: velocity.x * Math.cos(angle) - velocity.y * Math.sin(angle),
        y: velocity.x * Math.sin(angle) + velocity.y * Math.cos(angle)
    };
}

function separateMarbles(m1, m2, dist) {
    // Push marbles apart if they overlap to prevent getting stuck
    const overlap = (m1.radius + m2.radius) - dist;
    const pushVector = m1.pos.sub(m2.pos).normalize().mult(overlap / 2);
    m1.pos = m1.pos.add(pushVector);
    m2.pos = m2.pos.sub(pushVector);
}

function checkCollisions() {
    for (let i = 0; i < marbles.length; i++) {
        for (let j = i + 1; j < marbles.length; j++) {
            let m1 = marbles[i];
            let m2 = marbles[j];
            if (!m1.active || !m2.active) continue;

            let dist = m1.pos.dist(m2.pos);
            if (dist < m1.radius + m2.radius) {
                separateMarbles(m1, m2, dist);
                resolveCollision(m1, m2);
            }
        }
    }
}

function checkArenaBounds() {
    for (let m of marbles) {
        if (!m.active) continue;

        let distToCenter = m.pos.dist(new Vector(ARENA_X, ARENA_Y));
        
        // Only trigger immediate knockout for target marbles
        if (distToCenter > ARENA_RADIUS + m.radius) {
            if (!m.isCue) {
                // Target marble out of bounds -> Score!
                score += 100;
                updateUI();
                m.active = false;
            }
        }
        
        // Wall boundaries to prevent losing them completely offscreen (applies to all, including cue ball)
        if (m.pos.x - m.radius < 0) { m.pos.x = m.radius; m.vel.x *= -1; }
        if (m.pos.x + m.radius > CANVAS_WIDTH) { m.pos.x = CANVAS_WIDTH - m.radius; m.vel.x *= -1; }
        if (m.pos.y - m.radius < 0) { m.pos.y = m.radius; m.vel.y *= -1; }
        if (m.pos.y + m.radius > CANVAS_HEIGHT) { m.pos.y = CANVAS_HEIGHT - m.radius; m.vel.y *= -1; }
    }
}

function updateUI() {
    scoreEl.innerText = score;
    turnsEl.innerText = turnsLeft;
}

function gameLoop() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    drawArena();

    let anyMoving = false;

    // Remove inactive marbles
    marbles = marbles.filter(m => m.active);

    for (let m of marbles) {
        if (gameState === 'MOVING') {
            m.update();
            if (m.vel.mag() > 0) anyMoving = true;
        }

        // Bỏ qua vẽ bi cái tại vị trí gốc vật lý nếu đang ngắm/chờ (để vẽ nó cùng tay mèo cho đồng bộ)
        if ((gameState === 'AIMING' || gameState === 'IDLE') && m.isCue) continue;

        m.draw(ctx);
    }

    if (gameState === 'MOVING') {
        checkCollisions();
        checkArenaBounds();

        if (!anyMoving) {
            // Turn ended
            turnsLeft--;
            
            // Check cue ball position to see if it fell out
            const cueActive = marbles.find(m => m.isCue);
            if (cueActive) {
                let distToCenter = cueActive.pos.dist(new Vector(ARENA_X, ARENA_Y));
                if (distToCenter > ARENA_RADIUS + cueActive.radius) {
                    score -= 50;
                    cueActive.active = false; // Remove it
                }
            }

            updateUI();
            
            // Check if win (all target marbles gone)
            const targetMarblesLeft = marbles.filter(m => !m.isCue && m.active).length;

            if (turnsLeft <= 0 || targetMarblesLeft === 0) {
                endGame();
            } else {
                gameState = 'IDLE';
                // Reset cue marble if it was penalized and removed
                const activeCue = marbles.find(m => m.isCue && m.active);
                if (!activeCue) {
                    resetCueMarble();
                }
            }
        }
    }

    drawAimLine();

    requestAnimationFrame(gameLoop);
}

// ============================================================
// INPUT HANDLING - Unified Mouse + Touch (Native, no MouseEvent dispatch)
// ============================================================

function getClientPos(clientX, clientY) {
    // Canvas fills viewport directly (no CSS transform scale)
    // clientX/Y and canvas pixels are 1:1 (canvas size == window size)
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (canvas.width  / rect.width),
        y: (clientY - rect.top)  * (canvas.height / rect.height)
    };
}

// Compatibility shim cho code cũ vẫn dùng getMousePos
function getMousePos(evt) {
    return getClientPos(evt.clientX, evt.clientY);
}

// --- Shared core logic ---
function handlePointerDown(clientX, clientY) {
    if (gameState !== 'IDLE' || !cueMarble) return;
    const pos = getClientPos(clientX, clientY);
    const mPos = new Vector(pos.x, pos.y);
    // Vùng chạm lớn hơn để dùng ngón tay dễ hơn
    const hitRadius = cueMarble.radius * 4;
    if (mPos.dist(cueMarble.pos) < hitRadius) {
        isDragging = true;
        gameState = 'AIMING';
        mouseX = pos.x;
        mouseY = pos.y;
    }
}

function handlePointerMove(clientX, clientY) {
    const pos = getClientPos(clientX, clientY);
    mouseX = pos.x;
    mouseY = pos.y;
}

function handlePointerUp(clientX, clientY) {
    if (!isDragging || gameState !== 'AIMING') return;
    isDragging = false;

    const pos = getClientPos(clientX, clientY);
    let dragDiff = new Vector(pos.x - cueMarble.pos.x, pos.y - cueMarble.pos.y);

    if (dragDiff.mag() > MAX_DRAG_DIST) {
        dragDiff = dragDiff.normalize().mult(MAX_DRAG_DIST);
    }

    if (dragDiff.mag() > 5) {
        cueMarble.vel = dragDiff.mult(-POWER_MULTIPLIER);
        gameState = 'MOVING';
    } else {
        gameState = 'IDLE';
    }
}

// --- Mouse Events ---
canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handlePointerDown(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
    handlePointerMove(e.clientX, e.clientY);
});

window.addEventListener('mouseup', (e) => {
    handlePointerUp(e.clientX, e.clientY);
});

// --- Touch Events (native, không dùng MouseEvent dispatch) ---
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Tắt scroll/zoom khi chơi
    const t = e.changedTouches[0];
    if (t) handlePointerDown(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault(); // Tắt scroll trang khi kéo
    const t = e.changedTouches[0];
    if (t) handlePointerMove(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (t) handlePointerUp(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
    // Bị gián đoạn (vd: cuộc gọi đến) → huỷ lượt
    isDragging = false;
    if (gameState === 'AIMING') gameState = 'IDLE';
});




// Leaderboard Logic
const LEADERBOARD_KEY = 'banBiLeaderboard';

function saveScore(newScore) {
    let scores = JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
    
    // Add new score
    scores.push({ score: newScore, date: new Date().toLocaleDateString() });
    
    // Sort descending
    scores.sort((a, b) => b.score - a.score);
    
    // Keep top 5
    scores = scores.slice(0, 5);
    
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(scores));
    return scores;
}

function updateLeaderboardUI(scores) {
    leaderboardList.innerHTML = '';
    standaloneLeaderboardList.innerHTML = '';
    
    if (scores.length === 0) {
        leaderboardList.innerHTML = '<li>Chưa có dữ liệu</li>';
        standaloneLeaderboardList.innerHTML = '<li>Chưa có dữ liệu</li>';
        return;
    }

    scores.forEach((entry, index) => {
        const html = `<span>#${index + 1}</span> <span>${entry.score} điểm</span> <span>${entry.date}</span>`;
        const li = document.createElement('li');
        li.innerHTML = html;
        leaderboardList.appendChild(li);
        
        const liStand = document.createElement('li');
        liStand.innerHTML = html;
        standaloneLeaderboardList.appendChild(liStand);
    });
}

function endGame() {
    gameState = 'GAMEOVER';
    
    // Bonus points logic
    let bonus = 0;
    const targetMarblesLeft = marbles.filter(m => !m.isCue && m.active).length;
    
    if (targetMarblesLeft === 0 && turnsLeft > 0) {
        // Player won, calculate bonus (e.g. 50 points per remaining turn)
        bonus = turnsLeft * 50;
        endTitleEl.innerText = "CHIẾN THẮNG!";
        endTitleEl.style.color = "#44ff44";
        
        bonusInfoEl.innerText = `Thưởng lượt thừa (${turnsLeft} lượt x 50): +${bonus}`;
        bonusInfoEl.classList.remove('hidden');
    } else {
        // Player lost (ran out of turns)
        endTitleEl.innerText = "HẾT LƯỢT!";
        endTitleEl.style.color = "#ff4444";
        bonusInfoEl.classList.add('hidden');
    }
    
    score += bonus;
    finalScoreEl.innerText = score;
    
    // Save to leaderboard
    const topScores = saveScore(score);
    updateLeaderboardUI(topScores);
    
    gameOverModal.classList.remove('hidden');
}

restartBtn.addEventListener('click', () => {
    initGame();
});

// Layout and Modal Logic
rulesBtn.addEventListener('click', () => {
    leaderboardModalStandalone.classList.add('hidden'); // Close other popup
    rulesModal.classList.remove('hidden');
});

closeRulesBtn.addEventListener('click', () => {
    rulesModal.classList.add('hidden');
});

leaderboardBtn.addEventListener('click', () => {
    rulesModal.classList.add('hidden'); // Close other popup
    let scores = JSON.parse(localStorage.getItem(LEADERBOARD_KEY)) || [];
    scores.sort((a, b) => b.score - a.score);
    updateLeaderboardUI(scores);
    leaderboardModalStandalone.classList.remove('hidden');
});

closeLeaderboardBtn.addEventListener('click', () => {
    leaderboardModalStandalone.classList.add('hidden');
});

// Press ESC to close any modal
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        rulesModal.classList.add('hidden');
        leaderboardModalStandalone.classList.add('hidden');
    }
});

// Start game
initGame();
gameLoop();

