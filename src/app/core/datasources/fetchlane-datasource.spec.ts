import '../../../test-setup';
import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { LoggerFactory, SortDirection } from '@theredhead/foundation';
import { ToastService, type FilterDescriptor } from '@theredhead/ui-kit';

import { FetchlaneDatasource, type FetchlanePage } from './fetchlane-datasource';
import type { FullTableSchema } from '../models';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAlbumSchema(): FullTableSchema {
  return {
    table_name: 'album',
    table_schema: 'public',
    table_type: 'BASE TABLE',
    columns: [
      {
        column_name: 'album_id',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: false,
        column_default: null,
        is_identity: false,
        identity_generation: null,
        character_maximum_length: null,
        numeric_precision: 32,
        numeric_scale: 0,
        ordinal_position: 1,
      },
      {
        column_name: 'title',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: false,
        column_default: null,
        is_identity: false,
        identity_generation: null,
        character_maximum_length: 160,
        numeric_precision: null,
        numeric_scale: null,
        ordinal_position: 2,
      },
      {
        column_name: 'artist_id',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: false,
        column_default: null,
        is_identity: false,
        identity_generation: null,
        character_maximum_length: null,
        numeric_precision: 32,
        numeric_scale: 0,
        ordinal_position: 3,
      },
    ],
    constraints: [
      {
        constraint_name: 'album_pkey',
        constraint_type: 'PRIMARY KEY',
        columns: ['album_id'],
        referenced_table_schema: null,
        referenced_table: null,
        referenced_columns: [],
        update_rule: null,
        delete_rule: null,
      },
      {
        constraint_name: 'album_artist_id_fkey',
        constraint_type: 'FOREIGN KEY',
        columns: ['artist_id'],
        referenced_table_schema: 'public',
        referenced_table: 'artist',
        referenced_columns: ['artist_id'],
        update_rule: 'NO ACTION',
        delete_rule: 'NO ACTION',
      },
    ],
    indexes: [],
  };
}

/** Shorthand for building a page response. */
function makePage(rows: Record<string, unknown>[]): FetchlanePage {
  const fields = rows.length > 0 ? Object.keys(rows[0]).map((name) => ({ name })) : [];
  return { rows, fields };
}

/** Access private internals for test setup / assertion. */
type DsInternals = {
  rows: Record<string, unknown>[];
  pageCache: Map<number, Record<string, unknown>[]>;
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  totalKnown: boolean;
  initialLoad: Promise<number> | null;
  resolveInitialLoad: (count: number) => void;
  sortExpressions: { column: string; direction: string }[];
  predicates: { text: string; args: unknown }[];
  pendingFetch: Promise<void> | null;
  pendingFetchPage: number;
  schema: FullTableSchema | null;
};

function internals(ds: FetchlaneDatasource): DsInternals {
  return ds as unknown as DsInternals;
}

let mockHttp: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
let mockToast: { error: ReturnType<typeof vi.fn> };

function createDatasource(
  engine: 'postgres' | 'mysql' | 'mssql' = 'postgres',
): FetchlaneDatasource {
  const injector = TestBed.inject(Injector);
  const ds = new FetchlaneDatasource('http://localhost:3001', 'album', engine, injector);
  ds.applySchema(makeAlbumSchema());
  return ds;
}

function seedRows(ds: FetchlaneDatasource, rows: Record<string, unknown>[], page = 0): void {
  const i = internals(ds);
  i.rows = [...rows];
  i.pageCache.set(page, [...rows]);
  i.pageIndex = page;
  i.totalCount = rows.length + page * i.pageSize;
  i.totalKnown = true;
  i.initialLoad = null;
}

// ── Setup ────────────────────────────────────────────────────────────

describe('FetchlaneDatasource', () => {
  beforeEach(() => {
    mockHttp = { get: vi.fn(), post: vi.fn() };
    mockToast = { error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: mockHttp },
        { provide: ToastService, useValue: mockToast },
      ],
    });
  });

  // ── getPrimaryKeyColumn ────────────────────────────────────────────

  describe('getPrimaryKeyColumn', () => {
    it('should return PK column from schema constraints', () => {
      const ds = createDatasource();
      expect(ds.getPrimaryKeyColumn()).toBe('album_id');
    });

    it('should return null when no schema is applied', () => {
      const injector = TestBed.inject(Injector);
      const ds = new FetchlaneDatasource('http://localhost:3001', 'album', 'postgres', injector);
      expect(ds.getPrimaryKeyColumn()).toBeNull();
    });

    it('should fall back to first column when no PK constraint exists', () => {
      const ds = createDatasource();
      const schema = makeAlbumSchema();
      ds.applySchema({
        ...schema,
        constraints: [],
      });
      expect(ds.getPrimaryKeyColumn()).toBe('album_id');
    });

    it('should return null when schema has no columns and no PK', () => {
      const ds = createDatasource();
      ds.applySchema({
        ...makeAlbumSchema(),
        columns: [],
        constraints: [],
      });
      expect(ds.getPrimaryKeyColumn()).toBeNull();
    });
  });

  // ── applySchema / getSchema / getForeignKeys ───────────────────────

  describe('applySchema / getSchema / getForeignKeys', () => {
    it('should store and return the schema', () => {
      const ds = createDatasource();
      expect(ds.getSchema()).toEqual(makeAlbumSchema());
    });

    it('should return null schema before applySchema', () => {
      const injector = TestBed.inject(Injector);
      const ds = new FetchlaneDatasource('http://localhost:3001', 'album', 'postgres', injector);
      expect(ds.getSchema()).toBeNull();
    });

    it('should extract foreign keys from schema', () => {
      const ds = createDatasource();
      const fks = ds.getForeignKeys();
      expect(fks).toEqual([
        {
          constraintName: 'album_artist_id_fkey',
          column: 'artist_id',
          referencedTable: 'artist',
          referencedColumn: 'artist_id',
        },
      ]);
    });

    it('should return empty FK list when schema has no FK constraints', () => {
      const ds = createDatasource();
      ds.applySchema({ ...makeAlbumSchema(), constraints: [] });
      expect(ds.getForeignKeys()).toEqual([]);
    });

    it('should infer FK column from constraint name when columns array is empty', () => {
      const ds = createDatasource();
      ds.applySchema({
        ...makeAlbumSchema(),
        constraints: [
          {
            constraint_name: 'album_genre_id_fkey',
            constraint_type: 'FOREIGN KEY',
            columns: [],
            referenced_table_schema: 'public',
            referenced_table: 'genre',
            referenced_columns: ['genre_id'],
            update_rule: null,
            delete_rule: null,
          },
        ],
      });
      const fks = ds.getForeignKeys();
      expect(fks).toEqual([
        {
          constraintName: 'album_genre_id_fkey',
          column: 'genre_id',
          referencedTable: 'genre',
          referencedColumn: 'genre_id',
        },
      ]);
    });

    it('should use column as referencedColumn fallback when referenced_columns is empty', () => {
      const ds = createDatasource();
      ds.applySchema({
        ...makeAlbumSchema(),
        constraints: [
          {
            constraint_name: 'album_artist_id_fkey',
            constraint_type: 'FOREIGN KEY',
            columns: ['artist_id'],
            referenced_table_schema: 'public',
            referenced_table: 'artist',
            referenced_columns: [],
            update_rule: null,
            delete_rule: null,
          },
        ],
      });
      expect(ds.getForeignKeys()[0].referencedColumn).toBe('artist_id');
    });

    it('should skip FK constraints with no referenced_table', () => {
      const ds = createDatasource();
      ds.applySchema({
        ...makeAlbumSchema(),
        constraints: [
          {
            constraint_name: 'album_orphan_fkey',
            constraint_type: 'FOREIGN KEY',
            columns: ['orphan_id'],
            referenced_table_schema: null,
            referenced_table: null,
            referenced_columns: [],
            update_rule: null,
            delete_rule: null,
          },
        ],
      });
      expect(ds.getForeignKeys()).toEqual([]);
    });

    it('should filter out FK with empty inferred column name', () => {
      const ds = createDatasource();
      ds.applySchema({
        ...makeAlbumSchema(),
        constraints: [
          {
            constraint_name: 'weird_constraint',
            constraint_type: 'FOREIGN KEY',
            columns: [],
            referenced_table_schema: 'public',
            referenced_table: 'genre',
            referenced_columns: ['id'],
            update_rule: null,
            delete_rule: null,
          },
        ],
      });
      // 'weird_constraint' doesn't match the pattern `tableName_column_fkey`
      expect(ds.getForeignKeys()).toEqual([]);
    });
  });

  // ── loadSchema ─────────────────────────────────────────────────────

  describe('loadSchema', () => {
    it('should fetch schema from API and apply it', async () => {
      const schema = makeAlbumSchema();
      mockHttp.get.mockReturnValue(of(schema));

      const injector = TestBed.inject(Injector);
      const ds = new FetchlaneDatasource('http://localhost:3001', 'album', 'postgres', injector);

      const result = await ds.loadSchema();

      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://localhost:3001/api/data-access/album/schema',
      );
      expect(result).toEqual(schema);
      expect(ds.getSchema()).toEqual(schema);
      expect(ds.getForeignKeys().length).toBe(1);
    });

    it('should encode table names with special characters', async () => {
      const schema = makeAlbumSchema();
      mockHttp.get.mockReturnValue(of(schema));

      const injector = TestBed.inject(Injector);
      const ds = new FetchlaneDatasource('http://localhost:3001', 'my table', 'postgres', injector);

      await ds.loadSchema();

      expect(mockHttp.get).toHaveBeenCalledWith(
        'http://localhost:3001/api/data-access/my%20table/schema',
      );
    });
  });

  // ── updateRow ──────────────────────────────────────────────────────

  describe('updateRow', () => {
    it('should update a row by PK match', () => {
      const ds = createDatasource();
      seedRows(ds, [
        { album_id: 1, title: 'Old Title', artist_id: 1 },
        { album_id: 2, title: 'Other', artist_id: 2 },
      ]);

      ds.updateRow({ album_id: 1, title: 'New Title' });

      const row = ds.getObjectAtRowIndex(0) as Record<string, unknown>;
      expect(row['title']).toBe('New Title');
      expect(row['artist_id']).toBe(1); // preserved from original
    });

    it('should merge updated fields and preserve existing ones', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 5, title: 'Original', artist_id: 10, extra: 'kept' }]);

      ds.updateRow({ album_id: 5, title: 'Updated' });

      const row = ds.getObjectAtRowIndex(0) as Record<string, unknown>;
      expect(row).toEqual({
        album_id: 5,
        title: 'Updated',
        artist_id: 10,
        extra: 'kept',
      });
    });

    it('should match PK with loose equality (string vs number)', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 42, title: 'Before', artist_id: 1 }]);

      // API returns string PK
      ds.updateRow({ album_id: '42', title: 'After' });

      const row = ds.getObjectAtRowIndex(0) as Record<string, unknown>;
      expect(row['title']).toBe('After');
    });

    it('should match PK with loose equality (number vs string)', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: '99', title: 'Before', artist_id: 1 }]);

      ds.updateRow({ album_id: 99, title: 'After' });

      const row = ds.getObjectAtRowIndex(0) as Record<string, unknown>;
      expect(row['title']).toBe('After');
    });

    it('should emit noteRowChanged with correct absolute row index', () => {
      const ds = createDatasource();
      seedRows(ds, [
        { album_id: 1, title: 'A', artist_id: 1 },
        { album_id: 2, title: 'B', artist_id: 2 },
      ]);

      const emitted: number[] = [];
      ds.noteRowChanged.subscribe((n) => emitted.push(n.rowIndex));

      ds.updateRow({ album_id: 2, title: 'BB' });

      expect(emitted).toEqual([1]);
    });

    it('should not emit when PK does not match any row', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      const emitted: number[] = [];
      ds.noteRowChanged.subscribe((n) => emitted.push(n.rowIndex));

      ds.updateRow({ album_id: 999, title: 'Missing' });

      expect(emitted).toEqual([]);
    });

    it('should not emit when updated row is missing PK column', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      const emitted: number[] = [];
      ds.noteRowChanged.subscribe((n) => emitted.push(n.rowIndex));

      ds.updateRow({ title: 'No PK' });

      expect(emitted).toEqual([]);
    });

    it('should do nothing when no schema is applied', () => {
      const injector = TestBed.inject(Injector);
      const ds = new FetchlaneDatasource('http://localhost:3001', 'album', 'postgres', injector);

      const emitted: number[] = [];
      ds.noteRowChanged.subscribe((n) => emitted.push(n.rowIndex));

      ds.updateRow({ album_id: 1, title: 'X' });

      expect(emitted).toEqual([]);
    });

    it('should update the page cache as well', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'Cached', artist_id: 1 }]);

      ds.updateRow({ album_id: 1, title: 'Cache Updated' });

      const cached = internals(ds).pageCache.get(0);
      expect(cached?.[0]?.['title']).toBe('Cache Updated');
    });
  });

  // ── getNumberOfItems ───────────────────────────────────────────────

  describe('getNumberOfItems', () => {
    it('should return a promise before initial load', () => {
      const ds = createDatasource();
      const result = ds.getNumberOfItems();
      expect(result).toBeInstanceOf(Promise);
    });

    it('should return count after rows are seeded', () => {
      const ds = createDatasource();
      seedRows(ds, [
        { album_id: 1, title: 'A', artist_id: 1 },
        { album_id: 2, title: 'B', artist_id: 2 },
      ]);

      expect(ds.getNumberOfItems()).toBe(2);
    });
  });

  // ── getObjectAtRowIndex ────────────────────────────────────────────

  describe('getObjectAtRowIndex', () => {
    it('should return row by absolute index from active page', () => {
      const ds = createDatasource();
      seedRows(ds, [
        { album_id: 1, title: 'First', artist_id: 1 },
        { album_id: 2, title: 'Second', artist_id: 2 },
      ]);

      const row = ds.getObjectAtRowIndex(1) as Record<string, unknown>;
      expect(row['title']).toBe('Second');
    });

    it('should return row from page cache when not on active page', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'Page0', artist_id: 1 }]);

      // Manually cache page 1
      const i = internals(ds);
      i.pageSize = 1;
      i.pageCache.set(1, [{ album_id: 2, title: 'Page1', artist_id: 2 }]);

      const row = ds.getObjectAtRowIndex(1) as Record<string, unknown>;
      expect(row['title']).toBe('Page1');
    });

    it('should return a promise for a cache-miss row', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'Only', artist_id: 1 }]);

      // Request row far beyond active page — triggers fetchPage
      mockHttp.post.mockReturnValue(
        of(makePage([{ album_id: 100, title: 'Fetched', artist_id: 1 }])),
      );

      const result = ds.getObjectAtRowIndex(500);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  // ── getColumnNames ─────────────────────────────────────────────────

  describe('getColumnNames', () => {
    it('should return column names from the first row', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'Test', artist_id: 1 }]);

      expect(ds.getColumnNames()).toEqual(['album_id', 'title', 'artist_id']);
    });

    it('should return empty array when no rows are loaded', () => {
      const ds = createDatasource();
      seedRows(ds, []);

      expect(ds.getColumnNames()).toEqual([]);
    });
  });

  // ── getPageSize / setPageSize / getPageIndex ───────────────────────

  describe('page size and index', () => {
    it('should default pageSize to 50', () => {
      const ds = createDatasource();
      expect(ds.getPageSize()).toBe(50);
    });

    it('should update pageSize and trigger reload', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])));

      ds.setPageSize(25);
      expect(ds.getPageSize()).toBe(25);
    });

    it('should return current page index', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      expect(ds.getPageIndex()).toBe(0);
    });
  });

  // ── isTotalApproximate ─────────────────────────────────────────────

  describe('isTotalApproximate', () => {
    it('should return true before total is known', () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.totalKnown = false;

      expect(ds.isTotalApproximate()).toBe(true);
    });

    it('should return false after total is known', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      expect(ds.isTotalApproximate()).toBe(false);
    });
  });

  // ── sortBy ─────────────────────────────────────────────────────────

  describe('sortBy', () => {
    it('should set ascending sort expression and reload', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])));

      ds.sortBy([{ columnKey: 'title', direction: SortDirection.Ascending }]);

      expect(internals(ds).sortExpressions).toEqual([{ column: 'title', direction: 'ASC' }]);
    });

    it('should set descending sort expression', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])));

      ds.sortBy([{ columnKey: 'album_id', direction: SortDirection.Descending }]);

      expect(internals(ds).sortExpressions).toEqual([{ column: 'album_id', direction: 'DESC' }]);
    });

    it('should support multi-column sort', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])));

      ds.sortBy([
        { columnKey: 'artist_id', direction: SortDirection.Ascending },
        { columnKey: 'title', direction: SortDirection.Descending },
      ]);

      expect(internals(ds).sortExpressions).toEqual([
        { column: 'artist_id', direction: 'ASC' },
        { column: 'title', direction: 'DESC' },
      ]);
    });

    it('should clear sort when called with null', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])));

      ds.sortBy([{ columnKey: 'title', direction: SortDirection.Ascending }]);
      ds.sortBy(null);

      expect(internals(ds).sortExpressions).toEqual([]);
    });

    it('should clear sort when called with empty array', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])));

      ds.sortBy([{ columnKey: 'title', direction: SortDirection.Ascending }]);
      ds.sortBy([]);

      expect(internals(ds).sortExpressions).toEqual([]);
    });
  });

  // ── filterBy ───────────────────────────────────────────────────────

  describe('filterBy', () => {
    it('should clear predicates when called with null', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])));

      ds.setPredicates([{ text: 'title = :v', args: { v: 'X' } }]);
      ds.filterBy(null);

      expect(internals(ds).predicates).toEqual([]);
    });

    it('should not clear predicates when called with a non-null expression', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.setPredicates([{ text: 'title = :v', args: { v: 'X' } }]);
      ds.filterBy([]);

      // Non-null, so predicates are NOT cleared
      expect(internals(ds).predicates.length).toBe(1);
    });
  });

  // ── applyFilterDescriptor ──────────────────────────────────────────

  describe('applyFilterDescriptor', () => {
    function makeDescriptor(
      rules: { field: string; operator: string; value: string; valueTo?: string }[],
    ): FilterDescriptor {
      return {
        junction: 'and',
        rules: rules.map((r, i) => ({ id: i + 1, ...r })),
      } as FilterDescriptor;
    }

    beforeEach(() => {
      mockHttp.post.mockReturnValue(of(makePage([])));
    });

    it('should clear predicates when called with null', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.setPredicates([{ text: 'x', args: {} }]);
      ds.applyFilterDescriptor(null);

      expect(internals(ds).predicates).toEqual([]);
    });

    it('should clear predicates when descriptor has no rules', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.setPredicates([{ text: 'x', args: {} }]);
      ds.applyFilterDescriptor({ junction: 'and', rules: [] } as FilterDescriptor);

      expect(internals(ds).predicates).toEqual([]);
    });

    it('should reset page index to 0', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);
      internals(ds).pageIndex = 5;

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'contains', value: 'x' }]),
      );

      expect(internals(ds).pageIndex).toBe(0);
    });

    // ── Operator tests ─────────────────────────────────────────────

    it('should translate "contains" to ILIKE for postgres', () => {
      const ds = createDatasource('postgres');
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'contains', value: 'rock' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.text).toBe('title ILIKE :value');
      expect(pred.args['value']).toBe('%rock%');
    });

    it('should translate "contains" to LOWER()/LIKE for mysql', () => {
      const ds = createDatasource('mysql');
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'contains', value: 'rock' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.text).toBe('LOWER(title) LIKE LOWER(:value)');
      expect(pred.args['value']).toBe('%rock%');
    });

    it('should translate "contains" to LOWER()/LIKE for mssql', () => {
      const ds = createDatasource('mssql');
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'contains', value: 'rock' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.text).toBe('LOWER(title) LIKE LOWER(:value)');
    });

    it('should translate "notContains" to NOT ILIKE for postgres', () => {
      const ds = createDatasource('postgres');
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'notContains', value: 'jazz' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string };
      expect(pred.text).toBe('title NOT ILIKE :value');
    });

    it('should translate "equals"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'equals', value: 'X' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.text).toBe('title = :value');
      expect(pred.args['value']).toBe('X');
    });

    it('should translate "notEquals"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'notEquals', value: 'Y' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('title != :value');
    });

    it('should translate "startsWith"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'startsWith', value: 'Ro' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.args['value']).toBe('Ro%');
    });

    it('should translate "endsWith"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'endsWith', value: 'ck' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.args['value']).toBe('%ck');
    });

    it('should translate "greaterThan"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'album_id', operator: 'greaterThan', value: '10' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('album_id > :value');
    });

    it('should translate "greaterThanOrEqual"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'album_id', operator: 'greaterThanOrEqual', value: '5' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('album_id >= :value');
    });

    it('should translate "lessThan"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'album_id', operator: 'lessThan', value: '100' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('album_id < :value');
    });

    it('should translate "lessThanOrEqual"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'album_id', operator: 'lessThanOrEqual', value: '50' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('album_id <= :value');
    });

    it('should translate "before" (date)', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'created_at', operator: 'before', value: '2025-01-01' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('created_at < :value');
    });

    it('should translate "after" (date)', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'created_at', operator: 'after', value: '2025-01-01' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('created_at > :value');
    });

    it('should translate "between"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'album_id', operator: 'between', value: '1', valueTo: '100' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.text).toBe('album_id BETWEEN :lo AND :hi');
      expect(pred.args['lo']).toBe('1');
      expect(pred.args['hi']).toBe('100');
    });

    it('should use value as hi fallback when valueTo is missing in "between"', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'album_id', operator: 'between', value: '42' }]),
      );

      const pred = internals(ds).predicates[0] as { text: string; args: Record<string, unknown> };
      expect(pred.args['hi']).toBe('42');
    });

    it('should translate "isEmpty" to IS NULL', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'isEmpty', value: '' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('title IS NULL');
    });

    it('should translate "isNotEmpty" to IS NOT NULL', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'isNotEmpty', value: '' }]),
      );

      expect((internals(ds).predicates[0] as { text: string }).text).toBe('title IS NOT NULL');
    });

    it('should skip rules with unknown operators', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([{ field: 'title', operator: 'unknownOp' as never, value: 'x' }]),
      );

      expect(internals(ds).predicates).toEqual([]);
    });

    it('should skip rules with empty field', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(makeDescriptor([{ field: '', operator: 'equals', value: 'x' }]));

      expect(internals(ds).predicates).toEqual([]);
    });

    it('should handle multiple rules', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor(
        makeDescriptor([
          { field: 'title', operator: 'contains', value: 'rock' },
          { field: 'album_id', operator: 'greaterThan', value: '10' },
        ]),
      );

      expect(internals(ds).predicates.length).toBe(2);
    });
  });

  // ── __any__ field filter ───────────────────────────────────────────

  describe('__any__ field filter', () => {
    beforeEach(() => {
      mockHttp.post.mockReturnValue(of(makePage([])));
    });

    it('should build OR predicate across string columns', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor({
        junction: 'and',
        rules: [{ id: 1, field: '__any__', operator: 'contains', value: 'test' }],
      } as FilterDescriptor);

      const pred = internals(ds).predicates[0] as { text: string };
      // 'title' is the only string column in album schema
      expect(pred.text).toContain('title');
      expect(pred.text).toContain('ILIKE');
    });

    it('should skip __any__ when schema has no string columns', () => {
      const ds = createDatasource();
      ds.applySchema({
        ...makeAlbumSchema(),
        columns: [
          {
            column_name: 'id',
            data_type: 'integer',
            udt_name: 'int4',
            is_nullable: false,
            column_default: null,
            is_identity: false,
            identity_generation: null,
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0,
            ordinal_position: 1,
          },
        ],
      });
      seedRows(ds, [{ id: 1 }]);

      ds.applyFilterDescriptor({
        junction: 'and',
        rules: [{ id: 1, field: '__any__', operator: 'contains', value: 'test' }],
      } as FilterDescriptor);

      expect(internals(ds).predicates).toEqual([]);
    });

    it('should skip __any__ when value is empty', () => {
      const ds = createDatasource();
      seedRows(ds, [{ album_id: 1, title: 'A', artist_id: 1 }]);

      ds.applyFilterDescriptor({
        junction: 'and',
        rules: [{ id: 1, field: '__any__', operator: 'contains', value: '' }],
      } as FilterDescriptor);

      expect(internals(ds).predicates).toEqual([]);
    });

    it('should skip __any__ when no schema is applied', () => {
      const injector = TestBed.inject(Injector);
      const ds = new FetchlaneDatasource('http://localhost:3001', 'album', 'postgres', injector);
      const i = internals(ds);
      i.initialLoad = null;

      ds.applyFilterDescriptor({
        junction: 'and',
        rules: [{ id: 1, field: '__any__', operator: 'contains', value: 'test' }],
      } as FilterDescriptor);

      expect(i.predicates).toEqual([]);
    });

    it('should include multiple string column types', () => {
      const ds = createDatasource();
      ds.applySchema({
        ...makeAlbumSchema(),
        columns: [
          {
            column_name: 'name',
            data_type: 'text',
            udt_name: 'text',
            is_nullable: false,
            column_default: null,
            is_identity: false,
            identity_generation: null,
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
            ordinal_position: 1,
          },
          {
            column_name: 'code',
            data_type: 'nvarchar',
            udt_name: 'nvarchar',
            is_nullable: false,
            column_default: null,
            is_identity: false,
            identity_generation: null,
            character_maximum_length: 50,
            numeric_precision: null,
            numeric_scale: null,
            ordinal_position: 2,
          },
          {
            column_name: 'count',
            data_type: 'integer',
            udt_name: 'int4',
            is_nullable: false,
            column_default: null,
            is_identity: false,
            identity_generation: null,
            character_maximum_length: null,
            numeric_precision: 32,
            numeric_scale: 0,
            ordinal_position: 3,
          },
        ],
      });
      seedRows(ds, [{ name: 'A', code: 'B', count: 1 }]);

      ds.applyFilterDescriptor({
        junction: 'and',
        rules: [{ id: 1, field: '__any__', operator: 'contains', value: 'x' }],
      } as FilterDescriptor);

      const pred = internals(ds).predicates[0] as { text: string };
      expect(pred.text).toContain('name');
      expect(pred.text).toContain('code');
      expect(pred.text).not.toContain('count');
      expect(pred.text).toContain(' OR ');
    });
  });

  // ── fetchPage / reload / goToPage ──────────────────────────────────

  describe('fetchPage / reload / goToPage', () => {
    it('should POST to /api/data-access/fetch with correct body', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'R', artist_id: 1 }])));

      await ds.goToPage(0);

      expect(mockHttp.post).toHaveBeenCalledWith(
        'http://localhost:3001/api/data-access/fetch',
        expect.objectContaining({
          table: 'album',
          predicates: [],
          sort: [],
          pagination: { size: 50, index: 0 },
        }),
      );
    });

    it('should include sort and predicates in fetch body', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.sortExpressions = [{ column: 'title', direction: 'ASC' }];
      i.predicates = [{ text: 'title ILIKE :v', args: { v: '%x%' } }];
      mockHttp.post.mockReturnValue(of(makePage([])));

      await ds.goToPage(0);

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          sort: [{ column: 'title', direction: 'ASC' }],
          predicates: [{ text: 'title ILIKE :v', args: { v: '%x%' } }],
        }),
      );
    });

    it('should update rows and emit noteRowRangeChanged after fetch', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;

      const emitted: unknown[] = [];
      ds.noteRowRangeChanged.subscribe((n) => emitted.push(n));

      mockHttp.post.mockReturnValue(
        of(makePage([{ album_id: 1, title: 'Fetched', artist_id: 1 }])),
      );

      await ds.goToPage(0);

      expect(ds.getRows()).toEqual([{ album_id: 1, title: 'Fetched', artist_id: 1 }]);
      expect(emitted.length).toBeGreaterThan(0);
    });

    it('should resolve initialLoad on first fetch', async () => {
      const ds = createDatasource();
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'X', artist_id: 1 }])));

      const countPromise = ds.getNumberOfItems() as Promise<number>;
      await ds.goToPage(0);
      const count = await countPromise;

      expect(typeof count).toBe('number');
    });

    it('should set totalKnown when page is partial', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.pageSize = 50;

      // Return fewer rows than pageSize
      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'Only', artist_id: 1 }])));

      await ds.goToPage(0);

      expect(i.totalKnown).toBe(true);
      expect(i.totalCount).toBe(1);
    });

    it('should probe next page when current page is full', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.pageSize = 2;

      // First call: full page; second call: probe with partial result
      mockHttp.post
        .mockReturnValueOnce(
          of(
            makePage([
              { album_id: 1, title: 'A', artist_id: 1 },
              { album_id: 2, title: 'B', artist_id: 2 },
            ]),
          ),
        )
        .mockReturnValueOnce(of(makePage([{ album_id: 3, title: 'C', artist_id: 3 }])));

      await ds.goToPage(0);

      // Should have made 2 POST calls (page + probe)
      expect(mockHttp.post).toHaveBeenCalledTimes(2);
      expect(i.totalKnown).toBe(true);
      expect(i.totalCount).toBe(3); // 2 on page 0 + 1 on probe
    });

    it('should handle full probe (more pages beyond)', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.pageSize = 2;

      // Both page and probe return full pages
      mockHttp.post
        .mockReturnValueOnce(
          of(
            makePage([
              { album_id: 1, title: 'A', artist_id: 1 },
              { album_id: 2, title: 'B', artist_id: 2 },
            ]),
          ),
        )
        .mockReturnValueOnce(
          of(
            makePage([
              { album_id: 3, title: 'C', artist_id: 3 },
              { album_id: 4, title: 'D', artist_id: 4 },
            ]),
          ),
        );

      await ds.goToPage(0);

      expect(i.totalKnown).toBe(false);
      expect(i.totalCount).toBe(4); // (page + 2) * pageSize
    });

    it('should cache the probed page', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.pageSize = 1;

      mockHttp.post
        .mockReturnValueOnce(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])))
        .mockReturnValueOnce(of(makePage([{ album_id: 2, title: 'B', artist_id: 2 }])));

      await ds.goToPage(0);

      expect(i.pageCache.has(1)).toBe(true);
      expect(i.pageCache.get(1)?.[0]?.['title']).toBe('B');
    });

    it('should handle fetch error gracefully', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;

      mockHttp.post.mockReturnValue(throwError(() => ({ error: { message: 'Server error' } })));

      await ds.goToPage(0);

      expect(mockToast.error).toHaveBeenCalledWith('Server error');
    });

    it('should use fallback message when error has no message', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;

      mockHttp.post.mockReturnValue(throwError(() => ({})));

      await ds.goToPage(0);

      expect(mockToast.error).toHaveBeenCalledWith('Failed to fetch data');
    });

    it('should resolve initialLoad even on error', async () => {
      const ds = createDatasource();

      mockHttp.post.mockReturnValue(throwError(() => ({})));

      const countPromise = ds.getNumberOfItems() as Promise<number>;
      await ds.goToPage(0);

      const count = await countPromise;
      expect(typeof count).toBe('number');
    });

    it('should not probe when total is already known', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.totalKnown = true;
      i.totalCount = 100;
      i.pageSize = 2;

      mockHttp.post.mockReturnValue(
        of(
          makePage([
            { album_id: 1, title: 'A', artist_id: 1 },
            { album_id: 2, title: 'B', artist_id: 2 },
          ]),
        ),
      );

      await ds.goToPage(0);

      // Only 1 call — no probe
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });

    it('should handle probe failure gracefully', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.pageSize = 1;

      mockHttp.post
        .mockReturnValueOnce(of(makePage([{ album_id: 1, title: 'A', artist_id: 1 }])))
        .mockReturnValueOnce(throwError(() => new Error('probe failed')));

      // Should not throw
      await ds.goToPage(0);

      expect(i.totalKnown).toBe(false);
    });
  });

  // ── reload ─────────────────────────────────────────────────────────

  describe('reload', () => {
    it('should clear cache and reset to page 0', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.pageCache.set(0, [{ album_id: 1, title: 'Old', artist_id: 1 }]);
      i.pageCache.set(1, [{ album_id: 2, title: 'Old2', artist_id: 2 }]);
      i.totalKnown = true;

      mockHttp.post.mockReturnValue(of(makePage([{ album_id: 1, title: 'Fresh', artist_id: 1 }])));

      await ds.reload();

      expect(i.totalKnown).toBe(true); // re-probed
      expect(ds.getRows()[0]?.['title']).toBe('Fresh');
    });
  });

  // ── page cache eviction ────────────────────────────────────────────

  describe('page cache eviction', () => {
    it('should evict oldest page when cache exceeds MAX_CACHED_PAGES', async () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.totalKnown = true;
      i.totalCount = 1000;
      i.pageSize = 1;

      mockHttp.post.mockImplementation((_url: string, body: { pagination: { index: number } }) =>
        of(
          makePage([
            { album_id: body.pagination.index, title: `P${body.pagination.index}`, artist_id: 1 },
          ]),
        ),
      );

      // Fill beyond max (10 pages)
      for (let p = 0; p < 12; p++) {
        await ds.goToPage(p);
      }

      // Oldest pages should have been evicted
      expect(i.pageCache.size).toBeLessThanOrEqual(10);
      expect(i.pageCache.has(0)).toBe(false);
      expect(i.pageCache.has(1)).toBe(false);
      expect(i.pageCache.has(11)).toBe(true);
    });
  });

  // ── ensurePage deduplication ───────────────────────────────────────

  describe('ensurePage deduplication', () => {
    it('should not start a second fetch for the same page', () => {
      const ds = createDatasource();
      const i = internals(ds);
      i.initialLoad = null;
      i.pageSize = 1;

      // Never-resolving observable to keep the fetch pending
      mockHttp.post.mockReturnValue(new (require('rxjs').Observable)(() => {}));

      // First cache miss triggers fetch
      ds.getObjectAtRowIndex(5);
      ds.getObjectAtRowIndex(5);

      // Only one POST call despite two requests for the same page
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });
  });

  // ── setPredicates ──────────────────────────────────────────────────

  describe('setPredicates', () => {
    it('should store predicates directly', () => {
      const ds = createDatasource();

      ds.setPredicates([
        { text: 'title = :v', args: { v: 'X' } },
        { text: 'id > :min', args: { min: 5 } },
      ]);

      expect(internals(ds).predicates.length).toBe(2);
    });
  });

  // ── getRows ────────────────────────────────────────────────────────

  describe('getRows', () => {
    it('should return current page rows', () => {
      const ds = createDatasource();
      const rows = [
        { album_id: 1, title: 'A', artist_id: 1 },
        { album_id: 2, title: 'B', artist_id: 2 },
      ];
      seedRows(ds, rows);

      expect(ds.getRows()).toEqual(rows);
    });

    it('should return empty array when no rows loaded', () => {
      const ds = createDatasource();
      seedRows(ds, []);

      expect(ds.getRows()).toEqual([]);
    });
  });
});
