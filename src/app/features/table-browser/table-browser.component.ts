import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subject, debounceTime } from 'rxjs';
import {
  UITableView,
  UITextColumn,
  UITemplateColumn,
  UIButton,
  UIIcon,
  UIIcons,
  UIFilter,
  ModalService,
  ToastService,
  type FilterDescriptor,
  type FilterFieldDefinition,
  type FilterFieldType,
} from '@theredhead/ui-kit';

import { LoggerFactory } from '@theredhead/foundation';
import type { DbEngine } from '../../core/datasources/fetchlane-datasource';
import { ConnectionManagerService } from '../../core/services/connection-manager.service';
import { FetchlaneService } from '../../core/services/fetchlane.service';
import { FetchlaneDatasource } from '../../core/datasources/fetchlane-datasource';
import { AuthService } from '../../core/services/auth.service';
import { SchemaFormFactory } from '../../core/services/schema-form-factory.service';
import { BoConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog.component';
import {
  BoRecordFormDialog,
  type RecordFormResult,
} from '../../shared/record-form-dialog/record-form-dialog.component';
import type { ForeignKeyInfo, FullTableSchema } from '../../core/models';

interface ColumnDef {
  readonly key: string;
  readonly header: string;
  readonly fk: ForeignKeyInfo | null;
}

@Component({
  selector: 'bo-table-browser',
  templateUrl: './table-browser.component.html',
  styleUrl: './table-browser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UITableView, UITextColumn, UITemplateColumn, UIButton, UIIcon, UIFilter],
  host: { class: 'bo-table-browser' },
})
export class BoTableBrowser {
  private readonly log = inject(LoggerFactory).createLogger('BoTableBrowser');
  private readonly router = inject(Router);
  private readonly fetchlane = inject(FetchlaneService);
  private readonly connectionManager = inject(ConnectionManagerService);
  private readonly auth = inject(AuthService);
  private readonly formFactory = inject(SchemaFormFactory);
  private readonly modal = inject(ModalService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);

  protected readonly tables = signal<readonly string[]>([]);
  protected readonly selectedTable = signal<string | null>(null);
  protected readonly datasource = signal<FetchlaneDatasource | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly columns = signal<readonly ColumnDef[]>([]);
  protected readonly currentSchema = signal<FullTableSchema | null>(null);

  protected readonly canWrite = this.auth.canWrite;
  protected readonly plusIcon = UIIcons.Lucide.Cursors.Plus;
  protected readonly pencilIcon = UIIcons.Lucide.Cursors.Pencil;
  protected readonly trashIcon = UIIcons.Lucide.Files.Trash;

  private readonly filterSubject = new Subject<FilterDescriptor>();
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filterFields = computed<FilterFieldDefinition[]>(() => {
    const schema = this.currentSchema();
    if (!schema) {
      return [];
    }
    return schema.columns.map((col) => ({
      key: col.column_name,
      label: this.humanize(col.column_name),
      type: this.sqlTypeToFilterType(col.data_type),
    }));
  });

  protected readonly baseUrl = computed(() => this.connectionManager.activeConnection().baseUrl);
  protected readonly engine = computed<DbEngine>(
    () => this.connectionManager.activeConnection().engine,
  );
  protected readonly connectionName = computed(
    () => this.connectionManager.activeConnection().name,
  );

  public constructor() {
    this.filterSubject
      .pipe(debounceTime(800), takeUntilDestroyed(this.destroyRef))
      .subscribe((descriptor) => {
        const ds = this.datasource();
        if (ds) {
          ds.applyFilterDescriptor(descriptor);
        }
      });

    effect(() => {
      const url = this.baseUrl();
      this.selectedTable.set(null);
      this.datasource.set(null);
      this.loadTables(url);
    });
  }

  protected selectTable(table: string): void {
    if (!table) {
      return;
    }
    this.selectedTable.set(table);

    const ds = new FetchlaneDatasource(this.baseUrl(), table, this.engine(), this.injector);
    this.loading.set(true);
    this.error.set(null);

    this.fetchlane.getTableSchema(this.baseUrl(), table).subscribe({
      next: (schema) => {
        this.currentSchema.set(schema);
        ds.applySchema(schema);
        this.columns.set(this.buildColumns(ds));
        ds.reload()
          .then(() => {
            this.datasource.set(ds);
            this.loading.set(false);
          })
          .catch((err) => {
            const msg = err?.error?.message ?? 'Failed to load table';
            this.error.set(msg);
            this.toast.error(msg);
            this.loading.set(false);
          });
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Failed to load schema';
        this.error.set(msg);
        this.toast.error(msg);
        this.loading.set(false);
      },
    });
  }

  protected openAddDialog(): void {
    const schema = this.currentSchema();
    if (!schema) {
      return;
    }
    const formSchema = this.formFactory.buildFormSchema(schema, 'add');
    const ref = this.modal.openModal<BoRecordFormDialog, RecordFormResult>({
      component: BoRecordFormDialog,
      inputs: {
        title: `Add ${schema.table_name}`,
        formSchema,
      },
      ariaLabel: `Add ${schema.table_name} record`,
    });

    ref.closed.subscribe((result) => {
      if (result?.action === 'save') {
        this.createRecord(result.values);
      }
    });
  }

  protected openEditDialogForRow(row: Record<string, unknown>): void {
    const schema = this.currentSchema();
    if (!schema) {
      return;
    }
    const pk = this.getPrimaryKeyFromRow(row);
    if (!pk) {
      return;
    }
    const formSchema = this.formFactory.buildFormSchema(schema, 'edit');
    const ref = this.modal.openModal<BoRecordFormDialog, RecordFormResult>({
      component: BoRecordFormDialog,
      inputs: {
        title: `Edit ${schema.table_name}`,
        formSchema,
        initialValues: row,
      },
      ariaLabel: `Edit ${schema.table_name} record`,
    });

    ref.closed.subscribe((result) => {
      if (result?.action === 'save') {
        this.updateRecord(pk, result.values);
      }
    });
  }

  protected confirmDeleteRow(row: Record<string, unknown>): void {
    const table = this.selectedTable();
    if (!table) {
      return;
    }
    const pk = this.getPrimaryKeyFromRow(row);
    if (!pk) {
      return;
    }

    const ref = this.modal.openModal<BoConfirmDialog, boolean>({
      component: BoConfirmDialog,
      inputs: {
        title: 'Delete Record',
        message: `Are you sure you want to delete this ${table} record (${pk})? This action cannot be undone.`,
        confirmLabel: 'Delete',
        confirmColor: 'danger',
        confirmIcon: UIIcons.Lucide.Files.Trash,
      },
      ariaLabel: 'Confirm delete',
    });

    ref.closed.subscribe((confirmed) => {
      if (confirmed) {
        this.deleteRecord(pk);
      }
    });
  }

  private createRecord(values: Record<string, unknown>): void {
    const table = this.selectedTable();
    if (!table) {
      return;
    }
    this.fetchlane.createRecord(this.baseUrl(), table, values).subscribe({
      next: () => {
        this.log.debug('Record created');
        this.reloadDatasource();
      },
      error: (err) => {
        this.log.error('Failed to create record', [err]);
        const msg = err?.error?.message ?? 'Failed to create record.';
        this.error.set(msg);
        this.toast.error(msg);
      },
    });
  }

  private updateRecord(pk: string, values: Record<string, unknown>): void {
    const table = this.selectedTable();
    if (!table) {
      return;
    }
    this.fetchlane.updateRecord(this.baseUrl(), table, pk, values).subscribe({
      next: (savedRow) => {
        this.log.debug('Record updated');
        this.datasource()?.updateRow(savedRow);
      },
      error: (err) => {
        this.log.error('Failed to update record', [err]);
        const msg = err?.error?.message ?? 'Failed to update record.';
        this.error.set(msg);
        this.toast.error(msg);
      },
    });
  }

  private deleteRecord(pk: string): void {
    const table = this.selectedTable();
    if (!table) {
      return;
    }
    this.fetchlane.deleteRecord(this.baseUrl(), table, pk).subscribe({
      next: () => {
        this.log.debug('Record deleted');
        this.reloadDatasource();
      },
      error: (err) => {
        this.log.error('Failed to delete record', [err]);
        const msg = err?.error?.message ?? 'Failed to delete record.';
        this.error.set(msg);
        this.toast.error(msg);
      },
    });
  }

  private reloadDatasource(): void {
    const ds = this.datasource();
    if (ds) {
      void ds.reload();
    }
  }

  private getPrimaryKeyFromRow(row: Record<string, unknown>): string | null {
    const ds = this.datasource();
    if (!ds) {
      return null;
    }
    const pkColumn = ds.getPrimaryKeyColumn();
    if (!pkColumn || row[pkColumn] == null) {
      return null;
    }
    return String(row[pkColumn]);
  }

  protected navigateToFkRecord(fk: ForeignKeyInfo, row: Record<string, unknown>): void {
    const value = row[fk.column];
    if (value == null) {
      return;
    }
    void this.router.navigate(['/browse', fk.referencedTable, 'record', String(value)]);
  }

  private loadTables(baseUrl: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.fetchlane.getTableNames(baseUrl).subscribe({
      next: (names) => {
        this.tables.set(names);
        this.loading.set(false);
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Failed to load tables';
        this.error.set(msg);
        this.toast.error(msg);
        this.loading.set(false);
      },
    });
  }

  private buildColumns(ds: FetchlaneDatasource): ColumnDef[] {
    const schema = ds.getSchema();
    if (!schema) {
      return [];
    }
    const fks = ds.getForeignKeys();
    const fkMap = new Map(fks.map((fk) => [fk.column, fk]));

    return schema.columns.map((col) => ({
      key: col.column_name,
      header: this.humanize(col.column_name),
      fk: fkMap.get(col.column_name) ?? null,
    }));
  }

  private humanize(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  protected onFilterChanged(descriptor: FilterDescriptor): void {
    this.filterSubject.next(descriptor);
  }

  private sqlTypeToFilterType(dataType: string): FilterFieldType {
    const lower = dataType.toLowerCase();
    if (
      lower.includes('int') ||
      lower.includes('numeric') ||
      lower.includes('decimal') ||
      lower.includes('float') ||
      lower.includes('double') ||
      lower.includes('real') ||
      lower.includes('money')
    ) {
      return 'number';
    }
    if (lower.includes('date') || lower.includes('time')) {
      return 'date';
    }
    return 'string';
  }
}
