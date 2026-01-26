const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const NIM_API_KEY = process.env.NIM_API_KEY;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

// Model mapping - Maps Janitor AI model names to NVIDIA NIM models
const MODEL_MAPPING = {
  // DeepSeek models - R1 REMOVED Jan 26, 2026
  'gpt-4o': 'deepseek-ai/deepseek-v3.2',
  'gpt-4': 'deepseek-ai/deepseek-v3.2',
  'gpt-3.5-turbo': 'deepseek-ai/deepseek-v3.1',
  'deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  'deepseek-terminus': 'deepseek-ai/deepseek-v3.1-terminus',
  
  // Meta Llama models
  'llama-3.1-405b': 'meta/llama-3.1-405b-instruct',
  'llama-405b': 'meta/llama-3.1-405b-instruct',
  'llama-3.1-70b': 'meta/llama-3.1-70b-instruct',
  'llama-70b': 'meta/llama-3.1-70b-instruct',
  'llama-3.1-8b': 'meta/llama-3.1-8b-instruct',
  'llama-3.3-70b': 'meta/llama-3.3-70b-instruct',
  'llama-nemotron': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  'nemotron-ultra': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
  
  // Mistral models
  'mistral-7b': 'mistralai/mistral-7b-instruct-v0.3',
  'mixtral-8x7b': 'mistralai/mixtral-8x7b-instruct-v0.1',
  'mixtral-8x22b': 'mistralai/mixtral-8x22b-instruct-v0.1',
  
  // Google Gemma models
  'gemma-27b': 'google/gemma-3-27b-it',
  'gemma-12b': 'google/gemma-3-12b-it',
  'gemma-4b': 'google/gemma-3-4b-it',
  
  // Qwen models
  'qwen-72b': 'qwen/qwen2.5-72b-instruct',
  'qwen-7b': 'qwen/qwen2.5-7b-instruct',
  'qwen-32b': 'qwen/qwen2.5-32b-instruct',
  'qwen-14b': 'qwen/qwen2.5-14b-instruct',
  'qwen-3-next-80b': 'qwen/qwen3-next-80b-a3b-thinking',
  'qwen-coder-32b': 'qwen/qwen3-coder-32b-instruct',
  
  // Kimi (Moonshot AI) models
  'kimi-k2': 'moonshotai/kimi-k2-instruct',
  'kimi-k2-0905': 'moonshotai/kimi-k2-instruct-0905',
  'kimi-k2-thinking': 'moonshotai/kimi-k2-thinking',
  'kimi-thinking': 'moonshotai/kimi-k2-thinking',
  
  // GLM models (Zhipu AI / Z.AI)
  'glm-4.7': 'z-ai/glm4.7',
  'glm4.7': 'z-ai/glm4.7',
  
  // OpenAI GPT-OSS
  'gpt-oss-120b': 'openai/gpt-oss-120b',
  'gpt-oss-20b': 'openai/gpt-oss-20b',
  
  // Alternative mappings
  'claude-3-opus': 'meta/llama-3.1-405b-instruct',
  'claude-3-sonnet': 'meta/llama-3.1-70b-instruct'
};

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    api_key_configured: !!NIM_API_KEY,
    available_models: Object.keys(MODEL_MAPPING),
    service: 'NVIDIA NIM Proxy for Janitor AI'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    service: 'NVIDIA NIM Proxy',
    endpoints: {
      health: '/health',
      models: '/v1/models',
      chat: '/v1/chat/completions'
    }
  });
});

// Models list
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map(modelName => ({
    id: modelName,
    object: 'model',
    created: Date.now(),
    owned_by: 'nvidia-nim-proxy',
    nvidia_model: MODEL_MAPPING[modelName]
  }));
  
  res.json({
    object: 'list',
    data: models
  });
});

// Function to handle chat requests
async function handleChat(req, res) {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({ 
        error: { message: 'NIM_API_KEY not configured in Render environment' } 
      });
    }

    const { model, messages, temperature, max_tokens, stream } = req.body;

    // FIXED: Better model lookup
    let nvidiaNimModel = MODEL_MAPPING[model];
    
    // If not found, try to use it directly (for full NVIDIA model IDs)
    if (!nvidiaNimModel) {
      nvidiaNimModel = model;
    }
    
    // Final fallback to GLM-4.7 (NOT R1!)
    if (!nvidiaNimModel || nvidiaNimModel.includes('deepseek-r1')) {
      nvidiaNimModel = 'z-ai/glm4.7';
    }

    console.log(`Request: ${model} → Using: ${nvidiaNimModel}`);

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: nvidiaNimModel,
      messages: messages,
      temperature: temperature || 0.5,
      max_tokens: max_tokens || 200,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || 'gpt-4o',
      choices: response.data.choices.map((choice, index) => {
        // Get the content
        let content = choice.message?.content || '';
        
        // FORCE 4 PARAGRAPH LIMIT - Physically trim excess paragraphs
        const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0);
        if (paragraphs.length > 4) {
          content = paragraphs.slice(0, 4).join('\n\n');
          console.log(`⚠️ Trimmed response from ${paragraphs.length} to 4 paragraphs`);
        }
        
        return {
          index: index,
          message: {
            role: choice.message?.role || 'assistant',
            content: content
          },
          finish_reason: choice.finish_reason || 'stop'
        };
      }),
      usage: response.data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
    
    res.json(openaiResponse);
  } catch (error) {
    console.error('Proxy error:', error.message);
    console.error('Error details:', error.response?.data);
    
    res.status(error.response?.status || 500).json({
      error: {
        message: error.response?.data?.detail || error.message || 'Internal server error',
        type: 'api_error',
        code: error.response?.status || 500
      }
    });
  }
}

// Chat completions - main endpoint
app.post('/v1/chat/completions', handleChat);

// Catch other POST requests
app.post('*', handleChat);

// Catch-all
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.method} ${req.path} not found`,
      type: 'invalid_request_error'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 NVIDIA NIM Proxy running on port ${PORT}`);
  console.log(`🔑 API Key: ${NIM_API_KEY ? 'Configured ✓' : 'MISSING ✗'}`);
  console.log(`📡 Ready for Janitor AI requests`);
});
