/**
 * A unique-constraint violation. Login uniqueness is pre-checked before the
 * insert, but two simultaneous requests can always overtake that check — this
 * turns the race into a 409 instead of a 500. One definition for the backend
 * lives in `common/utils/upsert-tolerantly.ts`.
 */
export { isUniqueViolation } from '../common/utils/upsert-tolerantly';
