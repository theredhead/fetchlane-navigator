import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { UINavigationPage, navItem, type NavigationNode } from '@theredhead/ui-blocks';
import {
  PopoverService,
  UIAvatar,
  UIIcons,
  UISidebarFooter,
  UIToastContainer,
} from '@theredhead/ui-kit';

import { AuthService } from './core/services/auth.service';
import { BoUserMenu, type UserMenuAction } from './features/user-menu/user-menu.component';

@Component({
  selector: 'bo-root',
  imports: [RouterOutlet, UINavigationPage, UIAvatar, UISidebarFooter, UIToastContainer],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bo-root' },
})
export class App {
  private readonly router = inject(Router);
  private readonly popover = inject(PopoverService);
  protected readonly auth = inject(AuthService);

  protected readonly activePage = signal(this.routeToPage(this.router.url));

  protected readonly navItems = [
    navItem('browse', 'Tables', { route: 'browse', icon: UIIcons.Lucide.Files.Table }),
    navItem('schema', 'Schema', { route: 'schema', icon: UIIcons.Lucide.Development.Braces }),
    navItem('settings', 'Settings', { route: 'settings', icon: UIIcons.Lucide.Account.Settings }),
  ];

  public constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this.activePage.set(this.routeToPage(e.urlAfterRedirects)));
  }

  protected onNavigated(node: NavigationNode): void {
    if (node.data.route) {
      this.router.navigate([node.data.route]);
    }
  }

  protected openUserMenu(event: MouseEvent): void {
    const anchor = event.currentTarget as Element;
    const ref = this.popover.openPopover<BoUserMenu, UserMenuAction>({
      component: BoUserMenu,
      anchor,
      verticalAxisAlignment: 'top',
      horizontalAxisAlignment: 'start',
      showArrow: true,
      ariaLabel: 'User menu',
      inputs: { accountUrl: this.auth.accountUrl() },
    });

    ref.closed.subscribe((action) => {
      if (action === 'account') {
        const url = this.auth.accountUrl();
        if (url) {
          window.open(url, '_blank', 'noopener');
        }
      } else if (action === 'logout') {
        this.auth.logout();
      }
    });
  }

  private routeToPage(url: string): string {
    const segment = url.split('/').filter(Boolean)[0] ?? 'browse';
    return segment;
  }
}
