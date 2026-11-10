import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef } from '@angular/core';
import { Api } from './api';
import type {
  Availability,
  DeckEntry,
  GathererSearch,
  PrintOption,
  ResolveEvent,
  ResolveRequest,
  ResolvedCard,
  UpdateInfo,
  WishlistSummary,
} from './api-types';
import { PER_PAGE, buildPdf, pdfFileName } from './pdf/pdf';
import type { PageFormat, Slot } from './pdf/pdf';
import { webpToPng } from './webp';
import { pinsOf, toDecklist } from './wishlist';

interface Row {
  entry: DeckEntry;
  state: 'pending' | 'ok' | 'not_found' | 'error';
  card?: ResolvedCard;
  message?: string;
  /** Versions for the dropdown, once loaded. */
  versions?: PrintOption[];
  versionsState?: 'loading' | 'loaded' | 'error';
  /** Where "Search Gatherer" goes on, or null when there is nothing (more) to look for. */
  gathererSearch?: GathererSearch | null;
  /** A "Search Gatherer" is running. */
  searching?: boolean;
  /** Outcome of the last "Search Gatherer". */
  searchNote?: string;
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
/** Maximum height of the versions panel in px: min(26rem, 60vh), as in app.css. */
const panelMaxHeightPx = (): number => Math.min(416, window.innerHeight * 0.6);

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
/** The version whose "new version" notice was closed: it is not shown again for that version. */
const UPDATE_DISMISSED_KEY = 'mtg-reprint.update-dismissed';
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
  /** The open list as last opened or saved: its text, and its exact entries (with the hand-picked prints). */
  private listSource: { text: string; entries: DeckEntry[] } | null = null;
  /** True when the rows were resolved from the entries of the open list (not from edited text). */
  private rowsFromList = false;

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
  /** The panel opens upwards when there is no room below (and more room above). */
  protected readonly panelUp = signal(false);
  /** Height limit of a panel that opens upwards (the room above its buttons), in px. */
  protected readonly panelUpMaxHeight = signal<number | null>(null);
  /** Card shown enlarged in the modal. */
  protected readonly zoomed = signal<ResolvedCard | null>(null);
  private readonly zoomDialog = viewChild.required<ElementRef<HTMLDialogElement>>('zoomDialog');
  protected readonly resolving = signal(false);
  protected readonly resolved = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pdfBusy = signal(false);
  protected readonly pdfProgress = signal<{ done: number; total: number } | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** A newer release, while its notice is shown. */
  protected readonly update = signal<UpdateInfo | null>(null);

  /** Saved lists (wishlists), most recent first. */
  protected readonly savedLists = signal<WishlistSummary[]>([]);
  /** List chosen in the "Saved lists" select. */
  protected readonly selectedListId = signal('');
  /** The saved list being worked on (opened or saved), or null. */
  protected readonly currentList = signal<{ id: string; name: string } | null>(null);
  protected readonly listName = signal('');
  protected readonly listBusy = signal(false);

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
    void this.refreshLists();
    void this.checkUpdate();
  }

  /** Show the "new version" notice, unless it was closed for that version. */
  private async checkUpdate(): Promise<void> {
    try {
      const info = await this.api.update();
      let dismissed: string | null = null;
      try {
        dismissed = localStorage.getItem(UPDATE_DISMISSED_KEY);
      } catch {
        // storage not available: the notice is shown every time
      }
      if (info.newer && info.url && info.latest !== dismissed) this.update.set(info);
    } catch {
      // no notice: the app works the same
    }
  }

  protected dismissUpdate(): void {
    const info = this.update();
    this.update.set(null);
    try {
      if (info?.latest) localStorage.setItem(UPDATE_DISMISSED_KEY, info.latest);
    } catch {
      // storage not available: the notice comes back next time
    }
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
    const request: ResolveRequest = {
      decklist: this.decklist(),
      lang: this.lang(),
      sets: this.sets(),
      skipBasicLands: this.skipBasicLands(),
    };
    if (this.listSource && this.listSource.text === this.decklist()) {
      // the text is still the open list's: resolve its exact entries (current quantities and versions)
      request.entries = this.rowsFromList && this.rows().length ? this.rows().map((r) => r.entry) : this.listSource.entries;
    } else if (this.currentList()) {
      // the text of the open list was edited: keep the versions chosen by hand, by card name
      request.pins = pinsOf([...(this.listSource?.entries ?? []), ...this.rows().map((r) => r.entry)].reverse());
    }
    this.rowsFromList = request.entries !== undefined;
    this.resolvedLang = this.lang();
    this.generation++;
    this.rows.set([]);
    this.error.set(null);
    this.notice.set(null);
    this.resolved.set(false);
    this.resolving.set(true);
    try {
      await this.api.resolve(request, (event) => this.onEvent(event), controller.signal);
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
    this.openPanel(index, event.currentTarget as HTMLElement);
    void this.loadVersions(index);
  }

  /**
   * Open the versions panel of a row next to its buttons: towards the left when there is no room
   * on the right, upwards when there is no room below and more room above.
   */
  private openPanel(index: number, anchor: HTMLElement): void {
    const rect = (anchor.closest('.versions') ?? anchor).getBoundingClientRect();
    this.panelOnLeft.set(rect.left + PANEL_WIDTH_PX > document.documentElement.clientWidth - 16);
    const below = window.innerHeight - rect.bottom - 16;
    const up = below < panelMaxHeightPx() && rect.top > below;
    this.panelUp.set(up);
    this.panelUpMaxHeight.set(up ? Math.min(panelMaxHeightPx(), rect.top - 16) : null);
    this.openVersions.set(index);
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
      const { prints, gathererSearch } = await this.api.prints(row.card?.name ?? row.entry.name, this.resolvedLang);
      this.patchRow(index, gen, { versions: prints, gathererSearch, versionsState: 'loaded' });
    } catch {
      this.patchRow(index, gen, { versionsState: 'error' });
    }
  }

  /** "Search Gatherer" is offered while there may be translations left to try (never in English). */
  protected canSearchGatherer(row: Row): boolean {
    return this.resolvedLang !== 'en' && !(row.versionsState === 'loaded' && !row.gathererSearch);
  }

  /** Tooltip of the "Find more versions on Gatherer" link: what it does and how much is left. */
  protected searchGathererTitle(row: Row): string {
    const what = `Looks on Gatherer for ${this.resolvedLangName()} versions that Scryfall does not list`;
    const search = row.gathererSearch;
    if (!search) return `${what}, a few English prints at a time.`;
    return `${what}: tries ${search.size} of the ${search.left} English prints left.`;
  }

  /**
   * "Search Gatherer" (on the card): try the next few English prints on Gatherer in the list's
   * language. The versions are loaded first if needed; the panel opens when something is found.
   */
  protected async searchGatherer(index: number, event: MouseEvent): Promise<void> {
    const anchor = event.currentTarget as HTMLElement;
    if (!this.rows()[index] || this.rows()[index]?.searching) return;
    const gen = this.generation;
    this.patchRow(index, gen, { searching: true, searchNote: undefined });
    await this.loadVersions(index);
    const row = this.rows()[index];
    if (!row || gen !== this.generation) return;
    if (row.versionsState !== 'loaded') {
      return this.patchRow(index, gen, { searching: false, searchNote: 'Versions not available: try again.' });
    }
    const from = row.gathererSearch?.next;
    if (from === undefined) {
      return this.patchRow(index, gen, { searching: false, searchNote: 'Nothing more to look for on Gatherer.' });
    }
    try {
      const result = await this.api.searchGatherer(row.card?.name ?? row.entry.name, this.resolvedLang, from);
      let foundAny = false;
      this.patchRow(index, gen, (r) => {
        const known = new Set((r.versions ?? []).map((v) => v.id));
        const found = result.prints.filter((p) => !known.has(p.id));
        foundAny = found.length > 0;
        const tried = `${result.tried} ${result.tried === 1 ? 'print' : 'prints'}`;
        return {
          searching: false,
          versions: [...(r.versions ?? []), ...found],
          gathererSearch: result.gathererSearch,
          searchNote: foundAny
            ? `Found ${found.length} of ${tried} on Gatherer: see the versions.`
            : `Nothing new on Gatherer in ${tried}.`,
        };
      });
      if (foundAny && gen === this.generation) this.openPanel(index, anchor);
    } catch (error) {
      this.patchRow(index, gen, {
        searching: false,
        searchNote: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /** Name of the language the list was resolved in, for the versions panel. */
  protected resolvedLangName(): string {
    return LANGUAGES.find((l) => l.code === this.resolvedLang)?.name ?? this.resolvedLang.toUpperCase();
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
      this.patchRow(index, gen, (r) => ({
        // the print chosen by hand is remembered when the list is saved
        entry: { ...r.entry, printId: card.scryfallId },
        card,
        state: 'ok',
        message: undefined,
        switching: false,
        versions: mark(r, card.incomplete ? 'front' : 'full'),
      }));
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
            status: v.gathererOnly ? '✓ only on Gatherer' : v.available ? AVAILABILITY_TEXT[v.available] : '',
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

  protected async refreshLists(): Promise<void> {
    try {
      this.savedLists.set(await this.api.lists());
    } catch {
      // the server is not reachable: "Find cards" will say so
    }
  }

  /** Open the list chosen in the select: its text goes in the box and its cards are looked up. */
  protected async openList(): Promise<void> {
    const id = this.selectedListId();
    if (!id) return;
    this.error.set(null);
    try {
      const list = await this.api.list(id);
      const text = toDecklist(list.entries);
      this.listSource = { text, entries: list.entries };
      this.rowsFromList = false;
      this.currentList.set({ id: list.id, name: list.name });
      this.listName.set(list.name);
      this.decklist.set(text);
      this.lang.set(list.lang);
      this.setsText.set(list.sets.join(', '));
      await this.resolve();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
      void this.refreshLists(); // it may have been deleted outside the app
    }
  }

  /** Save the cards shown below (quantities and versions chosen by hand) in the open list, or in a new one. */
  protected async saveList(asNew: boolean): Promise<void> {
    const name = this.listName().trim();
    if (!name || this.listBusy() || this.resolving()) return;
    const current = asNew ? null : this.currentList();
    this.error.set(null);
    this.notice.set(null);
    this.listBusy.set(true);
    try {
      const list = await this.api.saveList({
        ...(current ? { id: current.id } : {}),
        name,
        lang: this.resolvedLang,
        sets: this.sets(),
        entries: this.rows().map((r) => r.entry),
      });
      const text = toDecklist(list.entries);
      this.listSource = { text, entries: list.entries };
      this.rowsFromList = true;
      this.decklist.set(text);
      this.currentList.set({ id: list.id, name: list.name });
      this.listName.set(list.name);
      this.selectedListId.set(list.id);
      this.notice.set(`List "${list.name}" saved.`);
      await this.refreshLists();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.listBusy.set(false);
    }
  }

  /** Stop working on the open list (the cards stay on screen; nothing is deleted). */
  protected closeList(): void {
    this.currentList.set(null);
    this.listSource = null;
    this.rowsFromList = false;
    this.listName.set('');
  }

  protected async deleteList(): Promise<void> {
    const list = this.savedLists().find((l) => l.id === this.selectedListId());
    if (!list || !confirm(`Delete the list "${list.name}"? This cannot be undone.`)) return;
    try {
      await this.api.deleteList(list.id);
      if (this.currentList()?.id === list.id) this.closeList();
      this.selectedListId.set('');
      this.notice.set(`List "${list.name}" deleted.`);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
    await this.refreshLists();
  }

  /** The row shows the print chosen by hand (not a fallback because Gatherer lost it). */
  protected isPinned(row: Row): boolean {
    return !!row.entry.printId && row.entry.printId === row.card?.scryfallId;
  }

  protected async downloadPdf(): Promise<void> {
    this.notice.set(null);
    this.pdfBusy.set(true);
    this.pdfProgress.set({ done: 0, total: this.slots().length });
    // named after the list: the one open, or the name typed for saving it
    const listName = this.listName().trim() || this.currentList()?.name || '';
    try {
      const bytes = await buildPdf(this.slots(), {
        format: this.format(),
        cutMarks: this.cutMarks(),
        title: listName,
        loadImage: (file) => this.api.imageBytes(file),
        toPng: webpToPng,
        onProgress: (done, total) => this.pdfProgress.set({ done, total }),
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = pdfFileName(listName);
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
