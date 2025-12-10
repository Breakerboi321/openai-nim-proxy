const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const NIM_API_KEY = process.env.NIM_API_KEY;

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    api_key_configured: !!NIM_API_KEY,
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
  res.json({
    object: 'list',
    data: [
      { 
        id: 'gpt-4o', 
        object: 'model', 
        created: Date.now(),
        owned_by: 'nvidia-proxy'
      },
      { 
        id: 'deepseek-r1', 
        object: 'model',
        created: Date.now(), 
        owned_by: 'nvidia-proxy'
      }
    ]
  });
});

// Chat completions - main endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({ 
        error: { 
          message: 'NIM_API_KEY not configured in Render environment',
          type: 'configuration_error'
        } 
      });
    }

    const { model, messages, temperature, max_tokens, stream } = req.body;

    console.log('Chat request received:', {
      model,
      messageCount: messages?.length,
      stream
    });

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: 'deepseek-ai/deepseek-r1-0528',
      messages: messages,
      temperature: temperature || 0.7,
      max_tokens: max_tokens || 2000,
      stream: stream || false
    }, {
      headers: {
        'Authorization': `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      response.data.pipe(res);
    } else {
      // Format response to match OpenAI exactly
      const openaiResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'gpt-4o',
        choices: response.data.choices.map((choice, index) => ({
          index: index,
          message: {
            role: choice.message?.role || 'assistant',
            content: choice.message?.content || ''
          },
          finish_reason: choice.finish_reason || 'stop'
        })),
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      
      console.log('Sending response:', {
        choicesCount: openaiResponse.choices.length,
        contentLength: openaiResponse.choices[0]?.message?.content?.length
      });
      
      res.json(openaiResponse);
    }
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
});

// Catch other POST requests that might be chat-related
app.post('*', (req, res) => {
  console.log('Unhandled POST to:', req.path);
  res.status(404).json({
    error: {
      message: `Endpoint ${req.path} not found. Use /v1/chat/completions`,
      type: 'invalid_request_error'
    }
  });
});

// Catch-all for other methods
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
