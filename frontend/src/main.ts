import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { migrateContentPoolStorage } from './app/core/utils/legacy-storage.util';

migrateContentPoolStorage();
bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
