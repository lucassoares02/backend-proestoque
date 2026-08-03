const service = require("../services/purchaseSuggestionsService");

const findAll = async (req, res) => {
  try {
    const { company } = req.params;
    if (!company) return res.status(400).json({ success: false, message: "company obrigatório" });
    const data = await service.findAll(parseInt(company));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] findAll error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const find = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "ID inválido" });
    const data = await service.find(parseInt(id));
    if (!data) return res.status(404).json({ success: false, message: "Sugestão não encontrada" });
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] find error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const getProducts = async (req, res) => {
  try {
    const { company } = req.params;
    if (!company) return res.status(400).json({ success: false, message: "company obrigatório" });
    const data = await service.getProducts(parseInt(company));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] getProducts error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const getClients = async (req, res) => {
  try {
    const { company } = req.params;
    if (!company) return res.status(400).json({ success: false, message: "company obrigatório" });
    const data = await service.getClients(parseInt(company));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] getClients error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const create = async (req, res) => {
  try {
    const body = req.body || {};
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ success: false, message: "Corpo da requisição inválido" });
    }
    const data = await service.create(body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] create error:", e);
    return res.status(400).json({ success: false, message: e.message || "Falha ao criar sugestão" });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "ID inválido" });
    const data = await service.update({ ...req.body, id: parseInt(id) });
    if (!data) return res.status(404).json({ success: false, message: "Sugestão não encontrada" });
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] update error:", e);
    return res.status(400).json({ success: false, message: e.message || "Falha ao atualizar sugestão" });
  }
};

const remove = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "ID inválido" });
    const deleted = await service.remove(parseInt(id));
    if (!deleted) return res.status(404).json({ success: false, message: "Sugestão não encontrada" });
    return res.json({ success: true, data: deleted });
  } catch (e) {
    console.error("[purchaseSuggestionsController] remove error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const findForClient = async (req, res) => {
  try {
    const { supplier, client } = req.params;
    if (!supplier || !client) {
      return res.status(400).json({ success: false, message: "supplier e client obrigatórios" });
    }
    const data = await service.findForClient(parseInt(supplier), parseInt(client));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] findForClient error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const addToCart = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.body?.companyId ?? req.body?.company_id;
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: "ID inválido" });
    if (!companyId) return res.status(400).json({ success: false, message: "companyId obrigatório" });
    const data = await service.addToCart(parseInt(id), parseInt(companyId));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[purchaseSuggestionsController] addToCart error:", e);
    return res.status(400).json({ success: false, message: e.message || "Falha ao adicionar ao carrinho" });
  }
};

module.exports = { findAll, find, getProducts, getClients, create, update, remove, findForClient, addToCart };
