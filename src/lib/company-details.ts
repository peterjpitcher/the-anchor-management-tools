export const COMPANY_DETAILS = {
  legalName: 'Orange Jelly Limited',
  tradingName: 'The Anchor',
  registrationNumber: '10537179',
  vatNumber: 'GB315203647',
  address: {
    street: 'The Anchor, Horton Road',
    city: 'Stanwell Moor Village',
    county: 'Surrey',
    postcode: 'TW19 6AQ',
    country: 'United Kingdom'
  },
  phone: '01753 682 707',
  email: 'manager@the-anchor.pub',
  website: 'https://the-anchor.pub',
  bankDetails: {
    bankName: 'Orange Jelly Limited',
    accountNumber: '32448887',
    sortCode: '23-05-80',
    accountName: 'Orange Jelly Limited'
  },
  // Convenience properties for templates
  name: 'Orange Jelly Limited',
  fullAddress: 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ',
  companyNumber: '10537179',
  bank: {
    name: 'Orange Jelly Limited',
    accountNumber: '32448887',
    sortCode: '23-05-80',
    accountName: 'Orange Jelly Limited'
  }
} as const