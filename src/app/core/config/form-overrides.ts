import type { FormSchema } from '@theredhead/ui-forms';

/**
 * Global form overrides keyed by `"<table_name>:<mode>"`.
 *
 * When a key exists here, SchemaFormFactory uses this FormSchema
 * instead of auto-generating one from the database schema.
 *
 * To create an override:
 * 1. Go to Schema → select table → "Copy Add Form JSON" / "Copy Edit Form JSON"
 * 2. Paste the JSON here as a TypeScript object
 * 3. Customise fields, validation, ordering etc.
 *
 * @example
 * ```ts
 * export const FORM_OVERRIDES: Record<string, FormSchema> = {
 *   'Album:add': {
 *     id: 'Album-add',
 *     title: 'Add Album',
 *     groups: [{
 *       id: 'main',
 *       title: 'Album',
 *       fields: [
 *         { id: 'Title', title: 'Album Title', component: 'text',
 *           validation: [{ type: 'required', message: 'Title is required.' }] },
 *         { id: 'ArtistId', title: 'Artist', component: 'number' },
 *       ],
 *     }],
 *   },
 * };
 * ```
 */
export const FORM_OVERRIDES: Record<string, FormSchema> = {
  // Add overrides here — key format: "<TableName>:add" or "<TableName>:edit"
};
