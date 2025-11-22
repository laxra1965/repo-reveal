import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Add to src/main.tsx at the top, before rendering
window.addEventListener('error', (event) => {
  if (event.target && (event.target as any).src) {
    console.error('Failed to load resource:', (event.target as any).src);
  }
}, true);

// Monitor fetch requests
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  console.log('Fetch request:', args[0]);
  const response = await originalFetch(...args);
  if (!response.ok) {
    console.error('Fetch failed:', args[0], response.status);
  }
  return response;
};
createRoot(document.getElementById("root")!).render(<App />);
