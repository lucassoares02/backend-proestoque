const service = require("../services/campaignsService");

const findAll = async (req, res) => {
  const { companyId } = req.params;
  try {
    const data = await service.findAll(companyId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching campaigns:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch campaigns" });
  }
};

const findActive = async (req, res) => {
  const { companyId } = req.params;
  try {
    await service.pauseExpired();
    const data = await service.findActive(companyId);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching active campaigns:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch campaigns" });
  }
};

const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const item = await service.find(id);
    if (!item) return res.status(404).json({ success: false, error: "Campaign not found" });
    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    console.error("Error fetching campaign:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch campaign" });
  }
};

const create = async (req, res) => {
  const body = req.body;
  if (!body?.companyId || !body?.title) {
    return res.status(400).json({ success: false, error: "companyId e title são obrigatórios" });
  }
  try {
    const item = await service.create(body);
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error("Error creating campaign:", error);
    return res.status(500).json({ success: false, error: "Failed to create campaign" });
  }
};

const update = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const updated = await service.update({ ...req.body, id: parseInt(id) });
    if (!updated) return res.status(404).json({ success: false, error: "Campaign not found" });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating campaign:", error);
    return res.status(500).json({ success: false, error: "Failed to update campaign" });
  }
};

const toggle = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const updated = await service.toggle(id);
    if (!updated) return res.status(404).json({ success: false, error: "Campaign not found" });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("Error toggling campaign:", error);
    return res.status(500).json({ success: false, error: "Failed to toggle campaign" });
  }
};

const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const deleted = await service.remove(id);
    if (!deleted) return res.status(404).json({ success: false, error: "Campaign not found" });
    return res.status(200).json({ success: true, data: deleted });
  } catch (error) {
    console.error("Error deleting campaign:", error);
    return res.status(500).json({ success: false, error: "Failed to delete campaign" });
  }
};

const registerView = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    await service.registerView(id);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error registering view:", error);
    return res.status(500).json({ success: false, error: "Failed to register view" });
  }
};

const registerClick = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    await service.registerClick(id);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error registering click:", error);
    return res.status(500).json({ success: false, error: "Failed to register click" });
  }
};

const getMetrics = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const metrics = await service.getMetrics(id);
    if (!metrics) return res.status(404).json({ success: false, error: "Campaign not found" });
    return res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch metrics" });
  }
};

module.exports = { findAll, findActive, find, create, update, toggle, remove, registerView, registerClick, getMetrics };
