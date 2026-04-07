import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { JsonPipe } from '@angular/common';

import { ArrayDatasource, LoggerFactory } from '@theredhead/foundation';
import {
  UICheckbox,
  UIButton,
  UIIcon,
  UIIcons,
  UITextColumn,
  ToastService,
} from '@theredhead/ui-kit';
import { UIMasterDetailView } from '@theredhead/ui-blocks';
import { FormEngine, UIForm } from '@theredhead/ui-forms';
import type { FormSchema } from '@theredhead/ui-forms';
import { ConnectionManagerService } from '../../core/services/connection-manager.service';
import { FetchlaneService } from '../../core/services/fetchlane.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { SchemaFormFactory } from '../../core/services/schema-form-factory.service';
import type { FullTableSchema } from '../../core/models';

type SchemaTab = 'schema' | 'add-form' | 'edit-form';

@Component({
  selector: 'bo-schema-viewer',
  imports: [JsonPipe, UICheckbox, UIButton, UIIcon, UITextColumn, UIForm, UIMasterDetailView],
  templateUrl: './schema-viewer.component.html',
  styleUrl: './schema-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bo-schema-viewer' },
})
export class BoSchemaViewer {
  private readonly log = inject(LoggerFactory).createLogger('BoSchemaViewer');
  private readonly fetchlane = inject(FetchlaneService);
  private readonly connectionManager = inject(ConnectionManagerService);
  private readonly formFactory = inject(SchemaFormFactory);
  protected readonly preferences = inject(PreferencesService);
  private readonly toast = inject(ToastService);

  protected readonly tables = signal<string[]>([]);
  protected readonly tableListDatasource = signal<ArrayDatasource<{ name: string }> | null>(null);
  protected readonly selectedTable = signal<string | null>(null);
  protected readonly schema = signal<FullTableSchema | null>(null);
  protected readonly rawSchema = signal<Record<string, unknown> | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly activeTab = signal<SchemaTab>('schema');
  protected readonly copyFeedback = signal<string | null>(null);

  protected readonly copyIcon = UIIcons.Lucide.Text.Copy;
  protected readonly eyeIcon = UIIcons.Lucide.Accessibility.Eye;

  protected readonly connectionName = computed(
    () => this.connectionManager.activeConnection().name,
  );
  private readonly baseUrl = computed(() => this.connectionManager.activeConnection().baseUrl);

  protected readonly addFormSchema = computed<FormSchema | null>(() => {
    const s = this.schema();
    return s ? this.formFactory.buildFormSchema(s, 'add') : null;
  });

  protected readonly editFormSchema = computed<FormSchema | null>(() => {
    const s = this.schema();
    return s ? this.formFactory.buildFormSchema(s, 'edit') : null;
  });

  protected readonly addFormEngine = computed(() => {
    const s = this.addFormSchema();
    return s ? new FormEngine(s) : null;
  });

  protected readonly editFormEngine = computed(() => {
    const s = this.editFormSchema();
    return s ? new FormEngine(s) : null;
  });

  public constructor() {
    effect(() => {
      const url = this.baseUrl();
      this.selectedTable.set(null);
      this.schema.set(null);
      this.loadTables(url);
    });
  }

  protected onTableSelected(item: { name: string } | undefined): void {
    if (item) {
      this.selectTable(item.name);
    }
  }

  protected selectTable(table: string): void {
    this.selectedTable.set(table);
    this.activeTab.set('schema');
    this.loadSchema(table);
  }

  protected setTab(tab: SchemaTab): void {
    this.activeTab.set(tab);
  }

  protected copyFormJson(mode: 'add' | 'edit'): void {
    const s = this.schema();
    if (!s) {
      return;
    }
    const json = this.formFactory.buildFormSchemaJson(s, mode);
    navigator.clipboard.writeText(json).then(
      () => {
        this.copyFeedback.set(`${mode === 'add' ? 'Add' : 'Edit'} form JSON copied!`);
        setTimeout(() => this.copyFeedback.set(null), 2000);
      },
      () => {
        this.log.error('Failed to copy to clipboard');
      },
    );
  }

  private loadTables(baseUrl: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.fetchlane.getTableNames(baseUrl).subscribe({
      next: (names) => {
        this.tables.set(names);
        const ds = new ArrayDatasource(names.map((n) => ({ name: n })));
        this.tableListDatasource.set(ds);
        this.loading.set(false);
      },
      error: (err) => {
        this.log.error('Failed to load tables', [err]);
        const msg = err?.error?.message ?? 'Failed to load tables.';
        this.error.set(msg);
        this.toast.error(msg);
        this.loading.set(false);
      },
    });
  }

  private loadSchema(table: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.fetchlane.getRawTableSchema(this.baseUrl(), table).subscribe({
      next: (raw) => {
        this.rawSchema.set(raw);
      },
    });
    this.fetchlane.getTableSchema(this.baseUrl(), table).subscribe({
      next: (schema) => {
        this.schema.set(schema);
        this.loading.set(false);
      },
      error: (err) => {
        this.log.error('Failed to load schema', [err]);
        const msg = err?.error?.message ?? 'Failed to load schema.';
        this.error.set(msg);
        this.toast.error(msg);
        this.loading.set(false);
      },
    });
  }
}
