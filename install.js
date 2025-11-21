const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("⛳ Installing KYRO: Deployment Ready (Render/Railway compatible)...");

// 1. Create Directory Structure
const dirs = ['public'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

// 2. Define File Contents

// --- .gitignore (Crucial for deployment) ---
const gitignore = `
node_modules/
.DS_Store
*.log
.env
`;

// --- package.json (Added engines for cloud hosts) ---
const packageJson = {
  "name": "kyro-card-game",
  "version": "3.3.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18.x"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2"
  }
};

// --- server.js (Added Dynamic Port Logic) ---
const serverJs = `
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- GAME CONSTANTS ---
const SUITS = ['♥', '♦', '♣', '♠']; 
const VALUES = [
    { val: 'A', score: 1 }, { val: '2', score: 2 }, { val: '3', score: 3 },
    { val: '4', score: 4 }, { val: '5', score: 5 }, { val: '6', score: 6 },
    { val: '7', score: 7 }, { val: '8', score: 8 }, { val: '9', score: 9 },
    { val: '10', score: 10 }, 
    { val: 'J', score: 0, power: 'PEEK' },
    { val: 'Q', score: 10, power: 'SPY' },
    { val: 'K', score: 0, power: 'SWAP' },
    { val: 'JOKER', score: -2, power: 'SWAP' }
];

const rooms = {};
const socketMap = {}; 

function createDeck() {
    let deck = [];
    SUITS.forEach(s => {
        VALUES.forEach(v => {
            if (v.val !== 'JOKER') deck.push({ ...v, suit: s, id: Math.random().toString(36).substr(2, 9) });
        });
    });
    deck.push({ ...VALUES.find(v => v.val === 'JOKER'), suit: '', id: Math.random().toString(36) });
    deck.push({ ...VALUES.find(v => v.val === 'JOKER'), suit: '', id: Math.random().toString(36) });
    return deck.sort(() => Math.random() - 0.5);
}

function calculateScore(hand) {
    return hand.reduce((acc, item) => {
        let val = item.card.val;
        let score = 0;
        if (val === 'JOKER') score = -2;
        else if (val === 'K') score = 0;
        else if (['J','Q','10'].includes(val)) score = 10;
        else if (val === 'A') score = 1;
        else score = parseInt(val);
        return acc + score;
    }, 0);
}

io.on('connection', (socket) => {
    
    // JOIN GAME (With Reconnect Logic)
    socket.on('joinGame', ({ roomId, token }) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();
        
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                players: [],
                state: 'LOBBY',
                deck: [],
                discardPile: [],
                turnIndex: 0,
                activePower: null,
                swapSelection: null,
                penaltyPending: false,
                hasMatched: false,
                drawnCard: null,
                kyroCallerId: null,
                peeksRemaining: {},
                lastSwapInfo: { timestamp: 0 },
                disconnectTimer: null
            };
        }
        const room = rooms[roomId];
        
        let player = room.players.find(p => p.token === token);
        
        if (player) {
            player.id = socket.id;
            player.connected = true;
            if (room.disconnectTimer && room.players.every(p => p.connected)) {
                clearTimeout(room.disconnectTimer);
                room.disconnectTimer = null;
            }
        } else {
            if (room.players.length < 2) {
                room.players.push({ 
                    id: socket.id, 
                    token: token, 
                    connected: true,
                    hand: [], 
                    score: 0, 
                    name: 'Player ' + (room.players.length + 1) 
                });
            } else {
                socket.emit('error', 'Room Full');
                return;
            }
        }

        socket.join(roomId);
        socketMap[socket.id] = { roomId, token };
        io.to(roomId).emit('gameState', room);
    });

    socket.on('disconnect', () => {
        const info = socketMap[socket.id];
        if (info) {
            const room = rooms[info.roomId];
            if (room) {
                const player = room.players.find(p => p.token === info.token);
                if (player) {
                    player.connected = false;
                    if (room.state !== 'LOBBY' && !room.disconnectTimer) {
                        room.disconnectTimer = setTimeout(() => { delete rooms[info.roomId]; }, 60000); 
                    }
                    if (room.state === 'LOBBY') {
                        room.players = room.players.filter(p => p.token !== info.token);
                    }
                    io.to(room.id).emit('gameState', room);
                }
            }
            delete socketMap[socket.id];
        }
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players.length < 2) return;

        room.deck = createDeck();
        room.discardPile = [room.deck.pop()];
        room.activePower = null;
        room.drawnCard = null;
        room.penaltyPending = false;
        room.hasMatched = false;
        room.kyroCallerId = null;
        room.state = 'PEEKING';
        room.lastSwapInfo = { timestamp: Date.now(), type: 'RESET' };
        
        room.players.forEach(p => {
            p.hand = [
                { card: room.deck.pop(), visible: false }, 
                { card: room.deck.pop(), visible: false }, 
                { card: room.deck.pop(), visible: false }, 
                { card: room.deck.pop(), visible: false }  
            ];
            p.score = 0;
            room.peeksRemaining[p.id] = 2;
        });

        io.to(roomId).emit('gameState', room);
        io.to(roomId).emit('startPeek', { duration: 5000 });
        
        setTimeout(() => {
            if(room.state === 'PEEKING') {
                room.state = 'PLAYING';
                room.turnIndex = Math.floor(Math.random() * room.players.length);
                io.to(roomId).emit('gameState', room);
            }
        }, 5500);
    });

    socket.on('peekCard', (data) => {
        const room = rooms[data.roomId];
        if (room && room.state === 'PEEKING' && room.peeksRemaining[socket.id] > 0) {
            const player = room.players.find(p => p.id === socket.id);
            socket.emit('peekResult', { card: player.hand[data.cardIndex].card });
            room.peeksRemaining[socket.id]--;
            io.to(room.id).emit('gameState', room);
        }
    });

    socket.on('action', (data) => {
        const { roomId, type, payload } = data;
        const room = rooms[roomId];
        if (!room) return;
        const playerIdx = room.players.findIndex(p => p.id === socket.id);
        const oppIdx = playerIdx === 0 ? 1 : 0;

        if (type === 'CALL_KYRO' && room.state === 'PLAYING' && !room.drawnCard && !room.penaltyPending) {
            room.kyroCallerId = socket.id;
            endGame(room);
            return;
        }

        if (room.state !== 'PLAYING' || room.turnIndex !== playerIdx) return;

        if (type === 'ATTEMPT_MATCH' && !room.hasMatched && !room.penaltyPending) {
            const { targetOwnerId, cardIndex } = payload;
            const targetPlayer = room.players.find(p => p.id === targetOwnerId);
            const targetCard = targetPlayer.hand[cardIndex].card;
            const topDiscard = room.discardPile[room.discardPile.length - 1];

            if (targetCard.val === topDiscard.val) {
                room.hasMatched = true;
                targetPlayer.hand.splice(cardIndex, 1);
                room.discardPile.push(targetCard);
                if (targetOwnerId !== socket.id) room.penaltyPending = true;
                io.to(roomId).emit('matchResult', { success: true, msg: "SNAP!" });
            } else {
                const penaltyCard = room.deck.pop();
                if (penaltyCard) {
                    room.players[playerIdx].hand.push({ card: penaltyCard, visible: false });
                    io.to(roomId).emit('matchResult', { success: false, msg: "FAIL! +1 CARD" });
                }
            }
            io.to(roomId).emit('gameState', room);
            return;
        }

        if (type === 'GIVE_CARD' && room.penaltyPending) {
            const { handIndex } = payload;
            const myCard = room.players[playerIdx].hand[handIndex];
            room.players[playerIdx].hand.splice(handIndex, 1);
            myCard.visible = false;
            room.players[oppIdx].hand.push(myCard);
            room.penaltyPending = false;
            room.lastSwapInfo = { timestamp: Date.now(), type: 'GIVE_PENALTY', fromId: socket.id, toId: room.players[oppIdx].id };
            io.to(roomId).emit('gameState', room);
            return;
        }

        if (room.penaltyPending) return;

        if (type === 'DRAW_STOCK' && !room.drawnCard && !room.activePower) {
            room.drawnCard = room.deck.pop();
            if(!room.deck.length) endGame(room);
        }

        if (type === 'DRAW_DISCARD' && !room.drawnCard && !room.activePower) {
            room.drawnCard = room.discardPile.pop();
            room.drawnCard.fromDiscard = true; 
        }

        if (type === 'SWAP_CARD' && room.drawnCard) {
            const oldCard = room.players[playerIdx].hand[payload.handIndex].card;
            room.players[playerIdx].hand[payload.handIndex].card = room.drawnCard;
            room.players[playerIdx].hand[payload.handIndex].visible = false; 
            room.discardPile.push(oldCard);
            room.lastSwapInfo = { timestamp: Date.now(), type: 'HAND_SWAP', playerId: socket.id, cardIndex: payload.handIndex };
            delete room.drawnCard.fromDiscard;
            endTurn(room);
        }

        if (type === 'DISCARD_DRAWN' && room.drawnCard && !room.drawnCard.fromDiscard) {
            const card = room.drawnCard;
            room.discardPile.push(card);
            room.drawnCard = null;
            if (card.power) room.activePower = card.power;
            else endTurn(room);
        }

        if (type === 'USE_POWER' && room.activePower) {
            const { targetPlayerId, cardIndex } = payload;
            if (room.activePower === 'PEEK') {
                if(targetPlayerId === socket.id) {
                    socket.emit('peekResult', { card: room.players[playerIdx].hand[cardIndex].card });
                    endTurn(room);
                }
            } else if (room.activePower === 'SPY') {
                if(targetPlayerId !== socket.id) {
                    socket.emit('peekResult', { card: room.players[oppIdx].hand[cardIndex].card });
                    endTurn(room);
                }
            } else if (room.activePower === 'SWAP') {
                if (!room.swapSelection) {
                    room.swapSelection = { targetPlayerId, cardIndex };
                } else {
                    const sel1 = room.swapSelection;
                    const sel2 = { targetPlayerId, cardIndex };
                    const p1 = room.players.find(p => p.id === sel1.targetPlayerId);
                    const p2 = room.players.find(p => p.id === sel2.targetPlayerId);
                    const card1 = p1.hand[sel1.cardIndex].card;
                    const card2 = p2.hand[sel2.cardIndex].card;
                    p1.hand[sel1.cardIndex].card = card2;
                    p2.hand[sel2.cardIndex].card = card1;
                    room.lastSwapInfo = { timestamp: Date.now(), type: 'POWER_SWAP', player1Id: sel1.targetPlayerId, player1Index: sel1.cardIndex, player2Id: sel2.targetPlayerId, player2Index: sel2.cardIndex };
                    room.swapSelection = null;
                    endTurn(room);
                }
            }
        }
        
        if(type === 'FINISH_POWER') {
             room.swapSelection = null;
             endTurn(room);
        }
        
        io.to(roomId).emit('gameState', room);
    });

    function endTurn(room) {
        room.drawnCard = null;
        room.activePower = null;
        room.hasMatched = false;
        room.penaltyPending = false;
        room.swapSelection = null;
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        if(room.players.some(p => p.hand.length === 0)) endGame(room);
    }

    function endGame(room) {
        room.state = 'GAME_OVER';
        room.players.forEach(p => {
            p.rawScore = calculateScore(p.hand);
            p.finalScore = p.rawScore;
            p.hand.forEach(c => c.visible = true);
        });
        if (room.kyroCallerId) {
            const caller = room.players.find(p => p.id === room.kyroCallerId);
            const opponent = room.players.find(p => p.id !== room.kyroCallerId);
            if (caller && opponent) {
                if (caller.rawScore >= opponent.rawScore) caller.finalScore = caller.rawScore * 2;
                else caller.finalScore = 0;
            }
        }
        io.to(room.id).emit('gameState', room);
    }
});

// *** DEPLOYMENT PORT FIX ***
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
`;

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>KYRO</title>
    <link rel="stylesheet" href="style.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Mono:ital,wght@0,400;0,700;1,700&display=swap" rel="stylesheet">
</head>
<body>
    <div id="app">
        <div id="disconnect-overlay" class="hidden">
            <h2>CONNECTION LOST</h2>
            <p>OPPONENT DISCONNECTED...</p>
            <div class="loader"></div>
            <p id="disconnect-timer">WAITING FOR RECONNECT</p>
        </div>

        <div id="login-screen" class="screen active">
            <div class="title-stack">
                <h1>KYRO</h1>
                <span class="subtitle">NEO EDITION</span>
            </div>
            <div class="menu-container">
                <button id="create-btn" class="neo-btn primary">CREATE LOBBY</button>
                <div class="divider">/// OR ///</div>
                <div id="join-area">
                    <div id="join-input-container">
                        <input type="text" id="room-input" placeholder="ROOM CODE" maxlength="5">
                        <button id="confirm-join-btn" class="neo-btn icon-btn">➜</button>
                    </div>
                </div>
                <button id="how-to-play-btn" class="neo-btn outline">HOW TO PLAY</button>
            </div>
        </div>

        <div id="game-screen" class="screen">
            <div id="instruction-toast" class="hidden">WAITING FOR ACTION...</div>
            <div id="countdown-overlay" class="hidden">
                <div class="timer-box"><span id="timer-val">5</span></div>
                <p>MEMORISE YOUR CARDS</p>
            </div>
            <div id="game-over-overlay" class="hidden">
                <h2>GAME OVER</h2>
                <div id="leaderboard"></div>
                <button id="lobby-btn" class="neo-btn primary">BACK TO LOBBY</button>
            </div>

            <div class="top-bar">
                <div class="status-wrapper">
                    <div id="status">CONNECTING...</div>
                    <div id="room-code-display">CODE: ---</div>
                </div>
                <button id="copy-link-btn" class="neo-btn small">🔗 COPY</button>
            </div>
            
            <div class="hand-grid opponent" id="opp-hand"></div>
            
            <div class="table-area">
                <div class="pile-container">
                    <div class="pile stock" id="stock">
                        <div class="card-back-pattern"></div>
                        <div class="pile-text">DRAW</div>
                    </div>
                </div>
                <button id="kyro-btn" class="kyro-btn hidden">KYRO</button>
                <div id="drawn-card-container" class="drawn-wrapper hidden">
                    <div id="drawn-card-slot" class="drawn-card"></div>
                    <button id="trash-btn" class="trash-btn">🗑</button>
                </div>
                <div class="pile-container">
                    <div class="pile discard" id="discard">
                        <div class="empty-slot"></div>
                    </div>
                    <span class="pile-label-bottom">DISCARD</span>
                </div>
            </div>
            
            <div id="power-overlay" class="hidden">
                <div class="power-badge">POWER ACTIVE</div>
            </div>
            <div class="hand-grid my-hand" id="my-hand"></div>
            <div class="bottom-bar"><button id="start-btn" class="neo-btn secondary hidden">START MATCH</button></div>
        </div>
        
        <div id="modal" class="hidden"><div id="modal-content"></div><button id="close-modal" class="neo-btn primary">CONFIRM</button></div>
        
        <div id="rules-modal" class="hidden">
            <div class="rules-content">
                <h2>HOW TO PLAY</h2>
                <ul>
                    <li><strong>GOAL:</strong> Lowest score wins.</li>
                    <li><strong>START:</strong> Peek at 2 of your cards.</li>
                    <li><strong>DRAW:</strong> Take from Pile or Discard.</li>
                    <li><strong>MATCH:</strong> Snap match cards to the Discard!</li>
                    <li><strong>POWERS:</strong> J=Peek, Q=Spy, K=Swap.</li>
                    <li><strong>KYRO:</strong> End game if you're winning.</li>
                </ul>
                <button id="close-rules" class="neo-btn primary">GOT IT</button>
            </div>
        </div>

        <div id="match-toast" class="hidden">MATCH!</div>
        <div id="swap-notification" class="hidden">SWAP!</div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script src="game.js"></script>
</body>
</html>`;

const styleCss = `
:root {
    --bg: #0f172a; --surface: #1e293b; --primary: #ccff00; --secondary: #06b6d4;
    --accent: #d946ef; --danger: #ef4444; --border-color: #000000; --text: #ffffff;
    --card-face: #f1f5f9; --card-back-1: #334155; --card-back-2: #1e293b;
    --font-header: 'Archivo Black', sans-serif; --font-body: 'Space Mono', monospace;
    --border-thick: 3px solid var(--border-color);
    --shadow-hard: 5px 5px 0px var(--border-color);
    --shadow-hover: 2px 2px 0px var(--border-color);
}
* { box-sizing: border-box; user-select: none; -webkit-tap-highlight-color: transparent; }
body { margin: 0; font-family: var(--font-body); background-color: var(--bg); color: var(--text); overflow: hidden; background-image: radial-gradient(#334155 1px, transparent 1px); background-size: 20px 20px; }
#app { display: flex; flex-direction: column; height: 100vh; width: 100%; align-items: center; justify-content: center; position: relative; }
.screen { display: none; width: 100%; height: 100%; flex-direction: column; justify-content: space-between; padding: 10px; max-width: 500px; margin: 0 auto; }
.screen.active { display: flex; }
h1 { font-family: var(--font-header); font-size: 4.5rem; color: var(--primary); text-transform: uppercase; margin: 0; line-height: 0.9; text-shadow: 5px 5px 0px black; transform: skew(-5deg); }
.subtitle { font-size: 1.2rem; letter-spacing: 4px; color: var(--secondary); font-weight: bold; background: black; padding: 2px 10px; }
.title-stack { display: flex; flex-direction: column; align-items: center; margin-bottom: 40px; }
.menu-container { width: 100%; display: flex; flex-direction: column; gap: 15px; align-items: center; }
.divider { background: #000; color: #fff; padding: 5px 10px; font-weight: bold; font-size: 0.8rem; transform: rotate(-2deg); border: 1px solid white; }
.neo-btn { width: 100%; padding: 16px; border: var(--border-thick); border-radius: 8px; font-family: var(--font-body); font-weight: 700; font-size: 1.1rem; text-transform: uppercase; cursor: pointer; box-shadow: var(--shadow-hard); transition: all 0.1s; display: flex; align-items: center; justify-content: center; }
.neo-btn:active { transform: translate(3px, 3px); box-shadow: var(--shadow-hover); }
.neo-btn.primary { background: var(--primary); color: black; }
.neo-btn.secondary { background: var(--secondary); color: black; }
.neo-btn.outline { background: white; color: black; }
.neo-btn.icon-btn { width: auto; padding: 0 20px; background: var(--accent); color: white; }
.neo-btn.small { padding: 5px 15px; font-size: 0.8rem; width: auto; background: var(--surface); color: white; border: 2px solid white; box-shadow: 3px 3px 0px black; }
#join-input-container { display: flex; gap: 10px; width: 100%; }
#room-input { flex-grow: 1; padding: 15px; border: var(--border-thick); background: white; color: black; font-family: var(--font-body); font-weight: 700; font-size: 1.2rem; text-align: center; text-transform: uppercase; border-radius: 8px; box-shadow: var(--shadow-hard); }
.top-bar { background: var(--surface); border: 2px solid #fff; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; box-shadow: 4px 4px 0px rgba(0,0,0,0.5); margin-bottom: 10px; }
#status { font-weight: bold; color: var(--primary); font-size: 1rem; }
#room-code-display { font-size: 0.8rem; color: #aaa; margin-top: 2px; }
.hand-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; padding: 10px; min-height: 130px; }
.hand-grid.opponent { transform: scale(0.9); opacity: 0.8; }
.card { width: 80px; height: 115px; background: var(--card-face); border: 3px solid black; border-radius: 8px; display: flex; justify-content: center; align-items: center; position: relative; box-shadow: 4px 4px 0px rgba(0,0,0,1); transition: transform 0.1s; font-family: var(--font-header); font-size: 2rem; color: black; }
.card:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0px black; }
.card.face-down { background: repeating-linear-gradient(45deg, var(--card-back-1), var(--card-back-1) 10px, var(--card-back-2) 10px, var(--card-back-2) 20px); border: 3px solid #fff; }
.card.face-down span, .card.face-down .suit { display: none; }
.suit { position: absolute; top: 5px; right: 5px; font-size: 1.2rem; }
.card.red { color: var(--danger); }
.power-icon { position: absolute; bottom: 5px; right: 5px; font-size: 0.7rem; background: black; color: white; padding: 2px 4px; }
.card.swapped-highlight { animation: glitchBorder 3s infinite; z-index: 10; }
.card.swapped-highlight::after { content: 'SWAPPED!'; position: absolute; top: -25px; left: 50%; transform: translateX(-50%); background: var(--accent); color: white; font-size: 0.7rem; padding: 2px 6px; border: 2px solid black; font-weight: bold; animation: floatUp 1s forwards; }
@keyframes glitchBorder { 0% { border-color: var(--accent); box-shadow: 0 0 10px var(--accent); } 50% { border-color: white; box-shadow: 0 0 20px var(--accent); } 100% { border-color: var(--accent); box-shadow: 0 0 10px var(--accent); } }
@keyframes floatUp { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
.card.peek-active { z-index: 50; transform: scale(1.1) translateY(-10px); box-shadow: 0 0 0 4px var(--primary); }
.card.selected { transform: translateY(-15px) rotate(2deg); border-color: var(--secondary); }
.card.just-swapped { animation: glitchSwap 0.4s steps(5); }
@keyframes glitchSwap { 0% { transform: translate(0); filter: invert(0); } 20% { transform: translate(-2px, 2px); filter: invert(1); } 40% { transform: translate(2px, -2px); filter: invert(0); } 60% { transform: translate(-2px, -2px); filter: invert(1); } 80% { transform: translate(2px, 2px); filter: invert(0); } 100% { transform: translate(0); } }
.card.transferring { animation: flyUp 0.6s ease-in-out forwards; z-index: 100; }
@keyframes flyUp { 0% { transform: scale(1); } 50% { transform: scale(1.2) rotate(10deg); } 100% { transform: translateY(-300px) scale(0.5) rotate(45deg); opacity: 0; } }
.card.receiving { animation: dropIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
@keyframes dropIn { from { transform: translateY(-100px) scale(0); } to { transform: translateY(0) scale(1); } }
.table-area { display: flex; gap: 15px; align-items: center; justify-content: center; flex-grow: 1; position: relative; width: 100%; }
.pile-container { display: flex; flex-direction: column; align-items: center; gap: 5px; position: relative; }
.pile { width: 85px; height: 120px; border: 3px solid rgba(255,255,255,0.2); border-radius: 8px; display: flex; justify-content: center; align-items: center; position: relative; }
.stock { background: #000; border: 3px solid #fff; box-shadow: 4px 4px 0px #555; }
.stock .pile-text { position: absolute; color: white; font-weight: bold; transform: rotate(-90deg); letter-spacing: 2px; }
.discard { border: 3px dashed var(--secondary); }
.pile-label-bottom { position: absolute; bottom: -25px; font-size: 0.8rem; color: var(--secondary); font-weight: bold; }
.drawn-wrapper { display: flex; align-items: center; gap: 15px; animation: slideUp 0.3s; }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.trash-btn { background: var(--danger); color: white; border: 3px solid black; width: 60px; height: 60px; border-radius: 50%; font-size: 1.5rem; box-shadow: 4px 4px 0px black; cursor: pointer; transition: all 0.1s; }
.trash-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0px black; }
.kyro-btn { position: absolute; top: -70px; background: var(--accent); color: white; border: 4px solid black; padding: 10px 30px; font-family: var(--font-header); font-size: 1.5rem; box-shadow: 6px 6px 0px black; transform: rotate(-2deg); cursor: pointer; animation: wiggle 3s infinite; z-index: 20; }
@keyframes wiggle { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
.my-turn-glow { box-shadow: 0 0 0 4px var(--primary) !important; animation: borderPulse 1s infinite; }
@keyframes borderPulse { 0% { border-color: white; } 50% { border-color: var(--primary); } 100% { border-color: white; } }
#instruction-toast { position: absolute; top: 80px; left: 50%; transform: translateX(-50%); background: black; color: var(--primary); border: 2px solid var(--primary); padding: 10px 20px; font-weight: bold; box-shadow: 4px 4px 0px var(--primary); z-index: 200; white-space: nowrap; }
#power-overlay, #countdown-overlay, #game-over-overlay, #rules-modal, #disconnect-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 500; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; backdrop-filter: grayscale(100%) contrast(120%); }
.power-badge { background: var(--secondary); color: black; border: 3px solid black; padding: 20px 40px; font-size: 1.5rem; font-weight: bold; box-shadow: 10px 10px 0px black; transform: rotate(-3deg); }
.timer-box { width: 100px; height: 100px; background: black; border: 4px solid var(--primary); color: var(--primary); font-size: 3rem; font-family: var(--font-header); display: flex; justify-content: center; align-items: center; box-shadow: 8px 8px 0px var(--primary); margin-bottom: 20px; }
#leaderboard { background: white; color: black; border: 4px solid black; padding: 20px; width: 90%; margin-bottom: 20px; box-shadow: 10px 10px 0px black; }
.score-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 2px dashed black; font-weight: bold; font-size: 1.2rem; }
.winner-row { color: var(--green); text-decoration: underline; }
.penalty-row { color: var(--danger); }
#match-toast, #swap-notification { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); font-family: var(--font-header); font-size: 3rem; color: var(--primary); text-shadow: 4px 4px 0px black; pointer-events: none; z-index: 1000; animation: slam 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
@keyframes slam { from { transform: translate(-50%, -50%) scale(3); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
.rules-content { background: var(--surface); border: 4px solid var(--primary); padding: 30px; max-width: 400px; box-shadow: 10px 10px 0px black; }
.rules-content h2 { color: var(--primary); font-family: var(--font-header); margin-top: 0; }
.rules-content ul { text-align: left; padding-left: 20px; line-height: 1.6; }
.rules-content li { margin-bottom: 10px; }
.loader { border: 5px solid #f3f3f3; border-top: 5px solid var(--danger); border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 20px; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.hidden { display: none !important; }
#modal { position: fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:flex; flex-direction:column; justify-content:center; align-items:center; z-index:1000; backdrop-filter: blur(5px); }
#modal-content .card { transform: scale(2); margin-bottom: 50px; box-shadow: 10px 10px 0px black; }
#close-modal { background: white; color: black; padding: 15px 50px; font-size: 1.3rem; font-weight: 900; border: none; border-radius: 30px; cursor: pointer; box-shadow: 0 0 20px rgba(255,255,255,0.3); }
`;

const gameJs = `
const socket = io();
let myId, room;
let peeking = false;
let selectedForMatch = null;
let previousHandCounts = {};
let lastSwapTimestamp = null;
let playerToken = localStorage.getItem('kyro_token');
if (!playerToken) {
    playerToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('kyro_token', playerToken);
}

const getEl = (id) => document.getElementById(id);
const els = {
    login: getEl('login-screen'),
    game: getEl('game-screen'),
    createBtn: getEl('create-btn'),
    showJoinBtn: getEl('show-join-btn'),
    joinInputContainer: getEl('join-input-container'),
    roomInput: getEl('room-input'),
    confirmJoinBtn: getEl('confirm-join-btn'),
    disconnectOverlay: getEl('disconnect-overlay'),
    countdown: getEl('countdown-overlay'),
    timerVal: getEl('timer-val'),
    status: getEl('status'),
    roomCode: getEl('room-code-display'),
    myHand: getEl('my-hand'),
    oppHand: getEl('opp-hand'),
    stock: getEl('stock'),
    discard: getEl('discard'),
    drawnContainer: getEl('drawn-card-container'),
    drawnSlot: getEl('drawn-card-slot'),
    trashBtn: getEl('trash-btn'),
    instruction: getEl('instruction-toast'),
    modal: getEl('modal'),
    modalContent: getEl('modal-content'),
    powerOverlay: getEl('power-overlay'),
    gameOver: getEl('game-over-overlay'),
    leaderboard: getEl('leaderboard'),
    lobbyBtn: getEl('lobby-btn'),
    matchToast: getEl('match-toast'),
    kyroBtn: getEl('kyro-btn'),
    swapNotification: getEl('swap-notification'),
    howToPlayBtn: getEl('how-to-play-btn'),
    rulesModal: getEl('rules-modal'),
    closeRulesBtn: getEl('close-rules'),
    copyLinkBtn: getEl('copy-link-btn')
};

const urlParams = new URLSearchParams(window.location.search);
const autoJoinRoom = urlParams.get('room');
if(autoJoinRoom) {
    els.roomInput.value = autoJoinRoom;
    socket.emit('joinGame', { roomId: autoJoinRoom, token: playerToken });
}

els.showJoinBtn.onclick = () => { els.showJoinBtn.classList.add('hidden'); els.joinInputContainer.classList.remove('hidden'); els.roomInput.focus(); };
els.createBtn.onclick = () => socket.emit('joinGame', { roomId: Math.random().toString(36).substring(2, 6).toUpperCase(), token: playerToken });
els.confirmJoinBtn.onclick = () => { if(els.roomInput.value) socket.emit('joinGame', { roomId: els.roomInput.value, token: playerToken }); };
els.lobbyBtn.onclick = () => { window.history.replaceState({}, document.title, "/"); location.reload(); };
els.closeRulesBtn.onclick = () => els.rulesModal.classList.add('hidden');
els.howToPlayBtn.onclick = () => els.rulesModal.classList.remove('hidden');
els.copyLinkBtn.onclick = () => { navigator.clipboard.writeText(window.location.origin + '?room=' + room.id); els.copyLinkBtn.innerText = "COPIED!"; setTimeout(() => els.copyLinkBtn.innerText = "🔗 COPY", 2000); };
getEl('close-modal').onclick = () => { els.modal.classList.add('hidden'); socket.emit('action', { roomId: room.id, type: 'FINISH_POWER' }); };
getEl('start-btn').onclick = () => socket.emit('startGame', room.id);
els.kyroBtn.onclick = () => { if(confirm("CALL KYRO?")) socket.emit('action', { roomId: room.id, type: 'CALL_KYRO' }); };

socket.on('connect', () => myId = socket.id);
socket.on('gameState', (r) => {
    room = r;
    
    const opponent = room.players.find(p => p.token !== playerToken);
    if (room.state !== 'LOBBY' && opponent && !opponent.connected) {
        els.disconnectOverlay.classList.remove('hidden');
    } else {
        els.disconnectOverlay.classList.add('hidden');
        if (els.login.classList.contains('active')) { els.login.classList.remove('active'); els.game.classList.add('active'); }
        render();
    }
});
socket.on('startPeek', (data) => {
    let timeLeft = data.duration / 1000;
    peeking = true;
    els.countdown.classList.remove('hidden');
    render(true);
    const interval = setInterval(() => {
        timeLeft--;
        els.timerVal.innerText = timeLeft;
        if(timeLeft <= 0) { clearInterval(interval); peeking = false; els.countdown.classList.add('hidden'); render(); }
    }, 1000);
});
socket.on('peekResult', (data) => {
    els.modalContent.innerHTML = '';
    els.modalContent.appendChild(createCard(data.card, true));
    els.modal.classList.remove('hidden');
});
socket.on('matchResult', (data) => {
    els.matchToast.innerText = data.msg;
    els.matchToast.style.color = data.success ? "var(--primary)" : "var(--danger)";
    els.matchToast.classList.remove('hidden');
    setTimeout(() => els.matchToast.classList.add('hidden'), 1500);
    selectedForMatch = null;
});

function render(isPeeking = false) {
    if (!room || !myId) return;
    const me = room.players.find(p => p.token === playerToken);
    if (!me) return; 
    myId = me.id;
    const opp = room.players.find(p => p.token !== playerToken);
    const isMyTurn = me && room.turnIndex === room.players.indexOf(me);

    els.roomCode.innerText = "CODE: " + room.id;
    els.gameOver.classList.add('hidden');

    if (room.lastSwapInfo && room.lastSwapInfo.timestamp !== lastSwapTimestamp && room.lastSwapInfo.type !== 'RESET') {
        lastSwapTimestamp = room.lastSwapInfo.timestamp;
        els.swapNotification.innerText = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "PENALTY!" : "SWAP!";
        els.swapNotification.style.color = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "var(--danger)" : "var(--secondary)";
        els.swapNotification.classList.remove('hidden');
        setTimeout(() => els.swapNotification.classList.add('hidden'), 1500);
    }

    if(room.state === 'LOBBY') {
        els.status.innerText = room.players.length > 1 ? "OPPONENT READY" : "WAITING FOR OPPONENT";
        getEl('start-btn').classList.toggle('hidden', room.players.length < 2);
    } else if(room.state === 'PEEKING') {
        const peeks = room.peeksRemaining[myId] || 0;
        els.status.innerText = \`PEEK PHASE (\${peeks})\`;
        getEl('start-btn').classList.add('hidden');
    } else if(room.state === 'GAME_OVER') {
        els.gameOver.classList.remove('hidden');
        renderLeaderboard(room, me);
    } else if(room.state === 'PLAYING') {
        if(room.penaltyPending) {
            els.status.innerText = isMyTurn ? "GIVE PENALTY CARD!" : "OPPONENT GIVING CARD";
            els.status.style.color = "var(--danger)";
        } else if(room.kyroCallerId) {
            els.status.innerText = (room.kyroCallerId === myId) ? "YOU CALLED KYRO!" : "OPPONENT CALLED KYRO!";
            els.status.style.color = "var(--danger)";
        } else {
            els.status.innerText = isMyTurn ? (room.activePower ? "POWER ACTIVE" : "YOUR TURN") : "OPPONENT'S TURN";
            els.status.style.color = isMyTurn ? "var(--primary)" : "white";
        }
        getEl('start-btn').classList.add('hidden');
    }
    
    els.powerOverlay.classList.toggle('hidden', !room.activePower);
    if(room.activePower) els.powerOverlay.querySelector('.power-badge').innerText = room.activePower + " ACTIVE";

    renderHand(els.myHand, me ? me.hand : [], true, isMyTurn, isPeeking);
    renderHand(els.oppHand, opp ? opp.hand : [], false, isMyTurn, false);

    els.discard.innerHTML = '<div class="empty-slot"></div>';
    if(room.discardPile.length) {
        els.discard.innerHTML = '';
        els.discard.appendChild(createCard(room.discardPile[room.discardPile.length-1], true));
    }
    
    let instructionText = "";
    if (room.state === 'PEEKING') {
        const peeks = room.peeksRemaining[myId] || 0;
        instructionText = peeks > 0 ? \`TAP \${peeks} CARDS TO REVEAL\` : "WAITING...";
    }

    if (isMyTurn && !room.drawnCard && !room.penaltyPending && room.state === 'PLAYING' && !room.kyroCallerId) els.kyroBtn.classList.remove('hidden');
    else els.kyroBtn.classList.add('hidden');

    if(isMyTurn && !room.drawnCard && !room.activePower && !room.penaltyPending && room.state === 'PLAYING') {
        els.stock.classList.add('my-turn-glow');
        els.stock.onclick = () => socket.emit('action', { roomId: room.id, type: 'DRAW_STOCK' });
        if (selectedForMatch) {
            instructionText = "TAP DISCARD TO SNAP MATCH";
            els.discard.style.boxShadow = "0 0 0 4px var(--secondary)";
            els.discard.onclick = () => { socket.emit('action', { roomId: room.id, type: 'ATTEMPT_MATCH', payload: { targetOwnerId: selectedForMatch.ownerId, cardIndex: selectedForMatch.index } }); selectedForMatch = null; };
        } else {
            instructionText = "DRAW OR SELECT CARD TO MATCH";
            els.discard.style.boxShadow = "none";
            els.discard.onclick = () => socket.emit('action', { roomId: room.id, type: 'DRAW_DISCARD' });
        }
    } else {
        els.stock.classList.remove('my-turn-glow');
        els.stock.onclick = null;
        if(!selectedForMatch) els.discard.onclick = null; 
        els.discard.style.boxShadow = "none";
    }

    if(room.penaltyPending && isMyTurn) {
        instructionText = "TAP YOUR CARD TO GIVE AWAY";
        els.drawnContainer.classList.add('hidden');
    } else if(room.drawnCard && isMyTurn) {
        els.drawnContainer.classList.remove('hidden');
        els.drawnSlot.innerHTML = '';
        els.drawnSlot.appendChild(createCard(room.drawnCard, true));
        if(room.drawnCard.fromDiscard) {
            els.trashBtn.classList.add('hidden');
            instructionText = "MUST SWAP WITH HAND";
        } else {
            els.trashBtn.classList.remove('hidden');
            els.trashBtn.onclick = () => socket.emit('action', { roomId: room.id, type: 'DISCARD_DRAWN' });
            instructionText = "SWAP OR DISCARD";
        }
    } else {
        els.drawnContainer.classList.add('hidden');
    }

    if(instructionText && (isMyTurn || room.state === 'PEEKING')) {
        els.instruction.innerText = instructionText;
        els.instruction.classList.remove('hidden');
    } else {
        els.instruction.classList.add('hidden');
    }
}

function renderHand(container, cards, isMine, isTurn, isPeeking) {
    container.innerHTML = '';
    if(!cards) return;
    const playerId = isMine ? 'me' : 'opp';
    const previousCount = previousHandCounts[playerId] || cards.length;
    const receivedNewCard = cards.length > previousCount;
    previousHandCounts[playerId] = cards.length;
    container.className = container.className.split(' ')[0];
    if (cards.length >= 7) container.classList.add('cards-7');
    else if (cards.length >= 5) container.classList.add('cards-5');

    cards.forEach((c, i) => {
        const el = createCard(c.card, c.visible);
        if (receivedNewCard && i === cards.length - 1) el.classList.add('receiving');
        if(selectedForMatch && selectedForMatch.ownerId === (isMine?myId:'opp') && selectedForMatch.index === i) el.classList.add('selected');
        if (room.lastSwapInfo) {
            const swap = room.lastSwapInfo;
            const currentPlayerId = isMine ? myId : (room.players.find(p=>p.token !== playerToken)||{}).id;
            const isTarget = (swap.type === 'HAND_SWAP' && swap.playerId === currentPlayerId && swap.cardIndex === i) || (swap.type === 'POWER_SWAP' && ((swap.player1Id === currentPlayerId && swap.player1Index === i) || (swap.player2Id === currentPlayerId && swap.player2Index === i)));
            if (isTarget) { el.classList.add('swapped-highlight'); setTimeout(() => el.classList.remove('swapped-highlight'), 3000); }
        }
        el.onclick = () => {
            if (room.state === 'PEEKING' && isMine) { if (room.peeksRemaining[myId] > 0) socket.emit('peekCard', { roomId: room.id, cardIndex: i }); return; }
            if(!isTurn) return;
            if (room.penaltyPending && isMine) { el.classList.add('transferring'); setTimeout(() => socket.emit('action', { roomId: room.id, type: 'GIVE_CARD', payload: { handIndex: i }}), 250); return; }
            if (isMine && room.drawnCard && !room.activePower) { socket.emit('action', { roomId: room.id, type: 'SWAP_CARD', payload: { handIndex: i } }); return; }
            if (!room.drawnCard && !room.activePower && !room.penaltyPending) {
                if(selectedForMatch && selectedForMatch.index === i && selectedForMatch.ownerId === (isMine?myId:'opp')) selectedForMatch = null;
                else selectedForMatch = { ownerId: isMine ? myId : (room.players.find(p=>p.id!==myId).id), index: i };
                render(); return;
            }
            if(room.activePower) { const targetId = isMine ? myId : (room.players.find(p => p.id !== myId).id); socket.emit('action', { roomId: room.id, type: 'USE_POWER', payload: { targetPlayerId: targetId, cardIndex: i } }); }
        };
        container.appendChild(el);
    });
}

function createCard(data, visible) {
    const d = document.createElement('div');
    d.className = 'card ' + (visible ? '' : 'face-down');
    if(visible) {
        let powerIcon = '';
        if (data.power === 'PEEK') powerIcon = '<div class="power-icon">EYE</div>';
        else if (data.power === 'SPY') powerIcon = '<div class="power-icon">SPY</div>';
        else if (data.power === 'SWAP') powerIcon = '<div class="power-icon">SWP</div>';
        d.innerHTML = \`<span class="card-value">\${data.val}</span><div class="suit">\${data.suit}</div>\${powerIcon}\`;
        if(data.suit === '♥' || data.suit === '♦') d.classList.add('red');
    }
    return d;
}

function renderLeaderboard(room, me) {
    const el = document.getElementById('leaderboard');
    el.innerHTML = '';
    [...room.players].sort((a, b) => a.finalScore - b.finalScore).forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = 'score-row';
        let name = (p.token === playerToken) ? "YOU" : p.name;
        if (p.id === room.kyroCallerId) name += " [CALLED]";
        div.innerHTML = \`<span>\${name}</span> <span>\${p.finalScore} PTS</span>\`;
        if (p.finalScore > p.rawScore) div.classList.add('penalty-row'); 
        else if (idx === 0) div.classList.add('winner-row');
        el.appendChild(div);
    });
}
`;

// 3. Write Files
console.log("📄 Writing .gitignore...");
fs.writeFileSync('.gitignore', gitignore);

console.log("📄 Writing package.json...");
fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

console.log("📄 Writing server.js...");
fs.writeFileSync('server.js', serverJs);

console.log("📄 Writing public/index.html...");
fs.writeFileSync(path.join('public', 'index.html'), indexHtml);

console.log("📄 Writing public/style.css...");
fs.writeFileSync(path.join('public', 'style.css'), styleCss);

console.log("📄 Writing public/game.js...");
fs.writeFileSync(path.join('public', 'game.js'), gameJs);

// 4. Install and Run
console.log("📦 Installing dependencies (this might take a moment)...");
try {
    if (!fs.existsSync('node_modules')) {
        execSync('npm install', { stdio: 'inherit' });
    } else {
        console.log("Node modules already exist, skipping install.");
    }
    
    console.log("\n✅ SETUP COMPLETE!");
    console.log("------------------------------------------------");
    console.log("🚀 STARTING SERVER NOW...");
    console.log("🌐 Open your browser to: http://localhost:3000");
    console.log("------------------------------------------------");
    execSync('node server.js', { stdio: 'inherit' });
} catch (e) {
    console.error("❌ Error installing/running:", e.message);
    console.log("Try running 'npm install' and then 'node server.js' manually.");
}