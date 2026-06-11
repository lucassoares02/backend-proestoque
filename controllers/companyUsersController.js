const service = require("../services/companyUsersService");
const { generateToken } = require("../helpers/jwt");

// Auth middleware coloca o token decodificado em req.user = { id, email, type }
const _userId = (req) => req.user?.id;

const list = async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  if (!companyId) return res.status(400).json({ success: false, error: "companyId inválido" });
  try {
    const data = await service.listMembers(companyId);
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[companyUsers] list error:", e.message);
    return res.status(500).json({ success: false, error: "Falha ao listar usuários" });
  }
};

const invite = async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const { email, name, role } = req.body || {};
  if (!companyId || !email) {
    return res.status(400).json({ success: false, error: "companyId e email são obrigatórios" });
  }
  try {
    const data = await service.createInvite(companyId, { email, name, role, invitedBy: _userId(req) });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[companyUsers] invite error:", e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
};

const resend = async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const inviteId = parseInt(req.params.inviteId, 10);
  try {
    const data = await service.resendInvite(companyId, inviteId, _userId(req));
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[companyUsers] resend error:", e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
};

const cancel = async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const inviteId = parseInt(req.params.inviteId, 10);
  try {
    await service.cancelInvite(companyId, inviteId, _userId(req));
    return res.json({ success: true });
  } catch (e) {
    console.error("[companyUsers] cancel error:", e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
};

const removeMember = async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  const userId = parseInt(req.params.userId, 10);
  try {
    await service.removeMember(companyId, userId, _userId(req));
    return res.json({ success: true });
  } catch (e) {
    console.error("[companyUsers] removeMember error:", e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
};

// ── públicos (sem auth) ───────────────────────────────────────────────────────

const resolve = async (req, res) => {
  try {
    const data = await service.resolveInvite(req.params.token);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(404).json({ success: false, error: e.message });
  }
};

const accept = async (req, res) => {
  try {
    const data = await service.acceptInvite(req.params.token);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
};

const decline = async (req, res) => {
  try {
    const data = await service.declineInvite(req.params.token);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
};

// Chamado pelo fluxo de registro com convite. Público, mas seguro: o serviço só
// vincula se o e-mail do usuário recém-criado bater com o e-mail do convite.
const acceptAfterRegistration = async (req, res) => {
  const { userId } = req.body || {};
  const { token } = req.params;
  if (!token || !userId) {
    return res.status(400).json({ success: false, error: "token e userId obrigatórios" });
  }
  try {
    const data = await service.acceptInviteAfterRegistration(token, parseInt(userId, 10));
    if (!data) return res.status(400).json({ success: false, error: "Convite inválido ou não corresponde ao usuário." });
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
};

// Convites pendentes do usuário logado (exibidos em Conta → Convites Pendentes)
const myInvites = async (req, res) => {
  const email = req.user?.email;
  if (!email) return res.status(401).json({ success: false, error: "Não autenticado" });
  try {
    const data = await service.listPendingInvitesForUser(email);
    return res.json({ success: true, data });
  } catch (e) {
    console.error("[companyUsers] myInvites error:", e.message);
    return res.status(500).json({ success: false, error: "Falha ao listar convites" });
  }
};

// Cadastro simplificado via convite (sem CNPJ): cria o usuário, vincula à
// empresa do convite e retorna o JWT no mesmo formato do /signin para o
// frontend efetuar login automático.
const registerWithInvite = async (req, res) => {
  const { token } = req.params;
  const { name, password } = req.body || {};
  if (!token || !name || !password) {
    return res.status(400).json({ success: false, error: "token, name e password são obrigatórios" });
  }
  try {
    const data = await service.registerInvitedUser(token, { name, password });
    const jwt = generateToken({ id: data.user.id, email: data.user.email, type: data.user.type });
    return res.status(201).json({
      success: true,
      token: jwt,
      user: data.user,
      data: { companyId: data.companyId, companyName: data.companyName, relationType: data.relationType },
    });
  } catch (e) {
    console.error("[companyUsers] registerWithInvite error:", e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
};

module.exports = {
  list,
  invite,
  resend,
  cancel,
  removeMember,
  resolve,
  accept,
  decline,
  acceptAfterRegistration,
  myInvites,
  registerWithInvite,
};
