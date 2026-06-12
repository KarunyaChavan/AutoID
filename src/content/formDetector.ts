import { matchField } from './ruleEngine';
import { getVault } from '../utils/storage';

const getContextForInput = (el: Element): string => {
  const parts: string[] = [];

  // 1. Walk up parents looking for headings / legend / section title
  let node: Element | null = el.parentElement;
  for (let i = 0; i < 8 && node; i++) {
    const heading = node.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading?.textContent) parts.push(heading.textContent.trim());

    const legend = node.querySelector('legend');
    if (legend?.textContent) parts.push(legend.textContent.trim());

    const fieldset = node.querySelector('fieldset');
    const fieldsetLegend = fieldset?.querySelector('legend');
    if (fieldsetLegend?.textContent) parts.push(fieldsetLegend.textContent.trim());

    // Check for aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent) parts.push(labelEl.textContent.trim());
    }

    // Check aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) parts.push(ariaLabel.trim());

    node = node.parentElement;
  }

  // 2. Page title
  if (document.title) parts.push(document.title.trim());

  return parts.join(' ');
};

export const detectAndAutofill = async () => {
  const vault = await getVault();
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select'
  );

  let filledCount = 0;
  const skippedFields: Array<{ label: string; id: string | null }> = [];

  for (const input of inputs) {
    if (
      input.type === 'hidden' ||
      input.type === 'submit' ||
      input.type === 'button' ||
      input.type === 'reset' ||
      input.type === 'checkbox' ||
      input.type === 'radio' ||
      input.type === 'file' ||
      input.type === 'image' ||
      input.disabled ||
      ('readOnly' in input && input.readOnly)
    ) {
      continue;
    }

    const labelEl = input.labels?.[0] || input.closest('label');
    const labelText = labelEl ? labelEl.innerText.trim() : '';
    const placeholderText = input.getAttribute('placeholder') || '';
    const name = input.name || '';
    const id = input.id || '';
    const ariaLabel = input.getAttribute('aria-label') || '';
    const titleAttr = input.getAttribute('title') || '';
    const contextText = getContextForInput(input);

    // Build the text to match against
    const matchText = [
      labelText,
      placeholderText,
      ariaLabel,
      titleAttr,
      name.replace(/[_-]/g, ' '),
      id.replace(/[_-]/g, ' '),
    ].filter(Boolean).join(' ');

    const fullContext = `${matchText} ${contextText}`;
    const matchedFieldType = matchField(matchText, fullContext);

    if (matchedFieldType && vault[matchedFieldType]) {
      // Support different input types
      if (input.type === 'date' && matchedFieldType === 'dob') {
        // Try to convert various date formats to YYYY-MM-DD
        const d = vault.dob;
        if (d) {
          const match = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
          if (match) {
            const [, dd, mm, yyyy] = match;
            const year = yyyy.length === 2 ? '20' + yyyy : yyyy;
            input.value = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
          } else {
            input.value = d;
          }
        }
      } else {
        input.value = vault[matchedFieldType];
      }

      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));

      input.style.border = '2px solid #10b981';
      input.style.backgroundColor = 'rgba(16, 185, 129, 0.05)';
      filledCount++;
    } else if (matchedFieldType && !vault[matchedFieldType]) {
      skippedFields.push({ label: labelText || name || id, id: id || null });
    }
  }

  if (skippedFields.length > 0) {
    console.log('[IdentityCopilot] Fields detected but not filled (no vault data):', skippedFields);
  }

  return filledCount;
};

export const collectFieldContext = (): Array<{
  label: string;
  placeholder: string;
  context: string;
  name: string;
  id: string;
  type: string;
}> => {
  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select'
  );
  const fields: Array<{
    label: string;
    placeholder: string;
    context: string;
    name: string;
    id: string;
    type: string;
  }> = [];

  for (const input of inputs) {
    if (
      input.type === 'hidden' ||
      input.type === 'submit' ||
      input.type === 'button' ||
      input.type === 'reset'
    ) {
      continue;
    }
    const labelEl = input.labels?.[0] || input.closest('label');
    const labelText = labelEl ? labelEl.innerText.trim() : '';
    const placeholderText = input.getAttribute('placeholder') || '';
    const contextText = getContextForInput(input);

    fields.push({
      label: labelText,
      placeholder: placeholderText,
      context: contextText,
      name: input.name || '',
      id: input.id || '',
      type: input.type || 'text',
    });
  }

  return fields;
};
