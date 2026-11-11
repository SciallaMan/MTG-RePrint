# Piano funzionalità

Proposte di cose da aggiungere o cambiare, con una stima di sforzo (S = poche ore, M = una giornata, L = più
giorni), il rischio e i file coinvolti. Ordinate per rapporto valore/sforzo, non per categoria. Documento di
lavoro (come `TODO.txt`): non è documentazione del progetto.

Vincoli che valgono per tutto: le richieste in rete passano sempre da `Http` con le pause e le priorità di
oggi; le immagini vengono solo da Gatherer (o dall'utente, vedi 3); l'app scrive solo in `data/`; ogni
endpoint nuovo mantiene il controllo su `Host` e il `Content-Type: application/json`.

## A. Dal TODO

- [ ] **A1. Escludere set, o metterli in fondo** (TODO 1) — sforzo M, rischio basso.
  Oggi "Preferred sets" dice solo quali provare prima. Proposta: nello stesso campo, `-sld` esclude il set,
  `~plst` lo prova per ultimo (dopo tutti gli altri), così non serve un secondo campo. Il server riceve
  `sets`, `excludedSets`, `lastSets` (`ResolveRequest`, `PrintsRequest`, liste salvate); `findCard` scarta le
  stampe dei set esclusi in ogni tentativo (anche nei candidati Gatherer) e mette in coda quelle dei set
  posticipati; nel pannello versioni le stampe escluse restano visibili ma in fondo con la nota "escluso".
  File: `decklist.ts`/`app.ts` (parsing del campo), `resolver.ts`, `types.ts` + `api-types.ts`,
  `app.ts`/`app.html` web, `wishlist.ts`. Domanda: nel pannello versioni nascondere del tutto le escluse, o
  mostrarle in fondo?
- [ ] **A2. Risoluzione: mostrarla, filtrarla, preferire la più alta** (TODO 1) — sforzo M/L, rischio medio.
  Fatti: le pagine nuove di Gatherer danno una sola immagine (`/Cards/medium/<id>`); quelle legacy
  (`multiverseid`, usate per le bifacciali e come ripiego) sono piccole. Il programma oggi non sa quanto è
  grande un'immagine. In tre passi:
  1. **Leggere larghezza × altezza** dall'intestazione PNG/JPEG/WebP quando l'immagine viene scaricata (o
     già in cache) e tenerle in un indice (`data/cache/images.json` o nel nome file); mostrarle nel pannello
     versioni ("744 × 1039") e, sulla carta, un avviso quando sono sotto ~600 px di larghezza (63 mm a
     240 dpi). Solo questo vale già molto: si vede subito quale stampa verrà sgranata.
  2. **Risoluzione minima** nelle opzioni (es. 500 px): una stampa sotto soglia conta come "senza immagine"
     e si passa alla successiva, come oggi per quelle che Gatherer non ha. Costa qualche richiesta in più.
  3. **"Preferisci la più alta" a parità di lingua**: prova fino a K stampe (es. 3) invece di fermarsi alla
     prima e tiene la più grande. Opzione spenta di default perché moltiplica le richieste a Gatherer.
  Da verificare prima: se `gatherer-static` serve anche `/Cards/large/<id>` (basterebbe cambiare una
  costante per avere immagini più grandi per tutti). File: `gatherer.ts`, `cache.ts`, `resolver.ts`,
  `types.ts`, pannello versioni.
- [ ] **A3. Immagine personalizzata, da link o da file** (TODO 3) — sforzo L, rischio medio.
  Nuovo endpoint `POST /api/images/custom` con `{ url }` oppure `{ name, data }` (file in base64, così resta
  JSON e vale la regola del preflight; limite ~10 MB solo su questo endpoint). Il server scarica il link con
  `Http` (nuovo tipo di host con la sua pausa; rifiuta indirizzi privati e `localhost`), controlla che sia
  un'immagine (`looksLikeImage`), la salva come `custom_<sha1>.<ext>` e risponde con un print id
  `custom:<sha1>`, accettato ovunque c'è un print id (`/api/print`, `printId` nelle liste, `pins`).
  Nella UI: un link a un'immagine incollato in "Add a card" crea la riga con quell'immagine (nome = quello
  scritto prima del link o il nome del file); nel pannello versioni di ogni carta un "Use my own image…"
  (input file) che sostituisce l'immagine della riga; la carta è marcata "Custom image". Le immagini custom
  vanno in `data/images`, non nella cache: "Clear cache" non deve cancellarle. Domande: ridimensionare le
  immagini troppo grandi? Accettare anche PDF/altri formati? Servono per le bifacciali (due file)?

## B. Piccole aggiunte con buon ritorno

- [ ] **B1. "Riprova" sulla carta non trovata, e "Riprova le non trovate"** — sforzo S, rischio basso.
  Oggi per ritentare una carta bisogna rifare tutta la lista. Stessa meccanica di "Add a card": una
  `/api/resolve` con la sola riga, e la riga viene aggiornata al suo posto. Utile quando Gatherer rifiutava
  le pagine (blocco di 10 minuti) o si è aggiunta la stampa a mano.
- [ ] **B2. Togliere una carta (×)** — sforzo S, rischio basso.
  Oggi si può solo portare la quantità a 0 (resta in grigio). Un × che rimuove la riga e la toglie dal testo.
  Come `insertEntries`, cambia gli indici: nuova `generation`.
- [ ] **B3. "Solo nella lingua scelta"** — sforzo S, rischio basso.
  Opzione per chi non vuole stampe in inglese al posto di quelle mancanti: il resolver salta i tentativi in
  inglese e la ricerca approssimativa; la carta risulta "non trovata" con la spiegazione di oggi. Salvata
  nelle impostazioni e nella lista.
- [ ] **B4. Altri formati di pagina: A3 (4 × 4 = 16 carte), Legal (3 × 4 = 12)** — sforzo S, rischio basso.
  `pdf.ts` ha colonne e righe fisse (3 × 3): basta metterle nella tabella dei formati. Test già pronti.
- [ ] **B5. Spazio tra le carte e bordo nero** — sforzo M, rischio basso.
  Due opzioni di stampa chieste di solito da chi taglia a mano: distanza tra le carte (0–3 mm, con i segni
  di taglio intorno a ogni carta invece che solo ai bordi della griglia) e un bordo nero di 1 mm dietro
  l'immagine, che copre le imprecisioni del taglio. Tutto in `pdf.ts` (layout, `cutMarks`, un rettangolo
  nero prima di ogni immagine) + due controlli nelle opzioni.
- [ ] **B6. Copia negli appunti** — sforzo S.
  "Copia la lista" (il testo delle righe correnti, quantità comprese) e "Copia le non trovate", per
  portarle altrove o ritentarle.
- [ ] **B7. Riordinare le carte** — sforzo S/M.
  Frecce ↑ ↓ sulla carta (o drag & drop); l'ordine è quello del PDF e del testo. Oggi l'ordine è solo quello
  della lista.
- [ ] **B8. Liste salvate: rinomina, data, esporta/importa** — sforzo S.
  Nel menu la data dell'ultimo salvataggio; "Rename" senza dover risalvare; esportazione/importazione del
  JSON della lista (backup o scambio tra due PC, visto che tutto sta in `data/lists`).

## C. Più grandi, da decidere

- [ ] **C1. Stampa fronte/retro per le bifacciali** — sforzo M/L, rischio medio.
  Oggi le due facce sono due carte separate. Opzione "retri su un foglio a parte": pagina N con i fronti,
  pagina N+1 con i retri specchiati in orizzontale, così stampando fronte/retro le facce combaciano. Le
  carte a una faccia restano vuote sul retro (non abbiamo l'immagine del dorso, ed è giusto così).
- [ ] **C2. Token del mazzo** — sforzo M, rischio medio.
  "Add the deck's tokens": Scryfall dice quali token produce ogni carta (`all_parts`); l'app aggiunge le
  righe (una per tipo di token, con quantità 1). Da verificare che Gatherer abbia le immagini dei token
  dei set recenti (pagine `TNEO/…`): se no, inutile.
- [ ] **C3. Anteprima delle pagine prima del PDF** — sforzo M, rischio basso.
  Una griglia 3 × 3 in HTML per pagina, con la stessa funzione `layout` del PDF: si vede cosa si stampa e
  dove finiscono le ultime carte. Valore medio: il PDF si apre comunque subito.
- [ ] **C4. Set preferiti con nome e completamento** — sforzo M.
  Oggi il campo vuole i codici (`neo, mh2`); con la lista dei set da Scryfall (`/sets`, in cache per
  30 giorni) si potrebbero scrivere i nomi e vederli come "chip". Comodo, ma non cambia cosa si stampa.
- [ ] **C5. Modalità riga di comando (`mtg-reprint --deck deck.txt --pdf out.pdf`)** — sforzo L, rischio alto.
  Il PDF oggi nasce nel browser (pdf-lib + canvas per le WebP). Sul server servirebbe pdf-lib (dipendenza
  nuova) e un decoder WebP in Node (altra dipendenza). Sconsigliato per ora.
- [ ] **C6. Importare un mazzo da URL (Archidekt, Moxfield…)** — sforzo M, rischio medio/alto.
  Archidekt ha un'API pubblica; Moxfield blocca i client non browser. Gli export incollati funzionano già:
  priorità bassa.

## D. Comportamenti da cambiare (piccoli)

- [ ] **D1. Lingua iniziale dal browser**: il default è `it` fisso (`DEFAULTS` in `app.ts`); alla prima
  apertura prendere la lingua del browser se è tra quelle supportate. Sforzo S.
- [ ] **D2. Carte con quantità 0 fuori dal conteggio** "N found": oggi contano come trovate ma non si stampano.
  Sforzo S.
- [ ] **D3. "Find more … versions on Gatherer" anche dalla ricerca**: quando la lingua non è l'inglese e la
  carta è finita in inglese, un'opzione "cerca a fondo" prova subito i candidati Gatherer (oggi si fa a
  mano, tre alla volta). Costa richieste: spenta di default. Sforzo S/M.
- [ ] **D4. Miniature nel pannello versioni**, solo per le stampe già in cache (nessuna richiesta in più):
  si vede l'arte prima di scegliere. Sforzo S.

## Ordine proposto

B1, B2, B4 (piccole e utili) → A1 → B3, B5 → A2 (prima verificare `large`) → A3 → D1–D4 → B6–B8 → C.

## Domande

1. A1: le stampe escluse nel pannello versioni: nascoste o in fondo?
2. A2: posso fare una sola richiesta a Gatherer per verificare se esiste `/Cards/large/`?
3. A3: dove tenere le immagini custom (`data/images`?), limite di dimensione, e servono per le bifacciali?
4. C1 e C2 interessano? Sono le due più grosse.
