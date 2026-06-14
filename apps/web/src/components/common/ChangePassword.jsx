import React, { useState } from "react";
import { Save } from "lucide-react";
import Logo from "../../logo.png";
import { changePassword } from "../../services/authService.js";
import Field from "./Field.jsx";

function ChangePassword({ session, onChanged }) {
  const [currentPassword, setCurrentPassword] = useState("123456");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("A confirmacao da nova senha nao confere.");
      return;
    }
    try {
      await changePassword({ login: session.email, currentPassword, newPassword });
      onChanged({ ...session, mustChangePassword: false });
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Falha ao alterar senha.");
    }
  }

  return <main className="login-shell"><form className="login-panel" onSubmit={submit}>
    <div className="login-brand"><img src={Logo} alt="Condo Access" style={{ width: 44, height: 44, objectFit: "contain" }} /><div><strong>Troca obrigatoria de senha</strong><span>Proteja o primeiro acesso da empresa</span></div></div>
    <Field label="Senha temporaria"><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
    <Field label="Nova senha"><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
    <Field label="Confirmar nova senha"><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
    {error && <div className="form-error">{error}</div>}
    <button type="submit"><Save size={18} /> Alterar senha e continuar</button>
  </form></main>;
}

export default ChangePassword;
