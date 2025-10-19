// Global variables
let sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
let userId = 'user_' + Math.random().toString(36).substr(2, 9);
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recognition = null;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    setupVoiceRecognition();
    displayWelcomeMessage();
});

function initializeApp() {
    // Update connection status
    updateConnectionStatus(true);
    
    // Setup character counter
    const messageInput = document.getElementById('messageInput');
    const charCount = document.getElementById('charCount');
    
    messageInput.addEventListener('input', function() {
        charCount.textContent = this.value.length;
        
        // Enable/disable send button based on input
        const sendButton = document.getElementById('sendButton');
        sendButton.disabled = this.value.trim().length === 0;
    });
}

function setupEventListeners() {
    // Enter key to send message
    document.getElementById('messageInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Voice button
    document.getElementById('voiceButton').addEventListener('click', openVoiceModal);
    
    // Voice modal controls
    document.getElementById('startRecording').addEventListener('click', startVoiceRecording);
    document.getElementById('stopRecording').addEventListener('click', stopVoiceRecording);
    document.getElementById('cancelRecording').addEventListener('click', cancelVoiceRecording);
    
    // Close modal on outside click
    document.getElementById('voiceModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeVoiceModal();
        }
    });
}

function setupVoiceRecognition() {
    // Check if browser supports speech recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        
        recognition.onstart = function() {
            console.log('Voice recognition started');
            updateVoiceStatus('Listening... Speak now');
        };
        
        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            console.log('Voice recognition result:', transcript);
            
            // Insert the transcript into the message input
            document.getElementById('messageInput').value = transcript;
            document.getElementById('charCount').textContent = transcript.length;
            
            closeVoiceModal();
            
            // Optionally auto-send the message
            if (transcript.trim().length > 0) {
                setTimeout(() => {
                    if (confirm('Send this message: "' + transcript + '"?')) {
                        sendMessage();
                    }
                }, 500);
            }
        };
        
        recognition.onerror = function(event) {
            console.error('Voice recognition error:', event.error);
            updateVoiceStatus('Error: ' + event.error);
            
            setTimeout(() => {
                closeVoiceModal();
            }, 2000);
        };
        
        recognition.onend = function() {
            console.log('Voice recognition ended');
            isRecording = false;
            updateVoiceControls();
        };
    } else {
        // Hide voice button if not supported
        document.getElementById('voiceButton').style.display = 'none';
        console.log('Speech recognition not supported');
    }
}

function displayWelcomeMessage() {
    addMessage(
        'Hello! I\'m your AI customer support assistant. How can I help you today?',
        'assistant',
        { confidence: 1.0 }
    );
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // Clear input and disable send button
    input.value = '';
    document.getElementById('charCount').textContent = '0';
    document.getElementById('sendButton').disabled = true;
    
    // Add user message to chat
    addMessage(message, 'user');
    
    // Show typing indicator
    showTypingIndicator();
    updateStatus('AI is thinking...', 'warning');
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message,
                sessionId,
                userId
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Hide typing indicator
        hideTypingIndicator();
        
        if (data.error) {
            addMessage('Sorry, there was an error: ' + data.error, 'assistant', { error: true });
            updateStatus('Error occurred', 'danger');
        } else {
            // Add AI response
            addMessage(data.message.content, 'assistant', {
                confidence: data.confidence,
                escalated: data.shouldEscalate,
                followUpSuggestions: data.followUpSuggestions
            });
            
            // Handle escalation
            if (data.shouldEscalate) {
                showEscalationNotice(data.escalationReason);
                updateStatus('Escalated to human agent', 'warning');
            } else {
                const confidencePercent = Math.round(data.confidence * 100);
                updateStatus(`Ready to help (Confidence: ${confidencePercent}%)`, 'success');
            }
            
            // Show follow-up suggestions
            if (data.followUpSuggestions && data.followUpSuggestions.length > 0) {
                setTimeout(() => {
                    showFollowUpSuggestions(data.followUpSuggestions);
                }, 1000);
            }
        }
        
    } catch (error) {
        console.error('Error sending message:', error);
        hideTypingIndicator();
        addMessage('Sorry, there was a connection error. Please try again.', 'assistant', { error: true });
        updateStatus('Connection error', 'danger');
        updateConnectionStatus(false);
        
        // Try to reconnect after a delay
        setTimeout(() => {
            updateConnectionStatus(true);
        }, 5000);
    }
}

function addMessage(content, role, metadata = {}) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    // Create avatar
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    avatarDiv.innerHTML = role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
    
    // Create content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    
    // Add timestamp
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    contentDiv.appendChild(timeDiv);
    
    // Add metadata for assistant messages
    if (role === 'assistant' && (metadata.confidence !== undefined || metadata.escalated)) {
        const metadataDiv = document.createElement('div');
        metadataDiv.className = 'message-metadata';
        
        let metadataText = '';
        if (metadata.confidence !== undefined) {
            metadataText += `Confidence: ${Math.round(metadata.confidence * 100)}%`;
        }
        if (metadata.escalated) {
            metadataText += (metadataText ? ' • ' : '') + 'Escalated to human';
        }
        if (metadata.error) {
            metadataText = 'Error occurred';
        }
        
        metadataDiv.textContent = metadataText;
        contentDiv.appendChild(metadataDiv);
    }
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    messagesDiv.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // Add escalation notice if needed
    if (metadata.escalated) {
        messageDiv.classList.add('escalated');
    }
}

function showFollowUpSuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) return;
    
    const messagesDiv = document.getElementById('messages');
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'follow-up-suggestions';
    suggestionsDiv.innerHTML = `
        <div class="suggestions-header">
            <i class="fas fa-lightbulb"></i>
            <span>Suggested questions:</span>
        </div>
        <div class="suggestions-list">
            ${suggestions.map(suggestion => 
                `<button class="suggestion-btn" onclick="sendSuggestion('${suggestion.replace(/'/g, "\\'")}')">${suggestion}</button>`
            ).join('')}
        </div>
    `;
    
    messagesDiv.appendChild(suggestionsDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendSuggestion(suggestion) {
    document.getElementById('messageInput').value = suggestion;
    document.getElementById('charCount').textContent = suggestion.length;
    sendMessage();
    
    // Remove suggestions after use
    const suggestions = document.querySelector('.follow-up-suggestions');
    if (suggestions) {
        suggestions.remove();
    }
}

function showTypingIndicator() {
    document.getElementById('typingIndicator').style.display = 'flex';
}

function hideTypingIndicator() {
    document.getElementById('typingIndicator').style.display = 'none';
}

function updateStatus(message, type = 'success') {
    const statusDiv = document.getElementById('status');
    const icon = statusDiv.querySelector('i');
    
    statusDiv.innerHTML = `<i class="fas fa-circle text-${type}"></i> ${message}`;
}

function updateConnectionStatus(isOnline) {
    const statusSpan = document.getElementById('connectionStatus');
    const statusDot = document.querySelector('.status-dot');
    
    if (isOnline) {
        statusSpan.textContent = 'Online';
        statusDot.className = 'status-dot online';
    } else {
        statusSpan.textContent = 'Offline';
        statusDot.className = 'status-dot offline';
    }
}

// Voice Modal Functions
function openVoiceModal() {
    if (!recognition) {
        alert('Voice input is not supported in your browser.');
        return;
    }
    
    document.getElementById('voiceModal').style.display = 'flex';
    updateVoiceStatus('Click "Start" to begin voice input');
    updateVoiceControls();
}

function closeVoiceModal() {
    document.getElementById('voiceModal').style.display = 'none';
    if (isRecording) {
        stopVoiceRecording();
    }
}

function startVoiceRecording() {
    if (!recognition) return;
    
    isRecording = true;
    updateVoiceControls();
    updateVoiceStatus('Listening... Speak clearly');
    
    try {
        recognition.start();
    } catch (error) {
        console.error('Error starting voice recognition:', error);
        updateVoiceStatus('Error starting voice recognition');
        isRecording = false;
        updateVoiceControls();
    }
}

function stopVoiceRecording() {
    if (recognition && isRecording) {
        recognition.stop();
    }
    isRecording = false;
    updateVoiceControls();
    updateVoiceStatus('Processing...');
}

function cancelVoiceRecording() {
    if (recognition && isRecording) {
        recognition.abort();
    }
    isRecording = false;
    closeVoiceModal();
}

function updateVoiceStatus(message) {
    document.getElementById('voiceStatus').textContent = message;
}

function updateVoiceControls() {
    const startBtn = document.getElementById('startRecording');
    const stopBtn = document.getElementById('stopRecording');
    const voiceBtn = document.getElementById('voiceButton');
    
    startBtn.disabled = isRecording;
    stopBtn.disabled = !isRecording;
    
    if (isRecording) {
        voiceBtn.classList.add('recording');
    } else {
        voiceBtn.classList.remove('recording');
    }
}

// Escalation Notice Functions
function showEscalationNotice(reason) {
    const notice = document.getElementById('escalationNotice');
    const reasonText = notice.querySelector('.notice-text p');
    
    if (reason) {
        reasonText.textContent = `Reason: ${reason}. A human agent will assist you shortly.`;
    }
    
    notice.style.display = 'block';
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
        closeEscalationNotice();
    }, 10000);
}

function closeEscalationNotice() {
    document.getElementById('escalationNotice').style.display = 'none';
}

// Utility Functions
function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function sanitizeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Error Handling
window.addEventListener('error', function(e) {
    console.error('Global error:', e.error);
    updateStatus('An error occurred', 'danger');
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
    updateStatus('Connection issue', 'warning');
});

// Add CSS for follow-up suggestions
const style = document.createElement('style');
style.textContent = `
.follow-up-suggestions {
    margin: 20px 0;
    padding: 15px;
    background: #f8f9fa;
    border-radius: 10px;
    border-left: 4px solid #007bff;
}

.suggestions-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 14px;
    font-weight: 500;
    color: #495057;
}

.suggestions-header i {
    color: #ffc107;
}

.suggestions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.suggestion-btn {
    background: white;
    border: 1px solid #dee2e6;
    border-radius: 20px;
    padding: 8px 16px;
    text-align: left;
    cursor: pointer;
    transition: all 0.3s ease;
    font-size: 14px;
    color: #495057;
}

.suggestion-btn:hover {
    background: #007bff;
    color: white;
    border-color: #007bff;
    transform: translateX(5px);
}

@media (max-width: 768px) {
    .suggestions-list {
        gap: 6px;
    }
    
    .suggestion-btn {
        padding: 10px 14px;
        font-size: 13px;
    }
}
`;
document.head.appendChild(style);