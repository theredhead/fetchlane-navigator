import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { UIButton, UIIcon, UIIcons, ModalRef } from '@theredhead/ui-kit';

@Component({
  selector: 'bo-confirm-dialog',
  imports: [UIButton, UIIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bo-confirm-dialog' },
  styles: `
    :host {
      display: block;
      padding: 24px;
      min-width: 320px;
      max-width: 480px;
    }
    .bo-confirm-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin: 0 0 8px;
    }
    .bo-confirm-message {
      font-size: 0.875rem;
      margin: 0 0 20px;
      opacity: 0.85;
      line-height: 1.5;
    }
    .bo-confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
  template: `
    <h2 class="bo-confirm-title">{{ title() }}</h2>
    <p class="bo-confirm-message">{{ message() }}</p>
    <div class="bo-confirm-actions">
      <ui-button variant="ghost" (click)="onCancel()">Cancel</ui-button>
      <ui-button [color]="confirmColor()" (click)="onConfirm()">
        <ui-icon [svg]="confirmIcon()" [size]="16" />
        {{ confirmLabel() }}
      </ui-button>
    </div>
  `,
})
export class BoConfirmDialog {
  public readonly modalRef = inject(ModalRef<boolean>);

  public readonly title = input('Confirm');
  public readonly message = input('Are you sure?');
  public readonly confirmLabel = input('Confirm');
  public readonly confirmColor = input<'primary' | 'danger'>('danger');
  public readonly confirmIcon = input(UIIcons.Lucide.Files.Trash);

  protected onConfirm(): void {
    this.modalRef.close(true);
  }

  protected onCancel(): void {
    this.modalRef.close(false);
  }
}
