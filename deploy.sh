#!/bin/bash

# CF AI Support Agent Deployment Script
# This script sets up and deploys the Cloudflare AI Support Agent

set -e

echo "🚀 Starting CF AI Support Agent deployment..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Please install it first:"
    echo "npm install -g wrangler"
    exit 1
fi

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo "🔐 Please login to Cloudflare first:"
    echo "wrangler login"
    exit 1
fi

echo "✅ Wrangler CLI found and authenticated"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create KV namespace if it doesn't exist
echo "🗄️ Setting up KV namespace..."
KV_ID=$(wrangler kv:namespace create "SUPPORT_KV" --preview false | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
KV_PREVIEW_ID=$(wrangler kv:namespace create "SUPPORT_KV" --preview | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

echo "📝 KV Namespace created:"
echo "  Production ID: $KV_ID"
echo "  Preview ID: $KV_PREVIEW_ID"

# Update wrangler.toml with actual KV IDs
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/your-kv-namespace-id/$KV_ID/g" wrangler.toml
    sed -i '' "s/your-preview-kv-namespace-id/$KV_PREVIEW_ID/g" wrangler.toml
else
    # Linux
    sed -i "s/your-kv-namespace-id/$KV_ID/g" wrangler.toml
    sed -i "s/your-preview-kv-namespace-id/$KV_PREVIEW_ID/g" wrangler.toml
fi

# Create R2 bucket
echo "🪣 Setting up R2 bucket..."
wrangler r2 bucket create support-files || echo "Bucket may already exist"
wrangler r2 bucket create support-files-preview || echo "Preview bucket may already exist"

# Populate knowledge base
echo "📚 Populating knowledge base..."
wrangler kv:key put --binding=SUPPORT_KV "kb_login" '{"id":"login","title":"Account Login Issues","content":"If you cannot log in, try resetting your password or clearing browser cache.","tags":["login","password","account"],"category":"authentication","lastUpdated":'$(date +%s)'000}'

wrangler kv:key put --binding=SUPPORT_KV "kb_billing" '{"id":"billing","title":"Billing Questions","content":"For billing inquiries, check your account dashboard or contact our billing team.","tags":["billing","payment","invoice"],"category":"billing","lastUpdated":'$(date +%s)'000}'

wrangler kv:key put --binding=SUPPORT_KV "kb_technical" '{"id":"technical","title":"Technical Support","content":"For technical issues, please provide error messages and steps to reproduce.","tags":["technical","error","bug"],"category":"technical","lastUpdated":'$(date +%s)'000}'

# Deploy the Worker
echo "🚀 Deploying Worker..."
wrangler deploy

# Get the deployment URL
WORKER_URL=$(wrangler whoami | grep -o 'https://[^/]*\.workers\.dev' | head -1)
if [ -z "$WORKER_URL" ]; then
    WORKER_URL="https://cf-ai-support-agent.your-subdomain.workers.dev"
fi

echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📋 Deployment Summary:"
echo "  Worker URL: $WORKER_URL"
echo "  KV Namespace ID: $KV_ID"
echo "  R2 Bucket: support-files"
echo ""
echo "🔗 Access your application:"
echo "  Chat Interface: $WORKER_URL"
echo "  Health Check: $WORKER_URL/health"
echo "  API Documentation: See README.md"
echo ""
echo "🛠️ Next Steps:"
echo "  1. Test the chat interface"
echo "  2. Monitor logs with: wrangler tail"
echo "  3. Update knowledge base via API"
echo "  4. Configure custom domain (optional)"
echo ""
echo "📖 For more information, see README.md and PROMPTS.md"