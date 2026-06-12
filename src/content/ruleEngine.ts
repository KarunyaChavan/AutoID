import { IdentityVault } from '../utils/storage';

type FieldType = keyof IdentityVault;

const RULES: Array<{ field: string; patterns: string[] }> = [
  {
    field: 'pan',
    patterns: [
      'pan', 'permanent account number', 'income tax id', 'income tax number',
      'tax id', 'taxpayer id', 'pan no', 'pan number', 'tax identification',
      'it number', 'income tax',
    ],
  },
  {
    field: 'aadhaar',
    patterns: [
      'aadhaar', 'uidai', 'aadhar', 'aadhaar number', 'aadhaar card',
      'unique identification', 'national id', '12 digit', 'enrolment id',
      'resident id', 'aadhaar no',
    ],
  },
  {
    field: 'uan',
    patterns: [
      'uan', 'universal account number', 'epfo', 'epfo number',
      'pf account', 'provident fund', 'uan number', 'pf number',
    ],
  },
  {
    field: 'passport',
    patterns: [
      'passport', 'passport number', 'passport no', 'travel document',
    ],
  },
  {
    field: 'dl',
    patterns: [
      'driving license', 'driving licence', 'dl number', 'driver license',
      'motor vehicle license', 'driving no',
    ],
  },
  {
    field: 'voterid',
    patterns: [
      'voter id', 'voter id number', 'voter identity', 'elector id',
      'epic card', 'epic number', 'voter card',
    ],
  },
  {
    field: 'dob',
    patterns: [
      'dob', 'date of birth', 'birth date', 'birthday', 'dd/mm/yyyy',
      'date de naissance', 'birth',
    ],
  },
  {
    field: 'email',
    patterns: [
      'email', 'e-mail', 'email address', 'email id', 'mail id',
      'electronic mail', 'e mail',
    ],
  },
  {
    field: 'phone',
    patterns: [
      'phone', 'mobile', 'phone number', 'mobile number', 'contact number',
      'telephone', 'cell phone', 'phone no', 'tel', 'mobile no',
      'contact no',
    ],
  },
  {
    field: 'name',
    patterns: [
      'name', 'full name', 'first name', 'last name', 'your name',
      'applicant name', 'employee name', 'given name', 'surname',
      'middle name', 'initial',
    ],
  },
];

const computeRelevance = (text: string, pattern: string): number => {
  const lower = text.toLowerCase();
  const pLower = pattern.toLowerCase();
  if (lower.includes(pLower)) return 1.0;
  const tokens = lower.split(/\W+/).filter(Boolean);
  const pTokens = pLower.split(/\W+/).filter(Boolean);
  const matchCount = pTokens.filter(t => tokens.includes(t)).length;
  return matchCount / Math.max(1, pTokens.length);
};

export const matchField = (label: string, context: string): FieldType | null => {
  const combined = `${label} ${context}`.toLowerCase();
  if (!combined.trim()) return null;

  let bestField: FieldType | null = null;
  let bestScore = 0;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const score = computeRelevance(combined, pattern);
      if (score > bestScore) {
        bestScore = score;
        bestField = rule.field as FieldType;
      }
    }
  }

  return bestField;
};
