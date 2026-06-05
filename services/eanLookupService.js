const axios = require("axios");
const pool = require("../db");

// ─── Configuração da IA (Anthropic) ───────────────────────────────────────────
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const AI_MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

// Opções aceitas pelo formulário — devem casar com o Flutter
// (lib/features/products/widgets/master_package_options.dart).
const UNIT_OPTIONS = ["UN (Unidade)", "KG (Quilo)", "G (Grama)", "L (Litro)", "ML (Mililitro)"];
const PACKAGE_TYPE_OPTIONS = [
  "Unidade", "Pacote", "Garrafa", "Caixa", "Lata", "Saco", "Pote", "Bandeja", "Tetra Pak",
  "Sachê", "Cápsula", "Frasco", "Vidro", "Cartela", "Blister", "Tubo", "Envelope", "Barra",
  "Galão", "Rolo", "Ampola", "Pouch", "Stand-up Pouch", "Zip", "Cartucho", "Bombona", "Balde",
];

// Cache local em memória: ean (dígitos) -> { result, at }.
// Evita consumo desnecessário da IA quando o mesmo EAN é consultado de novo.
const _cache = new Map();

const onlyDigits = (raw) => String(raw || "").replace(/\D/g, "");

/** Valida o dígito verificador de um EAN-8/EAN-13 (algoritmo GS1). */
const isValidEan = (raw) => {
  const d = onlyDigits(raw);
  if (d.length !== 8 && d.length !== 13) return false;
  const nums = d.split("").map(Number);
  const check = nums.pop();
  let sum = 0;
  for (let i = 0; i < nums.length; i++) {
    const fromRight = nums.length - 1 - i;
    sum += nums[i] * (fromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
};

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "Você identifica produtos de varejo a partir do código de barras (EAN/GTIN) e retorna dados " +
  "estruturados para pré-preencher um cadastro. Pesquise na web por fontes confiáveis " +
  "(fabricante, marca, nome comercial, conteúdo, peso e imagens oficiais). Responda SEMPRE e " +
  "SOMENTE com UM objeto JSON válido, sem markdown e sem comentários.";

const buildUserPrompt = (ean) => `EAN/GTIN: ${ean}

Identifique este produto e retorne SOMENTE um objeto JSON válido (sem markdown) no formato:
{
  "found": true|false,
  "name": string|null,
  "description": string|null,
  "brand": string|null,
  "manufacturer": string|null,
  "category": string|null,
  "sub_category": string|null,
  "unit_of_measure": null | um de ${JSON.stringify(UNIT_OPTIONS)},
  "package_type": null | um de ${JSON.stringify(PACKAGE_TYPE_OPTIONS)},
  "content": number|null,
  "weight": number|null,
  "images": [string],
  "brand_details": {"name": string|null, "description": string|null, "origin_country": string|null}|null
}

Regras:
- "content" é o valor numérico do conteúdo na unidade de medida (ex.: 350 para 350ml).
- "weight" é o peso aproximado em quilogramas (ex.: 0.4).
- "unit_of_measure" e "package_type" DEVEM ser exatamente um dos valores listados (ou null).
- NÃO invente URLs de imagens: retorne sempre "images": []. As imagens são obtidas de outra fonte.
- Se não identificar o produto com segurança, retorne {"found": false} e os demais campos null/[].
- NÃO invente dados.`;

// ─── Chamada à IA ─────────────────────────────────────────────────────────────

const _collectText = (content) =>
  Array.isArray(content)
    ? content.filter((b) => b && b.type === "text").map((b) => b.text).join("\n")
    : "";

const _callAnthropic = async (ean, { withWebSearch }) => {
  const body = {
    model: AI_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(ean) }],
  };
  if (withWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
  }
  const { data } = await axios.post(ANTHROPIC_URL, body, {
    headers: {
      "x-api-key": process.env.API_KEY_IA,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    timeout: 60000,
  });
  return _collectText(data.content);
};

// Tenta com busca na web; se a conta/modelo não suportar a ferramenta (400/404),
// repete usando apenas o conhecimento do modelo.
const _askAi = async (ean) => {
  try {
    return await _callAnthropic(ean, { withWebSearch: true });
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 400 || status === 404) {
      return _callAnthropic(ean, { withWebSearch: false });
    }
    throw err;
  }
};

// ─── Imagem real via Open Food Facts (API pública, sem chave) ──────────────────

// A IA não fornece imagens confiáveis (URLs alucinadas). A foto vem da Open Food
// Facts, que indexa produtos por código de barras e expõe imagens oficiais.
const _fetchOpenFoodFacts = async (ean) => {
  try {
    const { data } = await axios.get(`https://world.openfoodfacts.org/api/v2/product/${ean}.json`, {
      params: { fields: "product_name,brands,quantity,image_url,image_front_url,image_front_small_url" },
      timeout: 15000,
      // A Open Food Facts pede um User-Agent identificável.
      headers: { "User-Agent": "FornecePro/1.0 (cadastro automatico por EAN)" },
    });
    if (!data || data.status !== 1 || !data.product) return null;
    const p = data.product;
    const image = p.image_front_url || p.image_url || p.image_front_small_url || null;
    return {
      image: typeof image === "string" && image.trim() ? image.trim() : null,
      name: p.product_name && p.product_name.trim() ? p.product_name.trim() : null,
      brand: p.brands ? String(p.brands).split(",")[0].trim() || null : null,
    };
  } catch (_) {
    return null;
  }
};

// ─── Normalização ─────────────────────────────────────────────────────────────

const _extractJson = (text) => {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
};

const _toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const _pickEnum = (value, options) => {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  const exact = options.find((o) => o.toLowerCase() === v);
  if (exact) return exact;
  return options.find((o) => o.toLowerCase().includes(v) || v.includes(o.toLowerCase())) || null;
};

const _normalize = (raw, ean) => {
  if (!raw || raw.found === false) return { found: false, ean };
  const images = Array.isArray(raw.images) ? raw.images.filter((u) => typeof u === "string" && u.trim()) : [];
  const bd = raw.brand_details || {};
  return {
    found: true,
    ean,
    name: raw.name || null,
    description: raw.description || null,
    brand: raw.brand || null,
    manufacturer: raw.manufacturer || null,
    category: raw.category || null,
    subCategory: raw.sub_category || null,
    unitOfMeasure: _pickEnum(raw.unit_of_measure, UNIT_OPTIONS),
    packageType: _pickEnum(raw.package_type, PACKAGE_TYPE_OPTIONS),
    content: _toNumber(raw.content),
    weight: _toNumber(raw.weight),
    mainImage: images[0] || null,
    images,
    brandDetails: {
      name: bd.name || raw.brand || null,
      description: bd.description || null,
      originCountry: bd.origin_country || null,
    },
  };
};

// ─── Log (defensivo — tabela registrada em DB_CHANGES_NEEDED.md) ───────────────

const _log = async ({ ean, userId, email, found, processingMs, source }) => {
  try {
    await pool.query(
      `INSERT INTO ean_lookup_logs (ean, user_id, email, found, processing_ms, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ean, userId || null, email || null, !!found, processingMs, source],
    );
  } catch (err) {
    // A tabela pode ainda não existir (ver DB_CHANGES_NEEDED.md). Não quebra a busca.
    console.error("eanLookupService log error:", err.message);
  }
};

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Busca dados de um produto a partir do EAN usando a IA (Anthropic).
 * Não persiste nada do produto — apenas retorna a sugestão para revisão.
 */
const searchByEan = async (ean, { userId, email } = {}) => {
  const started = Date.now();
  const digits = onlyDigits(ean);

  if (!isValidEan(digits)) {
    const error = new Error("EAN inválido. Verifique o código de barras.");
    error.statusCode = 400;
    throw error;
  }

  // 1) Cache local
  const cached = _cache.get(digits);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    const processingMs = Date.now() - started;
    _log({ ean: digits, userId, email, found: cached.result.found, processingMs, source: "cache" });
    return { ...cached.result, cached: true, processingMs };
  }

  // 2) Foto + dados de fallback via Open Food Facts (em paralelo com a IA).
  const offPromise = _fetchOpenFoodFacts(digits);

  // 3) IA
  let text;
  try {
    text = await _askAi(digits);
  } catch (err) {
    const status = err.response && err.response.status;
    const error = new Error(status === 401 ? "Falha de autenticação com a IA." : "Erro ao consultar a IA. Tente novamente.");
    error.statusCode = 502;
    error.cause = err.response ? err.response.data : err.message;
    throw error;
  }

  const result = _normalize(_extractJson(text), digits);

  // 4) A imagem REAL vem exclusivamente da Open Food Facts — as URLs sugeridas
  //    pela IA são inválidas e por isso são descartadas. Também preenchemos
  //    lacunas de nome/marca quando a IA não as identificou.
  const off = await offPromise;
  result.mainImage = off && off.image ? off.image : null;
  result.images = result.mainImage ? [result.mainImage] : [];
  if (off) {
    if (!result.name && off.name) result.name = off.name;
    if (!result.brand && off.brand) result.brand = off.brand;
    if (!result.found && (off.name || off.image)) result.found = true;
  }

  // Só cacheia quando encontrou — permite nova tentativa de EANs não resolvidos.
  if (result.found) _cache.set(digits, { result, at: Date.now() });

  const processingMs = Date.now() - started;
  _log({ ean: digits, userId, email, found: result.found, processingMs, source: "ai" });

  return { ...result, cached: false, processingMs };
};

module.exports = { searchByEan, isValidEan };
