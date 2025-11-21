
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
        els.status.innerText = `PEEK AT ${peeksLeft} CARDS`;
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
        instructionText = peeksLeft > 0 ? `TAP ${peeksLeft} CARDS TO REVEAL` : "WAITING FOR OPPONENT";
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
        d.innerHTML = `<span class="card-value">${data.val}</span><div class="suit">${data.suit}</div>${powerIcon}`;
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
        div.innerHTML = `<span>${name}</span> <span>${p.finalScore} PTS</span>`;
        if (p.finalScore > p.rawScore) div.classList.add('penalty-row'); 
        else if (p === sorted[0]) div.classList.add('winner-row');
        el.appendChild(div);
    });
}
