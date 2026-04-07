import { inject, Injectable } from '@angular/core';
import type { FormFieldDefinition, FormGroupDefinition, FormSchema } from '@theredhead/ui-forms';

import { LoggerFactory } from '@theredhead/foundation';
import type { ColumnInfo, FullTableSchema } from '../models';
import { FORM_OVERRIDES } from '../config/form-overrides';
import { FetchlaneService } from './fetchlane.service';

export type FormMode = 'add' | 'edit';

@Injectable({ providedIn: 'root' })
export class SchemaFormFactory {
  private readonly log = inject(LoggerFactory).createLogger('SchemaFormFactory');
  private readonly fetchlane = inject(FetchlaneService);

  public buildFormSchema(schema: FullTableSchema, mode: FormMode): FormSchema {
    const overrideKey = `${schema.table_name}:${mode}`;
    const override = FORM_OVERRIDES[overrideKey];
    if (override) {
      this.log.debug(`Using override form for ${overrideKey}`);
      return override;
    }

    const pkColumns = this.getPrimaryKeyColumns(schema);
    const fks = this.fetchlane.extractForeignKeys(schema);
    const fkMap = new Map(fks.map((fk) => [fk.column, fk]));

    const fields: FormFieldDefinition[] = schema.columns
      .filter((col) => this.shouldIncludeField(col, mode, pkColumns))
      .map((col) => this.columnToField(col, mode, pkColumns, fkMap));

    return {
      id: `${schema.table_name}-${mode}`,
      title: `${mode === 'add' ? 'Add' : 'Edit'} ${schema.table_name}`,
      groups: [
        {
          id: 'main',
          title: schema.table_name,
          fields,
        } satisfies FormGroupDefinition,
      ],
    };
  }

  public buildFormSchemaJson(schema: FullTableSchema, mode: FormMode): string {
    return JSON.stringify(this.buildFormSchema(schema, mode), null, 2);
  }

  private shouldIncludeField(
    col: ColumnInfo,
    mode: FormMode,
    pkColumns: ReadonlySet<string>,
  ): boolean {
    if (col.is_identity && col.identity_generation === 'ALWAYS') {
      return false;
    }
    if (mode === 'add' && col.is_identity) {
      return false;
    }
    return true;
  }

  private columnToField(
    col: ColumnInfo,
    mode: FormMode,
    pkColumns: ReadonlySet<string>,
    fkMap: Map<string, { referencedTable: string; referencedColumn: string }>,
  ): FormFieldDefinition {
    const isPk = pkColumns.has(col.column_name);
    const isReadOnly = isPk && mode === 'edit';

    const field: FormFieldDefinition = {
      id: col.column_name,
      title: this.humanize(col.column_name),
      component: this.mapComponent(col),
      config: this.buildConfig(col, isReadOnly, fkMap),
      validation: this.buildValidation(col, isPk),
      ...(isReadOnly
        ? { enabledWhen: { field: '__never__', operator: 'equals', value: true } }
        : {}),
    };

    return field;
  }

  private mapComponent(col: ColumnInfo): string {
    const dt = col.data_type.toLowerCase();
    const udt = col.udt_name.toLowerCase();

    if (dt === 'boolean' || udt === 'bool') {
      return 'checkbox';
    }
    if (dt === 'date') {
      return 'date';
    }
    if (dt.includes('timestamp') || udt.includes('timestamp')) {
      return 'datetime';
    }
    if (dt === 'time' || udt === 'time') {
      return 'time';
    }
    if (
      dt === 'text' ||
      (col.character_maximum_length !== null && col.character_maximum_length > 255)
    ) {
      return 'textarea';
    }
    if (this.isNumericType(dt, udt)) {
      return 'number';
    }
    return 'text';
  }

  private isNumericType(dt: string, udt: string): boolean {
    return (
      dt.includes('int') ||
      dt === 'numeric' ||
      dt === 'decimal' ||
      dt === 'real' ||
      dt === 'double precision' ||
      dt === 'float' ||
      udt === 'int4' ||
      udt === 'int8' ||
      udt === 'int2' ||
      udt === 'float4' ||
      udt === 'float8' ||
      udt === 'numeric'
    );
  }

  private buildConfig(
    col: ColumnInfo,
    isReadOnly: boolean,
    fkMap: Map<string, { referencedTable: string; referencedColumn: string }>,
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};

    if (isReadOnly) {
      config['readonly'] = true;
    }

    const fk = fkMap.get(col.column_name);
    if (fk) {
      config['placeholder'] = `${fk.referencedTable}.${fk.referencedColumn}`;
    }

    if (col.character_maximum_length !== null) {
      config['maxlength'] = col.character_maximum_length;
    }

    return Object.keys(config).length > 0 ? config : {};
  }

  private buildValidation(
    col: ColumnInfo,
    isPk: boolean,
  ): readonly import('@theredhead/ui-forms').ValidationRule[] {
    const rules: import('@theredhead/ui-forms').ValidationRule[] = [];

    if (!col.is_nullable && !col.is_identity && col.column_default === null) {
      rules.push({ type: 'required', message: `${this.humanize(col.column_name)} is required.` });
    }

    if (col.character_maximum_length !== null && col.character_maximum_length > 0) {
      rules.push({
        type: 'maxLength',
        params: { max: col.character_maximum_length },
        message: `Maximum ${col.character_maximum_length} characters.`,
      });
    }

    return rules;
  }

  private getPrimaryKeyColumns(schema: FullTableSchema): ReadonlySet<string> {
    const pkConstraint = schema.constraints.find((c) => c.constraint_type === 'PRIMARY KEY');
    return new Set(pkConstraint?.columns ?? []);
  }

  private humanize(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
