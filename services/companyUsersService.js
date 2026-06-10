const crypto = require("crypto");
const pool = require("../db");
const { sendEmailSmtp } = require("./mailerService");
const { createNotification } = require("./notificationService");

// URL base do portal (Flutter Web usa hash routing → links precisam de "/#/").
const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://proestoque-8a63e.web.app";

// ── helpers ──────────────────────────────────────────────────────────────────

const _checkPermission = async (companyId, userId) => {
  const r = await pool.query(
    `SELECT role FROM users_companies
     WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
    [companyId, userId],
  );
  const role = r.rows[0]?.role;
  if (!role || (role !== "owner" && role !== "admin")) {
    throw new Error("Sem permissão para gerenciar usuários desta empresa.");
  }
};

const _companyAndInviter = async (companyId, inviterId) => {
  const r = await pool.query(
    `SELECT c.nome_fantasia, c.razao_social, u.name AS inviter_name
       FROM companies c, users u
      WHERE c.id = $1 AND u.id = $2`,
    [companyId, inviterId],
  );
  if (!r.rows[0]) throw new Error("Empresa ou usuário não encontrado.");
  const row = r.rows[0];
  return {
    companyName: row.nome_fantasia || row.razao_social,
    inviterName: row.inviter_name || "Alguém",
  };
};

// ── listMembers ───────────────────────────────────────────────────────────────

const listMembers = async (companyId) => {
  const membersResult = await pool.query(
    `SELECT uc.user_id, uc.role, uc.status, uc.relation_type, uc.created_at,
            u.name, u.email
       FROM users_companies uc
       JOIN users u ON u.id = uc.user_id
      WHERE uc.company_id = $1
      ORDER BY uc.created_at ASC`,
    [companyId],
  );

  const invitesResult = await pool.query(
    `SELECT id, email, name, status, role, relation_type,
            invited_by, accepted_at, declined_at, expires_at, created_at
       FROM company_invites
      WHERE company_id = $1
        AND status IN ('pending','declined')
      ORDER BY created_at DESC`,
    [companyId],
  );

  return {
    members: membersResult.rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      email: r.email,
      role: r.role,
      status: r.status,
      relationType: r.relation_type,
      joinedAt: r.created_at,
    })),
    invites: invitesResult.rows.map((r) => ({
      inviteId: r.id,
      email: r.email,
      name: r.name,
      status: r.status,
      role: r.role,
      relationType: r.relation_type,
      invitedBy: r.invited_by,
      acceptedAt: r.accepted_at,
      declinedAt: r.declined_at,
      expiresAt: r.expires_at,
      invitedAt: r.created_at,
    })),
  };
};

// ── createInvite ──────────────────────────────────────────────────────────────

const createInvite = async (companyId, { email, name, invitedBy }) => {
  await _checkPermission(companyId, invitedBy);

  // Verificar se já é membro
  const isMember = await pool.query(
    `SELECT uc.user_id FROM users_companies uc
       JOIN users u ON u.id = uc.user_id
      WHERE uc.company_id = $1 AND lower(u.email) = lower($2) AND uc.status = 'active'`,
    [companyId, email],
  );
  if (isMember.rows.length > 0) {
    throw new Error("Este e-mail já é membro desta empresa.");
  }

  // Verificar convite pendente existente (reenviar em vez de duplicar)
  const existing = await pool.query(
    `SELECT id, token FROM company_invites
      WHERE company_id = $1 AND lower(email) = lower($2) AND status = 'pending'`,
    [companyId, email],
  );

  // Buscar relation_type da empresa (via relation_type do usuário convidador)
  const relRow = await pool.query(
    `SELECT relation_type FROM users_companies WHERE company_id = $1 AND user_id = $2`,
    [companyId, invitedBy],
  );
  const relationType = relRow.rows[0]?.relation_type ?? 1;

  let token, inviteId;
  if (existing.rows.length > 0) {
    token = existing.rows[0].token;
    inviteId = existing.rows[0].id;
    // Renova expiração
    await pool.query(
      `UPDATE company_invites
          SET expires_at = now() + INTERVAL '7 days', updated_at = now()
        WHERE id = $1`,
      [inviteId],
    );
  } else {
    token = crypto.randomBytes(32).toString("hex");
    const ins = await pool.query(
      `INSERT INTO company_invites
         (company_id, email, name, token, status, relation_type, role, invited_by)
       VALUES ($1, $2, $3, $4, 'pending', $5, 'member', $6)
       RETURNING id`,
      [companyId, email, name || null, token, relationType, invitedBy],
    );
    inviteId = ins.rows[0].id;
  }

  const { companyName, inviterName } = await _companyAndInviter(companyId, invitedBy);

  await _sendInviteEmail({ email, name, token, companyName, inviterName });

  // Notificar o usuário convidado se já tiver conta
  const userRow = await pool.query(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  if (userRow.rows.length > 0) {
    await createNotification({
      companyId,
      userId: userRow.rows[0].id,
      userType: relationType,
      title: `Convite para ${companyName}`,
      description: `${inviterName} convidou você para participar da empresa ${companyName}.`,
      notificationType: "info",
      entityType: "user_invite",
      entityId: inviteId,
      metadata: { status: "pending", inviterName, companyName, token },
    });
  }

  return { inviteId, token };
};

// ── resendInvite ──────────────────────────────────────────────────────────────

const resendInvite = async (companyId, inviteId, requesterId) => {
  await _checkPermission(companyId, requesterId);

  const r = await pool.query(
    `SELECT * FROM company_invites WHERE id = $1 AND company_id = $2`,
    [inviteId, companyId],
  );
  if (!r.rows[0]) throw new Error("Convite não encontrado.");
  const invite = r.rows[0];

  // Gera novo token e renova expiração
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `UPDATE company_invites
        SET token = $1, status = 'pending', expires_at = now() + INTERVAL '7 days', updated_at = now()
      WHERE id = $2`,
    [token, inviteId],
  );

  const { companyName, inviterName } = await _companyAndInviter(companyId, requesterId);
  await _sendInviteEmail({ email: invite.email, name: invite.name, token, companyName, inviterName });

  return { token };
};

// ── cancelInvite ──────────────────────────────────────────────────────────────

const cancelInvite = async (companyId, inviteId, requesterId) => {
  await _checkPermission(companyId, requesterId);
  const r = await pool.query(
    `UPDATE company_invites
        SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING id`,
    [inviteId, companyId],
  );
  if (!r.rows[0]) throw new Error("Convite não encontrado.");
};

// ── removeMember ─────────────────────────────────────────────────────────────

const removeMember = async (companyId, targetUserId, requesterId) => {
  await _checkPermission(companyId, requesterId);
  if (targetUserId === requesterId) throw new Error("Você não pode remover a si mesmo.");

  const r = await pool.query(
    `UPDATE users_companies
        SET status = 'removed', updated_at = now()
      WHERE company_id = $1 AND user_id = $2
      RETURNING user_id`,
    [companyId, targetUserId],
  );
  if (!r.rows[0]) throw new Error("Usuário não encontrado nesta empresa.");
};

// ── resolveInvite (público) ───────────────────────────────────────────────────

const resolveInvite = async (token) => {
  const r = await pool.query(
    `SELECT ci.*, c.nome_fantasia, c.razao_social, u.name AS inviter_name
       FROM company_invites ci
       JOIN companies c ON c.id = ci.company_id
       LEFT JOIN users u ON u.id = ci.invited_by
      WHERE ci.token = $1`,
    [token],
  );
  if (!r.rows[0]) throw new Error("Convite não encontrado.");
  const inv = r.rows[0];
  return {
    inviteId: inv.id,
    companyId: inv.company_id,
    companyName: inv.nome_fantasia || inv.razao_social,
    email: inv.email,
    name: inv.name,
    status: inv.status,
    role: inv.role,
    inviterName: inv.inviter_name,
    expiresAt: inv.expires_at,
  };
};

// ── acceptInvite (público) ────────────────────────────────────────────────────

const acceptInvite = async (token) => {
  const r = await pool.query(
    `SELECT ci.*, c.nome_fantasia, c.razao_social, u.name AS inviter_name, u.id AS inviter_id
       FROM company_invites ci
       JOIN companies c ON c.id = ci.company_id
       LEFT JOIN users u ON u.id = ci.invited_by
      WHERE ci.token = $1`,
    [token],
  );
  if (!r.rows[0]) throw new Error("Convite inválido.");
  const inv = r.rows[0];
  if (inv.status !== "pending") throw new Error("Este convite já foi utilizado.");
  if (new Date(inv.expires_at) < new Date()) throw new Error("Este convite expirou.");

  const companyName = inv.nome_fantasia || inv.razao_social;

  // Verificar se já existe usuário com esse email
  const userRow = await pool.query(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [inv.email],
  );

  if (userRow.rows.length === 0) {
    // Usuário não cadastrado: sinalizar para o frontend redirecionar para /register
    return { needsRegistration: true, token, email: inv.email, companyName };
  }

  const userId = userRow.rows[0].id;

  // Verificar se já é membro
  const alreadyMember = await pool.query(
    `SELECT user_id FROM users_companies
      WHERE company_id = $1 AND user_id = $2 AND status = 'active'`,
    [inv.company_id, userId],
  );
  if (alreadyMember.rows.length === 0) {
    // Reativa vínculo previamente removido, ou cria um novo.
    const reactivated = await pool.query(
      `UPDATE users_companies
          SET status = 'active', role = $3, updated_at = now()
        WHERE company_id = $1 AND user_id = $2
        RETURNING user_id`,
      [inv.company_id, userId, inv.role],
    );
    if (reactivated.rows.length === 0) {
      await pool.query(
        `INSERT INTO users_companies (company_id, user_id, relation_type, role, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [inv.company_id, userId, inv.relation_type, inv.role],
      );
    }
  }

  await pool.query(
    `UPDATE company_invites
        SET status = 'accepted', accepted_at = now(), updated_at = now()
      WHERE id = $1`,
    [inv.id],
  );

  // Notificar o convidador
  if (inv.inviter_id) {
    const accepterRow = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
    const accepterName = accepterRow.rows[0]?.name || inv.email;
    await createNotification({
      companyId: inv.company_id,
      userId: inv.inviter_id,
      userType: inv.relation_type,
      title: `${accepterName} aceitou o convite`,
      description: `${accepterName} agora faz parte de ${companyName}.`,
      notificationType: "success",
      entityType: "user_invite",
      entityId: inv.id,
      metadata: { status: "accepted", accepterName, companyName },
    });
  }

  return { accepted: true, companyId: inv.company_id, companyName };
};

// ── declineInvite (público) ───────────────────────────────────────────────────

const declineInvite = async (token) => {
  const r = await pool.query(
    `SELECT ci.*, c.nome_fantasia, c.razao_social, ci.invited_by AS inviter_id
       FROM company_invites ci
       JOIN companies c ON c.id = ci.company_id
      WHERE ci.token = $1`,
    [token],
  );
  if (!r.rows[0]) throw new Error("Convite inválido.");
  const inv = r.rows[0];
  if (inv.status !== "pending") throw new Error("Este convite já foi utilizado.");

  await pool.query(
    `UPDATE company_invites
        SET status = 'declined', declined_at = now(), updated_at = now()
      WHERE id = $1`,
    [inv.id],
  );

  const companyName = inv.nome_fantasia || inv.razao_social;
  if (inv.inviter_id) {
    await createNotification({
      companyId: inv.company_id,
      userId: inv.inviter_id,
      userType: inv.relation_type,
      title: `Convite recusado`,
      description: `${inv.email} recusou o convite para ${companyName}.`,
      notificationType: "warning",
      entityType: "user_invite",
      entityId: inv.id,
      metadata: { status: "declined", email: inv.email, companyName },
    });
  }

  return { declined: true };
};

// ── acceptInviteAfterRegistration (chamado após criar conta via /register?invite=) ──

const acceptInviteAfterRegistration = async (token, userId) => {
  const r = await pool.query(
    `SELECT * FROM company_invites WHERE token = $1 AND status = 'pending'`,
    [token],
  );
  if (!r.rows[0]) return null;
  const inv = r.rows[0];

  // Segurança: o e-mail do usuário recém-criado deve corresponder ao do convite.
  const u = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
  const userEmail = u.rows[0]?.email;
  if (!userEmail || userEmail.toLowerCase() !== inv.email.toLowerCase()) return null;

  const exists = await pool.query(
    `SELECT user_id FROM users_companies WHERE company_id = $1 AND user_id = $2`,
    [inv.company_id, userId],
  );
  if (exists.rows.length === 0) {
    await pool.query(
      `INSERT INTO users_companies (company_id, user_id, relation_type, role, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [inv.company_id, userId, inv.relation_type, inv.role],
    );
  }

  await pool.query(
    `UPDATE company_invites
        SET status = 'accepted', accepted_at = now(), updated_at = now()
      WHERE id = $1`,
    [inv.id],
  );

  return { companyId: inv.company_id };
};

// ── email helper ──────────────────────────────────────────────────────────────

const _sendInviteEmail = async ({ email, name, token, companyName, inviterName }) => {
  // Flutter Web usa hash routing → o caminho da rota precisa vir depois de "/#/".
  const acceptLink = `${FRONTEND_URL}/#/invite/${token}/accept`;
  const declineLink = `${FRONTEND_URL}/#/invite/${token}/decline`;
  const displayName = name ? `, ${name}` : "";

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="background:#1E3A5F;padding:32px 40px;text-align:center">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:-0.5px">FornecePro</h1>
        </td></tr>
        <tr><td style="padding:40px 40px 32px">
          <h2 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 8px">Você foi convidado!</h2>
          <p style="color:#64748b;font-size:15px;margin:0 0 24px">
            Olá${displayName},<br><br>
            <strong>${inviterName}</strong> convidou você para participar da empresa
            <strong>${companyName}</strong> no FornecePro.
          </p>
          <p style="color:#64748b;font-size:14px;margin:0 0 32px">
            Clique em <strong>Aceitar</strong> para se juntar à equipe ou <strong>Recusar</strong>
            caso não reconheça este convite. O link expira em 7 dias.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto">
            <tr>
              <td style="padding-right:12px">
                <a href="${acceptLink}"
                   style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;
                          padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700">
                  ✅ Aceitar convite
                </a>
              </td>
              <td>
                <a href="${declineLink}"
                   style="display:inline-block;background:#ffffff;color:#dc2626;text-decoration:none;
                          padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;
                          border:1.5px solid #dc2626">
                  ❌ Recusar
                </a>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 40px 32px;border-top:1px solid #f1f5f9">
          <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center">
            Se você não reconhece este convite, ignore este e-mail.<br>
            © FornecePro · <a href="${FRONTEND_URL}" style="color:#94a3b8">portal.proestoque.profair.click</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await sendEmailSmtp(
    `"FornecePro" <${process.env.MAIL_FROM}>`,
    email,
    `Você foi convidado para participar de uma empresa no FornecePro`,
    `${inviterName} convidou você para ${companyName}. Acesse: ${acceptLink}`,
    html,
  );
};

module.exports = {
  listMembers,
  createInvite,
  resendInvite,
  cancelInvite,
  removeMember,
  resolveInvite,
  acceptInvite,
  declineInvite,
  acceptInviteAfterRegistration,
};
