import { IdentityVault } from '../utils/storage';

type FieldType = keyof IdentityVault;

export const matchField = (label: string, placeholder: string): FieldType | null => {
  const text = `${label} ${placeholder}`.toLowerCase();

  // Basic Rule Engine for Phase 1
  if (text.includes('pan') || text.includes('permanent account number') || text.includes('income tax id')) {
    return 'pan';
  }
  
  if (text.includes('aadhaar') || text.includes('uidai') || text.includes('national id')) {
    return 'aadhaar';
  }
  
  if (text.includes('dob') || text.includes('date of birth') || text.includes('birth date')) {
    return 'dob';
  }

  if (text.includes('email') || text.includes('e-mail')) {
    return 'email';
  }

  if (text.includes('phone') || text.includes('mobile') || text.includes('contact number')) {
    return 'phone';
  }

  if (text.includes('name') || text.includes('full name') || text.includes('first name')) {
    return 'name';
  }

  return null;
};
