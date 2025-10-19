# CF AI Support Agent

An AI-powered customer support chatbot built on Cloudflare's platform, featuring intelligent conversation handling, automatic escalation to human agents, and persistent session management.

## Features

- **AI-Powered Responses**: Uses Llama 3.3 on Cloudflare Workers AI for intelligent customer support
- **Automatic Escalation**: Detects when conversations need human intervention
- **Session Management**: Persistent conversation history using Durable Objects
- **Knowledge Base**: Searchable knowledge base for consistent responses
- **Real-time Chat**: Web-based chat interface with instant responses
- **Escalation Queue**: Prioritized queue system for human agents
- **Memory & State**: Maintains conversation context and customer information

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │  Cloudflare      │    │  Workers AI     │
│   (Pages)       │◄──►│  Workers         │◄──►│  (Llama 3.3)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                       ┌────────┴────────┐
                       │                 │
                ┌──────▼──────┐   ┌──────▼──────┐
                │  Durable    │   │ Escalation  │
                │  Objects    │   │   Queue     │
                │ (Sessions)  │   │    (DO)     │
                └─────────────┘   └─────────────┘
                       │
                ┌──────▼──────┐
                │     KV      │
                │ (Knowledge  │
                │    Base)    │
                └─────────────┘
```

## Prerequisites

- Node.js 18+ installed
- Cloudflare account with Workers plan
- Wrangler CLI installed globally: `npm install -g wrangler`

## Quick Start

### 1. Clone and Setup

```bash
# Navigate to the project directory
cd cf_ai_support_agent

# Install dependencies
npm install

# Login to Cloudflare
wrangler login
```

### 2. Configure Cloudflare Resources

Before deploying, you need to create the required Cloudflare resources:

```bash
# Create KV namespace for knowledge base
wrangler kv:namespace create "SUPPORT_KV"
wrangler kv:namespace create "SUPPORT_KV" --preview

# Create R2 bucket for file storage
wrangler r2 bucket create support-files
wrangler r2 bucket create support-files-preview
```

### 3. Update Configuration

Update `wrangler.toml` with your actual resource IDs:

```toml
[[kv_namespaces]]
binding = "SUPPORT_KV"
id = "your-actual-kv-namespace-id"
preview_id = "your-actual-preview-kv-namespace-id"
```

### 4. Deploy

```bash
# Deploy the Worker
npm run deploy

# The application will be available at:
# https://cf-ai-support-agent.your-subdomain.workers.dev
```

## Local Development

```bash
# Start local development server
npm run dev

# Access the application at:
# http://localhost:8787
```

## API Endpoints

### Chat API
- **POST** `/api/chat` - Send message to AI agent
  ```json
  {
    "message": "I need help with my account",
    "sessionId": "session_123",
    "userId": "user_456"
  }
  ```

### Session Management
- **GET** `/api/session?sessionId=123` - Get session details
- **POST** `/api/session` - Create new session
- **PUT** `/api/session` - Update session

### Escalation Management
- **GET** `/api/escalation/queue` - Get escalation queue
- **GET** `/api/escalation/next` - Get next escalation
- **DELETE** `/api/escalation/{sessionId}` - Remove escalation

### Knowledge Base
- **GET** `/api/knowledge` - List knowledge base entries
- **POST** `/api/knowledge` - Add knowledge base entry

## Configuration

### Environment Variables

Set these in your `wrangler.toml` or Cloudflare dashboard:

- `ENVIRONMENT`: `development` or `production`
- `MAX_CONVERSATION_LENGTH`: Maximum messages per session (default: 50)
- `ESCALATION_THRESHOLD`: Number of exchanges before considering escalation (default: 3)

### Knowledge Base

The system includes a default knowledge base with common support topics. You can add entries via the API:

```bash
curl -X POST https://your-worker.workers.dev/api/knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "id": "custom_1",
    "title": "Custom Support Topic",
    "content": "Detailed explanation of the topic",
    "tags": ["custom", "support"],
    "category": "general"
  }'
```

## Escalation Logic

The AI agent automatically escalates conversations when:

1. **Frustration Keywords**: Customer uses words like "angry", "frustrated", "complaint"
2. **Long Conversations**: More than the threshold number of exchanges without resolution
3. **Low Confidence**: AI is uncertain about the response
4. **Complex Issues**: Technical problems requiring human expertise

## Customization

### Adding New Knowledge Base Entries

1. Use the API endpoint to add entries programmatically
2. Or modify the default entries in `src/agent.ts`

### Modifying AI Behavior

Edit the system prompt in `src/agent.ts`:

```typescript
const response = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct', {
  messages: [
    {
      role: 'system',
      content: `Your custom system prompt here...`
    },
    // ...
  ]
});
```

### Customizing Escalation Rules

Modify the `shouldEscalate` method in `src/agent.ts` to implement custom escalation logic.

## Monitoring and Debugging

### Health Check

```bash
curl https://your-worker.workers.dev/health
```

### Logs

View logs in the Cloudflare dashboard or using Wrangler:

```bash
wrangler tail
```

### Session Debugging

Check session state:

```bash
curl "https://your-worker.workers.dev/api/session?sessionId=your-session-id"
```

## Production Considerations

### Security

- Implement authentication for admin endpoints
- Add rate limiting for chat endpoints
- Validate and sanitize all user inputs
- Use HTTPS only in production

### Performance

- Monitor AI model usage and costs
- Implement caching for knowledge base queries
- Set appropriate TTLs for KV storage
- Monitor Durable Object usage

### Scaling

- The system automatically scales with Cloudflare Workers
- Durable Objects provide consistent state management
- Consider implementing load balancing for high-traffic scenarios

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors**: Run `npm install`
2. **KV namespace not found**: Update `wrangler.toml` with correct IDs
3. **AI model errors**: Check Workers AI is enabled in your account
4. **CORS errors**: Ensure frontend is served from the same domain

### Debug Mode

Set `ENVIRONMENT=development` in `wrangler.toml` for additional logging.

## Cost Estimation

Approximate costs for 1000 conversations/month:

- **Workers AI**: ~$2-5 (depending on message length)
- **Durable Objects**: ~$1-2
- **KV Storage**: ~$0.50
- **Workers Requests**: ~$0.15
- **Total**: ~$4-8/month

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review Cloudflare Workers documentation
3. Open an issue in the repository