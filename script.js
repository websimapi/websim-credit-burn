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

// --- State ---
let projectId = null;
let currentUser = null;
let projectOwner = null;
let isOwner = false;
let gameState = 'INITIALIZING'; // INITIALIZING, USER_TURN, OWNER_TURN
let lastTip = null;
let isSubmitting = false;

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

        await fetchLastTipAndSetState();
        await loadTipHistory();

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
    spinnerEl.style.display = 'block';
    try {
        const response = await fetch(`/api/v1/projects/${projectId}/comments?only_tips=true&first=1`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        
        lastTip = data.comments.data.length > 0 ? data.comments.data[0].comment : null;

        if (!lastTip) {
            gameState = 'USER_TURN';
        } else if (lastTip.author.id === projectOwner.id) {
            gameState = 'USER_TURN';
        } else {
            gameState = 'OWNER_TURN';
        }
    } catch (error) {
        console.error("Error fetching last tip:", error);
        actionErrorEl.textContent = "Could not fetch game state.";
        gameState = 'ERROR';
    } finally {
        spinnerEl.style.display = 'none';
        updateUI();
    }
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
            actionHeaderEl.textContent = `Your turn, @${currentUser?.username || 'user'}!`;
            burnButton.disabled = isSubmitting;
            break;
        case 'OWNER_TURN':
            statusTextEl.textContent = "Owner's Turn to Match";
            statusTextEl.style.color = 'var(--owner-color)';
            if (isOwner) {
                actionHeaderEl.textContent = `Your turn, @${projectOwner.username}! Match the burn.`;
                burnButton.disabled = isSubmitting;
            } else {
                actionHeaderEl.textContent = `Waiting for @${projectOwner.username} to match the burn...`;
                burnButton.disabled = true;
            }
            break;
        case 'INITIALIZING':
            statusTextEl.textContent = 'Initializing...';
            burnButton.disabled = true;
            break;
        case 'ERROR':
            statusTextEl.textContent = 'Error';
            burnButton.disabled = true;
            break;
    }
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
        spinnerEl.style.display = 'none';
    }
}

function handleNewComment(data) {
    const newComment = data.comment;
    // We only care about new tip comments for game logic
    if (newComment.card_data?.type === 'tip_comment') {
        lastTip = newComment;
        if (newComment.author.id === projectOwner.id) {
            gameState = 'USER_TURN';
        } else {
            gameState = 'OWNER_TURN';
        }
        isSubmitting = false;
        prependComment(newComment);
        updateUI();
    }
}

// --- History Rendering ---
async function loadTipHistory() {
    try {
        const response = await fetch(`/api/v1/projects/${projectId}/comments?only_tips=true&first=100`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        
        commentsContainer.innerHTML = '';
        if (data.comments.data.length === 0) {
            commentsContainer.innerHTML = '<p>The burn history is empty.</p>';
            return;
        }

        data.comments.data.forEach(item => {
            const comment = item.comment;
            const commentEl = createCommentElement(comment);
            commentsContainer.appendChild(commentEl);
        });

    } catch (error) {
        console.error("Error loading history:", error);
        commentsContainer.innerHTML = '<p class="error-message">Could not load burn history.</p>';
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

// --- Start the App ---
init();