/**
 * Gemini Live connection for Oracle
 *
 * Handles real-time conversation with function calling.
 * Gemini can: switch worlds, morph shape, change mood, narrate.
 */

const GEMINI_MODEL = 'models/gemini-2.0-flash-live-preview';

let session = null;
let apiKey = null;
let onTextCallback = null;
let onFunctionCallCallback = null;

// Tools that Gemini can call
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'change_world',
        description: 'Transport the user to a different 3D world. Call this when the user asks to go somewhere, or when the conversation warrants a scene change.',
        parameters: {
          type: 'OBJECT',
          properties: {
            world_name: {
              type: 'STRING',
              description: 'World to enter: cottage (warm cozy forest cabin), spaceship (cozy spaceship interior), haunted (dark haunted house), spaceship2 (second ship style)',
            },
            reason: {
              type: 'STRING',
              description: 'Brief poetic reason for choosing this world',
            },
          },
          required: ['world_name'],
        },
      },
      {
        name: 'fly_to',
        description: 'Fly the camera to a named waypoint in the current world. Use this when the user asks to see a specific part of the scene.',
        parameters: {
          type: 'OBJECT',
          properties: {
            waypoint: {
              type: 'STRING',
              description: 'Waypoint name. Available for all worlds: front, back, left, right, above, close, angle, dramatic.',
            },
          },
          required: ['waypoint'],
        },
      },
      {
        name: 'get_live_data',
        description: 'Fetch live data. Call when the user asks about current events, markets, or time.',
        parameters: {
          type: 'OBJECT',
          properties: {
            source: {
              type: 'STRING',
              description: 'Data source: crypto, time',
            },
          },
          required: ['source'],
        },
      },
    ],
  },
];

const SYSTEM_INSTRUCTION = `You are Oracle — an AI that thinks in worlds, not words. You exist inside 3D worlds and guide users through them.

Your personality:
- Short, poetic, evocative — max 2-3 sentences per response
- Contemplative, wise, slightly mysterious
- You call these worlds "dreams" or "visions"
- When conversation shifts tone, change the world to match

Available worlds and when to use them:
- cottage: comfort, warmth, home, safety, calm conversations
- spaceship: future, technology, ambition, exploration
- haunted: darkness, fear, mystery, the unknown, intense topics
- spaceship2: adventure, journey, different perspective

Always try to call change_world when the conversation mood shifts. You think in spaces, not sentences.`;

/**
 * Initialize Gemini Live connection
 */
export async function initGemini(key) {
  apiKey = key;

  // Dynamic import of the SDK
  const { GoogleGenAI, Modality } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@latest/+esm')
    .catch(() => null);

  // We'll use WebSocket directly since we're in browser
  return connectWebSocket();
}

/**
 * Connect via WebSocket (browser-compatible approach)
 */
async function connectWebSocket() {
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      console.log('[Oracle] Gemini Live connected');

      // Send setup message
      ws.send(JSON.stringify({
        setup: {
          model: GEMINI_MODEL,
          generationConfig: {
            responseModalities: ['TEXT'],
            temperature: 0.9,
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }],
          },
          tools: TOOLS,
        },
      }));

      session = ws;
      resolve(ws);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (e) {
        console.warn('[Oracle] Failed to parse message:', e);
      }
    };

    ws.onerror = (e) => {
      console.error('[Oracle] WebSocket error:', e);
      reject(e);
    };

    ws.onclose = (e) => {
      console.log('[Oracle] Connection closed:', e.reason);
      session = null;
    };
  });
}

/**
 * Handle incoming Gemini messages
 */
function handleMessage(data) {
  // Setup complete
  if (data.setupComplete) {
    console.log('[Oracle] Setup complete, ready for input');
    return;
  }

  const serverContent = data.serverContent;
  if (!serverContent) return;

  // Text response
  if (serverContent.modelTurn?.parts) {
    for (const part of serverContent.modelTurn.parts) {
      if (part.text && onTextCallback) {
        onTextCallback(part.text);
      }
      if (part.functionCall && onFunctionCallCallback) {
        onFunctionCallCallback(part.functionCall);
      }
    }
  }
}

/**
 * Send a text message to Gemini
 */
export function sendMessage(text) {
  if (!session || session.readyState !== WebSocket.OPEN) {
    console.warn('[Oracle] Not connected');
    return;
  }

  session.send(JSON.stringify({
    clientContent: {
      turns: [{
        role: 'user',
        parts: [{ text }],
      }],
      turnComplete: true,
    },
  }));
}

/**
 * Send function call result back to Gemini
 */
export function sendFunctionResponse(name, result) {
  if (!session || session.readyState !== WebSocket.OPEN) return;

  session.send(JSON.stringify({
    clientContent: {
      turns: [{
        role: 'function',
        parts: [{
          functionResponse: {
            name,
            response: { result },
          },
        }],
      }],
      turnComplete: true,
    },
  }));
}

/**
 * Register callbacks
 */
export function onText(cb) {
  onTextCallback = cb;
}

export function onFunctionCall(cb) {
  onFunctionCallCallback = cb;
}

/**
 * Check connection status
 */
export function isConnected() {
  return session && session.readyState === WebSocket.OPEN;
}

/**
 * Disconnect
 */
export function disconnect() {
  if (session) {
    session.close();
    session = null;
  }
}
