import React from "react";
import { BadgeCheck, FileKey2, PhoneCall, PhoneOff, WifiOff } from "lucide-react";

function AppNotifications({ incomingCall, incomingCallTenant, incomingCallUnit, rejectIncomingCall, answerCall, message, supportAlert, setSupportAlert, disconnectedDevices, openDisconnectedDevices }) {
  return <>
    {incomingCall?.status === "RINGING" && <div className="call-modal-backdrop" role="presentation">
      <section className="call-notification call-modal" role="dialog" aria-modal="true" aria-labelledby="incoming-call-title">
        <div className="call-modal-icon"><PhoneCall size={24} /></div>
        <div className="call-modal-content">
          <span className="call-modal-kicker">Chamada recebida</span>
          <h2 id="incoming-call-title">{incomingCallTenant?.name || "Condominio"}</h2>
          <div className="call-modal-grid">
            <span><strong>Unidade</strong>{incomingCallUnit?.unitNumber || incomingCall.unitNumber || incomingCall.unitId || "-"}</span>
            <span><strong>Ramal</strong>{incomingCall.sourceExtension || incomingCallUnit?.telephony?.extension || incomingCallUnit?.extension || "-"}</span>
            <span><strong>Origem</strong>{incomingCall.visitorLabel || incomingCall.targetType || "Aplicativo do morador"}</span>
            <span><strong>Status</strong>{incomingCall.status}</span>
          </div>
          {incomingCallUnit?.residentName && <p>{incomingCallUnit.residentName}</p>}
        </div>
        <div className="call-modal-actions">
          <button type="button" className="call-modal-button call-modal-reject" title="Recusar chamada" aria-label="Recusar chamada" onClick={() => void rejectIncomingCall(incomingCall)}><PhoneOff size={22} /></button>
          <button type="button" className="call-modal-button call-modal-answer" title="Atender chamada" aria-label="Atender chamada" onClick={() => void answerCall(incomingCall)}><PhoneCall size={22} /></button>
        </div>
      </section>
    </div>}
    {message && <div className="change-toast" role="status"><BadgeCheck size={20} /><span>{message}</span></div>}
    {supportAlert && <div className="call-modal-backdrop" role="presentation"><section className="support-limit-modal" role="dialog" aria-modal="true" aria-labelledby="support-limit-title"><FileKey2 size={28} /><h2 id="support-limit-title">Limite da licenca atingido</h2><p>{supportAlert}</p><button type="button" onClick={() => setSupportAlert("")}>Entendi</button></section></div>}
    {disconnectedDevices.length > 0 && <button className="device-alert-notification" type="button" onClick={openDisconnectedDevices}><WifiOff size={20} /><div><strong>Equipamento desconectado</strong><span>{disconnectedDevices[0].name}{disconnectedDevices.length > 1 ? ` +${disconnectedDevices.length - 1}` : ""}</span></div></button>}
  </>;
}

export default AppNotifications;
