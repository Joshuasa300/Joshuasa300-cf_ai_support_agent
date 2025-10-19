export interface Env {
  AI: any; // Cloudflare AI binding
  SUPPORT_SESSION: any; // DurableObjectNamespace
  ESCALATION_QUEUE: any; // DurableObjectNamespace
  SUPPORT_KV: any; // KVNamespace
  SUPPORT_FILES: any; // R2Bucket
  ENVIRONMENT: string;
  MAX_CONVERSATION_LENGTH: string;
  ESCALATION_THRESHOLD: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    confidence?: number;
    escalated?: boolean;
    sentiment?: 'positive' | 'negative' | 'neutral';
  };
}

export interface SupportSession {
  id: string;
  userId: string;
  messages: Message[];
  status: 'active' | 'escalated' | 'resolved' | 'closed';
  escalationCount: number;
  createdAt: number;
  updatedAt: number;
  metadata: {
    userAgent?: string;
    ipAddress?: string;
    referrer?: string;
    customerTier?: 'free' | 'premium' | 'enterprise';
  };
}

export interface EscalationRequest {
  sessionId: string;
  reason: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  summary: string;
  timestamp: number;
  customerInfo: {
    userId: string;
    tier: string;
    previousEscalations: number;
  };
}

export interface AIResponse {
  content: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason?: string;
  suggestedActions?: string[];
}

export interface WorkflowContext {
  sessionId: string;
  currentStep: string;
  data: Record<string, any>;
  retryCount: number;
}

export interface KnowledgeBaseEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  category: string;
  lastUpdated: number;
  relevanceScore?: number;
}