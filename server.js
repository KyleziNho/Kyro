
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
