import { AI_FIELDS } from './ai-fields';
import { FIELD_GUIDE, PROMPT_SCAFFOLDS } from './ai-scaffolds';

describe('prompt frameworks for the SEO specialist', () => {
  it('explains every field a task can write', () => {
    for (const [entity, fields] of Object.entries(AI_FIELDS))
      for (const field of fields)
        expect(
          FIELD_GUIDE.some((g) => g.entity === entity && g.key === field.key),
        ).toBe(true);
  });

  it('only suggests fields a task can write, and leaves something to fill in', () => {
    for (const scaffold of PROMPT_SCAFFOLDS) {
      const keys = AI_FIELDS[scaffold.entity].map((field) => field.key);
      for (const field of scaffold.fields) expect(keys).toContain(field);
      expect(scaffold.text).toMatch(/\[[^\]]+\]/);
      expect(scaffold.text.length).toBeLessThanOrEqual(8000);
    }
  });
});
