import '@angular/compiler';
import { computed, signal } from '@angular/core';
import { FormEngine } from '@theredhead/ui-forms';
import type { FormSchema } from '@theredhead/ui-forms';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Replicates the validationSummary computed from BoRecordFormDialog
 * so we can test the logic without bootstrapping the full component.
 */
function buildValidationSummary(engine: FormEngine) {
  return computed(() => {
    if (engine.valid()) return [];
    const summary: { title: string; errors: string[] }[] = [];
    for (const group of engine.groups) {
      for (const field of group.fields) {
        if (!field.visible()) continue;
        const v = field.validation();
        if (!v.valid) {
          summary.push({
            title: field.definition.title || field.definition.id,
            errors: v.errors.map((e: { message: string }) => e.message),
          });
        }
      }
    }
    return summary;
  });
}

function humanize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function makeFormSchema(overrides: Partial<FormSchema> = {}): FormSchema {
  return {
    id: 'test-form',
    title: 'Test',
    groups: [
      {
        id: 'main',
        title: 'Main',
        fields: [
          {
            id: 'album_id',
            title: 'Album Id',
            component: 'number',
            validation: [{ type: 'required', message: 'Album Id is required.' }],
          },
          {
            id: 'title',
            title: 'Title',
            component: 'text',
            validation: [
              { type: 'required', message: 'Title is required.' },
              { type: 'maxLength', params: { max: 160 }, message: 'Maximum 160 characters.' },
            ],
          },
          {
            id: 'artist_id',
            title: 'Artist Id',
            component: 'number',
            validation: [{ type: 'required', message: 'Artist Id is required.' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Record form dialog logic', () => {
  // ── validationSummary ──────────────────────────────────────────────

  describe('validationSummary', () => {
    it('should return empty array when form is valid', () => {
      const engine = new FormEngine(makeFormSchema());
      engine.setValue('album_id', 1);
      engine.setValue('title', 'Test Album');
      engine.setValue('artist_id', 5);

      const summary = buildValidationSummary(engine);
      expect(summary()).toEqual([]);
    });

    it('should list all invalid fields with their errors', () => {
      const engine = new FormEngine(makeFormSchema());
      // All fields empty → all required

      engine.markAllTouched();
      const summary = buildValidationSummary(engine);
      const result = summary();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        title: 'Album Id',
        errors: ['Album Id is required.'],
      });
      expect(result[1]).toEqual({
        title: 'Title',
        errors: ['Title is required.'],
      });
      expect(result[2]).toEqual({
        title: 'Artist Id',
        errors: ['Artist Id is required.'],
      });
    });

    it('should exclude valid fields from summary', () => {
      const engine = new FormEngine(makeFormSchema());
      engine.setValue('album_id', 100);
      engine.setValue('title', 'Valid Title');
      // artist_id left empty

      engine.markAllTouched();
      const summary = buildValidationSummary(engine);
      const result = summary();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Artist Id');
    });

    it('should update reactively when values change', () => {
      const engine = new FormEngine(makeFormSchema());
      engine.markAllTouched();
      const summary = buildValidationSummary(engine);

      expect(summary().length).toBe(3);

      engine.setValue('album_id', 1);
      engine.setValue('title', 'Filled');
      engine.setValue('artist_id', 2);

      expect(summary()).toEqual([]);
    });

    it('should use field id as fallback title when title is empty', () => {
      const schema = makeFormSchema({
        groups: [
          {
            id: 'main',
            title: 'Main',
            fields: [
              {
                id: 'untitled_field',
                title: '',
                component: 'text',
                validation: [{ type: 'required', message: 'Required.' }],
              },
            ],
          },
        ],
      });
      const engine = new FormEngine(schema);
      engine.markAllTouched();
      const summary = buildValidationSummary(engine);

      expect(summary()[0].title).toBe('untitled_field');
    });

    it('should skip hidden fields', () => {
      const schema: FormSchema = {
        id: 'test',
        title: 'Test',
        groups: [
          {
            id: 'main',
            title: 'Main',
            fields: [
              {
                id: 'visible_field',
                title: 'Visible',
                component: 'text',
                validation: [{ type: 'required', message: 'Required.' }],
              },
              {
                id: 'hidden_field',
                title: 'Hidden',
                component: 'text',
                validation: [{ type: 'required', message: 'Required.' }],
                visibleWhen: { field: '__never__', operator: 'equals', value: true },
              },
            ],
          },
        ],
      };

      const engine = new FormEngine(schema);
      engine.markAllTouched();
      const summary = buildValidationSummary(engine);

      const titles = summary().map((s) => s.title);
      expect(titles).toContain('Visible');
      expect(titles).not.toContain('Hidden');
    });
  });

  // ── humanize ───────────────────────────────────────────────────────

  describe('humanize', () => {
    it('should convert snake_case to Title Case', () => {
      expect(humanize('album_id')).toBe('Album Id');
      expect(humanize('first_name')).toBe('First Name');
      expect(humanize('media_type')).toBe('Media Type');
    });

    it('should split camelCase to Title Case', () => {
      expect(humanize('firstName')).toBe('First Name');
      expect(humanize('artistId')).toBe('Artist Id');
    });

    it('should handle single word', () => {
      expect(humanize('name')).toBe('Name');
      expect(humanize('title')).toBe('Title');
    });

    it('should handle mixed snake_case and camelCase', () => {
      expect(humanize('my_fieldName')).toBe('My Field Name');
    });
  });
});
