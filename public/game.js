
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
        els.status.innerText = `PEEK PHASE (${peeks})`;
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
    if(room.activePower) {
        const powerText = room.activePower === 'PEEK' ? 'EYE // TAP YOUR CARD' :
                         room.activePower === 'SPY' ? 'SPY // TAP OPPONENT CARD' :
                         'SWAP // TAP 2 CARDS';
        els.powerOverlay.querySelector('.power-badge').innerText = powerText;
    }

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
        instructionText = peeks > 0 ? `TAP ${peeks} CARDS TO REVEAL` : "WAITING...";
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
            if(room.drawnCard.power) {
                instructionText = "SWAP OR DISCARD TO USE POWER";
            } else {
                instructionText = "SWAP OR DISCARD";
            }
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
        d.innerHTML = `<span class="card-value">${data.val}</span><div class="suit">${data.suit}</div>${powerIcon}`;
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
        div.innerHTML = `<span>${name}</span> <span>${p.finalScore} PTS</span>`;
        if (p.finalScore > p.rawScore) div.classList.add('penalty-row'); 
        else if (idx === 0) div.classList.add('winner-row');
        el.appendChild(div);
    });
}
