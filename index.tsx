/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from '@google/genai';

const App = () => {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAskGemini = async () => {
    if (!prompt.trim()) {
      setError('Bitte gib eine Frage ein.');
      return;
    }
    setLoading(true);
    setError('');
    setResponse('');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const genAIResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      setResponse(genAIResponse.text);
    } catch (e) {
      setError('Ein Fehler ist aufgetreten. Bitte versuche es erneut.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleAskGemini();
    }
  };

  return (
    <main>
      <h1>Stell Gemini eine Frage</h1>
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Deine Frage..."
        aria-label="Frage an Gemini"
        aria-required="true"
      />
      <button onClick={handleAskGemini} disabled={loading} aria-live="polite">
        {loading ? 'Lade...' : 'Frage stellen'}
      </button>

      {error && <p className="error" role="alert">{error}</p>}

      {response && (
        <section className="response-container" aria-label="Antwort von Gemini">
          <h2>Antwort:</h2>
          <p>{response}</p>
        </section>
      )}
    </main>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
