const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const NIM_API_KEY = process.env.NIM_API_KEY;

// Function to handle chat requests
async function handleChat(req, res) {
  try {
    if (!NIM_API_KEY) {
      return res.status(500).json({ 
        error: { message: 'API key not configured' } 
      });
    }

    const { model, messages, temperature, max_tokens, stream } = req.body;

    console.log(`Chat request to ${req.path}`);

    const response = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
      model: 'deepseek-ai/deepseek-r1-0528',
      messages: messages,
      temperature: temperature || 0.7,
      max_tokens: max_tokens || 2000,
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
  res.json({ status: 'ok', api_key: !!NIM_API_KEY });
});

// Models
app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [{ id: 'gpt-4o', object: 'model' }]
  });
});

// Catch ALL POST requests - treat as chat
app.post('*', handleChat);

// GET requests to show info
app.get('*', (req, res) => {
  res.json({ 
    service: 'NVIDIA NIM Proxy',
    message: 'Send POST requests with OpenAI format to any endpoint'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on ${PORT}`);
  console.log(`API Key: ${NIM_API_KEY ? 'OK' : 'MISSING'}`);
});
