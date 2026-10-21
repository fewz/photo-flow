import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';

import { IconComponent, IconName } from '../../components/icon/icon.component';
import { ScanStatusComponent } from '../../components/scan-status/scan-status.component';

interface Tab {
  path: string;
  label: string;
  icon: IconName;
}

@Component({
  selector: 'app-tabs',
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" class="pf-tab-bar">
        @for (tab of tabs; track tab.path) {
          <ion-tab-button class="pf-tab" [tab]="tab.path">
            <span class="pf-tab__icon"><app-icon [name]="tab.icon" [stroke]="2" /></span>
            <ion-label>{{ tab.label }}</ion-label>
          </ion-tab-button>
        }
      </ion-tab-bar>
    </ion-tabs>
    <app-scan-status />
  `,
  imports: [IonTabs, IonTabBar, IonTabButton, IonLabel, IconComponent, ScanStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsPage {
  readonly tabs: readonly Tab[] = [
    { path: 'home', label: 'Home', icon: 'home' },
    { path: 'gallery', label: 'Gallery', icon: 'gallery' },
    { path: 'uploads', label: 'Uploads', icon: 'uploads' },
    { path: 'settings', label: 'Settings', icon: 'settings' },
  ];
}
