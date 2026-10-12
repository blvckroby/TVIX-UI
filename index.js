
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 7000);

const DEFAULT_ORIGIN_MANIFEST = "https://tvix.qzz.io/eyJtZWRpYWZsb3dNYXN0ZXIiOnRydWUsIm1lZGlhRmxvd1Byb3h5VXJsIjoiaHR0cHM6Ly9ibGFwcm8tcDZxZmZhLmZseS5kZXYvIiwibWVkaWFGbG93UHJveHlQYXNzd29yZCI6IlNjYXRvcmNoaWE3IiwiZHZyRW5hYmxlZCI6ZmFsc2UsImRpc2FibGVMaXZlVHYiOmZhbHNlLCJ2YXZvb05vTWZwRW5hYmxlZCI6dHJ1ZX0=/manifest.json";
const ORIGIN_MANIFEST = process.env.ORIGIN_MANIFEST || DEFAULT_ORIGIN_MANIFEST;
const ORIGIN_BASE = ORIGIN_MANIFEST.replace(/\/manifest\.json(?:\?.*)?$/, "");

const CUSTOM_NAME = process.env.ADDON_NAME || "TViX Custom UI";
const CUSTOM_ID = process.env.ADDON_ID || "org.robby.tvix.customui";

function toCustomId(id) {
  return id;
}

function toOriginId(id) {
  return id;
}

function upstreamUrlFromRequest(req) {
  return `${ORIGIN_BASE}${req.originalUrl}`;
}

function loadOverrides() {
  try {
    const file = path.join(__dirname, "config", "channels.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed.overrides || {};
  } catch (error) {
    console.error("Impossibile leggere config/channels.json:", error);
    return {};
  }
}

function normalizeValue(value) {
  if (value === undefined || value === null) return "";

  let s = String(value).trim();

  try {
    s = decodeURIComponent(s);
  } catch {}

  s = s
    .replace(/\.json$/i, "")
    .trim()
    .toLowerCase();

  return s;
}

function compactValue(value) {
  return normalizeValue(value).replace(/[^a-z0-9]/g, "");
}

function channelLeaf(value) {
  const normalized = normalizeValue(value);

  // tv:skysportf1 -> skysportf1
  // eventuali namespace/prefissi -> usa anche l'ultima parte significativa.
  const parts = normalized.split(":").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : normalized;
}

function findOverrideMatch(id, name = null) {
  const overrides = loadOverrides();
  const entries = Object.entries(overrides);

  const idRaw = normalizeValue(id);
  const idCompact = compactValue(id);
  const idLeaf = compactValue(channelLeaf(id));

  const nameRaw = normalizeValue(name);
  const nameCompact = compactValue(name);

  // 1) Exact key.
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    return { key: id, override: overrides[id], reason: "exact-id" };
  }

  // 2) Normalized/compact IDs.
  for (const [key, override] of entries) {
    const keyRaw = normalizeValue(key);
    const keyCompact = compactValue(key);
    const keyLeaf = compactValue(channelLeaf(key));

    if (
      keyRaw === idRaw ||
      keyCompact === idCompact ||
      (keyLeaf && idLeaf && keyLeaf === idLeaf)
    ) {
      return { key, override, reason: "normalized-id" };
    }
  }

  // 3) Exact/normalized configured channel name.
  if (name) {
    for (const [key, override] of entries) {
      const configuredName = override?.name;

      if (
        configuredName &&
        (
          normalizeValue(configuredName) === nameRaw ||
          compactValue(configuredName) === nameCompact
        )
      ) {
        return { key, override, reason: "normalized-name" };
      }
    }
  }

  // 4) Conservative prefix/suffix fallback for IDs such as
  // tv:skysportf1:something or provider:tv:skysportf1.
  for (const [key, override] of entries) {
    const keyLeaf = compactValue(channelLeaf(key));
    if (
      keyLeaf &&
      idCompact &&
      (idCompact.endsWith(keyLeaf) || idCompact.startsWith(keyLeaf))
    ) {
      return { key, override, reason: "id-fragment" };
    }
  }

  return null;
}

function findOverride(id, name = null) {
  return findOverrideMatch(id, name)?.override || null;
}

function buildLocalMeta(requestedId, override, req) {
  const originalId = requestedId;

  const meta = {
    id: originalId,
    type: "tv",
    name: override.name || originalId,
    poster: override.poster || undefined,
    logo: override.logo || undefined,
    background: override.background || undefined,
    description: override.description || "",
    posterShape: "square",
    behaviorHints: {
      defaultVideoId: originalId
    }
  };

  for (const key of ["poster", "logo", "background"]) {
    if (meta[key]) meta[key] = absoluteAsset(meta[key], req);
  }

  return meta;
}

function publicBase(req) {
  const forced = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (forced) return forced;
  return `${req.protocol}://${req.get("host")}`;
}

function absoluteAsset(value, req) {
  if (!value || typeof value !== "string") return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${publicBase(req)}${value}`;
  return value;
}

function customizeMeta(meta, req) {
  if (!meta || typeof meta !== "object") return meta;

  const originalId = toOriginId(meta.id);
  const match = findOverrideMatch(originalId, meta.name);
  const override = match?.override || {};

  console.log("[CATALOG META]", {
    incomingId: meta.id,
    incomingName: meta.name,
    matchedKey: match?.key || null,
    matchReason: match?.reason || null,
    customPoster: override.poster || null
  });

  const out = {
    ...meta,
    ...override,

    // IMPORTANTE:
    // usiamo un ID dedicato così Nuvio non può risolvere il dettaglio
    // attraverso l'addon TViX originale installato in parallelo.
    id: toCustomId(originalId),

    // Campo usato dai client compatibili Stremio/Nuvio per la forma della card.
    posterShape: "square"
  };

  // Mantieni coerente un eventuale defaultVideoId.
  if (out.behaviorHints?.defaultVideoId) {
    out.behaviorHints = {
      ...out.behaviorHints,
      defaultVideoId: toCustomId(toOriginId(out.behaviorHints.defaultVideoId))
    };
  }

  // Alcuni meta TV possono contenere "videos".
  // Se il loro id coincide con l'id del canale, lo namespaciamo.
  if (Array.isArray(out.videos)) {
    out.videos = out.videos.map(video => {
      if (!video || typeof video !== "object") return video;
      const videoId = video.id;
      return {
        ...video,
        id: videoId ? toCustomId(toOriginId(videoId)) : videoId
      };
    });
  }

  // Asset locali -> URL assoluti.
  for (const key of ["poster", "logo", "background"]) {
    if (out[key]) out[key] = absoluteAsset(out[key], req);
  }

  return out;
}

function customizePayload(payload, req) {
  if (!payload || typeof payload !== "object") return payload;

  if (Array.isArray(payload.metas)) {
    return {
      ...payload,
      metas: payload.metas.map(meta => customizeMeta(meta, req))
    };
  }

  if (payload.meta) {
    return {
      ...payload,
      meta: customizeMeta(payload.meta, req)
    };
  }

  return payload;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "TViX-Custom-UI/1.0"
    },
    redirect: "follow"
  });

  const text = await response.text();

  if (!response.ok) {
    const err = new Error(`TViX upstream ${response.status}: ${text.slice(0, 300)}`);
    err.status = response.status;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    const err = new Error("TViX ha restituito una risposta non JSON.");
    err.status = 502;
    throw err;
  }
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${CUSTOM_NAME}</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:900px;margin:48px auto;padding:0 20px;line-height:1.5}
code{background:#eee;padding:2px 6px;border-radius:6px}
.card{border:1px solid #ddd;border-radius:16px;padding:20px;margin:16px 0}
</style>
</head>
<body>
<h1>${CUSTOM_NAME}</h1>
<div class="card">
<p><strong>Standalone mode attivo.</strong> In Nuvio deve essere installato SOLO questo addon, non TViX originale.</p>
<p>Manifest: <code>/manifest.json</code></p>
<p>Inspector canali: <code>/channels</code></p>
</div>
</body>
</html>`);
});

app.get("/manifest.json", async (req, res) => {
  try {
    const manifest = await fetchJson(ORIGIN_MANIFEST);

    res.json({
      ...manifest,
      id: CUSTOM_ID,
      name: CUSTOM_NAME,
      version: "2.1.0",
      description: "TViX Standalone Custom · metadata grafici personalizzati + stream TViX",
      resources: ["catalog", "meta", "stream"],
      types: ["tv"],
      behaviorHints: {
        ...(manifest.behaviorHints || {}),
        configurable: false
      }
    });
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get("/debug/transform/:id", (req, res) => {
  let id = req.params.id;
  try { id = decodeURIComponent(id); } catch {}
  const name = typeof req.query.name === "string" ? req.query.name : id;

  const before = {
    id,
    type: "tv",
    name,
    poster: "ORIGINAL_POSTER",
    logo: "ORIGINAL_LOGO",
    background: "ORIGINAL_BACKGROUND",
    posterShape: "poster"
  };

  const after = customizeMeta(before, req);

  return res.json({ before, after });
});

// Cataloghi: inoltra a TViX e modifica SOLO i metadata visivi.
app.get(/^\/catalog\/.+/, async (req, res) => {
  try {
    const upstream = upstreamUrlFromRequest(req);
    const payload = await fetchJson(upstream);
    res.json(customizePayload(payload, req));
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Meta HARD:
// se il canale è presente in channels.json NON interroghiamo TViX per i metadata.
// In questo modo logo/background/poster del dettaglio arrivano esclusivamente dal wrapper.
app.get(/^\/meta\/.+/, async (req, res) => {
  try {
    // Formati previsti:
    // /meta/tv/tvixcustom:tv:skysportf1.json
    // /meta/tv/tv:skysportf1.json
    const match = req.path.match(/^\/meta\/([^/]+)\/(.+?)(?:\.json)?$/i);
    const requestedType = match?.[1] || "tv";
    let requestedId = match?.[2] || "";

    try {
      requestedId = decodeURIComponent(requestedId);
    } catch {}

    if (requestedId.endsWith(".json")) {
      requestedId = requestedId.slice(0, -5);
    }

    const originalId = toOriginId(requestedId);
    const override = findOverride(originalId);

    console.log("[META]", {
      requestedType,
      requestedId,
      originalId,
      hasOverride: Boolean(override)
    });

    if (override) {
      return res.json({
        meta: buildLocalMeta(originalId, override, req)
      });
    }

    // Solo i canali non configurati continuano a usare il meta TViX.
    const upstream = upstreamUrlFromRequest(req);
    const payload = await fetchJson(upstream);
    return res.json(customizePayload(payload, req));
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Stream: pass-through PURO. Non tocchiamo URL, proxy, headers o comportamento TViX.
app.get(/^\/stream\/.+/, async (req, res) => {
  try {
    const upstream = upstreamUrlFromRequest(req);
    console.log("[STREAM]", req.originalUrl, "=>", upstream);
    const payload = await fetchJson(upstream);
    res.json(payload);
  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message });
  }
});


// Debug rapido: verifica esattamente il meta che Nuvio dovrebbe ricevere.

app.get("/debug/match/:id", (req, res) => {
  let id = req.params.id;
  try { id = decodeURIComponent(id); } catch {}

  const name = typeof req.query.name === "string" ? req.query.name : null;
  const match = findOverrideMatch(id, name);

  return res.json({
    input: { id, name },
    normalized: {
      id: normalizeValue(id),
      compactId: compactValue(id),
      leaf: channelLeaf(id),
      compactLeaf: compactValue(channelLeaf(id)),
      name: normalizeValue(name),
      compactName: compactValue(name)
    },
    matched: Boolean(match),
    matchedKey: match?.key || null,
    matchReason: match?.reason || null,
    override: match?.override || null
  });
});

app.get("/debug/standalone/:id", (req, res) => {
  let id = req.params.id;
  try { id = decodeURIComponent(id); } catch {}

  const override = findOverride(id);
  return res.json({
    mode: "standalone",
    originalAddonMustBeRemovedFromNuvio: true,
    id,
    configured: Boolean(override),
    metaSource: override ? "LOCAL channels.json" : "TViX fallback",
    streamSource: "TViX upstream",
    override: override || null
  });
});

app.get("/debug/source/:id", (req, res) => {
  let id = req.params.id;
  try { id = decodeURIComponent(id); } catch {}

  const originalId = toOriginId(id);
  const override = findOverride(originalId);

  if (!override) {
    return res.status(404).json({
      ok: false,
      requestedId: id,
      originalId,
      source: "config/channels.json",
      message: "Canale non presente nel channels.json caricato"
    });
  }

  return res.json({
    ok: true,
    requestedId: id,
    originalId,
    source: "config/channels.json",
    override
  });
});

app.get("/debug/meta/:id", (req, res) => {
  let id = req.params.id;
  try { id = decodeURIComponent(id); } catch {}
  const originalId = toOriginId(id);
  const override = findOverride(originalId);

  if (!override) {
    return res.status(404).json({
      ok: false,
      id,
      originalId,
      message: "Nessun override trovato in config/channels.json"
    });
  }

  return res.json({
    ok: true,
    requestedId: id,
    originalId,
    meta: buildLocalMeta(originalId, override, req)
  });
});

// Inspector semplice: prova categorie TV note e mostra id/nome/poster.
// Utile per compilare config/channels.json.
app.get("/channels", async (req, res) => {
  const genres = [
    "RAI","Mediaset","Sky","Intrattenimento","Sport","Cinema",
    "Documentari","Discovery","News","Generali","Bambini","Pluto"
  ];

  const result = [];
  const errors = [];

  for (const genre of genres) {
    const candidates = [
      `/catalog/tv/streamvix_tv/genre=${encodeURIComponent(genre)}.json`,
      `/catalog/tv/streamvix_tv/genre=${encodeURIComponent(genre)}`
    ];

    let found = false;

    for (const suffix of candidates) {
      try {
        const payload = await fetchJson(`${ORIGIN_BASE}${suffix}`);
        for (const meta of payload.metas || []) {
          result.push({
            genre,
            id: meta.id,
            name: meta.name,
            poster: meta.poster,
            logo: meta.logo,
            background: meta.background,
            posterShape: meta.posterShape
          });
        }
        found = true;
        break;
      } catch (e) {
        // prova la variante successiva
      }
    }

    if (!found) errors.push(genre);
  }

  const escaped = JSON.stringify(result, null, 2)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  res.type("html").send(`<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TViX Channels Inspector</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:30px;line-height:1.4}
pre{white-space:pre-wrap;word-break:break-word;background:#111;color:#eee;padding:18px;border-radius:14px}
small{color:#666}
</style>
</head>
<body>
<h1>TViX Channels Inspector</h1>
<p>Trovati <strong>${result.length}</strong> canali.</p>
${errors.length ? `<p><small>Categorie non lette automaticamente: ${errors.join(", ")}</small></p>` : ""}
<p>Copia l'<strong>id</strong> desiderato in <code>config/channels.json</code>.</p>
<pre>${escaped}</pre>
</body>
</html>`);
});

app.use((req, res) => {
  res.status(404).json({ error: "Route non trovata", path: req.path });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${CUSTOM_NAME} attivo sulla porta ${PORT}`);
  console.log(`Upstream: ${ORIGIN_BASE}`);
});
