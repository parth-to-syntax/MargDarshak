import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (response.status === 401 && window.location.pathname !== '/') {
    window.dispatchEvent(new CustomEvent('auth-failed'));
  }
  return response;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)