import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef } from '@angular/core';
import { Api } from './api';
import type { Availability, DeckEntry, PrintOption, ResolveEvent, ResolvedCard } from './api-types';
import { PER_PAGE, buildPdf } from './pdf/pdf';
import type { PageFormat, Slot } from './pdf/pdf';
import { webpToPng } from './webp';

interface Row {
  entry: DeckEntry;
  state: 'pending' | 'ok' | 'not_found' | 'error';
  card?: ResolvedCard;
  message?: string;
  /** Versions for the dropdown, once loaded. */
  versions?: PrintOption[];
  versionsState?: 'loading' | 'loaded' | 'error';
  /** A version chosen in the dropdown is being fetched. */
  switching?: boolean;
  /** Why the version chosen in the dropdown could not be used. */
  versionError?: string;
}

interface VersionGroup {
  label: string;
  options: VersionChoice[];
}

interface VersionChoice {
  id: string;
  /** Set name (or code). */
  title: string;
  /** "NEO #141 · 2022". */
  detail: string;
  /** What Gatherer has, once asked. */
  status: string;
  disabled: boolean;
}

/** Width of the versions panel in px (22rem): it is wider than a card. */
const PANEL_WIDTH_PX = 352;

interface Settings {
  lang: string;
  sets: string;
  skipBasicLands: boolean;
  format: PageFormat;
  cutMarks: boolean;
}

/** Shown under a version in the panel, once Gatherer has been asked about it. */
const AVAILABILITY_TEXT: Record<Availability, string> = { full: '✓ on Gatherer', front: 'front only', none: 'no image' };

const STORAGE_KEY = 'mtg-reprint.settings';
const DEFAULTS: Settings = { lang: 'it', sets: '', skipBasicLands: false, format: 'a4', cutMarks: true };

export const LANGUAGES: readonly { code: string; name: string }[] = [
  { code: 'it', name: 'Italiano' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ru', name: 'Русский' },
  { code: 'zhs', name: '简体中文' },
  { code: 'zht', name: '繁體中文' },
];

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS; // storage blocked or corrupted: use the defaults
  }
}

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closeVersions()',
  },
})
export class App {
  private readonly api = inject(Api);
  private abort: AbortController | null = null;
  /** Language the current list was resolved in (the select may have changed since). */
  private resolvedLang = 'en';
  /** Increases with every search: late answers for an older list are dropped. */
  private generation = 0;
  private readonly saved = loadSettings();

  protected readonly languages = LANGUAGES;
  protected readonly perPage = PER_PAGE;

  protected readonly decklist = signal('');
  protected readonly lang = signal(this.saved.lang);
  protected readonly setsText = signal(this.saved.sets);
  protected readonly skipBasicLands = signal(this.saved.skipBasicLands);
  protected readonly format = signal<PageFormat>(this.saved.format);
  protected readonly cutMarks = signal(this.saved.cutMarks);

  protected readonly rows = signal<Row[]>([]);
  /** Row whose versions panel is open. */
  protected readonly openVersions = signal<number | null>(null);
  /** The panel opens towards the left when there is no room on the right. */
  protected readonly panelOnLeft = signal(false);
  /** Card shown enlarged in the modal. */
  protected readonly zoomed = signal<ResolvedCard | null>(null);
  private readonly zoomDialog = viewChild.required<ElementRef<HTMLDialogElement>>('zoomDialog');
  protected readonly resolving = signal(false);
  protected readonly resolved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pdfBusy = signal(false);
  protected readonly pdfProgress = signal<{ done: number; total: number } | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly sets = computed(() =>
    this.setsText()
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  protected readonly slots = computed<Slot[]>(() => {
    const slots: Slot[] = [];
    for (const row of this.rows()) {
      if (row.state !== 'ok' || !row.card) continue;
      for (let copy = 0; copy < row.entry.qty; copy++) {
        for (const image of row.card.images) slots.push({ image });
      }
    }
    return slots;
  });

  protected readonly pageCount = computed(() => Math.ceil(this.slots().length / PER_PAGE));
  protected readonly failedRows = computed(() => this.rows().filter((r) => r.state === 'not_found' || r.state === 'error'));
  protected readonly doneCount = computed(() => this.rows().filter((r) => r.state !== 'pending').length);

  constructor() {
    effect(() => {
      const settings: Settings = {
        lang: this.lang(),
        sets: this.setsText(),
        skipBasicLands: this.skipBasicLands(),
        format: this.format(),
        cutMarks: this.cutMarks(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // storage not available: the settings just won't be remembered
      }
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected async resolve(): Promise<void> {
    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    this.resolvedLang = this.lang();
    this.generation++;
    this.rows.set([]);
    this.error.set(null);
    this.notice.set(null);
    this.resolved.set(false);
    this.resolving.set(true);
    try {
      await this.api.resolve(
        { decklist: this.decklist(), lang: this.lang(), sets: this.sets(), skipBasicLands: this.skipBasicLands() },
        (event) => this.onEvent(event),
        controller.signal,
      );
      this.resolved.set(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.error.set(
        error instanceof TypeError
          ? 'Cannot reach the MTG RePrint server. Is it still running?'
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      if (this.abort === controller) {
        this.resolving.set(false);
        this.abort = null;
      }
    }
  }

  protected cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.resolving.set(false);
  }

  private onEvent(event: ResolveEvent): void {
    if (event.type === 'start') {
      this.rows.set(event.entries.map((entry) => ({ entry, state: 'pending' as const })));
      if (event.entries.length === 0) this.error.set('No cards found in the list.');
    } else if (event.type === 'card') {
      this.rows.update((rows) =>
        rows.map((row, i): Row => {
          if (i !== event.index) return row;
          if (event.status === 'ok') return { ...row, state: 'ok', card: event.card };
          return { ...row, state: event.status, message: event.message };
        }),
      );
    }
  }

  /** Update one row, unless a new search (`generation`) has replaced the list since the work started. */
  private patchRow(index: number, generation: number, patch: Partial<Row> | ((row: Row) => Partial<Row>)): void {
    if (generation !== this.generation) return;
    this.rows.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...(typeof patch === 'function' ? patch(row) : patch) } : row)),
    );
  }

  /** Open or close the versions panel of a row; the versions are loaded when it is first opened. */
  protected toggleVersions(index: number, event: MouseEvent): void {
    if (this.openVersions() === index) return this.closeVersions();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.panelOnLeft.set(rect.left + PANEL_WIDTH_PX > document.documentElement.clientWidth - 16);
    this.openVersions.set(index);
    void this.loadVersions(index);
  }

  protected closeVersions(): void {
    this.openVersions.set(null);
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.openVersions() === null) return;
    if (!(event.target instanceof Element) || !event.target.closest('.versions')) this.closeVersions();
  }

  /** Load the versions of a row (once; again after an error). */
  protected async loadVersions(index: number): Promise<void> {
    const row = this.rows()[index];
    if (!row || row.state === 'pending' || row.versionsState === 'loading' || row.versionsState === 'loaded') return;
    const gen = this.generation;
    this.patchRow(index, gen, { versionsState: 'loading' });
    try {
      const versions = await this.api.prints(row.card?.name ?? row.entry.name, this.resolvedLang);
      this.patchRow(index, gen, { versions, versionsState: 'loaded' });
    } catch {
      this.patchRow(index, gen, { versionsState: 'error' });
    }
  }

  /** The user picked another version in the panel. */
  protected async chooseVersion(index: number, id: string): Promise<void> {
    this.closeVersions();
    const row = this.rows()[index];
    if (!row || id === row.card?.scryfallId) return;
    const gen = this.generation;
    this.patchRow(index, gen, { switching: true, versionError: undefined });
    const mark = (r: Row, available: Availability): PrintOption[] | undefined =>
      r.versions?.map((v) => (v.id === id ? { ...v, available } : v));
    try {
      const card = await this.api.print(id, this.resolvedLang);
      this.patchRow(index, gen, (r) => ({ card, state: 'ok', message: undefined, switching: false, versions: mark(r, card.incomplete ? 'front' : 'full') }));
    } catch (error) {
      this.patchRow(index, gen, (r) => ({
        switching: false,
        versions: mark(r, 'none'),
        versionError: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /** Choices of a row's versions panel, grouped by language; the print in use is always there. */
  protected versionGroups(row: Row): VersionGroup[] {
    const detail = (v: { setCode: string; collectorNumber: string; releasedAt?: string }): string =>
      [`${v.setCode.toUpperCase()} #${v.collectorNumber}`, v.releasedAt?.slice(0, 4)].filter(Boolean).join(' · ');
    const current = row.card;
    const versions = row.versions ?? [];
    const groups: VersionGroup[] = [];
    if (current && !versions.some((v) => v.id === current.scryfallId)) {
      groups.push({
        label: 'In use',
        options: [{ id: current.scryfallId, title: current.setCode.toUpperCase(), detail: detail(current), status: '', disabled: false }],
      });
    }
    for (const lang of [...new Set(versions.map((v) => v.lang))]) {
      groups.push({
        label: LANGUAGES.find((l) => l.code === lang)?.name ?? lang.toUpperCase(),
        options: versions
          .filter((v) => v.lang === lang)
          .map((v) => ({
            id: v.id,
            title: v.setName,
            detail: detail(v),
            status: v.available ? AVAILABILITY_TEXT[v.available] : '',
            disabled: v.available === 'none' && v.id !== current?.scryfallId,
          })),
      });
    }
    return groups;
  }

  protected changeQty(index: number, delta: number): void {
    this.rows.update((rows) =>
      rows.map((row, i) =>
        i === index ? { ...row, entry: { ...row.entry, qty: Math.max(0, Math.min(99, row.entry.qty + delta)) } } : row,
      ),
    );
  }

  protected async downloadPdf(): Promise<void> {
    this.notice.set(null);
    this.pdfBusy.set(true);
    this.pdfProgress.set({ done: 0, total: this.slots().length });
    try {
      const bytes = await buildPdf(this.slots(), {
        format: this.format(),
        cutMarks: this.cutMarks(),
        loadImage: (file) => this.api.imageBytes(file),
        toPng: webpToPng,
        onProgress: (done, total) => this.pdfProgress.set({ done, total }),
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'proxies.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.notice.set('PDF created. Print it at 100% ("actual size"), not "fit to page".');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.pdfBusy.set(false);
      this.pdfProgress.set(null);
    }
  }

  protected async clearCache(): Promise<void> {
    try {
      const { count } = await this.api.clearCache();
      this.notice.set(`Cache cleared (${count} files).`);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Show a card enlarged (both faces for a double-faced card). Esc, the × or a click outside close it. */
  protected openZoom(card: ResolvedCard): void {
    this.closeVersions();
    this.zoomed.set(card);
    const dialog = this.zoomDialog().nativeElement;
    if (!dialog.open) dialog.showModal();
  }

  protected closeZoom(): void {
    this.zoomDialog().nativeElement.close(); // the (close) event clears `zoomed`
  }

  /** A click on the dialog itself (not on its content) is a click on the dark backdrop. */
  protected onZoomClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closeZoom();
  }

  protected imageUrl(file: string): string {
    return `/api/images/${encodeURIComponent(file)}`;
  }
}
