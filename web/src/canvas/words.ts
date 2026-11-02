/** A box's planned change, in the words the map shows. */
export const CHANGE_LABEL: Record<string, string> = { add: '새로', modify: '고침', delete: '지움', result: '결과', keep: '기존' }
/** The same in the review's map group, which speaks English beside Viewed and Changes. */
export const REVIEW_CHANGE_LABEL: Record<string, string> = { ...CHANGE_LABEL, add: 'New', modify: 'Modified' }
