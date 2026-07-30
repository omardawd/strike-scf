export const DOC_KIND_LABELS: Record<string, string> = {
  certificate_of_incorporation: 'Certificate of Incorporation',
  photo_id: 'Government-issued Photo ID',
  proof_of_address: 'Proof of Business Address',
  ubo_declaration: 'Corporate Ownership / UBO Declaration',
  bank_statements: 'Business Bank Statements',
  audited_financials: 'Audited Financial Statements',
  tax_return: 'Corporate Tax Return',
  board_resolution: 'Board Resolution',
}

export const REQUESTABLE_DOC_KINDS = Object.keys(DOC_KIND_LABELS)
