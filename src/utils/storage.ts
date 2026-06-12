import { encrypt, decrypt } from './crypto';

export type IdentityVault = Record<string, string>;

export const VAULT_FIELDS = ['name', 'dob', 'pan', 'aadhaar', 'email', 'phone', 'uan'] as const;

export const FIELD_LABELS: Record<string, string> = {
  name: 'Full Name',
  dob: 'Date of Birth',
  pan: 'PAN Number',
  aadhaar: 'Aadhaar Number',
  email: 'Email Address',
  phone: 'Phone Number',
  uan: 'UAN (EPFO)',
  passport: 'Passport Number',
  dl: 'Driving License',
  voterid: 'Voter ID',
};

export const FIELD_PLACEHOLDERS: Record<string, string> = {
  name: 'John Doe',
  dob: '',
  pan: 'ABCDE1234F',
  aadhaar: '1234 5678 9012',
  email: 'john@example.com',
  phone: '+91 9876543210',
  uan: 'IN123456789012',
  passport: 'A1234567',
  dl: 'HR-012021234567',
  voterid: 'ABC1234567',
};

const DEFAULT_VAULT: IdentityVault = {};

const getChrome = () => (globalThis as any).chrome;

export const getVault = async (passphrase?: string): Promise<IdentityVault> => {
  const ext = getChrome();
  if (!ext?.storage?.local) return { ...DEFAULT_VAULT };

  return new Promise((resolve) => {
    ext.storage.local.get(['identityVault', 'encryptedVault', 'vaultPassphrase'], async (result: any) => {
      if (result.encryptedVault && result.vaultPassphrase && passphrase) {
        try {
          const decrypted = await decrypt(result.encryptedVault, passphrase);
          const vault = JSON.parse(decrypted);
          resolve({ ...DEFAULT_VAULT, ...vault });
          return;
        } catch {
          // Wrong passphrase, fall through
        }
      }

      if (passphrase && result.encryptedVault) {
        resolve({ ...DEFAULT_VAULT });
        return;
      }

      resolve(result.identityVault || { ...DEFAULT_VAULT });
    });
  });
};

export const setVault = async (vault: IdentityVault, passphrase?: string): Promise<void> => {
  const ext = getChrome();
  if (!ext?.storage?.local) {
    console.warn('chrome.storage.local not found, cannot save.');
    return;
  }

  if (passphrase) {
    const json = JSON.stringify(vault);
    const encrypted = await encrypt(json, passphrase);
    return new Promise((resolve) => {
      ext.storage.local.set({
        encryptedVault: encrypted,
        vaultPassphrase: true,
        identityVault: undefined,
      }, () => resolve());
    });
  }

  return new Promise((resolve) => {
    ext.storage.local.set({ identityVault: vault }, () => resolve());
  });
};

export const isVaultEncrypted = async (): Promise<boolean> => {
  const ext = getChrome();
  if (!ext?.storage?.local) return false;
  return new Promise((resolve) => {
    ext.storage.local.get(['encryptedVault'], (result: any) => {
      resolve(!!result.encryptedVault);
    });
  });
};

export function normalizeDOB(value: string): string {
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  // DD/MM/YYYY or DD-MM-YYYY
  const m = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // DD/MM/YY or DD-MM-YY
  const m2 = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m2) {
    const [, dd, mm, yy] = m2;
    const yyyy = `20${yy}`;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // YYYY/MM/DD or YYYY-MM-DD (non-standard separator)
  const m3 = value.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (m3) {
    const [, yyyy, mm, dd] = m3;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return value;
}
