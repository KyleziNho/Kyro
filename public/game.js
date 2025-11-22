
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
    joinCodeBtn: getEl('join-code-btn'),
    joinPrivateArea: getEl('join-private-area'),
    cancelJoinBtn: getEl('cancel-join-btn'),
    navRulesBtn: getEl('nav-rules-btn'),
    navLeaderboardBtn: getEl('nav-leaderboard-btn'),
    rulesBtn: getEl('rules-btn'),
    nameInput: getEl('name-input'),
    roomInput: getEl('room-input'),
    confirmJoinBtn: getEl('confirm-join-btn'),
    gameInstruction: getEl('game-instruction'),
    p0Character: getEl('p0-character'),
    p0Name: getEl('p0-name'),
    p0Hand: getEl('p0-hand'),
    p1Character: getEl('p1-character'),
    p1Name: getEl('p1-name'),
    p1Hand: getEl('p1-hand'),
    p2Character: getEl('p2-character'),
    p2Name: getEl('p2-name'),
    p2Hand: getEl('p2-hand'),
    p3Character: getEl('p3-character'),
    p3Name: getEl('p3-name'),
    p3Hand: getEl('p3-hand'),
    disconnectOverlay: getEl('disconnect-overlay'),
    countdown: getEl('countdown-overlay'),
    timerVal: getEl('timer-val'),
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
els.rulesBtn.onclick = () => els.rulesModal.classList.remove('hidden');
els.navLeaderboardBtn.onclick = () => {
    // TODO: Show leaderboard
    alert('Leaderboard coming soon!');
};

// Find random game
els.joinRandomBtn.onclick = () => {
    const playerName = (els.nameInput.value && els.nameInput.value.trim()) || 'Player';
    localStorage.setItem('kyro_name', playerName);
    socket.emit('joinGame', { roomId: Math.random().toString(36).substring(2, 6).toUpperCase(), token: playerToken, name: playerName, character: selectedCharacter });
};

// Create private game
els.createBtn.onclick = () => {
    const playerName = (els.nameInput.value && els.nameInput.value.trim()) || 'Player';
    localStorage.setItem('kyro_name', playerName);
    const newRoomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    socket.emit('joinGame', { roomId: newRoomId, token: playerToken, name: playerName, character: selectedCharacter });
};

// Show join with code input
els.joinCodeBtn.onclick = () => {
    els.joinPrivateArea.classList.remove('hidden');
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
    socket.emit('joinGame', { roomId: els.roomInput.value.toUpperCase(), token: playerToken, name: playerName, character: selectedCharacter });
    els.joinPrivateArea.classList.add('hidden');
    els.roomInput.value = '';
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

    const anyDisconnected = room.players.some(p => p.token !== playerToken && !p.connected);
    if (room.state !== 'LOBBY' && anyDisconnected) {
        els.disconnectOverlay.classList.remove('hidden');
    } else {
        els.disconnectOverlay.classList.add('hidden');
        if (els.login.classList.contains('active')) {
            els.login.classList.remove('active');
            els.game.classList.add('active');
        }
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
    if (!room) return;
    const me = room.players.find(p => p.token === playerToken);
    if (!me) return;
    myId = me.id;
    const myIndex = room.players.indexOf(me);
    const isMyTurn = room.turnIndex === myIndex;
    const numPlayers = room.players.length;

    // Map players to positions (me always at bottom - position 3)
    // Position 0 (top), 1 (left), 2 (right), 3 (bottom)
    const positions = [null, null, null, null];

    for (let i = 0; i < numPlayers; i++) {
        if (i === myIndex) {
            positions[3] = room.players[i]; // Me at bottom
        } else {
            const relativePos = (i - myIndex + numPlayers) % numPlayers;
            if (relativePos === 1) positions[2] = room.players[i]; // Right
            else if (relativePos === 2) positions[0] = room.players[i]; // Top
            else if (relativePos === 3) positions[1] = room.players[i]; // Left
        }
    }

    // Update all player indicators
    if (positions[0]) {
        els.p0Character.innerText = positions[0].character || '🃏';
        els.p0Name.innerText = positions[0].name || 'Player';
    }
    if (positions[1]) {
        els.p1Character.innerText = positions[1].character || '🃏';
        els.p1Name.innerText = positions[1].name || 'Player';
    }
    if (positions[2]) {
        els.p2Character.innerText = positions[2].character || '🃏';
        els.p2Name.innerText = positions[2].name || 'Player';
    }
    if (positions[3]) {
        els.p3Character.innerText = positions[3].character || '🃏';
        els.p3Name.innerText = positions[3].name + ' (You)';
    }

    els.gameOver.classList.add('hidden');

    if (room.state !== 'LOBBY' && room.lastSwapInfo && room.lastSwapInfo.timestamp !== lastSwapTimestamp && room.lastSwapInfo.type !== 'RESET') {
        lastSwapTimestamp = room.lastSwapInfo.timestamp;
        els.swapNotification.innerText = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "PENALTY!" : "SWAP!";
        els.swapNotification.style.color = room.lastSwapInfo.type === 'GIVE_PENALTY' ? "var(--danger)" : "var(--secondary)";
        els.swapNotification.classList.remove('hidden');
        setTimeout(() => els.swapNotification.classList.add('hidden'), 1500);
    }

    // Show/hide buttons based on game state
    if(room.state === 'LOBBY' || room.state === 'GAME_OVER') {
        els.copyLinkBtn.classList.remove('hidden');
        els.leaveGameBtn.classList.add('hidden');
    } else {
        els.copyLinkBtn.classList.add('hidden');
        els.leaveGameBtn.classList.remove('hidden');
    }

    let statusText = "";

    if(room.state === 'LOBBY') {
        statusText = room.players.length > 1 ? "OPPONENT READY" : "WAITING FOR OPPONENT";
        els.lobbyOverlay.classList.remove('hidden');
        renderLobbyPlayers(room);

        // Only show start button to host when there are at least 2 players
        const isHost = room.players[0] && room.players[0].token === playerToken;
        const canStart = room.players.length >= 2 && isHost;
        getEl('start-btn').classList.toggle('hidden', !canStart);
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

    els.gameInstruction.innerText = statusText;

    els.powerOverlay.classList.toggle('hidden', !room.activePower);
    if(room.activePower) {
        const powerText = room.activePower === 'PEEK' ? 'EYE // TAP YOUR CARD' :
                         room.activePower === 'SPY' ? 'SPY // TAP OPPONENT CARD' :
                         'SWAP // TAP 2 CARDS';
        els.powerOverlay.querySelector('.power-badge').innerText = powerText;
    }

    // Render all player hands
    renderHand(els.p0Hand, positions[0] ? positions[0].hand : [], positions[0], isMyTurn, false, 0);
    renderHand(els.p1Hand, positions[1] ? positions[1].hand : [], positions[1], isMyTurn, false, 1);
    renderHand(els.p2Hand, positions[2] ? positions[2].hand : [], positions[2], isMyTurn, false, 2);
    renderHand(els.p3Hand, positions[3] ? positions[3].hand : [], positions[3], isMyTurn, isPeeking, 3);

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

    els.gameInstruction.innerText = statusText;

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

function renderHand(container, cards, player, isTurn, isPeeking, positionIndex) {
    container.innerHTML = '';
    if (!cards || !player) return;

    const isMine = positionIndex === 3; // Position 3 is always me
    const playerId = player.id;
    const previousCount = previousHandCounts[playerId] || cards.length;
    const receivedNewCard = cards.length > previousCount;
    previousHandCounts[playerId] = cards.length;

    cards.forEach((c, i) => {
        const el = createCard(c.card, c.visible);
        if (receivedNewCard && i === cards.length - 1) el.classList.add('receiving');
        if (selectedForMatch && selectedForMatch.ownerId === playerId && selectedForMatch.index === i) el.classList.add('selected');

        if (room.lastSwapInfo) {
            const swap = room.lastSwapInfo;
            const isTarget = (swap.type === 'HAND_SWAP' && swap.playerId === playerId && swap.cardIndex === i) ||
                           (swap.type === 'POWER_SWAP' && ((swap.player1Id === playerId && swap.player1Index === i) ||
                            (swap.player2Id === playerId && swap.player2Index === i)));
            if (isTarget) {
                el.classList.add('swapped-highlight');
                setTimeout(() => el.classList.remove('swapped-highlight'), 3000);
            }
        }

        el.onclick = () => {
            if (room.state === 'PEEKING' && isMine) {
                if (room.peeksRemaining[myId] > 0) socket.emit('peekCard', { roomId: room.id, cardIndex: i });
                return;
            }
            if (!isTurn) return;
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
                if (selectedForMatch && selectedForMatch.index === i && selectedForMatch.ownerId === playerId) {
                    selectedForMatch = null;
                } else {
                    selectedForMatch = { ownerId: playerId, index: i };
                }
                render();
                return;
            }
            if (room.activePower) {
                socket.emit('action', { roomId: room.id, type: 'USE_POWER', payload: { targetPlayerId: playerId, cardIndex: i } });
            }
        };
        container.appendChild(el);
    });
}

function createCard(data, visible) {
    const d = document.createElement('div');
    d.className = 'game-card ' + (visible ? '' : 'face-down');
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

    // Update room name (show host's name - first player)
    if (room.players.length > 0) {
        const host = room.players[0];
        els.lobbyRoomName.innerText = `${host.name}'s game`;
    }

    // Update player count
    els.lobbyPlayerCount.innerText = `Players ${room.players.length}/${maxPlayers}`;

    // Update lobby URL
    els.lobbyUrl.value = `${window.location.origin}?room=${room.id}`;

    // Clear player list
    els.lobbyPlayersList.innerHTML = '';

    // Show joined players with character icons
    room.players.forEach((p, index) => {
        const div = document.createElement('div');
        div.className = 'lobby-player-item';

        const charDiv = document.createElement('div');
        charDiv.className = 'lobby-player-character';
        charDiv.innerText = p.character || '🃏';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'lobby-player-name';
        const isYou = p.token === playerToken;
        const isHost = index === 0;
        nameDiv.innerText = isYou ? `${p.name} (You)` : p.name;
        if (isHost && !isYou) nameDiv.innerText += ' (Host)';

        div.appendChild(charDiv);
        div.appendChild(nameDiv);
        els.lobbyPlayersList.appendChild(div);
    });
}
