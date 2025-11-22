
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

// Character selection
const characters = ['🃏', '🎭', '🎪', '🎨', '🎯', '🎲', '🎰', '🎳'];
let selectedCharacterIndex = parseInt(localStorage.getItem('kyro_character_index')) || 0;
let selectedCharacter = characters[selectedCharacterIndex];

const getEl = (id) => document.getElementById(id);
const els = {
    login: getEl('login-screen'),
    game: getEl('game-screen'),
    characterDisplay: getEl('character-display'),
    charPrev: getEl('char-prev'),
    charNext: getEl('char-next'),
    createBtn: getEl('create-btn'),
    joinRandomBtn: getEl('join-random-btn'),
    joinPrivateArea: getEl('join-private-area'),
    cancelJoinBtn: getEl('cancel-join-btn'),
    navRulesBtn: getEl('nav-rules-btn'),
    navLeaderboardBtn: getEl('nav-leaderboard-btn'),
    nameInput: getEl('name-input'),
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
    lobbyOverlay: getEl('lobby-overlay'),
    lobbyRoomName: getEl('lobby-room-name'),
    lobbyPlayerCount: getEl('lobby-player-count'),
    lobbyPlayersList: getEl('lobby-players-list'),
    lobbyUrl: getEl('lobby-url'),
    copyUrlBtn: getEl('copy-url-btn'),
    shareUrlBtn: getEl('share-url-btn'),
    resetSettingsBtn: getEl('reset-settings-btn'),
    gameOver: getEl('game-over-overlay'),
    roundTitle: getEl('round-title'),
    leaderboard: getEl('leaderboard'),
    playAgainBtn: getEl('play-again-btn'),
    lobbyBtn: getEl('lobby-btn'),
    matchToast: getEl('match-toast'),
    kyroBtn: getEl('kyro-btn'),
    swapNotification: getEl('swap-notification'),
    howToPlayBtn: getEl('how-to-play-btn'),
    rulesModal: getEl('rules-modal'),
    closeRulesBtn: getEl('close-rules'),
    copyLinkBtn: getEl('copy-link-btn'),
    leaveGameBtn: getEl('leave-game-btn')
};

// Load saved name and character
const savedName = localStorage.getItem('kyro_name');
if (savedName) els.nameInput.value = savedName;
els.characterDisplay.innerText = selectedCharacter;

// Character selection handlers
els.charPrev.onclick = () => {
    selectedCharacterIndex = (selectedCharacterIndex - 1 + characters.length) % characters.length;
    selectedCharacter = characters[selectedCharacterIndex];
    els.characterDisplay.innerText = selectedCharacter;
    localStorage.setItem('kyro_character_index', selectedCharacterIndex);
};

els.charNext.onclick = () => {
    selectedCharacterIndex = (selectedCharacterIndex + 1) % characters.length;
    selectedCharacter = characters[selectedCharacterIndex];
    els.characterDisplay.innerText = selectedCharacter;
    localStorage.setItem('kyro_character_index', selectedCharacterIndex);
};

// Navigation handlers
els.navRulesBtn.onclick = () => els.rulesModal.classList.remove('hidden');
els.navLeaderboardBtn.onclick = () => {
    // TODO: Show leaderboard
    alert('Leaderboard coming soon!');
};

// Join random game (matchmaking would go here)
els.joinRandomBtn.onclick = () => {
    const playerName = (els.nameInput.value && els.nameInput.value.trim()) || 'Player';
    localStorage.setItem('kyro_name', playerName);
    socket.emit('joinGame', { roomId: Math.random().toString(36).substring(2, 6).toUpperCase(), token: playerToken, name: playerName, character: selectedCharacter });
};

// Show join private game area
els.createBtn.onclick = () => {
    els.joinPrivateArea.classList.toggle('hidden');
};

els.cancelJoinBtn.onclick = () => {
    els.joinPrivateArea.classList.add('hidden');
    els.roomInput.value = '';
};

const urlParams = new URLSearchParams(window.location.search);
const autoJoinRoom = urlParams.get('room');
if(autoJoinRoom) {
    els.roomInput.value = autoJoinRoom;
    const playerName = els.nameInput.value || 'Player';
    localStorage.setItem('kyro_name', playerName);
    socket.emit('joinGame', { roomId: autoJoinRoom, token: playerToken, name: playerName, character: selectedCharacter });
}

els.confirmJoinBtn.onclick = () => {
    if(!els.roomInput.value) return;
    const playerName = (els.nameInput.value && els.nameInput.value.trim()) || 'Player';
    localStorage.setItem('kyro_name', playerName);
    socket.emit('joinGame', { roomId: els.roomInput.value, token: playerToken, name: playerName, character: selectedCharacter });
    els.joinPrivateArea.classList.add('hidden');
};
els.playAgainBtn.onclick = () => socket.emit('playAgain', room.id);
els.lobbyBtn.onclick = () => { window.history.replaceState({}, document.title, "/"); location.reload(); };
els.leaveGameBtn.onclick = () => { if(confirm("Leave the game?")) { window.history.replaceState({}, document.title, "/"); location.reload(); } };
els.closeRulesBtn.onclick = () => els.rulesModal.classList.add('hidden');
els.copyLinkBtn.onclick = () => { navigator.clipboard.writeText(window.location.origin + '?room=' + room.id); els.copyLinkBtn.innerText = "COPIED!"; setTimeout(() => els.copyLinkBtn.innerText = "🔗 COPY", 2000); };
els.copyUrlBtn.onclick = () => {
    const url = window.location.origin + '?room=' + room.id;
    navigator.clipboard.writeText(url);
    els.copyUrlBtn.innerText = "✓";
    setTimeout(() => els.copyUrlBtn.innerText = "📋", 1500);
};
els.shareUrlBtn.onclick = () => {
    const url = window.location.origin + '?room=' + room.id;
    if (navigator.share) {
        navigator.share({ title: 'Join my Kyro game!', url: url });
    } else {
        navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
    }
};
els.resetSettingsBtn.onclick = () => {
    alert('Settings reset coming soon!');
};
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

    if (room.state !== 'LOBBY' && room.lastSwapInfo && room.lastSwapInfo.timestamp !== lastSwapTimestamp && room.lastSwapInfo.type !== 'RESET') {
        lastSwapTimestamp = room.lastSwapInfo.timestamp;
        els.swapNotification.innerText = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "PENALTY!" : "SWAP!";
        els.swapNotification.style.color = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "var(--danger)" : "var(--secondary)";
        els.swapNotification.classList.remove('hidden');
        setTimeout(() => els.swapNotification.classList.add('hidden'), 1500);
    }

    // Show/hide room code and copy button based on game state
    if(room.state === 'LOBBY' || room.state === 'GAME_OVER') {
        els.roomCode.classList.remove('hidden');
        els.copyLinkBtn.classList.remove('hidden');
        els.leaveGameBtn.classList.add('hidden');
    } else {
        els.roomCode.classList.add('hidden');
        els.copyLinkBtn.classList.add('hidden');
        els.leaveGameBtn.classList.remove('hidden');
    }

    let statusText = "";

    if(room.state === 'LOBBY') {
        statusText = room.players.length > 1 ? "OPPONENT READY" : "WAITING FOR OPPONENT";
        els.lobbyOverlay.classList.remove('hidden');
        renderLobbyPlayers(room);
        getEl('start-btn').classList.toggle('hidden', room.players.length < 2);
    } else {
        els.lobbyOverlay.classList.add('hidden');
    }

    if(room.state === 'PEEKING') {
        const peeks = room.peeksRemaining[myId] || 0;
        statusText = peeks > 0 ? `TAP ${peeks} CARDS TO REVEAL` : "WAITING FOR OPPONENT";
        getEl('start-btn').classList.add('hidden');
    } else if(room.state === 'ROUND_OVER' || room.state === 'GAME_OVER') {
        statusText = room.state === 'GAME_OVER' ? "GAME OVER" : "ROUND OVER";
        els.gameOver.classList.remove('hidden');
        els.roundTitle.innerText = room.state === 'GAME_OVER' ? "GAME OVER" : "ROUND OVER";
        els.playAgainBtn.classList.toggle('hidden', room.state === 'GAME_OVER');
        renderLeaderboard(room, me);
    } else if(room.state === 'PLAYING') {
        if(room.penaltyPending && isMyTurn) {
            statusText = "TAP YOUR CARD TO GIVE AWAY";
        } else if(room.penaltyPending) {
            statusText = "OPPONENT GIVING CARD";
        } else if(room.kyroCallerId) {
            statusText = (room.kyroCallerId === myId) ? "YOU CALLED KYRO!" : "OPPONENT CALLED KYRO!";
        } else if(isMyTurn) {
            // Will be overridden by detailed instructions below
            statusText = "YOUR TURN";
        } else {
            statusText = "OPPONENT'S TURN";
        }
        getEl('start-btn').classList.add('hidden');
    }

    els.status.innerText = statusText;
    
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

    if (isMyTurn && !room.drawnCard && !room.penaltyPending && room.state === 'PLAYING' && !room.kyroCallerId) els.kyroBtn.classList.remove('hidden');
    else els.kyroBtn.classList.add('hidden');

    // Update status text with detailed instructions when it's your turn
    if(isMyTurn && room.state === 'PLAYING' && !room.penaltyPending && !room.kyroCallerId) {
        if(room.drawnCard) {
            // You have a drawn card
            if(room.drawnCard.fromDiscard) {
                statusText = "MUST SWAP WITH HAND";
            } else if(room.drawnCard.power) {
                statusText = "SWAP OR USE POWER";
            } else {
                statusText = "SWAP OR DISCARD";
            }
        } else if(!room.activePower) {
            // No card drawn, can draw or match
            if (selectedForMatch) {
                statusText = "TAP DISCARD TO MATCH";
            } else {
                statusText = "DRAW OR SELECT CARD TO MATCH";
            }
        }
    }

    els.status.innerText = statusText;

    if(isMyTurn && !room.drawnCard && !room.activePower && !room.penaltyPending && room.state === 'PLAYING') {
        els.stock.classList.add('my-turn-glow');
        els.stock.onclick = () => socket.emit('action', { roomId: room.id, type: 'DRAW_STOCK' });
        if (selectedForMatch) {
            els.discard.style.boxShadow = "0 0 0 4px var(--secondary)";
            els.discard.onclick = () => { socket.emit('action', { roomId: room.id, type: 'ATTEMPT_MATCH', payload: { targetOwnerId: selectedForMatch.ownerId, cardIndex: selectedForMatch.index } }); selectedForMatch = null; };
        } else {
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
        els.drawnContainer.classList.add('hidden');
    } else if(room.drawnCard && isMyTurn) {
        els.drawnContainer.classList.remove('hidden');
        els.drawnSlot.innerHTML = '';
        els.drawnSlot.appendChild(createCard(room.drawnCard, true));
        if(room.drawnCard.fromDiscard) {
            els.trashBtn.classList.add('hidden');
        } else {
            els.trashBtn.classList.remove('hidden');
            if(room.drawnCard.power) {
                els.trashBtn.innerHTML = 'USE';
                els.trashBtn.style.fontSize = '0.9rem';
                els.trashBtn.style.fontWeight = 'bold';
            } else {
                els.trashBtn.innerHTML = '🗑';
                els.trashBtn.style.fontSize = '1.1rem';
                els.trashBtn.style.fontWeight = 'normal';
            }
            els.trashBtn.onclick = () => socket.emit('action', { roomId: room.id, type: 'DISCARD_DRAWN' });
        }
    } else {
        els.drawnContainer.classList.add('hidden');
        els.trashBtn.classList.add('hidden');
    }
}

function renderHand(container, cards, isMine, isTurn, isPeeking) {
    container.innerHTML = '';
    if(!cards) return;
    const playerId = isMine ? 'me' : 'opp';
    const previousCount = previousHandCounts[playerId] || cards.length;
    const receivedNewCard = cards.length > previousCount;
    previousHandCounts[playerId] = cards.length;

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
        const valueClass = data.val === 'JOKER' ? 'card-value joker' : 'card-value';
        d.innerHTML = `<span class="${valueClass}">${data.val}</span><div class="suit">${data.suit}</div>${powerIcon}`;
        if(data.suit === '♥' || data.suit === '♦') d.classList.add('red');
    }
    return d;
}

function renderLeaderboard(room, me) {
    const el = document.getElementById('leaderboard');
    el.innerHTML = '';

    const isGameOver = room.state === 'GAME_OVER';
    const sortedPlayers = [...room.players].sort((a, b) => {
        // For GAME_OVER, sort by total score; for ROUND_OVER, sort by round score
        return isGameOver ? (a.totalScore - b.totalScore) : (a.finalScore - b.finalScore);
    });

    sortedPlayers.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = 'score-row';
        let name = (p.token === playerToken) ? "YOU" : p.name;
        if (p.id === room.kyroCallerId) name += " [CALLED]";

        // Show round score and total score
        const roundScore = p.finalScore || 0;
        const totalScore = p.totalScore || 0;

        if (isGameOver) {
            div.innerHTML = `<span>${name}</span> <span>${totalScore} PTS</span>`;
            if (idx === 0) div.classList.add('winner-row');
        } else {
            div.innerHTML = `<span>${name}</span> <span>+${roundScore} (${totalScore} total)</span>`;
            if (p.finalScore > p.rawScore) div.classList.add('penalty-row');
        }

        el.appendChild(div);
    });
}

function renderLobbyPlayers(room) {
    const maxPlayers = 4;

    // Update room name
    const me = room.players.find(p => p.token === playerToken);
    if (me) {
        els.lobbyRoomName.innerText = `${me.name}'s game`;
    }

    // Update player count
    els.lobbyPlayerCount.innerText = `Players ${room.players.length}/${maxPlayers}`;

    // Update lobby URL
    els.lobbyUrl.value = `${window.location.origin}?room=${room.id}`;

    // Clear player list
    els.lobbyPlayersList.innerHTML = '';

    // Show joined players with character icons
    room.players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'lobby-player-item';

        const charDiv = document.createElement('div');
        charDiv.className = 'lobby-player-character';
        charDiv.innerText = p.character || '🃏';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'lobby-player-name';
        nameDiv.innerText = p.token === playerToken ? p.name : p.name;

        div.appendChild(charDiv);
        div.appendChild(nameDiv);
        els.lobbyPlayersList.appendChild(div);
    });
}
