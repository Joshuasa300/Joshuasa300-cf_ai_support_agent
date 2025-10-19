import { Env, Message, SupportSession } from './types';
import { SupportAgent } from './agent';
import { SupportSessionDO, EscalationQueueDO } from './durable-objects';
import { createSupportWorkflow } from './workflows';

// Export Durable Object classes
export { SupportSessionDO as SupportSession, EscalationQueueDO as EscalationQueue };

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Enable CORS for frontend
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint
      if (path === '/health') {
        return new Response(JSON.stringify({ 
          status: 'healthy', 
          timestamp: Date.now(),
          environment: env.ENVIRONMENT 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Chat endpoint - main interaction point
      if (path === '/api/chat' && request.method === 'POST') {
        return handleChatRequest(request, env, corsHeaders);
      }

      // Session management endpoints
      if (path.startsWith('/api/session')) {
        return handleSessionRequest(request, env, corsHeaders);
      }

      // Escalation management endpoints
      if (path.startsWith('/api/escalation')) {
        return handleEscalationRequest(request, env, corsHeaders);
      }

      // Knowledge base endpoints
      if (path.startsWith('/api/knowledge')) {
        return handleKnowledgeRequest(request, env, corsHeaders);
      }

      // Serve static frontend files
      if (path === '/' || path === '/index.html') {
        return new Response(await getFrontendHTML(), {
          headers: { ...corsHeaders, 'Content-Type': 'text/html' }
        });
      }

      if (path === '/style.css') {
        return new Response(await getFrontendCSS(), {
          headers: { ...corsHeaders, 'Content-Type': 'text/css' }
        });
      }

      if (path === '/script.js') {
        return new Response(await getFrontendJS(), {
          headers: { ...corsHeaders, 'Content-Type': 'application/javascript' }
        });
      }

      return new Response('Not Found', { 
        status: 404, 
        headers: corsHeaders 
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

async function handleChatRequest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const { message, sessionId, userId } = await request.json();

  if (!message || !sessionId || !userId) {
    return new Response(JSON.stringify({ 
      error: 'Missing required fields: message, sessionId, userId' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Get or create session
  const sessionObjectId = env.SUPPORT_SESSION.idFromString(sessionId);
  const sessionObject = env.SUPPORT_SESSION.get(sessionObjectId);

  // Get existing session or create new one
  let sessionResponse = await sessionObject.fetch(new Request('https://dummy/session'));
  let session: SupportSession;

  if (sessionResponse.status === 200) {
    const sessionData = await sessionResponse.json();
    session = sessionData || null;
  } else {
    session = null as any;
  }

  if (!session) {
    // Create new session
    const createResponse = await sessionObject.fetch(new Request('https://dummy/session', {
      method: 'POST',
      body: JSON.stringify({ userId }),
      headers: { 'Content-Type': 'application/json' }
    }));
    session = await createResponse.json();
  }

  // Create user message
  const userMessage: Message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role: 'user',
    content: message,
    timestamp: Date.now()
  };

  // Add user message to session
  await sessionObject.fetch(new Request('https://dummy/message', {
    method: 'POST',
    body: JSON.stringify(userMessage),
    headers: { 'Content-Type': 'application/json' }
  }));

  // Use workflow system for processing
  const workflow = createSupportWorkflow(env);
  
  const workflowResult = await workflow.executeWorkflow(sessionId, {
    message,
    userId,
    conversationHistory: session.messages,
    customerTier: 'free' // Could be determined from user data
  });

  if (!workflowResult.success) {
    return new Response(JSON.stringify({
      error: 'Failed to process message',
      details: workflowResult.error
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Create assistant message from workflow result
  const assistantMessage: Message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role: 'assistant',
    content: workflowResult.data?.finalResponse || 'I apologize, but I could not process your request.',
    timestamp: Date.now(),
    metadata: {
      confidence: workflowResult.data?.confidence || 0,
      escalated: workflowResult.data?.escalated || false
    }
  };

  // Add assistant message to session
  await sessionObject.fetch(new Request('https://dummy/message', {
    method: 'POST',
    body: JSON.stringify(assistantMessage),
    headers: { 'Content-Type': 'application/json' }
  }));

  return new Response(JSON.stringify({
    message: assistantMessage,
    shouldEscalate: workflowResult.data?.escalated || false,
    escalationReason: workflowResult.data?.escalationReason,
    followUpSuggestions: workflowResult.data?.followUpSuggestions || [],
    confidence: workflowResult.data?.confidence || 0,
    workflowData: workflowResult.data
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleSessionRequest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'sessionId required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const sessionObjectId = env.SUPPORT_SESSION.idFromString(sessionId);
  const sessionObject = env.SUPPORT_SESSION.get(sessionObjectId);

  // Forward request to Durable Object
  const response = await sessionObject.fetch(request);
  const data = await response.json();

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleEscalationRequest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const escalationQueueId = env.ESCALATION_QUEUE.idFromName('main');
  const escalationQueue = env.ESCALATION_QUEUE.get(escalationQueueId);

  // Forward request to Durable Object
  const response = await escalationQueue.fetch(request);
  const data = await response.json();

  return new Response(JSON.stringify(data), {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

async function handleKnowledgeRequest(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/knowledge' && request.method === 'GET') {
    // List knowledge base entries
    const keys = await env.SUPPORT_KV.list({ prefix: 'kb_' });
    const entries = await Promise.all(
      keys.keys.map(async (key: any) => {
        const data = await env.SUPPORT_KV.get(key.name);
        return data ? JSON.parse(data) : null;
      })
    );

    return new Response(JSON.stringify(entries.filter(Boolean)), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (path === '/api/knowledge' && request.method === 'POST') {
    // Add knowledge base entry
    const entry = await request.json();
    await env.SUPPORT_KV.put(`kb_${entry.id}`, JSON.stringify(entry));

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response('Not Found', { 
    status: 404, 
    headers: corsHeaders 
  });
}

async function getFrontendHTML(): Promise<string> {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Customer Support</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .chat-container { background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); height: 600px; display: flex; flex-direction: column; }
        .chat-header { padding: 20px; border-bottom: 1px solid #eee; background: #007bff; color: white; border-radius: 10px 10px 0 0; }
        .chat-messages { flex: 1; padding: 20px; overflow-y: auto; }
        .message { margin-bottom: 15px; }
        .message.user { text-align: right; }
        .message.assistant { text-align: left; }
        .message-content { display: inline-block; padding: 10px 15px; border-radius: 18px; max-width: 70%; }
        .message.user .message-content { background: #007bff; color: white; }
        .message.assistant .message-content { background: #f1f1f1; color: #333; }
        .chat-input { display: flex; padding: 20px; border-top: 1px solid #eee; }
        .chat-input input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 20px; outline: none; }
        .chat-input button { margin-left: 10px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 20px; cursor: pointer; }
        .chat-input button:hover { background: #0056b3; }
        .status { padding: 10px; text-align: center; font-size: 12px; color: #666; }
        .escalated { background: #fff3cd; color: #856404; padding: 10px; margin: 10px 0; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="chat-container">
            <div class="chat-header">
                <h2>AI Customer Support</h2>
                <p>How can I help you today?</p>
            </div>
            <div class="chat-messages" id="messages"></div>
            <div class="status" id="status">Ready to help</div>
            <div class="chat-input">
                <input type="text" id="messageInput" placeholder="Type your message..." />
                <button onclick="sendMessage()">Send</button>
            </div>
        </div>
    </div>

    <script>
        const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const userId = 'user_' + Math.random().toString(36).substr(2, 9);
        
        function addMessage(content, role, metadata = {}) {
            const messagesDiv = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + role;
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;
            
            messageDiv.appendChild(contentDiv);
            
            if (metadata.escalated) {
                const escalatedDiv = document.createElement('div');
                escalatedDiv.className = 'escalated';
                escalatedDiv.textContent = '⚠️ This conversation has been escalated to a human agent';
                messageDiv.appendChild(escalatedDiv);
            }
            
            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        
        async function sendMessage() {
            const input = document.getElementById('messageInput');
            const message = input.value.trim();
            if (!message) return;
            
            input.value = '';
            addMessage(message, 'user');
            
            document.getElementById('status').textContent = 'AI is thinking...';
            
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, sessionId, userId })
                });
                
                const data = await response.json();
                
                if (data.error) {
                    addMessage('Sorry, there was an error: ' + data.error, 'assistant');
                } else {
                    addMessage(data.message.content, 'assistant', data.message.metadata);
                    
                    if (data.shouldEscalate) {
                        document.getElementById('status').textContent = 'Escalated to human agent';
                    } else {
                        document.getElementById('status').textContent = 'Ready to help (Confidence: ' + Math.round(data.confidence * 100) + '%)';
                    }
                }
            } catch (error) {
                addMessage('Sorry, there was a connection error. Please try again.', 'assistant');
                document.getElementById('status').textContent = 'Connection error';
            }
        }
        
        document.getElementById('messageInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
        
        // Initial greeting
        addMessage('Hello! I\\'m your AI customer support assistant. How can I help you today?', 'assistant');
    </script>
</body>
</html>
  `;
}

async function getFrontendCSS(): Promise<string> {
  // In a real deployment, you would read this from a file or bundle
  // For now, return a basic CSS that works with the embedded HTML
  return `
/* Basic styles for embedded frontend */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
.container { max-width: 800px; margin: 0 auto; padding: 20px; }
.chat-container { background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); height: 600px; display: flex; flex-direction: column; }
.chat-header { padding: 20px; border-bottom: 1px solid #eee; background: #007bff; color: white; border-radius: 10px 10px 0 0; }
.chat-messages { flex: 1; padding: 20px; overflow-y: auto; }
.message { margin-bottom: 15px; }
.message.user { text-align: right; }
.message.assistant { text-align: left; }
.message-content { display: inline-block; padding: 10px 15px; border-radius: 18px; max-width: 70%; }
.message.user .message-content { background: #007bff; color: white; }
.message.assistant .message-content { background: #f1f1f1; color: #333; }
.chat-input { display: flex; padding: 20px; border-top: 1px solid #eee; }
.chat-input input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 20px; outline: none; }
.chat-input button { margin-left: 10px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 20px; cursor: pointer; }
.chat-input button:hover { background: #0056b3; }
.status { padding: 10px; text-align: center; font-size: 12px; color: #666; }
.escalated { background: #fff3cd; color: #856404; padding: 10px; margin: 10px 0; border-radius: 5px; }
  `;
}

async function getFrontendJS(): Promise<string> {
  // In a real deployment, you would read this from a file or bundle
  // For now, return the basic JavaScript functionality
  return `
const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
const userId = 'user_' + Math.random().toString(36).substr(2, 9);

function addMessage(content, role, metadata = {}) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + role;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    
    messageDiv.appendChild(contentDiv);
    
    if (metadata.escalated) {
        const escalatedDiv = document.createElement('div');
        escalatedDiv.className = 'escalated';
        escalatedDiv.textContent = '⚠️ This conversation has been escalated to a human agent';
        messageDiv.appendChild(escalatedDiv);
    }
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;
    
    input.value = '';
    addMessage(message, 'user');
    
    document.getElementById('status').textContent = 'AI is thinking...';
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, sessionId, userId })
        });
        
        const data = await response.json();
        
        if (data.error) {
            addMessage('Sorry, there was an error: ' + data.error, 'assistant');
        } else {
            addMessage(data.message.content, 'assistant', data.message.metadata);
            
            if (data.shouldEscalate) {
                document.getElementById('status').textContent = 'Escalated to human agent';
            } else {
                document.getElementById('status').textContent = 'Ready to help (Confidence: ' + Math.round(data.confidence * 100) + '%)';
            }
        }
    } catch (error) {
        addMessage('Sorry, there was a connection error. Please try again.', 'assistant');
        document.getElementById('status').textContent = 'Connection error';
    }
}

document.getElementById('messageInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Initial greeting
addMessage('Hello! I\\'m your AI customer support assistant. How can I help you today?', 'assistant');
  `;
}