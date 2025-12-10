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
  res.json({ status: 'ok', api_key: !!NIM_API_KEY });
});

// Handle ALL routes - catches any format Janitor AI might use
app.all('*', async (req, res) => {
  // Log what we received
  console.log('Request:', req.method, req.path);
  console.log('Body:', JSON.stringify(req.body));

  // Handle health/info requests
  if (req.path === '/' || req.path === '/health') {
    return res.json({ status: 'ok', service: 'NVIDIA NIM Proxy' });
  }

  // Handle models list
  if (req.path.includes('/models')) {
    return res.json({
      object: 'list',
      data: [
        { id: 'gpt-4o', object: 'model', owned_by: 'nvidia' },
        { id: 'deepseek-r1', object: 'model', owned_by: 'nvidia' }
      ]
    });
  }

  // Handle chat completions (any path that might be a chat request)
  if (req.method === 'POST' && (req.path.includes('chat') || req.path.includes('completion'))) {
    try {
      if (!NIM_API_KEY) {
        return res.status(500).json({ error: { message: 'API key not configured' } });
      }

      const { model, messages, temperature, max_tokens, stream } = req.body;

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
        response.data.pipe(res);
      } else {
        res.json({
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model || 'gpt-4o',
          choices: response.data.choices,
          usage: response.data.usage
        });
      }
    } catch (error) {
      console.error('Error:', error.message);
      res.status(500).json({
        error: {
          message: error.response?.data?.detail || error.message,
          type: 'api_error'
        }
      });
    }
  } else {
    // Unknown endpoint
    res.status(404).json({
      error: { message: `Unknown endpoint: ${req.path}` }
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on port ${PORT}`);
  console.log(`API Key: ${NIM_API_KEY ? 'Configured' : 'MISSING'}`);
});
