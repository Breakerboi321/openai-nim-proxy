const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const NIM_API_KEY = process.env.NIM_API_KEY;

const MODEL_MAPPING = {
  // DeepSeek models - CORRECTED IDs
  'gpt-4o': 'deepseek-ai/deepseek-v3.2',
  'gpt-4': 'deepseek-ai/deepseek-v3.2',
  'gpt-3.5-turbo': 'deepseek-ai/deepseek-v3.1',
  'deepseek-v3': 'deepseek-ai/deepseek-v3',  // Changed from v3.1
  'deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  'deepseek-ai/deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',  // ADD THIS
  
  // Kimi models - CORRECTED (moonshot**ai**, not moonshotai)
  'kimi-k2-thinking': 'moonshotai/kimi-k2-thinking',
  'kimi-thinking': 'moonshotai/kimi-k2-thinking',
  'moonshotai/kimi-k2-thinking': 'moonshotai/kimi-k2-thinking',  // ADD THIS
  'kimi-k2': 'moonshotai/kimi-k2-instruct',
  'kimi-k2-instruct': 'moonshotai/kimi-k2-instruct',
  
  // GLM Models
'glm-5': 'z-ai/glm5',
'glm5': 'z-ai/glm5',
'z-ai/glm5': 'z-ai/glm5',
'glm-4.7': 'meta/llama-3.1-70b-instruct',  // Keep fast fallback
  
  // Meta Llama - Keep as is
  'llama-3.1-405b': 'meta/llama-3.1-405b-instruct',
  'llama-405b': 'meta/llama-3.1-405b-instruct',
  'llama-3.1-70b': 'meta/llama-3.1-70b-instruct',
  'llama-70b': 'meta/llama-3.1-70b-instruct',
  'llama-3.1-8b': 'meta/llama-3.1-8b-instruct',
  'llama-3.3-70b': 'meta/llama-3.3-70b-instruct',
  
  // Qwen - Keep as is
  'qwen-72b': 'qwen/qwen2.5-72b-instruct',
  'qwen-7b': 'qwen/qwen2.5-7b-instruct',
  
  // Mistral - Keep as is
  'mistral-7b': 'mistralai/mistral-7b-instruct-v0.3',
  'mixtral-8x7b': 'mistralai/mixtral-8x7b-instruct-v0.1',
  
  // Remove these (not on NVIDIA NIM):
  // ❌ 'deepseek-terminus'
  // ❌ 'nemotron-ultra'
  // ❌ 'gpt-oss-120b'
  // ❌ 'gemma-3-*' models
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

    // Model lookup with proper fallback
    let nvidiaNimModel = MODEL_MAPPING[model];
    
    // If not in mapping, check if it's already a valid NVIDIA model ID format
    if (!nvidiaNimModel) {
      if (model && model.includes('/') && !model.includes('deepseek-r1')) {
        nvidiaNimModel = model;
      }
    }
    
    // Final fallback to DeepSeek V3
    if (!nvidiaNimModel || nvidiaNimModel.includes('deepseek-r1')) {
      console.log(`⚠️ Model '${model}' not found, using fallback: deepseek-ai/deepseek-v3`);
      nvidiaNimModel = 'deepseek-ai/deepseek-v3';
    }

    console.log(`Request: ${model} → Using: ${nvidiaNimModel}`);

   const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
  model: nvidiaNimModel,
  messages: messages,
  temperature: temperature || 0.7,
  max_tokens: max_tokens || 800,
  stream: false
}, {
  headers: {
    'Authorization': `Bearer ${NIM_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 120000  // 120 seconds (2 minutes) for slow models
});

    // Check if response is valid
    if (!response.data || !response.data.choices || response.data.choices.length === 0) {
      throw new Error('Empty response from NVIDIA API');
    }

    const openaiResponse = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || 'gpt-4o',
      choices: response.data.choices.map((choice, index) => {
        // Get the content
        let content = choice.message?.content || '';
        
        // FORCE 4 PARAGRAPH LIMIT
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
    
    console.log(`✓ Response sent: ${openaiResponse.choices[0].message.content.substring(0, 50)}...`);
    res.json(openaiResponse);
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: {
          message: 'Request timed out after 60 seconds',
          type: 'timeout_error',
          code: 504
        }
      });
    }
    
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
