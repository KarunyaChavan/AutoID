import { matchField } from './ruleEngine';
import { getVault } from '../utils/storage';

export const detectAndAutofill = async () => {
  const vault = await getVault();
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
  
  let filledCount = 0;

  inputs.forEach(input => {
    // Skip hidden or uneditable fields
    if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button' || input.disabled || ('readOnly' in input && input.readOnly)) {
      return;
    }

    const labelElement = input.labels?.[0] || input.closest('label');
    const labelText = labelElement ? labelElement.innerText : input.name || input.id || '';
    const placeholderText = input.getAttribute('placeholder') || '';

    const matchedFieldType = matchField(labelText, placeholderText);

    if (matchedFieldType && vault[matchedFieldType]) {
      input.value = vault[matchedFieldType];
      // Dispatch events to notify React/Angular/Vue of the change
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Optional: highlight the field
      input.style.border = '2px solid #10b981';
      input.style.backgroundColor = 'rgba(16, 185, 129, 0.05)';
      filledCount++;
    }
  });

  return filledCount;
};
