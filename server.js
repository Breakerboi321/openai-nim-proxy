const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const NIM_API_KEY = process.env.NIM_API_KEY || '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';

// Model mapping - Maps Janitor AI model names to NVIDIA NIM models
const MODEL_MAPPING = {
  'gpt-4o': 'deepseek-ai/deepseek-r1-0528',
  'gpt-4': 'deepseek-ai/deepseek-v3.2',
  'gpt-3.5-turbo': 'deepseek-ai/deepseek-v3.1',
  'deepseek-r1': 'deepseek-ai/deepseek-r1-0528',
  'deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  'deepseek-terminus': 'deepseek-ai/deepseek-v3.1-terminus',
  'claude-3-opus': 'deepseek-ai/deepseek-v3.2'
};

// Function to handle chat requests
async function handleChat(req, res) {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({ 
        error: { message: 'API key not configured' } 
      });
    }

    const { model, messages, temperature, max_tokens, stream } = req.body;

    // Determine which NVIDIA model to use
    let nvidiaNimModel = MODEL_MAPPING[model] || 'deepseek-ai/deepseek-r1-0528';

    console.log(`Request: ${model} → Using: ${nvidiaNimModel}`);

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: nvidiaNimModel,
      messages: messages,
      temperature: temperature || 0.8,
      max_tokens: max_tokens || 3000,
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
    console.error('Error:', error.message);
    res.status(500).json({
      error: { message: error.response?.data?.detail || error.message }
    });
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    api_key: !!NIM_API_KEY,
    available_models: Object.keys(MODEL_MAPPING)
  });
});

// Models list - shows all available model mappings
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

// Catch ALL POST requests - treat as chat
app.post('*', handleChat);

// GET requests show info
app.get('*', (req, res) => {
  res.json({ 
    service: 'NVIDIA NIM Proxy - Multi-Model',
    models: Object.keys(MODEL_MAPPING),
    message: 'Send POST requests with model name to use different DeepSeek models'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Multi-Model NVIDIA NIM Proxy running on ${PORT}`);
  console.log(`🔑 API Key: ${NIM_API_KEY ? 'Configured ✓' : 'MISSING ✗'}`);
  console.log(`📋 Available models:`, Object.keys(MODEL_MAPPING));
});
