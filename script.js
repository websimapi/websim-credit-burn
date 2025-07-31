import { marked } from 'marked';
import DOMPurify from 'dompurify';

// --- DOM Elements ---
const statusTextEl = document.getElementById('status-text');
const lastTipInfoEl = document.getElementById('last-tip-info');
const burnButton = document.getElementById('burn-button');
const commentInput = document.getElementById('comment-input');
const commentsContainer = document.getElementById('comments-container');
const actionErrorEl = document.getElementById('action-error');
const spinnerEl = document.querySelector('.spinner');
const actionHeaderEl = document.getElementById('action-header');
const totalStatsEl = document.getElementById('total-stats');
const leaderboardListEl = document.getElementById('leaderboard-list');
const actionAreaEl = document.getElementById('action-area');

// --- State ---
let projectId = null;
let currentUser = null;
let projectOwner = null;
let isOwner = false;
let gameState = 'INITIALIZING'; // INITIALIZING, USER_TURN, OWNER_TURN
let lastTip = null;
let isSubmitting = false;
let totalBurned = 0;
let totalEarned = 0;
let allTips = []; // Store all tip comments for leaderboard

// --- Main ---
async function init() {
    try {
        const project = await window.websim.getCurrentProject();
        projectId = project.id;

        const [user, owner] = await Promise.all([
            window.websim.getCurrentUser(),
            window.websim.getCreator()
        ]);
        
        currentUser = user;
        projectOwner = owner;
        isOwner = currentUser && projectOwner && currentUser.id === projectOwner.id;

        await loadTipHistory();
        await fetchLastTipAndSetState();

        burnButton.addEventListener('click', handleBurnClick);
        window.websim.addEventListener('comment:created', handleNewComment);

    } catch (error) {
        console.error("Initialization failed:", error);
        statusTextEl.textContent = "Error loading game.";
        actionErrorEl.textContent = "Could not initialize. Please refresh.";
    }
}

// --- State & UI Logic ---
async function fetchLastTipAndSetState() {
    // We already have the tips, so we can determine state from `allTips`
    spinnerEl.style.display = 'block';

    lastTip = allTips.length > 0 ? allTips[0] : null;

    if (!lastTip) {
        gameState = 'USER_TURN';
    } else if (lastTip.author.id === projectOwner.id) {
        gameState = 'USER_TURN';
    } else {
        gameState = 'OWNER_TURN';
    }

    spinnerEl.style.display = 'none';
    updateUI();
}

function updateUI() {
    actionErrorEl.textContent = '';
    
    // Update last tip info
    if (lastTip) {
        const tipAmount = lastTip.card_data?.credits_spent || 0;
        const burnedAmount = tipAmount / 2;
        const receivedAmount = tipAmount / 2;
        const author = lastTip.author.username;
        lastTipInfoEl.innerHTML = `Last move: @${author} spent <b>${tipAmount}</b> credits. <br> (<b>${burnedAmount}</b> burned 🔥, <b>${receivedAmount}</b> to @${projectOwner.username} 💰)`;
    } else {
        lastTipInfoEl.textContent = 'No one has burned credits yet. Be the first!';
    }
    
    // Update main status and button state
    switch (gameState) {
        case 'USER_TURN':
            statusTextEl.textContent = "User's Turn to Burn";
            statusTextEl.style.color = 'var(--user-color)';
            if (isOwner) {
                actionHeaderEl.textContent = `Waiting for a user to burn...`;
                actionAreaEl.style.display = 'none';
            } else {
                actionHeaderEl.textContent = `Your turn, @${currentUser?.username || 'user'}!`;
                actionAreaEl.style.display = 'block';
                burnButton.disabled = isSubmitting;
            }
            break;
        case 'OWNER_TURN':
            statusTextEl.textContent = "Owner's Turn to Match";
            statusTextEl.style.color = 'var(--owner-color)';
            if (isOwner) {
                actionHeaderEl.textContent = `Your turn, @${projectOwner.username}! Match the burn.`;
                actionAreaEl.style.display = 'block';
                burnButton.disabled = isSubmitting;
            } else {
                actionHeaderEl.textContent = `Waiting for @${projectOwner.username} to match the burn...`;
                actionAreaEl.style.display = 'none';
            }
            break;
        case 'INITIALIZING':
            statusTextEl.textContent = 'Initializing...';
            actionHeaderEl.textContent = '';
            actionAreaEl.style.display = 'none';
            burnButton.disabled = true;
            break;
        case 'ERROR':
            statusTextEl.textContent = 'Error';
            actionHeaderEl.textContent = '';
            actionAreaEl.style.display = 'none';
            burnButton.disabled = true;
            break;
    }
}

function updateTotalStats() {
    totalStatsEl.innerHTML = `
        <div class="stat-item">
            <div class="label">Total Burned</div>
            <div class="value burned">🔥 ${Math.floor(totalBurned)}</div>
        </div>
        <div class="stat-item">
            <div class="label">Total Earned by @${projectOwner?.username || 'Owner'}</div>
            <div class="value earned">💰 ${Math.floor(totalEarned)}</div>
        </div>
    `;
}

// --- API & Event Handlers ---
async function handleBurnClick() {
    if (isSubmitting) return;

    isSubmitting = true;
    burnButton.disabled = true;
    actionErrorEl.textContent = '';
    spinnerEl.style.display = 'block';

    try {
        const content = commentInput.value.trim() || "I'm burning credits!";
        
        // The postComment function opens a dialog where the user can add a tip.
        const result = await window.websim.postComment({ content });

        if (result && result.error) {
            throw new Error(result.error);
        }
        
        commentInput.value = '';
        // We don't update state here. We wait for the 'comment:created' event.
        // This ensures we have the final comment data from the server.
        actionHeaderEl.textContent = 'Waiting for confirmation...';

    } catch (error) {
        console.error("Error posting comment:", error);
        actionErrorEl.textContent = `Failed to burn: ${error.message}`;
        isSubmitting = false;
        updateUI(); // Re-enable button if needed
    } finally {
        // Spinner is handled inside the websim dialog, so we might not need this.
        // But just in case of other errors, let's keep it.
        spinnerEl.style.display = 'none';
    }
}

function handleNewComment(data) {
    const newComment = data.comment;
    // We only care about new tip comments for game logic
    if (newComment.card_data?.type === 'tip_comment') {
        allTips.unshift(newComment); // Add to the beginning of our tips array

        // Update totals
        const tipAmount = newComment.card_data.credits_spent;
        totalBurned += tipAmount / 2;
        if (newComment.author.id === projectOwner.id) {
            // Owner tipped, so they spent `tipAmount` and got half back. Net loss of half.
            totalEarned -= tipAmount / 2;
        } else {
            // User tipped, owner receives half.
            totalEarned += tipAmount / 2;
        }
        updateTotalStats();

        // Update game state
        lastTip = newComment;
        if (newComment.author.id === projectOwner.id) {
            gameState = 'USER_TURN';
        } else {
            gameState = 'OWNER_TURN';
        }
        isSubmitting = false;
        prependComment(newComment);
        updateUI();
        updateLeaderboard();
    }
}

// --- History Rendering ---
async function loadTipHistory() {
    try {
        const response = await fetch(`/api/v1/projects/${projectId}/comments?only_tips=true&first=100`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        
        commentsContainer.innerHTML = '';
        allTips = data.comments.data.map(item => item.comment);

        // Reset totals before recalculating from history
        totalBurned = 0;
        totalEarned = 0;

        if (allTips.length === 0) {
            commentsContainer.innerHTML = '<p>The burn history is empty.</p>';
            leaderboardListEl.innerHTML = '<p>No players yet.</p>';
            updateTotalStats();
            return;
        }

        // The API returns newest first, so we reverse to process from oldest to newest
        // This keeps the display order as newest first.
        const reversedComments = allTips.slice().reverse();

        reversedComments.forEach(comment => {
            const tipAmount = comment.card_data?.credits_spent || 0;

            // Calculate totals
            totalBurned += tipAmount / 2;
            if (comment.author.id === projectOwner.id) {
                // Owner tipped, so they spent `tipAmount` and got half back. Net loss of half.
                totalEarned -= tipAmount / 2;
            } else {
                // User tipped, owner receives half.
                totalEarned += tipAmount / 2;
            }
        });

        // Render comments (newest first)
        allTips.forEach(comment => {
             const commentEl = createCommentElement(comment);
             commentsContainer.appendChild(commentEl);
        });

        updateTotalStats();
        updateLeaderboard();

    } catch (error) {
        console.error("Error loading history:", error);
        commentsContainer.innerHTML = '<p class="error-message">Could not load burn history.</p>';
        leaderboardListEl.innerHTML = '<p class="error-message">Could not load leaderboard.</p>';
    }
}

function prependComment(comment) {
    // If placeholder is present, remove it
    const placeholder = commentsContainer.querySelector('p');
    if (placeholder && placeholder.textContent.includes('empty')) {
        commentsContainer.innerHTML = '';
    }
    const commentEl = createCommentElement(comment);
    commentsContainer.prepend(commentEl);
}

function createCommentElement(comment) {
    const div = document.createElement('div');
    div.classList.add('comment-card');

    const isTipOwner = comment.author.id === projectOwner.id;
    div.classList.add(isTipOwner ? 'owner-tip' : 'user-tip');

    const sanitizedHtml = DOMPurify.sanitize(marked.parse(comment.raw_content || ''));

    const totalAmount = comment.card_data?.credits_spent || 0;
    const burnedAmount = totalAmount / 2;
    const receivedAmount = totalAmount / 2;

    const avatarUrl = comment.author.avatar_url || `https://images.websim.com/avatar/${comment.author.username}`;

    div.innerHTML = `
        <div class="comment-header">
            <div class="comment-author">
                <img src="${avatarUrl}" alt="${comment.author.username}'s avatar">
                <span>@${comment.author.username}</span>
                ${isTipOwner ? '<span class="owner-tag">(Owner)</span>' : ''}
            </div>
            <div class="comment-tip">
                <div class="tip-total">Spent: <b>${totalAmount}</b> credits</div>
                <div class="tip-breakdown">
                    <span class="burned">-${burnedAmount} 🔥</span>
                    <span class="received">+${receivedAmount} 💰</span>
                </div>
            </div>
        </div>
        <div class="comment-content">${sanitizedHtml}</div>
        <div class="comment-date">${new Date(comment.created_at).toLocaleString()}</div>
    `;
    return div;
}

function updateLeaderboard() {
    const playerBurnStats = {};

    allTips.forEach(comment => {
        const authorId = comment.author.id;
        const burnedAmount = (comment.card_data?.credits_spent || 0) / 2;

        if (!playerBurnStats[authorId]) {
            playerBurnStats[authorId] = {
                id: authorId,
                username: comment.author.username,
                avatar_url: comment.author.avatar_url,
                totalBurned: 0
            };
        }
        playerBurnStats[authorId].totalBurned += burnedAmount;
    });

    const sortedPlayers = Object.values(playerBurnStats)
        .sort((a, b) => b.totalBurned - a.totalBurned)
        .slice(0, 10);

    leaderboardListEl.innerHTML = '';
    if (sortedPlayers.length === 0) {
        leaderboardListEl.innerHTML = '<p>No players yet.</p>';
        return;
    }

    sortedPlayers.forEach((player, index) => {
        const li = document.createElement('li');
        li.classList.add('leaderboard-item');
        const avatarUrl = player.avatar_url || `https://images.websim.com/avatar/${player.username}`;

        li.innerHTML = `
            <div class="leaderboard-rank">${index + 1}</div>
            <div class="leaderboard-player">
                <img src="${avatarUrl}" alt="${player.username}'s avatar">
                <span>@${player.username}</span>
            </div>
            <div class="leaderboard-burnt">🔥 ${Math.floor(player.totalBurned)}</div>
        `;
        leaderboardListEl.appendChild(li);
    });
}

// --- Start the App ---
init();