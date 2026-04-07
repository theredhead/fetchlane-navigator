import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';

import { LoggerFactory } from '@theredhead/foundation';
import { UIButton, UIIcon, UIIcons, ModalRef } from '@theredhead/ui-kit';
import { FormEngine, UIForm } from '@theredhead/ui-forms';
import type { FormSchema, FormValues } from '@theredhead/ui-forms';

export interface RecordFormResult {
  readonly action: 'save';
  readonly values: FormValues;
}

@Component({
  selector: 'bo-record-form-dialog',
  imports: [UIButton, UIIcon, UIForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bo-record-form-dialog' },
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-width: 400px;
      max-width: 640px;
      max-height: 80vh;
      overflow: hidden;
    }
    .bo-form-dialog-header {
      padding: 24px 24px 0;
    }
    .bo-form-dialog-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 0;
    }
    .bo-form-dialog-body {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: 16px 24px;
    }
    .bo-form-dialog-error {
      color: var(--ui-danger);
      font-size: 0.8125rem;
      margin: 8px 0 0;
    }
    .bo-form-dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 16px 24px;
      border-top: 1px solid var(--ui-border);
    }
  `,
  template: `
    <div class="bo-form-dialog-header">
      <h2 class="bo-form-dialog-title">{{ title() }}</h2>
    </div>
    @if (engine(); as eng) {
      <div class="bo-form-dialog-body">
        <ui-form [engine]="eng" [showSubmit]="false" />
        @if (errorMessage()) {
          <p class="bo-form-dialog-error">{{ errorMessage() }}</p>
        }
      </div>
      <div class="bo-form-dialog-footer">
        <ui-button variant="ghost" (click)="onCancel()">Cancel</ui-button>
        <ui-button color="primary" [disabled]="!eng.valid()" (click)="onSave(eng)">
          <ui-icon [svg]="saveIcon" [size]="16" />
          Save
        </ui-button>
      </div>
    }
  `,
})
export class BoRecordFormDialog {
  private readonly log = inject(LoggerFactory).createLogger('BoRecordFormDialog');
  public readonly modalRef = inject(ModalRef<RecordFormResult>);

  public readonly title = input('Record');
  public readonly formSchema = input.required<FormSchema>();
  public readonly initialValues = input<Record<string, unknown>>({});

  protected readonly engine = signal<FormEngine | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly saveIcon = UIIcons.Lucide.Accessibility.BadgeInfo;

  public constructor() {
    // Build engine after inputs are set — ModalService sets inputs after construction
    queueMicrotask(() => this.initEngine());
  }

  private initEngine(): void {
    const schema = this.formSchema();
    if (!schema) {
      return;
    }
    const eng = new FormEngine(schema);
    const initial = this.initialValues();
    for (const [key, value] of Object.entries(initial)) {
      try {
        eng.setValue(key, value);
      } catch {
        // Field may not exist in form (e.g. identity columns)
      }
    }
    this.engine.set(eng);
  }

  protected onSave(eng: FormEngine): void {
    eng.markAllTouched();
    if (!eng.valid()) {
      return;
    }
    this.modalRef.close({ action: 'save', values: eng.output()() });
  }

  protected onCancel(): void {
    this.modalRef.close(undefined);
  }
}
