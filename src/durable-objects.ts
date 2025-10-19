import { Env, SupportSession, Message, EscalationRequest } from './types';

export class SupportSessionDO {
  private state: any; // DurableObjectState
  private env: Env;
  private session: SupportSession | null = null;

  constructor(state: any, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (request.method) {
        case 'GET':
          if (path === '/session') {
            return this.getSession();
          }
          break;
        
        case 'POST':
          if (path === '/session') {
            return this.createSession(request);
          } else if (path === '/message') {
            return this.addMessage(request);
          } else if (path === '/escalate') {
            return this.escalateSession(request);
          }
          break;
        
        case 'PUT':
          if (path === '/session') {
            return this.updateSession(request);
          }
          break;
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('SupportSessionDO error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async getSession(): Promise<Response> {
    if (!this.session) {
      this.session = await this.state.storage.get('session') || null;
    }

    return new Response(JSON.stringify(this.session), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async createSession(request: Request): Promise<Response> {
    const data = await request.json() as {
      userId: string;
      metadata?: any;
    };

    this.session = {
      id: this.state.id.toString(),
      userId: data.userId,
      messages: [],
      status: 'active',
      escalationCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: data.metadata || {}
    };

    await this.state.storage.put('session', this.session);

    return new Response(JSON.stringify(this.session), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async addMessage(request: Request): Promise<Response> {
    const message = await request.json() as Message;

    if (!this.session) {
      this.session = await this.state.storage.get('session');
      if (!this.session) {
        return new Response('Session not found', { status: 404 });
      }
    }

    this.session.messages.push(message);
    this.session.updatedAt = Date.now();

    // Keep only last 50 messages to prevent unlimited growth
    const maxMessages = parseInt(this.env.MAX_CONVERSATION_LENGTH) || 50;
    if (this.session.messages.length > maxMessages) {
      this.session.messages = this.session.messages.slice(-maxMessages);
    }

    await this.state.storage.put('session', this.session);

    return new Response(JSON.stringify(this.session), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async escalateSession(request: Request): Promise<Response> {
    const data = await request.json() as {
      reason: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
    };

    if (!this.session) {
      this.session = await this.state.storage.get('session');
      if (!this.session) {
        return new Response('Session not found', { status: 404 });
      }
    }

    this.session.status = 'escalated';
    this.session.escalationCount += 1;
    this.session.updatedAt = Date.now();

    await this.state.storage.put('session', this.session);

    // Create escalation request
    const escalationRequest: EscalationRequest = {
      sessionId: this.session.id,
      reason: data.reason,
      priority: data.priority,
      summary: this.generateSessionSummary(),
      timestamp: Date.now(),
      customerInfo: {
        userId: this.session.userId,
        tier: this.session.metadata.customerTier || 'free',
        previousEscalations: this.session.escalationCount
      }
    };

    // Send to escalation queue
    const escalationQueueId = this.env.ESCALATION_QUEUE.idFromName('main');
    const escalationQueue = this.env.ESCALATION_QUEUE.get(escalationQueueId);
    
    await escalationQueue.fetch(new Request('https://dummy/escalation', {
      method: 'POST',
      body: JSON.stringify(escalationRequest),
      headers: { 'Content-Type': 'application/json' }
    }));

    return new Response(JSON.stringify({
      session: this.session,
      escalationRequest
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async updateSession(request: Request): Promise<Response> {
    const updates = await request.json();

    if (!this.session) {
      this.session = await this.state.storage.get('session');
      if (!this.session) {
        return new Response('Session not found', { status: 404 });
      }
    }

    this.session = { ...this.session, ...updates, updatedAt: Date.now() };
    await this.state.storage.put('session', this.session);

    return new Response(JSON.stringify(this.session), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private generateSessionSummary(): string {
    if (!this.session || this.session.messages.length === 0) {
      return 'No messages in session';
    }

    const userMessages = this.session.messages
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content)
      .join(' | ');

    return `Recent user messages: ${userMessages}`;
  }
}

export class EscalationQueueDO {
  private state: any; // DurableObjectState
  private env: Env;
  private queue: EscalationRequest[] = [];

  constructor(state: any, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (request.method) {
        case 'GET':
          if (path === '/queue') {
            return this.getQueue();
          } else if (path === '/next') {
            return this.getNextEscalation();
          }
          break;
        
        case 'POST':
          if (path === '/escalation') {
            return this.addEscalation(request);
          }
          break;
        
        case 'DELETE':
          if (path.startsWith('/escalation/')) {
            const sessionId = path.split('/')[2];
            if (sessionId) {
              return this.removeEscalation(sessionId);
            }
          }
          break;
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('EscalationQueueDO error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async getQueue(): Promise<Response> {
    this.queue = await this.state.storage.get('queue') || [];
    
    // Sort by priority and timestamp
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    this.queue.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });

    return new Response(JSON.stringify(this.queue), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async getNextEscalation(): Promise<Response> {
    this.queue = await this.state.storage.get('queue') || [];
    
    if (this.queue.length === 0) {
      return new Response(JSON.stringify(null), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Sort and get highest priority item
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    this.queue.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });

    const nextEscalation = this.queue.shift();
    await this.state.storage.put('queue', this.queue);

    return new Response(JSON.stringify(nextEscalation), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async addEscalation(request: Request): Promise<Response> {
    const escalation = await request.json() as EscalationRequest;
    
    this.queue = await this.state.storage.get('queue') || [];
    this.queue.push(escalation);
    
    await this.state.storage.put('queue', this.queue);

    // Notify human agents (in a real implementation, this could trigger webhooks, emails, etc.)
    await this.notifyHumanAgents(escalation);

    return new Response(JSON.stringify({ success: true, queueLength: this.queue.length }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async removeEscalation(sessionId: string): Promise<Response> {
    this.queue = await this.state.storage.get('queue') || [];
    const initialLength = this.queue.length;
    
    this.queue = this.queue.filter(e => e.sessionId !== sessionId);
    
    if (this.queue.length < initialLength) {
      await this.state.storage.put('queue', this.queue);
      return new Response(JSON.stringify({ success: true, removed: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, removed: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async notifyHumanAgents(escalation: EscalationRequest): Promise<void> {
    // In a real implementation, this would:
    // - Send webhook to agent dashboard
    // - Send email/SMS notifications
    // - Update external ticketing system
    // - Log to monitoring system
    
    console.log(`New escalation: ${escalation.sessionId} - ${escalation.priority} priority`);
    
    // Store notification in KV for agent dashboard to poll
    const notificationKey = `notification_${Date.now()}_${escalation.sessionId}`;
    await this.env.SUPPORT_KV.put(notificationKey, JSON.stringify({
      type: 'escalation',
      escalation,
      timestamp: Date.now()
    }), { expirationTtl: 86400 }); // Expire after 24 hours
  }
}