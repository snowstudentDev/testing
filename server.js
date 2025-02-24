const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const shortid = require('shortid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const gameServers = new Map();

class GameServer {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.timeLeft = 10;
    this.gameInterval = null;
    this.status = 'waiting';
  }

  startGame() {
    this.status = 'playing';
    this.timeLeft = 10;
    this.gameInterval = setInterval(() => {
      this.timeLeft--;
      io.to(this.code).emit('timeUpdate', this.timeLeft);
      if (this.timeLeft <= 0) this.endGame();
    }, 1000);
  }

  endGame() {
    clearInterval(this.gameInterval);
    this.status = 'finished';
    const activePlayers = Array.from(this.players.values()).filter(p => p.joined);
    const winner = activePlayers.length ? activePlayers.reduce((a, b) => a.clicks > b.clicks ? a : b) : null;
    io.to(this.code).emit('gameMessage', 
      winner ? `${winner.username} wins with ${winner.clicks} clicks!` : 'No participants!'
    );
    setTimeout(() => this.resetGame(), 5000);
  }

  resetGame() {
    this.players.forEach(p => p.joined && (p.clicks = 0));
    this.status = 'waiting';
    this.timeLeft = 10;
    io.to(this.code).emit('gameReset', Array.from(this.players.values()));
    this.startGame();
  }
}

app.use(express.static('public'));

io.on('connection', (socket) => {
  socket.on('createServer', () => {
    const code = shortid.generate().toUpperCase();
    gameServers.set(code, new GameServer(code));
    socket.emit('serverCode', code);
    updateServerList();
  });

  socket.on('joinServer', ({ code, username, joinGame }) => {
    const server = gameServers.get(code);
    if (!server) return socket.emit('error', 'Invalid server code');
    
    socket.join(code);
    server.players.set(socket.id, {
      username,
      clicks: joinGame ? 0 : null,
      joined: joinGame,
      id: socket.id
    });
    
    socket.emit('joinedServer', {
      code,
      players: Array.from(server.players.values()),
      timeLeft: server.timeLeft
    });
    
    updateServerList();
    io.to(code).emit('playersUpdate', Array.from(server.players.values()));
  });

  socket.on('playerAction', ({ code, type }) => {
    const server = gameServers.get(code);
    const player = server?.players.get(socket.id);
    
    if (type === 'click' && player?.joined) {
      player.clicks++;
      io.to(code).emit('playersUpdate', Array.from(server.players.values()));
    }
    
    if (type === 'reset') server?.resetGame();
  });

  socket.on('chatMessage', ({ code, message }) => {
    const server = gameServers.get(code);
    const player = server?.players.get(socket.id);
    if (player) io.to(code).emit('chatMessage', {
      username: player.username,
      message
    });
  });

  socket.on('disconnect', () => {
    gameServers.forEach(server => {
      if (server.players.has(socket.id)) {
        server.players.delete(socket.id);
        io.to(server.code).emit('playersUpdate', Array.from(server.players.values()));
        updateServerList();
      }
    });
  });
});

function updateServerList() {
  const servers = Array.from(gameServers.entries()).map(([code, server]) => ({
    code,
    players: server.players.size,
    status: server.status
  }));
  io.emit('serverList', servers);
}

server.listen(3000, () => console.log('Server running on port 3000'));