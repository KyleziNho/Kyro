const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("⛳ Updating Golf: Neo-Brutalist Redesign...");

// 1. Create Directory Structure
const dirs = ['public'];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
});

// 2. Define File Contents
const packageJson = {
  "name": "golf-card-game",
  "version": "3.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2"
  }
};

const serverJs = `
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game Constants
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

function createDeck() {
    let deck = [];
    SUITS.forEach(s => {
        VALUES.forEach(v => {
            if (v.val !== 'JOKER') deck.push({ ...v, suit: s, id: Math.random().toString(36).substr(2, 9) });
        });
    });
    // Add 2 Jokers
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
    socket.on('joinGame', (roomId) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();
        socket.join(roomId);
        
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
                caboCallerId: null,
                peeksRemaining: {},
                lastSwapInfo: { timestamp: 0 }
            };
        }
        const room = rooms[roomId];
        
        const existingPlayer = room.players.find(p => p.id === socket.id);
        if (!existingPlayer && room.players.length < 2) {
            room.players.push({ id: socket.id, hand: [], score: 0, name: 'Player ' + (room.players.length + 1) });
        }
        
        io.to(roomId).emit('gameState', room);
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
        room.caboCallerId = null;
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

        if (type === 'CALL_CABO' && room.state === 'PLAYING' && !room.drawnCard && !room.penaltyPending) {
            room.caboCallerId = socket.id;
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
            if (card.power) {
                room.activePower = card.power;
            } else {
                endTurn(room);
            }
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
        if (room.caboCallerId) {
            const caller = room.players.find(p => p.id === room.caboCallerId);
            const opponent = room.players.find(p => p.id !== room.caboCallerId);
            if (caller && opponent) {
                if (caller.rawScore >= opponent.rawScore) caller.finalScore = caller.rawScore * 2;
                else caller.finalScore = 0;
            }
        }
        io.to(room.id).emit('gameState', room);
    }
});

server.listen(3000, () => console.log('Server running on port 3000'));
`;

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>CABO: Neo</title>
    <link rel="stylesheet" href="style.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Space+Mono:ital,wght@0,400;0,700;1,700&display=swap" rel="stylesheet">
</head>
<body>
    <div id="app">
        <!-- Login -->
        <div id="login-screen" class="screen active">
            <div class="title-stack">
                <h1>CABO</h1>
                <span class="subtitle">NEO EDITION</span>
            </div>
            <div class="menu-container">
                <button id="create-btn" class="neo-btn primary">CREATE LOBBY</button>
                <div class="divider">/// OR ///</div>
                <div id="join-area">
                    <button id="show-join-btn" class="neo-btn outline">JOIN LOBBY</button>
                    <div id="join-input-container" class="hidden">
                        <input type="text" id="room-input" placeholder="ROOM CODE" maxlength="5">
                        <button id="confirm-join-btn" class="neo-btn icon-btn">➜</button>
                    </div>
                </div>
            </div>
            <div id="error-msg" class="hidden">CONNECTION LOST</div>
        </div>

        <!-- Game -->
        <div id="game-screen" class="screen">
            
            <div id="instruction-toast" class="hidden">WAITING FOR ACTION...</div>

            <div id="countdown-overlay" class="hidden">
                <div class="timer-box">
                    <span id="timer-val">5</span>
                </div>
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
            </div>
            
            <div class="hand-grid opponent" id="opp-hand"></div>
            
            <div class="table-area">
                <!-- Stock -->
                <div class="pile-container">
                    <div class="pile stock" id="stock">
                        <div class="card-back-pattern"></div>
                        <div class="pile-text">DRAW</div>
                    </div>
                </div>
                
                <!-- Cabo Button -->
                <button id="cabo-btn" class="cabo-btn hidden">CABO</button>

                <!-- Floating Drawn Card -->
                <div id="drawn-card-container" class="drawn-wrapper hidden">
                    <div id="drawn-card-slot" class="drawn-card"></div>
                    <button id="trash-btn" class="trash-btn">🗑</button>
                </div>

                <!-- Discard -->
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
        <div id="match-toast" class="hidden">MATCH!</div>
        <div id="swap-notification" class="hidden">SWAP!</div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script src="game.js"></script>
</body>
</html>`;

const styleCss = `
:root {
    --bg: #121212;
    --surface: #1E1E1E;
    --primary: #CCFF00; /* Neon Lime */
    --secondary: #00FFFF; /* Cyan */
    --accent: #FF00FF; /* Magenta */
    --danger: #FF3333;
    --border-color: #000000;
    --text: #FFFFFF;
    --card-face: #F0F0F0;
    --card-back-1: #2a2a2a;
    --card-back-2: #1a1a1a;
    
    --font-header: 'Archivo Black', sans-serif;
    --font-body: 'Space Mono', monospace;
    
    --border-thick: 3px solid var(--border-color);
    --shadow-hard: 6px 6px 0px var(--border-color);
    --shadow-hover: 3px 3px 0px var(--border-color);
    --shadow-active: 0px 0px 0px var(--border-color);
}

* { box-sizing: border-box; user-select: none; -webkit-tap-highlight-color: transparent; }

body {
    margin: 0;
    font-family: var(--font-body);
    background-color: var(--bg);
    color: var(--text);
    overflow: hidden;
    /* Grid Background Pattern */
    background-image: 
        linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
    background-size: 40px 40px;
}

#app { display: flex; flex-direction: column; height: 100vh; width: 100%; align-items: center; justify-content: center; position: relative; }
.screen { display: none; width: 100%; height: 100%; flex-direction: column; justify-content: space-between; padding: 10px; max-width: 500px; margin: 0 auto; }
.screen.active { display: flex; }

/* NEO-BRUTALIST COMPONENTS */

h1 {
    font-family: var(--font-header);
    font-size: 4.5rem;
    color: var(--primary);
    text-transform: uppercase;
    margin: 0;
    line-height: 0.9;
    text-shadow: 6px 6px 0px var(--border-color);
    transform: skew(-5deg);
}
.subtitle { font-size: 1.2rem; letter-spacing: 4px; color: var(--secondary); font-weight: bold; background: black; padding: 0 10px; }
.title-stack { display: flex; flex-direction: column; align-items: center; margin-bottom: 40px; }

.menu-container { width: 100%; display: flex; flex-direction: column; gap: 15px; align-items: center; }
.divider { background: #000; color: #fff; padding: 5px 10px; font-weight: bold; font-size: 0.8rem; transform: rotate(-2deg); border: 1px solid white; }

/* Buttons */
.neo-btn {
    width: 100%;
    padding: 18px;
    border: var(--border-thick);
    border-radius: 8px;
    font-family: var(--font-body);
    font-weight: 700;
    font-size: 1.1rem;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: var(--shadow-hard);
    transition: all 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    display: flex; align-items: center; justify-content: center;
}
.neo-btn:active { transform: translate(4px, 4px); box-shadow: var(--shadow-active); }

.neo-btn.primary { background: var(--primary); color: black; }
.neo-btn.secondary { background: var(--secondary); color: black; }
.neo-btn.outline { background: white; color: black; }
.neo-btn.icon-btn { width: auto; padding: 0 20px; background: var(--accent); color: white; }

/* Inputs */
#join-input-container { display: flex; gap: 10px; width: 100%; }
#room-input {
    flex-grow: 1; padding: 15px;
    border: var(--border-thick);
    background: white; color: black;
    font-family: var(--font-body);
    font-weight: 700; font-size: 1.2rem;
    text-align: center; text-transform: uppercase;
    border-radius: 8px;
    box-shadow: var(--shadow-hard);
}
#room-input:focus { outline: none; background: #ffffcc; }

/* GAME UI */
.top-bar {
    background: var(--surface);
    border: 2px solid #fff;
    padding: 10px;
    border-radius: 0;
    display: flex; justify-content: center;
    box-shadow: 4px 4px 0px rgba(255,255,255,0.2);
    transform: skew(-2deg);
    margin-bottom: 10px;
}
#status { font-weight: bold; color: var(--primary); font-size: 1rem; }
#room-code-display { font-size: 0.8rem; color: #aaa; margin-top: 2px; text-align: center;}

/* HANDS */
.hand-grid { 
    display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; 
    padding: 10px; min-height: 130px; perspective: 1000px;
}
.hand-grid.opponent { transform: scale(0.9); opacity: 0.8; }

/* CARDS - The Star of the Show */
.card {
    width: 80px; height: 115px;
    background: var(--card-face);
    border: 3px solid black;
    border-radius: 6px;
    display: flex; justify-content: center; align-items: center;
    position: relative;
    box-shadow: 5px 5px 0px rgba(0,0,0,1);
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s;
    font-family: var(--font-header);
    font-size: 2rem; color: black;
}
.card:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0px black; }

/* Face Down Pattern (Hazard Stripes) */
.card.face-down {
    background: repeating-linear-gradient(
        45deg,
        var(--card-back-1),
        var(--card-back-1) 10px,
        var(--card-back-2) 10px,
        var(--card-back-2) 20px
    );
    border: 3px solid #fff;
    box-shadow: 5px 5px 0px var(--accent);
}
.card.face-down span, .card.face-down .suit { display: none; }

/* Suit Colors & Styling */
.suit { position: absolute; top: 5px; right: 5px; font-size: 1.2rem; }
.card.red { color: var(--danger); }
.power-icon { 
    position: absolute; bottom: 5px; right: 5px; 
    font-size: 0.8rem; background: black; color: white; 
    padding: 2px 6px; border-radius: 4px; font-family: var(--font-body);
}

/* States */
.card.selected { 
    transform: translateY(-15px) rotate(2deg); 
    box-shadow: 8px 8px 0px var(--secondary);
    border-color: var(--secondary);
}
.card.peek-active {
    z-index: 50;
    transform: scale(1.1) translateY(-10px);
    box-shadow: 0 0 0 4px var(--primary);
}

/* Swap Animation - GLITCH */
.card.just-swapped { animation: glitchSwap 0.4s steps(5); }
@keyframes glitchSwap {
    0% { transform: translate(0); filter: invert(0); }
    20% { transform: translate(-2px, 2px); filter: invert(1); }
    40% { transform: translate(2px, -2px); filter: invert(0); }
    60% { transform: translate(-2px, -2px); filter: invert(1); }
    80% { transform: translate(2px, 2px); filter: invert(0); }
    100% { transform: translate(0); }
}

/* Penalty Transfer Animation */
.card.transferring { 
    animation: flyUp 0.6s ease-in-out forwards; 
    z-index: 100;
}
@keyframes flyUp {
    0% { transform: scale(1); }
    50% { transform: scale(1.2) rotate(10deg); }
    100% { transform: translateY(-300px) scale(0.5) rotate(45deg); opacity: 0; }
}
.card.receiving { animation: dropIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
@keyframes dropIn { from { transform: translateY(-100px) scale(0); } to { transform: translateY(0) scale(1); } }

/* TABLE AREA */
.table-area { display: flex; gap: 20px; align-items: center; justify-content: center; flex-grow: 1; position: relative; }
.pile { width: 85px; height: 120px; border: 3px solid rgba(255,255,255,0.2); border-radius: 6px; display: flex; justify-content: center; align-items: center; position: relative; }

.stock { 
    background: #000; border: 3px solid #fff; 
    box-shadow: 4px 4px 0px #555;
}
.stock:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0px #555; }
.stock .card-back-pattern { width: 100%; height: 100%; background: var(--card-back-1); opacity: 0.5; }
.stock .pile-text { position: absolute; color: white; font-weight: bold; transform: rotate(-90deg); font-size: 1.2rem; letter-spacing: 3px; }

.discard { border: 3px dashed var(--secondary); }
.pile-label-bottom { position: absolute; bottom: -25px; font-size: 0.8rem; color: var(--secondary); font-weight: bold; letter-spacing: 1px; }

/* Action UI */
.drawn-wrapper { display: flex; align-items: center; gap: 15px; animation: slideUp 0.3s; }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.trash-btn {
    background: var(--danger); color: white; border: 3px solid black;
    width: 60px; height: 60px; border-radius: 50%; font-size: 1.5rem;
    box-shadow: 4px 4px 0px black; cursor: pointer; transition: all 0.1s;
}
.trash-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0px black; }

.cabo-btn {
    position: absolute; top: -70px;
    background: var(--accent); color: white;
    border: 4px solid black; padding: 10px 30px;
    font-family: var(--font-header); font-size: 1.5rem;
    box-shadow: 6px 6px 0px black; transform: rotate(-2deg);
    cursor: pointer; animation: wiggle 3s infinite;
    z-index: 20;
}
@keyframes wiggle { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
.cabo-btn:active { transform: scale(0.95); }

.my-turn-glow { box-shadow: 0 0 0 4px var(--primary) !important; animation: borderPulse 1s infinite; }
@keyframes borderPulse { 0% { border-color: white; } 50% { border-color: var(--primary); } 100% { border-color: white; } }

/* Overlays */
#instruction-toast {
    position: absolute; top: 80px; left: 50%; transform: translateX(-50%);
    background: black; color: var(--primary); border: 2px solid var(--primary);
    padding: 10px 20px; font-weight: bold; box-shadow: 4px 4px 0px var(--primary);
    z-index: 200; text-transform: uppercase;
}

#power-overlay, #countdown-overlay, #game-over-overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.85); z-index: 500;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    backdrop-filter: grayscale(100%) contrast(120%);
}
.power-badge { 
    background: var(--secondary); color: black; border: 3px solid black;
    padding: 20px 40px; font-size: 1.5rem; font-weight: bold;
    box-shadow: 10px 10px 0px black; transform: rotate(-3deg);
}

.timer-box { 
    width: 100px; height: 100px; background: black; border: 4px solid var(--primary);
    color: var(--primary); font-size: 3rem; font-family: var(--font-header);
    display: flex; justify-content: center; align-items: center;
    box-shadow: 8px 8px 0px var(--primary); margin-bottom: 20px;
}

#leaderboard {
    background: white; color: black; border: 4px solid black;
    padding: 20px; width: 90%; margin-bottom: 20px;
    box-shadow: 10px 10px 0px black;
}
.score-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 2px dashed black; font-weight: bold; font-size: 1.2rem; }
.winner-row { color: var(--green); text-decoration: underline; }
.penalty-row { color: var(--danger); }

#match-toast, #swap-notification {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-family: var(--font-header); font-size: 4rem; color: var(--primary);
    text-shadow: 4px 4px 0px black; pointer-events: none; z-index: 1000;
    animation: slam 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
@keyframes slam { from { transform: translate(-50%, -50%) scale(3); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }

.hidden { display: none !important; }
#modal { background: rgba(0,0,0,0.9); }
#modal-content .card { transform: scale(2); margin-bottom: 50px; box-shadow: 10px 10px 0px black; }
`;

const gameJs = `
const socket = io();
let myId, room;
let peeking = false;
let selectedForMatch = null;
let previousHandCounts = {};
let lastSwapTimestamp = null;

const els = {
    login: document.getElementById('login-screen'),
    game: document.getElementById('game-screen'),
    createBtn: document.getElementById('create-btn'),
    showJoinBtn: document.getElementById('show-join-btn'),
    joinInputContainer: document.getElementById('join-input-container'),
    roomInput: document.getElementById('room-input'),
    confirmJoinBtn: document.getElementById('confirm-join-btn'),
    errorMsg: document.getElementById('error-msg'),
    countdown: document.getElementById('countdown-overlay'),
    timerVal: document.getElementById('timer-val'),
    status: document.getElementById('status'),
    roomCode: document.getElementById('room-code-display'),
    myHand: document.getElementById('my-hand'),
    oppHand: document.getElementById('opp-hand'),
    stock: document.getElementById('stock'),
    discard: document.getElementById('discard'),
    drawnContainer: document.getElementById('drawn-card-container'),
    drawnSlot: document.getElementById('drawn-card-slot'),
    trashBtn: document.getElementById('trash-btn'),
    instruction: document.getElementById('instruction-toast'),
    modal: document.getElementById('modal'),
    modalContent: document.getElementById('modal-content'),
    powerOverlay: document.getElementById('power-overlay'),
    gameOver: document.getElementById('game-over-overlay'),
    leaderboard: document.getElementById('leaderboard'),
    lobbyBtn: document.getElementById('lobby-btn'),
    matchToast: document.getElementById('match-toast'),
    caboBtn: document.getElementById('cabo-btn'),
    swapNotification: document.getElementById('swap-notification')
};

els.showJoinBtn.onclick = () => { els.showJoinBtn.classList.add('hidden'); els.joinInputContainer.classList.remove('hidden'); els.roomInput.focus(); };
els.createBtn.onclick = () => joinRoom(Math.random().toString(36).substring(2, 6).toUpperCase());
els.confirmJoinBtn.onclick = () => { if(els.roomInput.value) joinRoom(els.roomInput.value); };
els.lobbyBtn.onclick = () => location.reload();
document.getElementById('close-modal').onclick = () => {
    els.modal.classList.add('hidden');
    socket.emit('action', { roomId: room.id, type: 'FINISH_POWER' });
};
document.getElementById('start-btn').onclick = () => socket.emit('startGame', room.id);

els.caboBtn.onclick = () => {
    if(confirm("CALL CABO? NO GOING BACK.")) {
        socket.emit('action', { roomId: room.id, type: 'CALL_CABO' });
    }
};

function joinRoom(code) {
    socket.emit('joinGame', code);
    els.login.classList.remove('active');
    els.game.classList.add('active');
    els.errorMsg.classList.add('hidden');
}

socket.on('connect', () => myId = socket.id);
socket.on('disconnect', () => {
    els.game.classList.remove('active');
    els.login.classList.add('active');
    els.errorMsg.classList.remove('hidden');
});
socket.on('gameState', (r) => {
    room = r;
    render();
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
    const me = room.players.find(p => p.id === myId);
    if (!me && room.players.length > 0) return;
    const opp = room.players.find(p => p.id !== myId);
    const isMyTurn = me && room.turnIndex === room.players.indexOf(me);

    els.roomCode.innerText = "LOBBY: " + room.id;
    els.gameOver.classList.add('hidden');
    els.countdown.classList.add('hidden');

    if (room.lastSwapInfo && room.lastSwapInfo.timestamp !== lastSwapTimestamp) {
        lastSwapTimestamp = room.lastSwapInfo.timestamp;
        if(room.lastSwapInfo.type !== 'RESET') {
            els.swapNotification.innerText = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "PENALTY!" : "SWAP!";
            els.swapNotification.style.color = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "var(--danger)" : "var(--secondary)";
            els.swapNotification.classList.remove('hidden');
            setTimeout(() => els.swapNotification.classList.add('hidden'), 1500);
        }
    }

    // Status Text
    if(room.state === 'LOBBY') {
        if(room.players.length > 1) {
            els.status.innerText = "OPPONENT READY";
            document.getElementById('start-btn').classList.remove('hidden');
        } else {
            els.status.innerText = "WAITING FOR PLAYER 2";
            document.getElementById('start-btn').classList.add('hidden');
        }
    } else if(room.state === 'PEEKING') {
        const peeksLeft = room.peeksRemaining[myId] || 0;
        els.status.innerText = \`PEEK AT \${peeksLeft} CARDS\`;
        els.status.style.color = "var(--primary)";
        document.getElementById('start-btn').classList.add('hidden');
    } else if(room.state === 'GAME_OVER') {
        els.gameOver.classList.remove('hidden');
        renderLeaderboard(room);
    } else if(room.state === 'PLAYING') {
        if(room.penaltyPending) {
            els.status.innerText = isMyTurn ? "GIVE PENALTY CARD!" : "OPPONENT GIVING CARD...";
            els.status.style.color = "var(--danger)";
        } else if(room.caboCallerId) {
            const isMe = room.caboCallerId === myId;
            els.status.innerText = isMe ? "YOU CALLED CABO" : "OPPONENT CALLED CABO";
            els.status.style.color = "var(--danger)";
        } else {
            els.status.innerText = isMyTurn ? (room.activePower ? "POWER ACTIVE" : "YOUR TURN") : "OPPONENT'S TURN";
            els.status.style.color = isMyTurn ? "var(--primary)" : "white";
        }
        document.getElementById('start-btn').classList.add('hidden');
    }
    
    // Power Overlay
    if(room.activePower) {
        els.powerOverlay.classList.remove('hidden');
        const badge = els.powerOverlay.querySelector('.power-badge');
        if (room.activePower === 'PEEK') badge.innerText = 'EYE // PEEK YOUR CARD';
        else if (room.activePower === 'SPY') badge.innerText = 'SPY // SEE OPPONENT';
        else if (room.activePower === 'SWAP') badge.innerText = 'SWAP // SELECT 2 CARDS';
    } else {
        els.powerOverlay.classList.add('hidden');
    }

    renderHand(els.myHand, me ? me.hand : [], true, isMyTurn, false);
    renderHand(els.oppHand, opp ? opp.hand : [], false, isMyTurn, false);

    els.discard.innerHTML = '<div class="empty-slot"></div>';
    if(room.discardPile.length) {
        const top = room.discardPile[room.discardPile.length-1];
        els.discard.innerHTML = '';
        els.discard.appendChild(createCard(top, true));
    }
    
    let instructionText = "";

    if (room.state === 'PEEKING') {
        const peeksLeft = room.peeksRemaining[myId] || 0;
        instructionText = peeksLeft > 0 ? \`TAP \${peeksLeft} CARDS TO REVEAL\` : "WAITING FOR OPPONENT";
    }

    if (isMyTurn && !room.drawnCard && !room.penaltyPending && room.state === 'PLAYING' && !room.caboCallerId) {
        els.caboBtn.classList.remove('hidden');
    } else {
        els.caboBtn.classList.add('hidden');
    }

    if(isMyTurn && !room.drawnCard && !room.activePower && !room.penaltyPending && room.state === 'PLAYING') {
        els.stock.classList.add('my-turn-glow');
        els.stock.onclick = () => socket.emit('action', { roomId: room.id, type: 'DRAW_STOCK' });
        
        if (selectedForMatch) {
            instructionText = "TAP DISCARD TO SNAP MATCH";
            els.discard.style.boxShadow = "0 0 0 4px var(--secondary)";
            els.discard.onclick = () => {
                socket.emit('action', { 
                    roomId: room.id, 
                    type: 'ATTEMPT_MATCH', 
                    payload: { targetOwnerId: selectedForMatch.ownerId, cardIndex: selectedForMatch.index } 
                });
                selectedForMatch = null;
            };
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

    if(instructionText && isMyTurn) {
        els.instruction.innerText = instructionText;
        els.instruction.classList.remove('hidden');
    } else if (room.state === 'PEEKING') {
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
        if(selectedForMatch && selectedForMatch.ownerId === (isMine?myId:'opp') && selectedForMatch.index === i) {
            el.classList.add('selected');
        }

        const currentPlayerId = isMine ? myId : (room.players.find(p=>p.id!==myId)||{}).id;
        if (room.lastSwapInfo) {
            const swap = room.lastSwapInfo;
            if (swap.type === 'HAND_SWAP' && swap.playerId === currentPlayerId && swap.cardIndex === i) {
                el.classList.add('just-swapped');
            } else if (swap.type === 'POWER_SWAP') {
                if ((swap.player1Id === currentPlayerId && swap.player1Index === i) ||
                    (swap.player2Id === currentPlayerId && swap.player2Index === i)) {
                    el.classList.add('just-swapped');
                }
            }
        }

        el.onclick = () => {
            if (room.state === 'PEEKING' && isMine) {
                if (room.peeksRemaining[myId] > 0) socket.emit('peekCard', { roomId: room.id, cardIndex: i });
                return;
            }
            if(!isTurn) return;

            if (room.penaltyPending && isMine) {
                el.classList.add('transferring');
                setTimeout(() => socket.emit('action', { roomId: room.id, type: 'GIVE_CARD', payload: { handIndex: i }}), 250);
                return;
            }
            if (isMine && room.drawnCard && !room.activePower) {
                socket.emit('action', { roomId: room.id, type: 'SWAP_CARD', payload: { handIndex: i } });
                return;
            }
            if (!room.drawnCard && !room.activePower && !room.penaltyPending) {
                if(selectedForMatch && selectedForMatch.index === i && selectedForMatch.ownerId === (isMine?myId:'opp')) {
                    selectedForMatch = null;
                } else {
                    selectedForMatch = { ownerId: isMine ? myId : (room.players.find(p=>p.id!==myId).id), index: i };
                }
                render();
                return;
            }
            if(room.activePower) {
                const targetId = isMine ? myId : (room.players.find(p => p.id !== myId).id);
                socket.emit('action', { roomId: room.id, type: 'USE_POWER', payload: { targetPlayerId: targetId, cardIndex: i } });
            }
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

function renderLeaderboard(room) {
    const el = document.getElementById('leaderboard');
    el.innerHTML = '';
    const sorted = [...room.players].sort((a, b) => a.finalScore - b.finalScore);
    sorted.forEach(p => {
        const div = document.createElement('div');
        div.className = 'score-row';
        let name = (p.id === myId) ? "YOU" : p.name;
        if (p.id === room.caboCallerId) name += " [CALLED]";
        div.innerHTML = \`<span>\${name}</span> <span>\${p.finalScore} PTS</span>\`;
        if (p.finalScore > p.rawScore) div.classList.add('penalty-row'); 
        else if (p === sorted[0]) div.classList.add('winner-row');
        el.appendChild(div);
    });
}
`;

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

console.log("📦 Installing dependencies...");
try {
    if (!fs.existsSync('node_modules')) execSync('npm install', { stdio: 'inherit' });
    console.log("\n✅ SETUP COMPLETE! Run 'node server.js' if it doesn't start automatically.");
    execSync('node server.js', { stdio: 'inherit' });
} catch (e) { console.log("Done."); }