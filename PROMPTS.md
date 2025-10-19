# AI Prompts Documentation

This document contains all AI prompts used in the CF AI Support Agent system, as required for the assignment submission.

## System Prompts

### Main Customer Support Agent Prompt

**Location**: `src/agent.ts` - `callLLM()` method

**Purpose**: Primary system prompt for the customer support AI agent

```
You are a helpful customer support agent. You should:
- Be polite and professional
- Provide accurate information based on the knowledge base
- Ask clarifying questions when needed
- Suggest escalation to human agents for complex issues
- Keep responses concise but helpful
```

**Context**: This prompt is used for every interaction with the Llama 3.3 model to ensure consistent, professional customer support responses.

## Prompt Engineering Strategies

### 1. Role Definition
The prompt clearly establishes the AI's role as a "helpful customer support agent" to set appropriate expectations and behavior patterns.

### 2. Behavioral Guidelines
Specific instructions ensure the AI:
- Maintains professionalism
- Uses available knowledge base information
- Knows when to escalate issues
- Keeps responses focused and helpful

### 3. Context Integration
The system dynamically builds context by including:
- Customer message
- Conversation history (last 5 messages)
- Relevant knowledge base entries

**Example Context Building** (from `buildContext()` method):
```typescript
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
```

## Model Configuration

### Llama 3.3 Parameters

**Model**: `@cf/meta/llama-3.3-70b-instruct`

**Parameters**:
- `max_tokens`: 512 (keeps responses concise)
- `temperature`: 0.3 (low temperature for consistent, factual responses)

**Rationale**: 
- Low temperature ensures consistent, professional responses
- Limited tokens prevent overly long responses
- The instruct variant is optimized for following instructions

## Escalation Detection Prompts

### Implicit Escalation Logic

The system uses keyword-based and conversation analysis rather than explicit prompts for escalation detection:

**Escalation Keywords** (from `shouldEscalate()` method):
```typescript
const escalationKeywords = [
  'angry', 'frustrated', 'complaint', 'refund', 'cancel', 'legal',
  'lawsuit', 'terrible', 'awful', 'worst', 'hate', 'furious'
];
```

**Uncertainty Indicators**:
```typescript
const uncertaintyIndicators = ['not sure', 'might be', 'possibly', 'i think'];
```

## Knowledge Base Integration

### Knowledge Base Prompt Structure

The system automatically includes relevant knowledge base entries in the context:

**Format**:
```
Relevant knowledge base entries:
- [Entry Title]: [Entry Content]
- [Entry Title]: [Entry Content]
```

**Default Knowledge Base Entries**:

1. **Account Login Issues**
   - Content: "If you cannot log in, try resetting your password or clearing browser cache."
   - Tags: ['login', 'password', 'account']

2. **Billing Questions**
   - Content: "For billing inquiries, check your account dashboard or contact our billing team."
   - Tags: ['billing', 'payment', 'invoice']

3. **Technical Support**
   - Content: "For technical issues, please provide error messages and steps to reproduce."
   - Tags: ['technical', 'error', 'bug']

## Response Processing

### Confidence Calculation

The system calculates response confidence based on knowledge base matches:

```typescript
private calculateConfidence(response: string, knowledge: KnowledgeBaseEntry[]): number {
  if (knowledge.length === 0) return 0.3;
  if (knowledge.length === 1) return 0.6;
  if (knowledge.length >= 2) return 0.8;
  return 0.5;
}
```

### Suggested Actions Generation

Based on message content, the system suggests relevant actions:

```typescript
if (message.toLowerCase().includes('password')) {
  actions.push('Send password reset link');
}
if (message.toLowerCase().includes('billing')) {
  actions.push('Review billing history');
}
if (message.toLowerCase().includes('technical')) {
  actions.push('Create technical support ticket');
}
```

## Error Handling Prompts

### Fallback Response

When the AI model fails or encounters an error:

```
"I apologize, but I encountered an error. Let me connect you with a human agent."
```

This ensures graceful degradation and automatic escalation when technical issues occur.

### Default Response

When the AI model returns no response:

```
"I apologize, but I could not generate a response. Please try again."
```

## Frontend Integration

### Initial Greeting

The frontend automatically displays this greeting message:

```
"Hello! I'm your AI customer support assistant. How can I help you today?"
```

### Escalation Notification

When escalation occurs, the frontend displays:

```
"⚠️ This conversation has been escalated to a human agent"
```

## Prompt Optimization Guidelines

### Best Practices Implemented

1. **Clear Role Definition**: Establishes the AI as a customer support agent
2. **Specific Instructions**: Provides clear behavioral guidelines
3. **Context Awareness**: Includes conversation history and knowledge base
4. **Escalation Triggers**: Defines when to involve human agents
5. **Professional Tone**: Ensures consistent, helpful responses

### Future Enhancements

Potential prompt improvements for future versions:

1. **Industry-Specific Prompts**: Customize for specific business domains
2. **Multilingual Support**: Add language-specific prompts
3. **Sentiment Analysis**: Include emotional context in prompts
4. **Personalization**: Adapt prompts based on customer history
5. **A/B Testing**: Test different prompt variations for effectiveness

## Compliance and Safety

### Content Filtering

The system relies on Cloudflare's built-in content filtering and the model's safety training. No explicit content filtering prompts are currently implemented.

### Privacy Considerations

The prompts do not include any personally identifiable information (PII) handling instructions. In a production environment, additional prompts should be added to:

- Avoid storing sensitive information
- Redirect requests for personal data to human agents
- Comply with data protection regulations

## Monitoring and Analytics

### Prompt Performance Metrics

The system tracks:
- Response confidence scores
- Escalation rates
- Knowledge base match rates
- Conversation length before resolution

These metrics can be used to optimize prompts over time.

---

**Note**: All prompts in this system are designed to work with Cloudflare Workers AI and the Llama 3.3 model. Modifications may be needed when using different AI models or platforms.