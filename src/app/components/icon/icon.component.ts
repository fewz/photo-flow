import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'alert'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
  | 'chevron-right'
  | 'close'
  | 'cloud'
  | 'cloud-upload'
  | 'copy'
  | 'download'
  | 'expand'
  | 'external'
  | 'gallery'
  | 'home'
  | 'image'
  | 'lock'
  | 'logo'
  | 'pause-circle'
  | 'phone'
  | 'refresh'
  | 'settings'
  | 'shield'
  | 'spinner'
  | 'trash'
  | 'undo'
  | 'uploads'
  | 'warning'
  | 'wifi-off';

/** Stroke icons on a 24px grid. Decorative only: give the surrounding control its own label. */
@Component({
  selector: 'app-icon',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('alert') {
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 7.5v5.5M12 16.5h.01"></path>
        }
        @case ('arrow-left') {
          <path d="M19 12H5M11 6l-6 6 6 6"></path>
        }
        @case ('arrow-right') {
          <path d="M5 12h14M13 6l6 6-6 6"></path>
        }
        @case ('check') {
          <path d="M5 12l5 5 9-10"></path>
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6L6 18"></path>
        }
        @case ('cloud') {
          <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.6a4 4 0 0 1-.9 7.9z"></path>
        }
        @case ('chevron-right') {
          <path d="M9 6l6 6-6 6"></path>
        }
        @case ('cloud-upload') {
          <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.6a4 4 0 0 1-.9 7.9"></path>
          <path d="M12 12v8M9 15l3-3 3 3"></path>
        }
        @case ('copy') {
          <rect x="8" y="8" width="12" height="12" rx="2"></rect>
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
        }
        @case ('download') {
          <path d="M12 4v11M8 11l4 4 4-4M5 20h14"></path>
        }
        @case ('external') {
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>
        }
        @case ('expand') {
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>
        }
        @case ('gallery') {
          <rect x="4" y="4" width="7" height="7" rx="1.5"></rect>
          <rect x="13" y="4" width="7" height="7" rx="1.5"></rect>
          <rect x="4" y="13" width="7" height="7" rx="1.5"></rect>
          <rect x="13" y="13" width="7" height="7" rx="1.5"></rect>
        }
        @case ('home') {
          <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"></path>
        }
        @case ('image') {
          <rect x="3" y="4" width="18" height="16" rx="2"></rect>
          <circle cx="9" cy="10" r="2"></circle>
          <path d="M21 16l-5-5-9 9"></path>
        }
        @case ('lock') {
          <rect x="5" y="11" width="14" height="9" rx="2"></rect>
          <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
        }
        @case ('logo') {
          <rect x="7" y="5" width="12" height="15" rx="2.5"></rect>
          <path d="M4.5 16.5V7a3 3 0 0 1 3-3"></path>
        }
        @case ('pause-circle') {
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M10 9v6M14 9v6"></path>
        }
        @case ('phone') {
          <rect x="7" y="3" width="10" height="18" rx="2"></rect>
          <path d="M11 18h2"></path>
        }
        @case ('refresh') {
          <path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"></path>
        }
        @case ('settings') {
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8"></path>
          <circle cx="16" cy="7" r="2"></circle>
          <circle cx="10" cy="17" r="2"></circle>
        }
        @case ('shield') {
          <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"></path>
          <path d="M9 12l2 2 4-4"></path>
        }
        @case ('spinner') {
          <circle cx="12" cy="12" r="8.5" stroke-opacity="0.22"></circle>
          <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5"></path>
        }
        @case ('undo') {
          <path d="M9 14L4 9l5-5"></path>
          <path d="M4 9h10a6 6 0 0 1 0 12h-3"></path>
        }
        @case ('trash') {
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path>
        }
        @case ('uploads') {
          <path d="M12 15V4M8 8l4-4 4 4M5 20h14"></path>
        }
        @case ('warning') {
          <path d="M12 4l9 16H3z"></path>
          <path d="M12 10v4M12 17h.01"></path>
        }
        @case ('wifi-off') {
          <path
            d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.6M14.6 10.4A10 10 0 0 1 19 12.9M2 8.8a15 15 0 0 1 4.3-2.7M10.6 5.1A15 15 0 0 1 22 8.8M12 20h.01"
          ></path>
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly stroke = input(1.9);
}
