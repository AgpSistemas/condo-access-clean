import React, { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import Logo from "../../logo.png";
import { login } from "../../services/authService.js";
import Field from "./Field.jsx";

function LocalLogin({ onLogin }) {
  const [mode, setMode] = useState("choice");
  const [email, setEmail] = useState("agpsistemascorp@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (mode === "choice") {
    return <main className="login-shell"><section className="login-panel">
      <div className="login-brand"><img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} /><div><strong>Condo Access</strong><span>Acesso seguro</span></div></div>
      <button onClick={() => setMode("login")}><LogIn size={18} />Ja sou cliente</button>
      <button className="secondary-button" onClick={() => setMode("signup")}><UserPlus size={18} />Quero me cadastrar</button>
    </section></main>;
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await login({ email, password });
      onLogin({ ...result.user, accessToken: result.accessToken, refreshToken: result.refreshToken });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-shell"><form className="login-panel" onSubmit={submit}>
    <div className="login-brand"><img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} /><div><strong>Condo Access</strong><span>{mode === "signup" ? "Cadastro inicial" : "Acesso seguro"}</span></div></div>
    <Field label="E-mail"><input value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
    <Field label="Senha"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
    {error && <div className="form-error">{error}</div>}
    {mode === "signup" && <div className="form-hint">Fluxo local de demonstracao. Na API real, este cadastro cria ou solicita acesso ao condominio.</div>}
    <button type="submit" disabled={loading}><LogIn size={18} />{loading ? "Entrando..." : "Entrar"}</button>
    <button className="secondary-button" type="button" onClick={() => setMode("choice")}>Voltar</button>
  </form></main>;
}

export default LocalLogin;
