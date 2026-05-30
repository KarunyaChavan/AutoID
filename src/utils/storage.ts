export interface IdentityVault {
  name: string;
  dob: string;
  pan: string;
  aadhaar: string;
  email: string;
  phone: string;
}

const DEFAULT_VAULT: IdentityVault = {
  name: '',
  dob: '',
  pan: '',
  aadhaar: '',
  email: '',
  phone: ''
};

export const getVault = async (): Promise<IdentityVault> => {
  if (!chrome?.storage?.local) {
    return DEFAULT_VAULT;
  }
  return new Promise((resolve) => {
    chrome.storage.local.get(['identityVault'], (result) => {
      resolve(result.identityVault || DEFAULT_VAULT);
    });
  });
};

export const setVault = async (vault: IdentityVault): Promise<void> => {
  if (!chrome?.storage?.local) {
    console.warn('chrome.storage.local not found, cannot save.');
    return;
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ identityVault: vault }, () => {
      resolve();
    });
  });
};
