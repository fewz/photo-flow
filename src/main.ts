import { bootstrapApplication } from '@angular/platform-browser';
import { Capacitor } from '@capacitor/core';
import { defineCustomElements as defineJeepSqlite } from 'jeep-sqlite/loader';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

defineJeepSqlite(window);
if (Capacitor.getPlatform() === 'web') {
  document.body.appendChild(document.createElement('jeep-sqlite'));
}

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => console.error(error));
