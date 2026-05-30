import React, { useEffect, useState } from 'react';
import { getVault, setVault, IdentityVault } from '../utils/storage';

const App: React.FC = () => {
  const [vault, setVaultData] = useState<IdentityVault | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getVault().then(setVaultData);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (vault) {
      setVaultData({ ...vault, [e.target.name]: e.target.value });
      setSaved(false);
    }
  };

  const handleSave = async () => {
    if (vault) {
      await setVault(vault);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleAutofill = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL_FORM' });
    }
  };

  if (!vault) {
    return <div className="loading">Loading Vault...</div>;
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>IdentityCopilot</h1>
        <p>Your AI-powered autofill assistant</p>
      </header>
      
      <main className="vault-form">
        <div className="form-group">
          <label>Full Name</label>
          <input type="text" name="name" value={vault.name} onChange={handleChange} placeholder="John Doe" />
        </div>
        <div className="form-group">
          <label>Date of Birth</label>
          <input type="date" name="dob" value={vault.dob} onChange={handleChange} />
        </div>
        <div className="form-group">
          <label>PAN Number</label>
          <input type="text" name="pan" value={vault.pan} onChange={handleChange} placeholder="ABCDE1234F" />
        </div>
        <div className="form-group">
          <label>Aadhaar Number</label>
          <input type="text" name="aadhaar" value={vault.aadhaar} onChange={handleChange} placeholder="1234 5678 9012" />
        </div>
        <div className="form-group">
          <label>Email Address</label>
          <input type="email" name="email" value={vault.email} onChange={handleChange} placeholder="john@example.com" />
        </div>
        <div className="form-group">
          <label>Phone Number</label>
          <input type="tel" name="phone" value={vault.phone} onChange={handleChange} placeholder="+91 9876543210" />
        </div>
      </main>

      <footer className="footer-actions">
        <button className={`btn-save ${saved ? 'saved' : ''}`} onClick={handleSave}>
          {saved ? 'Saved ✓' : 'Save Vault'}
        </button>
        <button className="btn-autofill" onClick={handleAutofill}>
          Autofill Form ✨
        </button>
      </footer>
    </div>
  );
};

export default App;
