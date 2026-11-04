import { AI_FIELDS } from './ai-fields';
import { quotedPhrases } from './ai-phrases';
import { AI_PRESETS, FIELD_GUIDE } from './ai-scaffolds';

describe('field guide and the template library', () => {
  it('explains every field a task can write', () => {
    for (const [entity, fields] of Object.entries(AI_FIELDS))
      for (const field of fields)
        expect(
          FIELD_GUIDE.some((g) => g.entity === entity && g.key === field.key),
        ).toBe(true);
  });

  it.each(AI_PRESETS.map((preset) => [preset.id, preset] as const))(
    '%s: only fields a task can write, an instruction for each, within limits',
    (_, preset) => {
      const keys = AI_FIELDS[preset.entity].map((field) => field.key);
      expect(preset.fields.length).toBeGreaterThan(0);
      for (const field of preset.fields) expect(keys).toContain(field);
      for (const field of Object.keys(preset.fieldTexts)) {
        expect(preset.fields).toContain(field);
      }
      expect(
        preset.general.trim() || Object.keys(preset.fieldTexts).length,
      ).toBeTruthy();
      const length =
        preset.general.length +
        Object.values(preset.fieldTexts).join('').length;
      expect(length).toBeLessThanOrEqual(8000);
    },
  );

  it('has templates for products, categories and brands, with unique ids', () => {
    const ids = AI_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entity of Object.keys(AI_FIELDS)) {
      expect(AI_PRESETS.some((preset) => preset.entity === entity)).toBe(true);
    }
  });

  it('a template asking for an SEO description keeps the B2B payment line (the check requires it)', () => {
    for (const preset of AI_PRESETS) {
      const text = preset.fieldTexts.seoDescription;
      if (text) expect(text).toMatch(/безнал/);
    }
  });

  it('the «купить в Минске» templates quote the phrase, so it survives the cleaner', () => {
    const preset = AI_PRESETS.find((item) => item.id === 'product-seo-minsk')!;
    expect(quotedPhrases({ fields: preset.fieldTexts })).toEqual(
      expect.arrayContaining(['купить в Минске']),
    );
  });
});
