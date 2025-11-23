
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
    { val: 'A', score: -1 }, { val: '2', score: 2 }, { val: '3', score: 3 },
    { val: '4', score: 4 }, { val: '5', score: 5 }, { val: '6', score: 6 },
    { val: '7', score: 7 }, { val: '8', score: 8 }, { val: '9', score: 9 },
    { val: '10', score: 10 },
    { val: 'J', score: 11, power: 'PEEK' },
    { val: 'Q', score: 12, power: 'SPY' },
    { val: 'K', score: 13, power: 'SWAP' },
    { val: 'JOKER', score: 0, power: 'SWAP' }
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
        if (val === 'JOKER') score = 0;
        else if (val === 'K') score = 13;
        else if (val === 'Q') score = 12;
        else if (val === 'J') score = 11;
        else if (val === 'A') score = -1;
        else score = parseInt(val);
        return acc + score;
    }, 0);
}

// Clean room state for Socket.io emission (removes circular refs and non-serializable data)
function getCleanRoomState(room) {
    return {
        id: room.id,
        players: room.players.map(p => ({
            id: p.id,
            token: p.token,
            connected: p.connected,
            hand: p.hand,
            score: p.score,
            totalScore: p.totalScore,
            name: p.name,
            character: p.character,
            rawScore: p.rawScore,
            finalScore: p.finalScore
        })),
        state: room.state,
        deck: room.deck,
        discardPile: room.discardPile,
        turnIndex: room.turnIndex,
        activePower: room.activePower,
        swapSelection: room.swapSelection,
        penaltyPending: room.penaltyPending,
        hasMatched: room.hasMatched,
        drawnCard: room.drawnCard,
        kyroCallerId: room.kyroCallerId,
        peeksRemaining: room.peeksRemaining,
        lastSwapInfo: room.lastSwapInfo,
        gameWinner: room.gameWinner,
        finalRoundStartTurn: room.finalRoundStartTurn,
        finalRoundTriggeredBy: room.finalRoundTriggeredBy,
        finalRoundReason: room.finalRoundReason,
        currentRound: room.currentRound,
        roundHistory: room.roundHistory,
        playersReady: room.playersReady,
        lastRoundWinner: room.lastRoundWinner
    };
}

io.on('connection', (socket) => {
    
    // JOIN GAME (With Reconnect Logic)
    socket.on('joinGame', ({ roomId, token, name, character, createNew }) => {
        if(!roomId) return;
        roomId = roomId.toUpperCase();

        // If room doesn't exist and user is not creating a new one, reject
        if (!rooms[roomId] && !createNew) {
            socket.emit('error', 'Game not found. Please check the code and try again.');
            return;
        }

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
                disconnectTimer: null,
                finalRoundStartTurn: null,
                finalRoundTriggeredBy: null,
                finalRoundReason: null,
                currentRound: 0,
                roundHistory: [],
                playersReady: [],
                lastRoundWinner: null,
                settings: {
                    pointsToEnd: 50,
                    maxRounds: null  // null means unlimited
                }
            };
        }
        const room = rooms[roomId];

        let player = room.players.find(p => p.token === token);

        if (player) {
            player.id = socket.id;
            player.connected = true;
            if (name) player.name = name;
            if (character) player.character = character;
            if (room.disconnectTimer && room.players.every(p => p.connected)) {
                clearTimeout(room.disconnectTimer);
                room.disconnectTimer = null;
            }
        } else {
            if (room.players.length < 4) {
                room.players.push({
                    id: socket.id,
                    token: token,
                    connected: true,
                    hand: [],
                    score: 0,
                    totalScore: 0,
                    name: name || 'Player ' + (room.players.length + 1),
                    character: character || 'boba.png'
                });
            } else {
                socket.emit('error', 'Game is full (4 players max)');
                return;
            }
        }

        socket.join(roomId);
        socketMap[socket.id] = { roomId, token };
        io.to(roomId).emit('gameState', getCleanRoomState(room));
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
                    io.to(room.id).emit('gameState', getCleanRoomState(room));
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
        room.finalRoundStartTurn = null;
        room.finalRoundTriggeredBy = null;
        room.finalRoundReason = null;
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
            p.totalScore = 0;
            room.peeksRemaining[p.id] = 2;
        });

        io.to(roomId).emit('gameState', getCleanRoomState(room));
        io.to(roomId).emit('startPeek', { duration: 5000 });

        setTimeout(() => {
            if(room.state === 'PEEKING') {
                room.state = 'PLAYING';
                room.turnIndex = Math.floor(Math.random() * room.players.length);
                io.to(roomId).emit('gameState', getCleanRoomState(room));
            }
        }, 5500);
    });

    socket.on('playAgain', (roomId) => {
        const room = rooms[roomId];
        if (!room || (room.state !== 'ROUND_OVER' && room.state !== 'GAME_OVER')) return;

        const isGameOver = room.state === 'GAME_OVER';

        // Add player to ready list
        if (!room.playersReady.includes(socket.id)) {
            room.playersReady.push(socket.id);
        }

        // Send updated state to all players
        io.to(roomId).emit('gameState', getCleanRoomState(room));

        // Check if all players are ready
        if (room.playersReady.length === room.players.length) {
            // All players ready, start new round/game
            room.deck = createDeck();
            room.discardPile = [room.deck.pop()];
            room.activePower = null;
            room.drawnCard = null;
            room.penaltyPending = false;
            room.hasMatched = false;
            room.kyroCallerId = null;
            room.gameWinner = null;
            room.finalRoundStartTurn = null;
            room.finalRoundTriggeredBy = null;
            room.finalRoundReason = null;
            room.playersReady = [];
            room.state = 'PEEKING';
            room.lastSwapInfo = { timestamp: Date.now(), type: 'RESET' };

            // If game over, reset all scores and history
            if (isGameOver) {
                room.currentRound = 0;
                room.roundHistory = [];
                room.lastRoundWinner = null;
            }

            room.players.forEach(p => {
                p.hand = [
                    { card: room.deck.pop(), visible: false },
                    { card: room.deck.pop(), visible: false },
                    { card: room.deck.pop(), visible: false },
                    { card: room.deck.pop(), visible: false }
                ];
                p.score = 0;
                p.rawScore = 0;
                p.finalScore = 0;
                // Reset total score if game over
                if (isGameOver) {
                    p.totalScore = 0;
                }
                room.peeksRemaining[p.id] = 2;
            });

            io.to(roomId).emit('gameState', getCleanRoomState(room));
            io.to(roomId).emit('startPeek', { duration: 5000 });

            setTimeout(() => {
                if(room.state === 'PEEKING') {
                    room.state = 'PLAYING';
                    // Last round winner starts first, or random if no winner yet
                    if (room.lastRoundWinner) {
                        const winnerIdx = room.players.findIndex(p => p.id === room.lastRoundWinner);
                        room.turnIndex = winnerIdx >= 0 ? winnerIdx : Math.floor(Math.random() * room.players.length);
                    } else {
                        room.turnIndex = Math.floor(Math.random() * room.players.length);
                    }
                    io.to(roomId).emit('gameState', getCleanRoomState(room));
                }
            }, 5500);
        }
    });

    socket.on('peekCard', (data) => {
        const room = rooms[data.roomId];
        if (room && room.state === 'PEEKING' && room.peeksRemaining[socket.id] > 0) {
            const player = room.players.find(p => p.id === socket.id);
            socket.emit('peekResult', { card: player.hand[data.cardIndex].card });
            room.peeksRemaining[socket.id]--;
            io.to(room.id).emit('gameState', getCleanRoomState(room));
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
            // Start final round - everyone gets one more turn
            room.finalRoundStartTurn = room.turnIndex;
            room.finalRoundTriggeredBy = socket.id;
            room.finalRoundReason = 'KYRO';
            io.to(roomId).emit('gameState', getCleanRoomState(room));
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
            io.to(roomId).emit('gameState', getCleanRoomState(room));
            return;
        }

        if (type === 'GIVE_CARD' && room.penaltyPending) {
            const { handIndex } = payload;
            const myCard = room.players[playerIdx].hand[handIndex];
            room.players[playerIdx].hand.splice(handIndex, 1);
            myCard.visible = false;
            const newCardIndex = room.players[oppIdx].hand.length;
            room.players[oppIdx].hand.push(myCard);
            // Track card transfer for visual indicator
            room.lastSwapInfo = { timestamp: Date.now(), type: 'CARD_TRANSFER', fromPlayerId: socket.id, fromCardIndex: handIndex, toPlayerId: room.players[oppIdx].id, toCardIndex: newCardIndex };
            room.penaltyPending = false;
            io.to(roomId).emit('gameState', getCleanRoomState(room));
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
            // Track card replacement for visual indicator
            room.lastSwapInfo = { timestamp: Date.now(), type: 'CARD_REPLACE', playerId: socket.id, cardIndex: payload.handIndex };
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
                    room.lastSwapInfo = { timestamp: Date.now(), type: 'PEEK', playerId: socket.id, cardIndex };
                    endTurn(room);
                }
            } else if (room.activePower === 'SPY') {
                if(targetPlayerId !== socket.id) {
                    socket.emit('peekResult', { card: room.players[oppIdx].hand[cardIndex].card });
                    room.lastSwapInfo = { timestamp: Date.now(), type: 'SPY', spyerId: socket.id, targetId: targetPlayerId, cardIndex };
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
        
        io.to(roomId).emit('gameState', getCleanRoomState(room));
    });

    socket.on('chatMessage', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (!room || !message || message.trim() === '') return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const chatData = {
            playerId: socket.id,
            playerName: player.name,
            message: message.trim().substring(0, 150), // Limit message length
            timestamp: Date.now()
        };

        io.to(roomId).emit('chatMessage', chatData);
    });

    function endTurn(room) {
        room.drawnCard = null;
        room.activePower = null;
        room.hasMatched = false;
        room.penaltyPending = false;
        room.swapSelection = null;
        room.turnIndex = (room.turnIndex + 1) % room.players.length;

        // Check if someone just reached 0 cards
        const zeroCardPlayer = room.players.find(p => p.hand.length === 0);
        if (zeroCardPlayer && !room.finalRoundStartTurn) {
            // Start final round
            room.finalRoundStartTurn = room.turnIndex;
            room.finalRoundTriggeredBy = zeroCardPlayer.id;
            room.finalRoundReason = 'ZERO_CARDS';
        }

        // Check if final round is complete (everyone except 0-card player had one more turn)
        if (room.finalRoundStartTurn !== null) {
            const turnsCompleted = (room.turnIndex - room.finalRoundStartTurn + room.players.length) % room.players.length;
            const playersToTurn = room.players.filter(p => p.id !== room.finalRoundTriggeredBy).length;
            if (turnsCompleted >= playersToTurn) {
                endGame(room);
            }
        }
    }

    function endGame(room) {
        // Calculate round scores
        room.players.forEach(p => {
            p.rawScore = calculateScore(p.hand);
            p.finalScore = p.rawScore;
            p.hand.forEach(c => c.visible = true);
        });

        // Apply Kyro penalty if called
        if (room.kyroCallerId) {
            const caller = room.players.find(p => p.id === room.kyroCallerId);
            if (caller) {
                // Find the actual lowest score among all players
                const lowestScore = Math.min(...room.players.map(p => p.rawScore));

                // If caller has the lowest score, they get 0 points
                // Otherwise, their points double
                if (caller.rawScore === lowestScore) {
                    caller.finalScore = 0;
                } else {
                    caller.finalScore = caller.rawScore * 2;
                }
            }
        }

        // Save round history before adding to totals
        room.currentRound++;
        const roundData = {};
        room.players.forEach(p => {
            roundData[p.id] = {
                score: p.finalScore,
                rawScore: p.rawScore,
                doubled: p.finalScore > p.rawScore && p.finalScore !== 0
            };
        });
        room.roundHistory.push(roundData);

        // Add round scores to total scores
        room.players.forEach(p => {
            p.totalScore += p.finalScore;
        });

        // Find round winner (lowest score)
        const sortedByRoundScore = [...room.players].sort((a, b) => a.finalScore - b.finalScore);
        room.lastRoundWinner = sortedByRoundScore[0].id;

        // First show cards revealed state
        room.state = 'REVEALING_CARDS';
        io.to(room.id).emit('gameState', getCleanRoomState(room));

        // After 3 seconds, show leaderboard
        setTimeout(() => {
            // Check if anyone has reached 50 points
            const winner = room.players.find(p => p.totalScore >= 50);
            if (winner) {
                room.state = 'GAME_OVER';
                room.gameWinner = winner.id;
            } else {
                room.state = 'ROUND_OVER';
            }

            io.to(room.id).emit('gameState', getCleanRoomState(room));
        }, 3000);
    }
});

// *** DEPLOYMENT PORT FIX ***
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
