# TViX Custom UI

Wrapper grafico per il tuo addon TViX/Nuvio.

## Cosa fa

- mantiene gli stream TViX originali;
- forza `posterShape: "square"` su catalog e meta;
- permette override per singolo canale di:
  - nome
  - poster
  - logo
  - background
  - description
- supporta immagini locali nella cartella `public/`;
- include `/channels` per vedere gli ID dei canali.

## Avvio locale

Richiede Node.js 20+.

```bash
npm install
npm start
```

Poi apri:

```text
http://localhost:7000/
http://localhost:7000/channels
http://localhost:7000/manifest.json
```

Manifest originale già configurato:

```text
https://tvix.qzz.io/eyJtZWRpYWZsb3dNYXN0ZXIiOnRydWUsIm1lZGlhRmxvd1Byb3h5VXJsIjoiaHR0cHM6Ly9ibGFwcm8tcDZxZmZhLmZseS5kZXYvIiwibWVkaWFGbG93UHJveHlQYXNzd29yZCI6IlNjYXRvcmNoaWE3IiwiZHZyRW5hYmxlZCI6ZmFsc2UsImRpc2FibGVMaXZlVHYiOmZhbHNlLCJ2YXZvb05vTWZwRW5hYmxlZCI6dHJ1ZX0=/manifest.json
```

## Personalizzare un canale

Apri:

```text
config/channels.json
```

E sostituisci l'esempio con l'ID reale trovato in `/channels`.

Esempio:

```json
{
  "_instructions": {},
  "overrides": {
    "ID_REALE_RAI_1": {
      "poster": "/logos/rai1.png",
      "logo": "/logos/rai1.png",
      "background": "/backgrounds/rai1.jpg"
    }
  }
}
```

Poi metti:

```text
public/logos/rai1.png
public/backgrounds/rai1.jpg
```

Puoi anche usare immagini esterne:

```json
{
  "poster": "https://example.com/rai1.png"
}
```

## Render

Crea un nuovo Web Service dal repository GitHub.

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`

Variabili opzionali:

```text
ADDON_NAME=TViX Custom UI
ADDON_ID=org.robby.tvix.customui
PUBLIC_URL=https://TUO-SERVIZIO.onrender.com
```

`PUBLIC_URL` è consigliato se usi immagini locali.

Il manifest da aggiungere a Nuvio sarà:

```text
https://TUO-SERVIZIO.onrender.com/manifest.json
```

## Importante

La route `/stream/...` viene inoltrata senza modifiche. Il wrapper interviene soltanto sui metadati di `catalog` e `meta`.

Se un client ignora `posterShape: "square"`, la forma finale della card dipende dal frontend del client stesso. Le immagini quadrate restano comunque disponibili nei metadata.


## IMPORTANTE: ID separati dal TViX originale

Questa versione usa un namespace dedicato (`tvixcustom:`) per i canali mostrati nel catalogo.

Esempio:

```text
TViX originale:   tv:skysportf1
Wrapper/Nuvio:    tvixcustom:tv:skysportf1
```

Quando Nuvio apre il dettaglio, l'ID personalizzato impedisce che venga scelto per errore il `meta` dell'addon TViX originale. Il wrapper rimuove automaticamente `tvixcustom:` prima di interrogare TViX per `meta` e `stream`.

Puoi quindi lasciare installato anche TViX originale, anche se per evitare duplicati di catalogo conviene nasconderlo/disabilitarlo quando usi il wrapper.


## Versione 1.2 - HARD META

Per ogni canale presente in `config/channels.json`, l'endpoint `/meta` viene generato localmente.
TViX non viene interrogato per poster/logo/background del dettaglio.

Test rapido dopo il deploy:

```text
https://TUO-DOMINIO/debug/meta/tv%3Askysportf1
```

Devi vedere gli URL custom configurati.

In Nuvio:
1. rimuovi il vecchio wrapper;
2. reinstalla il manifest aggiornato;
3. metti `TViX Custom UI` sopra TViX originale nell'ordine addon;
4. abilita `Prefer meta from external addon`.


## Versione 1.3 - USER CHANNELS SOURCE

Questa build usa direttamente il `config/channels.json` fornito dall'utente.

Per ogni canale presente in `overrides`:
- catalog usa i valori custom;
- meta/detail viene generato localmente dagli stessi valori;
- TViX NON viene interrogato per poster/logo/background;
- stream continua a essere recuperato da TViX.

Debug:

```text
/debug/source/tv%3Askysportf1
/debug/meta/tv%3Askysportf1
```

Il primo mostra esattamente la voce letta dal tuo `channels.json`.
Il secondo mostra il payload `meta` che il wrapper restituisce a Nuvio.


# VERSIONE 2.0 — STANDALONE (IMPORTANTE)

Questa versione deve SOSTITUIRE TViX dentro Nuvio.

NON tenere installato contemporaneamente il manifest TViX originale.

Flusso:

- Nuvio → catalog → questo addon
- Nuvio → meta/detail → questo addon → `channels.json`
- Nuvio → stream → questo addon → TViX upstream

TViX continua a funzionare come backend stream anche se il suo manifest NON è installato in Nuvio.

Gli ID restano gli ID originali (`tv:skysportf1`, ecc.) per massima compatibilità.

## Installazione pulita

1. Deploya questa build.
2. In Nuvio rimuovi:
   - vecchie versioni TViX Custom UI
   - TViX originale
3. Chiudi completamente Nuvio.
4. Riapri Nuvio.
5. Installa SOLO:
   `https://TUO-DOMINIO/manifest.json`
6. Apri il catalogo Sport da questo addon.

Test:

`/debug/standalone/tv%3Askysportf1`

Deve mostrare:
- `configured: true`
- `metaSource: "LOCAL channels.json"`
- `streamSource: "TViX upstream"`

Per Sky Sport F1 il dettaglio viene quindi generato dal tuo `channels.json`;
TViX viene contattato soltanto per lo stream.


## v2.1 — Robust channel matcher

Il matching di `channels.json` non richiede più un ID byte-per-byte identico.

Supporta:
- maiuscole/minuscole;
- URL encoding;
- `.json`;
- prefissi/suffissi;
- confronto sulla parte finale dell'ID;
- fallback sul nome del canale normalizzato.

Debug consigliato:

```text
/debug/match/tv%3Askysportf1?name=Sky%20Sport%20F1
/debug/transform/tv%3Askysportf1?name=Sky%20Sport%20F1
```

Nel secondo endpoint `after.poster`, `after.logo` e `after.background`
devono essere quelli presenti nel tuo `channels.json`.
