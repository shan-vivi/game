import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Trong thực tế nên giới hạn ở domain của bạn
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();
const socketToPlayer = new Map(); // socket.id -> { roomId, name }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-room', ({ roomId, name }) => {
    socket.join(roomId);
    const players = [{ id: socket.id, name, score: 0, ready: true }];
    rooms.set(roomId, {
      players: players,
      status: 'waiting'
    });
    socketToPlayer.set(socket.id, { roomId, name });
    console.log(`Room ${roomId} created by ${name}`);
    socket.emit('room-joined', { roomId, playerId: socket.id });
    io.to(roomId).emit('player-list-update', players);
  });

  socket.on('join-room', ({ roomId, name }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', 'Phòng không tồn tại!');
      return;
    }
    if (room.status === 'playing') {
      socket.emit('error', 'Trận đấu đã bắt đầu, không thể vào!');
      return;
    }
    if (room.players.length >= 10) {
      socket.emit('error', 'Phòng đã đầy!');
      return;
    }

    socket.join(roomId);
    room.players.push({ id: socket.id, name, score: 0, ready: false });
    socketToPlayer.set(socket.id, { roomId, name });
    console.log(`${name} joined room ${roomId}`);
    
    socket.emit('room-joined', { roomId, playerId: socket.id });
    io.to(roomId).emit('player-list-update', room.players);
  });

  socket.on('toggle-ready', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      const player = room.players.find(p => p.id === socket.id);
      if (player) {
        player.ready = !player.ready;
        io.to(roomId).emit('player-list-update', room.players);
      }
    }
  });

  // Bắt đầu game
  socket.on('start-game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) {
      room.status = 'playing';
      
      // Tạo vị trí bi ban đầu chuẩn (%) cho TỪNG người chơi
      const initialMarbles = [];
      const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
      
      room.players.forEach((player, pIdx) => {
        // Bi con ở giữa
        initialMarbles.push({ id: `${pIdx}_target_0`, pid: pIdx, nx: 0, ny: 0, color: colors[0], isCue: false, active: true });
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const dist = 0.2;
          initialMarbles.push({
            id: `${pIdx}_target_${i+1}`,
            pid: pIdx,
            nx: Math.cos(angle) * dist,
            ny: Math.sin(angle) * dist,
            color: colors[(i % 5) + 1],
            isCue: false,
            active: true
          });
        }
        // Bi cái
        initialMarbles.push({ id: `${pIdx}_cue`, pid: pIdx, nx: 0, ny: 0.8, color: '#fff', isCue: true, active: true });
      });

      io.to(roomId).emit('init-online-game', { 
        players: room.players,
        initialMarbles: initialMarbles 
      });
    }
  });

  // Đồng bộ ngắm (real-time)
  socket.on('aim', (data) => {
    socket.to(data.roomId).emit('opponent-aim', data);
  });

  // Đồng bộ hành động bắn
  socket.on('shoot', (data) => {
    // data: { roomId, forceX, forceY, playerId }
    socket.to(data.roomId).emit('opponent-shoot', data);
  });

  // Đồng bộ trạng thái game (điểm, lượt) để tránh lệch pha vật lý
  socket.on('game-state-update', (data) => {
    socket.to(data.roomId).emit('sync-game-state', data);
  });

  // Đồng bộ vị trí thực tế trong khi bi đang chạy (Real-time movement sync)
  socket.on('update-marbles', (data) => {
    socket.to(data.roomId).emit('opponent-marbles-sync', data);
  });

  socket.on('disconnect', () => {
    const pData = socketToPlayer.get(socket.id);
    if (pData) {
      const { roomId } = pData;
      const room = rooms.get(roomId);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        socketToPlayer.delete(socket.id);
        
        if (room.players.length === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (empty)`);
        } else {
          // Nếu người đầu tiên thoát, người thứ 2 lên làm chủ phòng và auto-ready
          room.players[0].ready = true;
          io.to(roomId).emit('player-list-update', room.players);
          console.log(`Player left room ${roomId}. New owner: ${room.players[0].name}`);
        }
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
