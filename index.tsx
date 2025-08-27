/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

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
      const apiResponse = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });

      if (!apiResponse.ok) {
        throw new Error(`HTTP error! status: ${apiResponse.status}`);
      }
      
      const data = await apiResponse.json();
      setResponse(data.text);

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