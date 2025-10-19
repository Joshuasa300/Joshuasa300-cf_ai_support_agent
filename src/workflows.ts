import { Env, SupportSession, EscalationRequest, WorkflowContext } from './types';

export interface WorkflowStep {
  name: string;
  execute(context: WorkflowContext, env: Env): Promise<WorkflowResult>;
}

export interface WorkflowResult {
  success: boolean;
  nextStep?: string;
  data?: Record<string, any>;
  error?: string;
  shouldRetry?: boolean;
}

export class SupportWorkflow {
  private steps: Map<string, WorkflowStep> = new Map();
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.initializeSteps();
  }

  private initializeSteps() {
    // Register workflow steps
    this.steps.set('initial_assessment', new InitialAssessmentStep());
    this.steps.set('knowledge_search', new KnowledgeSearchStep());
    this.steps.set('ai_response', new AIResponseStep());
    this.steps.set('escalation_check', new EscalationCheckStep());
    this.steps.set('human_handoff', new HumanHandoffStep());
    this.steps.set('follow_up', new FollowUpStep());
    this.steps.set('resolution', new ResolutionStep());
  }

  async executeWorkflow(sessionId: string, initialData: Record<string, any>): Promise<WorkflowResult> {
    const context: WorkflowContext = {
      sessionId,
      currentStep: 'initial_assessment',
      data: initialData,
      retryCount: 0
    };

    let maxSteps = 10; // Prevent infinite loops
    let stepCount = 0;

    while (context.currentStep && stepCount < maxSteps) {
      stepCount++;
      
      const step = this.steps.get(context.currentStep);
      if (!step) {
        return {
          success: false,
          error: `Unknown step: ${context.currentStep}`
        };
      }

      try {
        const result = await step.execute(context, this.env);
        
        if (!result.success) {
          if (result.shouldRetry && context.retryCount < 3) {
            context.retryCount++;
            continue; // Retry the same step
          }
          return result; // Return error
        }

        // Update context with result data
        if (result.data) {
          context.data = { ...context.data, ...result.data };
        }

        // Move to next step
        if (result.nextStep) {
          context.currentStep = result.nextStep;
          context.retryCount = 0; // Reset retry count for new step
        } else {
          // Workflow completed
          return {
            success: true,
            data: context.data
          };
        }

      } catch (error) {
        console.error(`Workflow step error: ${context.currentStep}`, error);
        
        if (context.retryCount < 3) {
          context.retryCount++;
          continue; // Retry
        }

        return {
          success: false,
          error: `Step failed: ${context.currentStep}`,
          data: context.data
        };
      }
    }

    return {
      success: false,
      error: 'Workflow exceeded maximum steps',
      data: context.data
    };
  }
}

// Workflow Steps Implementation

class InitialAssessmentStep implements WorkflowStep {
  name = 'initial_assessment';

  async execute(context: WorkflowContext, env: Env): Promise<WorkflowResult> {
    const { message, userId } = context.data;

    // Analyze message for urgency and category
    const urgencyKeywords = ['urgent', 'emergency', 'critical', 'asap', 'immediately'];
    const billingKeywords = ['billing', 'payment', 'invoice', 'charge', 'refund'];
    const technicalKeywords = ['error', 'bug', 'broken', 'not working', 'crash'];

    const messageLower = message.toLowerCase();
    
    let category = 'general';
    let priority = 'medium';

    if (urgencyKeywords.some(keyword => messageLower.includes(keyword))) {
      priority = 'high';
    }

    if (billingKeywords.some(keyword => messageLower.includes(keyword))) {
      category = 'billing';
    } else if (technicalKeywords.some(keyword => messageLower.includes(keyword))) {
      category = 'technical';
    }

    return {
      success: true,
      nextStep: 'knowledge_search',
      data: {
        category,
        priority,
        assessmentComplete: true
      }
    };
  }
}

class KnowledgeSearchStep implements WorkflowStep {
  name = 'knowledge_search';

  async execute(context: WorkflowContext, env: Env): Promise<WorkflowResult> {
    const { message, category } = context.data;

    try {
      // Search knowledge base
      const keys = await env.SUPPORT_KV.list({ prefix: 'kb_' });
      const entries = await Promise.all(
        keys.keys.map(async (key: any) => {
          const data = await env.SUPPORT_KV.get(key.name);
          return data ? JSON.parse(data) : null;
        })
      );

      const knowledgeBase = entries.filter(Boolean);
      
      // Find relevant entries
      const messageLower = message.toLowerCase();
      const relevantEntries = knowledgeBase.filter(entry => 
        entry.category === category ||
        entry.tags.some((tag: string) => messageLower.includes(tag)) ||
        entry.content.toLowerCase().includes(messageLower) ||
        entry.title.toLowerCase().includes(messageLower)
      ).slice(0, 3);

      return {
        success: true,
        nextStep: 'ai_response',
        data: {
          relevantKnowledge: relevantEntries,
          knowledgeFound: relevantEntries.length > 0
        }
      };

    } catch (error) {
      console.error('Knowledge search error:', error);
      return {
        success: true, // Continue workflow even if knowledge search fails
        nextStep: 'ai_response',
        data: {
          relevantKnowledge: [],
          knowledgeFound: false
        }
      };
    }
  }
}

class AIResponseStep implements WorkflowStep {
  name = 'ai_response';

  async execute(context: WorkflowContext, env: Env): Promise<WorkflowResult> {
    const { message, relevantKnowledge, conversationHistory } = context.data;

    try {
      // Build context for AI
      let aiContext = `Customer message: ${message}\n\n`;
      
      if (conversationHistory && conversationHistory.length > 0) {
        aiContext += 'Conversation history:\n';
        conversationHistory.slice(-5).forEach((msg: any) => {
          aiContext += `${msg.role}: ${msg.content}\n`;
        });
        aiContext += '\n';
      }

      if (relevantKnowledge && relevantKnowledge.length > 0) {
        aiContext += 'Relevant knowledge base entries:\n';
        relevantKnowledge.forEach((entry: any) => {
          aiContext += `- ${entry.title}: ${entry.content}\n`;
        });
      }

      // Call AI model
      const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
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
            content: aiContext
          }
        ],
        max_tokens: 512,
        temperature: 0.3
      });

      const aiResponse = response.response || 'I apologize, but I could not generate a response. Please try again.';

      // Calculate confidence based on knowledge matches
      let confidence = 0.5;
      if (relevantKnowledge && relevantKnowledge.length > 0) {
        confidence = Math.min(0.9, 0.4 + (relevantKnowledge.length * 0.2));
      }

      return {
        success: true,
        nextStep: 'escalation_check',
        data: {
          aiResponse,
          confidence,
          responseGenerated: true
        }
      };

    } catch (error) {
      console.error('AI response error:', error);
      return {
        success: false,
        error: 'Failed to generate AI response',
        shouldRetry: true
      };
    }
  }
}

class EscalationCheckStep implements WorkflowStep {
  name = 'escalation_check';

  async execute(context: WorkflowContext, env: Env): Promise<WorkflowResult> {
    const { message, confidence, conversationHistory, priority } = context.data;

    // Escalation logic
    const escalationKeywords = [
      'angry', 'frustrated', 'complaint', 'refund', 'cancel', 'legal',
      'lawsuit', 'terrible', 'awful', 'worst', 'hate', 'furious'
    ];
    
    const messageLower = message.toLowerCase();
    const hasEscalationKeywords = escalationKeywords.some(keyword => 
      messageLower.includes(keyword)
    );

    let shouldEscalate = false;
    let escalationReason = '';

    // Check escalation conditions
    if (hasEscalationKeywords) {
      shouldEscalate = true;
      escalationReason = 'Customer expressing frustration';
    } else if (confidence < 0.4) {
      shouldEscalate = true;
      escalationReason = 'Low confidence in AI response';
    } else if (conversationHistory && conversationHistory.length > 6) {
      shouldEscalate = true;
      escalationReason = 'Extended conversation without resolution';
    } else if (priority === 'high') {
      shouldEscalate = true;
      escalationReason = 'High priority issue';
    }

    if (shouldEscalate) {
      return {
        success: true,
        nextStep: 'human_handoff',
        data: {
          shouldEscalate: true,
          escalationReason
        }
      };
    } else {
      return {
        success: true,
        nextStep: 'follow_up',
        data: {
          shouldEscalate: false
        }
      };
    }
  }
}

class HumanHandoffStep implements WorkflowStep {
  name = 'human_handoff';

  async execute(context: WorkflowContext, env: Env): Promise<WorkflowResult> {
    const { sessionId, escalationReason, priority, category } = context.data;

    try {
      // Create escalation request
      const escalationRequest: EscalationRequest = {
        sessionId,
        reason: escalationReason,
        priority: priority || 'medium',
        summary: this.generateSummary(context.data),
        timestamp: Date.now(),
        customerInfo: {
          userId: context.data.userId,
          tier: context.data.customerTier || 'free',
          previousEscalations: 0
        }
      };

      // Add to escalation queue
      const escalationQueueId = env.ESCALATION_QUEUE.idFromName('main');
      const escalationQueue = env.ESCALATION_QUEUE.get(escalationQueueId);
      
      await escalationQueue.fetch(new Request('https://dummy/escalation', {
        method: 'POST',
        body: JSON.stringify(escalationRequest),
        headers: { 'Content-Type': 'application/json' }
      }));

      return {
        success: true,
        nextStep: 'resolution',
        data: {
          escalated: true,
          escalationRequest
        }
      };

    } catch (error) {
      console.error('Human handoff error:', error);
      return {
        success: false,
        error: 'Failed to escalate to human agent',
        shouldRetry: true
      };
    }
  }

  private generateSummary(data: Record<string, any>): string {
    const { message, category, priority } = data;
    return `${priority} priority ${category} issue: ${message.substring(0, 100)}...`;
  }
}

class FollowUpStep implements WorkflowStep {
  name = 'follow_up';

  async execute(context: WorkflowContext, env: Env): Promise<WorkflowResult> {
    const { aiResponse, confidence } = context.data;

    // Generate follow-up suggestions based on response
    const suggestions = [];
    
    if (confidence < 0.7) {
      suggestions.push('Would you like me to connect you with a human agent for more detailed assistance?');
    }
    
    suggestions.push('Is there anything else I can help you with?');
    suggestions.push('Was this information helpful?');

    return {
      success: true,
      nextStep: 'resolution',
      data: {
        followUpSuggestions: suggestions
      }
    };
  }
}

class ResolutionStep implements WorkflowStep {
  name = 'resolution';

  async execute(context: WorkflowContext, env: Env): Promise<WorkflowResult> {
    // Final step - prepare response for user
    const { aiResponse, escalated, escalationReason, followUpSuggestions, confidence } = context.data;

    let finalResponse = aiResponse;
    
    if (escalated) {
      finalResponse += '\n\nI\'ve escalated your request to a human agent who will assist you shortly.';
    }

    return {
      success: true,
      data: {
        finalResponse,
        escalated: escalated || false,
        escalationReason,
        followUpSuggestions,
        confidence,
        workflowComplete: true
      }
    };
  }
}

// Workflow factory function
export function createSupportWorkflow(env: Env): SupportWorkflow {
  return new SupportWorkflow(env);
}