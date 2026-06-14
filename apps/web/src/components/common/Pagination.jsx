import React from "react";

function Pagination({ page, totalPages, onPage }) {
  return (
    <div className="pagination-bar">
      <button className="secondary-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <span>Pagina {page} de {totalPages}</span>
      <button className="secondary-button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Proxima</button>
    </div>
  );
}

export default Pagination;
