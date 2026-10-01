/**
 * "No category applies": a payment that takes no expense category, such as drawings, tax or the
 * brewery account. It is stored as a flag on the payment (and on a rule that sets it), with the
 * category left empty. In a form it travels as this value in the category field.
 */
export const NO_CATEGORY_VALUE = '__no_category__'
export const NO_CATEGORY_LABEL = 'No category applies'
