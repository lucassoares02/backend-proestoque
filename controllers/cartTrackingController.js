const service = require("../services/cartTrackingService");

const track = async (req, res) => {
  try {
    const {
      supplier_id,
      buyer_company_id,
      buyer_user_id,
      order_id,
      event_type,
      product_id,
      variant_id,
      quantity,
      step_name,
      metadata,
    } = req.body;

    if (!supplier_id || !buyer_company_id || !event_type) {
      return res.status(400).json({ success: false, message: "supplier_id, buyer_company_id e event_type são obrigatórios" });
    }

    const result = await service.saveEvent({
      supplierId: supplier_id,
      buyerCompanyId: buyer_company_id,
      buyerUserId: buyer_user_id ?? null,
      orderId: order_id ?? null,
      eventType: event_type,
      productId: product_id ?? null,
      variantId: variant_id ?? null,
      quantity: quantity ?? null,
      stepName: step_name ?? null,
      metadata: metadata ?? {},
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error("[cartTrackingController] track error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const getSessions = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { period = 30, page = 1, limit = 20, buyer_company_id } = req.query;

    if (!supplierId) {
      return res.status(400).json({ success: false, message: "supplierId obrigatório" });
    }

    const result = await service.getSessions(parseInt(supplierId), {
      period: parseInt(period),
      page: parseInt(page),
      limit: parseInt(limit),
      buyerCompanyId: buyer_company_id ? parseInt(buyer_company_id) : null,
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error("[cartTrackingController] getSessions error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const getTimeline = async (req, res) => {
  try {
    const { supplierId, orderId } = req.params;

    if (!supplierId || !orderId) {
      return res.status(400).json({ success: false, message: "supplierId e orderId obrigatórios" });
    }

    const events = await service.getSessionTimeline(parseInt(supplierId), parseInt(orderId));
    return res.json({ success: true, data: events });
  } catch (e) {
    console.error("[cartTrackingController] getTimeline error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const getMetrics = async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { period = 30 } = req.query;

    if (!supplierId) {
      return res.status(400).json({ success: false, message: "supplierId obrigatório" });
    }

    const metrics = await service.getMetrics(parseInt(supplierId), { period: parseInt(period) });
    return res.json({ success: true, data: metrics });
  } catch (e) {
    console.error("[cartTrackingController] getMetrics error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

const getSessionSummary = async (req, res) => {
  try {
    const { supplierId, orderId } = req.params;
    if (!supplierId || !orderId) {
      return res.status(400).json({ success: false, message: "supplierId e orderId obrigatórios" });
    }
    const summary = await service.getSessionSummary(parseInt(supplierId), parseInt(orderId));
    return res.json({ success: true, data: summary });
  } catch (e) {
    console.error("[cartTrackingController] getSessionSummary error:", e);
    return res.status(500).json({ success: false, message: "Erro interno" });
  }
};

module.exports = { track, getSessions, getTimeline, getSessionSummary, getMetrics };
