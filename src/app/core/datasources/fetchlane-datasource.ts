import { Injector } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  type IDatasource,
  type ISortableDatasource,
  type IFilterableDatasource,
  type IActiveDatasource,
  type RowResult,
  type RowChangedNotification,
  type RowRangeChangedNotification,
  type SortExpression,
  type FilterExpression,
  Emitter,
  SortDirection,
} from '@theredhead/foundation';
import type { FilterDescriptor, FilterRule } from '@theredhead/ui-kit';

import type { FetchPredicate, FetchSort, ForeignKeyInfo, FullTableSchema } from '../models';

export interface FetchlanePage {
  readonly rows: readonly Record<string, unknown>[];
  readonly fields: readonly { name: string }[];
}

/**
 * IDatasource implementation backed by a Fetchlane REST API.
 *
 * Supports server-side paging, sorting, and filtering through the
 * `/api/data-access/fetch` endpoint.
 */
export class FetchlaneDatasource
  implements
    IDatasource<Record<string, unknown>>,
    ISortableDatasource<Record<string, unknown>>,
    IFilterableDatasource<Record<string, unknown>>,
    IActiveDatasource<Record<string, unknown>>
{
  public readonly noteRowChanged = new Emitter<RowChangedNotification>();
  public readonly noteRowRangeChanged = new Emitter<RowRangeChangedNotification>();

  private readonly http: HttpClient;
  private static readonly MAX_CACHED_PAGES = 10;

  private readonly pageCache = new Map<number, Record<string, unknown>[]>();
  private rows: Record<string, unknown>[] = [];
  private totalCount = 0;
  private totalKnown = false;
  private pageSize = 50;
  private pageIndex = 0;
  private sortExpressions: FetchSort[] = [];
  private predicates: FetchPredicate[] = [];
  private schema: FullTableSchema | null = null;
  private foreignKeys: ForeignKeyInfo[] = [];
  private initialLoad: Promise<number> | null = null;
  private resolveInitialLoad!: (count: number) => void;
  private pendingFetch: Promise<void> | null = null;
  private pendingFetchPage = -1;
  private probingPage = -1;

  public constructor(
    private readonly baseUrl: string,
    private readonly table: string,
    injector: Injector,
  ) {
    this.http = injector.get(HttpClient);
    this.initialLoad = new Promise<number>((resolve) => {
      this.resolveInitialLoad = resolve;
    });
  }

  // -- IDatasource --

  public getNumberOfItems(): number | Promise<number> {
    if (this.initialLoad) {
      return this.initialLoad;
    }
    return this.totalCount;
  }

  public getObjectAtRowIndex(rowIndex: number): RowResult<Record<string, unknown>> {
    // Check current active page first
    const localIndex = rowIndex - this.pageIndex * this.pageSize;
    if (localIndex >= 0 && localIndex < this.rows.length) {
      return this.rows[localIndex];
    }

    // Check page cache
    const neededPage = Math.floor(rowIndex / this.pageSize);
    const cached = this.pageCache.get(neededPage);
    if (cached) {
      const idx = rowIndex - neededPage * this.pageSize;
      if (idx >= 0 && idx < cached.length) {
        this.probeAhead(neededPage);
        return cached[idx];
      }
    }

    // Cache miss — fetch the page
    return this.ensurePage(neededPage).then(() => {
      const hit = this.pageCache.get(neededPage);
      if (hit) {
        const idx = rowIndex - neededPage * this.pageSize;
        return hit[idx] ?? {};
      }
      const idx = rowIndex - this.pageIndex * this.pageSize;
      return this.rows[idx] ?? {};
    });
  }

  // -- ISortableDatasource --

  public sortBy(expression: SortExpression<Record<string, unknown>> | null): void {
    if (expression == null || expression.length === 0) {
      this.sortExpressions = [];
    } else {
      this.sortExpressions = expression.map((e) => ({
        column: String(e.columnKey),
        direction: e.direction === SortDirection.Descending ? 'DESC' : 'ASC',
      }));
    }
    void this.reload();
  }

  // -- IFilterableDatasource --

  public filterBy(expression: FilterExpression<Record<string, unknown>> | null | undefined): void {
    // FilterExpression is client-side predicates; we can't directly translate
    // those to server predicates. For server filtering, use applyFilterDescriptor().
    // If called with null, clear server predicates.
    if (expression == null) {
      this.predicates = [];
      void this.reload();
    }
  }

  /**
   * Apply a FilterDescriptor (from UIFilter) as server-side predicates
   * sent to the Fetchlane fetch endpoint.
   */
  public applyFilterDescriptor(descriptor: FilterDescriptor | null): void {
    if (descriptor == null || descriptor.rules.length === 0) {
      this.predicates = [];
    } else {
      this.predicates = descriptor.rules
        .map((rule) => this.ruleToFetchPredicate(rule))
        .filter((p): p is FetchPredicate => p != null);
    }
    this.pageIndex = 0;
    void this.reload();
  }

  // -- Public API --

  public setPredicates(predicates: FetchPredicate[]): void {
    this.predicates = predicates;
  }

  public getPageSize(): number {
    return this.pageSize;
  }

  public setPageSize(size: number): void {
    this.pageSize = size;
    void this.reload();
  }

  public getPageIndex(): number {
    return this.pageIndex;
  }

  public async goToPage(index: number): Promise<void> {
    await this.fetchPage(index);
  }

  public getRows(): readonly Record<string, unknown>[] {
    return this.rows;
  }

  public getColumnNames(): readonly string[] {
    if (this.rows.length > 0) {
      return Object.keys(this.rows[0]);
    }
    return [];
  }

  public getSchema(): FullTableSchema | null {
    return this.schema;
  }

  public getForeignKeys(): readonly ForeignKeyInfo[] {
    return this.foreignKeys;
  }

  public getPrimaryKeyColumn(): string | null {
    if (!this.schema) {
      return null;
    }
    const pk = this.schema.constraints.find(
      (c) => c.constraint_type.toUpperCase() === 'PRIMARY KEY',
    );
    if (pk && pk.columns.length > 0) {
      return pk.columns[0];
    }
    // Fallback: use the first column
    return this.schema.columns.length > 0 ? this.schema.columns[0].column_name : null;
  }

  public async loadSchema(): Promise<FullTableSchema> {
    const url = `${this.baseUrl}/api/data-access/${encodeURIComponent(this.table)}/schema`;
    this.schema = await firstValueFrom(this.http.get<FullTableSchema>(url));
    this.foreignKeys = this.extractForeignKeys(this.schema);
    return this.schema;
  }

  public applySchema(schema: FullTableSchema): void {
    this.schema = schema;
    this.foreignKeys = this.extractForeignKeys(schema);
  }

  public async reload(): Promise<void> {
    this.totalKnown = false;
    this.pageCache.clear();
    this.pendingFetch = null;
    this.pendingFetchPage = -1;
    await this.fetchPage(0);
  }

  /**
   * Replace a row in the current page and cache by matching the primary key.
   * Avoids a full reload after an edit.
   */
  public updateRow(updatedRow: Record<string, unknown>): void {
    const pkCol = this.getPrimaryKeyColumn();
    if (!pkCol) {
      return;
    }
    const pkValue = updatedRow[pkCol];
    const idx = this.rows.findIndex((r) => r[pkCol] === pkValue);
    if (idx !== -1) {
      this.rows[idx] = updatedRow;
      const cached = this.pageCache.get(this.pageIndex);
      if (cached && idx < cached.length) {
        cached[idx] = updatedRow;
      }
      this.noteRowChanged.emit({ rowIndex: this.pageIndex * this.pageSize + idx });
    }
  }

  public isTotalApproximate(): boolean {
    return !this.totalKnown;
  }

  // -- Private --

  private probeAhead(fromPage: number): void {
    if (this.totalKnown) return;
    const nextPage = fromPage + 1;
    if (this.pageCache.has(nextPage)) return;
    if (this.probingPage === nextPage) return;
    this.probingPage = nextPage;

    const body = {
      table: this.table,
      predicates: this.predicates,
      sort: this.sortExpressions,
      pagination: { size: this.pageSize, index: nextPage },
    };
    const url = `${this.baseUrl}/api/data-access/fetch`;
    firstValueFrom(this.http.post<FetchlanePage>(url, body)).then((response) => {
      const rows = [...response.rows];
      if (rows.length > 0) {
        this.cachePage(nextPage, rows);
      }
      if (rows.length < this.pageSize) {
        this.totalCount = nextPage * this.pageSize + rows.length;
        this.totalKnown = true;
      } else {
        this.totalCount = Math.max(this.totalCount, (nextPage + 1) * this.pageSize);
      }
      this.probingPage = -1;
      this.noteRowRangeChanged.emit({
        range: { start: 0, length: this.rows.length },
      });
    });
  }

  private cachePage(page: number, rows: Record<string, unknown>[]): void {
    this.pageCache.set(page, rows);
    if (this.pageCache.size > FetchlaneDatasource.MAX_CACHED_PAGES) {
      // Evict the oldest entry (first key in insertion order)
      const oldest = this.pageCache.keys().next().value!;
      this.pageCache.delete(oldest);
    }
  }

  /**
   * Return the in-flight fetch if it targets the same page,
   * otherwise start a new one.
   */
  private ensurePage(page: number): Promise<void> {
    if (this.pendingFetch && this.pendingFetchPage === page) {
      return this.pendingFetch;
    }
    const p = this.fetchPage(page);
    this.pendingFetch = p;
    this.pendingFetchPage = page;
    p.finally(() => {
      if (this.pendingFetch === p) {
        this.pendingFetch = null;
        this.pendingFetchPage = -1;
      }
    });
    return p;
  }

  private async fetchPage(page: number): Promise<void> {
    const body = {
      table: this.table,
      predicates: this.predicates,
      sort: this.sortExpressions,
      pagination: { size: this.pageSize, index: page },
    };

    const url = `${this.baseUrl}/api/data-access/fetch`;
    const response = await firstValueFrom(this.http.post<FetchlanePage>(url, body));

    this.pageIndex = page;
    this.rows = [...response.rows];
    this.cachePage(page, this.rows);

    if (this.rows.length < this.pageSize) {
      // Partial or empty page — exact total is known.
      this.totalCount = page * this.pageSize + this.rows.length;
      this.totalKnown = true;
    } else if (!this.totalKnown) {
      // Full page and total still unknown — probe the next page to refine.
      const probeBody = {
        table: this.table,
        predicates: this.predicates,
        sort: this.sortExpressions,
        pagination: { size: this.pageSize, index: page + 1 },
      };
      const probe = await firstValueFrom(this.http.post<FetchlanePage>(url, probeBody));

      if (probe.rows.length > 0) {
        this.cachePage(page + 1, [...probe.rows]);
      }

      if (probe.rows.length < this.pageSize) {
        // Probe returned partial or empty — exact total known.
        this.totalCount = (page + 1) * this.pageSize + probe.rows.length;
        this.totalKnown = true;
      } else {
        // Probe also full — more data exists beyond.
        this.totalCount = (page + 2) * this.pageSize;
      }
    }

    if (this.initialLoad) {
      this.resolveInitialLoad(this.totalCount);
      this.initialLoad = null;
    }

    this.noteRowRangeChanged.emit({
      range: { start: 0, length: this.rows.length },
    });
  }

  private ruleToFetchPredicate(rule: FilterRule): FetchPredicate | null {
    const col = rule.field;
    if (!col || col === '__any__') {
      return null;
    }

    const val = rule.value;
    switch (rule.operator) {
      case 'contains':
        return { text: `${col} ILIKE :value`, args: { value: `%${val}%` } };
      case 'notContains':
        return { text: `${col} NOT ILIKE :value`, args: { value: `%${val}%` } };
      case 'equals':
        return { text: `${col} = :value`, args: { value: val } };
      case 'notEquals':
        return { text: `${col} != :value`, args: { value: val } };
      case 'startsWith':
        return { text: `${col} ILIKE :value`, args: { value: `${val}%` } };
      case 'endsWith':
        return { text: `${col} ILIKE :value`, args: { value: `%${val}` } };
      case 'greaterThan':
        return { text: `${col} > :value`, args: { value: val } };
      case 'greaterThanOrEqual':
        return { text: `${col} >= :value`, args: { value: val } };
      case 'lessThan':
        return { text: `${col} < :value`, args: { value: val } };
      case 'lessThanOrEqual':
        return { text: `${col} <= :value`, args: { value: val } };
      case 'before':
        return { text: `${col} < :value`, args: { value: val } };
      case 'after':
        return { text: `${col} > :value`, args: { value: val } };
      case 'between':
        return {
          text: `${col} BETWEEN :lo AND :hi`,
          args: { lo: val, hi: rule.valueTo ?? val },
        };
      case 'isEmpty':
        return { text: `${col} IS NULL`, args: {} };
      case 'isNotEmpty':
        return { text: `${col} IS NOT NULL`, args: {} };
      default:
        return null;
    }
  }

  private extractForeignKeys(schema: FullTableSchema): ForeignKeyInfo[] {
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
}
