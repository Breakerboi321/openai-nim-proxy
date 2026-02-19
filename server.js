const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' })); // Very high limit for unlimited conversation history

// Environment variable
const NIM_API_KEY = process.env.NIM_API_KEY;

// VERIFIED WORKING MODELS - OPTIMIZED FOR SPEED + QUALITY
const MODEL_MAPPING = {
  // RECOMMENDED FOR WARHAMMER 40K ROLEPLAY (Fast + Smart)
  'gpt-4o': 'qwen/qwen2.5-72b-instruct',  // BEST: Fast, creative, 5-8s
  'gpt-4': 'meta/llama-3.1-70b-instruct',  // Great balance, 3-5s
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',  // Super fast, 2-3s
  
  // Qwen - EXCELLENT for creative writing
  'qwen-72b': 'qwen/qwen2.5-72b-instruct',
  'qwen/qwen2.5-72b-instruct': 'qwen/qwen2.5-72b-instruct',
  
  // Llama - Most reliable
  'llama-70b': 'meta/llama-3.1-70b-instruct',
  'llama-3.1-70b': 'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-70b-instruct': 'meta/llama-3.1-70b-instruct',
  'llama-8b': 'meta/llama-3.1-8b-instruct',
  'llama-3.1-8b': 'meta/llama-3.1-8b-instruct',
  'meta/llama-3.1-8b-instruct': 'meta/llama-3.1-8b-instruct',
  
  // Mistral - Fast responses
  'mistral-7b': 'mistralai/mistral-7b-instruct-v0.3',
  'mistralai/mistral-7b-instruct-v0.3': 'mistralai/mistral-7b-instruct-v0.3',
  
  // GLM-5 - VERY SLOW (744B params) - Use only if you can wait 2-3 minutes
  'glm-5': 'z-ai/glm5',
  'glm5': 'z-ai/glm5',
  'z-ai/glm5': 'z-ai/glm5',
  'glm-5-thinking': 'z-ai/glm5',
  
  // Fast models
  'deepseek-v3': 'meta/llama-3.1-8b-instruct',
};

// Default fallback model (BEST for Warhammer 40K roleplay)
const DEFAULT_MODEL = 'qwen/qwen2.5-72b-instruct';

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    api_key_configured: !!NIM_API_KEY,
    node_version: process.version,
    total_models: Object.keys(MODEL_MAPPING).length,
    service: 'NVIDIA NIM Proxy for Janitor AI'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    service: 'NVIDIA NIM Proxy',
    version: '2.0.0',
    endpoints: {
      health: 'GET /health',
      models: 'GET /v1/models',
      chat: 'POST /v1/chat/completions'
    },
    documentation: 'https://github.com/Breakerboi321/openai-nim-proxy'
  });
});

// List available models
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(modelName => ({
    id: modelName,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'nvidia',
    permission: [],
    root: modelName,
    parent: null
  }));
  
  res.json({
    object: 'list',
    data: models
  });
});

// ============================================
// MAIN CHAT HANDLER
// ============================================

async function handleChatCompletion(req, res) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`\n[${ requestId}] ========== NEW REQUEST ==========`);
  console.log(`[${requestId}] Time: ${new Date().toISOString()}`);
  
  try {
    // Validate API key
    if (!NIM_API_KEY) {
      console.error(`[${requestId}] ❌ API key not configured`);
      return res.status(500).json({ 
        error: { 
          message: 'NVIDIA API key not configured. Please set NIM_API_KEY in Render environment variables.',
          type: 'configuration_error'
        } 
      });
    }

    // Extract request data
    const { 
      model, 
      messages, 
      temperature = 0.7, 
      max_tokens = 800,
      top_p = 0.9,
      frequency_penalty = 0,
      presence_penalty = 0
    } = req.body;

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error(`[${requestId}] ❌ Invalid messages array`);
      return res.status(400).json({
        error: {
          message: 'Invalid request: messages array is required',
          type: 'invalid_request_error'
        }
      });
    }

    console.log(`[${requestId}] Requested model: ${model}`);
    console.log(`[${requestId}] Messages: ${messages.length}`);
    console.log(`[${requestId}] Request size: ${JSON.stringify(req.body).length} bytes`);
    console.log(`[${requestId}] Max tokens: ${max_tokens}`);

    // Determine NVIDIA model to use
    let nvidiaNimModel = MODEL_MAPPING[model] || model;
    
    // If model not found and doesn't look like NVIDIA format, use default
    if (!MODEL_MAPPING[model] && !model?.includes('/')) {
      console.log(`[${requestId}] ⚠️  Model '${model}' not found, using default`);
      nvidiaNimModel = DEFAULT_MODEL;
    }

    // Safety check: never use deepseek-r1
    if (nvidiaNimModel?.includes('deepseek-r1')) {
      console.log(`[${requestId}] ⚠️  Blocked deprecated model, using default`);
      nvidiaNimModel = DEFAULT_MODEL;
    }

    console.log(`[${requestId}] → NVIDIA model: ${nvidiaNimModel}`);

    // Make request to NVIDIA API
    console.log(`[${requestId}] Sending to NVIDIA...`);
    const startTime = Date.now();

    // Force strict token limits
    const strictMaxTokens = Math.min(max_tokens || 500, 500); // Never exceed 500 tokens
    
    console.log(`[${requestId}] Strict max_tokens: ${strictMaxTokens}`);
    
    const nvidiaResponse = await axios.post(
      'https://integrate.api.nvidia.com/v1/chat/completions',
      {
        model: nvidiaNimModel,
        messages: messages,
        temperature: temperature,
        max_tokens: strictMaxTokens,
        top_p: top_p,
        stream: false,
        stop: ["\n\nUser:", "\n\nHuman:", "###", "\n\n\n"]  // Add stop sequences
      },
      {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 30000, // 30 seconds - should be plenty for 500 tokens
        maxContentLength: 50000, // Max 50KB response
        maxBodyLength: 50000
      }
    );

    const elapsed = Date.now() - startTime;
    console.log(`[${requestId}] ✓ NVIDIA responded in ${elapsed}ms`);

    // Validate response
    if (!nvidiaResponse.data?.choices?.[0]?.message?.content) {
      console.error(`[${requestId}] ❌ Empty response from NVIDIA`);
      throw new Error('Empty response from NVIDIA API');
    }

    // Extract and process content
    let content = nvidiaResponse.data.choices[0].message.content;
    const originalLength = content.length;

    // Apply 4-paragraph limit
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
    if (paragraphs.length > 4) {
      content = paragraphs.slice(0, 4).join('\n\n');
      console.log(`[${requestId}] ✂️  Trimmed from ${paragraphs.length} to 4 paragraphs`);
    }

    console.log(`[${requestId}] Content: ${content.length} chars (${paragraphs.length} paragraphs)`);

    // Build OpenAI-compatible response
    const response = {
      id: `chatcmpl-${requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: content
          },
          finish_reason: 'stop',
          logprobs: null
        }
      ],
      usage: nvidiaResponse.data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      },
      system_fingerprint: `nvidia_${nvidiaNimModel.replace('/', '_')}`
    };

    console.log(`[${requestId}] ✓ Sending response (${JSON.stringify(response).length} bytes)`);
    res.json(response);
    console.log(`[${requestId}] ✓ Success`);

  } catch (error) {
    console.error(`\n[${requestId}] ========== ERROR ==========`);
    console.error(`[${requestId}] Type: ${error.name}`);
    console.error(`[${requestId}] Message: ${error.message}`);

    // Handle timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      const timeoutDuration = nvidiaNimModel?.includes('glm5') ? '90s' : '30s';
      console.error(`[${requestId}] ❌ Request timed out (${timeoutDuration})`);
      return res.status(504).json({
        error: {
          message: `Model timed out after ${timeoutDuration}. GLM-5 is a massive model (744B params) and may take longer. Try: 1) Shorter prompts 2) Lower max_tokens 3) Use llama-3.1-8b for faster responses`,
          type: 'timeout_error',
          code: 'request_timeout',
          model_used: nvidiaNimModel,
          suggestion: 'For Warhammer 40K: Try llama-3.1-70b-instruct (fast, smart) or qwen-72b (good balance)'
        }
      });
    }

    // Handle NVIDIA API errors
    if (error.response) {
      console.error(`[${requestId}] NVIDIA Status: ${error.response.status}`);
      console.error(`[${requestId}] NVIDIA Error:`, error.response.data);
      
      // Specific error handling
      if (error.response.status === 429) {
        return res.status(429).json({
          error: {
            message: 'Rate limit exceeded (40 requests/minute). Wait 60 seconds and try again.',
            type: 'rate_limit_error',
            code: 429
          }
        });
      }
      
      if (error.response.status === 402) {
        return res.status(402).json({
          error: {
            message: 'NVIDIA API credits expired. Generate a new API key at build.nvidia.com',
            type: 'insufficient_quota',
            code: 402
          }
        });
      }
      
      if (error.response.status === 504) {
        return res.status(504).json({
          error: {
            message: 'NVIDIA gateway timeout. Try a smaller/faster model like llama-3.1-8b-instruct',
            type: 'gateway_timeout',
            code: 504
          }
        });
      }
      
      return res.status(error.response.status).json({
        error: {
          message: error.response.data?.detail || error.response.data?.message || 'NVIDIA API error',
          type: 'nvidia_api_error',
          code: error.response.status,
          nvidia_error: error.response.data
        }
      });
    }

    // Generic error
    console.error(`[${requestId}] Stack:`, error.stack);
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'internal_error'
      }
    });
  }
  
  console.log(`[${requestId}] ========== END REQUEST ==========\n`);
}

// ============================================
// ROUTE HANDLERS
// ============================================

// Main chat endpoint
app.post('/v1/chat/completions', handleChatCompletion);

// Fallback for other paths (Janitor AI sometimes uses different paths)
app.post('/chat/completions', handleChatCompletion);
app.post('/v1/completions', handleChatCompletion);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint not found: ${req.method} ${req.path}`,
      type: 'invalid_request_error',
      available_endpoints: [
        'GET /health',
        'GET /v1/models',
        'POST /v1/chat/completions'
      ]
    }
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'internal_error'
    }
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 ========================================');
  console.log('   NVIDIA NIM PROXY SERVER');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔑 API Key: ${NIM_API_KEY ? '✓ Configured' : '✗ MISSING'}`);
  console.log(`🌐 Node.js: ${process.version}`);
  console.log(`📦 Models: ${Object.keys(MODEL_MAPPING).length} available`);
  console.log(`⏱️  Started: ${new Date().toISOString()}`);
  console.log('========================================');
  console.log('⚔️  RECOMMENDED FOR WARHAMMER 40K:');
  console.log('   gpt-4o    → Qwen 72B (BEST: fast + creative)');
  console.log('   gpt-4     → Llama 70B (great balance)');
  console.log('   llama-70b → Direct Llama 70B');
  console.log('   qwen-72b  → Direct Qwen 72B');
  console.log('========================================');
  console.log('⚠️  GLM-5 available but VERY SLOW (2-3 min)');
  console.log('   Use glm-5 only if you can wait');
  console.log('========================================\n');
  
  if (!NIM_API_KEY) {
    console.error('⚠️  WARNING: NIM_API_KEY not set!');
    console.error('   Set it in Render dashboard → Environment tab\n');
  }
});
