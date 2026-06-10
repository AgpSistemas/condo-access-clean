import React, { useState } from "react";
import { LogIn, Save, UserPlus, WifiOff } from "lucide-react";
import Logo from "../logo.png";
import { apiUrl, formatDateTime } from "../config/appConfig.jsx";

function PersonAvatar({ name = "", photoUrl = "" }) {
  const initial = String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className={`avatar ${photoUrl ? "has-photo" : ""}`}>
      {photoUrl ? <img src={photoUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement?.classList.remove("has-photo"); }} /> : null}
      <em>{initial}</em>
    </span>
  );
}


function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}


function StatusBanner({ status, error, lastSyncAt }) {
  if (status !== "offline" && !error) return null;

  return (
    <div className="sync-banner offline">
      <div>
        <WifiOff size={20} />
        <strong>Nao foi possivel atualizar</strong>
        <span>Ultima sincronizacao {formatDateTime(lastSyncAt)}</span>
      </div>
      <small>{error || "Verifique a conexao com a API e tente novamente."}</small>
    </div>
  );
}


function Pagination({ page, totalPages, onPage }) {
  return (
    <div className="pagination-bar">
      <button className="secondary-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Pagina {page} de {totalPages}</span>
      <button className="secondary-button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Proxima</button>
    </div>
  );
}

function usePaged(items, pageSize = 6) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { page: safePage, setPage, totalPages, pageItems };
}

function Metric({ label, value, icon: Icon }) {
  return (
    <article className="metric">
      <Icon size={22} />
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function LocalLogin({ onLogin }) {
  const [mode, setMode] = useState("choice");
  const [email, setEmail] = useState("agpsistemascorp@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (mode === "choice") {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="login-brand">
            <img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} />
            <div><strong>Condo Access</strong><span>Acesso seguro</span></div>
          </div>
          <button onClick={() => setMode("login")}><LogIn size={18} />Ja sou cliente</button>
          <button className="secondary-button" onClick={() => setMode("signup")}><UserPlus size={18} />Quero me cadastrar</button>
        </section>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={(event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        void fetch(`${apiUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        }).then(async (response) => {
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.message || "Falha ao entrar.");
          onLogin({ ...result.user, accessToken: result.accessToken, refreshToken: result.refreshToken });
        }).catch((loginError) => {
          setError(loginError instanceof Error ? loginError.message : "Falha ao entrar.");
        }).finally(() => setLoading(false));
      }}>
        <div className="login-brand">
          <img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} />
          <div><strong>Condo Access</strong><span>{mode === "signup" ? "Cadastro inicial" : "Acesso seguro"}</span></div>
        </div>
        <Field label="E-mail"><input value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Senha"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        {error && <div className="form-error">{error}</div>}
        {mode === "signup" && <div className="form-hint">Fluxo local de demonstracao. Na API real, este cadastro cria ou solicita acesso ao condominio.</div>}
        <button type="submit" disabled={loading}><LogIn size={18} />{loading ? "Entrando..." : "Entrar"}</button>
        <button className="secondary-button" type="button" onClick={() => setMode("choice")}>Voltar</button>
      </form>
    </main>
  );
}

function ChangePassword({ session, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState("123456");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={async (event) => {
        event.preventDefault();
        if (newPassword !== confirmation) {
          setError("A confirmacao da nova senha nao confere.");
          return;
        }
        const response = await fetch(`${apiUrl}/api/auth/change-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login: session.email, currentPassword, newPassword })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(result.message || "Falha ao alterar senha.");
          return;
        }
        onChanged({ ...session, mustChangePassword: false });
      }}>
        <div className="login-brand">
          <img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} />
          <div><strong>Troca obrigatoria de senha</strong><span>Proteja o primeiro acesso da empresa</span></div>
        </div>
        <Field label="Senha temporaria"><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
        <Field label="Nova senha"><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
        <Field label="Confirmar nova senha"><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
        {error && <div className="form-error">{error}</div>}
        <button type="submit"><Save size={18} /> Alterar senha e continuar</button>
      </form>
    </main>
  );
}

export {
  PersonAvatar,
  Field,
  StatusBanner,
  Pagination,
  usePaged,
  Metric,
  LocalLogin,
  ChangePassword
};
