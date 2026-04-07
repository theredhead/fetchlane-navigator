import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { map, Observable, of, tap } from 'rxjs';

import type {
  ChildForeignKeyInfo,
  ColumnInfo,
  FetchRequest,
  FetchResponse,
  ForeignKeyInfo,
  FullTableSchema,
  IndexInfo,
  SchemaConstraint,
  TableInfo,
} from '../models';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable({ providedIn: 'root' })
export class FetchlaneService {
  private readonly http = inject(HttpClient);
  private readonly schemaCache = new Map<string, CacheEntry<FullTableSchema>>();
  private readonly tableNamesCache = new Map<string, CacheEntry<string[]>>();

  /**
   * Number of entries currently held in the metadata cache.
   * Exposed as a signal so the settings panel can display it reactively.
   */
  public readonly cacheSize = signal(0);

  /**
   * Clears all cached table names and schemas.
   */
  public clearCache(): void {
    this.schemaCache.clear();
    this.tableNamesCache.clear();
    this.cacheSize.set(0);
  }

  private updateCacheSize(): void {
    this.cacheSize.set(this.schemaCache.size + this.tableNamesCache.size);
  }

  private isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return entry != null && Date.now() < entry.expiresAt;
  }

  public getTableNames(baseUrl: string): Observable<string[]> {
    const entry = this.tableNamesCache.get(baseUrl);
    if (this.isFresh(entry)) {
      return of(entry.value);
    }
    return this.http.get<Record<string, string>[]>(`${baseUrl}/api/data-access/table-names`).pipe(
      map((items) => items.map((i) => i['table_name'] ?? i['TABLE_NAME'] ?? '')),
      tap((names) => {
        this.tableNamesCache.set(baseUrl, { value: names, expiresAt: Date.now() + CACHE_TTL_MS });
        this.updateCacheSize();
      }),
    );
  }

  public getTableInfo(baseUrl: string, table: string): Observable<TableInfo> {
    return this.http.get<TableInfo>(`${baseUrl}/api/data-access/${encodeURIComponent(table)}/info`);
  }

  public getTableSchema(baseUrl: string, table: string): Observable<FullTableSchema> {
    return this.http
      .get<
        Record<string, unknown>
      >(`${baseUrl}/api/data-access/${encodeURIComponent(table)}/schema`)
      .pipe(map((raw) => this.normalizeSchema(raw)));
  }

  public extractForeignKeys(schema: FullTableSchema): ForeignKeyInfo[] {
    return schema.constraints
      .filter((c) => c.constraint_type === 'FOREIGN KEY' && c.referenced_table)
      .map((c) => {
        const column =
          c.columns.length > 0
            ? c.columns[0]
            : this.inferFkColumn(c.constraint_name, schema.table_name);
        const referencedColumn = c.referenced_columns.length > 0 ? c.referenced_columns[0] : column;
        return {
          constraintName: c.constraint_name,
          column,
          referencedTable: c.referenced_table!,
          referencedColumn,
        };
      })
      .filter((fk) => fk.column.length > 0);
  }

  private inferFkColumn(constraintName: string, tableName: string): string {
    const prefix = `${tableName}_`;
    const suffix = '_fkey';
    if (constraintName.startsWith(prefix) && constraintName.endsWith(suffix)) {
      return constraintName.slice(prefix.length, -suffix.length);
    }
    return '';
  }

  public getRecords(
    baseUrl: string,
    table: string,
    page = 0,
    pageSize = 25,
  ): Observable<FetchResponse> {
    const params = new HttpParams().set('pageSize', pageSize.toString());
    return this.http
      .get<
        Record<string, unknown>[]
      >(`${baseUrl}/api/data-access/${encodeURIComponent(table)}`, { params })
      .pipe(map((data) => ({ data })));
  }

  public getRecord(
    baseUrl: string,
    table: string,
    primaryKey: string,
  ): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      `${baseUrl}/api/data-access/${encodeURIComponent(table)}/record/${encodeURIComponent(primaryKey)}`,
    );
  }

  public fetch(baseUrl: string, request: FetchRequest): Observable<FetchResponse> {
    return this.http.post<FetchResponse>(`${baseUrl}/api/data-access/fetch`, request);
  }

  public createRecord(
    baseUrl: string,
    table: string,
    record: Record<string, unknown>,
  ): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(
      `${baseUrl}/api/data-access/${encodeURIComponent(table)}`,
      record,
    );
  }

  public updateRecord(
    baseUrl: string,
    table: string,
    primaryKey: string,
    record: Record<string, unknown>,
  ): Observable<Record<string, unknown>> {
    return this.http.put<Record<string, unknown>>(
      `${baseUrl}/api/data-access/${encodeURIComponent(table)}/record/${encodeURIComponent(primaryKey)}`,
      record,
    );
  }

  public deleteRecord(baseUrl: string, table: string, primaryKey: string): Observable<unknown> {
    return this.http.delete(
      `${baseUrl}/api/data-access/${encodeURIComponent(table)}/record/${encodeURIComponent(primaryKey)}`,
    );
  }

  public getCachedSchema(baseUrl: string, table: string): Observable<FullTableSchema> {
    const key = `${baseUrl}::${table}`;
    const entry = this.schemaCache.get(key);
    if (this.isFresh(entry)) {
      return of(entry.value);
    }
    return this.getTableSchema(baseUrl, table).pipe(
      tap((schema) => {
        this.schemaCache.set(key, { value: schema, expiresAt: Date.now() + CACHE_TTL_MS });
        this.updateCacheSize();
      }),
    );
  }

  public findChildForeignKeys(
    baseUrl: string,
    parentTable: string,
    allTableNames: readonly string[],
  ): Observable<ChildForeignKeyInfo[]> {
    return new Observable((subscriber) => {
      const results: ChildForeignKeyInfo[] = [];
      let remaining = allTableNames.length;

      if (remaining === 0) {
        subscriber.next(results);
        subscriber.complete();
        return;
      }

      for (const tableName of allTableNames) {
        if (tableName === parentTable) {
          remaining--;
          if (remaining === 0) {
            subscriber.next(results);
            subscriber.complete();
          }
          continue;
        }

        this.getCachedSchema(baseUrl, tableName).subscribe({
          next: (schema) => {
            const fks = this.extractForeignKeys(schema);
            for (const fk of fks) {
              if (fk.referencedTable === parentTable) {
                results.push({
                  childTable: tableName,
                  childColumn: fk.column,
                  parentColumn: fk.referencedColumn,
                });
              }
            }
            remaining--;
            if (remaining === 0) {
              subscriber.next(results);
              subscriber.complete();
            }
          },
          error: () => {
            remaining--;
            if (remaining === 0) {
              subscriber.next(results);
              subscriber.complete();
            }
          },
        });
      }
    });
  }

  public getRawTableSchema(baseUrl: string, table: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      `${baseUrl}/api/data-access/${encodeURIComponent(table)}/schema`,
    );
  }

  private normalizeSchema(raw: Record<string, unknown>): FullTableSchema {
    const rawColumns = (raw['columns'] ?? []) as Record<string, unknown>[];
    const rawConstraints = (raw['constraints'] ?? []) as Record<string, unknown>[];
    const rawIndexes = (raw['indexes'] ?? []) as Record<string, unknown>[];

    return {
      table_name: String(raw['table_name'] ?? ''),
      table_schema: String(raw['table_schema'] ?? ''),
      table_type: String(raw['table_type'] ?? ''),
      columns: rawColumns.map((c) => this.normalizeColumn(c)),
      constraints: rawConstraints.map((c) => this.normalizeConstraint(c)),
      indexes: rawIndexes.map((i) => this.normalizeIndex(i)),
    };
  }

  private normalizeColumn(c: Record<string, unknown>): ColumnInfo {
    return {
      column_name: String(c['column_name'] ?? ''),
      data_type: String(c['data_type'] ?? ''),
      udt_name: String(c['udt_name'] ?? ''),
      is_nullable: Boolean(c['is_nullable']),
      column_default: (c['column_default'] as string | null) ?? null,
      is_identity: Boolean(c['is_identity']),
      identity_generation: (c['identity_generation'] as string | null) ?? null,
      character_maximum_length: (c['character_maximum_length'] as number | null) ?? null,
      numeric_precision: (c['numeric_precision'] as number | null) ?? null,
      numeric_scale: (c['numeric_scale'] as number | null) ?? null,
      ordinal_position: Number(c['ordinal_position'] ?? 0),
    };
  }

  private normalizeConstraint(c: Record<string, unknown>): SchemaConstraint {
    return {
      constraint_name: String(c['constraint_name'] ?? ''),
      constraint_type: String(c['constraint_type'] ?? ''),
      columns: (c['columns'] as string[]) ?? [],
      referenced_table_schema: (c['referenced_table_schema'] as string | null) ?? null,
      referenced_table: (c['referenced_table'] as string | null) ?? null,
      referenced_columns: (c['referenced_columns'] as string[]) ?? [],
      update_rule: (c['update_rule'] as string | null) ?? null,
      delete_rule: (c['delete_rule'] as string | null) ?? null,
    };
  }

  private normalizeIndex(i: Record<string, unknown>): IndexInfo {
    return {
      index_name: String(i['index_name'] ?? ''),
      is_unique: Boolean(i['is_unique']),
      is_primary: Boolean(i['is_primary']),
      method: String(i['method'] ?? ''),
      predicate: (i['predicate'] as string | null) ?? null,
      columns: (i['columns'] as string[]) ?? [],
      definition: String(i['definition'] ?? ''),
    };
  }
}
