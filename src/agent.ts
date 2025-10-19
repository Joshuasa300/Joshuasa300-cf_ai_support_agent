import { Env, Message, AIResponse, KnowledgeBaseEntry } from './types';

export class SupportAgent {
  private env: Env;
  private knowledgeBase: KnowledgeBaseEntry[] = [
    {
      id: '1',
      title: 'Account Login Issues',
      content: 'If you cannot log in, try resetting your password or clearing browser cache.',
      tags: ['login', 'password', 'account'],
      category: 'authentication',
      lastUpdated: Date.now()
    },
    {
      id: '2',
      title: 'Billing Questions',
      content: 'For billing inquiries, check your account dashboard or contact our billing team.',
      tags: ['billing', 'payment', 'invoice'],
      category: 'billing',
      lastUpdated: Date.now()
    },
    {
      id: '3',
      title: 'Technical Support',
      content: 'For technical issues, please provide error messages and steps to reproduce.',
      tags: ['technical', 'error', 'bug'],
      category: 'technical',
      lastUpdated: Date.now()
    }
  ];

  constructor(env: Env) {
    this.env = env;
  }

  async processMessage(message: string, conversationHistory: Message[]): Promise<AIResponse> {
    try {
      // Search knowledge base for relevant information
      const relevantKnowledge = this.searchKnowledgeBase(message);
      
      // Build context for AI
      const context = this.buildContext(message, conversationHistory, relevantKnowledge);
      
      // Call Llama 3.3 model
      const aiResponse = await this.callLLM(context);
      
      // Analyze response for escalation needs
      const shouldEscalate = this.shouldEscalate(message, aiResponse, conversationHistory);
      
      return {
        content: aiResponse,
        confidence: this.calculateConfidence(aiResponse, relevantKnowledge),
        shouldEscalate,
        escalationReason: shouldEscalate ? this.getEscalationReason(message, conversationHistory) : undefined,
        suggestedActions: this.getSuggestedActions(message, aiResponse)
      };
    } catch (error) {
      // Log error (console available in Workers runtime)
      console.error('Error processing message:', error);
      return {
        content: 'I apologize, but I encountered an error. Let me connect you with a human agent.',
        confidence: 0,
        shouldEscalate: true,
        escalationReason: 'System error occurred'
      };
    }
  }

  private async callLLM(context: string): Promise<string> {
    const response = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
      messages: [
        {
          role: 'system',
          content: `You are a helpful customer support agent. You should:
          - Be polite and professional
          - Provide accurate information based on the knowledge base
          - Ask clarifying questions when needed
          - Suggest escalation to human agents for complex issues
          - Keep responses concise but helpful`
        },
        {
          role: 'user',
          content: context
        }
      ],
      max_tokens: 512,
      temperature: 0.3
    });

    return response.response || 'I apologize, but I could not generate a response. Please try again.';
  }

  private buildContext(message: string, history: Message[], knowledge: KnowledgeBaseEntry[]): string {
    let context = `Customer message: ${message}\n\n`;
    
    if (history.length > 0) {
      context += 'Conversation history:\n';
      history.slice(-5).forEach(msg => {
        context += `${msg.role}: ${msg.content}\n`;
      });
      context += '\n';
    }

    if (knowledge.length > 0) {
      context += 'Relevant knowledge base entries:\n';
      knowledge.forEach(entry => {
        context += `- ${entry.title}: ${entry.content}\n`;
      });
    }

    return context;
  }

  private searchKnowledgeBase(query: string): KnowledgeBaseEntry[] {
    const queryLower = query.toLowerCase();
    return this.knowledgeBase
      .filter(entry => 
        entry.tags.some(tag => queryLower.includes(tag)) ||
        entry.content.toLowerCase().includes(queryLower) ||
        entry.title.toLowerCase().includes(queryLower)
      )
      .slice(0, 3); // Limit to top 3 relevant entries
  }

  private shouldEscalate(message: string, response: string, history: Message[]): boolean {
    const escalationKeywords = [
      'angry', 'frustrated', 'complaint', 'refund', 'cancel', 'legal',
      'lawsuit', 'terrible', 'awful', 'worst', 'hate', 'furious'
    ];
    
    const messageLower = message.toLowerCase();
    const hasEscalationKeywords = escalationKeywords.some(keyword => 
      messageLower.includes(keyword)
    );

    // Escalate if user seems frustrated
    if (hasEscalationKeywords) return true;

    // Escalate if conversation is getting long without resolution
    if (history.length > parseInt(this.env.ESCALATION_THRESHOLD) * 2) return true;

    // Escalate if AI response contains uncertainty indicators
    const uncertaintyIndicators = ['not sure', 'might be', 'possibly', 'i think'];
    const responseHasUncertainty = uncertaintyIndicators.some(indicator =>
      response.toLowerCase().includes(indicator)
    );

    return responseHasUncertainty;
  }

  private getEscalationReason(message: string, history: Message[]): string {
    if (message.toLowerCase().includes('angry') || message.toLowerCase().includes('frustrated')) {
      return 'Customer expressing frustration';
    }
    if (history.length > parseInt(this.env.ESCALATION_THRESHOLD) * 2) {
      return 'Extended conversation without resolution';
    }
    return 'Complex issue requiring human assistance';
  }

  private calculateConfidence(response: string, knowledge: KnowledgeBaseEntry[]): number {
    // Simple confidence calculation based on knowledge base matches
    if (knowledge.length === 0) return 0.3;
    if (knowledge.length === 1) return 0.6;
    if (knowledge.length >= 2) return 0.8;
    return 0.5;
  }

  private getSuggestedActions(message: string, response: string): string[] {
    const actions: string[] = [];
    
    if (message.toLowerCase().includes('password')) {
      actions.push('Send password reset link');
    }
    if (message.toLowerCase().includes('billing')) {
      actions.push('Review billing history');
    }
    if (message.toLowerCase().includes('technical')) {
      actions.push('Create technical support ticket');
    }
    
    return actions;
  }

  async updateKnowledgeBase(entry: KnowledgeBaseEntry): Promise<void> {
    // Store in KV for persistence
    await this.env.SUPPORT_KV.put(`kb_${entry.id}`, JSON.stringify(entry));
    
    // Update local cache
    const existingIndex = this.knowledgeBase.findIndex(e => e.id === entry.id);
    if (existingIndex >= 0) {
      this.knowledgeBase[existingIndex] = entry;
    } else {
      this.knowledgeBase.push(entry);
    }
  }

  async loadKnowledgeBase(): Promise<void> {
    try {
      const keys = await this.env.SUPPORT_KV.list({ prefix: 'kb_' });
      const entries = await Promise.all(
        keys.keys.map(async (key: any) => {
          const data = await this.env.SUPPORT_KV.get(key.name);
          return data ? JSON.parse(data) : null;
        })
      );
      
      this.knowledgeBase = entries.filter(Boolean);
    } catch (error) {
      // Log error (console available in Workers runtime)
      console.error('Error loading knowledge base:', error);
    }
  }
}