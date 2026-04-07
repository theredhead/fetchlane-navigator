import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { UIButton, UIInput, UIRadioGroup, UISelect, type SelectOption } from '@theredhead/ui-kit';

import { ConnectionManagerService } from '../../core/services/connection-manager.service';
import { AuthService } from '../../core/services/auth.service';
import { FetchlaneService } from '../../core/services/fetchlane.service';
import {
  PreferencesService,
  type NavigationMode,
  type SchemaDisplayMode,
} from '../../core/services/preferences.service';
import type { ConnectionConfig } from '../../core/models';

@Component({
  selector: 'bo-settings',
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UIButton, UIInput, UIRadioGroup, UISelect],
  host: { class: 'bo-settings' },
})
export class BoSettings {
  protected readonly connectionManager = inject(ConnectionManagerService);
  private readonly auth = inject(AuthService);
  protected readonly fetchlane = inject(FetchlaneService);
  protected readonly preferences = inject(PreferencesService);

  protected readonly newName = signal('');
  protected readonly newUrl = signal('');

  protected readonly userName = this.auth.userName;
  protected readonly roles = this.auth.roles;

  protected readonly navigationModeOptions: SelectOption[] = [
    { value: 'click', label: 'Single click' },
    { value: 'dblclick', label: 'Double click' },
  ];

  protected readonly schemaDisplayOptions: SelectOption[] = [
    { value: 'formatted', label: 'Formatted' },
    { value: 'json', label: 'Raw JSON' },
  ];

  protected readonly connectionOptions = computed<SelectOption[]>(() =>
    this.connectionManager.connections().map((c, i) => ({
      value: String(i),
      label: c.name,
    })),
  );

  protected readonly activeConnectionValue = computed(() =>
    String(this.connectionManager.activeIndex()),
  );

  protected onConnectionChange(value: string): void {
    this.connectionManager.setActive(Number(value));
  }

  protected onNavigationModeChange(value: string): void {
    this.preferences.setNavigationMode(value as NavigationMode);
  }

  protected onSchemaDisplayChange(value: string): void {
    this.preferences.setSchemaDisplayMode(value as SchemaDisplayMode);
  }

  protected addConnection(): void {
    const name = this.newName().trim();
    const url = this.newUrl().trim();
    if (!name || !url) {
      return;
    }
    const config: ConnectionConfig = {
      name,
      engine: 'custom',
      baseUrl: url.replace(/\/+$/, ''),
    };
    this.connectionManager.addConnection(config);
    this.newName.set('');
    this.newUrl.set('');
  }

  protected removeConnection(index: number): void {
    this.connectionManager.removeConnection(index);
  }

  protected setActive(index: number): void {
    this.connectionManager.setActive(index);
  }

  protected logout(): void {
    this.auth.logout();
  }

  protected resetSchemaCache(): void {
    this.fetchlane.clearCache();
  }
}
