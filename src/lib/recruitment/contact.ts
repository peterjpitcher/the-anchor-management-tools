const RECRUITMENT_CONTACT_EMAIL = 'peter@orangejelly.co.uk'

export const RECRUITMENT_EMAIL_SIGNATURE = [
  'Thanks,',
  '',
  'Peter Pitcher',
  'The Anchor',
  'Horton Road',
  'Stanwell Moor Village',
  'Surrey',
  'TW19 6AQ',
  '07990587315',
  RECRUITMENT_CONTACT_EMAIL,
].join('\n')

export const RECRUITMENT_RIGHT_TO_WORK_WORDING = [
  'Please bring proof of your right to work in the UK. Acceptable proof includes:',
  '- a British or Irish passport, or Irish passport card',
  '- a GOV.UK right to work share code',
  '- a UK or Irish birth/adoption certificate plus an official document showing your National Insurance number',
  '- a certificate of British citizenship or naturalisation plus an official document showing your National Insurance number',
  '- any other document accepted by GOV.UK for a right-to-work check',
].join('\n')

export function recruitmentSenderEmail(): string {
  return process.env.RECRUITMENT_FROM_EMAIL?.trim() || RECRUITMENT_CONTACT_EMAIL
}
