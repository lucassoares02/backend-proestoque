const service = require("../services/storyService");

const findAllBySupplier = async (req, res) => {
  const { companyId } = req.params;
  if (!companyId || isNaN(companyId)) {
    return res.status(400).json({ success: false, error: "Invalid companyId" });
  }
  try {
    const data = await service.findAllBySupplier(parseInt(companyId));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching stories:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch stories" });
  }
};

const findActive = async (req, res) => {
  const { companyId } = req.params;
  if (!companyId || isNaN(companyId)) {
    return res.status(400).json({ success: false, error: "Invalid companyId" });
  }
  try {
    const data = await service.findActiveByCompany(parseInt(companyId));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching active stories:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch stories" });
  }
};

const find = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const item = await service.find(parseInt(id));
    if (!item) return res.status(404).json({ success: false, error: "Story not found" });
    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    console.error("Error fetching story:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch story" });
  }
};

const create = async (req, res) => {
  const body = req.body;
  if (!body?.companyId || !body?.mediaUrl) {
    return res.status(400).json({ success: false, error: "companyId e mediaUrl são obrigatórios" });
  }
  try {
    const item = await service.create(body);
    return res.status(201).json({ success: true, data: item });
  } catch (error) {
    console.error("Error creating story:", error);
    return res.status(500).json({ success: false, error: "Failed to create story" });
  }
};

const update = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const updated = await service.update({ ...req.body, id: parseInt(id) });
    if (!updated) return res.status(404).json({ success: false, error: "Story not found" });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating story:", error);
    return res.status(500).json({ success: false, error: "Failed to update story" });
  }
};

const toggle = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const updated = await service.toggle(parseInt(id));
    if (!updated) return res.status(404).json({ success: false, error: "Story not found" });
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("Error toggling story:", error);
    return res.status(500).json({ success: false, error: "Failed to toggle story" });
  }
};

const remove = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const deleted = await service.remove(parseInt(id));
    if (!deleted) return res.status(404).json({ success: false, error: "Story not found" });
    return res.status(200).json({ success: true, data: deleted });
  } catch (error) {
    console.error("Error deleting story:", error);
    return res.status(500).json({ success: false, error: "Failed to delete story" });
  }
};

const recordView = async (req, res) => {
  const { id } = req.params;
  const { viewerCompanyId } = req.body;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  if (!viewerCompanyId) return res.status(400).json({ success: false, error: "viewerCompanyId required" });
  try {
    await service.recordView(parseInt(id), parseInt(viewerCompanyId));
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error recording view:", error);
    return res.status(500).json({ success: false, error: "Failed to record view" });
  }
};

const recordClick = async (req, res) => {
  const { id } = req.params;
  const { viewerCompanyId } = req.body;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    await service.recordClick(parseInt(id), parseInt(viewerCompanyId || 0));
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error recording click:", error);
    return res.status(500).json({ success: false, error: "Failed to record click" });
  }
};

const recordReaction = async (req, res) => {
  const { id } = req.params;
  const { viewerCompanyId, reactionType } = req.body;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  if (!viewerCompanyId) return res.status(400).json({ success: false, error: "viewerCompanyId required" });
  try {
    await service.recordReaction(parseInt(id), parseInt(viewerCompanyId), reactionType);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error recording reaction:", error);
    return res.status(500).json({ success: false, error: "Failed to record reaction" });
  }
};

const addComment = async (req, res) => {
  const { id } = req.params;
  const { viewerCompanyId, content } = req.body;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  if (!viewerCompanyId || !content) {
    return res.status(400).json({ success: false, error: "viewerCompanyId e content são obrigatórios" });
  }
  try {
    const comment = await service.addComment(parseInt(id), parseInt(viewerCompanyId), content);
    return res.status(201).json({ success: true, data: comment });
  } catch (error) {
    console.error("Error adding comment:", error);
    return res.status(500).json({ success: false, error: "Failed to add comment" });
  }
};

const getComments = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const comments = await service.getComments(parseInt(id));
    return res.status(200).json({ success: true, data: comments });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch comments" });
  }
};

const getMetrics = async (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(id)) return res.status(400).json({ success: false, error: "Invalid ID" });
  try {
    const metrics = await service.getMetrics(parseInt(id));
    if (!metrics) return res.status(404).json({ success: false, error: "Story not found" });
    return res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch metrics" });
  }
};

module.exports = {
  findAllBySupplier,
  findActive,
  find,
  create,
  update,
  toggle,
  remove,
  recordView,
  recordClick,
  recordReaction,
  addComment,
  getComments,
  getMetrics,
};
