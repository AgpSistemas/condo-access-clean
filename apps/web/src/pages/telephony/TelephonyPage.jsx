import React, { useEffect, useMemo, useState } from "react";
import { PhoneCall, PhoneOff, Search } from "lucide-react";
import { Pagination } from "../../components/common/index.js";
import { usePagination } from "../../hooks/usePagination.js";

function extensionOf(unit = {}) {
  return String(unit.telephony?.extension || unit.extension || "").trim();
}

function TelephonyPage({ selectedTenant, units, extensionStatus, webPhone, onCallExtension, onHangup }) {
  const [search, setSearch] = useState("");
  const directory = useMemo(() => {
    const unitByExtension = new Map(units.map((unit) => [extensionOf(unit), unit]));
    const rows = extensionStatus
      .filter((item) => item.configured && item.extension && String(item.extension) !== String(selectedTenant?.sipPorterExtension || ""))
      .map((item) => {
        const unit = unitByExtension.get(String(item.extension));
        return {
          ...item,
          unit,
          label: item.label || (unit ? `Unidade ${unit.unitNumber || unit.unitId}` : `Ramal ${item.extension}`),
          detail: unit
            ? [unit.blockName, unit.residentName || unit.responsibleName].filter(Boolean).join(" - ")
            : item.type === "PORTER" ? selectedTenant?.name || "Portaria" : item.type || "Ramal interno"
        };
      });

    units.forEach((unit) => {
      const extension = extensionOf(unit);
      if (!extension || rows.some((item) => String(item.extension) === extension)) return;
      rows.push({
        extension,
        label: `Unidade ${unit.unitNumber || unit.unitId}`,
        detail: [unit.blockName, unit.residentName || unit.responsibleName].filter(Boolean).join(" - "),
        type: "UNIT",
        configured: true,
        registrationStatus: "UNKNOWN",
        registrationLabel: "Sem leitura",
        unit
      });
    });

    return rows.sort((left, right) => Number(left.extension) - Number(right.extension));
  }, [extensionStatus, selectedTenant?.name, units]);

  const filteredDirectory = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return directory;
    return directory.filter((item) =>
      `${item.extension} ${item.label} ${item.detail} ${item.type}`.toLowerCase().includes(term)
    );
  }, [directory, search]);
  const { page, setPage, totalPages, pageItems } = usePagination(filteredDirectory, 8);

  useEffect(() => {
    setPage(1);
  }, [search, selectedTenant?.id, setPage]);

  const callInProgress = ["CALLING", "RINGING", "IN_CALL"].includes(webPhone.status);

  return (
    <section className="resource-page telephony-page">
      <article className="panel resource-hero">
        <div>
          <span>Telefonia interna</span>
          <h2>Ramais de {selectedTenant?.name || "condominio"}</h2>
          <small>Ligue para portaria, unidades e equipamentos cadastrados no mesmo condominio.</small>
        </div>
        {callInProgress && (
          <button className="danger-button" type="button" onClick={() => void onHangup()}>
            <PhoneOff size={17} /> Encerrar chamada
          </button>
        )}
      </article>

      <article className="panel">
        <div className="panel-heading">
          <div>
            <h2>Lista de ramais</h2>
            <small>{filteredDirectory.length} ramal(is) encontrado(s)</small>
          </div>
          <label className="search-field">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ramal, unidade ou morador" />
          </label>
        </div>

        <div className="extension-directory">
          {pageItems.map((item) => (
            <article className="extension-directory-row" key={`${item.type}-${item.extension}`}>
              <div className="extension-number">{item.extension}</div>
              <div className="extension-directory-copy">
                <strong>{item.label}</strong>
                <span>{item.detail || "Ramal interno"}</span>
                <small className={item.registrationStatus === "REGISTERED" ? "online-text" : ""}>
                  {item.registrationLabel || item.status || "Sem leitura"}
                </small>
              </div>
              <button
                type="button"
                disabled={callInProgress}
                onClick={() => void onCallExtension(item)}
                title={`Ligar para ${item.label}`}
              >
                <PhoneCall size={17} /> Ligar
              </button>
            </article>
          ))}
          {!pageItems.length && <div className="empty-state">Nenhum ramal encontrado neste condominio.</div>}
        </div>
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      </article>

      <article className="panel compact-webphone">
        <div>
          <strong>Status do audio</strong>
          <span>{webPhone.incomingLabel || webPhone.diagnostic || "Desconectado"}</span>
        </div>
        <span className={`status ${webPhone.status === "ERROR" || webPhone.status === "DISCONNECTED" ? "offline" : ""}`}>
          {webPhone.status}
        </span>
      </article>
    </section>
  );
}

export default TelephonyPage;
